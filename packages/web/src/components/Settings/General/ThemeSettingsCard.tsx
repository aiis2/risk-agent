import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconCircleCheck,
  IconDeviceDesktop,
  IconDroplet,
  IconMoon,
  IconPalette,
  IconSun,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { putPreferences } from '../../../api/client';
import type { ThemeMode } from '../../../lib/theme';
import { usePreferenceStore } from '../../../stores/preferenceStore';
import { Select, SelectItem } from '../../ui';

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  swatches: string[];
}> = [
  {
    value: 'system',
    label: '跟随系统',
    description: '默认模式，自动切换到系统浅色或深色。',
    Icon: IconDeviceDesktop,
    swatches: ['bg-[#0f1220]', 'bg-[#6b8afe]', 'bg-[#f3f6fb]'],
  },
  {
    value: 'midnight',
    label: 'Midnight',
    description: '深色蓝调，适合长时分析和连续监控。',
    Icon: IconMoon,
    swatches: ['bg-[#0f1220]', 'bg-[#161a2c]', 'bg-[#6b8afe]'],
  },
  {
    value: 'paper',
    label: 'Paper',
    description: '浅色高对比，适合白天审阅和展示。',
    Icon: IconSun,
    swatches: ['bg-[#f3f6fb]', 'bg-white', 'bg-[#3058dc]'],
  },
  {
    value: 'sea',
    label: 'Sea',
    description: '深海冷色调，强调状态和结构层级。',
    Icon: IconDroplet,
    swatches: ['bg-[#0a171f]', 'bg-[#113240]', 'bg-[#4ad3c5]'],
  },
];

export function ThemeSettingsCard() {
  const qc = useQueryClient();
  const themeMode = usePreferenceStore((state) => state.themeMode);
  const setThemeMode = usePreferenceStore((state) => state.setThemeMode);
  const clearDirty = usePreferenceStore((state) => state.clearDirty);
  const [saved, setSaved] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const currentOption = useMemo(
    () => THEME_OPTIONS.find((option) => option.value === themeMode) ?? THEME_OPTIONS[0],
    [themeMode],
  );

  const saveMut = useMutation({
    mutationFn: (mode: ThemeMode) => putPreferences({ themeMode: mode }),
    onSuccess: () => {
      clearDirty();
      void qc.invalidateQueries({ queryKey: ['preferences'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // 选择主题时立即保存
  const handleSelectTheme = (value: ThemeMode) => {
    setThemeMode(value);
    saveMut.mutate(value);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border-subtle bg-surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <IconPalette size={14} className="mt-0.5 text-accent" />
          <div>
            <h3 className="text-sm font-semibold text-text">主题配色</h3>
            <p className="mt-1 text-xs leading-relaxed text-text-dim">
              选择主题后立即生效并自动保存。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-success">
              <IconCircleCheck size={12} />
              已保存
            </span>
          )}
          <span className="rounded-full border border-border-subtle bg-surface px-2 py-1 text-[10px] text-text-muted">
            系统当前：{systemPrefersDark ? '深色' : '浅色'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {THEME_OPTIONS.map(({ value, label, description, Icon, swatches }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleSelectTheme(value)}
            className={clsx(
              'rounded-xl border p-3 text-left transition-all',
              themeMode === value
                ? 'border-accent bg-accent/10 shadow-lg shadow-black/10'
                : 'border-border-subtle bg-surface hover:border-border-strong hover:bg-surface-soft',
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-lg border',
                  themeMode === value ? 'border-accent/30 bg-accent/15 text-accent' : 'border-border-subtle bg-surface-soft text-text-dim',
                )}>
                  <Icon size={15} />
                </div>
                <div>
                  <p className="text-sm font-medium text-text">{label}</p>
                  <p className="text-[11px] text-text-muted">{description}</p>
                </div>
              </div>
              {themeMode === value && <IconCircleCheck size={14} className="text-accent" />}
            </div>
            <div className="flex items-center gap-2">
              {swatches.map((swatch) => (
                <span key={swatch} className={clsx('h-8 flex-1 rounded-lg border border-white/10', swatch)} />
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-1.5">
          <label className="text-xs text-text-muted">主题模式</label>
          <Select value={themeMode} onValueChange={(v) => handleSelectTheme(v as ThemeMode)}>
            {THEME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </Select>
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface p-3">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">当前方案</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface-soft text-accent">
              <currentOption.Icon size={16} />
            </div>
            <div>
              <p className="text-sm font-medium text-text">{currentOption.label}</p>
              <p className="text-xs leading-relaxed text-text-dim">{currentOption.description}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}