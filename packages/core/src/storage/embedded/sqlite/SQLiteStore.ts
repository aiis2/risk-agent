import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import type { IStructuredStore } from '../../interfaces/IStructuredStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveSchemaPath(): string {
  const candidates = [
    join(__dirname, 'schema.sql'),
    // When core is consumed as dist/ but schema.sql wasn't copied, fall back to src/
    resolve(__dirname, '../../../../src/storage/embedded/sqlite/schema.sql'),
    resolve(__dirname, '../../../src/storage/embedded/sqlite/schema.sql')
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

export class SQLiteStore implements IStructuredStore {
  private db: Database.Database | null = null;

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.db = new Database(this.filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // Apply incremental column migrations BEFORE running schema
    // (schema uses IF NOT EXISTS for tables/indexes, but ALTER TABLE is needed for new columns)
    this.applyPreSchemaMigrations();
    const schemaPath = resolveSchemaPath();
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  /** Add columns that were introduced after the initial schema was shipped. */
  private applyPreSchemaMigrations(): void {
    const db = this.db!;
    const tableExists = (name: string) =>
      (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name) as any) != null;
    const hasColumn = (table: string, col: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === col);

    // v3.3: memory_facts.content_hash (SHA256 dedup)
    if (tableExists('memory_facts') && !hasColumn('memory_facts', 'content_hash')) {
      db.exec('ALTER TABLE memory_facts ADD COLUMN content_hash TEXT');
    }

    if (tableExists('browser_tabs') && !hasColumn('browser_tabs', 'is_pinned')) {
      db.exec('ALTER TABLE browser_tabs ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
    }

    if (tableExists('browser_tabs') && !hasColumn('browser_tabs', 'sort_order')) {
      db.exec('ALTER TABLE browser_tabs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private ensure(): Database.Database {
    if (!this.db) throw new Error('SQLiteStore not initialized');
    return this.db;
  }

  async exec(sql: string): Promise<void> {
    this.ensure().exec(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    const info = this.ensure().prepare(sql).run(...(params as any[]));
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.ensure().prepare(sql).get(...(params as any[])) as T | undefined;
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.ensure().prepare(sql).all(...(params as any[])) as T[];
  }

  async transaction<T>(fn: (tx: IStructuredStore) => Promise<T>): Promise<T> {
    // better-sqlite3 only supports sync transactions; we wrap the async work manually.
    // For MVP, we enforce serial execution rather than true SQLite BEGIN/COMMIT wrapping.
    const db = this.ensure();
    db.exec('BEGIN');
    try {
      const result = await fn(this);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  raw(): Database.Database {
    return this.ensure();
  }
}
