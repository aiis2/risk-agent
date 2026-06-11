import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StorageBackendRegistry } from '@risk-agent/core';
import { buildConfiguredLLMRuntime } from '../llm/factory.js';

describe('buildConfiguredLLMRuntime', () => {
  it('prefers a real stored model over a mock default when no modelId is provided', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-llm-'));

    try {
      const registry = await StorageBackendRegistry.bootstrap(tmp);
      const store = registry.getStructuredStore();

      await store.run(
        `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default)
         VALUES(?,?,?,?,?,?,?)`,
        ['mock-default', 'mock', 'browser-sandbox-check', null, JSON.stringify({ scripts: [] }), 1, 1],
      );
      await store.run(
        `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default)
         VALUES(?,?,?,?,?,?,?)`,
        ['real-model', 'openrouter', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', null, JSON.stringify({ apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1' }), 1, 0],
      );

      const runtime = await buildConfiguredLLMRuntime(store);

      expect(runtime.provider).toBe('openrouter');
      expect(runtime.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');

      await registry.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('prefers a dedicated hosted model over openrouter free and ollama fallbacks when no default is set', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-llm-'));

    try {
      const registry = await StorageBackendRegistry.bootstrap(tmp);
      const store = registry.getStructuredStore();

      await store.run(
        `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default)
         VALUES(?,?,?,?,?,?,?)`,
        ['openrouter-free', 'openrouter', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', null, JSON.stringify({ apiKey: 'sk-openrouter', baseUrl: 'https://openrouter.ai/api/v1' }), 1, 0],
      );
      await store.run(
        `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default)
         VALUES(?,?,?,?,?,?,?)`,
        ['deepseek-pro', 'openai-compatible', 'deepseek-v4-pro', null, JSON.stringify({ apiKey: 'sk-deepseek', baseUrl: 'https://api.deepseek.com' }), 1, 0],
      );
      await store.run(
        `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default)
         VALUES(?,?,?,?,?,?,?)`,
        ['ollama-local', 'ollama', 'gemma4:latest', null, JSON.stringify({ baseUrl: 'http://localhost:11434' }), 1, 0],
      );

      const runtime = await buildConfiguredLLMRuntime(store);

      expect(runtime.provider).toBe('openai-compatible');
      expect(runtime.model).toBe('deepseek-v4-pro');

      await registry.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  it('still falls back to a mock model when no real stored model exists', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-llm-'));

    try {
      const registry = await StorageBackendRegistry.bootstrap(tmp);
      const store = registry.getStructuredStore();

      await store.run(
        `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default)
         VALUES(?,?,?,?,?,?,?)`,
        ['mock-default', 'mock', 'browser-sandbox-check', null, JSON.stringify({ scripts: [] }), 1, 1],
      );

      const runtime = await buildConfiguredLLMRuntime(store);

      expect(runtime.provider).toBe('mock');
      expect(runtime.model).toBe('browser-sandbox-check');

      await registry.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});