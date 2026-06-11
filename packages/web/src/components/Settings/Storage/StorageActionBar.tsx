/**
 * StorageActionBar — 操作按钮栏（校验/应用/回滚/迁移/下载）
 * settings-center-frontend-mapping.md §5.7
 */
import {
  IconShieldCheck,
  IconCloudUpload,
  IconArrowBackUp,
  IconTransfer,
  IconDownload,
  IconLoader2,
} from '@tabler/icons-react';
import { clsx } from 'clsx';

export interface ActionBarState {
  isDirty: boolean;
  isValidated: boolean;
  isApplyReady: boolean;
  validating: boolean;
  applying: boolean;
  rolling: boolean;
  migrating: boolean;
}

interface Props {
  state: ActionBarState;
  onValidate: () => void;
  onApply: () => void;
  onRollback: () => void;
  onMigrate: () => void;
  onDownload: () => void;
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'accent' | 'danger';
  loading?: boolean;
}

function ActionButton({ icon, label, onClick, disabled, variant = 'default', loading }: ActionButtonProps) {
  const colors = {
    default: 'border-border text-text-dim hover:border-border-strong hover:text-text hover:bg-surface-soft',
    accent:  'border-accent/40 text-accent hover:border-accent hover:bg-accent/10',
    danger:  'border-danger/30 text-danger hover:border-danger hover:bg-danger/10',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        colors[variant]
      )}
    >
      {loading ? <IconLoader2 size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

export function StorageActionBar({ state, onValidate, onApply, onRollback, onMigrate, onDownload }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        icon={<IconShieldCheck size={13} />}
        label="校验"
        onClick={onValidate}
        disabled={!state.isDirty && state.isValidated}
        loading={state.validating}
        variant="default"
      />
      <ActionButton
        icon={<IconCloudUpload size={13} />}
        label="应用"
        onClick={onApply}
        disabled={!state.isApplyReady}
        loading={state.applying}
        variant="accent"
      />
      <ActionButton
        icon={<IconArrowBackUp size={13} />}
        label="回滚"
        onClick={onRollback}
        disabled={state.applying || state.rolling}
        loading={state.rolling}
        variant="danger"
      />
      <ActionButton
        icon={<IconTransfer size={13} />}
        label="迁移"
        onClick={onMigrate}
        disabled={state.migrating}
        loading={state.migrating}
        variant="default"
      />
      <ActionButton
        icon={<IconDownload size={13} />}
        label="下载"
        onClick={onDownload}
        variant="default"
      />
    </div>
  );
}
