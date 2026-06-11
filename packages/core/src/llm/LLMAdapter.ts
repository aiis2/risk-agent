import type { Message } from '../agents/base/types.js';

export interface LLMResponseChunk {
  type: 'text_delta' | 'thinking_delta' | 'tool_use' | 'stop';
  text?: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  stopReason?: string;
}

// ──────────────────────────────────────────────────────────
// Streaming interface (react-loop-engine.md §3 · v1.2)
// ──────────────────────────────────────────────────────────

/**
 * LLMStreamChunk — 流式 LLM 响应的单个块。
 * 对应 Anthropic SSE 事件类型，用于 content_block_start/stop 优化。
 */
export type LLMStreamChunk =
  | { type: 'content_block_start'; blockType: 'text' | 'tool_use' | 'thinking'; index: number; toolName?: string; toolUseId?: string }
  | { type: 'content_block_stop'; blockType: 'text' | 'tool_use' | 'thinking'; index: number; toolBlock?: { toolUseId: string; name: string; input: unknown } }
  | { type: 'text_delta'; index: number; text: string }
  | { type: 'thinking_delta'; index: number; text: string }
  | { type: 'input_json_delta'; index: number; partial: string }
  | { type: 'message_stop'; stopReason: string; usage: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheCreationTokens?: number; estimatedUsd: number } };

export interface LLMStreamOptions extends Omit<LLMCallOptions, 'signal'> {
  signal?: AbortSignal;
}

// ──────────────────────────────────────────────────────────

export interface LLMCallUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Anthropic prompt caching — input tokens charged for cache write. */
  cacheCreationTokens?: number;
  estimatedUsd: number;
}

export interface LLMCallResult {
  text: string;
  reasoningContent?: string;
  toolCalls: Array<{ toolUseId: string; name: string; input: unknown }>;
  usage: LLMCallUsage;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
}

export interface LLMToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMCallOptions {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: LLMToolSpec[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  signal?: AbortSignal;
  /**
   * Hint to providers that support extended thinking / chain-of-thought modes.
   * When `false`, the provider will disable thinking mode (e.g. Qwen3 `enable_thinking: false`).
   * When `true` or `undefined`, the provider uses its default behaviour (thinking enabled for
   * models that support it, with a budget that leaves room for actual output).
   */
  enableThinking?: boolean;
}

export interface LLMAdapter {
  readonly providerId: string;
  call(opts: LLMCallOptions): Promise<LLMCallResult>;
  /**
   * Optional streaming interface (react-loop-engine.md §3).
   * Allows content_block_stop early-execution optimization.
   * Adapters that don't support streaming can omit this method.
   */
  stream?(opts: LLMStreamOptions): AsyncIterable<LLMStreamChunk>;
}
