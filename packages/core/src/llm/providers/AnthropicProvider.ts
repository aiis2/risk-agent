import { request } from 'undici';
import type { LLMAdapter, LLMCallOptions, LLMCallResult, LLMStreamChunk, LLMStreamOptions } from '../LLMAdapter.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  pricing?: { inputUsdPer1k?: number; outputUsdPer1k?: number };
}

/**
 * 将 MCP 工具结果内容转换为 Anthropic content block 数组。
 * MCP 格式：{ content: [{ type: 'text'|'image', text?, data?, mimeType? }] }
 * Anthropic 格式：[{ type: 'text', text: '...' } | { type: 'image', source: {...} }]
 */
function mcpContentToAnthropicBlocks(result: unknown): unknown[] {
  // MCP result: { content: [...] }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r['content'])) {
      return r['content'].map((item: unknown) => {
        if (!item || typeof item !== 'object') return { type: 'text', text: String(item) };
        const b = item as Record<string, unknown>;
        if (b['type'] === 'image' && typeof b['data'] === 'string') {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (b['mimeType'] as string) ?? 'image/png',
              data: b['data'],
            },
          };
        }
        if (b['type'] === 'text') return { type: 'text', text: b['text'] ?? '' };
        return { type: 'text', text: JSON.stringify(b) };
      });
    }
  }
  if (typeof result === 'string') return [{ type: 'text', text: result }];
  return [{ type: 'text', text: JSON.stringify(result) }];
}

