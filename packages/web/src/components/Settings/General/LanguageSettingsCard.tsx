/**
 * LanguageSettingsCard — 语言与区域设置（General Tab）
 * settings-center-frontend-mapping.md §11
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconLanguage, IconCircleCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { getPreferences, putPreferences } from '../../../api/client';
import { Select, SelectItem } from '../../ui';

const UI_LOCALES = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

const REPORT_LOCALES = [
  { value: 'zh-CN', label: '简体中文（默认）' },
  { value: 'en-US', label: 'English' },
];

type SelectProps = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
};

function LabeledSelect({ label, value, options, onChange }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <Select value={value} onValueChange={onChange}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </Select>
    </div>
  );
}

/** 简单预览区域 */
function LocalePreviewPanel({ uiLocale, reportLocale }: { uiLocale: string; reportLocale: string }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString(uiLocale, { year: 'numeric', month: 'long', day: 'numeric' });
  const numStr = (1234567.89).toLocaleString(uiLocale, { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 });

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface p-3">
      <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">预览</span>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-[10px] text-text-muted">日期格式</span>
          <p className="mt-0.5 text-text">{dateStr}</p>
        </div>
        <div>
          <span className="text-[10px] text-text-muted">货币格式</span>
          <p className="mt-0.5 text-text">{numStr}</p>
        </div>
        <div className="col-span-2">
          <span className="text-[10px] text-text-muted">报告语言</span>
          <p className="mt-0.5 text-text">
            {REPORT_LOCALES.find((l) => l.value === reportLocale)?.label ?? reportLocale}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LanguageSettingsCard() {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [uiLocale, setUiLocale] = useState('zh-CN');
  const [reportLocale, setReportLocale] = useState('zh-CN');

  const { data: prefs } = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
  });

  useEffect(() => {
    if (prefs) {
      setUiLocale((prefs as any).uiLocale ?? 'zh-CN');
      setReportLocale((prefs as any).reportLocale ?? 'zh-CN');
    }
  }, [prefs]);

  const saveMut = useMutation({
    mutationFn: (payload: { uiLocale: string; reportLocale: string }) => putPreferences(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['preferences'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleUiLocaleChange = (v: string) => {
    setUiLocale(v);
    // 同步 i18n 实例以立即改变界面语言
    void i18n.changeLanguage(v);
    try { localStorage.setItem('uiLocale', v); } catch { /* ignore */ }
    saveMut.mutate({ uiLocale: v, reportLocale });
  };

  const handleReportLocaleChange = (v: string) => {
    setReportLocale(v);
    saveMut.mutate({ uiLocale, reportLocale: v });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border-subtle bg-surface-card p-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconLanguage size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-text">语言与区域</h3>
        </div>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <IconCircleCheck size={12} />
            已自动保存
          </span>
        )}
      </div>

      {/* Selects */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <LabeledSelect
          label="界面语言"
          value={uiLocale}
          options={UI_LOCALES}
          onChange={handleUiLocaleChange}
        />
        <LabeledSelect
          label="报告语言"
          value={reportLocale}
          options={REPORT_LOCALES}
          onChange={handleReportLocaleChange}
        />
      </div>

      {/* Preview */}
      <LocalePreviewPanel uiLocale={uiLocale} reportLocale={reportLocale} />
    </div>
  );
}
