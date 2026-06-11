import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageBackendRegistry } from '@risk-agent/core';
import { describe, expect, it } from 'vitest';
import { createSystemSettingsTool } from '../SystemSettingsTool.js';

describe('createSystemSettingsTool', () => {
  it('reads and updates browser runtime preferences', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-settings-tool-'));
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    try {
      const tool = createSystemSettingsTool(storage.getStructuredStore());

      const updated = await tool.execute({
        action: 'update',
        updates: {
          browserRuntime: {
            defaultProvider: 'external-preferred',
            defaultWorkspaceMode: 'global-shared',
            allowManualAttach: false,
            allowSharedContribution: true,
            externalBrowserMode: 'configured',
            externalBrowserExecutable: 'C:/Program Files/Browser/browser.exe',
          },
        },
      });

      expect(updated.ok).toBe(true);
      expect(updated.preferences.browserRuntime.defaultProvider).toBe('external-preferred');
      expect(updated.preferences.browserRuntime.externalBrowserExecutable).toBe('C:/Program Files/Browser/browser.exe');

      const current = await tool.execute({ action: 'get' });
      expect(current.preferences.browserRuntime.defaultWorkspaceMode).toBe('global-shared');
      expect(current.preferences.browserRuntime.allowManualAttach).toBe(false);
    } finally {
      await storage.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});