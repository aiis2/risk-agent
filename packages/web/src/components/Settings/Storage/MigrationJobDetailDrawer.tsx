/**
 * MigrationJobDetailDrawer — 迁移任务详情面板
 * settings-center-frontend-mapping.md §5.5
 * 展示 per-scope step、warnings、failure detail、progress
 */
import { useQuery } from '@tanstack/react-query';
import {
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconBan,
  IconClock,
  IconX,
  IconTransfer,
  IconThumbUp,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui';
import { storageSettingsApi, type StorageMigrationJob, type MigrationCheckpointStep } from '../../../api/storageSettings';
import { formatDateTime, formatRelativeTime } from '../../../i18n/formatters';

// ─── 辅助 ─────────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: StorageMigrationJob['status'] }) {
  switch (status) {
    case 'running':   return <IconLoader2 size={13} className="animate-spin text-accent" />;
    case 'completed': return <IconCircleCheck size={13} className="text-success" />;
    case 'failed':    return <IconAlertTriangle size={13} className="text-danger" />;
    case 'cancelled': return <IconBan size={13} className="text-text-muted" />;
    default:          return <IconClock size={13} className="text-warn" />;
  }
}

const STATUS_LABELS: Record<string, string> = {
  queued: '等待中', running: '运行中', completed: '完成', failed: '失败', cancelled: '已取消'
};

const STATUS_COLORS: Record<string, string> = {
  running:   'text-accent bg-accent/10 border-accent/20',
  completed: 'text-success bg-success/10 border-success/20',
  failed:    'text-danger bg-danger/10 border-danger/20',
  cancelled: 'text-text-muted bg-surface-soft border-border',
  queued:    'text-warn bg-warn/10 border-warn/20',
};

// ─── 迷你信息行 ───────────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start gap-2 py-1.5 border-b border-border-subtle last:border-0">
      <span className="text-[10px] text-text-muted uppercase tracking-wide font-medium">{label}</span>
      <div className="text-xs text-text">{children}</div>
    </div>
  );
}

// ─── Checkpoint 步骤图标 ───────────────────────────────────────────────────────

function CheckpointStepIcon({ status }: { status: MigrationCheckpointStep['status'] }) {
  switch (status) {
    case 'running':  return <IconLoader2 size={12} className="animate-spin text-accent" />;
    case 'passed':   return <IconCircleCheck size={12} className="text-success" />;
    case 'failed':   return <IconAlertTriangle size={12} className="text-danger" />;
    case 'skipped':  return <IconBan size={12} className="text-text-muted" />;
    default:         return <IconClock size={12} className="text-text-muted" />;
  }
}

const CHECKPOINT_STATUS_COLOR: Record<string, string> = {
  running:  'text-accent',
  passed:   'text-success',
  failed:   'text-danger',
  skipped:  'text-text-muted',
  pending:  'text-text-muted',
};

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface Props {
  jobId: string | null;
  onClose: () => void;
}

