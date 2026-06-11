/**
 * ApplyConfirmDialog — 应用配置确认弹窗（高风险检测）
 * settings-center-ui.md §5.2 §8 · settings-center-frontend-mapping.md §5.8
 */
import { IconAlertTriangle, IconCloudUpload, IconShieldExclamation } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui';
import type { StorageProfile } from '../../../api/storageSettings';

// ─── 风险检测逻辑 ─────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

interface RiskInfo {
  level: RiskLevel;
  reasons: string[];
}

function detectRisk(profile: string, currentProfile?: string): RiskInfo {
  const reasons: string[] = [];
  let level: RiskLevel = 'low';

  // embedded → full-external 是高风险切换
  if (currentProfile === 'embedded' && profile === 'full-external') {
    reasons.push('从本地嵌入式切换到全量外部数据库，需手动迁移数据。');
    level = 'high';
  }

  // full-external → embedded 也是高风险
  if (currentProfile === 'full-external' && profile === 'embedded') {
    reasons.push('从外部数据库回退到本地嵌入式，现有外部数据将不再可用。');
    level = 'high';
  }

  // hybrid 或 full-external 通常涉及外部连接
  if (profile === 'hybrid' || profile === 'full-external') {
    reasons.push('外部存储配置需要确保目标服务可达，建议先运行 validate。');
    if (level === 'low') level = 'medium';
  }

  // 默认提醒
  if (reasons.length === 0) {
    reasons.push('该切换会影响后续新建会话的存储后端，不会修改已完成报告。');
  }

  reasons.push('建议先执行 dry-run 迁移，再执行正式切换。');

  return { level, reasons };
}

const RISK_COLORS: Record<RiskLevel, string> = {
  low:    'bg-success/10 border-success/20 text-success',
  medium: 'bg-warn/10 border-warn/20 text-warn',
  high:   'bg-danger/10 border-danger/20 text-danger',
};

const RISK_ICON_COLORS: Record<RiskLevel, string> = {
  low:    'text-success',
  medium: 'text-warn',
  high:   'text-danger',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: '低风险', medium: '中风险', high: '高风险'
};

// ─── 组件 ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  profile: StorageProfile;
  /** 当前激活的 profile，用于风险检测 */
  currentProfile?: StorageProfile;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApplyConfirmDialog({ open, profile, currentProfile, onConfirm, onCancel }: Props) {
  const risk = detectRisk(profile, currentProfile);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <div className="p-5 space-y-4">
          {/* Icon + Title */}
          <div className="flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg border', RISK_COLORS[risk.level])}>
              <IconShieldExclamation size={18} className={RISK_ICON_COLORS[risk.level]} />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-text">应用新配置</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-text-muted">
                切换为 <span className="font-medium text-text capitalize">{profile}</span>
                {' · '}
                <span className={clsx('font-medium', RISK_ICON_COLORS[risk.level])}>{RISK_LABELS[risk.level]}</span>
              </DialogDescription>
            </div>
          </div>

          {/* Risk info */}
          <div className={clsx('text-xs rounded-lg p-3 border space-y-1.5', RISK_COLORS[risk.level])}>
            {risk.reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <IconAlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>{r}</span>
              </div>
            ))}
          </div>

          {/* Standard info */}
          <div className="text-xs text-text-dim bg-surface border border-border-subtle rounded-lg p-3 space-y-1">
            <p>配置将写入文件，并创建修订版本以便回滚。</p>
            <p className="text-warn">当前模式需要重启服务后才能完全生效。</p>
          </div>

          {/* Buttons */}
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg border border-border text-text-dim hover:text-text hover:bg-surface-soft transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={clsx(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                risk.level === 'high'
                  ? 'bg-danger hover:bg-danger text-white'
                  : 'bg-accent hover:bg-accent-hover text-white'
              )}
            >
              <IconCloudUpload size={12} />
              {risk.level === 'high' ? '确认（高风险）' : '确认应用'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
