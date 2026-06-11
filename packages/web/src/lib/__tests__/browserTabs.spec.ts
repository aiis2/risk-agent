import { describe, expect, it } from 'vitest';
import type { BrowserTabRecord } from '../../api/client';
import {
  collectBrowserTabIdsForAction,
  moveBrowserTab,
  setBrowserTabPinned,
} from '../browserTabs';

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

describe('browser tab layout helpers', () => {
  it('reorders tabs only within the same pin section', () => {
    const tabs = sampleTabs();

    expect(moveBrowserTab(tabs, 'tab-d', 'tab-c').map((tab) => ({ tabId: tab.tabId, isPinned: tab.isPinned, sortOrder: tab.sortOrder }))).toEqual([
      { tabId: 'tab-a', isPinned: true, sortOrder: 0 },
      { tabId: 'tab-b', isPinned: true, sortOrder: 1 },
      { tabId: 'tab-d', isPinned: false, sortOrder: 2 },
      { tabId: 'tab-c', isPinned: false, sortOrder: 3 },
    ]);

    expect(moveBrowserTab(tabs, 'tab-c', 'tab-a').map((tab) => tab.tabId)).toEqual([
      'tab-a',
      'tab-b',
      'tab-c',
      'tab-d',
    ]);
  });

  it('moves tabs across the pin boundary when pinning or unpinning', () => {
    const tabs = sampleTabs();

    expect(setBrowserTabPinned(tabs, 'tab-d', true).map((tab) => ({ tabId: tab.tabId, isPinned: tab.isPinned, sortOrder: tab.sortOrder }))).toEqual([
      { tabId: 'tab-a', isPinned: true, sortOrder: 0 },
      { tabId: 'tab-b', isPinned: true, sortOrder: 1 },
      { tabId: 'tab-d', isPinned: true, sortOrder: 2 },
      { tabId: 'tab-c', isPinned: false, sortOrder: 3 },
    ]);

    expect(setBrowserTabPinned(tabs, 'tab-b', false).map((tab) => ({ tabId: tab.tabId, isPinned: tab.isPinned, sortOrder: tab.sortOrder }))).toEqual([
      { tabId: 'tab-a', isPinned: true, sortOrder: 0 },
      { tabId: 'tab-b', isPinned: false, sortOrder: 1 },
      { tabId: 'tab-c', isPinned: false, sortOrder: 2 },
      { tabId: 'tab-d', isPinned: false, sortOrder: 3 },
    ]);
  });

  it('collects the correct tab ids for close-left, close-right, and close-others actions', () => {
    const tabs = sampleTabs();

    expect(collectBrowserTabIdsForAction(tabs, 'tab-c', 'left')).toEqual(['tab-a', 'tab-b']);
    expect(collectBrowserTabIdsForAction(tabs, 'tab-c', 'right')).toEqual(['tab-d']);
    expect(collectBrowserTabIdsForAction(tabs, 'tab-c', 'others')).toEqual(['tab-a', 'tab-b', 'tab-d']);
    expect(collectBrowserTabIdsForAction(tabs, 'tab-c', 'close')).toEqual(['tab-c']);
  });
});