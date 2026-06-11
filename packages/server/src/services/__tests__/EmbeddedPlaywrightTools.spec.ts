import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageBackendRegistry } from '@risk-agent/core';
import { BrowserWorkspaceService } from '../../browser/BrowserWorkspaceService.js';
import { executeEmbeddedPlaywrightTool } from '../EmbeddedPlaywrightTools.js';

describe('executeEmbeddedPlaywrightTool', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (!path) continue;
      try { rmSync(path, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('creates a session-bound embedded tab through browser_tabs_new and syncs host metadata', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-embedded-playwright-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Embedded Host Tab',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));

    const result = await executeEmbeddedPlaywrightTool(
      {
        browserWorkspaces,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: createTabSpy,
        },
        preferenceStore: store,
      },
      {
        toolName: 'browser_tabs_new',
        arguments: { url: 'https://example.com/embedded' },
        sessionId: 'session-embedded-tools',
      },
    );

    expect(result).toMatchObject({
      workspace: {
        ownerSessionId: 'session-embedded-tools',
        visibility: 'exclusive',
      },
      tab: {
        currentUrl: 'https://example.com/embedded',
        title: 'Embedded Host Tab',
        providerTabRef: expect.stringMatching(/^browser-host:/),
      },
    });
    expect(createTabSpy).toHaveBeenCalledOnce();

    const state = await browserWorkspaces.listState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({
      currentUrl: 'https://example.com/embedded',
      title: 'Embedded Host Tab',
      providerTabRef: expect.stringMatching(/^browser-host:/),
    });
  });

  it('navigates the active session tab and returns snapshot content from the host adapter', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-embedded-playwright-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Initial Tab',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));
    const navigateSpy = vi.fn(async (tabId: string, url: string) => ({
      tabId,
      workspaceId: 'workspace-ignored',
      providerTabRef: `browser-host:${tabId}`,
      title: 'Navigated Tab',
      currentUrl: url,
      status: 'ready',
      canGoBack: true,
      canGoForward: false,
    }));
    const snapshotSpy = vi.fn(async () => ({
      title: 'Navigated Tab',
      currentUrl: 'https://example.com/navigated',
      html: '<html><body><main>Navigated content</main></body></html>',
      text: 'Navigated content',
    }));

    const controller = {
      browserWorkspaces,
      browserHostAdapter: {
        isAvailable: () => true,
        createTab: createTabSpy,
        navigate: navigateSpy,
        snapshot: snapshotSpy,
      },
      preferenceStore: store,
    };

    await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_tabs_new',
      arguments: { url: 'https://example.com/initial' },
      sessionId: 'session-navigate-tools',
    });

    const navigated = await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_navigate',
      arguments: { url: 'https://example.com/navigated' },
      sessionId: 'session-navigate-tools',
    });

    expect(navigated).toMatchObject({
      tab: {
        currentUrl: 'https://example.com/navigated',
        title: 'Navigated Tab',
        status: 'ready',
      },
    });
    expect(navigateSpy).toHaveBeenCalledOnce();

    const snapshot = await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_snapshot',
      arguments: {},
      sessionId: 'session-navigate-tools',
    });

    expect(snapshot).toMatchObject({
      title: 'Navigated Tab',
      currentUrl: 'https://example.com/navigated',
      text: 'Navigated content',
    });
    expect(snapshotSpy).toHaveBeenCalledOnce();
  });

  it('rehydrates the persisted hosted tab before snapshotting when the desktop host lost it from memory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-embedded-playwright-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Restored Tab',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));
    const readMetadataSpy = vi.fn(async () => null);
    const snapshotSpy = vi.fn(async () => ({
      title: 'Restored Tab',
      currentUrl: 'https://example.com/restored',
      html: '<html><body>restored</body></html>',
      text: 'restored',
    }));

    const controller = {
      browserWorkspaces,
      browserHostAdapter: {
        isAvailable: () => true,
        createTab: createTabSpy,
        readMetadata: readMetadataSpy,
        snapshot: snapshotSpy,
      },
      preferenceStore: store,
    };

    await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_tabs_new',
      arguments: { url: 'https://example.com/restored' },
      sessionId: 'session-restored-tools',
    });

    createTabSpy.mockClear();

    const snapshot = await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_snapshot',
      arguments: {},
      sessionId: 'session-restored-tools',
    });

    expect(readMetadataSpy).toHaveBeenCalledOnce();
    expect(createTabSpy).toHaveBeenCalledWith(
      expect.any(String),
      'https://example.com/restored',
      expect.any(String),
    );
    expect(snapshotSpy).toHaveBeenCalledOnce();
    expect(snapshot).toMatchObject({
      title: 'Restored Tab',
      currentUrl: 'https://example.com/restored',
      text: 'restored',
    });
  });

  it('rehydrates the persisted hosted tab before navigating when the desktop host lost it from memory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-embedded-playwright-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Restored Before Navigate',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));
    const readMetadataSpy = vi.fn(async () => null);
    const navigateSpy = vi.fn(async (tabId: string, url: string) => ({
      tabId,
      workspaceId: 'workspace-ignored',
      providerTabRef: `browser-host:${tabId}`,
      title: 'Navigated After Restore',
      currentUrl: url,
      status: 'ready',
      canGoBack: true,
      canGoForward: false,
    }));

    const controller = {
      browserWorkspaces,
      browserHostAdapter: {
        isAvailable: () => true,
        createTab: createTabSpy,
        readMetadata: readMetadataSpy,
        navigate: navigateSpy,
      },
      preferenceStore: store,
    };

    await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_tabs_new',
      arguments: { url: 'https://example.com/original' },
      sessionId: 'session-restore-navigate',
    });

    createTabSpy.mockClear();

    const navigated = await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_navigate',
      arguments: { url: 'https://example.com/after-restore' },
      sessionId: 'session-restore-navigate',
    });

    expect(readMetadataSpy).toHaveBeenCalledOnce();
    expect(createTabSpy).toHaveBeenCalledWith(expect.any(String), 'https://example.com/original', expect.any(String));
    expect(navigateSpy).toHaveBeenCalledWith(expect.any(String), 'https://example.com/after-restore');
    expect(navigated).toMatchObject({
      tab: {
        currentUrl: 'https://example.com/after-restore',
        title: 'Navigated After Restore',
      },
    });
  });

  it('rehydrates the persisted hosted tab before taking a screenshot when the desktop host lost it from memory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-embedded-playwright-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Restored Before Screenshot',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));
    const readMetadataSpy = vi.fn(async () => null);
    const screenshotSpy = vi.fn(async () => ({
      mimeType: 'image/png' as const,
      dataBase64: 'ZmFrZS1wbmc=',
    }));

    const controller = {
      browserWorkspaces,
      browserHostAdapter: {
        isAvailable: () => true,
        createTab: createTabSpy,
        readMetadata: readMetadataSpy,
        screenshot: screenshotSpy,
      },
      preferenceStore: store,
    };

    await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_tabs_new',
      arguments: { url: 'https://example.com/screenshot' },
      sessionId: 'session-restore-screenshot',
    });

    createTabSpy.mockClear();

    const screenshot = await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_take_screenshot',
      arguments: { fullPage: true },
      sessionId: 'session-restore-screenshot',
    });

    expect(readMetadataSpy).toHaveBeenCalledOnce();
    expect(createTabSpy).toHaveBeenCalledWith(expect.any(String), 'https://example.com/screenshot', expect.any(String));
    expect(screenshotSpy).toHaveBeenCalledWith(expect.any(String), { fullPage: true });
    expect(screenshot).toMatchObject({
      currentUrl: 'https://example.com/screenshot',
      screenshot: {
        mimeType: 'image/png',
      },
    });
  });

  it('lists page images from the active embedded browser tab', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-embedded-playwright-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'Images Page',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));
    const listImagesSpy = vi.fn(async () => ([
      {
        src: 'https://example.com/assets/hero.png',
        currentSrc: 'https://example.com/assets/hero.png',
        alt: 'Hero banner',
        title: 'Hero image',
        width: 640,
        height: 360,
        naturalWidth: 1280,
        naturalHeight: 720,
      },
    ]));

    const controller = {
      browserWorkspaces,
      browserHostAdapter: {
        isAvailable: () => true,
        createTab: createTabSpy,
        listImages: listImagesSpy,
      },
      preferenceStore: store,
    };

    await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_tabs_new',
      arguments: { url: 'https://example.com/images' },
      sessionId: 'session-images-tools',
    });

    const result = await executeEmbeddedPlaywrightTool(controller, {
      toolName: 'browser_list_images',
      arguments: { limit: 10 },
      sessionId: 'session-images-tools',
    });

    expect(listImagesSpy).toHaveBeenCalledWith(expect.any(String), 10);
    expect(result).toMatchObject({
      currentUrl: 'https://example.com/images',
      images: [
        {
          src: 'https://example.com/assets/hero.png',
          alt: 'Hero banner',
          naturalWidth: 1280,
          naturalHeight: 720,
        },
      ],
    });
  });
});