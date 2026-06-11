/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  activateBrowserTab: vi.fn(),
  attachBrowserWorkspace: vi.fn(),
  closeBrowserTab: vi.fn(),
  createBrowserTab: vi.fn(),
  ensureStandaloneBrowserWorkspace: vi.fn(),
  getBrowserState: vi.fn(),
  goBackBrowserTab: vi.fn(),
  goForwardBrowserTab: vi.fn(),
  navigateBrowserTab: vi.fn(),
  reloadBrowserTab: vi.fn(),
  saveBrowserTabLayout: vi.fn(),
  shareBrowserWorkspace: vi.fn(),
}));

const electronMocks = vi.hoisted(() => ({
  closeBrowserHostWindow: vi.fn(),
  minimizeBrowserHostWindow: vi.fn(),
  openBrowserHost: vi.fn(),
  setBrowserPanelBounds: vi.fn(),
  toggleBrowserHostMaximize: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    activateBrowserTab: apiMocks.activateBrowserTab,
    attachBrowserWorkspace: apiMocks.attachBrowserWorkspace,
    closeBrowserTab: apiMocks.closeBrowserTab,
    createBrowserTab: apiMocks.createBrowserTab,
    ensureStandaloneBrowserWorkspace: apiMocks.ensureStandaloneBrowserWorkspace,
    getBrowserState: apiMocks.getBrowserState,
    goBackBrowserTab: apiMocks.goBackBrowserTab,
    goForwardBrowserTab: apiMocks.goForwardBrowserTab,
    navigateBrowserTab: apiMocks.navigateBrowserTab,
    reloadBrowserTab: apiMocks.reloadBrowserTab,
    saveBrowserTabLayout: apiMocks.saveBrowserTabLayout,
    shareBrowserWorkspace: apiMocks.shareBrowserWorkspace,
  };
});

vi.mock('../../lib/electron', async () => {
  const actual = await vi.importActual<typeof import('../../lib/electron')>('../../lib/electron');
  return {
    ...actual,
    getElectronAPI: () => ({
      closeBrowserHostWindow: electronMocks.closeBrowserHostWindow,
      getDataDir: vi.fn(),
      getVersion: vi.fn(),
      minimizeBrowserHostWindow: electronMocks.minimizeBrowserHostWindow,
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      openBrowserHost: electronMocks.openBrowserHost,
      quitAndInstall: vi.fn(),
      removeUpdateListeners: vi.fn(),
      selectDirectory: vi.fn(),
      selectFile: vi.fn(),
      setBrowserPanelBounds: electronMocks.setBrowserPanelBounds,
      toggleBrowserHostMaximize: electronMocks.toggleBrowserHostMaximize,
      checkForUpdates: vi.fn(),
    }),
    isElectron: () => true,
  };
});

import { BrowserHostPage } from '../BrowserHost';

function renderBrowserHostPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/browser-host']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/browser-host" element={<BrowserHostPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BrowserHostPage', () => {
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

    apiMocks.getBrowserState.mockResolvedValue({
      hostAvailable: true,
      workspaces: [
        {
          workspaceId: 'workspace-1',
          ownerSessionId: 'run-chat-1',
          ownerType: 'session',
          visibility: 'exclusive',
          providerKind: 'embedded',
          sharePolicy: 'manual',
          controllerSessionId: 'run-chat-1',
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
          contributedBySessionId: 'run-chat-1',
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
          contributedBySessionId: 'run-chat-1',
          isPinned: false,
          sortOrder: 1,
          createdAt: '2026-05-19T10:01:00.000Z',
          updatedAt: '2026-05-19T10:01:00.000Z',
        },
      ],
      bindings: [
        {
          bindingId: 'binding-1',
          sessionId: 'run-chat-1',
          workspaceId: 'workspace-1',
          role: 'owner',
          source: 'default',
          canControl: true,
          attachedAt: '2026-05-19T10:00:00.000Z',
          detachedAt: null,
        },
      ],
    });

    apiMocks.activateBrowserTab.mockResolvedValue({ ok: true, workspace: { workspaceId: 'workspace-1' } });
    apiMocks.navigateBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-1', currentUrl: 'https://example.org', title: 'Example Org' } });
    apiMocks.goBackBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-1' } });
    apiMocks.goForwardBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-1' } });
    apiMocks.reloadBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-1' } });
    apiMocks.closeBrowserTab.mockResolvedValue({ ok: true, workspaceId: 'workspace-1', closedTabId: 'tab-2', nextActiveTabId: 'tab-1' });
    apiMocks.createBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-3', workspaceId: 'workspace-1' } });
    apiMocks.ensureStandaloneBrowserWorkspace.mockResolvedValue({
      ok: true,
      workspace: {
        workspaceId: 'workspace-standalone',
        ownerSessionId: null,
        ownerType: 'browser-host',
        visibility: 'exclusive',
        providerKind: 'embedded',
        sharePolicy: 'manual',
        controllerSessionId: null,
        lastActiveTabId: null,
        createdAt: '2026-05-19T10:00:00.000Z',
        updatedAt: '2026-05-19T10:00:00.000Z',
      },
    });
    apiMocks.saveBrowserTabLayout.mockResolvedValue({ ok: true, tabs: [] });
    apiMocks.shareBrowserWorkspace.mockResolvedValue({ ok: true, workspace: { workspaceId: 'workspace-1', visibility: 'shared' } });
    apiMocks.attachBrowserWorkspace.mockResolvedValue({ ok: true, binding: { bindingId: 'binding-2' } });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a dedicated browser host shell and forwards tab and address bar actions', async () => {
    const user = userEvent.setup();
    renderBrowserHostPage();

    expect(await screen.findByText('Example Domain')).toBeTruthy();
    expect((screen.getByLabelText('地址栏') as HTMLInputElement).value).toBe('https://example.com');
    expect(screen.queryByLabelText('智能聊天')).toBeNull();

    await user.clear(screen.getByLabelText('地址栏'));
    await user.type(screen.getByLabelText('地址栏'), 'https://example.org');
    await user.click(screen.getByRole('button', { name: '打开地址' }));
    await user.click(screen.getByRole('button', { name: 'Risk Agent Docs' }));
    await user.click(screen.getByRole('button', { name: '后退' }));
    await user.click(screen.getByRole('button', { name: '前进' }));
    await user.click(screen.getByRole('button', { name: '刷新当前标签页' }));

    expect(apiMocks.navigateBrowserTab).toHaveBeenCalledWith('tab-1', 'workspace-1', 'https://example.org');
    await waitFor(() => {
      expect(apiMocks.activateBrowserTab).toHaveBeenCalledWith('tab-2', 'workspace-1');
    });
    expect(apiMocks.goBackBrowserTab).toHaveBeenCalledWith('tab-2', 'workspace-1');
    expect(apiMocks.goForwardBrowserTab).toHaveBeenCalledWith('tab-2', 'workspace-1');
    expect(apiMocks.reloadBrowserTab).toHaveBeenCalledWith('tab-2', 'workspace-1');
  });

  it('hides duplicate window controls inside the Electron browser host shell', async () => {
    renderBrowserHostPage();

    await screen.findByText('Example Domain');

    expect(screen.queryByRole('button', { name: '最小化 Browser Host' })).toBeNull();
    expect(screen.queryByRole('button', { name: '最大化 Browser Host' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭 Browser Host' })).toBeNull();
  });

  it('supports quick close and pinning from the top tab strip', async () => {
    const user = userEvent.setup();
    renderBrowserHostPage();

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

  it('creates a standalone workspace before creating the first tab from the empty state', async () => {
    const user = userEvent.setup();
    apiMocks.getBrowserState.mockResolvedValueOnce({
      hostAvailable: true,
      workspaces: [],
      tabs: [],
      bindings: [],
    });

    renderBrowserHostPage();

    await screen.findByText('独立窗口已就绪，等待浏览器标签页');

    await user.type(screen.getByLabelText('地址栏'), 'docs.risk-agent.local');
    await user.click(screen.getByRole('button', { name: '创建首个标签页' }));

    await waitFor(() => {
      expect(apiMocks.ensureStandaloneBrowserWorkspace).toHaveBeenCalledOnce();
    });
    expect(apiMocks.createBrowserTab).toHaveBeenCalledWith({
      workspaceId: 'workspace-standalone',
      currentUrl: 'https://docs.risk-agent.local',
      title: null,
      status: 'ready',
      contributedBySessionId: null,
    });
  });
});
