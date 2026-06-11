import type { BrowserTabRecord } from '../api/client';

export type BrowserTabAction = 'close' | 'left' | 'right' | 'others';

function compareTabs(a: BrowserTabRecord, b: BrowserTabRecord): number {
  if (a.isPinned !== b.isPinned) {
    return a.isPinned ? -1 : 1;
  }
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

function normalizeSortOrder(tabs: BrowserTabRecord[]): BrowserTabRecord[] {
  return tabs.map((tab, index) => ({
    ...tab,
    sortOrder: index,
  }));
}

export function sortBrowserTabs(tabs: BrowserTabRecord[]): BrowserTabRecord[] {
  return [...tabs].sort(compareTabs);
}

export function toBrowserTabLayout(tabs: BrowserTabRecord[]): Array<{ tabId: string; isPinned: boolean }> {
  return sortBrowserTabs(tabs).map((tab) => ({
    tabId: tab.tabId,
    isPinned: tab.isPinned,
  }));
}

export function moveBrowserTab(
  tabs: BrowserTabRecord[],
  draggedTabId: string,
  targetTabId: string,
): BrowserTabRecord[] {
  const orderedTabs = sortBrowserTabs(tabs);
  const draggedIndex = orderedTabs.findIndex((tab) => tab.tabId === draggedTabId);
  const targetIndex = orderedTabs.findIndex((tab) => tab.tabId === targetTabId);

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return orderedTabs;
  }

  const draggedTab = orderedTabs[draggedIndex]!;
  const targetTab = orderedTabs[targetIndex]!;
  if (draggedTab.isPinned !== targetTab.isPinned) {
    return orderedTabs;
  }

  const nextTabs = [...orderedTabs];
  nextTabs.splice(draggedIndex, 1);
  const nextTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
  nextTabs.splice(nextTargetIndex, 0, draggedTab);
  return normalizeSortOrder(nextTabs);
}

export function setBrowserTabPinned(
  tabs: BrowserTabRecord[],
  tabId: string,
  nextPinned: boolean,
): BrowserTabRecord[] {
  const orderedTabs = sortBrowserTabs(tabs);
  const target = orderedTabs.find((tab) => tab.tabId === tabId);
  if (!target || target.isPinned === nextPinned) {
    return orderedTabs;
  }

  const remainingTabs = orderedTabs.filter((tab) => tab.tabId !== tabId);
  const updatedTab: BrowserTabRecord = {
    ...target,
    isPinned: nextPinned,
  };

  const pinnedTabs = remainingTabs.filter((tab) => tab.isPinned);
  const regularTabs = remainingTabs.filter((tab) => !tab.isPinned);

  if (nextPinned) {
    pinnedTabs.push(updatedTab);
  } else {
    regularTabs.unshift(updatedTab);
  }

  return normalizeSortOrder([...pinnedTabs, ...regularTabs]);
}

export function collectBrowserTabIdsForAction(
  tabs: BrowserTabRecord[],
  anchorTabId: string,
  action: BrowserTabAction,
): string[] {
  const orderedTabs = sortBrowserTabs(tabs);
  const anchorIndex = orderedTabs.findIndex((tab) => tab.tabId === anchorTabId);
  if (anchorIndex < 0) {
    return [];
  }

  switch (action) {
    case 'close':
      return [anchorTabId];
    case 'left':
      return orderedTabs.slice(0, anchorIndex).map((tab) => tab.tabId);
    case 'right':
      return orderedTabs.slice(anchorIndex + 1).map((tab) => tab.tabId);
    case 'others':
      return orderedTabs.filter((tab) => tab.tabId !== anchorTabId).map((tab) => tab.tabId);
    default:
      return [];
  }
}