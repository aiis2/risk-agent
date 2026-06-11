/**
 * preferenceStore — 用户偏好 Zustand store
 * settings-center-frontend-mapping.md §11.3
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { readStoredThemeMode, type ThemeMode } from '../lib/theme';

export type SupportedLocale = 'zh-CN' | 'en-US';

function getInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system';
  }
  return readStoredThemeMode(window.localStorage);
}

interface PreferenceState {
  uiLocale: SupportedLocale;
  reportLocale: SupportedLocale;
  themeMode: ThemeMode;
  supportedLocales: SupportedLocale[];
  translationReady: boolean;
  missingKeysCount: number;
  dirty: boolean;
  saving: boolean;
  errorMessage?: string;
}

interface PreferenceActions {
  setUiLocale: (locale: SupportedLocale) => void;
  setReportLocale: (locale: SupportedLocale) => void;
  setThemeMode: (themeMode: ThemeMode) => void;
  setSaving: (v: boolean) => void;
  setTranslationReady: (v: boolean) => void;
  setMissingKeysCount: (n: number) => void;
  setError: (msg?: string) => void;
  hydratePreferences: (prefs: Partial<Pick<PreferenceState, 'uiLocale' | 'reportLocale' | 'themeMode'>>) => void;
  clearDirty: () => void;
}

export const usePreferenceStore = create<PreferenceState & PreferenceActions>()(
  persist(
    (set) => ({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: getInitialThemeMode(),
      supportedLocales: ['zh-CN', 'en-US'],
      translationReady: false,
      missingKeysCount: 0,
      dirty: false,
      saving: false,
      errorMessage: undefined,

      setUiLocale: (locale) => set({ uiLocale: locale, dirty: true }),
      setReportLocale: (locale) => set({ reportLocale: locale, dirty: true }),
      setThemeMode: (themeMode) => set({ themeMode, dirty: true }),
      setSaving: (v) => set({ saving: v }),
      setTranslationReady: (v) => set({ translationReady: v }),
      setMissingKeysCount: (n) => set({ missingKeysCount: n }),
      setError: (msg) => set({ errorMessage: msg }),
      hydratePreferences: (prefs) => set((state) => ({
        uiLocale: prefs.uiLocale ?? state.uiLocale,
        reportLocale: prefs.reportLocale ?? state.reportLocale,
        themeMode: prefs.themeMode ?? state.themeMode,
        dirty: false,
      })),
      clearDirty: () => set({ dirty: false }),
    }),
    {
      name: 'risk-agent-preferences',
      partialize: (state) => ({
        uiLocale: state.uiLocale,
        reportLocale: state.reportLocale,
        themeMode: state.themeMode,
      }),
    }
  )
);
