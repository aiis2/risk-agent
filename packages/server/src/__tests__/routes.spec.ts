import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../index.js';

describe('routes', () => {
  it('health returns ok', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).status).toBe('ok');
      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('falls back to substring search for Chinese memory queries', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      const store = ctx.storage.getStructuredStore();

      await store.run(
        `INSERT INTO memory_facts(fact_id, content, content_hash, category, source_run, confidence, embedding_status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        [
          'fact_pref_cn',
          '请记住我的输出偏好：报告尽量简洁，避免长篇格式化。',
          'fact_pref_cn_hash',
          'user_preference',
          'run_pref_cn',
          0.55,
        ],
      );

      const res = await app.inject({ method: 'GET', url: '/api/sessions/search?q=简洁&days=30&limit=10' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({
        total: 1,
        results: [
          expect.objectContaining({
            content: '请记住我的输出偏好：报告尽量简洁，避免长篇格式化。',
            category: 'user_preference',
          }),
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('tools catalog still exposes web_scrape without loading the Playwright runtime into startup-critical routes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });
      const res = await app.inject({ method: 'GET', url: '/api/tools' });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ success: true });
      expect(JSON.parse(res.body).data.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'web_scrape',
            deferred: true,
          }),
        ]),
      );

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('scenarios CRUD works', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });
      const created = await app.inject({
        method: 'POST',
        url: '/api/scenarios',
        payload: { name: '快捷支付', domain: 'payment' }
      });
      expect(created.statusCode).toBe(201);
      const body = JSON.parse(created.body);
      expect(body.scenarioId).toBeDefined();
      const list = await app.inject({ method: 'GET', url: '/api/scenarios' });
      expect(list.statusCode).toBe(200);
      expect(JSON.parse(list.body).length).toBe(1);
      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('preferences expose theme mode and persist updates', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const initial = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(initial.statusCode).toBe(200);
      expect(JSON.parse(initial.body).themeMode).toBe('system');

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: { themeMode: 'sea' },
      });
      expect(updated.statusCode).toBe(200);

      const refreshed = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body).themeMode).toBe('sea');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('persists web search preferences alongside general preferences', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: {
          webSearch: {
            defaultProvider: 'tavily',
            includeDate: true,
            resultCount: 6,
            compressionMethod: 'summary',
            blacklist: 'example.com',
            providerEnabled: { tavily: true },
            providerApiKey: { tavily: 'tvly-test-key' },
            providerEndpoint: {},
          },
        },
      });
      expect(updated.statusCode).toBe(200);

      const refreshed = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body)).toMatchObject({
        webSearch: {
          defaultProvider: 'tavily',
          resultCount: 6,
          compressionMethod: 'summary',
          providerEnabled: { tavily: true },
          providerApiKey: { tavily: 'tvly-test-key' },
        },
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('exposes browser runtime preferences and persists browser policy updates', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const initial = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(initial.statusCode).toBe(200);
      expect(JSON.parse(initial.body)).toMatchObject({
        browserRuntime: {
          defaultProvider: 'embedded-first',
          defaultWorkspaceMode: 'exclusive',
          allowManualAttach: true,
          allowSharedContribution: true,
          externalBrowserMode: 'system-default',
          externalBrowserExecutable: '',
        },
      });

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: {
          browserRuntime: {
            defaultProvider: 'external-preferred',
            defaultWorkspaceMode: 'global-shared',
            allowManualAttach: false,
            allowSharedContribution: true,
            externalBrowserMode: 'configured',
            externalBrowserExecutable: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
          },
        },
      });
      expect(updated.statusCode).toBe(200);

      const refreshed = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body)).toMatchObject({
        browserRuntime: {
          defaultProvider: 'external-preferred',
          defaultWorkspaceMode: 'global-shared',
          allowManualAttach: false,
          allowSharedContribution: true,
          externalBrowserMode: 'configured',
          externalBrowserExecutable: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        },
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('exposes browser workspace state and creates a session workspace from preferences', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const initial = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(initial.statusCode).toBe(200);
      expect(JSON.parse(initial.body)).toMatchObject({
        hostAvailable: false,
        workspaces: [],
        tabs: [],
        bindings: [],
      });

      const created = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-browser-a' },
      });
      expect(created.statusCode).toBe(201);
      expect(JSON.parse(created.body)).toMatchObject({
        ok: true,
        workspace: {
          ownerSessionId: 'session-browser-a',
          visibility: 'exclusive',
          providerKind: 'embedded',
        },
      });

      const refreshed = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body)).toMatchObject({
        workspaces: [
          {
            ownerSessionId: 'session-browser-a',
            visibility: 'exclusive',
          },
        ],
        bindings: [
          {
            sessionId: 'session-browser-a',
            role: 'owner',
            canControl: true,
          },
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('blocks workspace attach when manual attach is disabled in browser runtime preferences', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: {
          browserRuntime: {
            allowManualAttach: false,
          },
        },
      });
      expect(updated.statusCode).toBe(200);

      const created = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-owner' },
      });
      expect(created.statusCode).toBe(201);
      const workspaceId = JSON.parse(created.body).workspace.workspaceId as string;

      const shared = await app.inject({
        method: 'POST',
        url: `/api/browser/workspaces/${workspaceId}/share`,
        payload: { sessionId: 'session-owner', sharePolicy: 'manual' },
      });
      expect(shared.statusCode).toBe(200);

      const blockedAttach = await app.inject({
        method: 'POST',
        url: `/api/browser/workspaces/${workspaceId}/attach`,
        payload: { sessionId: 'session-observer' },
      });
      expect(blockedAttach.statusCode).toBe(409);
      expect(JSON.parse(blockedAttach.body)).toMatchObject({
        error: 'manual_attach_disabled',
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('creates browser tabs and updates the active tab through browser routes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const activateTab = vi.fn(async () => undefined);
      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          activateTab,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-tabs-route' },
      });
      expect(createdWorkspace.statusCode).toBe(201);
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const firstTabResponse = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          title: 'One',
          currentUrl: 'https://example.com/one',
          status: 'ready',
          providerTabRef: 'provider-tab-1',
          contributedBySessionId: 'session-tabs-route',
        },
      });
      expect(firstTabResponse.statusCode).toBe(201);
      const firstTabId = JSON.parse(firstTabResponse.body).tab.tabId as string;

      const secondTabResponse = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          title: 'Two',
          currentUrl: 'https://example.com/two',
          status: 'loading',
          providerTabRef: 'provider-tab-2',
          contributedBySessionId: 'session-tabs-route',
        },
      });
      expect(secondTabResponse.statusCode).toBe(201);

      const activated = await app.inject({
        method: 'POST',
        url: `/api/browser/tabs/${firstTabId}/activate`,
        payload: { workspaceId },
      });
      expect(activated.statusCode).toBe(200);
      expect(activateTab).toHaveBeenCalledWith(firstTabId);

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(state.statusCode).toBe(200);
      expect(JSON.parse(state.body)).toMatchObject({
        workspaces: [
          {
            workspaceId,
            lastActiveTabId: firstTabId,
          },
        ],
        tabs: [
          {
            workspaceId,
            tabId: firstTabId,
            providerTabRef: 'provider-tab-1',
          },
          {
            workspaceId,
            providerTabRef: 'provider-tab-2',
          },
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('reports browser host availability when a desktop adapter is injected', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
        },
      });

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(state.statusCode).toBe(200);
      expect(JSON.parse(state.body)).toMatchObject({
        hostAvailable: true,
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('syncs browser host metadata into stored tabs when a desktop adapter is available', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
        tabId,
        workspaceId,
        providerTabRef: `browser-host:${tabId}`,
        title: 'Host Tab',
        currentUrl: url,
        status: 'ready',
      }));

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: createTabSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-sync' },
      });
      expect(createdWorkspace.statusCode).toBe(201);
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const createdTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/host',
          status: 'loading',
          contributedBySessionId: 'session-host-sync',
        },
      });
      expect(createdTab.statusCode).toBe(201);
      const tabBody = JSON.parse(createdTab.body);
      expect(tabBody.tab).toMatchObject({
        workspaceId,
        providerTabRef: `browser-host:${tabBody.tab.tabId}`,
        title: 'Host Tab',
        currentUrl: 'https://example.com/host',
        status: 'ready',
      });
      expect(createTabSpy).toHaveBeenCalledOnce();

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(state.statusCode).toBe(200);
      expect(JSON.parse(state.body)).toMatchObject({
        tabs: [
          {
            workspaceId,
            providerTabRef: `browser-host:${tabBody.tab.tabId}`,
            title: 'Host Tab',
          },
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('refreshes hosted tab metadata when browser state is requested after the page changed in place', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const readMetadataSpy = vi.fn(async (tabId: string) => ({
        tabId,
        workspaceId: 'workspace-ignored',
        providerTabRef: `browser-host:${tabId}`,
        title: 'PixLab Character',
        currentUrl: 'https://pixlab24.com/character/42213/',
        status: 'ready',
      }));

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
            tabId,
            workspaceId,
            providerTabRef: `browser-host:${tabId}`,
            title: '百度一下，你就知道',
            currentUrl: url,
            status: 'ready',
          })),
          readMetadata: readMetadataSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-state-refresh' },
      });
      expect(createdWorkspace.statusCode).toBe(201);
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const createdTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://www.baidu.com',
          status: 'ready',
          contributedBySessionId: 'session-host-state-refresh',
        },
      });
      expect(createdTab.statusCode).toBe(201);
      const tabId = JSON.parse(createdTab.body).tab.tabId as string;

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });

      expect(state.statusCode).toBe(200);
      expect(readMetadataSpy).toHaveBeenCalledWith(tabId);
      expect(JSON.parse(state.body)).toMatchObject({
        tabs: [
          {
            tabId,
            title: 'PixLab Character',
            currentUrl: 'https://pixlab24.com/character/42213/',
            status: 'ready',
          },
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('does not recreate hosted tabs during passive browser state sync when metadata is unavailable', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const readMetadataSpy = vi.fn(async () => null);
      const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
        tabId,
        workspaceId,
        providerTabRef: `browser-host:${tabId}`,
        title: 'Host Tab',
        currentUrl: url,
        status: 'ready',
      }));

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          readMetadata: readMetadataSpy,
          createTab: createTabSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-passive-sync' },
      });
      expect(createdWorkspace.statusCode).toBe(201);
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const createdTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/passive-sync',
          status: 'ready',
          contributedBySessionId: 'session-host-passive-sync',
        },
      });
      expect(createdTab.statusCode).toBe(201);
      const tabId = JSON.parse(createdTab.body).tab.tabId as string;

      createTabSpy.mockClear();

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });

      expect(state.statusCode).toBe(200);
      expect(readMetadataSpy).toHaveBeenCalledWith(tabId);
      expect(createTabSpy).not.toHaveBeenCalled();

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('rehydrates a persisted hosted tab before activation when the desktop host lost it from memory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const readMetadataSpy = vi.fn(async () => null);
      const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
        tabId,
        workspaceId,
        providerTabRef: `browser-host:${tabId}`,
        title: 'Restored Host Tab',
        currentUrl: url,
        status: 'ready',
      }));
      const activateTabSpy = vi.fn(async (tabId: string) => ({
        tabId,
        workspaceId: 'workspace-from-activate',
        providerTabRef: `browser-host:${tabId}`,
        title: 'Restored Host Tab',
        currentUrl: 'https://example.com/restored',
        status: 'ready',
      }));

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          readMetadata: readMetadataSpy,
          createTab: createTabSpy,
          activateTab: activateTabSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-restore' },
      });
      expect(createdWorkspace.statusCode).toBe(201);
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const createdTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/restored',
          status: 'loading',
          contributedBySessionId: 'session-host-restore',
        },
      });
      expect(createdTab.statusCode).toBe(201);
      const tabId = JSON.parse(createdTab.body).tab.tabId as string;

      createTabSpy.mockClear();

      const activated = await app.inject({
        method: 'POST',
        url: `/api/browser/tabs/${encodeURIComponent(tabId)}/activate`,
        payload: { workspaceId },
      });

      expect(activated.statusCode).toBe(200);
      expect(readMetadataSpy).toHaveBeenCalledWith(tabId);
      expect(createTabSpy).toHaveBeenCalledWith(tabId, 'https://example.com/restored', workspaceId);
      expect(activateTabSpy).toHaveBeenCalledWith(tabId);

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(state.statusCode).toBe(200);
      expect(JSON.parse(state.body)).toMatchObject({
        tabs: [
          {
            tabId,
            providerTabRef: `browser-host:${tabId}`,
            title: 'Restored Host Tab',
            currentUrl: 'https://example.com/restored',
            status: 'ready',
          },
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('reloads a hosted browser tab through the desktop adapter and persists the refreshed metadata', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const reloadSpy = vi.fn(async (tabId: string) => ({
        tabId,
        workspaceId: 'workspace-ignored',
        providerTabRef: `browser-host:${tabId}`,
        title: 'Reloaded Host Tab',
        currentUrl: 'https://example.com/reloaded',
        status: 'ready',
      }));

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
            tabId,
            workspaceId,
            providerTabRef: `browser-host:${tabId}`,
            title: 'Host Tab',
            currentUrl: url,
            status: 'ready',
          })),
          reload: reloadSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-reload' },
      });
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const createdTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/host',
          status: 'ready',
          contributedBySessionId: 'session-host-reload',
        },
      });
      const tabId = JSON.parse(createdTab.body).tab.tabId as string;

      const reloaded = await app.inject({
        method: 'POST',
        url: `/api/browser/tabs/${encodeURIComponent(tabId)}/reload`,
        payload: { workspaceId },
      });

      expect(reloaded.statusCode).toBe(200);
      expect(reloadSpy).toHaveBeenCalledWith(tabId);
      expect(JSON.parse(reloaded.body)).toMatchObject({
        tab: {
          tabId,
          title: 'Reloaded Host Tab',
          currentUrl: 'https://example.com/reloaded',
          status: 'ready',
        },
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('navigates a hosted browser tab forward and backward through the desktop adapter', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const navigateSpy = vi.fn(async (tabId: string, url: string) => ({
        tabId,
        workspaceId: 'workspace-ignored',
        providerTabRef: `browser-host:${tabId}`,
        title: 'Navigated Host Tab',
        currentUrl: url,
        status: 'ready',
        canGoBack: true,
        canGoForward: false,
      }));
      const goBackSpy = vi.fn(async (tabId: string) => ({
        tabId,
        workspaceId: 'workspace-ignored',
        providerTabRef: `browser-host:${tabId}`,
        title: 'Original Host Tab',
        currentUrl: 'https://example.com/original',
        status: 'ready',
        canGoBack: false,
        canGoForward: true,
      }));
      const goForwardSpy = vi.fn(async (tabId: string) => ({
        tabId,
        workspaceId: 'workspace-ignored',
        providerTabRef: `browser-host:${tabId}`,
        title: 'Navigated Host Tab',
        currentUrl: 'https://example.com/navigated',
        status: 'ready',
        canGoBack: true,
        canGoForward: false,
      }));

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
            tabId,
            workspaceId,
            providerTabRef: `browser-host:${tabId}`,
            title: 'Original Host Tab',
            currentUrl: url,
            status: 'ready',
            canGoBack: false,
            canGoForward: false,
          })),
          navigate: navigateSpy,
          goBack: goBackSpy,
          goForward: goForwardSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-nav' },
      });
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const createdTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/original',
          status: 'ready',
          contributedBySessionId: 'session-host-nav',
        },
      });
      const tabId = JSON.parse(createdTab.body).tab.tabId as string;

      const navigated = await app.inject({
        method: 'POST',
        url: `/api/browser/tabs/${encodeURIComponent(tabId)}/navigate`,
        payload: { workspaceId, url: 'https://example.com/navigated' },
      });

      expect(navigated.statusCode).toBe(200);
      expect(navigateSpy).toHaveBeenCalledWith(tabId, 'https://example.com/navigated');
      expect(JSON.parse(navigated.body)).toMatchObject({
        tab: {
          tabId,
          title: 'Navigated Host Tab',
          currentUrl: 'https://example.com/navigated',
          status: 'ready',
        },
      });

      const wentBack = await app.inject({
        method: 'POST',
        url: `/api/browser/tabs/${encodeURIComponent(tabId)}/back`,
        payload: { workspaceId },
      });

      expect(wentBack.statusCode).toBe(200);
      expect(goBackSpy).toHaveBeenCalledWith(tabId);
      expect(JSON.parse(wentBack.body)).toMatchObject({
        tab: {
          tabId,
          title: 'Original Host Tab',
          currentUrl: 'https://example.com/original',
          status: 'ready',
        },
      });

      const wentForward = await app.inject({
        method: 'POST',
        url: `/api/browser/tabs/${encodeURIComponent(tabId)}/forward`,
        payload: { workspaceId },
      });

      expect(wentForward.statusCode).toBe(200);
      expect(goForwardSpy).toHaveBeenCalledWith(tabId);
      expect(JSON.parse(wentForward.body)).toMatchObject({
        tab: {
          tabId,
          title: 'Navigated Host Tab',
          currentUrl: 'https://example.com/navigated',
          status: 'ready',
        },
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('closes a browser tab through the desktop adapter and promotes the next tab as active', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const closeTabSpy = vi.fn(async () => undefined);

      const { app } = await buildApp({
        dataDir: tmp,
        port: 0,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
            tabId,
            workspaceId,
            providerTabRef: `browser-host:${tabId}`,
            title: url,
            currentUrl: url,
            status: 'ready',
          })),
          closeTab: closeTabSpy,
        },
      });

      const createdWorkspace = await app.inject({
        method: 'POST',
        url: '/api/browser/workspaces/session',
        payload: { sessionId: 'session-host-close' },
      });
      const workspaceId = JSON.parse(createdWorkspace.body).workspace.workspaceId as string;

      const firstTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/one',
          status: 'ready',
          contributedBySessionId: 'session-host-close',
        },
      });
      const firstTabId = JSON.parse(firstTab.body).tab.tabId as string;

      const secondTab = await app.inject({
        method: 'POST',
        url: '/api/browser/tabs',
        payload: {
          workspaceId,
          currentUrl: 'https://example.com/two',
          status: 'ready',
          contributedBySessionId: 'session-host-close',
        },
      });
      const secondTabId = JSON.parse(secondTab.body).tab.tabId as string;

      const closed = await app.inject({
        method: 'DELETE',
        url: `/api/browser/tabs/${encodeURIComponent(secondTabId)}`,
        payload: { workspaceId },
      });

      expect(closed.statusCode).toBe(200);
      expect(closeTabSpy).toHaveBeenCalledWith(secondTabId);
      expect(JSON.parse(closed.body)).toMatchObject({
        workspaceId,
        closedTabId: secondTabId,
        nextActiveTabId: firstTabId,
      });

      const state = await app.inject({ method: 'GET', url: '/api/browser/state' });
      expect(state.statusCode).toBe(200);
      expect(JSON.parse(state.body)).toMatchObject({
        workspaces: [
          {
            workspaceId,
            lastActiveTabId: firstTabId,
          },
        ],
        tabs: [
          {
            tabId: firstTabId,
          },
        ],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('security config reports fixed runtime capabilities instead of fake user overrides', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const response = await app.inject({ method: 'GET', url: '/api/security/config' });
      expect(response.statusCode).toBe(200);

      expect(JSON.parse(response.body)).toMatchObject({
        success: true,
        data: {
          sandbox: {
            runtime: {
              hostKind: 'js-vm',
              filesystem: 'none',
              network: 'deny',
              httpRequests: false,
              dynamicEval: false,
              dynamicImports: false,
              userOverridesSupported: false,
            },
            localProcess: {
              hostKind: 'local-process',
              available: true,
              defaultNetwork: 'deny',
              filesystemScopeSource: 'tool-binding',
              workingDirectorySource: 'tool-request',
              timeoutSource: 'tool-policy',
              commandAllowlistSupported: false,
              confirmationSupported: false,
              userOverridesSupported: false,
            },
          },
        },
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('persists unlimited maxTurns preferences as zero', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: { maxTurns: 0, compactThresholdTokens: 120000 },
      });
      expect(updated.statusCode).toBe(200);

      const refreshed = await app.inject({ method: 'GET', url: '/api/preferences' });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body)).toMatchObject({
        maxTurns: 0,
        compactThresholdTokens: 120000,
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('applies maxTurns preferences to the session runtime', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: { maxTurns: 1 },
      });
      expect(updated.statusCode).toBe(200);

      const createdModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-max-turns',
          isDefault: true,
          config: {
            scripts: [{ text: 'loop', stopReason: 'end_turn' }],
          },
        },
      });
      expect(createdModel.statusCode).toBe(201);

      const started = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'max turns session', locale: 'zh-CN' },
      });
      expect(started.statusCode).toBe(201);

      const sessionId = JSON.parse(started.body).sessionId as string;
      await ctx.runner.getHandle(sessionId)?.done;

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);
      const detailBody = JSON.parse(detail.body);
      const turnInfoEvents = detailBody.events.filter((event: any) => event.type === 'turn_info');
      expect(turnInfoEvents).toHaveLength(1);

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('exposes the expanded built-in tools catalog used by the settings center', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const response = await app.inject({ method: 'GET', url: '/api/tools' });
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      const names = body.data.tools.map((tool: { name: string }) => tool.name);
      const systemResources = body.data.tools.find((tool: { name: string }) => tool.name === 'system_resources');

      expect(names).toEqual(expect.arrayContaining([
        'memory_read',
        'memory_write',
        'memory_write_short_term',
        'dispatch_subagents',
        'system_settings',
        'system_resources',
        'browser_host',
        'web_search',
        'enter_plan_mode',
        'exit_plan_mode',
        'task_stop',
        'agent_tool',
        'send_message',
        'rule_nl_parse',
        'report_render',
        'datasource_knowledge_search',
        'datasource_knowledge_graph',
        'kg_search',
      ]));
      expect(systemResources?.inputSchema?.properties?.domain?.enum).toEqual(expect.arrayContaining([
        'scenarios',
        'rules',
        'profiles',
        'knowledge_graph',
      ]));
      expect(systemResources?.inputSchema?.properties?.action?.enum).toEqual(expect.arrayContaining([
        'read',
        'create_node',
        'get_node',
        'create_edge',
        'upsert_node',
        'add_edge',
        'query',
      ]));

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('tests persisted Tavily search configuration through the web search route', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'Tavily is reachable.',
        results: [
          {
            title: 'Tavily Docs',
            url: 'https://docs.tavily.com',
            content: 'Documentation entry',
            score: 0.98,
          },
        ],
      }),
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const saved = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: {
          webSearch: {
            defaultProvider: 'tavily',
            includeDate: true,
            resultCount: 5,
            compressionMethod: 'none',
            blacklist: '',
            providerEnabled: { tavily: true },
            providerApiKey: { tavily: 'tvly-test-key' },
            providerEndpoint: { tavily: 'https://api.tavily.com/search' },
          },
        },
      });
      expect(saved.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: '/api/web-search/test',
        payload: {
          query: 'risk agent latest notes',
          provider: 'tavily',
          limit: 3,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        ok: true,
        data: {
          provider: 'tavily',
          answer: 'Tavily is reachable.',
          results: [
            expect.objectContaining({
              title: 'Tavily Docs',
              url: 'https://docs.tavily.com',
            }),
          ],
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await app.close();
    } finally {
      vi.unstubAllGlobals();
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      }
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('tests persisted Baidu search configuration through the web search route', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <body>
            <div class="result c-container">
              <h3 class="c-title"><a href="https://example.com/risk-agent">Risk Agent 搜索接入</a></h3>
              <div class="c-abstract">用于验证百度搜索 provider 已经能够返回真实网页结果。</div>
            </div>
            <div class="result c-container">
              <h3 class="c-title"><a href="https://example.com/baidu-search">Baidu provider 指南</a></h3>
              <div class="c-abstract">第二条结果用于覆盖多结果解析路径。</div>
            </div>
          </body>
        </html>
      `,
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const saved = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        payload: {
          webSearch: {
            defaultProvider: 'baidu',
            includeDate: true,
            resultCount: 5,
            compressionMethod: 'none',
            blacklist: '',
            providerEnabled: { baidu: true },
            providerApiKey: {},
            providerEndpoint: {},
          },
        },
      });
      expect(saved.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: '/api/web-search/test',
        payload: {
          query: '风险控制 平台',
          provider: 'baidu',
          limit: 2,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        ok: true,
        data: {
          provider: 'baidu',
          results: [
            expect.objectContaining({
              title: 'Risk Agent 搜索接入',
              url: 'https://example.com/risk-agent',
            }),
            expect.objectContaining({
              title: 'Baidu provider 指南',
              url: 'https://example.com/baidu-search',
            }),
          ],
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await app.close();
    } finally {
      vi.unstubAllGlobals();
      if (originalFetch) {
        globalThis.fetch = originalFetch;
      }
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('accepts compatible model providers and replays session events through SSE', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const createdModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'openai-compatible',
          modelName: 'qwen-plus',
          config: {
            baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
            apiKey: 'not-for-commit',
          },
          isDefault: false,
        },
      });
      expect(createdModel.statusCode).toBe(201);

      const defaultModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-for-sse',
          isDefault: true,
        },
      });
      expect(defaultModel.statusCode).toBe(201);

      const models = await app.inject({ method: 'GET', url: '/api/models' });
      expect(models.statusCode).toBe(200);
      expect(JSON.parse(models.body).some((model: any) => model.provider === 'openai-compatible')).toBe(true);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'SSE test session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId as string;
      await ctx.runner.getHandle(sessionId)?.done;

      const stream = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/stream` });
      expect(stream.statusCode).toBe(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.body).toContain('"type":"system_init"');
      expect(stream.body).toContain('"type":"result"');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('uses the default model configuration when starting a session', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const createdModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-from-settings',
          isDefault: true,
        },
      });
      expect(createdModel.statusCode).toBe(201);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'Configured model session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId as string;
      await ctx.runner.getHandle(sessionId)?.done;

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);
      const body = JSON.parse(detail.body);
      const systemInit = body.events.find((event: any) => event.type === 'system_init');
      expect(systemInit?.payload?.model).toBe('mock-from-settings');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('updates model configs and runs a model connectivity test', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const created = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-original',
          config: {
            temperature: 0.1,
            maxTokens: 128,
          },
          isDefault: false,
        },
      });
      expect(created.statusCode).toBe(201);

      const modelId = JSON.parse(created.body).modelId as string;

      const updated = await app.inject({
        method: 'PUT',
        url: `/api/models/${modelId}`,
        payload: {
          provider: 'mock',
          modelName: 'mock-edited',
          config: {
            temperature: 0.7,
            maxTokens: 512,
            topP: 0.9,
          },
          enabled: true,
          isDefault: true,
        },
      });
      expect(updated.statusCode).toBe(200);

      const listed = await app.inject({ method: 'GET', url: '/api/models' });
      expect(listed.statusCode).toBe(200);
      const model = JSON.parse(listed.body).find((row: any) => row.modelId === modelId);
      expect(model.modelName).toBe('mock-edited');
      expect(model.isDefault).toBe(true);
      expect(model.config.temperature).toBe(0.7);
      expect(model.config.maxTokens).toBe(512);
      expect(model.config.topP).toBe(0.9);

      const tested = await app.inject({
        method: 'POST',
        url: `/api/models/${modelId}/test`,
        payload: {
          prompt: '请输出一段简短的 Markdown 风险摘要。',
          mode: 'call',
        },
      });
      expect(tested.statusCode).toBe(200);

      const body = JSON.parse(tested.body);
      expect(body.success).toBe(true);
      expect(body.modelName).toBe('mock-edited');
      expect(typeof body.text).toBe('string');
      expect(body.text.length).toBeGreaterThan(0);

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('supports lightweight connect mode for model connectivity checks', async () => {
    const upstreamRequests: Array<{ url: string; authorization?: string; body: any }> = [];
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const bodyText = Buffer.concat(chunks).toString('utf-8');
      upstreamRequests.push({
        url: req.url ?? '',
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
        body: bodyText ? JSON.parse(bodyText) : null,
      });

      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'chatcmpl-test', choices: [{ message: { content: 'pong' } }] }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const created = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'openai-compatible',
          modelName: 'qwen3.5-plus',
          config: {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: 'connect-test-key',
          },
          isDefault: false,
        },
      });
      expect(created.statusCode).toBe(201);

      const modelId = JSON.parse(created.body).modelId as string;
      const tested = await app.inject({
        method: 'POST',
        url: `/api/models/${modelId}/test`,
        payload: {
          mode: 'connect',
        },
      });
      expect(tested.statusCode).toBe(200);

      const body = JSON.parse(tested.body);
      expect(body.success).toBe(true);
      expect(body.mode).toBe('connect');
      expect(typeof body.durationMs).toBe('number');
      expect(body.text).toContain('Connected');
      expect(upstreamRequests).toEqual([
        {
          url: '/v1/chat/completions',
          authorization: 'Bearer connect-test-key',
          body: {
            model: 'qwen3.5-plus',
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
            max_tokens: 8,
          },
        },
      ]);

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('refreshes and calls MCP tools with Accept headers compatible with Playwright MCP', async () => {
    const upstreamRequests: Array<{ method?: string; accept?: string; sessionId?: string }> = [];
    let sessionCounter = 0;
    const initializedSessions = new Set<string>();
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) as { method?: string } : {};
      const accept = typeof req.headers.accept === 'string' ? req.headers.accept : '';
      const requestSessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
      upstreamRequests.push({ method: body.method, accept, sessionId: requestSessionId });

      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
        res.writeHead(406, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.method === 'tools/call' ? 'call' : 'list',
          error: { code: -32000, message: 'Not Acceptable: Client must accept both application/json and text/event-stream' },
        }));
        return;
      }

      if (body.method === 'initialize') {
        const sessionId = `session-${++sessionCounter}`;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': sessionId });
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 'init',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'Playwright', version: 'test' },
          },
        })}\n\n`);
        return;
      }

      if (body.method === 'notifications/initialized') {
        if (requestSessionId) {
          initializedSessions.add(requestSessionId);
        }
        res.writeHead(202, { 'content-type': 'application/json', ...(requestSessionId ? { 'mcp-session-id': requestSessionId } : {}) });
        res.end('');
        return;
      }

      if (!requestSessionId || !initializedSessions.has(requestSessionId)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.method === 'tools/call' ? 'call' : 'list',
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': requestSessionId });
      if (body.method === 'tools/call') {
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 'call',
          result: { content: [{ type: 'text', text: 'snapshot ok' }] },
        })}\n\n`);
        return;
      }

      res.end(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 'list',
        result: {
          tools: [
            {
              name: 'browser_snapshot',
              description: 'Capture a browser snapshot',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      })}\n\n`);
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const created = await app.inject({
        method: 'POST',
        url: '/api/mcp',
        payload: {
          name: 'playwright',
          url: `http://127.0.0.1:${address.port}/mcp`,
          transport: 'http',
          enabled: true,
        },
      });
      expect(created.statusCode).toBe(201);

      const serverId = JSON.parse(created.body).serverId as string;

      const refreshed = await app.inject({
        method: 'POST',
        url: `/api/mcp/${serverId}/refresh`,
      });
      expect(refreshed.statusCode).toBe(200);
      expect(JSON.parse(refreshed.body)).toEqual({
        discovered: 1,
        error: null,
        tools: [{ name: 'browser_snapshot', description: 'Capture a browser snapshot' }],
      });

      const called = await app.inject({
        method: 'POST',
        url: '/api/mcp/call',
        payload: {
          serverId,
          toolName: 'browser_snapshot',
          params: {},
        },
      });
      expect(called.statusCode).toBe(200);
      expect(JSON.parse(called.body)).toEqual({
        ok: true,
        result: { content: [{ type: 'text', text: 'snapshot ok' }] },
      });

      expect(upstreamRequests).toHaveLength(6);
      expect(upstreamRequests.every((request) => request.accept?.includes('application/json') && request.accept?.includes('text/event-stream'))).toBe(true);
      expect(upstreamRequests.filter((request) => request.method === 'initialize')).toHaveLength(2);
      expect(upstreamRequests.filter((request) => request.method === 'notifications/initialized')).toHaveLength(2);
      expect(upstreamRequests.filter((request) => request.method === 'tools/list')).toHaveLength(1);
      expect(upstreamRequests.filter((request) => request.method === 'tools/call')).toHaveLength(1);

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('reinitializes the MCP session once when /api/mcp/call gets Session not found', async () => {
    const upstreamRequests: Array<{ method?: string; sessionId?: string }> = [];
    let sessionCounter = 0;
    const initializedSessions = new Set<string>();
    let firstCallFailed = false;

    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) as { method?: string } : {};
      const requestSessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
      upstreamRequests.push({ method: body.method, sessionId: requestSessionId });

      if (body.method === 'initialize') {
        const sessionId = `session-${++sessionCounter}`;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': sessionId });
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 'init',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'Playwright', version: 'test' },
          },
        })}\n\n`);
        return;
      }

      if (body.method === 'notifications/initialized') {
        if (requestSessionId) {
          initializedSessions.add(requestSessionId);
        }
        res.writeHead(202, { 'content-type': 'application/json', ...(requestSessionId ? { 'mcp-session-id': requestSessionId } : {}) });
        res.end('');
        return;
      }

      if (body.method === 'tools/call' && requestSessionId && initializedSessions.has(requestSessionId) && !firstCallFailed) {
        firstCallFailed = true;
        initializedSessions.delete(requestSessionId);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 'call',
          error: { code: -32001, message: 'Session not found' },
        }));
        return;
      }

      if (!requestSessionId || !initializedSessions.has(requestSessionId)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 'call',
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': requestSessionId });
      res.end(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 'call',
        result: { content: [{ type: 'text', text: 'snapshot ok after retry' }] },
      })}\n\n`);
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const created = await app.inject({
        method: 'POST',
        url: '/api/mcp',
        payload: {
          name: 'playwright',
          url: `http://127.0.0.1:${address.port}/mcp`,
          transport: 'http',
          enabled: true,
        },
      });
      expect(created.statusCode).toBe(201);

      const serverId = JSON.parse(created.body).serverId as string;
      const called = await app.inject({
        method: 'POST',
        url: '/api/mcp/call',
        payload: {
          serverId,
          toolName: 'browser_snapshot',
          params: {},
        },
      });

      expect(called.statusCode).toBe(200);
      expect(JSON.parse(called.body)).toEqual({
        ok: true,
        result: { content: [{ type: 'text', text: 'snapshot ok after retry' }] },
      });

      expect(upstreamRequests.filter((request) => request.method === 'initialize')).toHaveLength(2);
      expect(upstreamRequests.filter((request) => request.method === 'notifications/initialized')).toHaveLength(2);

      const toolCalls = upstreamRequests.filter((request) => request.method === 'tools/call');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.sessionId).toBe('session-1');
      expect(toolCalls[1]?.sessionId).toBe('session-2');

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('accepts MCP servers with null auth payloads', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const created = await app.inject({
        method: 'POST',
        url: '/api/mcp',
        payload: {
          name: 'no-auth-server',
          url: 'http://127.0.0.1:8959/mcp',
          transport: 'http',
          auth: null,
        },
      });

      expect(created.statusCode).toBe(201);
      const { serverId } = JSON.parse(created.body) as { serverId: string };

      const detail = await app.inject({
        method: 'GET',
        url: `/api/mcp/${serverId}`,
      });

      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body)).toEqual(
        expect.objectContaining({
          name: 'no-auth-server',
          auth: null,
        }),
      );

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('discovers multiple models from an OpenAI-compatible registry endpoint', async () => {
    const upstreamRequests: Array<{ url: string; authorization?: string }> = [];
    const upstream = createServer((req, res) => {
      upstreamRequests.push({
        url: req.url ?? '',
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      });

      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'qwen3-coder-plus' },
            { id: 'qwen-plus' },
          ],
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });
      const discovered = await app.inject({
        method: 'POST',
        url: '/api/models/discover',
        payload: {
          provider: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'test-openai-key',
        },
      });

      expect(discovered.statusCode).toBe(200);
      const body = JSON.parse(discovered.body);
      expect(body.models.map((model: any) => model.id)).toEqual(['qwen3-coder-plus', 'qwen-plus']);
      expect(upstreamRequests).toEqual([
        {
          url: '/v1/models',
          authorization: 'Bearer test-openai-key',
        },
      ]);

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('uses Anthropic-compatible headers when discovering models', async () => {
    const upstreamRequests: Array<{ url: string; apiKey?: string; version?: string }> = [];
    const upstream = createServer((req, res) => {
      upstreamRequests.push({
        url: req.url ?? '',
        apiKey: typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined,
        version: typeof req.headers['anthropic-version'] === 'string' ? req.headers['anthropic-version'] : undefined,
      });

      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'claude-3-7-sonnet-latest', display_name: 'Claude 3.7 Sonnet' },
            { id: 'claude-3-5-haiku-latest', display_name: 'Claude 3.5 Haiku' },
          ],
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });
      const discovered = await app.inject({
        method: 'POST',
        url: '/api/models/discover',
        payload: {
          provider: 'anthropic-compatible',
          baseUrl: `http://127.0.0.1:${address.port}`,
          apiKey: 'test-anthropic-key',
        },
      });

      expect(discovered.statusCode).toBe(200);
      const body = JSON.parse(discovered.body);
      expect(body.models.map((model: any) => model.id)).toEqual(['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest']);
      expect(upstreamRequests).toEqual([
        {
          url: '/v1/models',
          apiKey: 'test-anthropic-key',
          version: '2023-06-01',
        },
      ]);

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('rebuilds datasource knowledge assets through datasource routes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const created = await app.inject({
        method: 'POST',
        url: '/api/datasources',
        payload: {
          name: '反欺诈画像 API',
          sourceType: 'api',
          config: { baseUrl: 'https://api.example.com/profile' },
        },
      });
      expect(created.statusCode).toBe(201);

      const sourceId = JSON.parse(created.body).sourceId as string;
      const rebuilt = await app.inject({ method: 'POST', url: `/api/datasources/${sourceId}/knowledge/rebuild` });
      expect(rebuilt.statusCode).toBe(200);

      const rebuiltBody = JSON.parse(rebuilt.body);
      expect(rebuiltBody.sourceId).toBe(sourceId);
      expect(rebuiltBody.documentCount).toBeGreaterThan(0);

      const summary = await app.inject({ method: 'GET', url: `/api/datasources/${sourceId}/knowledge` });
      expect(summary.statusCode).toBe(200);
      const summaryBody = JSON.parse(summary.body);
      expect(summaryBody.graphName).toBe(rebuiltBody.graphName);
      expect(summaryBody.vectorCollection).toBe(rebuiltBody.vectorCollection);

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('includes datasource knowledge tools in system_init tool list', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const createdModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-datasource-tools',
          isDefault: true,
        },
      });
      expect(createdModel.statusCode).toBe(201);

      const started = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'Datasource tool list session', locale: 'zh-CN' },
      });
      expect(started.statusCode).toBe(201);

      const sessionId = JSON.parse(started.body).sessionId as string;
      await ctx.runner.getHandle(sessionId)?.done;

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);
      const body = JSON.parse(detail.body);
      const systemInit = body.events.find((event: any) => event.type === 'system_init');
      const toolNames = (systemInit?.payload?.tools ?? []).map((tool: any) => tool.name);

      expect(toolNames).toContain('datasource_knowledge_search');
      expect(toolNames).toContain('datasource_knowledge_graph');
      expect(toolNames).toContain('get_database_schema');
      expect(toolNames).toContain('query_database_external');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('appends a follow-up user message to an existing session and reruns the analysis in place', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const createdModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-follow-up-session',
          isDefault: true,
        },
      });
      expect(createdModel.statusCode).toBe(201);

      const started = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'Follow-up Session', locale: 'zh-CN' },
      });
      expect(started.statusCode).toBe(201);

      const sessionId = JSON.parse(started.body).sessionId as string;
      await ctx.runner.getHandle(sessionId)?.done;

      const followUp = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        payload: { content: '请重点关注异常登录和限额策略。' },
      });
      expect(followUp.statusCode).toBe(201);
      expect(JSON.parse(followUp.body)).toEqual(
        expect.objectContaining({
          ok: true,
          sessionId,
          resumed: true,
        })
      );

      await ctx.runner.getHandle(sessionId)?.done;

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);
      const body = JSON.parse(detail.body);

      const systemInitEvents = body.events.filter((event: any) => event.type === 'system_init');
      const resultEvents = body.events.filter((event: any) => event.type === 'result');
      const userMessages = body.events.filter((event: any) => event.type === 'user_message');

      expect(systemInitEvents).toHaveLength(2);
      expect(resultEvents).toHaveLength(2);
      expect(userMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              content: '请重点关注异常登录和限额策略。',
            }),
          }),
        ])
      );

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('uses the requested follow-up model for the resumed execution', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const defaultModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-default-follow-up',
          isDefault: true,
        },
      });
      expect(defaultModel.statusCode).toBe(201);

      const overrideModel = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-override-follow-up',
          isDefault: false,
        },
      });
      expect(overrideModel.statusCode).toBe(201);

      const overrideModelId = JSON.parse(overrideModel.body).modelId as string;

      const started = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'Follow-up Model Switch', locale: 'zh-CN' },
      });
      expect(started.statusCode).toBe(201);

      const sessionId = JSON.parse(started.body).sessionId as string;
      await ctx.runner.getHandle(sessionId)?.done;

      const followUp = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/messages`,
        payload: {
          content: '请继续分析退款欺诈链路。',
          modelId: overrideModelId,
        },
      });
      expect(followUp.statusCode).toBe(201);

      await ctx.runner.getHandle(sessionId)?.done;

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);
      const body = JSON.parse(detail.body);

      const systemInitEvents = body.events.filter((event: any) => event.type === 'system_init');

      expect(systemInitEvents).toHaveLength(2);
      expect(systemInitEvents[0].payload.model).toBe('mock-default-follow-up');
      expect(systemInitEvents[1].payload.model).toBe('mock-override-follow-up');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('imports a skill package and exposes a browsable file tree', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-svr-'));
    try {
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const imported = await app.inject({
        method: 'POST',
        url: '/api/skills/import',
        payload: {
          rootName: 'skill-creator',
          files: [
            {
              path: 'SKILL.md',
              content: '# skill-creator\n\nCreate new skills, modify and improve existing skills.',
            },
            {
              path: 'agents/grader.md',
              content: 'grader instructions',
            },
            {
              path: 'references/schema.json',
              content: '{"type":"object"}',
            },
          ],
        },
      });

      expect(imported.statusCode).toBe(201);
      const importedBody = JSON.parse(imported.body);
      expect(importedBody.data.name).toBe('skill-creator');
      expect(importedBody.data.source).toBe('directory');

      const otherImported = await app.inject({
        method: 'POST',
        url: '/api/skills/import',
        payload: {
          rootName: 'runbooks',
          files: [
            {
              path: 'SKILL.md',
              content: '# runbooks\n\nOperational procedures and playbooks.',
            },
          ],
        },
      });
      expect(otherImported.statusCode).toBe(201);

      const listed = await app.inject({ method: 'GET', url: '/api/skills' });
      expect(listed.statusCode).toBe(200);
      const listedBody = JSON.parse(listed.body);
      expect(listedBody.data.some((skill: any) => skill.name === 'skill-creator')).toBe(true);

      const searched = await app.inject({ method: 'GET', url: '/api/skills?q=creator' });
      expect(searched.statusCode).toBe(200);
      const searchedBody = JSON.parse(searched.body);
      expect(searchedBody.data.some((skill: any) => skill.name === 'skill-creator')).toBe(true);
      expect(searchedBody.data.some((skill: any) => skill.name === 'runbooks')).toBe(false);

      const tree = await app.inject({ method: 'GET', url: '/api/skills/skill-creator/tree' });
      expect(tree.statusCode).toBe(200);
      const treeBody = JSON.parse(tree.body);
      expect(treeBody.data.entries).toEqual([
        { path: 'SKILL.md', type: 'file' },
        { path: 'agents', type: 'directory' },
        { path: 'agents/grader.md', type: 'file' },
        { path: 'references', type: 'directory' },
        { path: 'references/schema.json', type: 'file' },
      ]);

      const file = await app.inject({
        method: 'GET',
        url: '/api/skills/skill-creator/file?path=agents%2Fgrader.md',
      });
      expect(file.statusCode).toBe(200);
      const fileBody = JSON.parse(file.body);
      expect(fileBody.data.path).toBe('agents/grader.md');
      expect(fileBody.data.content).toBe('grader instructions');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });
});
