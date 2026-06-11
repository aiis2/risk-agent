import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageBackendRegistry } from '@risk-agent/core';
import { BrowserWorkspaceService } from '../BrowserWorkspaceService.js';
import { createDefaultBrowserRuntimePreferences } from '../../preferences/appPreferences.js';

describe('BrowserWorkspaceService', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (!path) continue;
      try { rmSync(path, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('creates an exclusive embedded workspace and owner binding for a new session', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-a', createDefaultBrowserRuntimePreferences());
    const state = await service.listState();

    expect(workspace.ownerSessionId).toBe('session-a');
    expect(workspace.visibility).toBe('exclusive');
    expect(workspace.providerKind).toBe('embedded');
    expect(workspace.controllerSessionId).toBe('session-a');
    expect(state.workspaces).toHaveLength(1);
    expect(state.bindings).toEqual([
      expect.objectContaining({
        sessionId: 'session-a',
        workspaceId: workspace.workspaceId,
        role: 'owner',
        source: 'default',
        canControl: true,
      }),
    ]);
  });

  it('allows a shared workspace to be attached by another session as an observer', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-owner', createDefaultBrowserRuntimePreferences());
    await service.markWorkspaceShared('session-owner', workspace.workspaceId, 'manual');
    await service.attachWorkspace('session-observer', workspace.workspaceId);

    const state = await service.listState();
    const shared = state.workspaces.find((item) => item.workspaceId === workspace.workspaceId);
    const observerBinding = state.bindings.find((item) => item.sessionId === 'session-observer');

    expect(shared?.visibility).toBe('shared');
    expect(shared?.sharePolicy).toBe('manual');
    expect(observerBinding).toEqual(expect.objectContaining({
      sessionId: 'session-observer',
      workspaceId: workspace.workspaceId,
      role: 'observer',
      source: 'manual-attach',
      canControl: false,
    }));
  });

  it('detaches an attached observer binding without removing the workspace', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-owner', createDefaultBrowserRuntimePreferences());
    await service.markWorkspaceShared('session-owner', workspace.workspaceId, 'manual');
    await service.attachWorkspace('session-observer', workspace.workspaceId);

    await service.detachWorkspace('session-observer', workspace.workspaceId);

    const state = await service.listState();

    expect(state.workspaces.find((item) => item.workspaceId === workspace.workspaceId)).toBeTruthy();
    expect(state.bindings.some((item) => item.sessionId === 'session-observer' && item.workspaceId === workspace.workspaceId)).toBe(false);
    expect(state.bindings.find((item) => item.sessionId === 'session-owner' && item.workspaceId === workspace.workspaceId)).toBeTruthy();
  });

  it('deletes a workspace together with its tabs and bindings', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-owner', createDefaultBrowserRuntimePreferences());
    await service.createTab(workspace.workspaceId, {
      title: 'Workspace Tab',
      currentUrl: 'https://example.com/delete-me',
      status: 'ready',
      contributedBySessionId: 'session-owner',
    });
    await service.markWorkspaceShared('session-owner', workspace.workspaceId, 'manual');
    await service.attachWorkspace('session-observer', workspace.workspaceId);

    await service.deleteWorkspace('session-owner', workspace.workspaceId);

    const state = await service.listState();

    expect(state.workspaces.find((item) => item.workspaceId === workspace.workspaceId)).toBeUndefined();
    expect(state.tabs.some((item) => item.workspaceId === workspace.workspaceId)).toBe(false);
    expect(state.bindings.some((item) => item.workspaceId === workspace.workspaceId)).toBe(false);
  });

  it('creates tabs and resolves the active tab for the bound session', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-tabs', createDefaultBrowserRuntimePreferences());
    const firstTab = await service.createTab(workspace.workspaceId, {
      title: 'Risk Agent',
      currentUrl: 'https://example.com/one',
      status: 'ready',
      providerTabRef: 'provider-tab-1',
      contributedBySessionId: 'session-tabs',
    });
    const secondTab = await service.createTab(workspace.workspaceId, {
      title: 'Shared Report',
      currentUrl: 'https://example.com/two',
      status: 'loading',
      providerTabRef: 'provider-tab-2',
      contributedBySessionId: 'session-tabs',
    });
    await service.activateTab(workspace.workspaceId, firstTab.tabId);

    const target = await service.resolveSessionTarget('session-tabs');

    expect(secondTab.tabId).not.toBe(firstTab.tabId);
    expect(target).toMatchObject({
      workspace: {
        workspaceId: workspace.workspaceId,
        lastActiveTabId: firstTab.tabId,
      },
      binding: {
        sessionId: 'session-tabs',
        workspaceId: workspace.workspaceId,
        role: 'owner',
      },
      tab: {
        tabId: firstTab.tabId,
        providerTabRef: 'provider-tab-1',
        currentUrl: 'https://example.com/one',
      },
    });
  });

  it('persists pinned tab layout and orders pinned tabs before regular tabs', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-layout', createDefaultBrowserRuntimePreferences());
    const firstTab = await service.createTab(workspace.workspaceId, {
      title: 'First Tab',
      currentUrl: 'https://example.com/first',
      status: 'ready',
    });
    const secondTab = await service.createTab(workspace.workspaceId, {
      title: 'Second Tab',
      currentUrl: 'https://example.com/second',
      status: 'ready',
    });
    const thirdTab = await service.createTab(workspace.workspaceId, {
      title: 'Third Tab',
      currentUrl: 'https://example.com/third',
      status: 'ready',
    });

    expect([firstTab.isPinned, secondTab.isPinned, thirdTab.isPinned]).toEqual([false, false, false]);
    expect([firstTab.sortOrder, secondTab.sortOrder, thirdTab.sortOrder]).toEqual([0, 1, 2]);

    await service.saveTabLayout(workspace.workspaceId, [
      { tabId: secondTab.tabId, isPinned: true },
      { tabId: thirdTab.tabId, isPinned: true },
      { tabId: firstTab.tabId, isPinned: false },
    ]);

    const tabs = await service.listWorkspaceTabs(workspace.workspaceId);

    expect(tabs.map((tab) => ({ tabId: tab.tabId, isPinned: tab.isPinned, sortOrder: tab.sortOrder }))).toEqual([
      { tabId: secondTab.tabId, isPinned: true, sortOrder: 0 },
      { tabId: thirdTab.tabId, isPinned: true, sortOrder: 1 },
      { tabId: firstTab.tabId, isPinned: false, sortOrder: 2 },
    ]);

    const state = await service.listState();
    const workspaceTabs = state.tabs.filter((tab) => tab.workspaceId === workspace.workspaceId);
    expect(workspaceTabs.map((tab) => tab.tabId)).toEqual([secondTab.tabId, thirdTab.tabId, firstTab.tabId]);
  });

  it('preserves the active tab when closing another tab and chooses the nearest neighbor when closing the active tab', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-browser-workspace-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    const service = new BrowserWorkspaceService(storage.getStructuredStore());
    await service.ensureSchema();

    const workspace = await service.ensureSessionWorkspace('session-close', createDefaultBrowserRuntimePreferences());
    const firstTab = await service.createTab(workspace.workspaceId, {
      title: 'First Tab',
      currentUrl: 'https://example.com/first',
      status: 'ready',
    });
    const secondTab = await service.createTab(workspace.workspaceId, {
      title: 'Second Tab',
      currentUrl: 'https://example.com/second',
      status: 'ready',
    });
    const thirdTab = await service.createTab(workspace.workspaceId, {
      title: 'Third Tab',
      currentUrl: 'https://example.com/third',
      status: 'ready',
    });

    await service.activateTab(workspace.workspaceId, secondTab.tabId);

    const closedFirst = await service.removeTab(firstTab.tabId);
    const afterClosingFirst = await service.resolveSessionTarget('session-close');

    expect(closedFirst.nextActiveTabId).toBe(secondTab.tabId);
    expect(afterClosingFirst?.workspace.lastActiveTabId).toBe(secondTab.tabId);
    expect(afterClosingFirst?.tab?.tabId).toBe(secondTab.tabId);

    const closedSecond = await service.removeTab(secondTab.tabId);
    const afterClosingSecond = await service.resolveSessionTarget('session-close');

    expect(closedSecond.nextActiveTabId).toBe(thirdTab.tabId);
    expect(afterClosingSecond?.workspace.lastActiveTabId).toBe(thirdTab.tabId);
    expect(afterClosingSecond?.tab?.tabId).toBe(thirdTab.tabId);
  });
});