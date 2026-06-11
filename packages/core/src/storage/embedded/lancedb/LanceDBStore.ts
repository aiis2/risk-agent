import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  IVectorStore,
  VectorRecord,
  VectorSearchHit
} from '../../interfaces/IVectorStore.js';

/**
 * Lightweight embedded vector store (MVP).
 *
 * 真 LanceDB 在 Windows 上需要预编译二进制，首版用 JSON 文件 + 余弦相似度实现同样的接口，
 * 等未来加入 `@lancedb/lancedb` 后仅需替换本实现。
 */
export class LanceDBStore implements IVectorStore {
  private readonly data = new Map<string, VectorRecord[]>();

  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
  }

  async close(): Promise<void> {
    for (const coll of this.data.keys()) {
      await this.persist(coll);
    }
  }

  private filePath(collection: string): string {
    return join(this.rootDir, `${collection}.json`);
  }

  private load(collection: string): VectorRecord[] {
    if (this.data.has(collection)) return this.data.get(collection)!;
    const p = this.filePath(collection);
    let list: VectorRecord[] = [];
    if (existsSync(p)) {
      try {
        list = JSON.parse(readFileSync(p, 'utf-8')) as VectorRecord[];
      } catch {
        list = [];
      }
    }
    this.data.set(collection, list);
    return list;
  }

  async persist(collection: string): Promise<void> {
    const list = this.data.get(collection) ?? [];
    mkdirSync(dirname(this.filePath(collection)), { recursive: true });
    writeFileSync(this.filePath(collection), JSON.stringify(list, null, 2), 'utf-8');
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    const list = this.load(collection);
    for (const r of records) {
      const idx = list.findIndex((x) => x.id === r.id);
      if (idx >= 0) list[idx] = r;
      else list.push(r);
    }
    await this.persist(collection);
  }

  async query(collection: string, vector: number[], topK = 10): Promise<VectorSearchHit[]> {
    const list = this.load(collection);
    const hits = list.map((r) => ({
      id: r.id,
      score: cosineSimilarity(r.vector, vector),
      metadata: r.metadata,
      text: r.text
    }));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    const list = this.load(collection);
    const set = new Set(ids);
    this.data.set(collection, list.filter((r) => !set.has(r.id)));
    await this.persist(collection);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let la = 0;
  let lb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    la += av * av;
    lb += bv * bv;
  }
  if (la === 0 || lb === 0) return 0;
  return dot / (Math.sqrt(la) * Math.sqrt(lb));
}
