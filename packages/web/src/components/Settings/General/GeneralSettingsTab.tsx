/**
 * GeneralSettingsTab — 通用设置
 * 仅展示已接通前后端或已在客户端真实生效的配置项。
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconCircleCheck } from '@tabler/icons-react';
import { getPreferences, putPreferences } from '../../../api/client';
import { Select, SelectItem } from '../../ui/Select';
import { ContextSettingsCard } from './ContextSettingsCard';

// ─── Section wrapper ──────────────────────────────────────────────────────────

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

// ─── Language row (uses react-query prefs) ────────────────────────────────────

const UI_LOCALES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

function LanguageRow() {
  const qc = useQueryClient();
  const { i18n, t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [uiLocale, setUiLocale] = useState('zh-CN');

  const { data: prefs } = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
  });

  const saveMut = useMutation({
    mutationFn: (locale: string) => putPreferences({ uiLocale: locale }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['preferences'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // Sync locale from server prefs using useEffect to avoid setState-during-render
  useEffect(() => {
    const serverLocale = (prefs as any)?.uiLocale;
    if (serverLocale && serverLocale !== uiLocale) {
      setUiLocale(serverLocale);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(prefs as any)?.uiLocale]);

  function handleChange(v: string) {
    setUiLocale(v);
    void i18n.changeLanguage(v);
    try { localStorage.setItem('uiLocale', v); } catch { /* ignore */ }
    saveMut.mutate(v);
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <p className="text-sm text-text">{t('settings.general.language', '语言')}</p>
      <div className="flex items-center gap-2">
        {saved && <IconCircleCheck size={13} className="text-success" />}
        <Select value={uiLocale} onValueChange={handleChange}>
          {UI_LOCALES.map((l) => (
            <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
          ))}
        </Select>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function GeneralSettingsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 w-full">
      <Section title={t('settings.general.sectionTitle', '常规设置')}>
        <LanguageRow />
      </Section>
      <ContextSettingsCard />
    </div>
  );
}
