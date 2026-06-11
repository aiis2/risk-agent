/**
 * MigrationCheckpointStore — 将迁移步骤状态持久化到 SQLite
 * storage-migration-implementation.md §3.3 Task C
 */
import type { IStructuredStore } from '../interfaces/IStructuredStore.js';
import type { MigrationCheckpoint, CheckpointStatus } from './types.js';

export class MigrationCheckpointStore {
  constructor(private readonly db: IStructuredStore) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_checkpoints (
        job_id     TEXT NOT NULL,
        step       TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'pending',
        detail     TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (job_id, step)
      )
    `);
  }

  async mark(
    jobId: string,
    step: string,
    status: CheckpointStatus,
    detail?: string
  ): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO migration_checkpoints(job_id, step, status, detail, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [jobId, step, status, detail ?? null]
    );
  }

  async getCheckpoints(jobId: string): Promise<MigrationCheckpoint[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM migration_checkpoints WHERE job_id = ? ORDER BY updated_at`,
      [jobId]
    );
    return rows.map((r) => ({
      jobId:     r['job_id'] as string,
      step:      r['step'] as string,
      status:    r['status'] as CheckpointStatus,
      detail:    r['detail'] as string | null,
      updatedAt: r['updated_at'] as string,
    }));
  }

  async clearJob(jobId: string): Promise<void> {
    await this.db.run(`DELETE FROM migration_checkpoints WHERE job_id = ?`, [jobId]);
  }
}
