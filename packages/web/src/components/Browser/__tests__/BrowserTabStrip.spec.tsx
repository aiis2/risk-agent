/** @vitest-environment jsdom */

import { fireEvent, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTabRecord } from '../../../api/client';
import { BrowserTabStrip } from '../BrowserTabStrip';

function createTab(tabId: string, title: string, isPinned: boolean, sortOrder: number): BrowserTabRecord {
  return {
    tabId,
    workspaceId: 'workspace-1',
    title,
    currentUrl: `https://example.com/${tabId}`,
    status: 'ready',
    providerTabRef: `browser-host:${tabId}`,
    contributedBySessionId: 'run-chat-1',
    isPinned,
    sortOrder,
    createdAt: '2026-05-21T08:00:00.000Z',
    updatedAt: '2026-05-21T08:00:00.000Z',
  };
}

function sampleTabs(): BrowserTabRecord[] {
  return [
    createTab('tab-a', 'Pinned A', true, 0),
    createTab('tab-b', 'Pinned B', true, 1),
    createTab('tab-c', 'Tab C', false, 2),
    createTab('tab-d', 'Tab D', false, 3),
  ];
}

afterEach(() => {
  cleanup();
});

describe('BrowserTabStrip', () => {
  it('renders quick-close buttons and forwards the close request for the target tab', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <BrowserTabStrip
        tabs={sampleTabs()}
        selectedTabId="tab-c"
        variant="host"
        onSelect={vi.fn()}
        onClose={onClose}
        onCloseMany={vi.fn()}
        onRefresh={vi.fn()}
        onReorder={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '快速关闭 Tab C' }));

    expect(onClose).toHaveBeenCalledWith('tab-c');
  });

  it('opens the right-click menu and forwards pin and close-range actions through callbacks', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    const onCloseMany = vi.fn();

    render(
      <BrowserTabStrip
        tabs={sampleTabs()}
        selectedTabId="tab-c"
        variant="panel"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCloseMany={onCloseMany}
        onRefresh={vi.fn()}
        onReorder={onReorder}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Tab C' }));
    await user.click(await screen.findByRole('menuitem', { name: '固定标签页' }));

    expect(onReorder).toHaveBeenCalledWith([
      { tabId: 'tab-a', isPinned: true },
      { tabId: 'tab-b', isPinned: true },
      { tabId: 'tab-c', isPinned: true },
      { tabId: 'tab-d', isPinned: false },
    ]);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Tab C' }));
    await user.click(await screen.findByRole('menuitem', { name: '关闭右侧标签页' }));

    expect(onCloseMany).toHaveBeenCalledWith(['tab-d'], 'tab-c');
  });
});