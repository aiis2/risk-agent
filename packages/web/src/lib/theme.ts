export const THEME_STORAGE_KEY = 'risk-agent-theme-mode';

export type ThemeMode = 'system' | 'midnight' | 'paper' | 'sea';
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

const THEME_VALUES: ThemeMode[] = ['system', 'midnight', 'paper', 'sea'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && THEME_VALUES.includes(value as ThemeMode);
}

export function getNextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_VALUES.indexOf(mode);
  if (index < 0) {
    return THEME_VALUES[0];
  }
  return THEME_VALUES[(index + 1) % THEME_VALUES.length];
}

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') {
    return prefersDark ? 'midnight' : 'paper';
  }
  return mode;
}

export function readStoredThemeMode(storage?: Pick<Storage, 'getItem'> | null): ThemeMode {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function writeStoredThemeMode(mode: ThemeMode, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore storage write failures
  }
}

export function getSystemPrefersDark(matcher?: Pick<Window, 'matchMedia'> | null): boolean {
  try {
    return matcher?.matchMedia('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export function applyTheme(documentRef: Document, mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  const resolvedTheme = resolveThemeMode(mode, prefersDark);
  const root = documentRef.documentElement;

  root.dataset.themeMode = mode;
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme === 'paper' ? 'light' : 'dark';

  return resolvedTheme;
}

export function initializeTheme(
  documentRef: Document | undefined = typeof document !== 'undefined' ? document : undefined,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
  matcher: Pick<Window, 'matchMedia'> | null | undefined = typeof window !== 'undefined' ? window : undefined,
): ThemeMode {
  if (!documentRef) {
    return 'system';
  }

  const mode = readStoredThemeMode(storage);
  applyTheme(documentRef, mode, getSystemPrefersDark(matcher));
  writeStoredThemeMode(mode, storage);
  return mode;
}