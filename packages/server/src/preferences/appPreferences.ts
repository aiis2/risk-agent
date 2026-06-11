import { z } from 'zod';

interface PreferencesReadStore {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface PreferencesWriteStore extends PreferencesReadStore {
  run(sql: string, params?: unknown[]): Promise<unknown>;
}

interface PreferenceRow {
  pref_key: string;
  pref_value: string;
}

export const WebSearchConfigSchema = z.object({
  defaultProvider: z.string().min(1),
  includeDate: z.boolean(),
  resultCount: z.number().int().min(1).max(20),
  compressionMethod: z.enum(['none', 'summary', 'extract']),
  blacklist: z.string(),
  providerEnabled: z.record(z.boolean()),
  providerApiKey: z.record(z.string()),
  providerEndpoint: z.record(z.string()),
});

export const WebSearchConfigPatchSchema = WebSearchConfigSchema.partial();

export const BrowserRuntimePreferencesSchema = z.object({
  defaultProvider: z.enum(['embedded-first', 'external-preferred', 'external-only']),
  defaultWorkspaceMode: z.enum(['exclusive', 'global-shared']),
  allowManualAttach: z.boolean(),
  allowSharedContribution: z.boolean(),
  externalBrowserMode: z.enum(['system-default', 'configured']),
  externalBrowserExecutable: z.string(),
});

export const BrowserRuntimePreferencesPatchSchema = BrowserRuntimePreferencesSchema.partial();

export const AppPreferencesSchema = z.object({
  uiLocale: z.enum(['zh-CN', 'en-US']),
  reportLocale: z.enum(['zh-CN', 'en-US']),
  themeMode: z.enum(['system', 'midnight', 'paper', 'sea']),
  defaultModel: z.string().optional(),
  maxTurns: z.number().int().min(0).max(100),
  compactThresholdTokens: z.number().int().min(10_000).max(500_000),
  webSearch: WebSearchConfigSchema,
  browserRuntime: BrowserRuntimePreferencesSchema,
});

export const AppPreferencesPatchSchema = z.object({
  uiLocale: z.enum(['zh-CN', 'en-US']).optional(),
  reportLocale: z.enum(['zh-CN', 'en-US']).optional(),
  themeMode: z.enum(['system', 'midnight', 'paper', 'sea']).optional(),
  defaultModel: z.string().optional(),
  maxTurns: z.number().int().min(0).max(100).optional(),
  compactThresholdTokens: z.number().int().min(10_000).max(500_000).optional(),
  webSearch: WebSearchConfigPatchSchema.optional(),
  browserRuntime: BrowserRuntimePreferencesPatchSchema.optional(),
});

export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;
export type WebSearchConfigPatch = z.infer<typeof WebSearchConfigPatchSchema>;
export type BrowserRuntimePreferences = z.infer<typeof BrowserRuntimePreferencesSchema>;
export type BrowserRuntimePreferencesPatch = z.infer<typeof BrowserRuntimePreferencesPatchSchema>;
export type AppPreferences = z.infer<typeof AppPreferencesSchema>;
export type AppPreferencesPatch = z.infer<typeof AppPreferencesPatchSchema>;

export function createDefaultWebSearchConfig(): WebSearchConfig {
  return {
    defaultProvider: 'searxng',
    includeDate: true,
    resultCount: 5,
    compressionMethod: 'none',
    blacklist: '',
    providerEnabled: {},
    providerApiKey: {},
    providerEndpoint: {},
  };
}

export function createDefaultBrowserRuntimePreferences(): BrowserRuntimePreferences {
  return {
    defaultProvider: 'embedded-first',
    defaultWorkspaceMode: 'exclusive',
    allowManualAttach: true,
    allowSharedContribution: true,
    externalBrowserMode: 'system-default',
    externalBrowserExecutable: '',
  };
}

export function createDefaultAppPreferences(): AppPreferences {
  return {
    uiLocale: 'zh-CN',
    reportLocale: 'zh-CN',
    themeMode: 'system',
    defaultModel: undefined,
    maxTurns: 30,
    compactThresholdTokens: 80_000,
    webSearch: createDefaultWebSearchConfig(),
    browserRuntime: createDefaultBrowserRuntimePreferences(),
  };
}

function parsePreferenceValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeWebSearchConfig(input: unknown): WebSearchConfig {
  const defaults = createDefaultWebSearchConfig();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return defaults;
  }

