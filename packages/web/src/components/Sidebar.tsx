import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  IconShieldCheck,
  IconLayoutDashboard,
  IconBook,
  IconShield,
  IconFileText,
  IconSettings,
  IconChevronDown,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLanguage,
  IconClock,
  IconClockHour4,
  IconLoader2,
  IconCircleCheck,
  IconAlertCircle,
  IconMessageForward,
  IconPlayerPlay,
  IconUsers,
  IconPencil,
  IconTrash,
  IconCheck,
  IconX,
  IconExternalLink,
  IconShare2,
  IconPalette,
  IconDeviceDesktop,
  IconMoon,
  IconSun,
  IconDroplet,
  IconTerminal2,
  IconSearch,
  IconRoute,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { listRuns, listSessions, putPreferences, renameSession, terminateSession, type RunStatusValue, type RunSummary } from '../api/client';
import { getNextThemeMode, type ThemeMode } from '../lib/theme';
import type { NavPage } from '../hooks/useUIStore';
import { useUIStore } from '../hooks/useUIStore';
import { usePreferenceStore } from '../stores/preferenceStore';
import { Tooltip, TooltipProvider } from './ui/Tooltip';
import { ScrollArea } from './ui/ScrollArea';
import { Separator } from './ui/Separator';

// NavPage needs to include run-first surfaces plus profiles and knowledge-graph
type ExtendedNavPage = NavPage | 'chat' | 'cli' | 'workbench' | 'runs' | 'scheduled-runs' | 'profiles' | 'knowledge-graph' | 'browser';

interface NavItem {
  page: ExtendedNavPage;
  icon: React.ReactNode;
  labelKey: string;
  fallbackLabel: string;
  path: string;
}

// 'sessions' 已整合到侧边栏历史区域，不再作为独立导航项
const NAV_ITEMS: NavItem[] = [
  { page: 'chat', icon: <IconMessageForward size={16} />, labelKey: 'nav.chat', fallbackLabel: '智能聊天', path: '/chat' },
  { page: 'cli', icon: <IconTerminal2 size={16} />, labelKey: 'nav.cli', fallbackLabel: 'CLI 控制台', path: '/cli' },
  { page: 'workbench', icon: <IconPlayerPlay size={16} />, labelKey: 'nav.workbench', fallbackLabel: '运行工作台', path: '/workbench' },
  { page: 'runs', icon: <IconClock size={16} />, labelKey: 'nav.runs', fallbackLabel: '运行记录', path: '/runs' },
  { page: 'scheduled-runs', icon: <IconClockHour4 size={16} />, labelKey: 'nav.scheduledRuns', fallbackLabel: '定时运行', path: '/scheduled-runs' },
  { page: 'dashboard', icon: <IconLayoutDashboard size={16} />, labelKey: 'nav.dashboard', fallbackLabel: '仪表盘', path: '/' },
  { page: 'scenarios', icon: <IconBook size={16} />, labelKey: 'nav.scenarios', fallbackLabel: '业务场景', path: '/scenarios' },
  { page: 'rules', icon: <IconShield size={16} />, labelKey: 'nav.rules', fallbackLabel: '规则管理', path: '/rules' },
  { page: 'profiles', icon: <IconUsers size={16} />, labelKey: 'nav.profiles', fallbackLabel: '业务画像', path: '/profiles' },
  { page: 'knowledge-graph', icon: <IconShare2 size={16} />, labelKey: 'nav.knowledgeGraph', fallbackLabel: '知识图谱', path: '/knowledge-graph' },
  { page: 'browser', icon: <IconRoute size={16} />, labelKey: 'nav.browser', fallbackLabel: 'Browser Workspace', path: '/browser' },
  { page: 'reports', icon: <IconFileText size={16} />, labelKey: 'nav.reports', fallbackLabel: '分析报告', path: '/reports' },
  { page: 'settings', icon: <IconSettings size={16} />, labelKey: 'nav.settings', fallbackLabel: '系统设置', path: '/settings' },
];

const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.page !== 'chat');
const COLLAPSED_PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.page === 'chat' || item.page === 'cli');
const COLLAPSED_SECONDARY_ITEMS = SECONDARY_NAV_ITEMS.filter((item) => item.page !== 'cli');

