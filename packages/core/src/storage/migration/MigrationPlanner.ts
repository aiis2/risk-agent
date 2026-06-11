/**
 * MigrationPlanner — 组装迁移计划与 dry-run 输出
 * storage-migration-implementation.md §3.2 Task B
 */
import { randomUUID } from 'node:crypto';
import type {
  MigrationPlan,
  MigrationScope,
  MigrationCheckpoint,
  CreateMigrationJobRequest,
} from './types.js';
import type { MigrationManifestBuilder } from './MigrationManifestBuilder.js';

export class MigrationPlanner {
  constructor(private readonly manifestBuilder: MigrationManifestBuilder) {}

  async plan(input: CreateMigrationJobRequest): Promise<MigrationPlan> {
    const warnings = this.buildPreflightWarnings(input);

    const estimatedRecords: Partial<Record<MigrationScope, number>> = {};
    for (const scope of input.scopes) {
      const manifest = await this.manifestBuilder.buildForScope(scope);
      estimatedRecords[scope] = manifest.recordCount;
    }

    // Ensure all scopes have a value
    const allScopes: MigrationScope[] = ['structured', 'vector', 'graph', 'object'];
    for (const s of allScopes) {
      if (estimatedRecords[s] === undefined) estimatedRecords[s] = 0;
    }

    const planId = `plan_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const checkpoints = this.buildInitialCheckpoints(input.scopes);
    // recommended: dry-run passes without critical warnings
    const recommended = warnings.filter((w) => !w.startsWith('当前为 dry-run')).length === 0;

    return {
      planId,
      sourceRevisionId: input.sourceRevisionId ?? null,
      targetRevisionId: input.targetRevisionId ?? null,
      scopes: input.scopes,
      mode: input.mode,
      strategy: input.strategy,
      dryRun: input.dryRun,
      estimatedRecords: estimatedRecords as Record<MigrationScope, number>,
      warnings,
      recommended,
      checkpoints,
      createdAt: new Date().toISOString(),
    };
  }

  private buildPreflightWarnings(input: CreateMigrationJobRequest): string[] {
    const w: string[] = [];
    if (input.dryRun) {
      w.push('当前为 dry-run 模式，不会实际迁移任何数据。');
    }
    if (!input.dryRun &&
        input.scopes.includes('structured') &&
        input.scopes.includes('object')) {
      w.push('structured + object 同时切换影响范围广，建议先执行 dry-run。');
    }
    if (!input.dryRun && input.strategy === 'snapshot-restore') {
      w.push('snapshot-restore 策略失败时会尝试回滚，请确保目标存储磁盘空间充足。');
    }
    if (!input.sourceRevisionId) {
      w.push('未指定 source revision，将使用当前激活配置作为来源。');
    }
    if (!input.targetRevisionId) {
      w.push('未指定 target revision，将使用当前激活配置作为目标（仅校验场景有效）。');
    }
    return w;
  }

  private buildInitialCheckpoints(scopes: MigrationScope[]): MigrationCheckpoint[] {
    const now = new Date().toISOString();
    const steps = [
      'preflight',
      'snapshot',
      ...scopes.flatMap((s) => [`${s}:transfer`, `${s}:verify`]),
    ];
    return steps.map((step) => ({
      jobId: '',
      step,
      status: 'pending',
      detail: null,
      updatedAt: now,
    }));
  }
}
