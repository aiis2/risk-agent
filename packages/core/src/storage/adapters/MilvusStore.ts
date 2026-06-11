/**
 * MilvusStore — Milvus 向量库适配器。
 * packages/core/src/storage/adapters/MilvusStore.ts
 *
 * 依赖 `@zilliz/milvus2-sdk-node`（按需安装）。
 * 当 storage.json 中 vector.backend === 'milvus' 时由 registry.ts 加载。
 */
import type { IVectorStore, VectorRecord, VectorSearchHit } from '../interfaces/IVectorStore.js';

export interface MilvusStoreConfig {
  url: string;
  username?: string;
  password?: string;
  dim?: number;
}

export class MilvusStore implements IVectorStore {
  private client: any = null;
  private readonly dim: number;

  constructor(private readonly config: MilvusStoreConfig) {
    this.dim = config.dim ?? 1536;
  }

  async init(): Promise<void> {
    let sdk: any;
    try {
      // @ts-ignore — optional peer dep, install when using milvus backend
      sdk = await import('@zilliz/milvus2-sdk-node');
    } catch {
      throw new Error(
        'MilvusStore: package not installed. Run: pnpm add -w @zilliz/milvus2-sdk-node',
      );
    }
    const { MilvusClient } = sdk.default ?? sdk;
    this.client = new MilvusClient({
      address: this.config.url,
      username: this.config.username,
      password: this.config.password,
    });
  }

  async close(): Promise<void> {
    await this.client?.closeConnection?.();
    this.client = null;
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    await this._ensureCollection(collection);
    await this.client.upsert({
      collection_name: collection,
      data: records.map((r) => ({
        id: r.id,
        vector: r.vector,
        text: r.text ?? '',
        metadata: JSON.stringify(r.metadata ?? {}),
      })),
    });
  }

  async query(collection: string, vector: number[], topK = 10): Promise<VectorSearchHit[]> {
    await this._ensureCollection(collection);
    const res = await this.client.search({
      collection_name: collection,
      data: [vector],
      limit: topK,
      output_fields: ['id', 'text', 'metadata'],
    });
    return (res.results ?? []).map((r: any) => ({
      id: String(r.id),
      score: r.score ?? 0,
      text: r.text,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  async delete(collection: string, ids: string[]): Promise<void> {
    await this.client.delete({
      collection_name: collection,
      ids,
    });
  }

  private async _ensureCollection(name: string): Promise<void> {
    const exists = await this.client.hasCollection({ collection_name: name });
    if (!exists.value) {
      await this.client.createCollection({
        collection_name: name,
        fields: [
          { name: 'id', data_type: 'VarChar', is_primary_key: true, max_length: 256 },
          { name: 'vector', data_type: 'FloatVector', dim: this.dim },
          { name: 'text', data_type: 'VarChar', max_length: 4096 },
          { name: 'metadata', data_type: 'VarChar', max_length: 4096 },
        ],
      });
      await this.client.createIndex({
        collection_name: name,
        field_name: 'vector',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 },
      });
      await this.client.loadCollection({ collection_name: name });
    }
  }
}
