/**
 * db.ts — 数据库管理 CLI（getting-started.md §4.4）
 *
 * 用法（通过根目录 package.json 脚本）：
 *   pnpm db:reset                                 # 清空所有分析数据
 *   pnpm db:export -- --output ./backup/data.json  # 导出分析数据到 JSON
 *   pnpm db:import -- --input  ./backup/data.json  # 从 JSON 导入数据
 */
import { StorageBackendRegistry, resolveDataRoot, resolvePaths } from '@risk-agent/core';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ─── CLI 参数解析 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0]; // reset | export | import

function parseFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

// ─── 导出目标表（按依赖顺序）──────────────────────────────────────────────────

const EXPORT_TABLES = [
  'business_scenarios',
  'risk_rules',
  'sessions',
  'gap_reports',
  'data_sources',
  'mcp_servers',
  'model_configs',
  'preferences',
] as const;

// ─── 命令实现 ──────────────────────────────────────────────────────────────────

async function cmdReset(store: ReturnType<StorageBackendRegistry['getStructuredStore']>): Promise<void> {
  // 按反向依赖顺序删除（子表先删）
  const tables = [
    'gap_reports',
    'business_profiles',
    'stream_events',
    'cost_snapshots',
    'collected_data',
    'sessions',
    'rule_lineage',
    'risk_rules',
    'business_scenarios',
    'data_sources',
    'mcp_servers',
  ];
  for (const t of tables) {
    await store.exec(`DELETE FROM ${t}`);
    console.log(`  cleared: ${t}`);
  }
  console.log('[db:reset] Done. Database tables cleared (schema preserved).');
}

async function cmdExport(store: ReturnType<StorageBackendRegistry['getStructuredStore']>): Promise<void> {
  const defaultFile = `./risk-agent-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const outputFile = resolve(parseFlag('--output') ?? defaultFile);

  const data: Record<string, unknown[]> = {};
  for (const table of EXPORT_TABLES) {
    try {
      data[table] = await store.all(`SELECT * FROM ${table}`);
    } catch {
      data[table] = [];
    }
  }

  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: '0.1.0',
    tables: data,
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`[db:export] Exported ${Object.values(data).reduce((s, r) => s + r.length, 0)} rows to ${outputFile}`);
}

async function cmdImport(store: ReturnType<StorageBackendRegistry['getStructuredStore']>): Promise<void> {
  const inputFile = parseFlag('--input');
  if (!inputFile) {
    console.error('[db:import] Error: --input <file> is required');
    process.exit(1);
  }

  const raw = readFileSync(resolve(inputFile), 'utf-8');
  const snapshot = JSON.parse(raw) as { tables: Record<string, unknown[]> };

  if (!snapshot.tables) {
    console.error('[db:import] Error: invalid backup file format (missing "tables" key)');
    process.exit(1);
  }

  for (const table of EXPORT_TABLES) {
    const rows = snapshot.tables[table] ?? [];
    if (rows.length === 0) continue;

    const sample = rows[0] as Record<string, unknown>;
    const cols = Object.keys(sample);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

    let count = 0;
    for (const row of rows as Record<string, unknown>[]) {
      try {
        await store.run(sql, cols.map((c) => row[c] ?? null));
        count++;
      } catch (e) {
        console.warn(`  skip row in ${table}: ${(e as Error).message}`);
      }
    }
    console.log(`  imported ${count}/${rows.length} rows into ${table}`);
  }
  console.log('[db:import] Done.');
}

// ─── 入口 ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!cmd || !['reset', 'export', 'import'].includes(cmd)) {
    console.error('Usage: db.ts <reset|export|import> [--output <file>] [--input <file>]');
    process.exit(1);
  }

  const dataDir = resolveDataRoot(process.env.RISK_AGENT_DATA_DIR);
  const paths = resolvePaths(dataDir);

  console.log(`[db:${cmd}] data dir: ${paths.dataRoot}`);

  const registry = await StorageBackendRegistry.bootstrap(dataDir);
  const store = registry.getStructuredStore();

  try {
    if (cmd === 'reset')  await cmdReset(store);
    if (cmd === 'export') await cmdExport(store);
    if (cmd === 'import') await cmdImport(store);
  } finally {
    await registry.close();
  }
}

main().catch((e) => {
  console.error('[db CLI] Fatal:', e);
  process.exit(1);
});
