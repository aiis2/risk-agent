import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IconActivity,
  IconArrowUpRight,
  IconCopy,
  IconDeviceDesktop,
  IconExternalLink,
  IconLink,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconShare2,
  IconWorld,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  activateBrowserTab,
  attachBrowserWorkspace,
  createBrowserTab,
  deleteBrowserWorkspace,
  detachBrowserWorkspace,
  ensureSessionBrowserWorkspace,
  getActiveSessions,
  getBrowserState,
  listSessions,
  shareBrowserWorkspace,
  type SessionSummary,
  type BrowserSharePolicy,
  type BrowserStateResponse,
  type BrowserWorkspaceRecord,
} from '../api/client';
import { getElectronAPI, isElectron } from '../lib/electron';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Select, SelectItem } from '../components/ui/Select';
import { IconLinkOff, IconSearch, IconTrash } from '@tabler/icons-react';

const shellCardCls = 'rounded-[28px] border border-border-subtle bg-surface-card shadow-[0_18px_44px_rgba(0,0,0,0.18)]';
const inputCls = 'h-11 w-full rounded-2xl border border-border bg-surface-input px-4 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent/40';

function tailId(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return value.length > 12 ? value.slice(-12) : value;
}

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

function WorkspaceStateBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface/80 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text">{value}</p>
    </div>
  );
}

