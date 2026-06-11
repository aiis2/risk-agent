import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageBackendRegistry, ToolRegistry } from '@risk-agent/core';
import type { BrowserHostAdapter } from '../browser/BrowserHostAdapter.js';
import { BrowserWorkspaceService } from '../browser/BrowserWorkspaceService.js';

const buildConfiguredLLMRuntimeSpy = vi.hoisted(() => vi.fn(async () => ({
  adapter: {
    providerId: 'spy',
    call: vi.fn(),
  },
  model: 'spy-model',
  provider: 'spy',
  source: 'database',
  settings: {},
})));

const buildSessionToolRegistrySpy = vi.hoisted(() => vi.fn(async () => ({
  registry: new ToolRegistry(),
  mcpServers: [] as string[],
})));

vi.mock('../llm/factory.js', () => ({
  buildConfiguredLLMRuntime: buildConfiguredLLMRuntimeSpy,
}));

vi.mock('../agents/SessionRunner.js', () => ({
  buildSessionToolRegistry: buildSessionToolRegistrySpy,
}));

import { buildHarnessRuntime } from '../runs/buildHarnessRuntime.js';

describe('buildHarnessRuntime browser host wiring', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards browser host services into the run-first tool registry', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runtime-browser-host-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const browserWorkspaces = new BrowserWorkspaceService(storage.getStructuredStore());
      const browserHostAdapter = {} as BrowserHostAdapter;

      await buildHarnessRuntime(storage, undefined, undefined, {
        browserWorkspaces,
        browserHostAdapter,
      });

      expect(buildSessionToolRegistrySpy).toHaveBeenCalledWith(storage, {
        browserWorkspaces,
        browserHostAdapter,
      });
    } finally {
      await storage?.close().catch(() => undefined);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});