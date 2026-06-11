import {
  MockProvider,
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
  type IStructuredStore,
  type LLMAdapter,
  type MockScript,
} from '@risk-agent/core';

type PersistedModelProvider =
  | 'openai'
  | 'openai-compatible'
  | 'openrouter'
  | 'azure-openai'
  | 'anthropic'
  | 'anthropic-compatible'
  | 'ollama'
  | 'mock'
  | 'google'
  | 'bedrock';

interface PersistedModelRow {
  provider: PersistedModelProvider;
  model_name: string;
  config_json: string | null;
  is_default?: number;
  created_at?: string;
}

export interface ModelRuntimeSettings {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

export interface ResolvedLLMRuntime {
  adapter: LLMAdapter;
  model: string;
  provider: string;
  source: 'database' | 'environment';
  settings: ModelRuntimeSettings;
}

/**
 * buildLLMAdapter — 按环境变量选择 LLM 供应商。
 * 优先级: ANTHROPIC → OPENAI → OLLAMA → Mock（开发兜底）。
 */
export function buildLLMAdapter(): LLMAdapter {
  return buildEnvLLMRuntime().adapter;
}

export function buildRuntimeFromStoredModel(row: PersistedModelRow): ResolvedLLMRuntime | null {
  return buildRuntimeFromRow(row);
}

export async function buildConfiguredLLMRuntime(store: IStructuredStore, modelId?: string): Promise<ResolvedLLMRuntime> {
  if (modelId) {
    // First try the exact requested model
    const rows = await store.all<PersistedModelRow>(
      `SELECT provider, model_name, config_json FROM model_configs WHERE model_id=? AND enabled=1 LIMIT 1`,
      [modelId]
    );
    for (const row of rows) {
      const runtime = buildRuntimeFromRow(row);
      if (runtime) return runtime;

      // If the model exists but has no apiKey, try to inherit from another enabled model
      // with the same provider+baseUrl (allows sharing API keys across model aliases)
      const cfg = safeParseConfig(row.config_json);
      const baseUrl = readString(cfg.baseUrl);
      if (baseUrl && !readString(cfg.apiKey)) {
        const siblings = await store.all<PersistedModelRow>(
          `SELECT provider, model_name, config_json FROM model_configs
           WHERE provider=? AND enabled=1 AND model_id != ?
           ORDER BY is_default DESC, created_at DESC`,
          [row.provider, modelId]
        );
        for (const sibling of siblings) {
          const sibCfg = safeParseConfig(sibling.config_json);
          const sibBaseUrl = readString(sibCfg.baseUrl);
          const sibApiKey = readString(sibCfg.apiKey);
          if (sibApiKey && sibBaseUrl === baseUrl) {
            // Build with inherited API key but keep original model name
            const inherited = buildRuntimeFromRow({
              provider: row.provider,
              model_name: row.model_name,
              config_json: JSON.stringify({ ...cfg, apiKey: sibApiKey }),
            });
            if (inherited) return inherited;
          }
        }
      }
    }
  }

  // No specific modelId, or failed: try all enabled models ordered by priority
  if (!modelId) {
    const rows = await store.all<PersistedModelRow>(
      `SELECT provider, model_name, config_json, is_default, created_at
       FROM model_configs
       WHERE enabled=1
       ORDER BY created_at DESC`,
    );
    for (const row of rankPersistedModelRows(rows)) {
      const runtime = buildRuntimeFromRow(row);
      if (runtime) return runtime;
    }
  }

  return buildEnvLLMRuntime();
}

function buildEnvLLMRuntime(): ResolvedLLMRuntime {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      adapter: new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL
      }),
      model: process.env.RISK_AGENT_MODEL ?? 'claude-sonnet-4-5',
      provider: 'anthropic',
      source: 'environment',
      settings: {},
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      adapter: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL
      }),
      model: process.env.RISK_AGENT_MODEL ?? 'gpt-4o-mini',
      provider: 'openai',
      source: 'environment',
      settings: {},
    };
  }
  if (process.env.OLLAMA_MODEL) {
    return {
      adapter: new OllamaProvider({ baseUrl: process.env.OLLAMA_BASE_URL }),
      model: process.env.OLLAMA_MODEL,
      provider: 'ollama',
      source: 'environment',
      settings: {},
    };
  }
  return {
    adapter: new MockProvider(),
    model: process.env.RISK_AGENT_MODEL ?? 'mock',
    provider: 'mock',
    source: 'environment',
    settings: {},
  };
}