export class AnthropicProvider implements LLMAdapter {
  readonly providerId = 'anthropic';
  private readonly baseUrl: string;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
  }

  private buildBody(opts: LLMCallOptions, stream?: boolean): Record<string, unknown> {
    const messages: unknown[] = [];

    for (const m of opts.messages) {
      if (m.role === 'system') continue;

      if (m.role === 'assistant') {
        // 构建 Anthropic assistant content blocks（text + tool_use）
        const contentBlocks: unknown[] = [];
        if (m.content) contentBlocks.push({ type: 'text', text: m.content });
        if (m.toolCalls?.length) {
          for (const tc of m.toolCalls) {
            contentBlocks.push({ type: 'tool_use', id: tc.toolUseId, name: tc.name, input: tc.input ?? {} });
          }
        }
        messages.push({ role: 'assistant', content: contentBlocks.length ? contentBlocks : [{ type: 'text', text: '' }] });

      } else if (m.role === 'tool') {
        // 转换为 Anthropic tool_result 格式（user role + tool_result content blocks）
        if (m.toolResults?.length) {
          const toolResultBlocks = m.toolResults.map((tr) => ({
            type: 'tool_result',
            tool_use_id: tr.toolUseId,
            is_error: tr.isError,
            content: mcpContentToAnthropicBlocks(tr.content),
          }));
          messages.push({ role: 'user', content: toolResultBlocks });
        } else {
          // 兜底：旧格式直接传文本
          messages.push({ role: 'user', content: m.content });
        }

      } else {
        messages.push({ role: 'user', content: m.content });
      }
    }

    return {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.2,
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
      system: opts.systemPrompt,
      messages,
      tools: opts.tools?.length
        ? opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema
          }))
        : undefined,
      ...(stream ? { stream: true } : {})
    };
  }

  async call(opts: LLMCallOptions): Promise<LLMCallResult> {
    const res = await request(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(this.buildBody(opts)),
      signal: opts.signal
    });
    const json = (await res.body.json()) as any;
    let text = '';
    const toolCalls: { toolUseId: string; name: string; input: unknown }[] = [];
    for (const block of json.content ?? []) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ toolUseId: block.id, name: block.name, input: block.input });
      }
    }
    const usage = json.usage ?? {};
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const cachedTokens = Number(usage.cache_read_input_tokens ?? 0);
    const cacheCreationTokens = Number(usage.cache_creation_input_tokens ?? 0);
    const inCost = (this.opts.pricing?.inputUsdPer1k ?? 0) * (inputTokens / 1000);
    const outCost = (this.opts.pricing?.outputUsdPer1k ?? 0) * (outputTokens / 1000);
    return {
      text,
      toolCalls,
      stopReason:
        json.stop_reason === 'tool_use'
          ? 'tool_use'
          : json.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : 'end_turn',
      usage: { inputTokens, outputTokens, cachedTokens, cacheCreationTokens, estimatedUsd: inCost + outCost }
    };
  }

  /**
   * SSE streaming via Anthropic Messages API stream=true.
   * Yields LLMStreamChunk events as tokens arrive, enabling real-time UI delivery.
   * (react-loop-engine.md §3, system-architecture.md v3.3 §5.1)
   */
  async *stream(opts: LLMStreamOptions): AsyncIterable<LLMStreamChunk> {
    const res = await request(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
        'accept': 'text/event-stream',
      },
      body: JSON.stringify(this.buildBody(opts, true)),
      signal: opts.signal
    });

    // Parse SSE lines from the response body
    const decoder = new TextDecoder();
    let buffer = '';
    const inputUsdPer1k = this.opts.pricing?.inputUsdPer1k ?? 0;
    const outputUsdPer1k = this.opts.pricing?.outputUsdPer1k ?? 0;

    // Track tool_use blocks for reassembly
    const toolBlocks: Record<number, { toolUseId: string; name: string; inputJson: string }> = {};

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        let event: any;
        try { event = JSON.parse(dataStr); } catch { continue; }

        const et: string = event.type ?? '';

        if (et === 'content_block_start') {
          const idx: number = event.index ?? 0;
          const cb = event.content_block ?? {};
          if (cb.type === 'text') {
            yield { type: 'content_block_start', blockType: 'text', index: idx };
          } else if (cb.type === 'thinking') {
            yield { type: 'content_block_start', blockType: 'thinking', index: idx };
          } else if (cb.type === 'tool_use') {
            toolBlocks[idx] = { toolUseId: cb.id ?? '', name: cb.name ?? '', inputJson: '' };
            yield { type: 'content_block_start', blockType: 'tool_use', index: idx, toolName: cb.name, toolUseId: cb.id };
          }

        } else if (et === 'content_block_delta') {
          const idx: number = event.index ?? 0;
          const delta = event.delta ?? {};
          if (delta.type === 'text_delta') {
            yield { type: 'text_delta', index: idx, text: delta.text ?? '' };
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', index: idx, text: delta.thinking ?? '' };
          } else if (delta.type === 'input_json_delta') {
            if (toolBlocks[idx]) toolBlocks[idx].inputJson += delta.partial_json ?? '';
            yield { type: 'input_json_delta', index: idx, partial: delta.partial_json ?? '' };
          }

        } else if (et === 'content_block_stop') {
          const idx: number = event.index ?? 0;
          const tb = toolBlocks[idx];
          if (tb) {
            let parsedInput: unknown = {};
            try { parsedInput = JSON.parse(tb.inputJson); } catch { parsedInput = {}; }
            delete toolBlocks[idx];
            yield {
              type: 'content_block_stop',
              blockType: 'tool_use',
              index: idx,
              toolBlock: { toolUseId: tb.toolUseId, name: tb.name, input: parsedInput }
            };
          } else {
            yield { type: 'content_block_stop', blockType: 'text', index: idx };
          }

        } else if (et === 'message_delta') {
          const usage = event.usage ?? {};
          const outputTokens = Number(usage.output_tokens ?? 0);
          const inputTokens = 0; // message_delta doesn't carry input tokens

          yield {
            type: 'message_stop',
            stopReason: event.delta?.stop_reason ?? 'end_turn',
            usage: {
              inputTokens,
              outputTokens,
              cachedTokens: 0,
              estimatedUsd: outputUsdPer1k * (outputTokens / 1000)
            }
          };

        } else if (et === 'message_start') {
          // message_start carries input token count
          const usage = event.message?.usage ?? {};
          const inputTokens = Number(usage.input_tokens ?? 0);
          const cachedTokens = Number(usage.cache_read_input_tokens ?? 0);
          const cacheCreationTokens = Number(usage.cache_creation_input_tokens ?? 0);
          // We emit this as a partial message_stop so QueryEngine can accumulate usage
          yield {
            type: 'message_stop',
            stopReason: '_message_start_usage',
            usage: {
              inputTokens,
              outputTokens: 0,
              cachedTokens,
              cacheCreationTokens,
              estimatedUsd: inputUsdPer1k * (inputTokens / 1000)
            }
          };
        }
      }
    }
  }
}
