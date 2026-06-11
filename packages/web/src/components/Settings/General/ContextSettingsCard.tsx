/**
 * ContextSettingsCard — 上下文管理设置
 * 控制单次分析的最大推理轮次与自动压缩阈值
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconAdjustments, IconBolt, IconCircleCheck } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { getPreferences, putPreferences } from '../../../api/client';

const inputCls =
  'w-full h-8 rounded-lg border border-border bg-surface-input px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors';

export function ContextSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: getPreferences });
  const savePref = useMutation({
    mutationFn: putPreferences,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['preferences'] }),
  });

  const rawMaxTurns: number = (prefs.data as any)?.maxTurns ?? 30;
  const compactThreshold: number = (prefs.data as any)?.compactThresholdTokens ?? 80_000;
  const isUnlimited = rawMaxTurns <= 0;
  const [unlimited, setUnlimited] = useState<boolean | null>(null);
  const [localMaxTurns, setLocalMaxTurns] = useState<string>('');
  const [localThreshold, setLocalThreshold] = useState<string>('');
  const [saved, setSaved] = useState(false);

  const effectiveUnlimited = unlimited !== null ? unlimited : isUnlimited;
  const displayMaxTurns = localMaxTurns !== '' ? localMaxTurns : (rawMaxTurns > 0 ? String(rawMaxTurns) : '30');
  const displayThreshold = localThreshold !== '' ? localThreshold : String(compactThreshold);

  function save() {
    const mt = effectiveUnlimited ? 0 : parseInt(displayMaxTurns, 10);
    const ct = parseInt(displayThreshold, 10);
    if ((effectiveUnlimited || (!isNaN(mt) && mt >= 1 && mt <= 100)) && !isNaN(ct) && ct >= 10_000) {
      savePref.mutate({ maxTurns: mt, compactThresholdTokens: ct });
      setLocalMaxTurns('');
      setLocalThreshold('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  function toggleUnlimited() {
    const next = !effectiveUnlimited;
    setUnlimited(next);
    const ct = parseInt(displayThreshold, 10);
    const mt = next ? 0 : parseInt(rawMaxTurns > 0 ? String(rawMaxTurns) : '30', 10);
    if (!isNaN(ct) && ct >= 10_000) {
      savePref.mutate({ maxTurns: mt, compactThresholdTokens: ct });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card p-5">
      <div className="mb-4 flex items-start gap-2">
        <IconAdjustments size={14} className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold text-text">{t('settings.context.title', '上下文管理')}</h2>
          <p className="mt-1 text-xs text-text-muted">{t('settings.context.description', '控制单次分析的最大轮次与自动压缩阈值。')}</p>
        </div>
        {saved && (
          <span className="ml-auto flex items-center gap-1 text-xs text-success">
            <IconCircleCheck size={11} />
            {t('settings.context.saved', '已自动保存')}
          </span>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text">{t('settings.context.unlimitedLabel', '最大推理轮次不做限制')}</p>
            <p className="mt-0.5 text-xs text-text-muted">{t('settings.context.unlimitedHint', '开启后 Agent 将持续执行直到任务完成，不受轮次约束')}</p>
          </div>
          <button
            type="button"
            title={t('settings.context.toggleUnlimited', '切换无限制模式')}
            onClick={toggleUnlimited}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${effectiveUnlimited ? 'bg-accent' : 'bg-border'}`}
          >
            <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform ${effectiveUnlimited ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-xs text-text-muted">
              <IconBolt size={10} className="text-warn" />
              {t('settings.context.maxTurnsLabel', '最大推理轮次 (maxTurns)')}
            </label>
            <input
              type="number"
              min={1}
              max={100}
              disabled={effectiveUnlimited}
              value={effectiveUnlimited ? '' : displayMaxTurns}
              placeholder={effectiveUnlimited ? '不限制' : '30'}
              onChange={(e) => setLocalMaxTurns(e.target.value)}
              onBlur={save}
              aria-label={t('settings.context.maxTurnsAria', '最大推理轮次')}
              className={`${inputCls} ${effectiveUnlimited ? 'cursor-not-allowed opacity-40' : ''}`}
            />
            <p className="text-xs text-text-muted">
              {effectiveUnlimited
                ? t('settings.context.maxTurnsUnlimitedHint', '不限制轮次')
                : t('settings.context.maxTurnsHint', '每次分析最多执行多少轮 ReAct 循环（1-100）')}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-xs text-text-muted">
              <IconBolt size={10} className="text-warn" />
              {t('settings.context.compactThresholdLabel', '压缩阈值 Tokens (compactThreshold)')}
            </label>
            <input
              type="number"
              min={10000}
              step={10000}
              value={displayThreshold}
              onChange={(e) => setLocalThreshold(e.target.value)}
              onBlur={save}
              aria-label={t('settings.context.compactThresholdAria', '压缩阈值 Tokens')}
              className={inputCls}
            />
            <p className="text-xs text-text-muted">{t('settings.context.compactThresholdHint', '上下文 Token 数超过此阈值时触发自动压缩（默认 80,000）')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
