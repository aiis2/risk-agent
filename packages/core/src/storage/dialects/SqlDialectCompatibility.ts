/**
 * SqlDialectCompatibility — SQL 方言兼容层。
 * packages/core/src/storage/dialects/SqlDialectCompatibility.ts
 *
 * 负责将通用 SQL 模板中的方言差异（SQLite vs PostgreSQL vs MySQL）抹平，
 * 使 SQLiteStore 的建表/查询语句可以被 PostgresStore 等复用。
 */

export type SqlDialect = 'sqlite' | 'postgresql' | 'mysql';

/** 参数占位符风格 */
export function placeholder(dialect: SqlDialect, index: number): string {
  if (dialect === 'postgresql') return `$${index + 1}`;
  return '?'; // sqlite, mysql
}

/** 生成 N 个占位符的列表 */
export function placeholders(dialect: SqlDialect, count: number): string {
  return Array.from({ length: count }, (_, i) => placeholder(dialect, i)).join(', ');
}

/** JSON 存储类型 */
export function jsonType(dialect: SqlDialect): string {
  if (dialect === 'mysql') return 'JSON';
  if (dialect === 'postgresql') return 'JSONB';
  return 'TEXT'; // sqlite
}

/** 自增主键 */
export function autoIncrement(dialect: SqlDialect): string {
  if (dialect === 'postgresql') return 'SERIAL PRIMARY KEY';
  if (dialect === 'mysql') return 'INT AUTO_INCREMENT PRIMARY KEY';
  return 'INTEGER PRIMARY KEY AUTOINCREMENT';
}

/** 当前时间戳 */
export function currentTimestamp(dialect: SqlDialect): string {
  if (dialect === 'mysql') return 'NOW()';
  return 'CURRENT_TIMESTAMP';
}

/** 将 SQLite 风格的 `?` 占位符重写为目标方言格式 */
export function rewritePlaceholders(sql: string, dialect: SqlDialect): string {
  if (dialect === 'sqlite' || dialect === 'mysql') return sql;
  // postgresql: ? → $1, $2, ...
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

/**
 * 将 SQLite 的 INSERT OR REPLACE 重写为目标方言的 upsert 语法。
 * 注：简单实现，仅处理 "INSERT OR REPLACE INTO table ..." → ON CONFLICT 形式。
 */
export function rewriteInsertOrReplace(
  sql: string,
  dialect: SqlDialect,
  conflictTarget = 'id',
): string {
  if (dialect === 'sqlite') return sql;
  if (dialect === 'postgresql') {
    return sql
      .replace(/^INSERT OR REPLACE INTO/i, 'INSERT INTO')
      .replace(/;?\s*$/, ` ON CONFLICT (${conflictTarget}) DO UPDATE SET excluded = excluded;`);
  }
  if (dialect === 'mysql') {
    return sql.replace(/^INSERT OR REPLACE INTO/i, 'REPLACE INTO');
  }
  return sql;
}
