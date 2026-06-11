import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LLMCallOptions } from '@risk-agent/core';
import type { AppContext } from '../index.js';

const MODEL_PROVIDERS = [
  'openai',
  'openai-compatible',
  'openrouter',
  'anthropic',
  'anthropic-compatible',
  'ollama',
  'azure-openai',
  'google',
  'bedrock',
  'mock',
] as const;

const ModelConfigSchema = z.object({
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
}).catchall(z.unknown());

const ModelSchema = z.object({
  provider: z.enum(MODEL_PROVIDERS),
  modelName: z.string().trim().min(1),
  role: z.string().optional(),
  config: ModelConfigSchema.default({}),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional()
});

const ModelTestSchema = z.object({
  prompt: z.string().trim().min(1).default('请用中文输出一段 Markdown 风险摘要，并附带一个无序列表。'),
  systemPrompt: z.string().trim().min(1).default('You are a helpful risk analysis assistant.'),
  mode: z.enum(['connect', 'call', 'stream']).default('connect'),
});

const ModelDiscoverySchema = z.object({
  provider: z.enum(MODEL_PROVIDERS),
  baseUrl: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
});

interface StoredModelRow {
  model_id: string;
  provider: (typeof MODEL_PROVIDERS)[number];
  model_name: string;
  role: string | null;
  config_json: string | null;
  enabled: number;
  is_default: number;
  created_at: string;
}

export function registerModelRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.get('/api/models', async () => {
    const rows = await store.all<StoredModelRow>(`SELECT * FROM model_configs ORDER BY is_default DESC, created_at DESC`);
    return rows.map(serialize);
  });

  app.post('/api/models/discover', async (req, reply) => {
    const parsed = ModelDiscoverySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    try {
      const storedApiKey = parsed.data.modelId
        ? readStoredApiKey(await loadModel(store, parsed.data.modelId))
        : undefined;
      const models = await discoverProviderModels({
        provider: parsed.data.provider,
        baseUrl: parsed.data.baseUrl,
        apiKey: parsed.data.apiKey?.trim() || storedApiKey,
      });
      return { models };
    } catch (error: any) {
      return reply.code(502).send({
        error: 'model_discovery_failed',
        message: error?.message ?? '模型目录获取失败',
      });
    }
  });

  app.post('/api/models', async (req, reply) => {
    const parsed = ModelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const id = randomUUID();
    if (parsed.data.isDefault) {
      await store.run(`UPDATE model_configs SET is_default=0`);
    }
    await store.run(
      `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default) VALUES(?,?,?,?,?,?,?)`,
      [id, parsed.data.provider, parsed.data.modelName, parsed.data.role ?? null, JSON.stringify(parsed.data.config), parsed.data.enabled !== false ? 1 : 0, parsed.data.isDefault ? 1 : 0]
    );
    reply.code(201).send({ modelId: id });
  });

  app.put('/api/models/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ModelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    const existing = await loadModel(store, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    if (parsed.data.isDefault) {
      await store.run(`UPDATE model_configs SET is_default=0`);
    }

    const mergedConfig = mergeModelConfig(safeParseConfig(existing.config_json), parsed.data.config);

    await store.run(
      `UPDATE model_configs
       SET provider=?, model_name=?, role=?, config_json=?, enabled=?, is_default=?
       WHERE model_id=?`,
      [
        parsed.data.provider,
        parsed.data.modelName,
        parsed.data.role ?? null,
        JSON.stringify(mergedConfig),
        parsed.data.enabled !== false ? 1 : 0,
        parsed.data.isDefault ? 1 : 0,
        id,
      ]
    );

    const updated = await loadModel(store, id);
    reply.send(updated ? serialize(updated) : { modelId: id });
  });

  app.post('/api/models/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ModelTestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    const existing = await loadModel(store, id);
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const { buildRuntimeFromStoredModel } = await import('../llm/factory.js');
    const runtime = buildRuntimeFromStoredModel({
      provider: existing.provider,
      model_name: existing.model_name,
      config_json: existing.config_json,
    });

    if (!runtime) {
      return reply.send({
        success: false,
        mode: parsed.data.mode,
        provider: existing.provider,
        modelName: existing.model_name,
        error: '当前模型配置不完整，缺少可用的凭据或连接参数。',
      });
    }

    const startedAt = Date.now();
    try {
      if (parsed.data.mode === 'connect') {
        const connectivity = await testModelConnectivity(existing);
        return reply.send({
          success: true,
          mode: parsed.data.mode,
          provider: existing.provider,
          modelName: existing.model_name,
          text: connectivity.message,
          durationMs: Date.now() - startedAt,
          statusCode: connectivity.statusCode,
        });
      }

      const callOptions: LLMCallOptions = {
        model: runtime.model,
        systemPrompt: parsed.data.systemPrompt,
        messages: [{ role: 'user', content: parsed.data.prompt, timestamp: Date.now() }],
        temperature: runtime.settings.temperature,
        maxTokens: runtime.settings.maxTokens,
        topP: runtime.settings.topP,
        presencePenalty: runtime.settings.presencePenalty,
        frequencyPenalty: runtime.settings.frequencyPenalty,
      };

      let text = '';
      let stopReason = 'end_turn';
      let chunkCount = 0;
      let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 };

      if (parsed.data.mode === 'stream' && runtime.adapter.stream) {
        for await (const chunk of runtime.adapter.stream(callOptions)) {
          if (chunk.type === 'text_delta') {
            text += chunk.text;
            chunkCount += 1;
          }
          if (chunk.type === 'message_stop') {
            stopReason = chunk.stopReason;
            usage = chunk.usage;
          }
        }
      } else {
        const result = await runtime.adapter.call(callOptions);
        text = result.text;
        stopReason = result.stopReason;
        usage = result.usage;
        chunkCount = text ? 1 : 0;
      }

      reply.send({
        success: true,
        mode: parsed.data.mode,
        provider: runtime.provider,
        modelName: runtime.model,
        text,
        stopReason,
        chunkCount,
        usage,
        durationMs: Date.now() - startedAt,
      });
    } catch (error: any) {
      reply.send({
        success: false,
        mode: parsed.data.mode,
        provider: existing.provider,
        modelName: existing.model_name,
        error: error?.message ?? '模型测试失败',
        durationMs: Date.now() - startedAt,
      });
    }
  });

  app.delete('/api/models/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await store.run(`DELETE FROM model_configs WHERE model_id=?`, [id]);
    reply.code(204).send();
  });
}

