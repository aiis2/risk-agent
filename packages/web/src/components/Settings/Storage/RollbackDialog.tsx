/**
 * RollbackDialog — 选择 revision 并执行回滚
 * settings-center-frontend-mapping.md §5.9
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconArrowBackUp, IconLoader2, IconHistory } from '@tabler/icons-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui';
import { storageSettingsApi, type StorageConfigRevision } from '../../../api/storageSettings';

interface Props {
  open: boolean;
  /** 从历史表直接触发时预选的 revision ID */
  preselectedRevisionId?: string;
  onConfirm: (revisionId: string, reason?: string) => void;
  onCancel: () => void;
}

export function RollbackDialog({ open, preselectedRevisionId, onConfirm, onCancel }: Props) {
  const [selectedId, setSelectedId] = useState(preselectedRevisionId ?? '');
  const [reason, setReason] = useState('');

  // Sync pre-selection when dialog opens with a specific revision
  useEffect(() => {
    if (open && preselectedRevisionId) setSelectedId(preselectedRevisionId);
    if (!open) { setSelectedId(''); setReason(''); }
  }, [open, preselectedRevisionId]);

  const { data, isLoading } = useQuery({
    queryKey: ['storage-history'],
    queryFn: () => storageSettingsApi.getHistory(10),
    enabled: open,
  });

  const revisions: StorageConfigRevision[] = data?.revisions ?? [];
  // Set of recommended rollback candidate IDs from server
  const rollbackCandidateIds = new Set((data?.rollbackCandidates ?? []).map((c) => c.revisionId));

  function handleConfirm() {
    if (selectedId) onConfirm(selectedId, reason.trim() || undefined);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <div className="p-5 space-y-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-danger/10 border border-danger/20">
              <IconArrowBackUp size={18} className="text-danger" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-text">回滚存储配置</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-text-muted">选择目标修订版本</DialogDescription>
            </div>
          </div>

          {/* Revision list */}
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted py-3">
              <IconLoader2 size={12} className="animate-spin" />
              <span>加载历史…</span>
            </div>
          ) : revisions.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-muted py-3">
              <IconHistory size={14} />
              <span>暂无历史记录</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {revisions.map((rev) => (
                <label
                  key={rev.revisionId}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedId === rev.revisionId
                      ? 'border-accent/50 bg-surface-soft'
                      : 'border-border-subtle hover:border-border bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="revision"
                    value={rev.revisionId}
                    checked={selectedId === rev.revisionId}
                    onChange={() => setSelectedId(rev.revisionId)}
                    className="mt-0.5 accent-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-text capitalize">{rev.profile}</span>
                      {rev.isActive && (
                        <span className="text-[10px] text-success bg-success/10 border border-success/20 px-1.5 py-0 rounded-full">当前</span>
                      )}
                      {rollbackCandidateIds.has(rev.revisionId) && !rev.isActive && (
                        <span className="text-[10px] text-accent bg-accent/10 border border-accent/20 px-1.5 py-0 rounded-full">推荐</span>
                      )}
                    </div>
                    <div className="text-[10px] text-text-muted font-mono truncate mt-0.5">{rev.revisionId}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {new Date(rev.createdAt).toLocaleString('zh-CN')}
                      {rev.comment && ` · ${rev.comment}`}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Reason */}
          <input
            type="text"
            placeholder="回滚原因（可选）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full text-xs rounded-lg border border-border-subtle bg-surface-sidebar text-text px-3 py-2 outline-none focus:border-accent/60 placeholder-text-muted"
          />

          {/* Buttons */}
          <div className="flex gap-2 justify-end">
            <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-dim hover:text-text hover:bg-surface-soft transition-colors">
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedId}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-danger text-white hover:bg-danger transition-colors font-medium disabled:opacity-40"
            >
              <IconArrowBackUp size={12} />
              确认回滚
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
