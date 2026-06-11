import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const capturedOrchestratorMaxRounds = vi.hoisted(() => ({ value: [] as Array<number | undefined> }));

vi.mock('@risk-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@risk-agent/core')>();

  class CapturingDynamicCapabilityOrchestrator extends actual.DynamicCapabilityOrchestrator {
    constructor(deps: ConstructorParameters<typeof actual.DynamicCapabilityOrchestrator>[0]) {
      capturedOrchestratorMaxRounds.value.push(deps.maxRounds);
      super(deps);
    }
  }

  return {
    ...actual,
    DynamicCapabilityOrchestrator: CapturingDynamicCapabilityOrchestrator,
  };
});

vi.mock('../llm/factory.js', () => ({
  buildConfiguredLLMRuntime: vi.fn(async () => ({
    adapter: {
      providerId: 'spy',
      call: vi.fn(async () => ({
        text: '',
        toolCalls: [],
        stopReason: 'end_turn' as const,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
      })),
    },
    model: 'spy-model',
    provider: 'spy',
    source: 'database',
    settings: {},
  })),
}));

vi.mock('../tools/PlaywrightWebScrapeTool.js', () => ({
  playwrightWebScrapeTool: {
    name: 'web_scrape',
    description: 'Mocked Playwright web scrape tool for runtime orchestration tests.',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: true,
    searchHint: 'mock playwright browser test',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
      },
    },
    execute: vi.fn(async () => ({
      url: 'https://example.test',
      title: 'Mocked page',
      text: 'Mocked page content',
      extractedChars: 19,
      truncated: false,
    })),
  },
}));

import { StorageBackendRegistry } from '@risk-agent/core';
import { buildHarnessRuntime } from '../runs/buildHarnessRuntime.js';

describe('buildHarnessRuntime maxRounds wiring', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedOrchestratorMaxRounds.value = [];
  });

  it('passes unlimited maxTurns preferences through to the dynamic orchestrator', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runtime-unlimited-rounds-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const store = storage.getStructuredStore();

      await store.run(
        `INSERT INTO preferences(pref_key, pref_value, updated_at) VALUES(?, ?, datetime('now'))
         ON CONFLICT(pref_key) DO UPDATE SET pref_value=excluded.pref_value, updated_at=datetime('now')`,
        ['maxTurns', JSON.stringify(0)],
      );

      await buildHarnessRuntime(storage);

      expect(capturedOrchestratorMaxRounds.value.at(-1)).toBe(0);
    } finally {
      await storage?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after close.
      }
    }
  });
});