import { fetch } from 'undici';
import type {
  LLMAdapter,
  LLMCallOptions,
  LLMCallResult,
  LLMStreamChunk,
  LLMStreamOptions,
} from '../LLMAdapter.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  pricing?: { inputUsdPer1k?: number; outputUsdPer1k?: number };
  extraHeaders?: Record<string, string>;
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENROUTER_REFERER = 'https://risk-agent.local';
const DEFAULT_OPENROUTER_TITLE = 'risk-agent';

/**
 * 提取 MCP 工具结果中的纯文本内容。
 * MCP 格式：{ content: [{ type: 'text', text: '...' }] } 或原始字符串/对象。
 */
function extractMcpTextContent(result: unknown): string {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['content'])) {
      const texts = (r['content'] as unknown[])
        .filter((item: unknown): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && (item as Record<string, unknown>)['type'] === 'text')
        .map((item) => String(item['text'] ?? ''))
        .join('\n');
      if (texts) return texts;
      // 如果只有图片（无文本），返回占位描述
      const hasImages = (r['content'] as unknown[]).some(
        (item: unknown) => !!item && typeof item === 'object' && (item as Record<string, unknown>)['type'] === 'image'
      );
      if (hasImages) return '[Screenshot captured — see image content above]';
    }
  }
  if (typeof result === 'string') return result;
  return JSON.stringify(result);
}

/**
 * 提取 MCP 工具结果中的图片内容，转换为 OpenAI image_url content 块。
 */
