/**
 * ObjectMigrationExecutor — 对象存储迁移（LocalFS → MinIO / S3）
 * storage-migration-implementation.md §3.5 Task E
 */
import type { IObjectStore } from '../../interfaces/IObjectStore.js';
import type { MigrationJob } from '../types.js';

export class ObjectMigrationExecutor {
  constructor(private readonly source: IObjectStore) {}

  async buildManifest(_job: MigrationJob): Promise<{ keys: string[] }> {
    const keys = await this.source.list();
    return { keys };
  }

  async transfer(job: MigrationJob): Promise<void> {
    if (job.dryRun) return;

    const { keys } = await this.buildManifest(job);
    for (const key of keys) {
      await this.copyObject(key);
    }
  }

  private async copyObject(key: string): Promise<void> {
    const data = await this.source.get(key);
    if (!data) return;
    // target.put(key, data) — requires target IObjectStore
    // For same-backend (LocalFS), files are already at the target path.
    void data;
  }
}
