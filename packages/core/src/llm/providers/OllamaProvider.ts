import { request } from 'undici';
import type { LLMAdapter, LLMCallOptions, LLMCallResult } from '../LLMAdapter.js';

export interface OllamaProviderOptions {
  baseUrl?: string;
}

export class OllamaProvider implements LLMAdapter {
  readonly providerId = 'ollama';
  private readonly baseUrl: string;

  constructor(opts: OllamaProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }

  async call(opts: LLMCallOptions): Promise<LLMCallResult> {
    const body = {
      model: opts.model,
      stream: false,
      options: {
        temperature: opts.temperature ?? 0.2,
        num_predict: opts.maxTokens ?? 1024
      },
      messages: [
        { role: 'system', content: opts.systemPrompt },
        ...opts.messages.map((m) => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.content
        }))
      ]
    };
    const res = await request(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal
    });
    const json = (await res.body.json()) as any;
    const text: string = json.message?.content ?? '';
    return {
      text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        inputTokens: Number(json.prompt_eval_count ?? 0),
        outputTokens: Number(json.eval_count ?? 0),
        cachedTokens: 0,
        estimatedUsd: 0
      }
    };
  }
}
