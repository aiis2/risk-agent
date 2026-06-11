/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentWorkspaceShell } from '../AgentWorkspaceShell';

describe('AgentWorkspaceShell', () => {
  it('allows the side panel to collapse into a slim rail and expand again', async () => {
    const user = userEvent.setup();

    render(
      <AgentWorkspaceShell
        eyebrow="智能聊天"
        title="聊天式 harness 控制台"
        main={<div>main area</div>}
        aside={<div>state panel content</div>}
        asideTitle="状态与产物"
      />,
    );

    expect(screen.getByText('state panel content')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '收起状态与产物' }));

    expect(screen.queryByText('state panel content')).toBeNull();
    expect(screen.getByRole('button', { name: '展开状态与产物' })).toBeTruthy();
    expect(screen.getByText('main area')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '展开状态与产物' }));

    expect(screen.getByText('state panel content')).toBeTruthy();
  });

  it('allows dragging the side panel to the full available width instead of clamping at 580px', async () => {
    const { container } = render(
      <AgentWorkspaceShell
        eyebrow="智能聊天"
        title="聊天式 harness 控制台"
        main={<div>main area</div>}
        aside={<div>state panel content</div>}
        asideTitle="状态与产物"
      />,
    );

    const renderScope = within(container);
    const mainSection = renderScope.getByText('main area').closest('section');
    const shellBody = mainSection?.parentElement;
    const aside = renderScope.getByText('state panel content').closest('aside');
    const splitter = aside?.previousElementSibling as HTMLDivElement | null;

    expect(shellBody).toBeTruthy();
    expect(aside).toBeTruthy();
    expect(splitter).toBeTruthy();

    Object.defineProperty(shellBody as HTMLDivElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 1200,
        height: 800,
        top: 0,
        right: 1200,
        bottom: 800,
        left: 0,
        toJSON: () => '',
      }),
    });

    fireEvent.mouseDown(splitter as HTMLDivElement, { clientX: 900 });
    fireEvent.mouseMove(window, { clientX: 0 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect((aside as HTMLElement).style.width).toBe('1188px');
    });
  });
});