  const source = input as Partial<WebSearchConfig>;
  return WebSearchConfigSchema.parse({
    ...defaults,
    ...source,
    providerEnabled: source.providerEnabled ?? defaults.providerEnabled,
    providerApiKey: source.providerApiKey ?? defaults.providerApiKey,
    providerEndpoint: source.providerEndpoint ?? defaults.providerEndpoint,
  });
}

function normalizeBrowserRuntimePreferences(input: unknown): BrowserRuntimePreferences {
  const defaults = createDefaultBrowserRuntimePreferences();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return defaults;
  }

  const source = input as Partial<BrowserRuntimePreferences>;
  return BrowserRuntimePreferencesSchema.parse({
    ...defaults,
    ...source,
  });
}

export async function loadAppPreferences(store: PreferencesReadStore): Promise<AppPreferences> {
  const rows = await store.all<PreferenceRow>(`SELECT pref_key, pref_value FROM preferences`);
  const raw: Record<string, unknown> = {};

  for (const row of rows) {
    raw[row.pref_key] = parsePreferenceValue(row.pref_value);
  }

  const defaults = createDefaultAppPreferences();
  return AppPreferencesSchema.parse({
    ...defaults,
    ...raw,
    webSearch: normalizeWebSearchConfig(raw.webSearch),
    browserRuntime: normalizeBrowserRuntimePreferences(raw.browserRuntime),
  });
}

export async function savePreferencesPatch(store: PreferencesWriteStore, patch: AppPreferencesPatch): Promise<AppPreferences> {
  const current = await loadAppPreferences(store);
  const merged = AppPreferencesSchema.parse({
    ...current,
    ...patch,
    webSearch: patch.webSearch
      ? normalizeWebSearchConfig({
          ...current.webSearch,
          ...patch.webSearch,
          providerEnabled: patch.webSearch.providerEnabled
            ? { ...current.webSearch.providerEnabled, ...patch.webSearch.providerEnabled }
            : current.webSearch.providerEnabled,
          providerApiKey: patch.webSearch.providerApiKey
            ? { ...current.webSearch.providerApiKey, ...patch.webSearch.providerApiKey }
            : current.webSearch.providerApiKey,
          providerEndpoint: patch.webSearch.providerEndpoint
            ? { ...current.webSearch.providerEndpoint, ...patch.webSearch.providerEndpoint }
            : current.webSearch.providerEndpoint,
        })
      : current.webSearch,
    browserRuntime: patch.browserRuntime
      ? normalizeBrowserRuntimePreferences({
          ...current.browserRuntime,
          ...patch.browserRuntime,
        })
      : current.browserRuntime,
  });

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const storedValue = key === 'webSearch' ? merged.webSearch : merged[key as keyof AppPreferences];
    await store.run(
      `INSERT INTO preferences(pref_key, pref_value, updated_at) VALUES(?, ?, datetime('now'))
       ON CONFLICT(pref_key) DO UPDATE SET pref_value=excluded.pref_value, updated_at=datetime('now')`,
      [key, JSON.stringify(storedValue)],
    );
  }

  return merged;
}

function maskSecret(value: string): string {
  if (!value) {
    return value;
  }
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
}

export function maskWebSearchConfig(config: WebSearchConfig): WebSearchConfig {
  return {
    ...config,
    providerApiKey: Object.fromEntries(
      Object.entries(config.providerApiKey).map(([providerId, apiKey]) => [providerId, maskSecret(apiKey)]),
    ),
  };
}

export function maskAppPreferences(config: AppPreferences): AppPreferences {
  return {
    ...config,
    webSearch: maskWebSearchConfig(config.webSearch),
  };
}