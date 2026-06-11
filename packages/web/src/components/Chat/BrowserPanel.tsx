import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconDeviceDesktop,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  activateBrowserTab,
  closeBrowserTab,
  createBrowserTab,
  ensureSessionBrowserWorkspace,
  getBrowserState,
  reloadBrowserTab,
  saveBrowserTabLayout,
} from '../../api/client';
import { BrowserTabStrip } from '../Browser/BrowserTabStrip';
import { getElectronAPI, isElectron } from '../../lib/electron';

const shellCardCls = 'rounded-[18px] border border-border bg-surface-card/60';
const inputCls = 'h-10 w-full rounded-2xl border border-border bg-surface px-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent/40';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function tailLabel(title: string | null, currentUrl: string | null): string {
  if (title?.trim()) {
    return title;
  }
  return currentUrl?.trim() || 'Untitled Tab';
}

export function BrowserPanel({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const activatedTabKeyRef = useRef<string>('');
  const [newTabUrl, setNewTabUrl] = useState('');
  const [selectedTabId, setSelectedTabId] = useState<string>('');

  const browserStateQuery = useQuery({
    queryKey: ['browser', 'state'],
    queryFn: getBrowserState,
    refetchInterval: 4_000,
  });

  useEffect(() => {
    if (!runId) {
      return;
    }

    let cancelled = false;
    void ensureSessionBrowserWorkspace(runId).then(async () => {
      if (!cancelled) {
        await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient, runId]);

  const boundWorkspaceId = useMemo(() => {
    const binding = browserStateQuery.data?.bindings.find((item) => item.sessionId === runId && item.detachedAt === null);
    return binding?.workspaceId ?? null;
  }, [browserStateQuery.data?.bindings, runId]);

  const workspace = useMemo(() => {
    const state = browserStateQuery.data;
    if (!state) {
      return null;
    }
    return state.workspaces.find((item) => item.workspaceId === boundWorkspaceId)
      ?? state.workspaces.find((item) => item.ownerSessionId === runId)
      ?? null;
  }, [boundWorkspaceId, browserStateQuery.data, runId]);

  const tabs = useMemo(() => {
    if (!workspace || !browserStateQuery.data) {
      return [];
    }
    return browserStateQuery.data.tabs.filter((item) => item.workspaceId === workspace.workspaceId);
  }, [browserStateQuery.data, workspace]);

  useEffect(() => {
    if (!workspace) {
      setSelectedTabId('');
      return;
    }
    const nextTabId = workspace.lastActiveTabId ?? tabs[0]?.tabId ?? '';
    setSelectedTabId((current) => (current && tabs.some((item) => item.tabId === current) ? current : nextTabId));
  }, [tabs, workspace]);

  const selectedTab = tabs.find((item) => item.tabId === selectedTabId) ?? tabs[0] ?? null;

  const activateMutation = useMutation({
    mutationFn: (tabId: string) => activateBrowserTab(tabId, workspace!.workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => reloadBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => closeBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (currentUrl: string) => createBrowserTab({
      workspaceId: workspace!.workspaceId,
      currentUrl,
      title: null,
      status: 'ready',
      contributedBySessionId: runId,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const saveLayoutMutation = useMutation({
    mutationFn: (tabs: Array<{ tabId: string; isPinned: boolean }>) => saveBrowserTabLayout(workspace!.workspaceId, tabs),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  useEffect(() => {
    if (!workspace || !selectedTab) {
      activatedTabKeyRef.current = '';
      return;
    }

    const activationKey = `${workspace.workspaceId}:${selectedTab.tabId}`;
    if (activatedTabKeyRef.current === activationKey) {
      return;
    }

    activatedTabKeyRef.current = activationKey;
    activateMutation.mutate(selectedTab.tabId);
  }, [activateMutation, selectedTab, workspace]);

  useEffect(() => {
    const electron = getElectronAPI();
    const viewport = viewportRef.current;
    if (!electron || !viewport || !isElectron()) {
      return;
    }

    const syncBounds = () => {
      const rect = viewport.getBoundingClientRect();
      void electron.setBrowserPanelBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };

    syncBounds();
    const resizeObserver = new ResizeObserver(syncBounds);
    resizeObserver.observe(viewport);
    window.addEventListener('resize', syncBounds);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncBounds);
      void electron.setBrowserPanelBounds(null);
    };
  }, [workspace?.workspaceId]);

  async function handleOpenHost() {
    const electron = getElectronAPI();
    if (!electron) {
      return;
    }
    await electron.openBrowserHost();
  }

  function handleCreateTab() {
    const currentUrl = normalizeUrl(newTabUrl);
    if (!workspace || !currentUrl) {
      return;
    }
    createMutation.mutate(currentUrl);
  }

  async function handleCloseTabGroup(tabIds: string[], anchorTabId: string) {
    if (!workspace || tabIds.length === 0) {
      return;
    }

    if (selectedTabId !== anchorTabId) {
      setSelectedTabId(anchorTabId);
      await activateBrowserTab(anchorTabId, workspace.workspaceId);
    }

    for (const tabId of tabIds) {
      await closeBrowserTab(tabId, workspace.workspaceId);
    }

    setSelectedTabId(anchorTabId);
    await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
  }

  if (!runId) {
    return (
      <div className={clsx(shellCardCls, 'px-4 py-4')}>
        <p className="text-sm text-text">先启动一个对话 run，再在这里使用内置浏览器。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className={clsx(shellCardCls, 'px-4 py-3')}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-text-subtle">Built-in Browser</p>
            <p className="mt-1 text-sm font-semibold text-text">当前会话浏览器</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => selectedTab && workspace && reloadMutation.mutate({ tabId: selectedTab.tabId, workspaceId: workspace.workspaceId })}
              disabled={!selectedTab || reloadMutation.isPending}
              aria-label="刷新当前标签页"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-subtle transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-50"
            >
              {reloadMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}
            </button>
            <button
              type="button"
              onClick={() => void handleOpenHost()}
              aria-label="在独立 Browser Host 中打开"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-subtle transition-colors hover:border-accent/30 hover:text-accent"
            >
              <IconDeviceDesktop size={16} />
            </button>
            <button
              type="button"
              onClick={() => selectedTab && workspace && closeMutation.mutate({ tabId: selectedTab.tabId, workspaceId: workspace.workspaceId })}
              disabled={!selectedTab || closeMutation.isPending}
              aria-label="关闭当前标签页"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-subtle transition-colors hover:border-danger/30 hover:text-danger disabled:opacity-50"
            >
              {closeMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconX size={16} />}
            </button>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">新标签页地址</span>
            <input
              aria-label="新标签页地址"
              value={newTabUrl}
              onChange={(event) => setNewTabUrl(event.target.value)}
              placeholder="输入 URL 后创建新标签页"
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={handleCreateTab}
            disabled={!workspace || createMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {createMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconPlus size={16} />}
            新建标签页
          </button>
        </div>
      </div>

      <div className={clsx(shellCardCls, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border/60 px-3 py-3">
          {tabs.length === 0 && (
            <span className="text-xs text-text-muted">当前没有标签页，先新建一个页面。</span>
          )}
          {tabs.length > 0 && (
            <BrowserTabStrip
              tabs={tabs.map((tab) => ({
                ...tab,
                title: tab.title ?? tailLabel(tab.title, tab.currentUrl),
              }))}
              selectedTabId={selectedTab?.tabId ?? null}
              variant="panel"
              onSelect={(tabId) => {
                setSelectedTabId(tabId);
                activateMutation.mutate(tabId);
              }}
              onClose={(tabId) => {
                if (!workspace) {
                  return;
                }
                closeMutation.mutate({ tabId, workspaceId: workspace.workspaceId });
              }}
              onCloseMany={(tabIds, anchorTabId) => {
                void handleCloseTabGroup(tabIds, anchorTabId);
              }}
              onRefresh={(tabId) => {
                if (!workspace) {
                  return;
                }
                reloadMutation.mutate({ tabId, workspaceId: workspace.workspaceId });
              }}
              onReorder={(layout) => {
                if (!workspace) {
                  return;
                }
                saveLayoutMutation.mutate(layout);
              }}
            />
          )}
        </div>

        <div className="border-b border-border/60 px-4 py-3">
          <input
            aria-label="当前标签页地址"
            value={selectedTab?.currentUrl ?? ''}
            readOnly
            className={clsx(inputCls, 'cursor-default bg-surface-card/80')}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div
            ref={viewportRef}
            className="relative min-h-[320px] flex-1 overflow-hidden rounded-[24px] border border-border bg-[#0b0d16]"
          >
            {!isElectron() && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm leading-7 text-text-muted">
                内置浏览器内容仅在 Electron 桌面应用中显示。
              </div>
            )}
            {isElectron() && !selectedTab && (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm leading-7 text-text-muted">
                选择一个标签页，或新建一个页面。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}