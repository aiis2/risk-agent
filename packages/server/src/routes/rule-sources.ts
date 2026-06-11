/**
 * /api/rule-sources — 规则来源管理
 * 04-storage-layer.md §2.2 rule_sources + rule_source_mapping
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const CreateSchema = z.object({
  systemName: z.string().min(1),
  systemType: z.enum(['realtime', 'offline', 'manual']).default('manual'),
  sourceType: z.enum(['file_import', 'api_sync', 'manual_input', 'model_generated']),
  fileName: z.string().optional(),
  importedBy: z.string().optional(),
  importNote: z.string().optional()
});

const MappingSchema = z.object({
  ruleId: z.string().min(1),
  sourceId: z.string().min(1),
  confidence: z.number().min(0).max(1).default(1.0),
  parseNotes: z.string().optional()
});

function serialize(r: any) {
  return {
    sourceId: r.source_id,
    systemName: r.system_name,
    systemType: r.system_type,
    sourceType: r.source_type,
    fileName: r.file_name,
    ruleCount: r.rule_count,
    importedBy: r.imported_by,
    importNote: r.import_note,
    createdAt: r.created_at
  };
}

export function registerRuleSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  // Bootstrap migration guard（table 可能不存在于旧 DB）
  store.run(`
    CREATE TABLE IF NOT EXISTS rule_sources (
      source_id     TEXT PRIMARY KEY,
      system_name   TEXT NOT NULL,
      system_type   TEXT DEFAULT 'manual',
      source_type   TEXT NOT NULL,
      file_name     TEXT,
      rule_count    INTEGER DEFAULT 0,
      imported_by   TEXT,
      import_note   TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `).catch(() => {});
  store.run(`
    CREATE TABLE IF NOT EXISTS rule_source_mapping (
      rule_id       TEXT,
      source_id     TEXT,
      confidence    REAL DEFAULT 1.0,
      parse_notes   TEXT,
      PRIMARY KEY (rule_id, source_id)
    )
  `).catch(() => {});

  // GET /api/rule-sources
  app.get('/api/rule-sources', async (req) => {
    const { sourceType } = (req.query ?? {}) as { sourceType?: string };
    let rows: any[];
    if (sourceType) {
      rows = await store.all<any>(
        `SELECT * FROM rule_sources WHERE source_type=? ORDER BY created_at DESC`,
        [sourceType]
      );
    } else {
      rows = await store.all<any>(
        `SELECT * FROM rule_sources ORDER BY created_at DESC`
      );
    }
    return rows.map(serialize);
  });

  // GET /api/rule-sources/:id
  app.get('/api/rule-sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM rule_sources WHERE source_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    // 加载关联规则 IDs
    const mappings = await store.all<any>(
      `SELECT rule_id, confidence, parse_notes FROM rule_source_mapping WHERE source_id=?`, [id]
    );
    return { ...serialize(row), mappings };
  });

  // POST /api/rule-sources
  app.post('/api/rule-sources', async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const d = parsed.data;
    const id = randomUUID();
    await store.run(
      `INSERT INTO rule_sources(source_id, system_name, system_type, source_type, file_name, imported_by, import_note)
       VALUES(?,?,?,?,?,?,?)`,
      [id, d.systemName, d.systemType, d.sourceType, d.fileName ?? null, d.importedBy ?? null, d.importNote ?? null]
    );
    const row = await store.get<any>(`SELECT * FROM rule_sources WHERE source_id=?`, [id]);
    reply.code(201).send(serialize(row));
  });

  // PUT /api/rule-sources/:id
  app.put('/api/rule-sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const existing = await store.get<any>(`SELECT * FROM rule_sources WHERE source_id=?`, [id]);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const d = parsed.data;
    await store.run(
      `UPDATE rule_sources SET
         system_name=COALESCE(?,system_name),
         system_type=COALESCE(?,system_type),
         source_type=COALESCE(?,source_type),
         file_name=COALESCE(?,file_name),
         imported_by=COALESCE(?,imported_by),
         import_note=COALESCE(?,import_note)
       WHERE source_id=?`,
      [d.systemName ?? null, d.systemType ?? null, d.sourceType ?? null,
       d.fileName ?? null, d.importedBy ?? null, d.importNote ?? null, id]
    );
    const row = await store.get<any>(`SELECT * FROM rule_sources WHERE source_id=?`, [id]);
    return serialize(row);
  });

  // DELETE /api/rule-sources/:id
  app.delete('/api/rule-sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await store.get<any>(`SELECT source_id FROM rule_sources WHERE source_id=?`, [id]);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await store.run(`DELETE FROM rule_source_mapping WHERE source_id=?`, [id]);
    await store.run(`DELETE FROM rule_sources WHERE source_id=?`, [id]);
    reply.code(204).send();
  });

  // POST /api/rule-sources/mappings — 批量建立规则-来源关联
  app.post('/api/rule-sources/mappings', async (req, reply) => {
    const body = req.body as { mappings?: unknown[] };
    const items = Array.isArray(body?.mappings) ? body.mappings : (Array.isArray(req.body) ? req.body : []);
    const results: string[] = [];
    for (const item of items) {
      const parsed = MappingSchema.safeParse(item);
      if (!parsed.success) continue;
      const { ruleId, sourceId, confidence, parseNotes } = parsed.data;
      await store.run(
        `INSERT OR REPLACE INTO rule_source_mapping(rule_id, source_id, confidence, parse_notes) VALUES(?,?,?,?)`,
        [ruleId, sourceId, confidence, parseNotes ?? null]
      );
      // 更新来源的 rule_count
      await store.run(
        `UPDATE rule_sources SET rule_count=(SELECT COUNT(*) FROM rule_source_mapping WHERE source_id=?) WHERE source_id=?`,
        [sourceId, sourceId]
      );
      results.push(ruleId);
    }
    reply.code(201).send({ mapped: results.length, ruleIds: results });
  });

  // GET /api/rule-sources/:id/rules — 查询该来源关联的规则列表
  app.get('/api/rule-sources/:id/rules', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await store.get<any>(`SELECT source_id FROM rule_sources WHERE source_id=?`, [id]);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const rows = await store.all<any>(
      `SELECT r.*, rsm.confidence, rsm.parse_notes
       FROM risk_rules r
       JOIN rule_source_mapping rsm ON r.rule_id = rsm.rule_id
       WHERE rsm.source_id=?
       ORDER BY rsm.confidence DESC`,
      [id]
    );
    return rows.map((r: any) => ({
      ruleId: r.rule_id,
      ruleName: r.rule_name,
      bizType: r.biz_type,
      ruleType: r.rule_type,
      riskLevel: r.risk_level,
      status: r.status,
      confidence: r.confidence,
      parseNotes: r.parse_notes
    }));
  });
}