function serialize(r: StoredModelRow) {
  const config = redactSensitiveConfig(safeParseConfig(r.config_json));
  return {
    modelId: r.model_id,
    provider: r.provider,
    modelName: r.model_name,
    role: r.role,
    config,
    enabled: !!r.enabled,
    isDefault: !!r.is_default,
    createdAt: r.created_at
  };
}

async function loadModel(store: AppContext['storage']['getStructuredStore'] extends () => infer T ? T : never, id: string): Promise<StoredModelRow | undefined> {
  return store.get<StoredModelRow>(`SELECT * FROM model_configs WHERE model_id=?`, [id]);
}

function safeParseConfig(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function redactSensitiveConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  if (typeof next.apiKey === 'string' && next.apiKey.trim()) {
    next.apiKeyMasked = maskSecret(next.apiKey);
    delete next.apiKey;
  }
  return next;
}

function mergeModelConfig(previous: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const next = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'apiKey') {
      if (typeof value === 'string' && value.trim()) {
        next.apiKey = value.trim();
      }
      continue;
    }
    next[key] = value;
  }
  return next;
}

function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) {
    return '••••••';
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function readStoredApiKey(row: StoredModelRow | undefined): string | undefined {
  if (!row) return undefined;
  const config = safeParseConfig(row.config_json);
  return typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : undefined;
}

type ProviderId = (typeof MODEL_PROVIDERS)[number];

interface ModelConnectivityResult {
  statusCode: number;
  message: string;
}

interface ModelDiscoveryInput {
  provider: ProviderId;
  baseUrl: string;
  apiKey?: string;
}

interface DiscoveredModelRecord {
  id: string;
  label: string;
}

async function discoverProviderModels(input: ModelDiscoveryInput): Promise<DiscoveredModelRecord[]> {
  if (input.provider === 'mock') {
    return [];
  }

  const request = buildDiscoveryRequest(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const json = await response.json() as Record<string, unknown>;
    return normalizeDiscoveredModels(input.provider, json);
  } finally {
    clearTimeout(timeout);
  }
}

async function testModelConnectivity(row: StoredModelRow): Promise<ModelConnectivityResult> {
  const config = safeParseConfig(row.config_json);
  const provider = row.provider;

  if (provider === 'mock') {
    return { statusCode: 200, message: 'Connected successfully (mock provider)' };
  }

  if (provider === 'ollama') {
    return postConnectivityRequest({
      url: joinHttpUrl(readModelBaseUrl(provider, config), '/api/chat'),
      headers: { 'Content-Type': 'application/json' },
      body: {
        model: row.model_name,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }],
        options: { num_predict: 8 },
      },
    });
  }

  if (provider === 'anthropic' || provider === 'anthropic-compatible') {
    const apiKey = readModelApiKey(provider, config);
    return postConnectivityRequest({
      url: joinHttpUrl(ensureBasePath(readModelBaseUrl(provider, config), '/v1'), '/messages'),
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? {
          'x-api-key': apiKey,
          Authorization: `Bearer ${apiKey}`,
        } : {}),
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: row.model_name,
        max_tokens: 8,
        stream: false,
        messages: [{ role: 'user', content: 'ping' }],
      },
    });
  }

  if (provider === 'google') {
    const apiKey = readModelApiKey(provider, config);
    return postConnectivityRequest({
      url: `${readModelBaseUrl(provider, config).replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(row.model_name)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      },
    });
  }

  if (provider === 'bedrock') {
    throw new Error('Bedrock connectivity check is not implemented yet');
  }

  const apiKey = readModelApiKey(provider, config);
  const baseUrl = provider === 'openai-compatible' || provider === 'openrouter'
    ? readModelBaseUrl(provider, config)
    : ensureBasePath(readModelBaseUrl(provider, config), '/v1');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://risk-agent.local';
    headers['X-Title'] = 'risk-agent';
  }

  return postConnectivityRequest({
    url: joinHttpUrl(baseUrl, '/chat/completions'),
    headers,
    body: {
      model: row.model_name,
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
      max_tokens: 8,
    },
  });
}

async function postConnectivityRequest(input: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}): Promise<ModelConnectivityResult> {
  const response = await fetch(input.url, {
    method: 'POST',
    headers: input.headers,
    body: JSON.stringify(input.body),
  });

  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    throw new Error(`Connection failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }

  return {
    statusCode: response.status,
    message: `Connected successfully (${response.status})`,
  };
}

function readModelBaseUrl(provider: ProviderId, config: Record<string, unknown>): string {
  const configured = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (configured) {
    return configured;
  }
  if (provider === 'ollama') {
    return process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }
  if (provider === 'anthropic' || provider === 'anthropic-compatible') {
    return process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
  }
  return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com';
}

function readModelApiKey(provider: ProviderId, config: Record<string, unknown>): string {
  const configured = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  if (configured) {
    return configured;
  }
  if (provider === 'anthropic' || provider === 'anthropic-compatible') {
    return process.env.ANTHROPIC_API_KEY ?? '';
  }
  return process.env.OPENAI_API_KEY ?? '';
}

function buildDiscoveryRequest(input: ModelDiscoveryInput): { url: string; headers: Record<string, string> } {
  const provider = input.provider;
  const apiKey = input.apiKey?.trim();

  if (provider === 'anthropic' || provider === 'anthropic-compatible') {
    return {
      url: joinHttpUrl(ensureBasePath(input.baseUrl, '/v1'), '/models'),
      headers: {
        Accept: 'application/json',
        ...(apiKey ? {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        } : {}),
      },
    };
  }

  if (provider === 'ollama') {
    return {
      url: joinHttpUrl(input.baseUrl, '/api/tags'),
      headers: { Accept: 'application/json' },
    };
  }

  return {
    url: joinHttpUrl(input.baseUrl, '/models'),
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  };
}

function normalizeDiscoveredModels(provider: ProviderId, json: Record<string, unknown>): DiscoveredModelRecord[] {
  if (provider === 'ollama') {
    const models = Array.isArray(json.models) ? json.models : [];
    return dedupeDiscoveredModels(
      models
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const id = readFirstString(item as Record<string, unknown>, ['model', 'name']);
          return id ? { id, label: id } : null;
        })
        .filter((item): item is DiscoveredModelRecord => Boolean(item))
    );
  }

  const data = Array.isArray(json.data) ? json.data : [];
  return dedupeDiscoveredModels(
    data
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = readFirstString(record, ['id']);
        if (!id) return null;
        const label = readFirstString(record, ['display_name', 'name']) ?? id;
        return { id, label };
      })
      .filter((item): item is DiscoveredModelRecord => Boolean(item))
  );
}

function dedupeDiscoveredModels(models: DiscoveredModelRecord[]): DiscoveredModelRecord[] {
  const seen = new Set<string>();
  const result: DiscoveredModelRecord[] = [];
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
  }
  return result;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function ensureBasePath(baseUrl: string, suffix: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.toLowerCase().endsWith(suffix.toLowerCase())) {
    return normalized;
  }
  return `${normalized}${suffix}`;
}

function joinHttpUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300).trim();
  } catch {
    return '';
  }
}
