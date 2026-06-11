/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../Sidebar';
import { usePreferenceStore } from '../../stores/preferenceStore';
import { useUIStore } from '../../hooks/useUIStore';

const apiMocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listSessions: vi.fn(),
  renameSession: vi.fn(),
  terminateSession: vi.fn(),
  putPreferences: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  listRuns: apiMocks.listRuns,
  listSessions: apiMocks.listSessions,
  renameSession: apiMocks.renameSession,
  terminateSession: apiMocks.terminateSession,
  putPreferences: apiMocks.putPreferences,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

function renderSidebar(initialPath = '/analyze') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();

  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  useUIStore.setState({
    sidebarCollapsed: true,
    sidebarWidth: 240,
    activePage: 'dashboard',
    activeSessionId: null,
  });

  usePreferenceStore.setState({
    uiLocale: 'zh-CN',
    reportLocale: 'zh-CN',
    themeMode: 'system',
    supportedLocales: ['zh-CN', 'en-US'],
    translationReady: false,
    missingKeysCount: 0,
    dirty: false,
    saving: false,
    errorMessage: undefined,
  });

  apiMocks.renameSession.mockResolvedValue({ ok: true });
  apiMocks.terminateSession.mockResolvedValue({ ok: true });
  apiMocks.putPreferences.mockResolvedValue({ ok: true });
  apiMocks.listRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('Sidebar collapsed workspace affordances', () => {
  it('keeps collapsed navigation inside a scrollable middle rail for short viewports', async () => {
    apiMocks.listSessions.mockResolvedValue([]);

    renderSidebar('/chat');

    const scrollRegion = await screen.findByTestId('sidebar-collapsed-scroll-region');
    expect(scrollRegion.className).toContain('min-h-0');
    expect(scrollRegion.className).toContain('flex-1');
  });

  it('uses unified chat as the primary quick action', async () => {
    apiMocks.listSessions.mockResolvedValue([]);

    renderSidebar('/chat');

    expect(await screen.findByRole('button', { name: /智能聊天/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /定时运行/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /新建分析/i })).toBeNull();
  });

  it('shows running sessions in collapsed mode with detailed task labels and a quick theme switch button', async () => {
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-running-a',
        businessName: '电商支付风控',
        status: 'running',
        phase: 'analysis',
        createdAt: '2026-04-23T08:00:00.000Z',
      },
      {
        sessionId: 'session-running-b',
        businessName: '账户盗刷排查',
        status: 'running',
        phase: 'research',
        createdAt: '2026-04-23T08:01:00.000Z',
      },
      {
        sessionId: 'session-done',
        businessName: '贷款反欺诈复核',
        status: 'completed',
        phase: 'report',
        createdAt: '2026-04-23T07:40:00.000Z',
      },
    ]);

    renderSidebar();

    expect(await screen.findByRole('button', { name: /快速切换主题/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /电商支付风控.*running/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /账户盗刷排查.*running/i })).toBeTruthy();
  });

  it('cycles theme mode from the collapsed sidebar and persists the next value', async () => {
    const user = userEvent.setup();

    apiMocks.listSessions.mockResolvedValue([]);

    renderSidebar();

    const switcher = await screen.findByRole('button', { name: /快速切换主题/i });
    await user.click(switcher);

    await waitFor(() => {
      expect(apiMocks.putPreferences).toHaveBeenLastCalledWith({ themeMode: 'midnight' });
    });
    expect(usePreferenceStore.getState().themeMode).toBe('midnight');
  });

  it('shows recent chat and cli runs in expanded history so active conversations can be resumed', async () => {
    useUIStore.setState({
      sidebarCollapsed: false,
      sidebarWidth: 240,
      activePage: 'dashboard',
      activeSessionId: null,
    });

    apiMocks.listSessions.mockResolvedValue([]);
    apiMocks.listRuns.mockResolvedValue([
      {
        runId: 'run_chat_1',
        taskKind: 'general',
        status: 'running',
        input: {
          prompt: '后台聊天任务',
          surface: 'web',
        },
        routing: {
          acceptedTaskKind: 'general',
          confidence: 1,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        metrics: {
          turnCount: 1,
          toolCallCount: 0,
          inputTokens: 12,
          outputTokens: 18,
          cachedTokens: 0,
          estimatedUsd: 0.001,
        },
        createdAt: '2026-05-09T10:00:00.000Z',
        updatedAt: '2026-05-09T10:01:00.000Z',
      },
      {
        runId: 'run_cli_1',
        taskKind: 'general',
        status: 'waiting_user',
        input: {
          prompt: 'CLI background task',
          surface: 'background',
        },
        routing: {
          acceptedTaskKind: 'general',
          confidence: 1,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        metrics: {
          turnCount: 2,
          toolCallCount: 1,
          inputTokens: 24,
          outputTokens: 42,
          cachedTokens: 0,
          estimatedUsd: 0.002,
        },
        createdAt: '2026-05-09T10:02:00.000Z',
        updatedAt: '2026-05-09T10:03:00.000Z',
      },
    ]);

    renderSidebar('/chat?run=run_chat_1');

    expect(await screen.findByText('聊天 / CLI')).toBeTruthy();
    expect(screen.getByRole('button', { name: /后台聊天任务 聊天 运行中/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /CLI background task CLI 等待输入/i })).toBeTruthy();
  });
});
