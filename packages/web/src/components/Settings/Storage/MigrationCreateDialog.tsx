/**
 * MigrationCreateDialog — 创建迁移任务对话框
 * settings-center-ui.md §5.4 · settings-center-frontend-mapping.md §5.10
 */
import { useState } from 'react';
import { IconTransfer } from '@tabler/icons-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui';

type Scope = 'structured' | 'vector' | 'graph' | 'object';
type Strategy = 'copy' | 'copy-and-verify' | 'snapshot-restore';
const ALL_SCOPES: Scope[] = ['structured', 'vector', 'graph', 'object'];

const STRATEGY_OPTIONS: { value: Strategy; label: string; desc: string }[] = [
  { value: 'copy',               label: '仅复制',          desc: '仅传输数据，不校验一致性' },
  { value: 'copy-and-verify',    label: '复制并校验',       desc: '传输后逐 scope 验证数量与一致性（推荐）' },
  { value: 'snapshot-restore',   label: '快照-恢复',        desc: '失败时自动回滚，需要额外磁盘空间' },
];

interface MigratePayload {
  scopes: Scope[];
  dryRun: boolean;
  strategy: Strategy;
  comment?: string;
}

interface Props {
  open: boolean;
  onConfirm: (payload: MigratePayload) => void;
  onCancel: () => void;
}

export function MigrationCreateDialog({ open, onConfirm, onCancel }: Props) {
  const [scopes, setScopes] = useState<Scope[]>(['structured']);
  const [dryRun, setDryRun] = useState(true);
  const [strategy, setStrategy] = useState<Strategy>('copy-and-verify');
  const [comment, setComment] = useState('');

  function toggleScope(scope: Scope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  function handleConfirm() {
    onConfirm({ scopes, dryRun, strategy, comment: comment.trim() || undefined });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <div className="p-5 space-y-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10 border border-accent/20">
              <IconTransfer size={18} className="text-accent" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-text">创建迁移任务</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-text-muted">选择迁移范围、模式与策略</DialogDescription>
            </div>
          </div>

          {/* Scopes */}
          <div className="space-y-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wide font-medium">迁移范围</span>
            <div className="grid grid-cols-2 gap-2">
              {ALL_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                    scopes.includes(scope) ? 'border-accent/40 bg-surface-soft' : 'border-border-subtle bg-surface hover:border-border'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="accent-accent"
                  />
                  <span className="text-xs text-text capitalize">{scope}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Dry run toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="accent-accent"
            />
            <div>
              <span className="text-xs text-text">Dry Run 模式</span>
              <p className="text-[10px] text-text-muted">模拟执行，不实际迁移数据</p>
            </div>
          </label>

          {/* Strategy */}
          <div className="space-y-2">
            <span className="text-[10px] text-text-muted uppercase tracking-wide font-medium">迁移策略</span>
            <div className="space-y-1.5">
              {STRATEGY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    strategy === opt.value
                      ? 'border-accent/40 bg-surface-soft'
                      : 'border-border-subtle bg-surface hover:border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    value={opt.value}
                    checked={strategy === opt.value}
                    onChange={() => setStrategy(opt.value)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <span className="text-xs text-text">{opt.label}</span>
                    <p className="text-[10px] text-text-muted">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Comment */}
          <input
            type="text"
            placeholder="备注（可选）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full text-xs rounded-lg border border-border-subtle bg-surface-sidebar text-text px-3 py-2 outline-none focus:border-accent/60 placeholder-text-muted"
          />

          {/* Buttons */}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-dim hover:text-text hover:bg-surface-soft transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={scopes.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors font-medium disabled:opacity-40"
            >
              <IconTransfer size={12} />
              {dryRun ? '模拟迁移' : '开始迁移'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
