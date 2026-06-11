import { describe, expect, it } from 'vitest';
import { buildSessionToolRegistry } from '../SessionRunner.js';
import { BrowserWorkspaceService } from '../../browser/BrowserWorkspaceService.js';

describe('buildSessionToolRegistry', () => {
  it('registers file_write for interactive write-capable sessions', async () => {
    const storage = {
      getStructuredStore() {
        return {
          get: async () => null,
          all: async () => [],
          run: async () => undefined,
        };
      },
      getGraphStore() {
        return {};
      },
      getVectorStore() {
        return {};
      },
      getObjectStore() {
        return {};
      },
      getLineageStore() {
        return {};
      },
    } as any;

    const browserWorkspaces = new BrowserWorkspaceService(storage.getStructuredStore());

    const { registry } = await buildSessionToolRegistry(storage, {
      browserWorkspaces,
      browserHostAdapter: null,
    });

    expect(registry.get('file_write')).toBeDefined();
    expect(registry.get('package_manager_write')).toBeDefined();
    expect(registry.get('system_resources')).toBeDefined();
    expect(registry.get('browser_host')).toBeDefined();
  });
});