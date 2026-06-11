/**
 * ExternalDatabaseTool — 外部数据库查询工具集。
 * packages/core/src/tools/builtin/ExternalDatabaseTool.ts
 *
 * 实现 §4 两步访问模式：
 *   Step 1: get_database_schema(datasourceId)  → 表结构
 *   Step 2: query_database_external(datasourceId, sql) → 只读查询结果
 *
 * 依赖：
 *   - mysql2   （MySQL / Doris，按需安装）
 *   - pg       （PostgreSQL，按需安装）
 *
 * 安全策略（§4.3）：
 *   - 仅允许 SELECT / WITH / SHOW / DESCRIBE / EXPLAIN
 *   - 最大返回行数 500，上限 2000
 *   - 凭证来自配置中心，不暴露给 LLM
 */
import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

// ─── Config interface (matches data_sources table config_json) ──────────────
export interface ExternalDbConfig {
  dbType?: 'mysql' | 'doris' | 'postgresql' | 'presto';
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  charset?: string;
  socketTimeout?: number;
  maxPoolSize?: number;
  /** SSH tunnel (future use) */
  sshEnabled?: boolean;
}

// ─── Pool cache to avoid recreating connections per call ───────────────────
const _pools = new Map<string, { pool: any; type: string }>();

async function getPool(dsId: string, cfg: ExternalDbConfig): Promise<{ pool: any; type: string }> {
  if (_pools.has(dsId)) return _pools.get(dsId)!;
  const type = (cfg.dbType ?? 'mysql').toLowerCase();
  let pool: any;
  if (type === 'mysql' || type === 'doris') {
    let mysql: any;
    try {
      // @ts-ignore — optional peer dep
      mysql = await import('mysql2/promise');
    } catch {
      throw new Error('ExternalDatabaseTool: `mysql2` not installed. Run: pnpm add -w mysql2');
    }
    pool = mysql.createPool({ host: cfg.host, port: cfg.port ?? 3306, database: cfg.database, user: cfg.username, password: cfg.password, charset: cfg.charset ?? 'UTF8MB4_UNICODE_CI', connectTimeout: 10_000, connectionLimit: cfg.maxPoolSize ?? 3 });
  } else if (type === 'postgresql' || type === 'postgres') {
    let pg: any;
    try {
      // @ts-ignore — optional peer dep
      pg = await import('pg');
    } catch {
      throw new Error('ExternalDatabaseTool: `pg` not installed. Run: pnpm add -w pg @types/pg');
    }
    pool = new pg.Pool({ host: cfg.host, port: cfg.port ?? 5432, database: cfg.database, user: cfg.username, password: cfg.password, max: cfg.maxPoolSize ?? 3, connectionTimeoutMillis: 10_000 });
  } else {
    throw new Error(`ExternalDatabaseTool: unsupported dbType "${type}"`);
  }
  _pools.set(dsId, { pool, type });
  return { pool, type };
}

/** 验证 SQL 是否为只读 */
function assertReadOnly(sql: string): void {
  const first = sql.trim().match(/^\s*(\w+)/)?.[1]?.toUpperCase() ?? '';
  const allowed = new Set(['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN']);
  if (!allowed.has(first)) {
    throw new Error(`安全拒绝: SQL 以 "${first}" 开头，禁止写操作`);
  }
}

// ─── Tool: get_database_schema ─────────────────────────────────────────────

