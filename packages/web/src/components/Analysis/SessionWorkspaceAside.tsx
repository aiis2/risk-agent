import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
  IconLoader2,
  IconMessages,
  IconPlayerPlay,
  IconX,
} from '@tabler/icons-react';
import { ScrollArea } from '../ui/ScrollArea';

export interface WorkspaceAsideSession {
  sessionId: string;
  businessName: string;
  status?: string;
  phase?: string;
}

interface SessionWorkspaceAsideProps {
  activeSessionId: string | null;
  openSessions: WorkspaceAsideSession[];
  recentSessions: WorkspaceAsideSession[];
  totalSessionCount: number;
  onActivateSession: (sessionId: string) => void;
  onResumeSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

function statusTone(status?: string) {
  switch (status) {
    case 'running':
      return 'border-warn/20 bg-warn/10 text-warn';
    case 'completed':
      return 'border-success/20 bg-success/10 text-success';
    case 'error':
      return 'border-danger/20 bg-danger/10 text-danger';
    case 'cancelled':
      return 'border-border/30 bg-surface-soft text-text-muted';
    default:
      return 'border-border/30 bg-surface-soft text-text-muted';
  }
}

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'running':
      return <IconLoader2 size={12} className="animate-spin text-warn" />;
    case 'completed':
      return <IconCircleCheck size={12} className="text-success" />;
    case 'error':
      return <IconAlertTriangle size={12} className="text-danger" />;
    default:
      return <IconClock size={12} className="text-text-muted" />;
  }
}

function AsideSessionRow({
  session,
  active = false,
  onOpen,
  onClose,
  actionLabel,
}: {
  session: WorkspaceAsideSession;
  active?: boolean;
  onOpen: () => void;
  onClose?: () => void;
  actionLabel: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={clsx(
        'group flex items-start gap-2 rounded-2xl border px-3 py-3 transition-colors',
        active
          ? 'border-accent/25 bg-accent/8'
          : 'border-border/60 bg-surface-card/55 hover:border-accent/15 hover:bg-surface-card/70',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${actionLabel} ${session.businessName}`}
        aria-current={active ? 'page' : undefined}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2">
          <StatusIcon status={session.status} />
          <span className="truncate text-sm font-medium text-text">{session.businessName}</span>
          {active ? (
            <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
              {t('analysis.workspaceAside.current', '当前')}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
          {session.phase ? (
            <span className="rounded-full border border-border/50 bg-surface-soft px-2 py-0.5 uppercase tracking-[0.12em]">
              {session.phase}
            </span>
          ) : null}
          <span className={clsx('rounded-full border px-2 py-0.5', statusTone(session.status))}>
            {t(`sessions.status.${session.status ?? 'idle'}`, session.status ?? 'idle')}
          </span>
          <span className="font-mono">{session.sessionId.slice(0, 8)}…</span>
        </div>
      </button>

      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('analysis.workspaceAside.closeSession', '关闭会话 {{name}}', { name: session.businessName })}
          className="mt-0.5 rounded-lg p-1 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <IconX size={12} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('analysis.workspaceAside.quickOpenSession', '快速打开会话 {{name}}', { name: session.businessName })}
          className="mt-0.5 rounded-lg p-1 text-accent transition-colors hover:bg-accent/10"
        >
          <IconPlayerPlay size={12} />
        </button>
      )}
    </div>
  );
}

export function SessionWorkspaceAside({
  activeSessionId,
  openSessions,
  recentSessions,
  totalSessionCount,
  onActivateSession,
  onResumeSession,
  onCloseSession,
}: SessionWorkspaceAsideProps) {
  const { t } = useTranslation();
  const switchableOpenSessions = openSessions.filter((session) => session.sessionId !== activeSessionId);
  const runningCount = [...openSessions, ...recentSessions].filter((session, index, all) => {
    const firstIndex = all.findIndex((item) => item.sessionId === session.sessionId);
    return firstIndex === index && session.status === 'running';
  }).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-4 py-4">
        <p className="text-[11px] uppercase tracking-[0.24em] text-text-subtle">{t('analysis.workspaceAside.eyebrow', 'Session Workspace')}</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">{t('analysis.workspaceAside.title', '多会话工作台')}</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('analysis.workspaceAside.description', '在 analyze 内直接切换已打开会话与最近记录，减少往返 Sidebar 和 Sessions。')}</p>
          </div>
          <span className="rounded-full border border-border/60 bg-surface-soft px-3 py-1 text-[11px] text-text-muted">
            {t('analysis.workspaceAside.totalCount', '{{count}} 条', { count: totalSessionCount })}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-border/60 bg-surface-card/55 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">{t('analysis.workspaceAside.stats.open', 'Open')}</p>
            <p className="mt-1 text-base font-semibold text-text">{openSessions.length}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-surface-card/55 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">{t('analysis.workspaceAside.stats.running', 'Running')}</p>
            <p className="mt-1 text-base font-semibold text-warn">{runningCount}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-surface-card/55 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">{t('analysis.workspaceAside.stats.recent', 'Recent')}</p>
            <p className="mt-1 text-base font-semibold text-text">{recentSessions.length}</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-text">
                <IconMessages size={13} className="text-accent" />
                {t('analysis.workspaceAside.openSessions', '已打开会话')}
              </div>
              <span className="text-[10px] text-text-muted">{switchableOpenSessions.length}</span>
            </div>

            {switchableOpenSessions.length > 0 ? (
              <div className="space-y-2">
                {switchableOpenSessions.map((session) => (
                  <AsideSessionRow
                    key={session.sessionId}
                    session={session}
                    active={session.sessionId === activeSessionId}
                    onOpen={() => onActivateSession(session.sessionId)}
                    onClose={() => onCloseSession(session.sessionId)}
                    actionLabel={t('analysis.workspaceAside.switchToSession', '切换到会话')}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-surface-card/35 px-3 py-4 text-xs leading-5 text-text-muted">
                {t('analysis.workspaceAside.noOpenSessions', '当前没有其他已打开会话，开始更多分析后会自动出现在这里。')}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-text">
                <IconClock size={13} className="text-text-muted" />
                {t('analysis.workspaceAside.recentSessions', '最近会话')}
              </div>
              <span className="text-[10px] text-text-muted">{recentSessions.length}</span>
            </div>

            {recentSessions.length > 0 ? (
              <div className="space-y-2">
                {recentSessions.map((session) => (
                  <AsideSessionRow
                    key={session.sessionId}
                    session={session}
                    onOpen={() => onResumeSession(session.sessionId)}
                    actionLabel={t('analysis.workspaceAside.resumeSession', '恢复会话')}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-surface-card/35 px-3 py-4 text-xs leading-5 text-text-muted">
                {t('analysis.workspaceAside.noRecentSessions', '最近没有额外会话记录，当前分析会在完成后沉淀到这里。')}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}