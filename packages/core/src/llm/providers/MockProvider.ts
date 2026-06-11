import type { LLMAdapter, LLMCallOptions, LLMCallResult } from '../LLMAdapter.js';

/**
 * MockProvider — deterministic provider for tests and offline demos.
 *
 * 脚本通过 `scripts` 数组预定义每轮的响应（text + toolCalls），循环使用最后一个。
 */
export interface MockScript {
  text?: string;
  toolCalls?: Array<{ name: string; input: unknown }>;
  stopReason?: LLMCallResult['stopReason'];
}

export class MockProvider implements LLMAdapter {
  readonly providerId = 'mock';
  private index = 0;

  constructor(private readonly scripts: MockScript[] = [{ text: 'mock response', stopReason: 'end_turn' }]) {}

  async call(_opts: LLMCallOptions): Promise<LLMCallResult> {
    const script = this.scripts[Math.min(this.index, this.scripts.length - 1)];
    this.index++;
    const toolCalls = (script.toolCalls ?? []).map((tc, i) => ({
      toolUseId: `mock-${this.index}-${i}`,
      name: tc.name,
      input: tc.input
    }));
    return {
      text: script.text ?? '',
      toolCalls,
      stopReason: script.stopReason ?? (toolCalls.length ? 'tool_use' : 'end_turn'),
      usage: {
        inputTokens: 100,
        outputTokens: (script.text ?? '').length,
        cachedTokens: 0,
        estimatedUsd: 0
      }
    };
  }

  reset(): void {
    this.index = 0;
  }
}
