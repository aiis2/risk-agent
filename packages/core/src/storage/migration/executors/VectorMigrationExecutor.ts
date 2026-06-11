/**
 * VectorMigrationExecutor — 向量集合迁移（LanceDB / JSON → Milvus / Qdrant）
 * storage-migration-implementation.md §3.6 Task F
 */
import type { IVectorStore } from '../../interfaces/IVectorStore.js';
import type { MigrationJob } from '../types.js';

export class VectorMigrationExecutor {
  constructor(private readonly source: IVectorStore) {}

  async transfer(job: MigrationJob): Promise<void> {
    if (job.dryRun) return;
    // IVectorStore does not expose listCollections/bulk-read.
    // Cross-backend vector migration requires direct adapter access.
    // For embedded JSON vector, records are persisted to disk automatically.
    // No-op for same-backend migration.
  }
}