export function createGetDatabaseSchemaTool(
  resolveDsConfig: (datasourceId: string) => Promise<ExternalDbConfig | null>
): AgentToolDefinition {
  return {
    name: 'get_database_schema',
    description: '获取外部数据库的表结构（表名、列定义、注释），第一步：了解数据库结构后再生成 SQL。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: true,
    inputSchema: {
      type: 'object',
      required: ['datasourceId'],
      properties: {
        datasourceId: { type: 'string', description: '数据源 ID（来自数据源配置）' },
        search: { type: 'string', description: '过滤表名关键词（可选）' },
        limit: { type: 'number', description: '最大返回表数（默认 50）' }
      }
    },
    async execute(input) {
      const { datasourceId, search, limit = 50 } = input as { datasourceId: string; search?: string; limit?: number };
      const cfg = await resolveDsConfig(datasourceId);
      if (!cfg) throw new Error(`数据源 "${datasourceId}" 不存在或未配置`);
      const { pool, type } = await getPool(datasourceId, cfg);

      if (type === 'mysql' || type === 'doris') {
        let sql = `SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=?`;
        const params: unknown[] = [cfg.database];
        if (search) { sql += ` AND TABLE_NAME LIKE ?`; params.push(`%${search}%`); }
        sql += ` ORDER BY TABLE_NAME LIMIT ?`;
        params.push(limit);
        const [tables]: any[] = await pool.execute(sql, params);
        const result = await Promise.all(
          (tables as any[]).map(async (t: any) => {
            const [cols]: any[] = await pool.execute(
              `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
              [cfg.database, t.TABLE_NAME]
            );
            return {
              name: t.TABLE_NAME,
              comment: t.TABLE_COMMENT || undefined,
              columns: (cols as any[]).map((c: any) => ({ name: c.COLUMN_NAME, type: c.COLUMN_TYPE, nullable: c.IS_NULLABLE === 'YES', comment: c.COLUMN_COMMENT || undefined }))
            };
          })
        );
        return { datasourceId, dbType: type, database: cfg.database, tables: result, total: result.length };
      }

      if (type === 'postgresql' || type === 'postgres') {
        let sql = `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
        const params: unknown[] = [];
        if (search) { sql += ` AND table_name ILIKE $1`; params.push(`%${search}%`); }
        sql += ` ORDER BY table_name LIMIT ${limit}`;
        const tablesRes = await pool.query(sql, params);
        const result = await Promise.all(
          tablesRes.rows.map(async (t: any) => {
            const colRes = await pool.query(
              `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
              [t.table_name]
            );
            return { name: t.table_name, columns: colRes.rows.map((c: any) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES' })) };
          })
        );
        return { datasourceId, dbType: type, database: cfg.database, tables: result, total: result.length };
      }

      throw new Error(`未支持的数据库类型: ${type}`);
    }
  };
}

// ─── Tool: query_database_external ────────────────────────────────────────

export function createQueryDatabaseExternalTool(
  resolveDsConfig: (datasourceId: string) => Promise<ExternalDbConfig | null>
): AgentToolDefinition {
  return {
    name: 'query_database_external',
    description: '对外部数据库执行只读 SQL 查询（SELECT/SHOW/EXPLAIN），第二步：获取实际数据。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: true,
    inputSchema: {
      type: 'object',
      required: ['datasourceId', 'sql'],
      properties: {
        datasourceId: { type: 'string', description: '数据源 ID' },
        sql: { type: 'string', description: '只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN）' },
        maxRows: { type: 'number', description: '最大行数（默认 500，最大 2000）' }
      }
    },
    async execute(input) {
      const { datasourceId, sql, maxRows = 500 } = input as { datasourceId: string; sql: string; maxRows?: number };
      assertReadOnly(sql);
      const limit = Math.min(maxRows, 2000);
      const cfg = await resolveDsConfig(datasourceId);
      if (!cfg) throw new Error(`数据源 "${datasourceId}" 不存在或未配置`);
      const { pool, type } = await getPool(datasourceId, cfg);
      const start = Date.now();

      if (type === 'mysql' || type === 'doris') {
        const limitedSql = /\bLIMIT\s+\d+/i.test(sql) ? sql : `${sql.trimEnd()} LIMIT ${limit}`;
        const [rows, fields]: any[] = await pool.execute(limitedSql);
        const columns = (fields as any[]).map((f: any) => f.name);
        return { datasourceId, columns, rows: rows as unknown[][], rowCount: (rows as unknown[]).length, executionMs: Date.now() - start };
      }

      if (type === 'postgresql' || type === 'postgres') {
        const limitedSql = /\bLIMIT\s+\d+/i.test(sql) ? sql : `${sql.trimEnd()} LIMIT ${limit}`;
        const res = await pool.query(limitedSql);
        const columns = res.fields.map((f: any) => f.name);
        return { datasourceId, columns, rows: res.rows, rowCount: res.rowCount, executionMs: Date.now() - start };
      }

      throw new Error(`未支持的数据库类型: ${type}`);
    }
  };
}
