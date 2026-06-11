import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';
import { DataSourceKnowledgeService } from '../services/DataSourceKnowledgeService.js';

const DSSchema = z.object({
  name: z.string(),
  sourceType: z.enum(['api', 'git', 'db', 'file', 'mcp', 'web']),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().optional()
});

export function registerDataSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();
  const knowledgeService = new DataSourceKnowledgeService(ctx.storage, { loadDbSchema: fetchDbSchema });

  // GET /api/datasources — list all
  app.get('/api/datasources', async () => {
    const rows = await store.all<any>(`SELECT * FROM data_sources ORDER BY created_at DESC`);
    return rows.map(serialize);
  });

  // POST /api/datasources — create
  app.post('/api/datasources', async (req, reply) => {
    const parsed = DSSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const id = randomUUID();
    await store.run(
      `INSERT INTO data_sources(source_id, name, source_type, config_json, enabled) VALUES(?,?,?,?,?)`,
      [id, parsed.data.name, parsed.data.sourceType, JSON.stringify(parsed.data.config), parsed.data.enabled !== false ? 1 : 0]
    );
    reply.code(201).send({ sourceId: id });
  });

  // PUT /api/datasources/:id — update
  app.put('/api/datasources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = DSSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const existing = await store.get<any>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const updates: string[] = [];
    const vals: unknown[] = [];
    if (parsed.data.name !== undefined) { updates.push('name=?'); vals.push(parsed.data.name); }
    if (parsed.data.sourceType !== undefined) { updates.push('source_type=?'); vals.push(parsed.data.sourceType); }
    if (parsed.data.config !== undefined) { updates.push('config_json=?'); vals.push(JSON.stringify(parsed.data.config)); }
    if (parsed.data.enabled !== undefined) { updates.push('enabled=?'); vals.push(parsed.data.enabled ? 1 : 0); }
    if (updates.length === 0) return reply.code(400).send({ error: 'no_fields' });
    updates.push("updated_at=datetime('now')");
    vals.push(id);
    await store.run(`UPDATE data_sources SET ${updates.join(', ')} WHERE source_id=?`, vals);
    const updated = await store.get<any>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    return serialize(updated);
  });

  // DELETE /api/datasources/:id
  app.delete('/api/datasources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await store.run(`DELETE FROM data_sources WHERE source_id=?`, [id]);
    reply.code(204).send();
  });

  // POST /api/datasources/:id/test — test connectivity
  app.post('/api/datasources/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const ds = serialize(row);
    const start = Date.now();
    try {
      const result = await testConnectivity(ds);
      return { healthy: result.healthy, latencyMs: Date.now() - start, message: result.message };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: err?.message ?? 'connection_failed' };
    }
  });

  // GET /api/datasources/:id/schema — get DB schema (db type only)
  app.get('/api/datasources/:id/schema', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const ds = serialize(row);
    if (ds.sourceType !== 'db') return reply.code(400).send({ error: 'not_a_db_source' });
    try {
      const schema = await fetchDbSchema(ds.config as DbConfig);
      return { sourceId: id, tables: schema };
    } catch (err: any) {
      return reply.code(500).send({ error: 'schema_fetch_failed', message: err?.message });
    }
  });

  app.post('/api/datasources/:id/knowledge/rebuild', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT source_id FROM data_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    try {
      return await knowledgeService.rebuild(id);
    } catch (err: any) {
      return reply.code(500).send({ error: 'knowledge_rebuild_failed', message: err?.message ?? 'knowledge_rebuild_failed' });
    }
  });

  app.get('/api/datasources/:id/knowledge', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT source_id FROM data_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    try {
      return await knowledgeService.getSummary(id);
    } catch (err: any) {
      return reply.code(404).send({ error: 'knowledge_not_built', message: err?.message ?? 'knowledge_not_built' });
    }
  });

  app.get('/api/datasources/:id/knowledge/search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { query, limit } = req.query as { query?: string; limit?: string };
    const row = await store.get<any>(`SELECT source_id FROM data_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!query?.trim()) return reply.code(400).send({ error: 'query_required' });
    try {
      return await knowledgeService.search(id, query.trim(), Number(limit ?? 5));
    } catch (err: any) {
      return reply.code(404).send({ error: 'knowledge_not_built', message: err?.message ?? 'knowledge_not_built' });
    }
  });

  // GET /api/datasources/:id/tables/:table — preview table data (first 50 rows)
  app.get('/api/datasources/:id/tables/:table', async (req, reply) => {
    const { id, table } = req.params as { id: string; table: string };
    const row = await store.get<any>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const ds = serialize(row);
    if (ds.sourceType !== 'db') return reply.code(400).send({ error: 'not_a_db_source' });
    // Validate table name to prevent SQL injection (whitelist: alphanumeric + underscore + dot)
    if (!/^[\w.]+$/.test(table)) return reply.code(400).send({ error: 'invalid_table_name' });
    try {
      const rows = await fetchTablePreview(ds.config as DbConfig, table);
      return { sourceId: id, table, rows };
    } catch (err: any) {
      return reply.code(500).send({ error: 'preview_failed', message: err?.message });
    }
  });

  // GET /api/datasources/health — health for all enabled sources
  app.get('/api/datasources/health', async () => {
    const rows = await store.all<any>(`SELECT * FROM data_sources WHERE enabled=1`);
    const results = await Promise.allSettled(
      rows.map(async (r) => {
        const ds = serialize(r);
        const start = Date.now();
        try {
          const res = await testConnectivity(ds);
          return { sourceId: ds.sourceId, name: ds.name, sourceType: ds.sourceType, healthy: res.healthy, latencyMs: Date.now() - start, message: res.message };
        } catch (err: any) {
          return { sourceId: ds.sourceId, name: ds.name, sourceType: ds.sourceType, healthy: false, latencyMs: Date.now() - start, message: err?.message };
        }
      })
    );
    return results.map((r) => r.status === 'fulfilled' ? r.value : { healthy: false, message: 'unknown_error' });
  });
}

// ─── helpers ──────────────────────────────────────────────────────────────────

interface DsConfig { host?: string; port?: number; database?: string; username?: string; password?: string; dbType?: string; baseUrl?: string; url?: string; }
type DbConfig = DsConfig;

async function testConnectivity(ds: ReturnType<typeof serialize>): Promise<{ healthy: boolean; message?: string }> {
  const cfg = ds.config as DsConfig;
  if (ds.sourceType === 'api' || ds.sourceType === 'web') {
    const url = cfg.baseUrl ?? cfg.url;
    if (!url) return { healthy: false, message: 'no_url_configured' };
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(url as string, { method: 'HEAD', signal: ac.signal });
      clearTimeout(tid);
      return { healthy: res.status < 500, message: `HTTP ${res.status}` };
    } catch (e: any) { return { healthy: false, message: e?.message }; }
  }
  if (ds.sourceType === 'db') {
    return testDbConnectivity(cfg);
  }
  if (ds.sourceType === 'git') {
    const url = cfg.url;
    if (!url) return { healthy: false, message: 'no_url_configured' };
    return { healthy: true, message: 'git_not_verified' };
  }
  return { healthy: true, message: 'no_check_needed' };
}

async function testDbConnectivity(cfg: DbConfig): Promise<{ healthy: boolean; message?: string }> {
  const dbType = (cfg.dbType ?? 'mysql').toLowerCase();
  if (dbType === 'mysql' || dbType === 'doris') {
    try {
      // @ts-ignore — mysql2 optional peer dep
      const { createPool } = await import('mysql2/promise') as any;
      const pool = createPool({ host: cfg.host, port: cfg.port ?? 3306, database: cfg.database, user: cfg.username, password: cfg.password, connectTimeout: 8000, connectionLimit: 1 });
      const [rows] = await pool.execute('SELECT 1');
      await pool.end();
      return { healthy: true, message: `MySQL OK (rows=${(rows as any[]).length})` };
    } catch (e: any) { return { healthy: false, message: e?.message }; }
  }
  if (dbType === 'postgresql' || dbType === 'postgres') {
    try {
      // @ts-ignore — pg optional peer dep
      const { Pool } = await import('pg') as any;
      const pool = new Pool({ host: cfg.host, port: cfg.port ?? 5432, database: cfg.database, user: cfg.username, password: cfg.password, connectionTimeoutMillis: 8000, max: 1 });
      await pool.query('SELECT 1');
      await pool.end();
      return { healthy: true, message: 'PostgreSQL OK' };
    } catch (e: any) { return { healthy: false, message: e?.message }; }
  }
  return { healthy: true, message: `${dbType}: connectivity_not_verified` };
}

async function fetchDbSchema(cfg: DbConfig): Promise<Array<{ name: string; comment?: string; columns: Array<{ name: string; type: string; nullable: boolean; comment?: string }> }>> {
  const dbType = (cfg.dbType ?? 'mysql').toLowerCase();
  if (dbType === 'mysql' || dbType === 'doris') {
    // @ts-ignore — mysql2 optional peer dep
    const { createPool } = await import('mysql2/promise') as any;
    const pool = createPool({ host: cfg.host, port: cfg.port ?? 3306, database: cfg.database, user: cfg.username, password: cfg.password, connectTimeout: 8000, connectionLimit: 1 });
    try {
      const [tables]: any[] = await pool.execute(`SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=?`, [cfg.database]);
      const result = await Promise.all(
        (tables as any[]).map(async (t: any) => {
          const [cols]: any[] = await pool.execute(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [cfg.database, t.TABLE_NAME]);
          return { name: t.TABLE_NAME, comment: t.TABLE_COMMENT || undefined, columns: (cols as any[]).map((c: any) => ({ name: c.COLUMN_NAME, type: c.COLUMN_TYPE, nullable: c.IS_NULLABLE === 'YES', comment: c.COLUMN_COMMENT || undefined })) };
        })
      );
      await pool.end();
      return result;
    } catch (e) { await pool.end().catch(() => {}); throw e; }
  }
  if (dbType === 'postgresql' || dbType === 'postgres') {
    // @ts-ignore — pg optional peer dep
    const { Pool } = await import('pg') as any;
    const pool = new Pool({ host: cfg.host, port: cfg.port ?? 5432, database: cfg.database, user: cfg.username, password: cfg.password, max: 1 });
    try {
      const tablesRes = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
      const result = await Promise.all(
        tablesRes.rows.map(async (t: any) => {
          const colRes = await pool.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t.table_name]);
          return { name: t.table_name, columns: colRes.rows.map((c: any) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES' })) };
        })
      );
      await pool.end();
      return result;
    } catch (e) { await pool.end().catch(() => {}); throw e; }
  }
  return [];
}

function serialize(r: any) {
  return {
    sourceId: r.source_id,
    name: r.name,
    sourceType: r.source_type,
    config: JSON.parse(r.config_json ?? '{}'),
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

async function fetchTablePreview(cfg: DbConfig, table: string): Promise<{ columns: string[]; rows: unknown[][] }> {
  const dbType = (cfg.dbType ?? 'mysql').toLowerCase();
  if (dbType === 'mysql' || dbType === 'doris') {
    // @ts-ignore
    const { createPool } = await import('mysql2/promise') as any;
    const pool = createPool({ host: cfg.host, port: cfg.port ?? 3306, database: cfg.database, user: cfg.username, password: cfg.password, connectTimeout: 8000, connectionLimit: 1 });
    try {
      const [rows, fields]: any[] = await pool.execute(`SELECT * FROM \`${table}\` LIMIT 50`);
      const columns = (fields as any[]).map((f: any) => f.name);
      const data = (rows as any[]).map((r: any) => columns.map((c: string) => r[c]));
      await pool.end();
      return { columns, rows: data };
    } catch (e) { await pool.end().catch(() => {}); throw e; }
  }
  if (dbType === 'postgresql' || dbType === 'postgres') {
    // @ts-ignore
    const { Pool } = await import('pg') as any;
    const pool = new Pool({ host: cfg.host, port: cfg.port ?? 5432, database: cfg.database, user: cfg.username, password: cfg.password, max: 1 });
    try {
      const res = await pool.query(`SELECT * FROM "${table}" LIMIT 50`);
      const columns = res.fields.map((f: any) => f.name);
      const data = res.rows.map((r: any) => columns.map((c: string) => r[c]));
      await pool.end();
      return { columns, rows: data };
    } catch (e) { await pool.end().catch(() => {}); throw e; }
  }
  return { columns: [], rows: [] };
}
