/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionRail } from '../SessionRail';

describe('SessionRail', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('PointerEvent', MouseEvent);
  });

  afterEach(() => {
    cleanup();
  });

  it('separates the current session from waiting and recent run groups', () => {
    render(
      <SessionRail
        isOpen
        onToggle={() => {}}
        onResume={() => {}}
        currentRunId="run_live"
        runs={[
          { runId: 'run_live', title: '当前会话', status: 'running', updatedAt: new Date().toISOString() },
          { runId: 'run_wait', title: '等待输入会话', status: 'waiting_user', updatedAt: new Date().toISOString() },
          { runId: 'run_done', title: '已完成会话', status: 'completed', updatedAt: new Date().toISOString() },
        ]}
      />,
    );

    expect(screen.getByText('Current Session')).toBeTruthy();
    expect(screen.getByText('Needs Input')).toBeTruthy();
    expect(screen.getByText('Recent Runs')).toBeTruthy();
    expect(screen.getByText('waiting 1')).toBeTruthy();
    expect(screen.getByText('等待输入会话')).toBeTruthy();
    expect(screen.getByText('已完成会话')).toBeTruthy();
  });

  it('supports filtering and collapsing session groups', async () => {
    const user = userEvent.setup();
    render(
      <SessionRail
        isOpen
        onToggle={() => {}}
        onResume={() => {}}
        currentRunId="run_live"
        runs={[
          { runId: 'run_live', title: '当前会话', status: 'running', updatedAt: new Date().toISOString() },
          { runId: 'run_wait', title: '等待输入会话', status: 'waiting_user', updatedAt: new Date().toISOString() },
          { runId: 'run_fail', title: '失败会话', status: 'failed', updatedAt: new Date().toISOString() },
        ]}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Filter sessions' }), '等待');
    expect(screen.getByText('等待输入会话')).toBeTruthy();
    expect(screen.queryByText('失败会话')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Toggle Needs Input section' }));
    expect(screen.queryByText('等待输入会话')).toBeNull();
  });

  it('persists collapsed groups across remounts', async () => {
    const user = userEvent.setup();
    const props = {
      isOpen: true,
      onToggle: () => {},
      onResume: () => {},
      currentRunId: 'run_live',
      runs: [
        { runId: 'run_live', title: '当前会话', status: 'running', updatedAt: new Date().toISOString() },
        { runId: 'run_wait', title: '等待输入会话', status: 'waiting_user', updatedAt: new Date().toISOString() },
      ],
    };

    const { unmount } = render(<SessionRail {...props} />);

    await user.click(screen.getByRole('button', { name: 'Toggle Needs Input section' }));
    expect(screen.queryByText('等待输入会话')).toBeNull();

    unmount();

    render(<SessionRail {...props} />);

    expect(screen.queryByText('等待输入会话')).toBeNull();
  });

  it('hides the closed rail without translating it outside the page bounds', () => {
    render(
      <SessionRail
        isOpen={false}
        onToggle={() => {}}
        onResume={() => {}}
        currentRunId="run_live"
        runs={[
          { runId: 'run_live', title: 'Current session', status: 'running', updatedAt: new Date().toISOString() },
        ]}
      />,
    );

    const rail = screen.getByLabelText('Session history rail');
    expect(rail.className).toContain('invisible');
    expect(rail.className).not.toContain('translate-x-full');
    expect(rail.getAttribute('aria-hidden')).toBe('true');
  });
});
