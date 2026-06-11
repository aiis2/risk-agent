import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconArrowLeft,
  IconArrowRight,
  IconLayoutGridAdd,
  IconRefresh,
  IconShare2,
  IconWorld,
  IconX,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  activateBrowserTab,
  attachBrowserWorkspace,
  closeBrowserTab,
  createBrowserTab,
  ensureStandaloneBrowserWorkspace,
  getBrowserState,
  goBackBrowserTab,
  goForwardBrowserTab,
  navigateBrowserTab,
  reloadBrowserTab,
  saveBrowserTabLayout,
  shareBrowserWorkspace,
  type BrowserSharePolicy,
  type BrowserStateResponse,
} from '../api/client';
import { BrowserTabStrip } from '../components/Browser/BrowserTabStrip';
import { Dialog, DialogContent, ScrollArea, Select, SelectItem } from '../components/ui';

const inputCls = 'h-9 w-full rounded-xl border border-border bg-surface-input px-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent/40';

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

function tailId(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return value.length > 12 ? value.slice(-12) : value;
}

export function BrowserHostPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedTabId, setSelectedTabId] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [addressDirty, setAddressDirty] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTargetSessionId, setShareTargetSessionId] = useState('');
  const [sharePolicy, setSharePolicy] = useState<BrowserSharePolicy>('manual');

  const browserStateQuery = useQuery<BrowserStateResponse>({
    queryKey: ['browser', 'state'],
    queryFn: getBrowserState,
    refetchInterval: 3_000,
  });

  const state = browserStateQuery.data;
  const selectedWorkspace = state?.workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? state?.workspaces[0] ?? null;
  const tabs = useMemo(
    () => state?.tabs.filter((tab) => tab.workspaceId === selectedWorkspace?.workspaceId) ?? [],
    [selectedWorkspace?.workspaceId, state?.tabs],
  );
  const selectedTab = tabs.find((tab) => tab.tabId === selectedTabId) ?? tabs[0] ?? null;

  useEffect(() => {
    if (!selectedWorkspaceId && state?.workspaces[0]?.workspaceId) {
      setSelectedWorkspaceId(state.workspaces[0].workspaceId);
      return;
    }

    if (selectedWorkspaceId && state && !state.workspaces.some((workspace) => workspace.workspaceId === selectedWorkspaceId)) {
      setSelectedWorkspaceId(state.workspaces[0]?.workspaceId ?? '');
    }
  }, [selectedWorkspaceId, state]);

  useEffect(() => {
    if (!tabs.length) {
      setSelectedTabId('');
      return;
    }

    const nextTabId = selectedWorkspace?.lastActiveTabId ?? tabs[0]?.tabId ?? '';
    setSelectedTabId((current) => (current && tabs.some((tab) => tab.tabId === current) ? current : nextTabId));
  }, [selectedWorkspace?.lastActiveTabId, tabs]);

  useEffect(() => {
    setAddressInput(selectedTab?.currentUrl ?? '');
    setAddressDirty(false);
  }, [selectedTab?.tabId]);

  useEffect(() => {
    if (!addressDirty) {
      setAddressInput(selectedTab?.currentUrl ?? '');
    }
  }, [addressDirty, selectedTab?.currentUrl]);

  async function invalidateBrowserState() {
    await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
  }

  const activateMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => activateBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: invalidateBrowserState,
  });

  const navigateMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string; url: string }) => navigateBrowserTab(payload.tabId, payload.workspaceId, payload.url),
    onSuccess: async () => {
      setAddressDirty(false);
      await invalidateBrowserState();
    },
  });

  const goBackMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => goBackBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: invalidateBrowserState,
  });

  const goForwardMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => goForwardBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: invalidateBrowserState,
  });

  const reloadMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => reloadBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: invalidateBrowserState,
  });

  const createMutation = useMutation({
    mutationFn: (payload: { workspaceId: string; currentUrl: string; contributedBySessionId?: string | null }) => createBrowserTab({
      workspaceId: payload.workspaceId,
      currentUrl: payload.currentUrl,
      title: null,
      status: 'ready',
      contributedBySessionId: payload.contributedBySessionId ?? null,
    }),
    onSuccess: async (result) => {
      setSelectedTabId(result.tab.tabId);
      setAddressDirty(false);
      await invalidateBrowserState();
    },
  });

  const ensureStandaloneWorkspaceMutation = useMutation({
    mutationFn: () => ensureStandaloneBrowserWorkspace(),
    onSuccess: async (result) => {
      setSelectedWorkspaceId(result.workspace.workspaceId);
      await invalidateBrowserState();
    },
  });

  const saveLayoutMutation = useMutation({
    mutationFn: (tabs: Array<{ tabId: string; isPinned: boolean }>) => saveBrowserTabLayout(selectedWorkspace!.workspaceId, tabs),
    onSuccess: invalidateBrowserState,
  });

  const closeMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => closeBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: async (result) => {
      setSelectedTabId(result.nextActiveTabId ?? '');
      await invalidateBrowserState();
    },
  });

  const shareMutation = useMutation({
    mutationFn: async (payload: {
      workspaceId: string;
      ownerSessionId: string;
      targetSessionId: string;
      sharePolicy: BrowserSharePolicy;
    }) => {
      const workspaceResult = await shareBrowserWorkspace(payload.workspaceId, {
        sessionId: payload.ownerSessionId,
        sharePolicy: payload.sharePolicy,
      });

      if (payload.targetSessionId && payload.targetSessionId !== payload.ownerSessionId) {
        await attachBrowserWorkspace(payload.workspaceId, payload.targetSessionId);
      }

      return workspaceResult;
    },
    onSuccess: async () => {
      setShareDialogOpen(false);
      setShareTargetSessionId('');
      await invalidateBrowserState();
    },
  });

  function handleSelectTab(tabId: string) {
    if (!selectedWorkspace) {
      return;
    }

    setSelectedTabId(tabId);
    activateMutation.mutate({ tabId, workspaceId: selectedWorkspace.workspaceId });
  }

  async function ensureWorkspaceForActions() {
    if (selectedWorkspace) {
      return selectedWorkspace;
    }

    const result = await ensureStandaloneWorkspaceMutation.mutateAsync();
    setSelectedWorkspaceId(result.workspace.workspaceId);
    return result.workspace;
  }

  async function handleOpenAddress() {
    const normalizedUrl = normalizeUrl(addressInput);
    if (!normalizedUrl) {
      return;
    }

    const workspace = await ensureWorkspaceForActions();

    if (!selectedTab) {
      createMutation.mutate({
        workspaceId: workspace.workspaceId,
        currentUrl: normalizedUrl,
        contributedBySessionId: workspace.controllerSessionId,
      });
      return;
    }

    navigateMutation.mutate({
      tabId: selectedTab.tabId,
      workspaceId: workspace.workspaceId,
      url: normalizedUrl,
    });
  }

  async function handleCreateTab() {
    const candidateUrl = normalizeUrl(addressInput) || selectedTab?.currentUrl || 'https://example.com';
    const workspace = await ensureWorkspaceForActions();
    createMutation.mutate({
      workspaceId: workspace.workspaceId,
      currentUrl: candidateUrl,
      contributedBySessionId: workspace.controllerSessionId,
    });
  }

  function handleShareWorkspace() {
    if (!selectedWorkspace?.ownerSessionId) {
      return;
    }

    shareMutation.mutate({
      workspaceId: selectedWorkspace.workspaceId,
      ownerSessionId: selectedWorkspace.ownerSessionId,
      targetSessionId: shareTargetSessionId.trim(),
      sharePolicy,
    });
  }

  async function handleCloseTabGroup(tabIds: string[], anchorTabId: string) {
    if (!selectedWorkspace || tabIds.length === 0) {
      return;
    }

    if (selectedTabId !== anchorTabId) {
      setSelectedTabId(anchorTabId);
      await activateBrowserTab(anchorTabId, selectedWorkspace.workspaceId);
    }

    for (const tabId of tabIds) {
      await closeBrowserTab(tabId, selectedWorkspace.workspaceId);
    }

    setSelectedTabId(anchorTabId);
    await invalidateBrowserState();
  }

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[#0d1019] text-text">
      <header className="h-[104px] border-b border-border-subtle bg-[#0d1019] shadow-[0_20px_60px_rgba(0,0,0,0.32)]">
        <div className="flex h-11 items-end gap-2 border-b border-border-subtle px-3">
          <div className="min-w-0 flex-1">
            <ScrollArea className="h-10" viewportClassName="h-10 w-full">
              <div className="flex h-10 min-w-max items-end gap-1 pr-2">
                <BrowserTabStrip
                  tabs={tabs}
                  selectedTabId={selectedTab?.tabId ?? null}
                  variant="host"
                  onSelect={handleSelectTab}
                  onClose={(tabId) => {
                    if (!selectedWorkspace) {
                      return;
                    }
                    closeMutation.mutate({ tabId, workspaceId: selectedWorkspace.workspaceId });
                  }}
                  onCloseMany={(tabIds, anchorTabId) => {
                    void handleCloseTabGroup(tabIds, anchorTabId);
                  }}
                  onRefresh={(tabId) => {
                    if (!selectedWorkspace) {
                      return;
                    }
                    reloadMutation.mutate({ tabId, workspaceId: selectedWorkspace.workspaceId });
                  }}
                  onReorder={(layout) => {
                    if (!selectedWorkspace) {
                      return;
                    }
                    saveLayoutMutation.mutate(layout);
                  }}
                >
                <button
                  type="button"
                  onClick={() => void handleCreateTab()}
                  aria-label={t('browserHost.newTab', '新建标签页')}
                  className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface-card/70 text-text-muted transition-colors hover:border-accent/25 hover:text-text"
                >
                  <IconLayoutGridAdd size={16} />
                </button>
                </BrowserTabStrip>
              </div>
            </ScrollArea>
          </div>

          <div className="mb-1 flex items-center gap-2">
            <span className={clsx(
              'inline-flex h-8 items-center rounded-lg border px-2.5 text-xs uppercase tracking-[0.14em]',
              state?.hostAvailable ? 'border-success/25 bg-success/10 text-success' : 'border-border-subtle bg-surface-card/70 text-text-muted',
            )}>
              {state?.hostAvailable ? t('browserHost.hostOnline', 'Host 在线') : t('browserHost.hostOffline', 'Host 离线')}
            </span>
            <button
              type="button"
              onClick={() => setShareDialogOpen(true)}
              disabled={!selectedWorkspace?.ownerSessionId}
              aria-label={t('browserHost.shareButton', '共享给 Agent 会话')}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-accent/25 bg-accent/10 px-3 text-sm text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconShare2 size={15} />
              <span>{t('browserHost.shareButton', '共享给 Agent 会话')}</span>
            </button>
          </div>
        </div>

        <div className="flex h-[60px] items-center gap-2 px-3">
          <button
            type="button"
            aria-label={t('browserHost.back', '后退')}
            disabled={!selectedTab || !selectedWorkspace}
            onClick={() => selectedTab && selectedWorkspace && goBackMutation.mutate({ tabId: selectedTab.tabId, workspaceId: selectedWorkspace.workspaceId })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface text-text-muted transition-colors hover:border-accent/30 hover:text-text disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconArrowLeft size={16} />
          </button>
          <button
            type="button"
            aria-label={t('browserHost.forward', '前进')}
            disabled={!selectedTab || !selectedWorkspace}
            onClick={() => selectedTab && selectedWorkspace && goForwardMutation.mutate({ tabId: selectedTab.tabId, workspaceId: selectedWorkspace.workspaceId })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface text-text-muted transition-colors hover:border-accent/30 hover:text-text disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconArrowRight size={16} />
          </button>
          <button
            type="button"
            aria-label={t('browserHost.reload', '刷新当前标签页')}
            disabled={!selectedTab || !selectedWorkspace}
            onClick={() => selectedTab && selectedWorkspace && reloadMutation.mutate({ tabId: selectedTab.tabId, workspaceId: selectedWorkspace.workspaceId })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface text-text-muted transition-colors hover:border-accent/30 hover:text-text disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconRefresh size={16} />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <IconWorld size={16} className="shrink-0 text-text-subtle" />
            <label htmlFor="browser-host-address" className="sr-only">{t('browserHost.addressLabel', '地址栏')}</label>
            <input
              id="browser-host-address"
              aria-label={t('browserHost.addressLabel', '地址栏')}
              value={addressInput}
              onChange={(event) => {
                setAddressInput(event.target.value);
                setAddressDirty(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleOpenAddress();
                }
              }}
              placeholder={t('browserHost.addressPlaceholder', '输入地址并回车或点击打开')}
              className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm text-text outline-none placeholder:text-text-muted"
            />
          </div>

          <button
            type="button"
            aria-label={t('browserHost.openAddress', '打开地址')}
            onClick={() => void handleOpenAddress()}
            disabled={(!selectedTab && !addressInput.trim()) || createMutation.isPending || ensureStandaloneWorkspaceMutation.isPending}
            className="inline-flex h-9 items-center rounded-xl border border-accent/25 bg-accent/10 px-4 text-sm text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t('browserHost.open', '打开')}
          </button>

          <button
            type="button"
            aria-label={t('browserHost.closeTab', '关闭当前标签页')}
            onClick={() => selectedTab && selectedWorkspace && closeMutation.mutate({ tabId: selectedTab.tabId, workspaceId: selectedWorkspace.workspaceId })}
            disabled={!selectedTab || !selectedWorkspace}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface text-text-muted transition-colors hover:border-danger/30 hover:text-danger disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconX size={16} />
          </button>

          <div className="hidden h-9 items-center rounded-xl border border-border-subtle bg-surface-card/70 px-3 text-xs uppercase tracking-[0.14em] text-text-subtle lg:inline-flex">
            {selectedWorkspace ? `${t('browserHost.workspaceBadge', '工作区')} ${tailId(selectedWorkspace.workspaceId)}` : t('browserHost.unboundWorkspace', '未绑定工作区')}
          </div>
        </div>
      </header>

      <main className="flex-1 bg-surface">
        {!selectedWorkspace || tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="max-w-xl rounded-[28px] border border-border-subtle bg-surface-card px-6 py-6 shadow-[0_22px_54px_rgba(0,0,0,0.24)]">
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-subtle">{t('browserHost.emptyEyebrow', 'Browser Host')}</p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-text">{t('browserHost.emptyTitle', '独立窗口已就绪，等待浏览器标签页')}</h1>
              <p className="mt-3 text-sm leading-7 text-text-muted">
                {t('browserHost.emptyDescription', '先从 Agent 会话、Browser Workspace，或直接在这里输入地址创建首个标签页。创建后，页面内容会接管下方浏览区域。')}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleCreateTab()}
                  disabled={(!selectedWorkspace && !addressInput.trim()) || createMutation.isPending || ensureStandaloneWorkspaceMutation.isPending}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-4 text-sm text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <IconLayoutGridAdd size={16} />
                  <span>{t('browserHost.createFirstTab', '创建首个标签页')}</span>
                </button>
                {selectedWorkspace ? (
                  <span className="text-xs uppercase tracking-[0.14em] text-text-subtle">{tailId(selectedWorkspace.workspaceId)}</span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </main>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent
          title={t('browserHost.shareDialogTitle', '共享给 Agent 会话')}
          description={t('browserHost.shareDialogDescription', '把当前浏览器工作区标记为共享，并把目标会话附着到这组标签页上。')}
        >
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-text-subtle">{t('browserHost.shareWorkspace', '当前工作区')}</p>
              <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3 text-sm text-text">
                {selectedWorkspace ? tailId(selectedWorkspace.workspaceId) : t('browserHost.unboundWorkspace', '未绑定工作区')}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-text-subtle">{t('browserHost.shareTargetSession', '目标 Agent 会话')}</span>
              <input
                value={shareTargetSessionId}
                onChange={(event) => setShareTargetSessionId(event.target.value)}
                placeholder={t('browserHost.shareTargetPlaceholder', '输入目标 session id，可留空仅标记共享')}
                className={inputCls}
              />
            </label>

            <div>
              <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-text-subtle">{t('browserHost.sharePolicy', '共享策略')}</span>
              <Select value={sharePolicy} onValueChange={(value) => setSharePolicy(value as BrowserSharePolicy)}>
                <SelectItem value="manual">{t('browserHost.sharePolicy.manual', '手动附着')}</SelectItem>
                <SelectItem value="global-default">{t('browserHost.sharePolicy.global', '全局默认')}</SelectItem>
              </Select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShareDialogOpen(false)}
                className="rounded-xl border border-border-subtle px-4 py-2 text-sm text-text-muted transition-colors hover:border-border hover:text-text"
              >
                {t('common.cancel', '取消')}
              </button>
              <button
                type="button"
                onClick={handleShareWorkspace}
                disabled={!selectedWorkspace?.ownerSessionId || shareMutation.isPending}
                className="rounded-xl border border-accent/25 bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('browserHost.shareConfirm', '共享工作区')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