export function MigrationJobDetailDrawer({ jobId, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['storage-migration-job', jobId],
    queryFn: () => storageSettingsApi.getMigrationJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data as StorageMigrationJob | undefined;
      return job?.status === 'running' ? 2_000 : false;
    },
  });

  const job = data as (StorageMigrationJob & { result?: unknown }) | undefined;

  const { data: checkpointsData } = useQuery({
    queryKey: ['storage-migration-checkpoints', jobId],
    queryFn: () => storageSettingsApi.getJobCheckpoints(jobId!),
    enabled: !!jobId,
    refetchInterval: () => (job?.status === 'running' ? 2_000 : false),
  });

  return (
    <Dialog open={!!jobId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <div className="p-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconTransfer size={16} className="text-accent" />
              <div>
                <DialogTitle className="text-sm font-semibold text-text">迁移任务详情</DialogTitle>
                <DialogDescription className="mt-0.5 text-[11px] text-text-muted">
                  查看迁移进度、分 scope 检查点和失败详情。
                </DialogDescription>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-surface-soft text-text-muted hover:text-text-dim transition-colors"
              aria-label="关闭"
            >
              <IconX size={14} />
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1,2,3,4].map((i) => (
                <div key={i} className="h-6 rounded bg-border-subtle" />
              ))}
            </div>
          ) : !job ? (
            <p className="text-sm text-text-muted py-4 text-center">无法加载任务详情</p>
          ) : (
            <div className="space-y-4">
              {/* Status badge */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusIcon status={job.status} />
                <span className={clsx(
                  'text-xs font-medium px-2 py-0.5 rounded-full border',
                  STATUS_COLORS[job.status] ?? STATUS_COLORS['queued']
                )}>
                  {STATUS_LABELS[job.status] ?? job.status}
                </span>
                {job.dryRun && (
                  <span className="text-[10px] text-text-muted bg-surface-soft border border-border px-1.5 rounded">dry-run</span>
                )}
                {/* recommended indicator (storage-migration-strategy.md §9) */}
                {job.dryRun && (job.result as any)?.recommended === true && (
                  <span className="flex items-center gap-1 text-[10px] text-success bg-success/10 border border-success/20 px-1.5 rounded">
                    <IconThumbUp size={9} />
                    建议执行
                  </span>
                )}
              </div>

              {/* summary (storage-settings-api.md §8.4) */}
              {job.summary && (
                <div className="text-xs text-text-muted italic border-l-2 border-border pl-3">
                  {job.summary}
                </div>
              )}

              {/* Progress bar */}
              {job.status === 'running' && (
                <div>
                  <div className="flex justify-between text-[10px] text-text-muted mb-1">
                    <span>进度</span>
                    <span>{job.progress}%</span>
                  </div>
                  <div className="h-2 bg-border-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Info rows */}
              <div className="bg-surface border border-border-subtle rounded-lg px-3">
                <InfoRow label="Job ID">
                  <span className="font-mono text-text-dim break-all">{job.jobId}</span>
                </InfoRow>
                <InfoRow label="Scopes">
                  <div className="flex flex-wrap gap-1">
                    {job.scopes.length > 0 ? job.scopes.map((s) => (
                      <span key={s} className="text-[10px] bg-surface-soft border border-border text-text-dim px-1.5 py-0.5 rounded">{s}</span>
                    )) : <span className="text-text-muted">—</span>}
                  </div>
                </InfoRow>
                <InfoRow label="创建时间">
                  {formatDateTime(job.createdAt)} · {formatRelativeTime(job.createdAt)}
                </InfoRow>
                {job.startedAt && (
                  <InfoRow label="开始时间">{formatDateTime(job.startedAt)}</InfoRow>
                )}
                {job.finishedAt && (
                  <InfoRow label="完成时间">{formatDateTime(job.finishedAt)}</InfoRow>
                )}
                {job.sourceRevisionId && (
                  <InfoRow label="来源 Revision">
                    <span className="font-mono text-text-dim break-all">{job.sourceRevisionId}</span>
                  </InfoRow>
                )}
                {job.targetRevisionId && (
                  <InfoRow label="目标 Revision">
                    <span className="font-mono text-text-dim break-all">{job.targetRevisionId}</span>
                  </InfoRow>
                )}
              </div>

              {/* Error message */}
              {job.errorMessage && (
                <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                    <IconAlertTriangle size={12} />
                    失败原因
                  </div>
                  <p className="text-xs text-danger font-mono break-all">{job.errorMessage}</p>
                  <p className="text-[10px] text-text-muted">
                    迁移任务失败：请改用「回滚 + 重启」方案恢复，或检查目标存储连接后重试。
                  </p>
                </div>
              )}

              {/* Result JSON */}
              {job.result !== undefined && job.result !== null && (
                <div>
                  <span className="text-[10px] text-text-muted uppercase tracking-wide font-medium">执行结果</span>
                  <pre className="mt-1.5 text-[10px] font-mono bg-surface-sidebar border border-border-subtle rounded-lg px-3 py-2.5 text-text-dim overflow-auto max-h-40">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </div>
              )}

              {/* Checkpoint timeline */}
              {checkpointsData && checkpointsData.checkpoints.length > 0 && (
                <div>
                  <span className="text-[10px] text-text-muted uppercase tracking-wide font-medium">执行步骤</span>
                  <div className="mt-2 space-y-0 bg-surface border border-border-subtle rounded-lg overflow-hidden">
                    {checkpointsData.checkpoints.map((cp, i) => (
                      <div
                        key={cp.step}
                        className={clsx(
                          'flex items-start gap-2.5 px-3 py-2 border-b border-border-subtle last:border-0',
                          cp.status === 'running' && 'bg-accent/5',
                          cp.status === 'failed' && 'bg-danger/5',
                        )}
                      >
                        {/* Step number */}
                        <span className="mt-0.5 text-[9px] text-text-muted font-mono w-4 shrink-0 text-right">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {/* Status icon */}
                        <span className="mt-0.5 shrink-0">
                          <CheckpointStepIcon status={cp.status} />
                        </span>
                        {/* Step info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={clsx(
                              'text-[11px] font-medium',
                              CHECKPOINT_STATUS_COLOR[cp.status] ?? 'text-text-dim'
                            )}>
                              {cp.step}
                            </span>
                            <span className="text-[9px] text-text-muted shrink-0">
                              {new Date(cp.updatedAt).toLocaleTimeString()}
                            </span>
                          </div>
                          {cp.detail && (
                            <p className="mt-0.5 text-[10px] text-text-muted break-all">{cp.detail}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
