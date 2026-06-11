/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  activateBrowserTab: vi.fn(),
  attachBrowserWorkspace: vi.fn(),
  createBrowserTab: vi.fn(),
  deleteBrowserWorkspace: vi.fn(),
  detachBrowserWorkspace: vi.fn(),
  ensureSessionBrowserWorkspace: vi.fn(),
  getActiveSessions: vi.fn(),
  getBrowserState: vi.fn(),
  listSessions: vi.fn(),
  shareBrowserWorkspace: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    activateBrowserTab: apiMocks.activateBrowserTab,
    attachBrowserWorkspace: apiMocks.attachBrowserWorkspace,
    createBrowserTab: apiMocks.createBrowserTab,
    deleteBrowserWorkspace: apiMocks.deleteBrowserWorkspace,
    detachBrowserWorkspace: apiMocks.detachBrowserWorkspace,
    ensureSessionBrowserWorkspace: apiMocks.ensureSessionBrowserWorkspace,
    getActiveSessions: apiMocks.getActiveSessions,
    getBrowserState: apiMocks.getBrowserState,
    listSessions: apiMocks.listSessions,
    shareBrowserWorkspace: apiMocks.shareBrowserWorkspace,
  };
});

vi.mock('../../lib/electron', async () => {
  const actual = await vi.importActual<typeof import('../../lib/electron')>('../../lib/electron');
  return {
    ...actual,
    getElectronAPI: () => null,
    isElectron: () => false,
  };
});

import { BrowserWorkspacePage } from '../BrowserWorkspace';

function renderBrowserWorkspacePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/browser']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/browser" element={<BrowserWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BrowserWorkspacePage', () => {
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
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(),
      },
    } as unknown as Navigator);

    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-owner',
        businessName: '主工作区会话',
        status: 'completed',
        phase: 'report',
        createdAt: '2026-05-19T10:00:00.000Z',
        completedAt: '2026-05-19T10:10:00.000Z',
      },
      {
        sessionId: 'session-active-1',
        businessName: '账户安全实时巡检',
        status: 'running',
        phase: 'analysis',
        createdAt: '2026-05-19T10:15:00.000Z',
      },
      {
        sessionId: 'session-active-2',
        businessName: '支付链路巡检',
        status: 'running',
        phase: 'analysis',
        createdAt: '2026-05-19T10:20:00.000Z',
      },
    ]);

    apiMocks.getActiveSessions.mockResolvedValue({
      count: 2,
      sessions: [
        {
          sessionId: 'session-active-1',
          businessName: '账户安全实时巡检',
          status: 'running',
          phase: 'analysis',
          createdAt: '2026-05-19T10:15:00.000Z',
        },
        {
          sessionId: 'session-active-2',
          businessName: '支付链路巡检',
          status: 'running',
          phase: 'analysis',
          createdAt: '2026-05-19T10:20:00.000Z',
        },
      ],
    });

    apiMocks.getBrowserState.mockResolvedValue({
      hostAvailable: true,
      workspaces: [
        {
          workspaceId: 'workspace-1',
          ownerSessionId: 'session-owner',
          ownerType: 'session',
          visibility: 'shared',
          providerKind: 'embedded',
          sharePolicy: 'manual',
          controllerSessionId: 'session-owner',
          lastActiveTabId: 'tab-1',
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:20:00.000Z',
        },
      ],
      tabs: [
        {
          tabId: 'tab-1',
          workspaceId: 'workspace-1',
          title: 'Risk Agent Docs',
          currentUrl: 'https://example.com/docs',
          status: 'ready',
          providerTabRef: 'browser-host:tab-1',
          contributedBySessionId: 'session-owner',
          isPinned: false,
          sortOrder: 0,
          createdAt: '2026-05-19T10:00:00.000Z',
          updatedAt: '2026-05-19T10:00:00.000Z',
        },
      ],
      bindings: [
        {
          bindingId: 'binding-owner',
          sessionId: 'session-owner',
          workspaceId: 'workspace-1',
          role: 'owner',
          source: 'default',
          canControl: true,
          attachedAt: '2026-05-19T10:00:00.000Z',
          detachedAt: null,
        },
        {
          bindingId: 'binding-observer',
          sessionId: 'session-active-1',
          workspaceId: 'workspace-1',
          role: 'observer',
          source: 'manual-attach',
          canControl: false,
          attachedAt: '2026-05-19T10:15:00.000Z',
          detachedAt: null,
        },
      ],
    });

    apiMocks.ensureSessionBrowserWorkspace.mockResolvedValue({ ok: true, workspace: { workspaceId: 'workspace-1' } });
    apiMocks.shareBrowserWorkspace.mockResolvedValue({ ok: true, workspace: { workspaceId: 'workspace-1' } });
    apiMocks.attachBrowserWorkspace.mockResolvedValue({ ok: true, binding: { bindingId: 'binding-new' } });
    apiMocks.detachBrowserWorkspace.mockResolvedValue({ ok: true, workspaceId: 'workspace-1', sessionId: 'session-active-1' });
    apiMocks.deleteBrowserWorkspace.mockResolvedValue({ ok: true, workspaceId: 'workspace-1' });
    apiMocks.createBrowserTab.mockResolvedValue({ ok: true, tab: { tabId: 'tab-2', workspaceId: 'workspace-1' } });
    apiMocks.activateBrowserTab.mockResolvedValue({ ok: true, workspace: { workspaceId: 'workspace-1' } });
  });

  afterEach(() => {
    cleanup();
  });

  it('filters active sessions and lets the user choose one into the session id input', async () => {
    const user = userEvent.setup();
    renderBrowserWorkspacePage();

    expect(await screen.findByText('Browser Workspace')).toBeTruthy();
    expect(screen.getByText('活跃会话')).toBeTruthy();

    const input = screen.getByLabelText('Session ID');
    await user.clear(input);
    await user.type(input, '实时');

    const activeSessionCard = screen.getByText('活跃会话').parentElement?.parentElement;

    expect(activeSessionCard).toBeTruthy();
    expect(await within(activeSessionCard as HTMLElement).findByRole('button', { name: '账户安全实时巡检' })).toBeTruthy();
    expect(within(activeSessionCard as HTMLElement).queryByRole('button', { name: '支付链路巡检' })).toBeNull();

    await user.click(screen.getAllByRole('button', { name: '账户安全实时巡检' })[0]!);

    expect((input as HTMLInputElement).value).toBe('session-active-1');
  });

  it('supports detaching the selected session and deleting the selected workspace', async () => {
    const user = userEvent.setup();
    renderBrowserWorkspacePage();

    expect(await screen.findByText('Risk Agent Docs')).toBeTruthy();

    const input = screen.getByLabelText('Session ID');
    await user.clear(input);
    await user.type(input, 'session-active-1');
    await user.click(screen.getByRole('button', { name: '解除当前 session' }));

    await waitFor(() => {
      expect(apiMocks.detachBrowserWorkspace).toHaveBeenCalledWith('workspace-1', 'session-active-1');
    });

    await user.click(screen.getByRole('button', { name: '删除当前工作区' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '确认删除工作区' }));

    expect(dialog).toBeTruthy();
    await waitFor(() => {
      expect(apiMocks.deleteBrowserWorkspace).toHaveBeenCalledWith('workspace-1', { sessionId: 'session-owner' });
    });
  });
});
