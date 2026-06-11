import type {
  IVectorStore,
  VectorRecord,
  VectorSearchHit
} from '../../interfaces/IVectorStore.js';

/**
 * LanceDBNativeStore — 基于 `@lancedb/lancedb` 官方 SDK 的向量库实现。
 *
 * 运行时按需 `import('@lancedb/lancedb')`；若模块未安装或加载失败，会抛出错误并由
 * `createLanceDBStore()` 自动回退到 JSON 版 `LanceDBStore`。
 */
export class LanceDBNativeStore implements IVectorStore {
  private db: any = null;
  private readonly tables = new Map<string, any>();

  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    // 使用运行时动态 import + 字符串拼接规避编译期类型检查（@lancedb/lancedb 为可选 peer）
    const spec = '@lancedb/lancedb';
    const mod: any = await (Function('s', 'return import(s)') as (s: string) => Promise<any>)(spec);
    const connect = mod.connect ?? mod.default?.connect;
    if (typeof connect !== 'function') {
      throw new Error('@lancedb/lancedb: connect() not found');
    }
    this.db = await connect(this.rootDir);
  }

  async close(): Promise<void> {
    this.tables.clear();
    // SDK 无显式 close；依赖 GC
    this.db = null;
  }

  private async ensureTable(collection: string, sampleDim: number): Promise<any> {
    if (!this.db) await this.init();
    const existing = this.tables.get(collection);
    if (existing) return existing;
    const names: string[] = (await this.db.tableNames?.()) ?? [];
    if (names.includes(collection)) {
      const t = await this.db.openTable(collection);
      this.tables.set(collection, t);
      return t;
    }
    // 首次写入时建表：使用首条样本决定维度
    const placeholder = [
      {
        id: `__seed_${collection}`,
        vector: new Array(sampleDim).fill(0),
        metadata: '{}',
        text: ''
      }
    ];
    const t = await this.db.createTable(collection, placeholder);
    try { await t.delete(`id = '__seed_${collection}'`); } catch { /* ignore */ }
    this.tables.set(collection, t);
    return t;
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    if (!records.length) return;
    const dim = records[0]!.vector.length;
    const t = await this.ensureTable(collection, dim);
    const ids = records.map((r) => `'${r.id.replace(/'/g, "''")}'`);
    try { await t.delete(`id IN (${ids.join(',')})`); } catch { /* first-time ok */ }
    await t.add(
      records.map((r) => ({
        id: r.id,
        vector: r.vector,
        metadata: r.metadata ? JSON.stringify(r.metadata) : '{}',
        text: r.text ?? ''
      }))
    );
  }

  async query(collection: string, vector: number[], topK = 10): Promise<VectorSearchHit[]> {
    const t = await this.ensureTable(collection, vector.length);
    const result = await t.search(vector).limit(topK).toArray();
    return result.map((row: any) => ({
      id: row.id,
      score: typeof row._distance === 'number' ? 1 - row._distance : Number(row.score ?? 0),
      metadata: parseJson(row.metadata),
      text: row.text ?? undefined
    }));
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const t = await this.ensureTable(collection, 1);
    const escaped = ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',');
    await t.delete(`id IN (${escaped})`);
  }
}

function parseJson(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
