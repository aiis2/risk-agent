import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  IconMessages,
  IconPlayerPlay,
  IconPlayerStop,
  IconArchive,
  IconRefresh,
  IconClock,
  IconBrain,
  IconTool,
  IconUserQuestion,
  IconCircleCheck,
  IconCircleX,
  IconAlertTriangle,
  IconSearch,
  IconLoader2,
  IconCurrencyDollar,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { archiveSession, cancelSession, listSessions, getSessionCost, type SessionSummary } from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Separator } from '../components/ui/Separator';
import { Tooltip, TooltipProvider } from '../components/ui/Tooltip';
import { useTranslation as useI18n } from 'react-i18next';

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusColor(s: string) {
  switch (s) {
    case 'running': return 'border-warn/20 bg-warn/15 text-warn';
    case 'completed': return 'border-success/20 bg-success/15 text-success';
    case 'error': return 'border-danger/20 bg-danger/15 text-danger';
    case 'cancelled': return 'border-border/30 bg-border/20 text-text-muted';
    case 'archived': return 'border-border/30 bg-surface-sidebar text-text-muted';
    default: return 'border-border/30 bg-surface-soft text-text-dim';
  }
}

function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  switch (status) {
    case 'running': return <IconLoader2 size={size} className="animate-spin text-warn" />;
    case 'completed': return <IconCircleCheck size={size} className="text-success" />;
    case 'error': return <IconCircleX size={size} className="text-danger" />;
    case 'cancelled': return <IconAlertTriangle size={size} className="text-text-muted" />;
    case 'archived': return <IconArchive size={size} className="text-text-muted" />;
    default: return <IconClock size={size} className="text-text-dim" />;
  }
}

function PhaseIcon({ phase }: { phase?: string }) {
  const sz = 12;
  switch (phase) {
    case 'prepare': return <IconClock size={sz} className="text-accent" />;
    case 'analysis': return <IconBrain size={sz} className="text-warn" />;
    case 'report': return <IconTool size={sz} className="text-success" />;
    case 'archive': return <IconArchive size={sz} className="text-text-muted" />;
    default: return null;
  }
}

