import { describe, expect, it } from 'vitest';
import { pickPreferredModel } from '../preferredModel';

describe('pickPreferredModel', () => {
  it('prefers a dedicated hosted model over openrouter free and ollama fallbacks', () => {
    const model = pickPreferredModel([
      {
        modelId: 'mock-default',
        modelName: 'browser-sandbox-check',
        provider: 'mock',
        enabled: true,
        isDefault: true,
        config: {},
        role: undefined,
        createdAt: '2026-05-06 10:55:12',
      },
      {
        modelId: 'openrouter-free',
        modelName: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        provider: 'openrouter',
        enabled: true,
        isDefault: false,
        config: {},
        role: undefined,
        createdAt: '2026-05-06 06:01:33',
      },
      {
        modelId: 'deepseek-pro',
        modelName: 'deepseek-v4-pro',
        provider: 'openai-compatible',
        enabled: true,
        isDefault: false,
        config: {},
        role: undefined,
        createdAt: '2026-05-06 05:38:16',
      },
      {
        modelId: 'ollama-local',
        modelName: 'gemma4:latest',
        provider: 'ollama',
        enabled: true,
        isDefault: false,
        config: {},
        role: undefined,
        createdAt: '2026-05-06 03:53:59',
      },
    ]);

    expect(model?.modelId).toBe('deepseek-pro');
  });

  it('still respects an explicitly marked real default model', () => {
    const model = pickPreferredModel([
      {
        modelId: 'openrouter-free',
        modelName: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        provider: 'openrouter',
        enabled: true,
        isDefault: true,
        config: {},
        role: undefined,
        createdAt: '2026-05-06 06:01:33',
      },
      {
        modelId: 'deepseek-pro',
        modelName: 'deepseek-v4-pro',
        provider: 'openai-compatible',
        enabled: true,
        isDefault: false,
        config: {},
        role: undefined,
        createdAt: '2026-05-06 05:38:16',
      },
    ]);

    expect(model?.modelId).toBe('openrouter-free');
  });
});