function buildRuntimeFromRow(row: PersistedModelRow): ResolvedLLMRuntime | null {
  const config = safeParseConfig(row.config_json);
  const settings = readRuntimeSettings(config);
  switch (row.provider) {
    case 'openai':
    case 'openai-compatible':
    case 'openrouter':
    case 'azure-openai': {
      const apiKey = readString(config.apiKey) ?? process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      return {
        adapter: new OpenAIProvider({
          apiKey,
          baseUrl: readString(config.baseUrl) ?? process.env.OPENAI_BASE_URL,
        }),
        model: row.model_name,
        provider: row.provider,
        source: 'database',
        settings,
      };
    }
    case 'anthropic':
    case 'anthropic-compatible': {
      const apiKey = readString(config.apiKey) ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return null;
      return {
        adapter: new AnthropicProvider({
          apiKey,
          baseUrl: readString(config.baseUrl) ?? process.env.ANTHROPIC_BASE_URL,
        }),
        model: row.model_name,
        provider: row.provider,
        source: 'database',
        settings,
      };
    }
    case 'ollama':
      return {
        adapter: new OllamaProvider({
          baseUrl: readString(config.baseUrl) ?? process.env.OLLAMA_BASE_URL,
        }),
        model: row.model_name,
        provider: row.provider,
        source: 'database',
        settings,
      };
    case 'mock':
      return {
        adapter: new MockProvider(readMockScripts(config.scripts)),
        model: row.model_name,
        provider: row.provider,
        source: 'database',
        settings,
      };
    default:
      return null;
  }
}

function safeParseConfig(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readRuntimeSettings(config: Record<string, unknown>): ModelRuntimeSettings {
  return {
    temperature: readNumber(config.temperature),
    maxTokens: readNumber(config.maxTokens),
    topP: readNumber(config.topP),
    presencePenalty: readNumber(config.presencePenalty),
    frequencyPenalty: readNumber(config.frequencyPenalty),
  };
}

function readMockScripts(value: unknown): MockScript[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const scripts = value
    .map((entry): MockScript | null => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const toolCalls = Array.isArray(raw.toolCalls)
        ? raw.toolCalls
            .map((call) => {
              if (!call || typeof call !== 'object') return null;
              const tool = call as Record<string, unknown>;
              return typeof tool.name === 'string'
                ? { name: tool.name, input: tool.input ?? {} }
                : null;
            })
            .filter((call): call is NonNullable<typeof call> => call !== null)
        : undefined;

      return {
        text: typeof raw.text === 'string' ? raw.text : undefined,
        toolCalls,
        stopReason:
          raw.stopReason === 'tool_use' || raw.stopReason === 'end_turn' || raw.stopReason === 'max_tokens'
            ? raw.stopReason
            : undefined,
      };
    })
    .filter((script): script is MockScript => script !== null);

  return scripts.length > 0 ? scripts : undefined;
}

function rankPersistedModelRows(rows: PersistedModelRow[]): PersistedModelRow[] {
  return [...rows].sort((left, right) => {
    return comparePreference(isMockRow(left), isMockRow(right))
      || comparePreference(!Boolean(left.is_default), !Boolean(right.is_default))
      || comparePreference(isOllamaRow(left), isOllamaRow(right))
      || comparePreference(isOpenRouterFreeRow(left), isOpenRouterFreeRow(right));
  });
}

function isMockRow(row: PersistedModelRow): boolean {
  return row.provider === 'mock';
}

function isOllamaRow(row: PersistedModelRow): boolean {
  return row.provider === 'ollama';
}

function isOpenRouterFreeRow(row: PersistedModelRow): boolean {
  return row.provider === 'openrouter' && row.model_name.trim().toLowerCase().endsWith(':free');
}

function comparePreference(left: boolean, right: boolean): number {
  return Number(left) - Number(right);
}
