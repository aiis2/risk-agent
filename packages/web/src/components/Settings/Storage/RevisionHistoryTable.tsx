/**
 * RevisionHistoryTable — 配置修订历史列表
 * settings-center-frontend-mapping.md §5.3
 */
import { useQuery } from '@tanstack/react-query';
import { IconHistory, IconLoader2, IconRotate2, IconCircleCheck } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { storageSettingsApi, type StorageConfigRevision } from '../../../api/storageSettings';

interface Props {
  onRollbackRequest?: (revisionId: string) => void;
}

export function RevisionHistoryTable({ onRollbackRequest }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['storage-history'],
    queryFn: () => storageSettingsApi.getHistory(15),
    refetchInterval: 60_000,
  });

  const revisions: StorageConfigRevision[] = data?.revisions ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <IconHistory size={12} />
        <span className="uppercase tracking-wide font-medium">修订历史</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-text-muted py-3">
          <IconLoader2 size={12} className="animate-spin" />
          <span>加载中…</span>
        </div>
      ) : revisions.length === 0 ? (
        <div className="text-xs text-text-muted bg-surface border border-dashed border-border-subtle rounded-lg p-4 text-center">
          暂无修订历史
        </div>
      ) : (
        <div className="divide-y divide-border-subtle bg-surface border border-border-subtle rounded-lg overflow-hidden">
          {revisions.map((rev) => (
            <div key={rev.revisionId} className={clsx(
              'flex items-center gap-3 px-3 py-2.5 group',
              rev.isActive && 'bg-accent/5'
            )}>
              {rev.isActive
                ? <IconCircleCheck size={12} className="text-success shrink-0" />
                : <div className="w-3 h-3 rounded-full border border-border shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text capitalize">{rev.profile}</span>
                  {rev.isActive && (
                    <span className="text-[10px] text-success bg-success/10 border border-success/20 px-1.5 rounded-full">当前</span>
                  )}
                  <span className="text-[10px] text-text-muted">{rev.source}</span>
                </div>
                <div className="text-[10px] text-text-muted font-mono truncate mt-0.5">
                  {rev.revisionId}
                  {rev.comment && ` · ${rev.comment}`}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {new Date(rev.createdAt).toLocaleString('zh-CN')}
                </div>
              </div>
              {!rev.isActive && onRollbackRequest && (
                <button
                  onClick={() => onRollbackRequest(rev.revisionId)}
                  className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] text-text-dim hover:text-danger transition-all px-2 py-1 rounded border border-transparent hover:border-danger/20 hover:bg-danger/10"
                  title="回滚到此版本"
                >
                  <IconRotate2 size={10} />
                  回滚
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