const THEME_META: Record<ThemeMode, {
  label: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}> = {
  system: { label: '系统', Icon: IconDeviceDesktop },
  midnight: { label: 'Midnight', Icon: IconMoon },
  paper: { label: 'Paper', Icon: IconSun },
  sea: { label: 'Sea', Icon: IconDroplet },
};

function SessionStatusIcon({ status }: { status: string }) {
  const sz = 10;
  if (status === 'running') return <IconLoader2 size={sz} className="animate-spin text-warn" />;
  if (status === 'completed') return <IconCircleCheck size={sz} className="text-success" />;
  if (status === 'error') return <IconAlertCircle size={sz} className="text-danger" />;
  return null;
}

function RunStatusIcon({ status }: { status: RunStatusValue }) {
  const sz = 10;
  if (status === 'running' || status === 'routing' || status === 'planning' || status === 'verifying') {
    return <IconLoader2 size={sz} className="animate-spin text-warn" />;
  }
  if (status === 'waiting_user' || status === 'created') {
    return <IconClock size={sz} className="text-warn" />;
  }
  if (status === 'completed') {
    return <IconCircleCheck size={sz} className="text-success" />;
  }
  if (status === 'failed' || status === 'cancelled') {
    return <IconAlertCircle size={sz} className="text-danger" />;
  }
  return <IconClock size={sz} className="text-text-muted" />;
}

type ConversationSurface = 'chat' | 'cli';

function getConversationSurface(run: RunSummary): ConversationSurface | null {
  const rawSurface = typeof run.input?.surface === 'string' ? run.input.surface : 'web';
  if (rawSurface === 'terminal-cli' || rawSurface === 'web-cli' || rawSurface === 'background') {
    return 'cli';
  }
  if (rawSurface === 'web') {
    return 'chat';
  }
  return null;
}

function getConversationRoute(run: RunSummary): string | null {
  const surface = getConversationSurface(run);
  if (!surface) {
    return null;
  }
  return surface === 'cli' ? `/cli?run=${run.runId}` : `/chat?run=${run.runId}`;
}

function getConversationTitle(run: RunSummary): string {
  const businessName = typeof run.input?.businessName === 'string' ? run.input.businessName.trim() : '';
  if (businessName) {
    return businessName;
  }
  const prompt = typeof run.input?.prompt === 'string' ? run.input.prompt.trim() : '';
  if (prompt) {
    return prompt.length > 44 ? `${prompt.slice(0, 43)}…` : prompt;
  }
  return run.runId;
}

function getConversationStatusLabel(status: RunStatusValue): string {
  if (status === 'running' || status === 'routing' || status === 'planning' || status === 'verifying') return '运行中';
  if (status === 'waiting_user') return '等待输入';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '准备中';
}

function getConversationSurfaceLabel(surface: ConversationSurface): string {
  return surface === 'cli' ? 'CLI' : '聊天';
}

const ACTIVE_RUN_STATUSES = new Set<RunStatusValue>(['created', 'routing', 'planning', 'running', 'waiting_user', 'verifying']);

