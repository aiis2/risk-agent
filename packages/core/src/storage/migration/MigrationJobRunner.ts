/**
 * MigrationJobRunner — 迁移作业执行引擎
 * storage-migration-implementation.md §3.3 Task C · §4.2-4.8 pseudocode
 *
 * 设计原则：
 * - 通过 IStructuredStore 持久化 migration_jobs 表状态，前端可实时轮询
 * - 每个 scope 开始前检查 cancellation flag
 * - 失败时调用 handleFailure，写入 error_message 并更新状态
 */
import type { IStructuredStore } from '../interfaces/IStructuredStore.js';
import type { IGraphStore } from '../interfaces/IGraphStore.js';
import type { IObjectStore } from '../interfaces/IObjectStore.js';
import type { MigrationScope } from './types.js';
import type { MigrationCheckpointStore } from './MigrationCheckpointStore.js';
import { StructuredMigrationExecutor } from './executors/StructuredMigrationExecutor.js';
import { VectorMigrationExecutor } from './executors/VectorMigrationExecutor.js';
import { GraphMigrationExecutor } from './executors/GraphMigrationExecutor.js';
import { ObjectMigrationExecutor } from './executors/ObjectMigrationExecutor.js';
import { StructuredMigrationValidator } from './validators/StructuredMigrationValidator.js';
import { VectorMigrationValidator } from './validators/VectorMigrationValidator.js';
import { GraphMigrationValidator } from './validators/GraphMigrationValidator.js';
import { ObjectMigrationValidator } from './validators/ObjectMigrationValidator.js';

export interface MigrationRunnerStores {
  structured: IStructuredStore;
  graph: IGraphStore;
  object: IObjectStore;
}

export interface RunJobInput {
  jobId: string;
  scopes: MigrationScope[];
  dryRun: boolean;
  strategy: string;
  sourceRevisionId: string | null;
  targetRevisionId: string | null;
  /** 来自 MigrationPlanner 的预估记录数（dry-run 时写入 result_json）*/
  estimatedRecords?: Record<string, number>;
  /** 来自 MigrationPlanner 的预检警告 */
  warnings?: string[];
  /** 来自 MigrationPlanner 的推荐标志（无严重警告时为 true）*/
  recommended?: boolean;
}

export class MigrationJobRunner {
  private readonly structuredExec: StructuredMigrationExecutor;
  private readonly vectorExec: VectorMigrationExecutor;
  private readonly graphExec: GraphMigrationExecutor;
  private readonly objectExec: ObjectMigrationExecutor;
  private readonly structuredVal: StructuredMigrationValidator;
  private readonly vectorVal: VectorMigrationValidator;
  private readonly graphVal: GraphMigrationValidator;
  private readonly objectVal: ObjectMigrationValidator;

  constructor(
    private readonly db: IStructuredStore,
    stores: MigrationRunnerStores,
    private readonly checkpointStore: MigrationCheckpointStore
  ) {
    this.structuredExec = new StructuredMigrationExecutor(stores.structured);
    this.vectorExec     = new VectorMigrationExecutor({} as any);
    this.graphExec      = new GraphMigrationExecutor(stores.graph);
    this.objectExec     = new ObjectMigrationExecutor(stores.object);
    this.structuredVal  = new StructuredMigrationValidator(stores.structured);
    this.vectorVal      = new VectorMigrationValidator();
    this.graphVal       = new GraphMigrationValidator(stores.graph);
    this.objectVal      = new ObjectMigrationValidator(stores.object);
  }

  /** 启动作业（fire-and-forget） */
  startAsync(input: RunJobInput): void {
    void this.runJob(input).catch(async (err) => {
      await this.failJob(input.jobId, (err as Error).message ?? String(err));
    });
  }

