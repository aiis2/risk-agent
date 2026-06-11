/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  listScheduledRuns: vi.fn(),
  createScheduledRun: vi.fn(),
  updateScheduledRun: vi.fn(),
  triggerScheduledRun: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    listScheduledRuns: apiMocks.listScheduledRuns,
    createScheduledRun: apiMocks.createScheduledRun,
    updateScheduledRun: apiMocks.updateScheduledRun,
    triggerScheduledRun: apiMocks.triggerScheduledRun,
  };
});

import { ScheduledRuns } from '../ScheduledRuns';

function renderScheduledRuns() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/scheduled-runs']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/scheduled-runs" element={<ScheduledRuns />} />
          <Route path="/runs/:id" element={<div>Run detail route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ScheduledRuns', () => {
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
    apiMocks.listScheduledRuns.mockResolvedValue([
      {
        scheduleId: 'sched_1',
        name: 'Hourly payment risk digest',
        cron: '0 * * * *',
        taskKind: 'general',
        input: { prompt: '整理最近一小时的支付风险摘要' },
        enabled: true,
        nextRunAt: '2026-04-27T16:00:00.000Z',
        lastRunId: 'run_scheduled_1',
        lastStatus: 'completed',
        createdAt: '2026-04-27T15:00:00.000Z',
        updatedAt: '2026-04-27T15:10:00.000Z',
      },
    ]);
    apiMocks.createScheduledRun.mockResolvedValue({ scheduleId: 'sched_new' });
    apiMocks.updateScheduledRun.mockResolvedValue({ ok: true });
    apiMocks.triggerScheduledRun.mockResolvedValue({ scheduleId: 'sched_1' });
  });

  afterEach(() => {
    cleanup();
  });

  it('creates a new scheduled run from the management page', async () => {
    const user = userEvent.setup();
    renderScheduledRuns();

    await screen.findByText('Hourly payment risk digest');
    expect(screen.getByText('定时运行')).toBeTruthy();
    expect(screen.getByText('任务类型')).toBeTruthy();
    expect(screen.getByText('1 个调度')).toBeTruthy();
    expect(screen.queryByText('Scheduled runs')).toBeNull();
    expect(screen.queryByText('Next run')).toBeNull();
    expect(screen.queryByText('Last trigger')).toBeNull();
    await user.type(screen.getByLabelText('调度名称'), 'Minute login review');
    await user.type(screen.getByLabelText('Cron 表达式'), '*/5 * * * *');
    await user.click(screen.getByRole('button', { name: '风控分析 任务类型' }));
    await user.type(screen.getByLabelText('运行提示词'), '分析最近五分钟的异常登录风险');
    await user.click(screen.getByRole('button', { name: '创建定时运行' }));

    await waitFor(() => {
      expect(apiMocks.createScheduledRun).toHaveBeenCalledWith({
        name: 'Minute login review',
        cron: '*/5 * * * *',
        taskKind: 'analysis',
        input: {
          prompt: '分析最近五分钟的异常登录风险',
        },
        preferredModel: undefined,
      });
    });
  });

  it('toggles enabled state and manually triggers a schedule', async () => {
    const user = userEvent.setup();
    renderScheduledRuns();

    await screen.findByText('Hourly payment risk digest');
    await user.click(screen.getByRole('button', { name: '停用 Hourly payment risk digest' }));
    await user.click(screen.getByRole('button', { name: '立即触发 Hourly payment risk digest' }));

    await waitFor(() => {
      expect(apiMocks.updateScheduledRun).toHaveBeenCalledWith('sched_1', { enabled: false });
      expect(apiMocks.triggerScheduledRun).toHaveBeenCalledWith('sched_1');
    });
  });

  it('renders empty state copy without leftover english prompt wording', async () => {
    apiMocks.listScheduledRuns.mockResolvedValue([]);
    renderScheduledRuns();

    expect(await screen.findByText('还没有定时运行。先创建一个固定巡检，验证 Cron 表达式与提示词是否稳定。')).toBeTruthy();
    expect(screen.queryByText(/Prompt/)).toBeNull();
  });
});
