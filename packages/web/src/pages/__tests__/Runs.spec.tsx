/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { i18n } from '../../i18n';

const apiMocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    listRuns: apiMocks.listRuns,
  };
});

import { Runs } from '../Runs';

function renderRuns() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/runs']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/runs" element={<Runs />} />
          <Route path="/workbench" element={<div>Workbench route</div>} />
          <Route path="/runs/:id" element={<div>Run detail route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Runs', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('zh-CN');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders localized Chinese copy for the empty state', async () => {
    apiMocks.listRuns.mockResolvedValue([]);

    renderRuns();

    expect(await screen.findByRole('heading', { name: '运行记录' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /新建运行/ })).toBeTruthy();
    expect(await screen.findByText('暂无运行记录。请先从运行工作台创建一次运行。')).toBeTruthy();
    expect(screen.queryByText('Runs')).toBeNull();
    expect(screen.queryByText('New Run')).toBeNull();
    expect(screen.queryByText(/No runs yet/i)).toBeNull();
  });

  it('localizes run status, metrics, and task kind labels', async () => {
    apiMocks.listRuns.mockResolvedValue([
      {
        runId: 'run_zh_1',
        taskKind: 'general',
        status: 'waiting_user',
        input: { prompt: '检查支付异常' },
        routing: {
          acceptedTaskKind: 'general',
          confidence: 1,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        metrics: {
          turnCount: 2,
          toolCallCount: 1,
          inputTokens: 120,
          outputTokens: 240,
          cachedTokens: 0,
          estimatedUsd: 0.0123,
        },
        createdAt: '2026-05-09T10:00:00.000Z',
        updatedAt: '2026-05-09T10:01:00.000Z',
      },
    ]);

    renderRuns();

    expect(await screen.findByText('通用问答')).toBeTruthy();
    expect(screen.getByText('等待用户输入')).toBeTruthy();
    expect(screen.getByText('2 轮')).toBeTruthy();
    expect(screen.getByText('120 / 240 tokens')).toBeTruthy();
    expect(screen.queryByText('waiting_user')).toBeNull();
    expect(screen.queryByText('2 turns')).toBeNull();
  });
});
