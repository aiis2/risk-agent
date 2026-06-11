/**
 * ActivityLane — collapsible right sidebar showing live run events.
 * Displays route, execution, intervention, and outcome signals in a denser tool-workspace layout.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconBrain,
  IconChevronDown,
  IconCheck,
  IconClock,
  IconLoader2,
  IconRoute,
  IconSearch,
  IconSparkles,
  IconTool,
  IconX,
} from '@tabler/icons-react';
import type { ActivityEvent } from '../../hooks/useCliSession';
import { ScrollArea } from '../ui';

interface ActivityLaneProps {
  events: ActivityEvent[];
  isOpen: boolean;
  onToggle: () => void;
}

interface ActivitySection {
  id: string;
  title: string;
  hint: string;
  items: ActivityEvent[];
}

interface ActivitySummary {
  attention: number;
  interrupts: number;
  failed: number;
  results: number;
}

const ACTIVITY_COLLAPSE_STORAGE_KEY = 'risk-agent-cli-activity-collapsed';

const TYPE_ICON: Record<string, React.ReactNode> = {
  thinking_start: <IconBrain size={11} className="text-warn" />,
  thinking_complete: <IconBrain size={11} className="text-text-muted" />,
  interrupt_requested: <IconAlertTriangle size={11} className="text-warn" />,
  tool_start: <IconTool size={11} className="text-accent" />,
  tool_complete: <IconCheck size={11} className="text-success" />,
  tool_progress: <IconLoader2 size={11} className="animate-spin text-accent" />,
  subagent_start: <IconRoute size={11} className="text-accent" />,
  subagent_complete: <IconCheck size={11} className="text-text-dim" />,
  continuation_decision: <IconBrain size={11} className="text-accent" />,
  capability_switched: <IconRoute size={11} className="text-accent" />,
  waiting_user: <IconClock size={11} className="text-accent" />,
  user_input_received: <IconCheck size={11} className="text-accent" />,
  general_response_started: <IconSparkles size={11} className="text-accent" />,
  run_failed: <IconAlertTriangle size={11} className="text-danger" />,
  run_cancelled: <IconAlertTriangle size={11} className="text-warn" />,
  run_status: <IconSparkles size={11} className="text-text-muted" />,
  status_update: <IconSparkles size={11} className="text-text-muted" />,
  checkpoint: <IconCheck size={11} className="text-success" />,
};

const TASK_TYPES = new Set(['routed', 'plan_created', 'checkpoint_created', 'run_status', 'status_update', 'checkpoint']);
const EXECUTION_TYPES = new Set([
  'thinking_start',
  'thinking_complete',
  'interrupt_requested',
  'tool_start',
  'tool_complete',
  'tool_progress',
  'subagent_start',
  'subagent_complete',
  'continuation_decision',
  'capability_switched',
  'general_response_started',
  'agent_status',
]);
const INTERVENTION_TYPES = new Set(['waiting_user', 'user_input_received']);
const OUTCOME_TYPES = new Set(['artifact_updated', 'verifier_finished', 'run_completed', 'run_failed', 'run_cancelled']);

function getIcon(type: string): React.ReactNode {
  return TYPE_ICON[type] ?? <IconSparkles size={11} className="text-text-muted" />;
}

function relTime(ts: number): string {
  const delta = Math.floor((Date.now() - ts) / 1000);
  if (delta < 5) return 'now';
  if (delta < 60) return `${delta}s`;
  return `${Math.floor(delta / 60)}m`;
}

function getSectionId(type: string): ActivitySection['id'] | 'other' {
  if (INTERVENTION_TYPES.has(type)) return 'intervention';
  if (TASK_TYPES.has(type)) return 'task';
  if (EXECUTION_TYPES.has(type)) return 'execution';
  if (OUTCOME_TYPES.has(type)) return 'outcome';
  return 'other';
}

function badgeForActivity(type: string): { label: string; className: string } {
  if (type === 'waiting_user' || type === 'user_input_received') {
    return { label: 'attention', className: 'border-accent/30 bg-accent/10 text-accent/70' };
  }
  if (type === 'run_failed') {
    return { label: 'failed', className: 'border-danger/30 bg-danger/10 text-danger' };
  }
  if (type === 'run_cancelled' || type === 'interrupt_requested') {
    return { label: 'interrupt', className: 'border-warn/30 bg-warn/10 text-warn' };
  }
  if (type === 'verifier_finished' || type === 'artifact_updated' || type === 'run_completed') {
    return { label: 'result', className: 'border-success/30 bg-success/10 text-success' };
  }
  if (type === 'routed' || type === 'plan_created' || type === 'checkpoint_created') {
    return { label: 'task', className: 'border-accent/30 bg-accent/10 text-accent/70' };
  }
  return { label: 'live', className: 'border-border bg-surface-card text-text-dim' };
}

function matchesActivity(event: ActivityEvent, query: string): boolean {
  if (!query.trim()) return true;
  const normalized = query.trim().toLowerCase();
  return `${event.label} ${event.type}`.toLowerCase().includes(normalized);
}

function buildSections(events: ActivityEvent[], query: string): { latest: ActivityEvent | null; sections: ActivitySection[] } {
  const filtered = events.filter((event) => matchesActivity(event, query));
  const ordered = [...filtered].reverse();
  const [latest, ...rest] = ordered;
  const sections: ActivitySection[] = [
    {
      id: 'task',
      title: 'Task Flow',
      hint: 'Route, plan and checkpoints',
      items: rest.filter((event) => getSectionId(event.type) === 'task'),
    },
    {
      id: 'execution',
      title: 'Execution',
      hint: 'Tools, reasoning and agents',
      items: rest.filter((event) => getSectionId(event.type) === 'execution'),
    },
    {
      id: 'intervention',
      title: 'Intervention',
      hint: 'Prompts and replies',
      items: rest.filter((event) => getSectionId(event.type) === 'intervention'),
    },
    {
      id: 'outcome',
      title: 'Outcome',
      hint: 'Artifacts, verifier and completion',
      items: rest.filter((event) => getSectionId(event.type) === 'outcome'),
    },
    {
      id: 'other',
      title: 'Other Signals',
      hint: 'Unclassified runtime events',
      items: rest.filter((event) => getSectionId(event.type) === 'other'),
    },
  ].filter((section) => section.items.length > 0);

  return { latest: latest ?? null, sections };
}

function buildSummary(events: ActivityEvent[]): ActivitySummary {
  return events.reduce<ActivitySummary>((summary, event) => {
    if (event.type === 'waiting_user' || event.type === 'user_input_received') {
      summary.attention += 1;
    }
    if (event.type === 'interrupt_requested' || event.type === 'run_cancelled') {
      summary.interrupts += 1;
    }
    if (event.type === 'run_failed') {
      summary.failed += 1;
    }
    if (event.type === 'artifact_updated' || event.type === 'verifier_finished' || event.type === 'run_completed') {
      summary.results += 1;
    }
    return summary;
  }, { attention: 0, interrupts: 0, failed: 0, results: 0 });
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

export function ActivityLane({ events, isOpen, onToggle }: ActivityLaneProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => readCollapsedSections(ACTIVITY_COLLAPSE_STORAGE_KEY));
  const { latest, sections } = buildSections(events, filterQuery);
  const summary = useMemo(() => buildSummary(events), [events]);

  useEffect(() => {
    writeCollapsedSections(ACTIVITY_COLLAPSE_STORAGE_KEY, collapsedSections);
  }, [collapsedSections]);

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  return (
    <aside
      aria-label="Activity lane"
      aria-hidden={!isOpen}
      tabIndex={isOpen ? undefined : -1}
      className={`cli-rail-shell absolute inset-y-0 right-0 z-30 flex w-[332px] max-w-[86vw] flex-col overflow-hidden border-l backdrop-blur transition-all duration-200 ease-out ${
        isOpen ? 'pointer-events-auto visible translate-x-0 opacity-100' : 'pointer-events-none invisible translate-x-0 opacity-0'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
            Activity
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">Live routing, tools and checkpoints</div>
        </div>
        <div className="flex items-center gap-2">
          {events.length > 0 && (
            <span className="rounded-full border border-border-subtle bg-surface-card px-1.5 py-0.5 font-mono text-[10px] text-accent/70">
              {events.length}
            </span>
          )}
          {summary.attention > 0 && (
            <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent/70">
              attention {summary.attention}
            </span>
          )}
          {summary.failed > 0 && (
            <span className="rounded-full border border-danger/30 bg-danger/10 px-1.5 py-0.5 font-mono text-[10px] text-danger">
              failed {summary.failed}
            </span>
          )}
          {summary.interrupts > 0 && (
            <span className="rounded-full border border-warn/30 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] text-warn">
              interrupt {summary.interrupts}
            </span>
          )}
          {summary.results > 0 && (
            <span className="rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] text-success">
              result {summary.results}
            </span>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-border-subtle bg-surface-card text-text-dim transition-colors hover:border-accent/50 hover:text-text"
            title="Collapse activity"
            aria-label="Collapse activity lane"
          >
            <IconX size={12} />
          </button>
        </div>
      </div>

      {events.length > 0 && (
        <div className="border-b border-border-subtle px-4 py-3">
          <label className="flex items-center gap-2 rounded-[16px] border border-border-subtle bg-surface px-3 py-2 text-text-dim transition-colors focus-within:border-accent/50 focus-within:text-text">
            <IconSearch size={12} />
            <input
              type="text"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter activity"
              aria-label="Filter activity"
              className="flex-1 bg-transparent font-mono text-[11px] text-text placeholder-text-muted outline-none"
            />
          </label>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full w-full">
        <div className="flex min-h-full flex-col">
          {events.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cli-border bg-surface-card text-border">
                <IconSparkles size={18} />
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                No live activity
              </span>
              <span className="max-w-[220px] text-[12px] leading-5 text-text-muted">
                Routes, tool calls and checkpoints show up here once the current session starts emitting.
              </span>
            </div>
          ) : latest || sections.length > 0 ? (
            <div className="flex flex-col gap-4 px-4 py-4">
              {latest && (
                <section className="cli-rail-highlight rounded-[22px] border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent/70">
                        Latest Pulse
                      </div>
                      <div className="mt-1 text-[11px] text-text-muted">Most recent runtime signal</div>
                    </div>
                    <span className="rounded-full border border-accent/30 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-accent/70">
                      {relTime(latest.timestamp)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-start gap-3 rounded-[18px] border border-border-subtle bg-surface-card px-3 py-3">
                    <div className="mt-0.5 shrink-0">{getIcon(latest.type)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] leading-snug text-text">
                        {latest.label}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">
                        <span className={`rounded-full border px-1.5 py-0.5 ${badgeForActivity(latest.type).className}`}>
                          {badgeForActivity(latest.type).label}
                        </span>
                        <span>{latest.type.replace(/_/g, ' ')}</span>
                        <span>•</span>
                        <span>live</span>
                      </div>
                    </div>
                  </div>
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
                      {section.items.map((event, index) => {
                      const isFresh = index === 0;
                      const badge = badgeForActivity(event.type);
                      return (
                        <div
                          key={event.id}
                          className={`rounded-[18px] border px-3 py-3 transition-all duration-150 ${
                            isFresh
                              ? 'border-accent/30 bg-surface-card shadow-[0_12px_28px_rgba(2,6,23,0.22)]'
                              : 'border-border-subtle bg-surface hover:border-border hover:bg-surface-card'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 shrink-0">{getIcon(event.type)}</div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-[11px] leading-snug text-text">
                                {event.label}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-text-muted">
                                <span className={`rounded-full border px-1.5 py-0.5 ${badge.className}`}>
                                  {badge.label}
                                </span>
                                <span>{event.type.replace(/_/g, ' ')}</span>
                                <span>•</span>
                                <span>{relTime(event.timestamp)}</span>
                                {isFresh && (
                                  <>
                                    <span>•</span>
                                    <span className="text-accent/70">recent</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                      })}
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
                Try a different filter to inspect route, tool, or failure activity.
              </span>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
