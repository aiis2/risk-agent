/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  listReports: vi.fn(),
  deleteReport: vi.fn(),
  exportReportMd: vi.fn(),
  exportReportHtml: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    listReports: apiMocks.listReports,
    deleteReport: apiMocks.deleteReport,
    exportReportMd: apiMocks.exportReportMd,
    exportReportHtml: apiMocks.exportReportHtml,
  };
});

import { Reports } from '../Reports';

function renderReports() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/reports']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:id" element={<div>Report detail route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Reports', () => {
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

    apiMocks.listReports.mockResolvedValue([
      {
        reportId: 'report_1',
        businessName: '支付风险巡检总览',
        overallScore: 91,
        locale: 'zh-CN',
        createdAt: '2026-05-07 11:00:00',
      },
    ]);
    apiMocks.deleteReport.mockResolvedValue({ ok: true });
    apiMocks.exportReportMd.mockResolvedValue('# 支付风险巡检总览');
    apiMocks.exportReportHtml.mockResolvedValue('<h1>支付风险巡检总览</h1>');
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders localized report list actions in Chinese', async () => {
    const user = userEvent.setup();

    renderReports();

    await screen.findByText('支付风险巡检总览');
    await user.click(screen.getByRole('button', { name: '更多操作' }));

    expect(screen.getByRole('menuitem', { name: '导出 Markdown' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '导出 HTML' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '删除报告' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Export Markdown' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Export HTML' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('exports markdown through a connected anchor and defers url cleanup', async () => {
    const user = userEvent.setup();

    renderReports();

    await screen.findByText('支付风险巡检总览');
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    vi.useFakeTimers();

    const createObjectUrlSpy = vi.fn(() => 'blob:report-md');
    const revokeObjectUrlSpy = vi.fn();
    const originalGlobalUrl = globalThis.URL;
    const originalWindowUrl = window.URL;
    const patchedUrl = {
      ...window.URL,
      createObjectURL: createObjectUrlSpy,
      revokeObjectURL: revokeObjectUrlSpy,
    } as unknown as typeof URL;
    Object.defineProperty(globalThis, 'URL', { configurable: true, writable: true, value: patchedUrl });
    Object.defineProperty(window, 'URL', { configurable: true, writable: true, value: patchedUrl });
    const clickConnectionStates: boolean[] = [];
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
      clickConnectionStates.push(this.isConnected);
    });

    await act(async () => {
      screen.getByRole('menuitem', { name: /Markdown/ }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMocks.exportReportMd).toHaveBeenCalledWith('report_1');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickConnectionStates).toEqual([true]);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:report-md');
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(globalThis, 'URL', { configurable: true, writable: true, value: originalGlobalUrl });
    Object.defineProperty(window, 'URL', { configurable: true, writable: true, value: originalWindowUrl });
  });
});
