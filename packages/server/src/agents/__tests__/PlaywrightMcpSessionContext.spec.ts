import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageBackendRegistry } from '@risk-agent/core';
import { ensureMcpStorageSchema } from '../../routes/mcp.js';
import { BrowserWorkspaceService } from '../../browser/BrowserWorkspaceService.js';
import { startPlaywrightMcpSidecar, stopPlaywrightMcpSidecar } from '../../services/PlaywrightMcpSidecar.js';
import { buildSessionToolRegistry } from '../SessionRunner.js';

describe('builtin Playwright MCP session context', () => {
  const cleanupPaths: string[] = [];
  const originalPort = process.env.PLAYWRIGHT_MCP_PORT;

  afterEach(async () => {
    await stopPlaywrightMcpSidecar();
    process.env.PLAYWRIGHT_MCP_PORT = originalPort;
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (!path) continue;
      try { rmSync(path, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('injects ctx.sessionId when executing builtin Playwright MCP tools from the registry', async () => {
    process.env.PLAYWRIGHT_MCP_PORT = '8958';

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-mcp-session-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    await ensureMcpStorageSchema(store);

    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Injected Session Tab',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));

    await startPlaywrightMcpSidecar({
      embeddedController: {
        browserWorkspaces,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: createTabSpy,
        },
        preferenceStore: store,
      },
    });

    const now = new Date().toISOString();
    await store.run(
      `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, tool_count, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        'builtin-playwright',
        'playwright',
        'http://127.0.0.1:8958/mcp',
        'http',
        'Built-in Playwright MCP',
        30000,
        JSON.stringify({ headers: {} }),
        1,
        'unknown',
        0,
        now,
        now,
      ],
    );

    const { registry } = await buildSessionToolRegistry(storage);
    const tool = registry.get('mcp.playwright.browser_tabs_new');
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      { url: 'https://example.com/registry-session' },
      { sessionId: 'session-registry-injected' },
    ) as {
      workspace?: { ownerSessionId?: string };
      tab?: { currentUrl?: string; title?: string };
    };

    expect(result).toMatchObject({
      workspace: { ownerSessionId: 'session-registry-injected' },
      tab: {
        currentUrl: 'https://example.com/registry-session',
        title: 'Injected Session Tab',
      },
    });
    expect(createTabSpy).toHaveBeenCalledOnce();

    await storage.close();
  }, 30_000);
});