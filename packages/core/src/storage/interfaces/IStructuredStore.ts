/**
 * IStructuredStore — 统一结构化数据接口（SQLite / Postgres / MySQL 均可实现）
 */
export interface IStructuredStore {
  init(): Promise<void>;
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: IStructuredStore) => Promise<T>): Promise<T>;
}
