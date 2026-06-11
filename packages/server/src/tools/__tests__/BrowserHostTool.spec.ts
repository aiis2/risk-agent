import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../index.js';
import { createBrowserHostTool } from '../BrowserHostTool.js';

describe('createBrowserHostTool', () => {
  it('creates standalone workspaces, hosts tabs, and drives hosted navigation actions', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-host-tool-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
    const hostedTabs = new Map<string, { workspaceId: string; currentUrl: string | null; title: string | null; status: string; providerTabRef: string }>();

    const browserHostAdapter = {
      isAvailable: () => true,
      ensureWindow: vi.fn(async () => undefined),
      createTab: vi.fn(async (tabId: string, url: string, workspaceId: string) => {
        const snapshot = { tabId, workspaceId, currentUrl: url, title: 'Example', status: 'ready', providerTabRef: `provider-${tabId}` };
        hostedTabs.set(tabId, snapshot);
        return snapshot;
      }),
      activateTab: vi.fn(async (tabId: string) => hostedTabs.get(tabId) ?? null),
      navigate: vi.fn(async (tabId: string, url: string) => {
        const current = hostedTabs.get(tabId);
        if (!current) return null;
        const snapshot = { ...current, currentUrl: url, title: 'Updated' };
        hostedTabs.set(tabId, snapshot);
        return snapshot;
      }),
      snapshot: vi.fn(async (tabId: string) => ({
        title: hostedTabs.get(tabId)?.title ?? null,
        currentUrl: hostedTabs.get(tabId)?.currentUrl ?? null,
        html: '<html><body>Hello</body></html>',
        text: 'Hello',
      })),
      click: vi.fn(async (tabId: string) => hostedTabs.get(tabId) ?? null),
      closeTab: vi.fn(async (tabId: string) => {
        hostedTabs.delete(tabId);
      }),
    } as const;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0, browserHostAdapter });
      app = built.app;
      const { ctx } = built;
      const tool = createBrowserHostTool({
        store: ctx.storage.getStructuredStore(),
        browserWorkspaces: ctx.browserWorkspaces,
        browserHostAdapter: ctx.browserHostAdapter,
      });

      const workspaceResult = await tool.execute({ action: 'ensure_standalone_workspace' });
      expect(workspaceResult.workspace.ownerType).toBe('browser-host');

      const stateResult = await tool.execute({ action: 'read_state' } as never);
      expect(stateResult.ok).toBe(true);

      const sessionWorkspace = await tool.execute(
        { action: 'ensure_session_workspace' } as never,
        { sessionId: 'run_browser_host_tool_test' } as never,
      );
      expect(sessionWorkspace.workspace.ownerSessionId).toBe('run_browser_host_tool_test');

      const createdTab = await tool.execute({
        action: 'create_tab',
        payload: {
          workspaceId: workspaceResult.workspace.workspaceId,
          currentUrl: 'https://example.com',
          title: 'Example',
        },
      });
      expect(createdTab.tab.currentUrl).toBe('https://example.com');
      expect(browserHostAdapter.createTab).toHaveBeenCalled();

      const navigatedWithoutTab = await tool.execute({
        action: 'navigate',
        payload: {
          workspaceId: workspaceResult.workspace.workspaceId,
          url: 'https://example.net',
        },
      } as never);
      expect(navigatedWithoutTab.tab.currentUrl).toBe('https://example.net');

      const navigatedFromWorkspaceIdAlias = await tool.execute({
        action: 'navigate',
        id: workspaceResult.workspace.workspaceId,
        payload: {
          url: 'https://example.edu',
        },
      } as never);
      expect(navigatedFromWorkspaceIdAlias.tab.currentUrl).toBe('https://example.edu');

      const navigatedTab = await tool.execute({
        action: 'navigate_tab',
        id: createdTab.tab.tabId,
        payload: {
          workspaceId: workspaceResult.workspace.workspaceId,
          url: 'https://example.org',
        },
      });
      expect(navigatedTab.tab.currentUrl).toBe('https://example.org');
      expect(browserHostAdapter.navigate).toHaveBeenCalledWith(createdTab.tab.tabId, 'https://example.org');

      const snapshotResult = await tool.execute({ action: 'snapshot_tab', id: createdTab.tab.tabId });
      expect(snapshotResult.snapshot.text).toBe('Hello');

      const clickResult = await tool.execute({
        action: 'click',
        id: createdTab.tab.tabId,
        payload: { selector: '#submit' },
      });
      expect(clickResult.tab.tabId).toBe(createdTab.tab.tabId);
    } finally {
      await app?.close().catch(() => undefined);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});