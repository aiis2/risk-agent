import { loadAppPreferences } from './appPreferences.js';

interface StructuredStoreLike {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface RuntimePreferences {
  maxTurns: number;
  compactThresholdTokens: number;
}

export async function loadRuntimePreferences(store: StructuredStoreLike): Promise<RuntimePreferences> {
  const preferences = await loadAppPreferences(store);
  return {
    maxTurns: preferences.maxTurns,
    compactThresholdTokens: preferences.compactThresholdTokens,
  };
}