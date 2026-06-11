/**
 * DisplaySettingsTab — 显示设置
 * 仅保留真实生效的主题、缩放与字体能力。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconCircleCheck,
  IconCode,
  IconDeviceDesktop,
  IconDroplet,
  IconMinus,
  IconMoon,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconSun,
  IconTextSize,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { putPreferences } from '../../../api/client';
import type { ThemeMode } from '../../../lib/theme';
import { usePreferenceStore } from '../../../stores/preferenceStore';

const STORAGE_KEY = 'risk_agent:display_settings';

interface DisplayConfig {
  accentColor: string;
  zoomLevel: number;
  globalFont: string;
  codeFont: string;
}

function defaultDisplayConfig(): DisplayConfig {
  return {
    accentColor: '#6b8afe',
    zoomLevel: 100,
    globalFont: 'default',
    codeFont: 'default',
  };
}

function loadDisplayConfig(): DisplayConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultDisplayConfig(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultDisplayConfig();
}

function saveDisplayConfig(cfg: DisplayConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}

const ACCENT_PRESETS = [
  { value: '#f44d7b', swatchClass: 'bg-[#f44d7b]' },
  { value: '#e05252', swatchClass: 'bg-[#e05252]' },
  { value: '#e07b52', swatchClass: 'bg-[#e07b52]' },
  { value: '#e0b752', swatchClass: 'bg-[#e0b752]' },
  { value: '#52a44e', swatchClass: 'bg-[#52a44e]' },
  { value: '#4e9ee0', swatchClass: 'bg-[#4e9ee0]' },
  { value: '#6b8afe', swatchClass: 'bg-[#6b8afe]' },
  { value: '#a066e0', swatchClass: 'bg-[#a066e0]' },
  { value: '#e066c0', swatchClass: 'bg-[#e066c0]' },
  { value: '#14b8a6', swatchClass: 'bg-[#14b8a6]' },
  { value: '#0ea5e9', swatchClass: 'bg-[#0ea5e9]' },
  { value: '#22c55e', swatchClass: 'bg-[#22c55e]' },
];

function hexToRgbTriplet(hex: string): string {
  const compact = hex.replace('#', '');
  const normalized = compact.length === 3
    ? compact.split('').map((part) => `${part}${part}`).join('')
    : compact;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '107 138 254';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function mixRgbTriplet(triplet: string, target: number, amount: number): string {
  return triplet
    .split(' ')
    .map((value) => {
      const channel = Number(value);
      const mixed = Math.round(channel + (target - channel) * amount);
      return String(Math.max(0, Math.min(255, mixed)));
    })
    .join(' ');
}

function applyDisplayConfig(cfg: DisplayConfig) {
  const accent = hexToRgbTriplet(cfg.accentColor);
  const isPaper = document.documentElement.dataset.theme === 'paper';
  const accentHover = mixRgbTriplet(accent, isPaper ? 0 : 255, isPaper ? 0.12 : 0.16);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-hover', accentHover);
  document.documentElement.style.setProperty('--ui-zoom', String(cfg.zoomLevel / 100));
  if (cfg.globalFont !== 'default') {
    document.documentElement.style.setProperty('--font-global', cfg.globalFont);
  } else {
    document.documentElement.style.removeProperty('--font-global');
  }
  if (cfg.codeFont !== 'default') {
    document.documentElement.style.setProperty('--font-code', cfg.codeFont);
  } else {
    document.documentElement.style.removeProperty('--font-code');
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-card">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-sm text-text">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function DisplaySettingsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const themeMode = usePreferenceStore((state) => state.themeMode);
  const setThemeMode = usePreferenceStore((state) => state.setThemeMode);
  const clearDirty = usePreferenceStore((state) => state.clearDirty);
  const [themeSaved, setThemeSaved] = useState(false);
  const [cfg, setCfg] = useState<DisplayConfig>(loadDisplayConfig);

  const themeModes: Array<{
    value: ThemeMode;
    label: string;
    Icon: React.ComponentType<{ size?: number | string; className?: string }>;
  }> = [
    { value: 'paper', label: t('settings.display.themeModes.paper', '浅色'), Icon: IconSun },
    { value: 'midnight', label: t('settings.display.themeModes.midnight', '深色'), Icon: IconMoon },
    { value: 'system', label: t('settings.display.themeModes.system', '系统'), Icon: IconDeviceDesktop },
    { value: 'sea', label: t('settings.display.themeModes.sea', 'Sea'), Icon: IconDroplet },
  ];

  const globalFonts = [
    { value: 'default', label: t('settings.display.fontOptions.default', '默认') },
    { value: 'system-ui', label: t('settings.display.fontOptions.system', '系统默认') },
    { value: '"PingFang SC", "Microsoft YaHei", sans-serif', label: 'PingFang / Microsoft YaHei' },
    { value: 'Inter, sans-serif', label: 'Inter' },
    { value: '"Noto Sans SC", sans-serif', label: 'Noto Sans SC' },
  ];

  const codeFonts = [
    { value: 'default', label: t('settings.display.fontOptions.default', '默认') },
    { value: 'ui-monospace, monospace', label: t('settings.display.fontOptions.monoSystem', '系统等宽') },
    { value: '"JetBrains Mono", monospace', label: 'JetBrains Mono' },
    { value: '"Fira Code", monospace', label: 'Fira Code' },
    { value: '"Cascadia Code", monospace', label: 'Cascadia Code' },
    { value: 'Consolas, monospace', label: 'Consolas' },
  ];

  useEffect(() => {
    applyDisplayConfig(cfg);
    saveDisplayConfig(cfg);
  }, [cfg, themeMode]);

  const saveThemeMut = useMutation({
    mutationFn: (mode: ThemeMode) => putPreferences({ themeMode: mode }),
    onSuccess: () => {
      clearDirty();
      void qc.invalidateQueries({ queryKey: ['preferences'] });
      setThemeSaved(true);
      setTimeout(() => setThemeSaved(false), 2000);
    },
  });

  function handleThemeChange(mode: ThemeMode) {
    setThemeMode(mode);
    saveThemeMut.mutate(mode);
  }

  function updateCfg(patch: Partial<DisplayConfig>) {
    setCfg((prev) => ({ ...prev, ...patch }));
  }

  function adjustZoom(delta: number) {
    const next = Math.min(150, Math.max(70, cfg.zoomLevel + delta));
    updateCfg({ zoomLevel: next });
  }

  function resetZoom() {
    updateCfg({ zoomLevel: 100 });
  }

  return (
    <div className="space-y-4 w-full">
      <Section title={t('settings.display.sections.theme', '主题设置')}>
        <Row label={t('settings.display.themeMode', '主题模式')}>
          <div className="flex gap-2">
            {themeModes.map((tm) => (
              <button
                key={tm.value}
                type="button"
                onClick={() => handleThemeChange(tm.value)}
                className={clsx(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs transition-colors',
                  themeMode === tm.value
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border bg-surface text-text-muted hover:border-border hover:bg-surface-hover hover:text-text'
                )}
              >
                <tm.Icon size={16} />
                {tm.label}
              </button>
            ))}
            {themeSaved && <IconCircleCheck size={14} className="self-center text-success" />}
          </div>
        </Row>

        <div className="px-5 py-3.5">
          <div className="mb-2 flex items-center gap-2">
            <IconPalette size={13} className="text-text-muted" />
            <p className="text-sm text-text">{t('settings.display.accentColor', '主题颜色')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => updateCfg({ accentColor: color.value })}
                title={color.value}
                className={clsx(
                  'h-7 w-7 rounded-full border-2 transition-all',
                  color.swatchClass,
                  cfg.accentColor === color.value
                    ? 'border-white scale-110 shadow-md'
                    : 'border-transparent hover:scale-105'
                )}
              />
            ))}
            <input
              type="color"
              value={cfg.accentColor}
              onChange={(event) => updateCfg({ accentColor: event.target.value })}
              title={t('settings.display.customColor', '自定义颜色')}
              className="h-7 w-14 cursor-pointer rounded border border-border bg-surface-input p-0.5 text-xs"
            />
            <span className="font-mono text-xs text-text-muted">{cfg.accentColor.toUpperCase()}</span>
          </div>
        </div>
      </Section>

      <Section title={t('settings.display.sections.zoom', '缩放设置')}>
        <Row
          label={t('settings.display.zoomLabel', '界面缩放')}
          hint={t('settings.display.zoomHint', '调整整体界面缩放比例（70%–150%）')}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              title={t('settings.display.decreaseZoom', '减小缩放')}
              onClick={() => adjustZoom(-10)}
              disabled={cfg.zoomLevel <= 70}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-40"
            >
              <IconMinus size={12} />
            </button>
            <span className="w-12 text-center text-sm font-semibold text-text tabular-nums">{cfg.zoomLevel}%</span>
            <button
              type="button"
              title={t('settings.display.increaseZoom', '增大缩放')}
              onClick={() => adjustZoom(10)}
              disabled={cfg.zoomLevel >= 150}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-40"
            >
              <IconPlus size={12} />
            </button>
            <button
              type="button"
              onClick={resetZoom}
              disabled={cfg.zoomLevel === 100}
              title={t('settings.display.resetZoom', '重置')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-40"
            >
              <IconRefresh size={12} />
            </button>
          </div>
        </Row>
      </Section>

      <Section title={t('settings.display.sections.typography', '字体设置')}>
        <Row
          label={t('settings.display.globalFontLabel', '全局字体')}
          hint={t('settings.display.globalFontHint', '设置界面全局文字字体')}
        >
          <div className="flex items-center gap-2">
            <IconTextSize size={13} className="text-text-muted" />
            <select
              title={t('settings.display.globalFontLabel', '全局字体')}
              value={cfg.globalFont}
              onChange={(event) => updateCfg({ globalFont: event.target.value })}
              className="h-8 rounded-lg border border-border bg-surface-input px-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            >
              {globalFonts.map((font) => (
                <option key={font.value} value={font.value}>{font.label}</option>
              ))}
            </select>
          </div>
        </Row>
        <Row
          label={t('settings.display.codeFontLabel', '代码字体')}
          hint={t('settings.display.codeFontHint', '设置代码块、终端等等宽字体')}
        >
          <div className="flex items-center gap-2">
            <IconCode size={13} className="text-text-muted" />
            <select
              title={t('settings.display.codeFontLabel', '代码字体')}
              value={cfg.codeFont}
              onChange={(event) => updateCfg({ codeFont: event.target.value })}
              className="h-8 rounded-lg border border-border bg-surface-input px-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            >
              {codeFonts.map((font) => (
                <option key={font.value} value={font.value}>{font.label}</option>
              ))}
            </select>
          </div>
        </Row>
      </Section>
    </div>
  );
}