// ─── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({
  session,
  onResume,
  onCancel,
  onArchive,
}: {
  session: SessionSummary;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const { t } = useI18n();
  const isRunning = session.status === 'running';
  const isDone = session.status === 'completed' || session.status === 'cancelled' || session.status === 'error';
  const isArchived = session.status === 'archived';

  const costQuery = useQuery({
    queryKey: ['session-cost', session.sessionId],
    queryFn: () => getSessionCost(session.sessionId),
    enabled: isDone || isRunning,
    staleTime: 30_000,
  });

  return (
    <div className={clsx(
      'group w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors',
      isArchived
        ? 'border-border-subtle bg-surface-sidebar opacity-60'
        : 'border-border-subtle bg-surface-card hover:border-border'
    )}>
      {/* Status icon */}
      <div className="shrink-0">
        <StatusIcon status={session.status} size={16} />
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">{session.businessName}</span>
          {session.phase && (
            <span className="flex items-center gap-1 text-[10px] text-text-dim">
              <PhaseIcon phase={session.phase} />
              {session.phase}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-mono text-text-muted">{session.sessionId.slice(0, 8)}…</span>
          <span className="text-[10px] text-text-muted">{session.createdAt}</span>
          {costQuery.data && (
            <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
              <IconCurrencyDollar size={9} className="text-warn" />
              {costQuery.data.totalUsd.toFixed(4)}
            </span>
          )}
        </div>
      </div>

      {/* Status badge */}
      <span className={clsx(
        'shrink-0 text-[10px] px-2 py-0.5 rounded-full border font-medium',
        statusColor(session.status)
      )}>
        {t(`sessions.status.${session.status}`, session.status)}
      </span>

      {/* Actions */}
      <TooltipProvider>
        <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(isDone || isRunning) && !isArchived && (
            <Tooltip content={t('sessions.resume', '恢复查看')} side="top">
              <button
                onClick={() => onResume(session.sessionId)}
                aria-label={t('sessions.resume', '恢复查看')}
                className="rounded-lg p-1.5 text-accent transition-colors hover:bg-accent/15"
              >
                <IconPlayerPlay size={13} />
              </button>
            </Tooltip>
          )}
          {isRunning && (
            <Tooltip content={t('sessions.cancel', '取消')} side="top">
              <button
                onClick={() => onCancel(session.sessionId)}
                aria-label={t('sessions.cancel', '取消')}
                className="rounded-lg p-1.5 text-danger transition-colors hover:bg-danger/10"
              >
                <IconPlayerStop size={13} />
              </button>
            </Tooltip>
          )}
          {isDone && !isArchived && (
            <Tooltip content={t('sessions.archive', '归档')} side="top">
              <button
                onClick={() => onArchive(session.sessionId)}
                aria-label={t('sessions.archive', '归档')}
                className="rounded-lg p-1.5 text-text-dim transition-colors hover:bg-surface-soft hover:text-text"
              >
                <IconArchive size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ sessions }: { sessions: SessionSummary[] }) {
  const { t } = useI18n();
  const counts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  const stats = [
    { label: t('sessions.allSessions', '全部'), value: sessions.length, color: 'text-text-dim' },
    { label: t('sessions.running', '运行中'), value: counts.running ?? 0, color: 'text-warn' },
    { label: t('sessions.completed', '已完成'), value: counts.completed ?? 0, color: 'text-success' },
    { label: t('sessions.error', '出错'), value: counts.error ?? 0, color: 'text-danger' },
  ];

  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface-sidebar px-5 py-3">
      <div className="flex items-center gap-4">
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="mr-2 text-border">|</span>}
          <span className={clsx('text-xl font-bold', s.color)}>{s.value}</span>
          <span className="text-xs text-text-muted">{s.label}</span>
        </div>
      ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Sessions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'archived'>('all');
  const [search, setSearch] = useState('');

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    refetchInterval: 30_000, // 降低轮询频率，依赖 WS 实时更新
  });

  // ─── WebSocket 实时会话状态订阅（session-lifecycle.md §5.2）────────
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    let cancelled = false;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // dev 环境中后端在 8787，前端在 5173 —— 复用 useAgentProgress 的同 host 策略
    const host = import.meta.env.DEV ? `${window.location.hostname}:8787` : window.location.host;
    const url = `${proto}://${host}/api/ws/sessions`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const event = JSON.parse(ev.data as string) as { type: string; sessionId?: string; session?: Partial<SessionSummary>; changes?: Partial<SessionSummary> };
        if (event.type === 'session_created' || event.type === 'session_updated' || event.type === 'session_archived' || event.type === 'session_phase_changed' || event.type === 'session_cost_updated') {
          // 有任何会话状态变化，刷新会话列表
          void qc.invalidateQueries({ queryKey: ['sessions'] });
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => { /* silently fail — REST polling is the fallback */ };

    return () => {
      cancelled = true;
      try { ws.close(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [qc]);

  const cancelMut = useMutation({
    mutationFn: cancelSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const archiveMut = useMutation({
    mutationFn: archiveSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const filtered = (sessions.data ?? []).filter((s) => {
    const matchFilter = filter === 'all' || s.status === filter ||
      (filter === 'completed' && (s.status === 'completed' || s.status === 'cancelled' || s.status === 'error'));
    const matchSearch = !search || s.businessName.toLowerCase().includes(search.toLowerCase()) ||
      s.sessionId.includes(search);
    return matchFilter && matchSearch;
  });

  const handleResume = (id: string) => {
    navigate(`/analyze?session=${id}&resume=1`);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border-subtle bg-surface-sidebar px-5 py-3 shrink-0">
        <IconMessages size={14} className="text-accent" />
        <h1 className="text-sm font-semibold text-text">{t('sessions.title', '会话管理')}</h1>
        <div className="flex-1" />
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['sessions'] })}
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-soft hover:text-text-dim"
          title={t('common.refresh', '刷新')}
        >
          <IconRefresh size={13} />
        </button>
      </div>

      {/* Stats */}
      {sessions.data && <StatsBar sessions={sessions.data} />}

      {/* Filter + Search bar */}
      <div className="flex items-center gap-3 border-b border-border-subtle bg-surface-sidebar px-5 py-2.5 shrink-0">
        {/* Filter tabs */}
        <div className="flex gap-1">
          {(['all', 'running', 'completed', 'archived'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                'px-2.5 py-1 rounded-lg text-xs transition-colors',
                filter === f
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-dim hover:bg-surface-soft'
              )}
            >
              {t(`sessions.filter.${f}`, f)}
            </button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-4 bg-border" />

        {/* Search */}
        <div className="flex max-w-xs flex-1 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-card px-2.5 py-1">
          <IconSearch size={12} className="text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sessions.search', '搜索会话…')}
            className="flex-1 bg-transparent text-xs text-text placeholder:text-text-muted outline-none"
          />
        </div>
      </div>

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="w-full px-5 py-4 space-y-2">
          {sessions.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
              <IconLoader2 size={16} className="animate-spin" />
              <span>{t('common.loading', '加载中…')}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <IconMessages size={32} className="text-border" />
              <p className="text-sm text-text-muted">
                {search ? t('sessions.noResults', '没有匹配的会话') : t('sessions.empty', '暂无会话记录')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 w-full">
            {filtered.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                onResume={handleResume}
                onCancel={(id) => cancelMut.mutate(id)}
                onArchive={(id) => archiveMut.mutate(id)}
              />
            ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom: ask_user pending indicator */}
      {(sessions.data ?? []).some((s) => s.status === 'running') && (
        <div className="shrink-0 border-t border-border-subtle bg-surface-sidebar px-5 py-2">
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <IconUserQuestion size={13} className="text-accent" />
            <span>
              {(sessions.data ?? []).filter((s) => s.status === 'running').length}{' '}
              {t('sessions.sessionsRunning', '个会话正在运行')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