/** 侧边栏拖拽调整宽度的 hook */
function useSidebarResize(asideRef: React.RefObject<HTMLElement | null>) {
  const { sidebarWidth, setSidebarWidth, setSidebarCollapsed } = useUIStore();
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(sidebarWidth);
  // Keep stable refs to the listeners so they can be removed on unmount even
  // when a drag is in progress (prevents global event listener leak).
  const moveListenerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upListenerRef = useRef<((ev: MouseEvent) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (moveListenerRef.current) document.removeEventListener('mousemove', moveListenerRef.current);
      if (upListenerRef.current) document.removeEventListener('mouseup', upListenerRef.current);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = asideRef.current?.offsetWidth ?? sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - startX.current;
      const newW = Math.max(120, Math.min(420, startWidth.current + delta));
      if (asideRef.current) {
        (asideRef.current as HTMLElement).style.width = `${newW}px`;
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      isDragging.current = false;
      const delta = ev.clientX - startX.current;
      const newW = Math.max(120, Math.min(420, startWidth.current + delta));
      if (newW < 160) {
        setSidebarCollapsed(true);
        if (asideRef.current) (asideRef.current as HTMLElement).style.width = '';
      } else {
        setSidebarWidth(newW);
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      moveListenerRef.current = null;
      upListenerRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    moveListenerRef.current = onMouseMove;
    upListenerRef.current = onMouseUp;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [asideRef, sidebarWidth, setSidebarWidth, setSidebarCollapsed]);

  return { onDragStart };
}

/** 单条会话记录（支持重命名和删除） */
function SessionItem({ session, isActive }: {
  session: { sessionId: string; businessName: string; status: string };
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const renameMut = useMutation({
    mutationFn: (name: string) => renameSession(session.sessionId, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => terminateSession(session.sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.businessName);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.businessName) {
      renameMut.mutate(trimmed);
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  return (
    <div className={clsx(
      'group relative flex items-center rounded-lg text-xs transition-colors',
      isActive ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-surface-soft'
    )}>
      {editing ? (
        <div className="flex flex-1 items-center gap-1 px-2 py-1">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitEdit}
            placeholder={t('sidebar.editNamePlaceholder', '输入名称')}
            aria-label={t('sidebar.sessionName', '会话名称')}
            className="flex-1 min-w-0 rounded bg-surface-card px-1.5 py-0.5 text-xs text-text outline-none border border-accent/40"
          />
          <button onClick={commitEdit} aria-label={t('sidebar.confirmRename', '确认重命名')} className="shrink-0 rounded p-0.5 text-success hover:bg-success/10">
            <IconCheck size={11} />
          </button>
          <button onClick={cancelEdit} aria-label={t('sidebar.cancelRename', '取消重命名')} className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover">
            <IconX size={11} />
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => navigate(`/analyze?session=${session.sessionId}&resume=1`)}
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
          >
            <div className="shrink-0 flex items-center">
              <SessionStatusIcon status={session.status} />
            </div>
            <span className="flex-1 truncate">{session.businessName}</span>
          </button>
          <span className="hidden group-hover:flex shrink-0 items-center gap-0.5 pr-1.5">
            {session.status === 'running' && (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/analyze?session=${session.sessionId}&resume=1`); }}
                aria-label={t('sidebar.resumeSession', '恢复会话')}
                className="rounded p-0.5 text-accent transition-colors hover:bg-accent/20"
              >
                <IconPlayerPlay size={9} />
              </button>
            )}
            <button
              onClick={startEdit}
              aria-label={t('sidebar.renameSession', '重命名')}
              className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-dim"
            >
              <IconPencil size={9} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteMut.mutate(); }}
              aria-label={t('sidebar.deleteSession', '删除')}
              disabled={deleteMut.isPending}
              className="rounded p-0.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              {deleteMut.isPending ? <IconLoader2 size={9} className="animate-spin" /> : <IconTrash size={9} />}
            </button>
          </span>
        </>
      )}
    </div>
  );
}

function RecentRunItem({ run, isActive }: { run: RunSummary; isActive: boolean }) {
  const navigate = useNavigate();
  const route = getConversationRoute(run);
  const surface = getConversationSurface(run);

  if (!route || !surface) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => navigate(route)}
      aria-label={`${getConversationTitle(run)} ${getConversationSurfaceLabel(surface)} ${getConversationStatusLabel(run.status)}`}
      className={clsx(
        'group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
        isActive ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-surface-soft'
      )}
    >
      <span className="shrink-0 flex items-center">
        <RunStatusIcon status={run.status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{getConversationTitle(run)}</span>
        <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.12em] text-text-subtle">
          {getConversationSurfaceLabel(surface)}
        </span>
      </span>
    </button>
  );
}

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { sidebarCollapsed, sidebarWidth, toggleSidebar } = useUIStore();
  const themeMode = usePreferenceStore((state) => state.themeMode);
  const setThemeMode = usePreferenceStore((state) => state.setThemeMode);
  const clearDirty = usePreferenceStore((state) => state.clearDirty);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [sessionSearch, setSessionSearch] = useState('');
  const asideRef = useRef<HTMLElement>(null);
  const { onDragStart } = useSidebarResize(asideRef);

  // 统一宽度管理 effect（必须在所有条件 return 之前，保证 hooks 调用顺序稳定）
  useEffect(() => {
    if (!asideRef.current) return;
    if (sidebarCollapsed) {
      (asideRef.current as HTMLElement).style.width = '';
    } else {
      (asideRef.current as HTMLElement).style.width = `${sidebarWidth}px`;
    }
  }, [sidebarCollapsed, sidebarWidth]);

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    refetchInterval: 15000,
  });

  const { data: runs = [] } = useQuery<RunSummary[]>({
    queryKey: ['sidebar-runs-history'],
    queryFn: listRuns,
    refetchInterval: 15000,
  });

  const toggleLang = () => {
    const next = i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN';
    i18n.changeLanguage(next);
    document.documentElement.lang = next;
  };

  const saveThemeMut = useMutation({
    mutationFn: (mode: ThemeMode) => putPreferences({ themeMode: mode }),
    onSuccess: () => {
      clearDirty();
      void qc.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // 过滤掉已归档/已删除的会话
  const visibleSessions = sessions.filter((s) => s.status !== 'archived');
  const pinnedSessions = visibleSessions.filter((s) => s.status === 'running').slice(0, 3);
  const recentConversationRuns = runs.filter((run) => getConversationRoute(run) !== null).slice(0, 12);
  const pinnedConversationRuns = recentConversationRuns.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).slice(0, 3);

  // 搜索过滤（侧边栏历史区域）
  const sessionSearchLow = sessionSearch.toLowerCase();
  const filteredConversationRuns = sessionSearch
    ? recentConversationRuns.filter((run) => getConversationTitle(run).toLowerCase().includes(sessionSearchLow))
    : recentConversationRuns;
  const filteredSessions = sessionSearch
    ? visibleSessions.filter((s) => s.businessName.toLowerCase().includes(sessionSearchLow))
    : visibleSessions;
  const nextThemeMode = getNextThemeMode(themeMode);
  const currentThemeMeta = THEME_META[themeMode];
  const nextThemeMeta = THEME_META[nextThemeMode];
  const currentThemeLabel = t(`settings.themeNames.${themeMode}`, currentThemeMeta.label);
  const nextThemeLabel = t(`settings.themeNames.${nextThemeMode}`, nextThemeMeta.label);
  const isCliSurface = location.pathname.startsWith('/cli');

  const handleQuickThemeSwitch = () => {
    setThemeMode(nextThemeMode);
    saveThemeMut.mutate(nextThemeMode);
  };

  // 统一渲染——单一 <aside> 元素保证 DOM 不卸载重建，避免白屏
  return (
    <TooltipProvider>
      <aside
        ref={asideRef as React.RefObject<HTMLElement>}
        className={clsx(
          'relative z-10 flex h-full flex-col border-r border-border-subtle bg-surface-sidebar transition-[width] duration-200',
          sidebarCollapsed ? 'w-12 overflow-hidden' : ''
        )}
      >
        {sidebarCollapsed ? (
          /* 折叠态：icon-only 竖排 */
          <div className={clsx('flex h-full min-h-0 flex-col items-center py-2.5', isCliSurface && 'bg-surface-sidebar')}>
            <Tooltip content={t('sidebar.expandSidebar', '展开侧边栏')} side="right">
              <button
                onClick={toggleSidebar}
                aria-label={t('sidebar.expandSidebar', '展开侧边栏')}
                className={clsx(
                  'rounded-xl p-2 transition-colors',
                  isCliSurface
                    ? 'text-text-dim hover:bg-surface-card hover:text-text'
                    : 'text-text-dim hover:bg-surface-soft'
                )}
              >
                <IconLayoutSidebarLeftExpand size={17} />
              </button>
            </Tooltip>
            <ScrollArea
              data-testid="sidebar-collapsed-scroll-region"
              className="min-h-0 flex-1 w-full"
              viewportClassName="h-full w-full"
            >
            <div className="flex w-full flex-col items-center gap-1 py-1.5">
              {COLLAPSED_PRIMARY_ITEMS.map((item) => {
                const active = isActive(item.path);
                return (
                  <Tooltip key={item.page} content={t(item.labelKey, item.fallbackLabel)} side="right">
                    <div className="relative flex w-full justify-center">
                      {active && (
                        <span className={clsx(
                          'absolute left-[5px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full',
                          isCliSurface ? 'bg-accent-hover' : 'bg-accent'
                        )} />
                      )}
                      <button
                        onClick={() => navigate(item.path)}
                        aria-label={t(item.labelKey, item.fallbackLabel)}
                        className={clsx(
                          'flex h-9 w-9 items-center justify-center rounded-xl border transition-all',
                          active
                            ? isCliSurface
                              ? 'border-accent/40 bg-surface-card text-accent-hover shadow-[inset_0_0_0_1px_rgba(107,138,254,0.14)]'
                              : 'border-accent/30 bg-accent/20 text-accent'
                            : isCliSurface
                              ? 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface-card hover:text-text'
                              : 'border-transparent text-text-dim hover:bg-surface-soft'
                        )}
                      >
                        {item.icon}
                      </button>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
            {pinnedSessions.length > 0 && (
              <>
                <Separator className={clsx('my-1 w-8', isCliSurface && 'bg-surface-sidebar')} />
                <div className="flex flex-col items-center gap-1">
                  {pinnedSessions.map((session) => {
                    const statusLabel = t(`sessions.status.${session.status}`, session.status);
                    const phaseLabel = session.phase ?? 'analysis';
                    const isCurrentSession = location.search.includes(session.sessionId);

                    return (
                      <Tooltip
                        key={session.sessionId}
                        side="right"
                        content={(
                          <div className="max-w-[220px] space-y-1">
                            <p className="text-xs font-semibold text-text">{session.businessName}</p>
                            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                              <span className="rounded-full border border-border-subtle px-1.5 py-0.5 uppercase tracking-wide">
                                {phaseLabel}
                              </span>
                              <span>{statusLabel}</span>
                            </div>
                          </div>
                        )}
                      >
                        <button
                          onClick={() => navigate(`/analyze?session=${session.sessionId}&resume=1`)}
                          aria-label={`${session.businessName} ${statusLabel}`}
                          className={clsx(
                            'relative rounded-lg border p-2 transition-colors',
                            isCurrentSession
                              ? 'border-accent/40 bg-accent/15 text-accent'
                              : 'border-border-subtle bg-surface-card text-text-dim hover:border-accent/30 hover:text-text'
                          )}
                        >
                          <SessionStatusIcon status={session.status} />
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </>
            )}
            {pinnedConversationRuns.length > 0 && (
              <>
                <Separator className={clsx('my-1 w-8', isCliSurface && 'bg-surface-sidebar')} />
                <div className="flex flex-col items-center gap-1">
                  {pinnedConversationRuns.map((run) => {
                    const route = getConversationRoute(run);
                    const surface = getConversationSurface(run);
                    if (!route || !surface) {
                      return null;
                    }
                    const isCurrentRun = location.search.includes(run.runId);

                    return (
                      <Tooltip
                        key={run.runId}
                        side="right"
                        content={(
                          <div className="max-w-[220px] space-y-1">
                            <p className="text-xs font-semibold text-text">{getConversationTitle(run)}</p>
                            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                              <span className="rounded-full border border-border-subtle px-1.5 py-0.5 uppercase tracking-wide">
                                {getConversationSurfaceLabel(surface)}
                              </span>
                              <span>{getConversationStatusLabel(run.status)}</span>
                            </div>
                          </div>
                        )}
                      >
                        <button
                          onClick={() => navigate(route)}
                          aria-label={`${getConversationTitle(run)} ${getConversationSurfaceLabel(surface)} ${getConversationStatusLabel(run.status)}`}
                          className={clsx(
                            'relative rounded-lg border p-2 transition-colors',
                            isCurrentRun
                              ? 'border-accent/40 bg-accent/15 text-accent'
                              : 'border-border-subtle bg-surface-card text-text-dim hover:border-accent/30 hover:text-text'
                          )}
                        >
                          <RunStatusIcon status={run.status} />
                          {ACTIVE_RUN_STATUSES.has(run.status) && (
                            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />
                          )}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </>
            )}
            </ScrollArea>
            {COLLAPSED_SECONDARY_ITEMS.map((item) => {
              const active = isActive(item.path);
              return (
                <Tooltip key={item.page} content={t(item.labelKey, item.fallbackLabel)} side="right">
                  <div className="relative flex w-full justify-center">
                    {active && (
                      <span className={clsx(
                        'absolute left-[5px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full',
                        isCliSurface ? 'bg-accent-hover' : 'bg-accent'
                      )} />
                    )}
                    <button
                      onClick={() => navigate(item.path)}
                      aria-label={t(item.labelKey, item.fallbackLabel)}
                      className={clsx(
                        'flex h-9 w-9 items-center justify-center rounded-xl border transition-all',
                        active
                          ? isCliSurface
                            ? 'border-accent/40 bg-surface-card text-accent-hover shadow-[inset_0_0_0_1px_rgba(107,138,254,0.14)]'
                            : 'border-accent/30 bg-accent/20 text-accent'
                          : isCliSurface
                            ? 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface-card hover:text-text'
                            : 'border-transparent text-text-dim hover:bg-surface-soft'
                      )}
                    >
                      {item.icon}
                    </button>
                  </div>
                </Tooltip>
              );
            })}
            <Separator className={clsx('mx-auto my-1 w-8', isCliSurface && 'bg-surface-sidebar')} />
            <Tooltip content={t('sidebar.toggleLanguage', '切换语言')} side="right">
              <button
                onClick={toggleLang}
                aria-label={t('sidebar.toggleLanguage', '切换语言')}
                className={clsx(
                  'rounded-xl p-2 transition-colors',
                  isCliSurface
                    ? 'text-text-muted hover:bg-surface-card hover:text-text'
                    : 'text-text-dim hover:bg-surface-soft'
                )}
              >
                <IconLanguage size={15} />
              </button>
            </Tooltip>
            <Tooltip
              content={t(
                'settings.quickTheme.title',
                `快速切换主题：当前 ${currentThemeLabel}，点击切到 ${nextThemeLabel}`,
                { current: currentThemeLabel, next: nextThemeLabel },
              )}
              side="right"
            >
              <button
                onClick={handleQuickThemeSwitch}
                aria-label={t('settings.quickTheme.label', '快速切换主题')}
                className={clsx(
                  'rounded-xl p-2 transition-colors',
                  isCliSurface
                    ? 'text-text-muted hover:bg-surface-card hover:text-text'
                    : 'text-text-dim hover:bg-surface-soft'
                )}
              >
                {saveThemeMut.isPending ? <IconLoader2 size={15} className="animate-spin" /> : <currentThemeMeta.Icon size={15} />}
              </button>
            </Tooltip>
          </div>
        ) : (
          /* 展开态：完整侧边栏 */
          <>
            {/* Header / Brand */}
            <div className="flex shrink-0 items-center gap-2.5 border-b border-border-subtle px-4 py-3.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/20">
                <IconShieldCheck size={15} className="text-accent" />
              </div>
              <span className="flex-1 truncate text-sm font-semibold tracking-wide text-text">Risk Agent</span>
              <button
                onClick={toggleSidebar}
                aria-label={t('sidebar.collapseSidebar', '折叠侧边栏')}
                className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-soft"
              >
                <IconLayoutSidebarLeftCollapse size={14} />
              </button>
            </div>

            {/* Primary Chat Action */}
            <div className="shrink-0 px-3 py-2.5">
              <button
                onClick={() => navigate('/chat')}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                  isActive('/chat')
                    ? 'bg-accent text-white shadow-lg shadow-black/20'
                    : 'bg-accent/15 text-accent hover:bg-accent/25'
                )}
              >
                <IconMessageForward size={15} />
                <span className="truncate">{t('nav.chat', '智能聊天')}</span>
              </button>
            </div>

            {/* Session History */}
            <div className="shrink-0 px-3 pb-1">
              <div className="flex items-center gap-1 rounded px-1 py-1">
                <button
                  onClick={() => setSessionsExpanded((v) => !v)}
                  className="flex flex-1 items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-dim"
                >
                  <IconClock size={11} />
                  <span className="flex-1 truncate text-left font-medium uppercase tracking-wider">
                    {t('nav.recentSessions', '历史会话')}
                  </span>
                  {sessionsExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                </button>
                <Tooltip content={t('nav.viewAllSessions', '查看全部会话')} side="right">
                  <button
                    onClick={() => navigate('/sessions')}
                    aria-label={t('nav.viewAllSessions', '查看全部会话')}
                    className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:text-accent"
                  >
                    <IconExternalLink size={11} />
                  </button>
                </Tooltip>
              </div>
              {sessionsExpanded && (
                <>
                  {/* 搜索框 */}
                  <div className="mb-1 flex items-center gap-1.5 rounded-lg border border-border/40 bg-surface-card/60 px-2 py-1">
                    <IconSearch size={10} className="shrink-0 text-text-subtle/60" />
                    <input
                      type="text"
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                      placeholder="搜索会话…"
                      className="flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-subtle/50"
                    />
                    {sessionSearch && (
                      <button onClick={() => setSessionSearch('')} aria-label="清空搜索" className="shrink-0 text-text-subtle/50 hover:text-text-dim">
                        <IconX size={9} />
                      </button>
                    )}
                  </div>
                  <ScrollArea className="max-h-40">
                    <div className="mt-0.5 space-y-0.5 pr-1">
                      {filteredConversationRuns.length === 0 && filteredSessions.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-text-muted">
                          {sessionSearch ? '未找到匹配的会话' : t('nav.noSessions', '暂无会话记录')}
                        </p>
                      ) : (
                        <>
                          {filteredConversationRuns.length > 0 && (
                            <>
                              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-[0.12em] text-text-subtle">
                                {t('nav.recentConversationRuns', '聊天 / CLI')}
                              </p>
                              {filteredConversationRuns.map((run) => (
                                <RecentRunItem
                                  key={run.runId}
                                  run={run}
                                  isActive={location.search.includes(run.runId)}
                                />
                              ))}
                            </>
                          )}
                          {filteredSessions.length > 0 && (
                            <>
                              {filteredConversationRuns.length > 0 && <Separator className="my-2" />}
                              <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.12em] text-text-subtle">
                                {t('nav.recentAnalysisSessions', '分析会话')}
                              </p>
                              {filteredSessions.slice(0, 15).map((session) => (
                                <SessionItem
                                  key={session.sessionId}
                                  session={session}
                                  isActive={location.search.includes(session.sessionId)}
                                />
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>

            {/* Divider */}
            <Separator className="mx-3 my-1 w-auto shrink-0" />

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto px-3 py-1">
              <div className="space-y-0.5">
                {SECONDARY_NAV_ITEMS.map((item) => (
                  <button
                    key={item.page}
                    onClick={() => navigate(item.path)}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive(item.path) ? 'bg-surface-soft text-text' : 'text-text-dim hover:bg-surface-card hover:text-text'
                    )}
                  >
                    <span className={isActive(item.path) ? 'text-accent' : ''}>{item.icon}</span>
                    <span className="truncate">{t(item.labelKey, item.fallbackLabel)}</span>
                  </button>
                ))}
              </div>
            </nav>

            {/* Footer */}
            <div className="shrink-0 flex items-center gap-2 border-t border-border-subtle px-3 py-2.5">
              <button
                onClick={toggleLang}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-soft hover:text-text-dim"
              >
                <IconLanguage size={13} />
                <span>{i18n.language === 'zh-CN' ? 'EN' : '中文'}</span>
              </button>
              <button
                onClick={handleQuickThemeSwitch}
                aria-label={t('settings.quickTheme.label', '快速切换主题')}
                title={t(
                  'settings.quickTheme.summary',
                  `当前 ${currentThemeLabel}，下一个 ${nextThemeLabel}`,
                  { current: currentThemeLabel, next: nextThemeLabel },
                )}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-soft hover:text-text-dim"
              >
                {saveThemeMut.isPending ? <IconLoader2 size={13} className="animate-spin" /> : <currentThemeMeta.Icon size={13} />}
                <span className="truncate">{currentThemeLabel}</span>
                <IconPalette size={12} />
              </button>
            </div>

            {/* Drag handle */}
            <div
              onMouseDown={onDragStart}
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-accent/30 active:bg-accent/50"
              aria-hidden="true"
            />
          </>
        )}
      </aside>
    </TooltipProvider>
  );
}
