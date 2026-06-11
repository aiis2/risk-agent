/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  activateBrowserTab: vi.fn(),
  closeBrowserTab: vi.fn(),
  createBrowserTab: vi.fn(),
  ensureSessionBrowserWorkspace: vi.fn(),
  getBrowserState: vi.fn(),
  reloadBrowserTab: vi.fn(),
  saveBrowserTabLayout: vi.fn(),
}));

const electronMocks = vi.hoisted(() => ({
  openBrowserHost: vi.fn(),
  setBrowserPanelBounds: vi.fn(),
}));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    activateBrowserTab: apiMocks.activateBrowserTab,
    closeBrowserTab: apiMocks.closeBrowserTab,
    createBrowserTab: apiMocks.createBrowserTab,
    ensureSessionBrowserWorkspace: apiMocks.ensureSessionBrowserWorkspace,
    getBrowserState: apiMocks.getBrowserState,
    reloadBrowserTab: apiMocks.reloadBrowserTab,
    saveBrowserTabLayout: apiMocks.saveBrowserTabLayout,
  };
});

vi.mock('../../../lib/electron', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/electron')>('../../../lib/electron');
  return {
    ...actual,
    getElectronAPI: () => ({
      openBrowserHost: electronMocks.openBrowserHost,
      setBrowserPanelBounds: electronMocks.setBrowserPanelBounds,
    }),
    isElectron: () => true,
  };
});

import { BrowserPanel } from '../BrowserPanel';

function renderBrowserPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserPanel runId="run_chat_1" />
    </QueryClientProvider>,
  );
}

