/**
 * MigrationJobTable — 迁移任务列表（含进度）
 * settings-center-frontend-mapping.md §5.11
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconBan,
  IconClock,
  IconTransfer,
  IconExternalLink,
  IconPlayerStop,
  IconRefresh,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { storageSettingsApi, type StorageMigrationJob } from '../../../api/storageSettings';

function StatusIcon({ status }: { status: StorageMigrationJob['status'] }) {
  switch (status) {
    case 'running':   return <IconLoader2 size={11} className="animate-spin text-accent" />;
    case 'completed': return <IconCircleCheck size={11} className="text-success" />;
    case 'failed':    return <IconAlertTriangle size={11} className="text-danger" />;
    case 'cancelled': return <IconBan size={11} className="text-text-dim" />;
    default:          return <IconClock size={11} className="text-warn" />;
  }
}

function statusLabel(status: StorageMigrationJob['status']) {
  const map: Record<string, string> = {
    queued: '等待中', running: '运行中', completed: '完成', failed: '失败', cancelled: '已取消'
  };
  return map[status] ?? status;
}

function statusColor(status: StorageMigrationJob['status']) {
  switch (status) {
    case 'running':   return 'text-accent';
    case 'completed': return 'text-success';
    case 'failed':    return 'text-danger';
    case 'cancelled': return 'text-text-muted';
    default:          return 'text-warn';
  }
}

function CancelButton({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { mutate, isPending } = useMutation({
    mutationFn: () => storageSettingsApi.cancelMigrationJob(jobId),
    onSuccess: onDone,
  });
  return (
    <button
      type="button"
      onClick={() => mutate()}
      disabled={isPending}
      className="p-1 rounded hover:bg-danger/10 text-text-muted hover:text-danger transition-colors disabled:opacity-40"
      aria-label="取消"
    >
      <IconPlayerStop size={11} />
    </button>
  );
}

function RetryButton({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const { mutate, isPending } = useMutation({
    mutationFn: () => storageSettingsApi.retryMigrationJob(jobId),
    onSuccess: onDone,
  });
  return (
    <button
      type="button"
      onClick={() => mutate()}
      disabled={isPending}
      className="p-1 rounded hover:bg-accent/10 text-text-muted hover:text-accent transition-colors disabled:opacity-40"
      aria-label="重试"
    >
      <IconRefresh size={11} />
    </button>
  );
}

export function MigrationJobTable({ onViewDetail }: { onViewDetail?: (jobId: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['storage-migration-jobs'],
    queryFn: () => storageSettingsApi.listMigrationJobs(),
    refetchInterval: 5_000,
  });

  const jobs = data?.jobs ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <IconTransfer size={12} />
        <span className="uppercase tracking-wide font-medium">迁移任务</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-text-muted py-3">
          <IconLoader2 size={12} className="animate-spin" />
          <span>加载中…</span>
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-xs text-text-muted bg-surface border border-dashed border-border-subtle rounded-lg p-4 text-center">
          暂无迁移任务
        </div>
      ) : (
        <div className="divide-y divide-border-subtle bg-surface border border-border-subtle rounded-lg overflow-hidden">
          {jobs.map((job) => (
            <div key={job.jobId} className="flex items-center gap-3 px-3 py-2.5">
              <StatusIcon status={job.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={clsx('text-xs font-medium', statusColor(job.status))}>
                    {statusLabel(job.status)}
                  </span>
                  {job.dryRun && (
                    <span className="text-[10px] text-text-muted bg-surface-soft border border-border px-1.5 rounded">dry-run</span>
                  )}
                  <span className="text-[10px] text-text-muted font-mono truncate">{job.jobId}</span>
                </div>
                {/* Progress bar */}
                {job.status === 'running' && (
                  <div className="mt-1 h-1 bg-border-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                )}
                <div className="text-[10px] text-text-muted mt-0.5">
                  {new Date(job.createdAt).toLocaleString('zh-CN')}
                  {job.scopes.length > 0 && ` · ${job.scopes.join('/')}`}
                  {job.status === 'running' && job.currentScope && (
                    <span className="ml-1.5 text-accent">scope: {job.currentScope}</span>
                  )}
                </div>
                {/* summary field (storage-settings-api.md §8.4) */}
                {job.summary && (
                  <div className="text-[10px] text-text-muted mt-0.5 italic">{job.summary}</div>
                )}
              </div>
              <span className="text-xs text-text-muted">{job.progress}%</span>
              {/* Cancel (running / queued) */}
              {['running', 'queued'].includes(job.status) && (
                <CancelButton jobId={job.jobId} onDone={() => void qc.invalidateQueries({ queryKey: ['storage-migration-jobs'] })} />
              )}
              {/* Retry (failed / cancelled) */}
              {['failed', 'cancelled'].includes(job.status) && (
                <RetryButton jobId={job.jobId} onDone={() => void qc.invalidateQueries({ queryKey: ['storage-migration-jobs'] })} />
              )}
              {onViewDetail && (
                <button
                  type="button"
                  onClick={() => onViewDetail(job.jobId)}
                  className="p-1 rounded hover:bg-surface-soft text-text-muted hover:text-text-dim transition-colors"
                  aria-label="查看详情"
                >
                  <IconExternalLink size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
