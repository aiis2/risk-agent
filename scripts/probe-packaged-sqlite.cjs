#!/usr/bin/env node
const sqlitePackagePath = process.argv[2];

if (!sqlitePackagePath) {
  throw new Error('packaged better-sqlite3 path is required');
}

const Database = require(sqlitePackagePath);
const database = new Database(':memory:');

try {
  const result = database.prepare('SELECT 42 AS value').get();
  if (result?.value !== 42) {
    throw new Error(`unexpected SQLite probe result: ${JSON.stringify(result)}`);
  }

  process.stdout.write(`SQLite query passed via ${process.versions.electron ?? 'unknown Electron'}\n`);
} finally {
  database.close();
}
