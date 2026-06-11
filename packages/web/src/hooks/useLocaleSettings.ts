/**
 * useLocaleSettings — 语言偏好 hook
 * settings-center-frontend-mapping.md §11.4
 * 包装 preferences API + preferenceStore + i18n 实例切换
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPreferences, putPreferences } from '../api/client';
import { usePreferenceStore, type SupportedLocale } from '../stores/preferenceStore';
import { i18n } from '../i18n/index';

export function useLocaleSettings() {
  const qc = useQueryClient();
  const store = usePreferenceStore();

  // 从服务端读取偏好
  const prefsQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
    staleTime: 60_000,
  });

  // 服务端数据同步到 store（不覆盖本地 dirty 状态）
  useEffect(() => {
    if (prefsQuery.data && !store.dirty) {
      const data = prefsQuery.data as { uiLocale?: SupportedLocale; reportLocale?: SupportedLocale };
      if (data.uiLocale) store.setUiLocale(data.uiLocale);
      if (data.reportLocale) store.setReportLocale(data.reportLocale);
      store.clearDirty();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsQuery.data]);

  // uiLocale 变化时切换 i18n 语言（防止重复切换）
  useEffect(() => {
    if (i18n.language !== store.uiLocale) {
      void i18n.changeLanguage(store.uiLocale).then(() => {
        store.setTranslationReady(true);
      });
    } else {
      store.setTranslationReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.uiLocale]);

  const saveMut = useMutation({
    mutationFn: () => putPreferences({ uiLocale: store.uiLocale, reportLocale: store.reportLocale }),
    onMutate: () => store.setSaving(true),
    onSuccess: () => {
      store.clearDirty();
      store.setSaving(false);
      void qc.invalidateQueries({ queryKey: ['preferences'] });
    },
    onError: (err) => {
      store.setSaving(false);
      store.setError((err as Error).message);
    },
  });

  return {
    uiLocale: store.uiLocale,
    reportLocale: store.reportLocale,
    supportedLocales: store.supportedLocales,
    translationReady: store.translationReady,
    dirty: store.dirty,
    saving: store.saving,
    errorMessage: store.errorMessage,

    setUiLocale: (locale: SupportedLocale) => {
      store.setUiLocale(locale);
    },
    setReportLocale: store.setReportLocale,
    save: () => saveMut.mutate(),
  };
}