export function BrowserWorkspacePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [sessionIdInput, setSessionIdInput] = useState(() => searchParams.get('session') ?? '');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(() => searchParams.get('workspace') ?? '');
  const [newTabUrl, setNewTabUrl] = useState('https://example.com');
  const [newTabTitle, setNewTabTitle] = useState('');
  const [sharePolicy, setSharePolicy] = useState<BrowserSharePolicy>('manual');
  const [openingHost, setOpeningHost] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    staleTime: 30_000,
  });
  const browserStateQuery = useQuery<BrowserStateResponse>({
    queryKey: ['browser', 'state'],
    queryFn: getBrowserState,
    refetchInterval: 8_000,
  });
  const activeSessionsQuery = useQuery({
    queryKey: ['sessions', 'active'],
    queryFn: getActiveSessions,
    refetchInterval: 8_000,
    staleTime: 5_000,
  });

  const activeSessions = activeSessionsQuery.data?.sessions ?? [];
  const knownSessions = useMemo(() => {
    const merged = new Map<string, SessionSummary>();
    for (const session of activeSessions) {
      merged.set(session.sessionId, session);
    }
    for (const session of sessionsQuery.data ?? []) {
      if (!merged.has(session.sessionId)) {
        merged.set(session.sessionId, session);
      }
    }
    return Array.from(merged.values());
  }, [activeSessions, sessionsQuery.data]);
  const state = browserStateQuery.data;
  const selectedWorkspace = state?.workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? state?.workspaces[0] ?? null;
  const selectedWorkspaceTabs = state?.tabs.filter((tab) => tab.workspaceId === selectedWorkspace?.workspaceId) ?? [];
  const selectedWorkspaceBindings = state?.bindings.filter((binding) => binding.workspaceId === selectedWorkspace?.workspaceId) ?? [];
  const trimmedSessionId = sessionIdInput.trim();

  useEffect(() => {
    const preselectedSession = searchParams.get('session');
    if (preselectedSession) {
      setSessionIdInput(preselectedSession);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedWorkspaceId && state?.workspaces[0]?.workspaceId) {
      setSelectedWorkspaceId(state.workspaces[0].workspaceId);
      return;
    }

    if (selectedWorkspaceId && state && !state.workspaces.some((workspace) => workspace.workspaceId === selectedWorkspaceId)) {
      setSelectedWorkspaceId(state.workspaces[0]?.workspaceId ?? '');
    }
  }, [selectedWorkspaceId, state]);

  const selectedSessionExists = useMemo(
    () => knownSessions.some((session) => session.sessionId === trimmedSessionId),
    [knownSessions, trimmedSessionId],
  );
  const activeSessionIds = useMemo(() => new Set(activeSessions.map((session) => session.sessionId)), [activeSessions]);
  const filteredActiveSessions = useMemo(() => {
    const query = trimmedSessionId.toLowerCase();
    if (!query) {
      return activeSessions;
    }
    return activeSessions.filter((session) => {
      const businessName = session.businessName?.toLowerCase() ?? '';
      return session.sessionId.toLowerCase().includes(query) || businessName.includes(query);
    });
  }, [activeSessions, trimmedSessionId]);
  const sessionBindingMatch = useMemo(
    () => selectedWorkspaceBindings.find((binding) => binding.sessionId === trimmedSessionId) ?? null,
    [selectedWorkspaceBindings, trimmedSessionId],
  );

  const bindWorkspaceMutation = useMutation({
    mutationFn: (sessionId: string) => ensureSessionBrowserWorkspace(sessionId),
    onSuccess: async (result) => {
      setSelectedWorkspaceId(result.workspace.workspaceId);
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const shareWorkspaceMutation = useMutation({
    mutationFn: (payload: { workspaceId: string; sessionId: string; sharePolicy: BrowserSharePolicy }) =>
      shareBrowserWorkspace(payload.workspaceId, { sessionId: payload.sessionId, sharePolicy: payload.sharePolicy }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const attachWorkspaceMutation = useMutation({
    mutationFn: (payload: { workspaceId: string; sessionId: string }) => attachBrowserWorkspace(payload.workspaceId, payload.sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const detachWorkspaceMutation = useMutation({
    mutationFn: (payload: { workspaceId: string; sessionId: string }) => detachBrowserWorkspace(payload.workspaceId, payload.sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (payload: { workspaceId: string; sessionId?: string | null }) => deleteBrowserWorkspace(payload.workspaceId, { sessionId: payload.sessionId ?? null }),
    onSuccess: async (_result, variables) => {
      if (selectedWorkspaceId === variables.workspaceId) {
        setSelectedWorkspaceId('');
      }
      setDeleteDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const createTabMutation = useMutation({
    mutationFn: (payload: { workspaceId: string; currentUrl: string; title?: string | null; contributedBySessionId?: string | null }) =>
      createBrowserTab({
        workspaceId: payload.workspaceId,
        currentUrl: payload.currentUrl,
        title: payload.title,
        status: 'ready',
        contributedBySessionId: payload.contributedBySessionId ?? null,
      }),
    onSuccess: async () => {
      setNewTabTitle('');
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  const activateTabMutation = useMutation({
    mutationFn: (payload: { tabId: string; workspaceId: string }) => activateBrowserTab(payload.tabId, payload.workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['browser', 'state'] });
    },
  });

  async function handleCopy(value: string) {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1500);
  }

  async function handleOpenBrowserHost() {
    const electron = getElectronAPI();
    if (!electron) {
      return;
    }

    try {
      setOpeningHost(true);
      await electron.openBrowserHost();
    } finally {
      setOpeningHost(false);
    }
  }

  function handleBindWorkspace() {
    const sessionId = sessionIdInput.trim();
    if (!sessionId) {
      return;
    }
    bindWorkspaceMutation.mutate(sessionId);
  }

  function handleCreateTab() {
    if (!selectedWorkspace) {
      return;
    }
    const currentUrl = normalizeUrl(newTabUrl);
    if (!currentUrl) {
      return;
    }
    createTabMutation.mutate({
      workspaceId: selectedWorkspace.workspaceId,
      currentUrl,
      title: newTabTitle.trim() || null,
      contributedBySessionId: sessionIdInput.trim() || null,
    });
  }

  function renderWorkspaceCard(workspace: BrowserWorkspaceRecord) {
    const tabsCount = state?.tabs.filter((tab) => tab.workspaceId === workspace.workspaceId).length ?? 0;
    const bindingsCount = state?.bindings.filter((binding) => binding.workspaceId === workspace.workspaceId).length ?? 0;
    const isSelected = workspace.workspaceId === selectedWorkspace?.workspaceId;

    return (
      <button
        key={workspace.workspaceId}
        type="button"
        onClick={() => setSelectedWorkspaceId(workspace.workspaceId)}
        className={clsx(
          'w-full rounded-[24px] border px-4 py-4 text-left transition-colors',
          isSelected ? 'border-accent/30 bg-accent/10' : 'border-border-subtle bg-surface/75 hover:border-accent/20 hover:bg-surface',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.workspaceLabel', 'Workspace')}</p>
            <p className="mt-1 font-mono text-sm text-text">{tailId(workspace.workspaceId)}</p>
          </div>
          <span className={clsx(
            'rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]',
            workspace.visibility === 'shared' ? 'border-accent/25 bg-accent/10 text-accent' : 'border-border-subtle bg-surface-card text-text-muted',
          )}>
            {workspace.visibility === 'shared' ? t('browser.visibility.shared', '共享') : t('browser.visibility.exclusive', '独占')}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <WorkspaceStateBadge label={t('browser.ownerLabel', 'Owner')} value={tailId(workspace.ownerSessionId)} />
          <WorkspaceStateBadge label={t('browser.providerLabel', 'Provider')} value={workspace.providerKind} />
          <WorkspaceStateBadge label={t('browser.tabsLabel', 'Tabs')} value={String(tabsCount)} />
          <WorkspaceStateBadge label={t('browser.bindingsLabel', 'Bindings')} value={String(bindingsCount)} />
        </div>
      </button>
    );
  }

  return (
    <>
      <ScrollArea className="flex-1 bg-surface">
        <div className="min-h-full bg-surface px-5 py-5">
        <section className={clsx(shellCardCls, 'relative overflow-hidden px-5 py-5')}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(107,138,254,0.22),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(74,211,197,0.12),transparent_30%)]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-subtle">{t('browser.eyebrow', 'Session-Shared Browser')}</p>
              <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-text">{t('browser.title', 'Browser Workspace')}</h1>
              <p className="mt-3 max-w-[76ch] text-sm leading-7 text-text-muted">
                {t('browser.description', '把任意会话绑定到同一组浏览器标签页上。这里可以创建工作区、切换共享策略、为指定会话附着工作区，并把新标签页同步到 Electron Browser Host。')}
              </p>
              {searchParams.get('session') && (
                <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">
                  <IconRoute size={12} />
                  {t('browser.prefilledSession', '已根据当前聊天会话预填 session id')}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void browserStateQuery.refetch()}
                className="inline-flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-accent/35 hover:text-accent"
              >
                <IconRefresh size={16} />
                {t('common.refresh', '刷新')}
              </button>
              {isElectron() && (
                <button
                  type="button"
                  onClick={handleOpenBrowserHost}
                  disabled={openingHost}
                  className="inline-flex items-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/15 disabled:opacity-60"
                >
                  {openingHost ? <IconLoader2 size={16} className="animate-spin" /> : <IconDeviceDesktop size={16} />}
                  {t('browser.openHostWindow', '打开 Browser Host')}
                </button>
              )}
              <Link
                to="/settings"
                className="inline-flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-accent/35 hover:text-accent"
              >
                <IconArrowUpRight size={16} />
                {t('browser.openSettings', '浏览器设置')}
              </Link>
            </div>
          </div>

          <div className="relative mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <WorkspaceStateBadge label={t('browser.metrics.host', 'Host')} value={state?.hostAvailable ? t('browser.hostAvailable', '已接入') : t('browser.hostUnavailable', '未接入')} />
            <WorkspaceStateBadge label={t('browser.metrics.workspaces', 'Workspaces')} value={String(state?.workspaces.length ?? 0)} />
            <WorkspaceStateBadge label={t('browser.metrics.tabs', 'Tabs')} value={String(state?.tabs.length ?? 0)} />
            <WorkspaceStateBadge label={t('browser.metrics.bindings', 'Bindings')} value={String(state?.bindings.length ?? 0)} />
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[360px,minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className={clsx(shellCardCls, 'p-5')}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                  <IconRoute size={18} />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.sessionEyebrow', 'Session Binding')}</p>
                  <h2 className="mt-1 text-base font-semibold text-text">{t('browser.sessionTitle', '选择或输入 session id')}</h2>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <label className="block">
                  <span className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.sessionLabel', 'Session ID')}</span>
                  <input
                    value={sessionIdInput}
                    onChange={(event) => setSessionIdInput(event.target.value)}
                    placeholder={t('browser.sessionPlaceholder', '输入聊天 run id 或分析 session id')}
                    className={inputCls}
                  />
                </label>

                <div className="rounded-3xl border border-border-subtle bg-surface/70 p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-subtle">
                    <IconSearch size={14} />
                    <span>{t('browser.activeSessions', '活跃会话')}</span>
                  </div>
                  <div className="mt-3 space-y-3">
                    <Select
                      value={activeSessionIds.has(trimmedSessionId) ? trimmedSessionId : ''}
                      onValueChange={(value) => setSessionIdInput(value)}
                      disabled={activeSessions.length === 0}
                      placeholder={t('browser.activeSessionsSelect', '选择活跃会话')}
                      className="h-11 rounded-2xl"
                    >
                      {activeSessions.map((session) => (
                        <SelectItem key={session.sessionId} value={session.sessionId}>
                          {session.businessName || tailId(session.sessionId)}
                        </SelectItem>
                      ))}
                    </Select>

                    <div className="flex flex-wrap gap-2">
                      {filteredActiveSessions.map((session) => (
                        <button
                          key={session.sessionId}
                          type="button"
                          onClick={() => setSessionIdInput(session.sessionId)}
                          className={clsx(
                            'rounded-full border px-3 py-1.5 text-xs transition-colors',
                            session.sessionId === trimmedSessionId ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border-subtle bg-surface-card text-text-muted hover:border-accent/20 hover:text-text',
                          )}
                        >
                          {session.businessName || tailId(session.sessionId)}
                        </button>
                      ))}
                      {activeSessions.length === 0 && (
                        <span className="text-xs leading-6 text-text-muted">{t('browser.noActiveSessions', '当前没有正在运行的活跃会话。')}</span>
                      )}
                      {activeSessions.length > 0 && filteredActiveSessions.length === 0 && (
                        <span className="text-xs leading-6 text-text-muted">{t('browser.noActiveSessionsMatch', '没有匹配当前输入的活跃会话，仍然可以继续手动输入 session id。')}</span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleBindWorkspace}
                  disabled={!sessionIdInput.trim() || bindWorkspaceMutation.isPending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {bindWorkspaceMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconLink size={16} />}
                  {bindWorkspaceMutation.isPending ? t('browser.bindPending', '绑定中…') : t('browser.bindAction', '绑定当前会话工作区')}
                </button>

                <div className="rounded-3xl border border-border-subtle bg-surface/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.recentSessions', '最近会话')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {knownSessions.slice(0, 8).map((session) => (
                      <button
                        key={session.sessionId}
                        type="button"
                        onClick={() => setSessionIdInput(session.sessionId)}
                        className={clsx(
                          'rounded-full border px-3 py-1.5 text-xs transition-colors',
                          session.sessionId === sessionIdInput ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border-subtle bg-surface-card text-text-muted hover:border-accent/20 hover:text-text',
                        )}
                      >
                        {session.businessName || tailId(session.sessionId)}
                      </button>
                    ))}
                    {knownSessions.length === 0 && (
                      <span className="text-xs leading-6 text-text-muted">{t('browser.noRecentSessions', '当前没有可枚举的分析会话，仍然可以手动输入聊天 run id。')}</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className={clsx(shellCardCls, 'p-5')}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                  <IconWorld size={18} />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.workspacesEyebrow', 'Workspace Index')}</p>
                  <h2 className="mt-1 text-base font-semibold text-text">{t('browser.workspacesTitle', '当前工作区')}</h2>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {browserStateQuery.isLoading && (
                  <div className="flex items-center gap-2 rounded-3xl border border-border-subtle bg-surface/70 px-4 py-4 text-sm text-text-muted">
                    <IconLoader2 size={16} className="animate-spin" />
                    {t('common.loading', '加载中…')}
                  </div>
                )}

                {!browserStateQuery.isLoading && (state?.workspaces.length ?? 0) === 0 && (
                  <div className="rounded-3xl border border-dashed border-border-subtle bg-surface/60 px-4 py-5 text-sm leading-7 text-text-muted">
                    {t('browser.noWorkspaces', '还没有浏览器工作区。先输入一个 session id，然后绑定它的工作区。')}
                  </div>
                )}

                {state?.workspaces.map((workspace) => renderWorkspaceCard(workspace))}
              </div>
            </section>
          </aside>

          <section className="space-y-5">
            <div className={clsx(shellCardCls, 'p-5')}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.workspaceDetailEyebrow', 'Workspace Detail')}</p>
                  <h2 className="mt-1 text-base font-semibold text-text">{selectedWorkspace ? tailId(selectedWorkspace.workspaceId) : t('browser.noWorkspaceSelected', '尚未选择工作区')}</h2>
                  <p className="mt-2 text-sm leading-7 text-text-muted">
                    {selectedWorkspace
                      ? t('browser.workspaceDetailDescription', '这里可以切换共享策略、附着新会话、创建标签页，并把激活 tab 同步到 Browser Host。')
                      : t('browser.workspaceDetailEmpty', '左侧选择一个工作区后，这里会显示它的标签页和绑定状态。')}
                  </p>
                </div>

                {selectedWorkspace && (
                  <button
                    type="button"
                    onClick={() => void handleCopy(selectedWorkspace.workspaceId)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-accent/35 hover:text-accent"
                  >
                    <IconCopy size={16} />
                    {copiedValue === selectedWorkspace.workspaceId ? t('browser.copied', '已复制') : t('browser.copyWorkspaceId', '复制 Workspace ID')}
                  </button>
                )}
              </div>

              {selectedWorkspace && (
                <>
                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <WorkspaceStateBadge label={t('browser.ownerLabel', 'Owner')} value={tailId(selectedWorkspace.ownerSessionId)} />
                    <WorkspaceStateBadge label={t('browser.providerLabel', 'Provider')} value={selectedWorkspace.providerKind} />
                    <WorkspaceStateBadge label={t('browser.sharePolicyLabel', 'Share Policy')} value={selectedWorkspace.sharePolicy} />
                    <WorkspaceStateBadge label={t('browser.controllerLabel', 'Controller')} value={tailId(selectedWorkspace.controllerSessionId)} />
                  </div>

                  <div className="mt-5 grid gap-5 lg:grid-cols-[1fr,1fr]">
                    <div className="rounded-[24px] border border-border-subtle bg-surface/70 p-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.sharingTitle', '共享设置')}</p>
                      <div className="mt-4 space-y-3">
                        <Select value={sharePolicy} onValueChange={(value) => setSharePolicy(value as BrowserSharePolicy)}>
                          <SelectItem value="manual">{t('browser.sharePolicies.manual', '手动附着')}</SelectItem>
                          <SelectItem value="global-default">{t('browser.sharePolicies.globalDefault', '全局默认共享')}</SelectItem>
                        </Select>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => shareWorkspaceMutation.mutate({ workspaceId: selectedWorkspace.workspaceId, sessionId: sessionIdInput.trim(), sharePolicy })}
                            disabled={!sessionIdInput.trim() || shareWorkspaceMutation.isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                          >
                            {shareWorkspaceMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconShare2 size={16} />}
                            {t('browser.shareAction', '标记为共享工作区')}
                          </button>
                          <button
                            type="button"
                            onClick={() => attachWorkspaceMutation.mutate({ workspaceId: selectedWorkspace.workspaceId, sessionId: sessionIdInput.trim() })}
                            disabled={!sessionIdInput.trim() || attachWorkspaceMutation.isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-3 text-sm text-text transition-colors hover:border-accent/35 hover:text-accent disabled:opacity-50"
                          >
                            {attachWorkspaceMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconLink size={16} />}
                            {t('browser.attachAction', '附着到当前 session')}
                          </button>
                        </div>

                        {!selectedSessionExists && sessionIdInput.trim() && (
                          <p className="text-xs leading-6 text-text-muted">
                            {t('browser.manualSessionHint', '当前 session id 不在分析会话列表中。若这是聊天 run id，仍然可以继续绑定。')}
                          </p>
                        )}

                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => detachWorkspaceMutation.mutate({ workspaceId: selectedWorkspace.workspaceId, sessionId: trimmedSessionId })}
                            disabled={!trimmedSessionId || !sessionBindingMatch || detachWorkspaceMutation.isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-3 text-sm text-text transition-colors hover:border-accent/35 hover:text-accent disabled:opacity-50"
                          >
                            {detachWorkspaceMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconLinkOff size={16} />}
                            {t('browser.detachAction', '解除当前 session')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteDialogOpen(true)}
                            disabled={deleteWorkspaceMutation.isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
                          >
                            {deleteWorkspaceMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconTrash size={16} />}
                            {t('browser.deleteWorkspaceAction', '删除当前工作区')}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-border-subtle bg-surface/70 p-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.newTabTitle', '新建标签页')}</p>
                      <div className="mt-4 space-y-3">
                        <input
                          value={newTabUrl}
                          onChange={(event) => setNewTabUrl(event.target.value)}
                          placeholder={t('browser.newTabUrlPlaceholder', '输入网址，例如 https://example.com')}
                          className={inputCls}
                        />
                        <input
                          value={newTabTitle}
                          onChange={(event) => setNewTabTitle(event.target.value)}
                          placeholder={t('browser.newTabNamePlaceholder', '可选的标签页标题')}
                          className={inputCls}
                        />
                        <button
                          type="button"
                          onClick={handleCreateTab}
                          disabled={!newTabUrl.trim() || createTabMutation.isPending}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {createTabMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : <IconPlus size={16} />}
                          {t('browser.createTabAction', '创建标签页并同步到 Host')}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className={clsx(shellCardCls, 'p-5')}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                  <IconActivity size={18} />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.tabsEyebrow', 'Tabs')}</p>
                  <h2 className="mt-1 text-base font-semibold text-text">{t('browser.tabsPanelTitle', '标签页与绑定状态')}</h2>
                </div>
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr),320px]">
                <div className="space-y-3">
                  {selectedWorkspaceTabs.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-border-subtle bg-surface/60 px-4 py-5 text-sm leading-7 text-text-muted">
                      {t('browser.noTabs', '当前工作区还没有标签页。先在上方输入网址，创建第一张标签页。')}
                    </div>
                  )}

                  {selectedWorkspaceTabs.map((tab) => {
                    const isActive = selectedWorkspace?.lastActiveTabId === tab.tabId;
                    return (
                      <div
                        key={tab.tabId}
                        className={clsx(
                          'rounded-[24px] border px-4 py-4 transition-colors',
                          isActive ? 'border-accent/30 bg-accent/10' : 'border-border-subtle bg-surface/75',
                        )}
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={clsx(
                                'rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]',
                                isActive ? 'border-accent/25 bg-accent/10 text-accent' : 'border-border-subtle bg-surface-card text-text-muted',
                              )}>
                                {isActive ? t('browser.activeTab', '当前激活') : t('browser.inactiveTab', '待切换')}
                              </span>
                              <span className="font-mono text-[11px] text-text-subtle">{tailId(tab.tabId)}</span>
                            </div>
                            <p className="mt-3 truncate text-sm font-semibold text-text">{tab.title || t('browser.untitledTab', '未命名标签页')}</p>
                            <p className="mt-1 truncate text-xs text-text-muted">{tab.currentUrl || t('browser.noUrl', '尚未记录地址')}</p>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-subtle">
                              <span>{t('browser.tabStatus', '状态')}: {tab.status}</span>
                              <span>{t('browser.providerRef', 'Provider Ref')}: {tailId(tab.providerTabRef)}</span>
                              <span>{t('browser.contributedBy', '贡献会话')}: {tailId(tab.contributedBySessionId)}</span>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => activateTabMutation.mutate({ tabId: tab.tabId, workspaceId: tab.workspaceId })}
                              disabled={activateTabMutation.isPending}
                              className="inline-flex items-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-3 py-2 text-xs text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                            >
                              {activateTabMutation.isPending && activateTabMutation.variables?.tabId === tab.tabId ? <IconLoader2 size={14} className="animate-spin" /> : <IconWorld size={14} />}
                              {t('browser.activateAction', '激活并同步')}
                            </button>
                            {tab.currentUrl && (
                              <a
                                href={tab.currentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-3 py-2 text-xs text-text transition-colors hover:border-accent/35 hover:text-accent"
                              >
                                <IconExternalLink size={14} />
                                {t('browser.openExternally', '在浏览器中打开')}
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-[24px] border border-border-subtle bg-surface/75 p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">{t('browser.bindingsPanelTitle', '当前绑定')}</p>
                  <div className="mt-4 space-y-3">
                    {selectedWorkspaceBindings.length === 0 && (
                      <p className="text-sm leading-7 text-text-muted">{t('browser.noBindings', '当前工作区还没有活动绑定。')}</p>
                    )}
                    {selectedWorkspaceBindings.map((binding) => (
                      <div key={binding.bindingId} className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-text">{tailId(binding.sessionId)}</span>
                          <span className={clsx(
                            'rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]',
                            binding.role === 'owner' ? 'border-accent/25 bg-accent/10 text-accent' : 'border-border-subtle bg-surface text-text-muted',
                          )}>
                            {binding.role === 'owner' ? t('browser.bindingRoles.owner', '所有者') : t('browser.bindingRoles.observer', '观察者')}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1 text-[11px] text-text-subtle">
                          <p>{t('browser.bindingSource', '来源')}: {binding.source}</p>
                          <p>{t('browser.bindingControl', '可控制')}: {binding.canControl ? t('browser.yes', '是') : t('browser.no', '否')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
        </div>
      </ScrollArea>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent
          title={t('browser.deleteWorkspaceDialogTitle', '删除当前工作区')}
          description={t('browser.deleteWorkspaceDialogDescription', '删除后会同时移除该工作区的标签页与绑定，请确认当前不再需要它。')}
        >
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(false)}
              className="rounded-xl border border-border-subtle px-4 py-2 text-sm text-text-muted transition-colors hover:border-border hover:text-text"
            >
              {t('common.cancel', '取消')}
            </button>
            <button
              type="button"
              onClick={() => selectedWorkspace && deleteWorkspaceMutation.mutate({ workspaceId: selectedWorkspace.workspaceId, sessionId: selectedWorkspace.ownerSessionId })}
              disabled={!selectedWorkspace || deleteWorkspaceMutation.isPending}
              className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-2 text-sm text-danger transition-colors hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t('browser.deleteWorkspaceConfirm', '确认删除工作区')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}