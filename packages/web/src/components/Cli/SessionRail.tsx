/**
 * SessionRail — collapsible right sidebar section showing recent sessions.
 * Allows click-to-resume.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconHistory,
  IconLoader2,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import { ScrollArea } from '../ui';

interface SessionRailProps {
  runs: Array<{ runId: string; title: string; status: string; updatedAt: string }>;
  currentRunId: string;
  onResume: (runId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

interface SessionSection {
  id: string;
  title: string;
  hint: string;
  items: Array<{ runId: string; title: string; status: string; updatedAt: string }>;
}

interface SessionSummary {
  waiting: number;
  running: number;
  failed: number;
}

const SESSION_COLLAPSE_STORAGE_KEY = 'risk-agent-cli-session-collapsed';

function relDate(iso: string): string {
  if (!iso) return '';
  try {
    const delta = (Date.now() - new Date(iso).getTime()) / 1000;
    if (delta < 60) return 'just now';
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86400)}d ago`;
  } catch {
    return '';
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <IconLoader2 size={10} className="animate-spin text-warn" />;
  if (status === 'completed') return <IconCheck size={10} className="text-success" />;
  if (status === 'failed') return <IconX size={10} className="text-danger" />;
  if (status === 'cancelled') return <IconAlertTriangle size={10} className="text-warn" />;
  if (status === 'waiting_user') return <IconClock size={10} className="text-accent" />;
  return <IconClock size={10} className="text-text-muted" />;
}

function statusLabel(status: string): string {
  if (status === 'waiting_user') return 'awaiting input';
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return status || 'idle';
}

function badgeForSession(status: string): { label: string; className: string } {
  if (status === 'waiting_user') return { label: 'attention', className: 'border-accent/30 bg-accent/10 text-accent/70' };
  if (status === 'running') return { label: 'live', className: 'border-warn/30 bg-warn/10 text-warn' };
  if (status === 'failed') return { label: 'failed', className: 'border-danger/30 bg-danger/10 text-danger' };
  if (status === 'cancelled') return { label: 'cancelled', className: 'border-warn/30 bg-warn/10 text-warn' };
  return { label: 'ready', className: 'border-success/30 bg-success/10 text-success' };
}

function matchesSession(
  run: SessionRailProps['runs'][number],
  query: string,
): boolean {
  if (!query.trim()) return true;
  const normalized = query.trim().toLowerCase();
  return `${run.title} ${run.runId} ${statusLabel(run.status)}`.toLowerCase().includes(normalized);
}

function buildSections(
  runs: SessionRailProps['runs'],
  currentRunId: string,
  query: string,
): {
  current: SessionRailProps['runs'][number] | null;
  sections: SessionSection[];
} {
  const selectedCurrent = runs.find((run) => run.runId === currentRunId) ?? null;
  const current = selectedCurrent && matchesSession(selectedCurrent, query) ? selectedCurrent : null;
  const remaining = runs.filter((run) => run.runId !== currentRunId && matchesSession(run, query));
  const sections: SessionSection[] = [
    {
      id: 'attention',
      title: 'Needs Input',
      hint: 'Paused and waiting on you',
      items: remaining.filter((run) => run.status === 'waiting_user'),
    },
    {
      id: 'active',
      title: 'Active Elsewhere',
      hint: 'Runs still in motion',
      items: remaining.filter((run) => run.status === 'running'),
    },
    {
      id: 'recent',
      title: 'Recent Runs',
      hint: 'Attach an earlier session',
      items: remaining.filter((run) => run.status !== 'waiting_user' && run.status !== 'running'),
    },
  ].filter((section) => section.items.length > 0);

  return { current, sections };
}

function buildSummary(runs: SessionRailProps['runs']): SessionSummary {
  return runs.reduce<SessionSummary>((summary, run) => {
    if (run.status === 'waiting_user') {
      summary.waiting += 1;
    }
    if (run.status === 'running') {
      summary.running += 1;
    }
    if (run.status === 'failed') {
      summary.failed += 1;
    }
    return summary;
  }, { waiting: 0, running: 0, failed: 0 });
}

function readCollapsedSections(storageKey: string): Record<string, boolean> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function writeCollapsedSections(storageKey: string, value: Record<string, boolean>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

export function SessionRail({
  runs,
  currentRunId,
  onResume,
  isOpen,
  onToggle,
}: SessionRailProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => readCollapsedSections(SESSION_COLLAPSE_STORAGE_KEY));
  const { current, sections } = buildSections(runs, currentRunId, filterQuery);
  const summary = useMemo(() => buildSummary(runs), [runs]);

  useEffect(() => {
    writeCollapsedSections(SESSION_COLLAPSE_STORAGE_KEY, collapsedSections);
  }, [collapsedSections]);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  return (
    <aside
      aria-label="Session history rail"
      aria-hidden={!isOpen}
      tabIndex={isOpen ? undefined : -1}
      className={`cli-rail-shell absolute inset-y-0 right-0 z-30 flex w-[332px] max-w-[86vw] flex-col overflow-hidden border-l backdrop-blur transition-all duration-200 ease-out ${
        isOpen ? 'pointer-events-auto visible translate-x-0 opacity-100' : 'pointer-events-none invisible translate-x-0 opacity-0'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
            Sessions
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">Recent runs ready to attach</div>
        </div>
        <div className="flex items-center gap-2">
          {summary.waiting > 0 && (
            <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent/70">
              waiting {summary.waiting}
            </span>
          )}
          {summary.running > 0 && (
            <span className="rounded-full border border-warn/30 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] text-warn">
              running {summary.running}
            </span>
          )}
          {summary.failed > 0 && (
            <span className="rounded-full border border-danger/30 bg-danger/10 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              failed {summary.failed}
            </span>
          )}
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-border-subtle bg-surface-card text-text-dim transition-colors hover:border-accent/50 hover:text-text"
          title="Collapse sessions"
          aria-label="Collapse session history"
        >
          <IconX size={12} />
        </button>
        </div>
      </div>

      {runs.length > 0 && (
        <div className="border-b border-border-subtle px-4 py-3">
          <label className="flex items-center gap-2 rounded-[16px] border border-border-subtle bg-surface px-3 py-2 text-text-dim transition-colors focus-within:border-accent/50 focus-within:text-text">
            <IconSearch size={12} />
            <input
              type="text"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter sessions"
              aria-label="Filter sessions"
              className="flex-1 bg-transparent font-mono text-[11px] text-text placeholder-text-muted outline-none"
            />
          </label>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full w-full">
        <div className="flex min-h-full flex-col">
          {runs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cli-border bg-surface-card text-border">
                <IconHistory size={18} />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                No saved sessions
              </span>
              <span className="max-w-[220px] text-[12px] leading-5 text-text-muted">
                Completed or paused runs appear here so you can reopen the same terminal context.
              </span>
            </div>
          ) : current || sections.length > 0 ? (
            <div className="flex flex-col gap-4 px-4 py-4">
              {current && (
                <section className="cli-rail-highlight rounded-[22px] border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent/70">
                        Current Session
                      </div>
                      <div className="mt-1 text-[11px] text-text-muted">Attached terminal context</div>
                    </div>
                    <span className="rounded-full border border-accent/30 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent/70">
                      live
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onResume(current.runId)}
                    title={`Resume: ${current.title}`}
                    className="mt-3 flex w-full items-start gap-3 rounded-[18px] border border-border-subtle bg-surface-card px-3 py-3 text-left transition-all hover:border-accent/50 hover:bg-surface-hover"
                  >
                    <div className="mt-0.5 shrink-0">
                      <StatusIcon status={current.status} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] text-text">{current.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">
                        <span className={`rounded-full border px-1.5 py-0.5 ${badgeForSession(current.status).className}`}>
                          {badgeForSession(current.status).label}
                        </span>
                        <span>{statusLabel(current.status)}</span>
                        <span>•</span>
                        <span>{current.runId.slice(-6)}</span>
                        <span>•</span>
                        <span>{relDate(current.updatedAt)}</span>
                      </div>
                    </div>
                  </button>
                </section>
              )}

              {sections.map((section) => (
                <section key={section.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-label={`Toggle ${section.title} section`}
                    className="flex w-full items-center gap-2 rounded-[14px] px-1 py-1 text-left transition-colors hover:bg-surface-card"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-dim">
                      {section.title}
                    </span>
                    <span className="rounded-full border border-border-subtle bg-surface-card px-1.5 py-0.5 font-mono text-[9px] text-text-dim">
                      {section.items.length}
                    </span>
                    <span className="truncate text-[11px] text-text-muted">{section.hint}</span>
                    <IconChevronDown
                      size={14}
                      className={`ml-auto text-text-muted transition-transform ${collapsedSections[section.id] ? '-rotate-90' : 'rotate-0'}`}
                    />
                  </button>
                  {!collapsedSections[section.id] && (
                    <div className="space-y-2">
                      {section.items.map((run, index) => (
                      <button
                        key={run.runId}
                        type="button"
                        onClick={() => onResume(run.runId)}
                        title={`Resume: ${run.title}`}
                        className={`w-full rounded-[18px] border px-3 py-3 text-left transition-all ${
                          index === 0
                            ? 'border-accent/30 bg-surface-card shadow-[0_12px_28px_rgba(2,6,23,0.22)] hover:border-accent/50'
                            : 'border-border-subtle bg-surface hover:border-border hover:bg-surface-card'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <StatusIcon status={run.status} />
                          <span className="flex-1 truncate font-mono text-[11px] text-text">{run.title}</span>
                          <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] ${badgeForSession(run.status).className}`}>
                            {badgeForSession(run.status).label}
                          </span>
                          {index === 0 && (
                            <span className="rounded-full border border-accent/30 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent/70">
                              recent
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">
                          <span>{statusLabel(run.status)}</span>
                          <span>•</span>
                          <span>{run.runId.slice(-6)}</span>
                          <span>•</span>
                          <span>{relDate(run.updatedAt)}</span>
                        </div>
                      </button>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cli-border bg-surface-card text-border">
                <IconSearch size={18} />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                No matches
              </span>
              <span className="max-w-[220px] text-[12px] leading-5 text-text-muted">
                Try a different filter to locate waiting, failed, or historical sessions.
              </span>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
