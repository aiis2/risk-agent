import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPreferences } from '../api/client';
import { applyTheme, getSystemPrefersDark, isThemeMode, writeStoredThemeMode } from '../lib/theme';
import { usePreferenceStore } from '../stores/preferenceStore';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = usePreferenceStore((state) => state.themeMode);
  const dirty = usePreferenceStore((state) => state.dirty);
  const hydratePreferences = usePreferenceStore((state) => state.hydratePreferences);

  const preferencesQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
    staleTime: 60_000,
  });

  useEffect(() => {
    const nextThemeMode = preferencesQuery.data?.themeMode;
    if (!dirty && isThemeMode(nextThemeMode)) {
      hydratePreferences({ themeMode: nextThemeMode });
    }
  }, [dirty, hydratePreferences, preferencesQuery.data?.themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = (prefersDark = mediaQuery.matches) => {
      applyTheme(document, themeMode, prefersDark);
      writeStoredThemeMode(themeMode, window.localStorage);
    };

    syncTheme(getSystemPrefersDark(window));

    if (themeMode !== 'system') {
      return undefined;
    }

    const handleChange = (event: MediaQueryListEvent) => {
      syncTheme(event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [themeMode]);

  return <>{children}</>;
}