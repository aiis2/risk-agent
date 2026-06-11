/**
 * PostgresStore — PostgreSQL 结构化数据适配器。
 * packages/core/src/storage/adapters/PostgresStore.ts
 *
 * 依赖 `pg` 包（按需安装：pnpm add -w pg @types/pg）。
 * 当 storage.json 中 structured.backend === 'postgresql' 时由 registry.ts 加载。
 */
import type { IStructuredStore } from '../interfaces/IStructuredStore.js';

export interface PostgresStoreConfig {
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMs?: number;
  };
}

/**
 * PostgreSQL 适配器（延迟加载 `pg`，避免未安装时报错）。
 */
export class PostgresStore implements IStructuredStore {
  private pool: any = null;
  private readonly config: PostgresStoreConfig;

  constructor(config: PostgresStoreConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    let pg: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // @ts-ignore — optional peer dep, install when using postgres backend
      pg = await import('pg');
    } catch {
      throw new Error(
        'PostgresStore: `pg` package is not installed. Run: pnpm add -w pg @types/pg',
      );
    }
    const { Pool } = pg.default ?? pg;
    this.pool = new Pool({
      connectionString: this.config.url,
      host: this.config.host ?? 'localhost',
      port: this.config.port ?? 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      min: this.config.pool?.min ?? 2,
      max: this.config.pool?.max ?? 10,
      idleTimeoutMillis: this.config.pool?.idleTimeoutMs ?? 30_000,
    });
    // Verify connection
    const client = await this.pool.connect();
    client.release();
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async run(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const res = await this.pool.query(sql, params);
    return { changes: res.rowCount ?? 0, lastInsertRowid: 0 };
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const res = await this.pool.query(sql, params);
    return res.rows[0] as T | undefined;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async transaction<T>(fn: (tx: IStructuredStore) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const txStore: IStructuredStore = {
      init: async () => {},
      close: async () => {},
      exec: (sql) => client.query(sql),
      run: async (sql, params = []) => {
        const res = await client.query(sql, params);
        return { changes: res.rowCount ?? 0, lastInsertRowid: 0 };
      },
      get: async <U>(sql: string, params: unknown[] = []) => {
        const res = await client.query(sql, params);
        return res.rows[0] as U | undefined;
      },
      all: async <U>(sql: string, params: unknown[] = []) => {
        const res = await client.query(sql, params);
        return res.rows as U[];
      },
      transaction: (innerFn) => this.transaction(innerFn),
    };
    try {
      await client.query('BEGIN');
      const result = await fn(txStore);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
