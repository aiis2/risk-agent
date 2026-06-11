/**
 * ApprovalModeSelector — VS Code Copilot 风格的工具调用审批模式选择器
 *
 * 三种模式：
 *  - default  : 默认审批（危险工具需要用户确认）
 *  - bypass   : 绕过审批（所有工具调用自动批准）
 *  - autopilot: Autopilot（自主迭代，最大化自动化）
 */
import {
  IconShieldCheck,
  IconShieldOff,
  IconRocket,
  IconChevronDown,
} from '@tabler/icons-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui';
import type { RunApprovalMode } from '../api/client';

interface ApprovalModeConfig {
  label: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
}

const MODE_CONFIGS: Record<RunApprovalMode, ApprovalModeConfig> = {
  default: {
    label: '默认审批',
    description: '危险工具需要你确认后才执行',
    icon: IconShieldCheck,
    iconColor: 'text-accent',
  },
  bypass: {
    label: '绕过审批',
    description: '所有工具调用均自动批准',
    icon: IconShieldOff,
    iconColor: 'text-warning',
  },
  autopilot: {
    label: 'Autopilot',
    description: '从头到尾完全自主迭代',
    icon: IconRocket,
    iconColor: 'text-success',
  },
};

interface ApprovalModeSelectorProps {
  value: RunApprovalMode;
  onChange: (mode: RunApprovalMode) => void;
  /** 是否在运行中（运行中时禁用切换） */
  disabled?: boolean;
}

export function ApprovalModeSelector({ value, onChange, disabled }: ApprovalModeSelectorProps) {
  const current = MODE_CONFIGS[value];
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors
            ${disabled
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer hover:bg-surface-hover'
            }
            ${current.iconColor}`}
          title={`当前审批模式：${current.label} — ${current.description}`}
        >
          <Icon size={13} />
          <span className="hidden sm:inline">{current.label}</span>
          <IconChevronDown size={10} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 rounded-xl border border-border bg-surface-card p-1 shadow-lg"
        sideOffset={6}
      >
        <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          工具审批模式
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1 h-px bg-border/50" />

        {(Object.entries(MODE_CONFIGS) as [RunApprovalMode, ApprovalModeConfig][]).map(
          ([mode, cfg]) => {
            const ModeIcon = cfg.icon;
            const isSelected = mode === value;
            return (
              <DropdownMenuItem
                key={mode}
                onSelect={() => onChange(mode)}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 focus:bg-surface-hover
                  ${isSelected ? 'bg-surface-hover' : ''}`}
              >
                <ModeIcon size={14} className={`mt-0.5 shrink-0 ${cfg.iconColor}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[12px] font-medium ${isSelected ? cfg.iconColor : 'text-text-primary'}`}>
                      {cfg.label}
                    </span>
                    {isSelected && (
                      <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-semibold text-accent">
                        当前
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-[1.5] text-text-muted">{cfg.description}</p>
                </div>
              </DropdownMenuItem>
            );
          },
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