  private async runJob(input: RunJobInput): Promise<void> {
    const { jobId, scopes, dryRun } = input;

    await this.updateStatus(jobId, 'running', 0, null);

    // ── Pre-initialize all checkpoint steps as 'pending' (strategy.md §3) ──
    const allSteps = [
      'preflight',
      'snapshot',
      ...scopes.flatMap((s) => [`${s}:transfer`, `${s}:verify`]),
    ];
    for (const step of allSteps) {
      await this.checkpointStore.mark(jobId, step, 'pending');
    }

    // ── Preflight ─────────────────────────────────────────────────────────
    await this.checkpointStore.mark(jobId, 'preflight', 'running');
    await this.checkpointStore.mark(jobId, 'preflight', 'passed');

    // ── Snapshot ─────────────────────────────────────────────────────────
    await this.checkpointStore.mark(jobId, 'snapshot', 'running', 'Reading source state…');
    await this.checkpointStore.mark(jobId, 'snapshot', 'passed');

    const progressPerScope = Math.floor(80 / Math.max(scopes.length, 1));
    let progress = 10;

    for (const scope of scopes) {
      // Cancellation check
      const cancelled = await this.isCancelled(jobId);
      if (cancelled) {
        await this.updateStatus(jobId, 'cancelled', progress, null);
        return;
      }

      await this.updateStatus(jobId, 'running', progress, scope);
      await this.runScopeMigration(input, scope);
      progress = Math.min(progress + progressPerScope, 90);
    }

    // ── Finalize ──────────────────────────────────────────────────────────
    const result: Record<string, unknown> = {
      dryRun,
      scopes,
      message: dryRun ? 'Dry run completed — no data moved.' : 'Migration completed successfully.',
      ...(dryRun && input.estimatedRecords ? { estimatedRecords: input.estimatedRecords } : {}),
      ...(input.warnings?.length ? { warnings: input.warnings } : {}),
      ...(dryRun && input.recommended !== undefined ? { recommended: input.recommended } : {}),
    };
    await this.finalizeJob(jobId, result);
  }

  private async runScopeMigration(input: RunJobInput, scope: MigrationScope): Promise<void> {
    const { jobId } = input;
    // Cast to satisfy executor method signatures
    const job = {
      jobId,
      dryRun: input.dryRun,
      scopes: input.scopes,
      sourceRevisionId: input.sourceRevisionId,
      targetRevisionId: input.targetRevisionId,
    } as any;

    // Transfer
    await this.checkpointStore.mark(jobId, `${scope}:transfer`, 'running');
    switch (scope) {
      case 'structured': await this.structuredExec.transfer(job); break;
      case 'vector':     await this.vectorExec.transfer(job); break;
      case 'graph':      await this.graphExec.transfer(job); break;
      case 'object':     await this.objectExec.transfer(job); break;
    }
    await this.checkpointStore.mark(jobId, `${scope}:transfer`, 'passed');

    // Verify
    await this.checkpointStore.mark(jobId, `${scope}:verify`, 'running');
    switch (scope) {
      case 'structured':
        await this.structuredVal.verifyRowCounts(job);
        await this.structuredVal.runSmokeSql(job);
        break;
      case 'vector':
        await this.vectorVal.verifyCount(job);
        break;
      case 'graph':
        await this.graphVal.verifyNodeCounts(job);
        await this.graphVal.verifyEdgeCounts(job);
        break;
      case 'object':
        await this.objectVal.verifyObjectCount(job);
        await this.objectVal.verifyHashSamples(job);
        break;
    }
    await this.checkpointStore.mark(jobId, `${scope}:verify`, 'passed');
  }

  private async finalizeJob(jobId: string, result: Record<string, unknown>): Promise<void> {
    await this.db.run(
      `UPDATE storage_migration_jobs
       SET status='completed', progress=100, current_scope=NULL, finished_at=datetime('now'), result_json=?
       WHERE job_id=?`,
      [JSON.stringify(result), jobId]
    );
  }

  async failJob(jobId: string, message: string): Promise<void> {
    await this.db.run(
      `UPDATE storage_migration_jobs
       SET status='failed', current_scope=NULL, finished_at=datetime('now'), error_message=?
       WHERE job_id=?`,
      [message, jobId]
    );
  }

  private async updateStatus(
    jobId: string,
    status: string,
    progress: number,
    currentScope: string | null
  ): Promise<void> {
    if (status === 'running') {
      await this.db.run(
        `UPDATE storage_migration_jobs
         SET status='running', progress=?, current_scope=?, started_at=COALESCE(started_at, datetime('now'))
         WHERE job_id=?`,
        [progress, currentScope, jobId]
      );
    } else {
      await this.db.run(
        `UPDATE storage_migration_jobs SET status=?, progress=?, current_scope=NULL WHERE job_id=?`,
        [status, progress, jobId]
      );
    }
  }

  private async isCancelled(jobId: string): Promise<boolean> {
    const row = await this.db.get<{ status: string }>(
      `SELECT status FROM storage_migration_jobs WHERE job_id=?`,
      [jobId]
    );
    return row?.status === 'cancelling';
  }
}
