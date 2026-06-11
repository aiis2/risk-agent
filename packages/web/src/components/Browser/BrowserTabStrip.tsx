import { useMemo, useState } from 'react';
import { IconPin, IconRefresh, IconX } from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { BrowserTabRecord } from '../../api/client';
import {
  collectBrowserTabIdsForAction,
  moveBrowserTab,
  setBrowserTabPinned,
  sortBrowserTabs,
  toBrowserTabLayout,
} from '../../lib/browserTabs';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui';

type BrowserTabStripVariant = 'host' | 'panel';

type BrowserTabStripProps = {
  tabs: BrowserTabRecord[];
  selectedTabId: string | null;
  variant: BrowserTabStripVariant;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseMany: (tabIds: string[], anchorTabId: string) => void;
  onRefresh: (tabId: string) => void;
  onReorder: (tabs: Array<{ tabId: string; isPinned: boolean }>) => void;
  children?: React.ReactNode;
};

function tabLabel(tab: BrowserTabRecord): string {
  if (tab.title?.trim()) {
    return tab.title.trim();
  }
  if (tab.currentUrl?.trim()) {
    return tab.currentUrl.trim();
  }
  return tab.tabId;
}

function layoutsEqual(
  left: Array<{ tabId: string; isPinned: boolean }>,
  right: Array<{ tabId: string; isPinned: boolean }>,
): boolean {
  return left.length === right.length
    && left.every((tab, index) => tab.tabId === right[index]?.tabId && tab.isPinned === right[index]?.isPinned);
}

export function BrowserTabStrip({
  tabs,
  selectedTabId,
  variant,
  onSelect,
  onClose,
  onCloseMany,
  onRefresh,
  onReorder,
  children,
}: BrowserTabStripProps) {
  const orderedTabs = useMemo(() => sortBrowserTabs(tabs), [tabs]);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);

  const containerClass = variant === 'host'
    ? 'group flex h-8 max-w-[240px] items-center gap-1 rounded-t-xl border border-b-0 px-1.5 transition-colors'
    : 'group flex max-w-[220px] items-center gap-1 rounded-2xl border px-1.5 py-1.5 transition-colors';
  const selectedClass = variant === 'host'
    ? 'border-accent/30 bg-surface text-text shadow-[0_-10px_18px_rgba(0,0,0,0.16)]'
    : 'border-accent/30 bg-accent/10 text-accent';
  const idleClass = variant === 'host'
    ? 'border-border-subtle bg-surface-card/70 text-text-muted hover:border-accent/20 hover:text-text'
    : 'border-border bg-surface text-text-muted hover:border-accent/20 hover:text-text';
  const buttonClass = variant === 'host'
    ? 'min-w-0 flex-1 px-1.5 text-left text-sm'
    : 'min-w-0 flex-1 px-1 text-left text-xs';
  const closeButtonClass = variant === 'host'
    ? 'inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted/70 transition-colors hover:bg-danger/10 hover:text-danger'
    : 'inline-flex h-6 w-6 items-center justify-center rounded-full text-text-muted/70 transition-colors hover:bg-danger/10 hover:text-danger';

  const currentLayout = toBrowserTabLayout(orderedTabs);

  function commitLayout(nextTabs: BrowserTabRecord[]) {
    const nextLayout = toBrowserTabLayout(nextTabs);
    if (!layoutsEqual(currentLayout, nextLayout)) {
      onReorder(nextLayout);
    }
  }

  return (
    <div className="flex min-w-max items-center gap-1 pr-2">
      {orderedTabs.map((tab) => {
        const label = tabLabel(tab);
        const active = tab.tabId === selectedTabId;
        const closeLeftIds = collectBrowserTabIdsForAction(orderedTabs, tab.tabId, 'left');
        const closeRightIds = collectBrowserTabIdsForAction(orderedTabs, tab.tabId, 'right');
        const closeOtherIds = collectBrowserTabIdsForAction(orderedTabs, tab.tabId, 'others');

        return (
          <ContextMenu key={tab.tabId}>
            <ContextMenuTrigger asChild>
              <div
                draggable
                onDragStart={() => setDraggedTabId(tab.tabId)}
                onDragEnd={() => setDraggedTabId(null)}
                onDragOver={(event) => {
                  const draggedTab = orderedTabs.find((item) => item.tabId === draggedTabId);
                  if (draggedTab && draggedTab.isPinned === tab.isPinned) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggedTabId) {
                    return;
                  }
                  commitLayout(moveBrowserTab(orderedTabs, draggedTabId, tab.tabId));
                  setDraggedTabId(null);
                }}
                className={clsx(
                  containerClass,
                  active ? selectedClass : idleClass,
                  draggedTabId === tab.tabId && 'opacity-70',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(tab.tabId)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(buttonClass, 'inline-flex min-w-0 items-center gap-1.5')}
                >
                  {tab.isPinned && <IconPin size={12} className="shrink-0 text-accent/80" />}
                  <span className="truncate">{label}</span>
                </button>
                <button
                  type="button"
                  aria-label={`快速关闭 ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.tabId);
                  }}
                  className={clsx(closeButtonClass, active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                >
                  <IconX size={14} />
                </button>
              </div>
            </ContextMenuTrigger>

            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onRefresh(tab.tabId)}>
                <IconRefresh size={14} className="text-text-subtle" />
                刷新
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => commitLayout(setBrowserTabPinned(orderedTabs, tab.tabId, !tab.isPinned))}>
                <IconPin size={14} className="text-text-subtle" />
                {tab.isPinned ? '取消固定标签页' : '固定标签页'}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onClose(tab.tabId)}>
                <IconX size={14} className="text-text-subtle" />
                关闭标签页
              </ContextMenuItem>
              <ContextMenuItem disabled={closeOtherIds.length === 0} onSelect={() => onCloseMany(closeOtherIds, tab.tabId)}>
                关闭其他标签页
              </ContextMenuItem>
              <ContextMenuItem disabled={closeRightIds.length === 0} onSelect={() => onCloseMany(closeRightIds, tab.tabId)}>
                关闭右侧标签页
              </ContextMenuItem>
              <ContextMenuItem disabled={closeLeftIds.length === 0} onSelect={() => onCloseMany(closeLeftIds, tab.tabId)}>
                关闭左侧标签页
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {children}
    </div>
  );
}