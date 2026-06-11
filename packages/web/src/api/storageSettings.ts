/**
 * 存储设置 API Client（settings-center-frontend-mapping.md §3）
 * 覆盖：getCurrent / getHistory / validate / apply / rollback / migrate / listMigrationJobs / getMigrationJob
 */
import { api } from './client';

// ─── 数据类型 ────────────────────────────────────────────────────────────────

export type StorageProfile = 'embedded' | 'hybrid' | 'full-external' | 'custom';

export interface ActiveStorageState {
  activeRevisionId: string;
  activeProfile: StorageProfile;
  status: 'ready' | 'validating' | 'applying' | 'rolling-back' | 'migrating' | 'error';
  backendInfo: {
    structured: string;
    vector: string;
    graph: string;
    object: string;
  };
  restartRequired: boolean;
  /** 最近一次验证的时间（可能为 null）*/
  lastValidatedAt?: string | null;
  config?: Record<string, unknown>;
}

export interface StorageConfigRevision {
  revisionId: string;
  profile: StorageProfile;
  configHash: string;
  isActive: boolean;
  source: 'ui' | 'api' | 'file-sync';
  createdBy: string;
  comment?: string;
  createdAt: string;
}

export interface StorageMigrationJob {
  jobId: string;
  sourceRevisionId?: string;
  targetRevisionId?: string;
  scopes: Array<'structured' | 'vector' | 'graph' | 'object'>;
  dryRun: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  /** 当前正在处理的 scope（仅 running 状态有值）*/
  currentScope?: string | null;  /** 人可读的状态摘要 */
  summary?: string | null;  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface MigrationCheckpointStep {
  jobId: string;
  step: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  detail?: string;
  updatedAt: string;
}

export interface ValidateStorageConfigResponse {
  validationId: string;
  normalizedProfile: StorageProfile;
  backendInfo: Record<string, string>;
  health: Record<string, 'ok' | 'error'>;
  warnings: string[];
  redactedConfig: Record<string, unknown>;
  applyReady: boolean;
}

export interface ApplyStorageConfigResponse {
  accepted: boolean;
  applyId: string;
  newRevisionId: string;
  activeProfile: StorageProfile;
  restartRequired: boolean;
  migrationJobId?: string;
  message: string;
}

// ─── API 方法 ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(res: any): any {
  return res.data.data;
}

export const storageSettingsApi = {
  /** 获取当前激活存储状态 */
  getCurrent: (): Promise<ActiveStorageState> =>
    api.get('/settings/storage/current').then(unwrap),

  /** 获取配置修订历史 */
  getHistory: (limit = 20): Promise<{ revisions: StorageConfigRevision[]; rollbackCandidates: Array<{ revisionId: string; createdAt: string; profile: string }> }> =>
    api.get(`/settings/storage/history?limit=${limit}`).then(unwrap),

  /** 校验候选配置 */
  validate: (payload: {
    config: Record<string, unknown>;
    profile?: string;
    validateConnectivity?: boolean;
  }): Promise<ValidateStorageConfigResponse> =>
    api.post('/settings/storage/validate', payload).then(unwrap),

  /** 应用新配置（创建 revision + 保存文件）*/
  apply: (payload: {
    config: Record<string, unknown>;
    profile?: string;
    validationId?: string;
    applyMode?: 'restart-required' | 'hot-swap';
    migratePolicy?: 'none' | 'metadata-only' | 'full';
    comment?: string;
  }): Promise<ApplyStorageConfigResponse> =>
    api.post('/settings/storage/apply', payload).then(unwrap),

  /** 回滚到指定 revision */
  rollback: (revisionId: string, reason?: string): Promise<{ rolledBack: boolean; activeRevisionId: string; activeProfile: string; restoredFromRevisionId: string; restartRequired: boolean; message: string }> =>
    api.post('/settings/storage/rollback', { revisionId, reason }).then(unwrap),

  /** 创建迁移任务 */
  migrate: (payload: {
    sourceRevisionId?: string;
    targetRevisionId?: string;
    scopes?: Array<'structured' | 'vector' | 'graph' | 'object'>;
    dryRun?: boolean;
    strategy?: 'copy' | 'copy-and-verify' | 'snapshot-restore';
    comment?: string;
  }): Promise<{ jobId: string; status: string }> =>
    api.post('/settings/storage/migrate', payload).then(unwrap),

  /** 取消迁移任务 */
  cancelMigrationJob: (jobId: string): Promise<{ jobId: string; status: string }> =>
    api.post(`/settings/storage/migrations/${jobId}/cancel`, {}).then(unwrap),

  /** 重试迁移任务 */
  retryMigrationJob: (jobId: string): Promise<{ jobId: string; status: string }> =>
    api.post(`/settings/storage/migrations/${jobId}/retry`, {}).then(unwrap),

  /** 列出迁移任务 */
  listMigrationJobs: (status?: string): Promise<{ jobs: StorageMigrationJob[] }> =>
    api.get(status ? `/settings/storage/migrations?status=${status}` : '/settings/storage/migrations').then(unwrap),

  /** 获取迁移任务详情 */
  getMigrationJob: (jobId: string): Promise<StorageMigrationJob & { result?: unknown }> =>
    api.get(`/settings/storage/migrations/${jobId}`).then(unwrap),

  /** 获取迁移任务的 checkpoint 步骤列表 */
  getJobCheckpoints: (jobId: string): Promise<{ checkpoints: MigrationCheckpointStep[] }> =>
    api.get(`/settings/storage/migrations/${jobId}/checkpoints`).then(unwrap),
};