function extractMcpImageBlocks(result: unknown): Array<{ type: 'image_url'; image_url: { url: string } }> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['content'])) {
      return (r['content'] as unknown[])
        .filter((item: unknown): item is Record<string, unknown> =>
          !!item && typeof item === 'object' &&
          (item as Record<string, unknown>)['type'] === 'image' &&
          typeof (item as Record<string, unknown>)['data'] === 'string')
        .map((item) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:${item['mimeType'] ?? 'image/png'};base64,${item['data']}`,
          },
        }));
    }
  }
  return [];
}

export class OpenAIProvider implements LLMAdapter {
  readonly providerId = 'openai';
  private readonly baseUrl: string;

  constructor(private readonly opts: OpenAIProviderOptions) {
    this.baseUrl = normalizeOpenAICompatibleBaseUrl(opts.baseUrl);
  }

  private buildHeaders(accept?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(accept ? { accept } : {}),
      authorization: `Bearer ${this.opts.apiKey}`,
      ...resolveOpenAICompatibleHeaders(this.baseUrl, this.opts.extraHeaders),
    };
  }

  private buildBody(opts: LLMCallOptions, stream = false): { body: Record<string, unknown>; toolNameMap: Map<string, string> } {
    const { tools: toolSpecs, toolNameMap } = prepareToolSpecs(opts.tools);
    // 反向映射：原始工具名 → wire 名（用于构建历史 tool_calls）
    const reverseToolNameMap = new Map<string, string>(
      Array.from(toolNameMap.entries()).map(([wire, orig]) => [orig, wire])
    );

    const messages: unknown[] = [{ role: 'system', content: opts.systemPrompt }];

    for (const message of opts.messages) {
      if (message.role === 'system') continue;

      if (message.role === 'assistant') {
        // 构建 OpenAI assistant 消息（含 tool_calls）
        const msg: Record<string, unknown> = {
          role: 'assistant',
          content: message.content || null,
        };
        if (typeof message.reasoningContent === 'string' && message.reasoningContent.length > 0) {
          msg['reasoning_content'] = message.reasoningContent;
        }
        if (message.toolCalls?.length) {
          msg['tool_calls'] = message.toolCalls.map((tc) => ({
            id: tc.toolUseId,
            type: 'function',
            function: {
              name: reverseToolNameMap.get(tc.name) ?? sanitizeToolName(tc.name),
              arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
            },
          }));
        }
        messages.push(msg);

      } else if (message.role === 'tool') {
        if (message.toolResults?.length) {
          // 每条工具结果单独一条 tool 消息 + 可选的视觉图片 user 消息
          for (const tr of message.toolResults) {
            messages.push({
              role: 'tool',
              tool_call_id: tr.toolUseId,
              content: tr.isError
                ? `Error: ${extractMcpTextContent(tr.content)}`
                : extractMcpTextContent(tr.content),
            });
            // 图片内容作为后续 user 消息传入（OpenAI vision 格式）
            const imageBlocks = supportsVisionInput(this.baseUrl, opts.model)
              ? extractMcpImageBlocks(tr.content)
              : [];
            if (imageBlocks.length > 0) {
              messages.push({
                role: 'user',
                content: imageBlocks,
              });
            }
          }
        } else {
          // 兜底：旧格式（无 toolResults 结构）
          messages.push({ role: 'tool', content: message.content });
        }

      } else {
        messages.push({ role: message.role, content: message.content });
      }
    }

    return {
      body: {
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
        ...(opts.presencePenalty !== undefined ? { presence_penalty: opts.presencePenalty } : {}),
        ...(opts.frequencyPenalty !== undefined ? { frequency_penalty: opts.frequencyPenalty } : {}),
        messages,
        tools: toolSpecs.length
          ? toolSpecs.map((tool) => ({
              type: 'function',
              function: {
                name: tool.wireName,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            }))
          : undefined,
        ...(stream
          ? {
              stream: true,
              stream_options: { include_usage: true },
            }
          : {}),
        ...buildQwenThinkingParams(opts.model, opts.maxTokens, opts.enableThinking),
      },
      toolNameMap,
    };
  }

  async call(opts: LLMCallOptions): Promise<LLMCallResult> {
    const { body, toolNameMap } = this.buildBody(opts);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: opts.signal
    });
    await ensureSuccessfulResponse(res);
    const json = (await res.json()) as any;
    const choice = json.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const text = typeof msg.content === 'string' ? msg.content : '';
    const reasoningContent = readReasoningContent(msg);
    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((tc: any) => ({
          toolUseId: tc.id,
          name: resolveToolName(tc.function?.name, toolNameMap),
          input: safeParse(tc.function?.arguments)
        }))
      : [];
    const usage = json.usage ?? {};
    const inputTokens = Number(usage.prompt_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? 0);
    const inCost = (this.opts.pricing?.inputUsdPer1k ?? 0) * (inputTokens / 1000);
    const outCost = (this.opts.pricing?.outputUsdPer1k ?? 0) * (outputTokens / 1000);
    return {
      text,
      reasoningContent,
      toolCalls,
      stopReason: toolCalls.length ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
      usage: { inputTokens, outputTokens, cachedTokens: 0, estimatedUsd: inCost + outCost }
    };
  }

  async *stream(opts: LLMStreamOptions): AsyncIterable<LLMStreamChunk> {
    const { body, toolNameMap } = this.buildBody(opts, true);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders('text/event-stream'),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    await ensureSuccessfulResponse(res);
    if (!res.body) {
      throw new Error('OpenAI-compatible stream response body is empty');
    }

    const decoder = new TextDecoder();
    const toolCalls = new Map<number, { toolUseId: string; name: string; argumentsText: string }>();

    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = 'end_turn';
    let sawDone = false;

    const reader = res.body.getReader();
    try {
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = normalizeSseBuffer(buffer);
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventBlock of events) {
          const data = extractSseData(eventBlock);
          if (!data) {
            continue;
          }
          if (data === '[DONE]') {
            sawDone = true;
            break;
          }

          let payload: any;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = payload.choices?.[0];
          const delta = choice?.delta ?? {};

          const reasoningDelta = readReasoningContent(delta);
          if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
            yield { type: 'thinking_delta', index: 0, text: reasoningDelta };
          }

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            yield { type: 'text_delta', index: 0, text: delta.content };
          }

          for (const toolCall of delta.tool_calls ?? []) {
            const index = Number(toolCall.index ?? 0);
            const existing = toolCalls.get(index) ?? {
              toolUseId: '',
              name: '',
              argumentsText: '',
            };

            if (typeof toolCall.id === 'string' && toolCall.id.length > 0) {
              existing.toolUseId = toolCall.id;
            }
            if (typeof toolCall.function?.name === 'string' && toolCall.function.name.length > 0) {
              existing.name = resolveToolName(toolCall.function.name, toolNameMap);
            }
            if (typeof toolCall.function?.arguments === 'string' && toolCall.function.arguments.length > 0) {
              existing.argumentsText += toolCall.function.arguments;
            }

            toolCalls.set(index, existing);
          }

          if (payload.usage) {
            inputTokens = Number(payload.usage.prompt_tokens ?? inputTokens);
            outputTokens = Number(payload.usage.completion_tokens ?? outputTokens);
          }

          const finishReason = choice?.finish_reason;
          if (typeof finishReason === 'string' && finishReason.length > 0) {
            stopReason =
              finishReason === 'tool_calls'
                ? 'tool_use'
                : finishReason === 'length'
                ? 'max_tokens'
                : 'end_turn';
          }
        }
      }
    } finally {
      if (sawDone) {
        await reader.cancel().catch(() => undefined);
      }
    }

    for (const [index, toolCall] of toolCalls) {
      yield {
        type: 'content_block_stop',
        blockType: 'tool_use',
        index,
        toolBlock: {
          toolUseId: toolCall.toolUseId,
          name: toolCall.name,
          input: safeParse(toolCall.argumentsText),
        },
      };
    }

    yield {
      type: 'message_stop',
      stopReason,
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        estimatedUsd: 0,
      },
    };
  }
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? DEFAULT_OPENAI_BASE_URL).trim();
  if (!normalized) return DEFAULT_OPENAI_BASE_URL;

  try {
    const url = new URL(normalized);
    if (url.hostname === 'openrouter.ai' && (url.pathname === '' || url.pathname === '/')) {
      url.pathname = '/api/v1';
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return normalized.replace(/\/+$/, '') || DEFAULT_OPENAI_BASE_URL;
  }
}

export function resolveOpenAICompatibleHeaders(
  baseUrl: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers = { ...(extraHeaders ?? {}) };
  if (!isOpenRouterBaseUrl(baseUrl)) {
    return headers;
  }

  if (!hasHeader(headers, 'HTTP-Referer')) {
    headers['HTTP-Referer'] = DEFAULT_OPENROUTER_REFERER;
  }
  if (!hasHeader(headers, 'X-Title')) {
    headers['X-Title'] = DEFAULT_OPENROUTER_TITLE;
  }
  return headers;
}

async function ensureSuccessfulResponse(res: {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}): Promise<void> {
  if (res.ok) {
    return;
  }

  let message = `OpenAI-compatible request failed with status ${res.status}`;
  try {
    const payload = (await res.json()) as any;
    const apiMessage = payload?.error?.message ?? payload?.message;
    if (typeof apiMessage === 'string' && apiMessage.trim()) {
      message = apiMessage.trim();
    }
  } catch {
    try {
      const text = await res.text();
      if (text.trim()) {
        message = text.trim();
      }
    } catch {
      // ignore body parsing failure and fall back to the status message above
    }
  }

  throw new Error(message);
}

function prepareToolSpecs(tools: LLMCallOptions['tools']): {
  tools: Array<{ wireName: string; description: string; inputSchema: Record<string, unknown> }>;
  toolNameMap: Map<string, string>;
} {
  const toolNameMap = new Map<string, string>();
  const usedNames = new Set<string>();
  const prepared = (tools ?? []).map((tool) => {
    const wireName = dedupeToolName(sanitizeToolName(tool.name), usedNames);
    toolNameMap.set(wireName, tool.name);
    return {
      wireName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  });

  return { tools: prepared, toolNameMap };
}

function readReasoningContent(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record['reasoning_content'] === 'string' && record['reasoning_content'].length > 0) {
    return record['reasoning_content'];
  }
  if (typeof record['reasoning'] === 'string' && record['reasoning'].length > 0) {
    return record['reasoning'];
  }
  return undefined;
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai';
  } catch {
    return false;
  }
}

function supportsVisionInput(baseUrl: string, model?: string): boolean {
  try {
    if (new URL(baseUrl).hostname === 'api.deepseek.com') {
      return false;
    }
  } catch {
    // ignore invalid base url and fall through to model heuristics
  }

  return !model?.toLowerCase().startsWith('deepseek');
}

/**
 * Detects Qwen3 thinking-capable models by name.
 * Qwen3 models (e.g. Qwen3-32B, Qwen3.5-397B-A17B) include thinking tokens inside
 * `max_tokens` budget — unlike DeepSeek where thinking is budgeted separately.
 * References: https://qwen.readthedocs.io/en/latest/framework/function_call.html (thinking mode)
 */
function isQwenThinkingModel(model: string): boolean {
  return /qwen3/i.test(model);
}

/**
 * Builds Qwen3-specific thinking parameters to inject into the request body.
 *
 * When `enableThinking === false`: disables thinking entirely → reliable short responses.
 * When thinking is enabled (default): caps the thinking budget so the model always has
 * room to output a real answer on top of its reasoning tokens.
 *
 * Rules from Qwen3 API docs:
 *  - `thinking_budget_tokens` range: [1024, 38912]
 *  - `max_tokens` must exceed `thinking_budget_tokens` for any output to appear
 */
function buildQwenThinkingParams(
  model: string,
  maxTokens: number | undefined,
  enableThinking: boolean | undefined,
): Record<string, unknown> {
  if (!isQwenThinkingModel(model)) return {};

  if (enableThinking === false) {
    // Caller explicitly opted out of thinking (e.g. simple conversational calls)
    return { enable_thinking: false };
  }

  // Thinking enabled: set a budget that reserves at least 1024 tokens for the actual response.
  const totalBudget = maxTokens ?? 1024;
  const maxThinkingBudget = Math.min(totalBudget - 1024, 38912);
  if (maxThinkingBudget < 1024) {
    // max_tokens is too small for thinking + meaningful output → disable thinking
    return { enable_thinking: false };
  }
  return {
    enable_thinking: true,
    thinking_budget_tokens: maxThinkingBudget,
  };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function sanitizeToolName(name: string): string {
  const sanitized = name
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  const normalized = sanitized.length > 0 ? sanitized : 'tool';
  const prefixed = /^[A-Za-z_]/.test(normalized) ? normalized : `tool_${normalized}`;
  return prefixed.slice(0, 64);
}

function dedupeToolName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }

  let index = 2;
  while (true) {
    const suffix = `_${index}`;
    const candidate = `${baseName.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

function resolveToolName(name: unknown, toolNameMap: Map<string, string>): string {
  if (typeof name !== 'string') {
    return '';
  }
  return toolNameMap.get(name) ?? name;
}

function normalizeSseBuffer(buffer: string): string {
  return buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function safeParse(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}

function extractSseData(block: string): string {
  return block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
}
