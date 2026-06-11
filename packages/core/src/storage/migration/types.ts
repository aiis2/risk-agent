/**
 * 迁移基础类型定义
 * storage-migration-implementation.md §3.1 Task A
 */

// ─── 枚举与字面量 ──────────────────────────────────────────────────────────────

export type MigrationScope    = 'structured' | 'vector' | 'graph' | 'object';
export type MigrationMode     = 'dry-run' | 'execute';
export type MigrationStrategy = 'copy' | 'copy-and-verify' | 'snapshot-restore';
export type MigrationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type CheckpointStatus  = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

// ─── 迁移计划 ─────────────────────────────────────────────────────────────────

export interface MigrationPlan {
  planId: string;
  sourceRevisionId: string | null;
  targetRevisionId: string | null;
  scopes: MigrationScope[];
  mode: MigrationMode;
  strategy: MigrationStrategy;
  dryRun: boolean;
  estimatedRecords: Record<MigrationScope, number>;
  warnings: string[];
  /** dry-run 模式下是否建议执行 execute */
  recommended: boolean;
  checkpoints: MigrationCheckpoint[];
  createdAt: string;
}

// ─── 迁移作业 ─────────────────────────────────────────────────────────────────

export interface MigrationJob {
  jobId: string;
  planId: string | null;
  sourceRevisionId: string | null;
  targetRevisionId: string | null;
  scopes: MigrationScope[];
  mode: MigrationMode;
  strategy: MigrationStrategy;
  dryRun: boolean;
  status: MigrationJobStatus;
  progress: number;
  currentScope: MigrationScope | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

export interface MigrationCheckpoint {
  jobId: string;
  step: string;
  status: CheckpointStatus;
  detail: string | null;
  updatedAt: string;
}

// ─── 清单 ─────────────────────────────────────────────────────────────────────

export interface MigrationManifest {
  scopeId: MigrationScope;
  recordCount: number;
  sizeBytes: number;
  tables?: string[];
  collections?: string[];
  objectKeys?: string[];
}

// ─── 请求 DTO ─────────────────────────────────────────────────────────────────

export interface CreateMigrationJobRequest {
  sourceRevisionId?: string | null;
  targetRevisionId?: string | null;
  scopes: MigrationScope[];
  mode: MigrationMode;
  strategy: MigrationStrategy;
  dryRun: boolean;
  comment?: string;
}