describe('BrowserPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 12,
        y: 24,
        top: 24,
        left: 12,
        bottom: 444,
        right: 652,
        width: 640,
        height: 420,
        toJSON: () => ({}),
      }),
    });

    apiMocks.ensureSessionBrowserWorkspace.mockResolvedValue({
      ok: true,
      workspace: {
        workspaceId: 'workspace-1',
        ownerSessionId: 'run_chat_1',
        ownerType: 'session',
        visibility: 'exclusive',
        providerKind: 'embedded',
        sharePolicy: 'manual',
        controllerSessionId: 'run_chat_1',
        lastActiveTabId: 'tab-1',
        createdAt: '2026-05-19T10:00:00.000Z',
        updatedAt: '2026-05-19T10:00:00.000Z',
      },
    });
    apiMocks.getBrowserState.mockResolvedValue({
      hostAvailable: true,
      workspaces: [
        {
          workspaceId: 'workspace-1',
          ownerSessionId: 'run_chat_1',
          ownerType: 'session',
          visibility: 'exclusive',
          providerKind: 'embedded',
          sharePolicy: 'manual',
          controllerSessionId: 'run_chat_1',
          lastActiveTabId: 'tab-1',
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
      ],
      tabs: [
        {
          tabId: 'tab-1',
          workspaceId: 'workspace-1',
          title: 'Example Domain',
          currentUrl: 'https://example.com',
          status: 'ready',
          providerTabRef: 'browser-host:tab-1',
          contributedBySessionId: 'run_chat_1',
          isPinned: false,
          sortOrder: 0,
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
      ],
      bindings: [
        {
          bindingId: 'binding-1',
          sessionId: 'run_chat_1',
          workspaceId: 'workspace-1',
          role: 'owner',
          source: 'default',
          canControl: true,
          attachedAt: '2026-05-19T10:00:00.000Z',
          detachedAt: null,
        },
      ],
    });
    apiMocks.createBrowserTab.mockResolvedValue({
      ok: true,
      tab: {
        tabId: 'tab-2',
        workspaceId: 'workspace-1',
        title: 'New Tab',
        currentUrl: 'https://example.org',
        status: 'ready',
        providerTabRef: 'browser-host:tab-2',
        contributedBySessionId: 'run_chat_1',
        createdAt: '2026-05-19T10:01:00.000Z',
        updatedAt: '2026-05-19T10:01:00.000Z',
      },
    });
    apiMocks.activateBrowserTab.mockResolvedValue({ ok: true, workspace: { workspaceId: 'workspace-1' } });
    apiMocks.reloadBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-1' } });
    apiMocks.closeBrowserTab.mockResolvedValue({ ok: true, workspaceId: 'workspace-1', closedTabId: 'tab-1', nextActiveTabId: null });
    apiMocks.saveBrowserTabLayout.mockResolvedValue({ ok: true, tabs: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders workspace tabs and forwards toolbar actions through browser routes', async () => {
    const user = userEvent.setup();
    renderBrowserPanel();

    expect(await screen.findByText('Example Domain')).toBeTruthy();
    expect(screen.getByDisplayValue('https://example.com')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新当前标签页' }));
    await user.click(screen.getByRole('button', { name: '在独立 Browser Host 中打开' }));
    await user.clear(screen.getByLabelText('新标签页地址'));
    await user.type(screen.getByLabelText('新标签页地址'), 'https://example.org');
    await user.click(screen.getByRole('button', { name: '新建标签页' }));
    await user.click(screen.getByRole('button', { name: '关闭当前标签页' }));

    expect(apiMocks.reloadBrowserTab).toHaveBeenCalledWith('tab-1', 'workspace-1');
    expect(electronMocks.openBrowserHost).toHaveBeenCalledOnce();
    expect(apiMocks.createBrowserTab).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      currentUrl: 'https://example.org',
      title: null,
      status: 'ready',
      contributedBySessionId: 'run_chat_1',
    });
    expect(apiMocks.closeBrowserTab).toHaveBeenCalledWith('tab-1', 'workspace-1');
  });

  it('auto-activates the last active tab on mount so the embedded browser surface can restore it', async () => {
    renderBrowserPanel();

    await waitFor(() => {
      expect(apiMocks.activateBrowserTab).toHaveBeenCalledWith('tab-1', 'workspace-1');
    });
  });

  it('syncs the browser viewport bounds to Electron and clears them on unmount', async () => {
    const view = renderBrowserPanel();

    await waitFor(() => {
      expect(electronMocks.setBrowserPanelBounds).toHaveBeenCalledWith({
        x: 12,
        y: 24,
        width: 640,
        height: 420,
      });
    });

    view.unmount();

    expect(electronMocks.setBrowserPanelBounds).toHaveBeenLastCalledWith(null);
  });

  it('keeps the browser viewport mounted while switching tabs so the embedded surface does not flicker', async () => {
    const user = userEvent.setup();
    apiMocks.getBrowserState.mockResolvedValue({
      hostAvailable: true,
      workspaces: [
        {
          workspaceId: 'workspace-1',
          ownerSessionId: 'run_chat_1',
          ownerType: 'session',
          visibility: 'exclusive',
          providerKind: 'embedded',
          sharePolicy: 'manual',
          controllerSessionId: 'run_chat_1',
          lastActiveTabId: 'tab-1',
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
      ],
      tabs: [
        {
          tabId: 'tab-1',
          workspaceId: 'workspace-1',
          title: 'Example Domain',
          currentUrl: 'https://example.com',
          status: 'ready',
          providerTabRef: 'browser-host:tab-1',
          contributedBySessionId: 'run_chat_1',
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
        {
          tabId: 'tab-2',
          workspaceId: 'workspace-1',
          title: 'Risk Agent Docs',
          currentUrl: 'https://example.com/docs',
          status: 'ready',
          providerTabRef: 'browser-host:tab-2',
          contributedBySessionId: 'run_chat_1',
          isPinned: false,
          sortOrder: 1,
          createdAt: '2026-05-19T10:01:00.000Z',
          updatedAt: '2026-05-19T10:01:00.000Z',
        },
      ],
      bindings: [
        {
          bindingId: 'binding-1',
          sessionId: 'run_chat_1',
          workspaceId: 'workspace-1',
          role: 'owner',
          source: 'default',
          canControl: true,
          attachedAt: '2026-05-19T10:00:00.000Z',
          detachedAt: null,
        },
      ],
    });

    renderBrowserPanel();

    await screen.findByText('Risk Agent Docs');
    await waitFor(() => {
      expect(electronMocks.setBrowserPanelBounds).toHaveBeenCalledWith({
        x: 12,
        y: 24,
        width: 640,
        height: 420,
      });
    });

    electronMocks.setBrowserPanelBounds.mockClear();

    await user.click(screen.getByRole('button', { name: 'Risk Agent Docs' }));

    expect(apiMocks.activateBrowserTab).toHaveBeenCalledWith('tab-2', 'workspace-1');
    expect(electronMocks.setBrowserPanelBounds).not.toHaveBeenCalledWith(null);
    expect(electronMocks.setBrowserPanelBounds).not.toHaveBeenCalled();
  });

  it('persists pinning and quick-close actions from the embedded tab strip', async () => {
    const user = userEvent.setup();
    apiMocks.getBrowserState.mockResolvedValue({
      hostAvailable: true,
      workspaces: [
        {
          workspaceId: 'workspace-1',
          ownerSessionId: 'run_chat_1',
          ownerType: 'session',
          visibility: 'exclusive',
          providerKind: 'embedded',
          sharePolicy: 'manual',
          controllerSessionId: 'run_chat_1',
          lastActiveTabId: 'tab-1',
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
      ],
      tabs: [
        {
          tabId: 'tab-1',
          workspaceId: 'workspace-1',
          title: 'Example Domain',
          currentUrl: 'https://example.com',
          status: 'ready',
          providerTabRef: 'browser-host:tab-1',
          contributedBySessionId: 'run_chat_1',
          isPinned: false,
          sortOrder: 0,
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
        {
          tabId: 'tab-2',
          workspaceId: 'workspace-1',
          title: 'Risk Agent Docs',
          currentUrl: 'https://example.com/docs',
          status: 'ready',
          providerTabRef: 'browser-host:tab-2',
          contributedBySessionId: 'run_chat_1',
          isPinned: false,
          sortOrder: 1,
          createdAt: '2026-05-19T10:01:00.000Z',
          updatedAt: '2026-05-19T10:01:00.000Z',
        },
      ],
      bindings: [
        {
          bindingId: 'binding-1',
          sessionId: 'run_chat_1',
          workspaceId: 'workspace-1',
          role: 'owner',
          source: 'default',
          canControl: true,
          attachedAt: '2026-05-19T10:00:00.000Z',
          detachedAt: null,
        },
      ],
    });

    renderBrowserPanel();

    await screen.findByText('Risk Agent Docs');

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Risk Agent Docs' }));
    await user.click(await screen.findByRole('menuitem', { name: '固定标签页' }));

    expect(apiMocks.saveBrowserTabLayout).toHaveBeenCalledWith('workspace-1', [
      { tabId: 'tab-2', isPinned: true },
      { tabId: 'tab-1', isPinned: false },
    ]);

    await user.click(screen.getByRole('button', { name: '快速关闭 Risk Agent Docs' }));

    expect(apiMocks.closeBrowserTab).toHaveBeenCalledWith('tab-2', 'workspace-1');
  });
});