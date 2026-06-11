import { useEffect, useMemo, useState } from 'react';
import type { RunArtifactRecord, RunSummary, RunTimelineEvent } from '../../api/client';
import {
  IconAlertTriangle,
  IconBrain,
  IconChecks,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconClockPause,
  IconCode,
  IconCopy,
  IconDatabase,
  IconFile,
  IconFileAnalytics,
  IconFlask,
  IconLoader2,
  IconMessageForward,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconRoute,
  IconRobot,
  IconSparkles,
  IconStack2,
  IconTool,
  IconUser,
  IconZoomIn,
} from '@tabler/icons-react';
import { ResponseContent } from '../Chat/responseContent';
import { StructuredAnswerSurface, readStructuredAnswer } from './StructuredAnswerSurface';
import { buildSandboxDetailLines, summarizeSandboxInline } from '../../lib/sandboxDisplay';

type TimelineGroup = TimelineSetupGroup | TimelineUserGroup | TimelineAssistantGroup;

interface ResearchDimension {
  id: string;
  dimension: string;
  displayName: string;
  status: 'started' | 'completed' | 'aggregating' | 'skipped';
}

interface TimelineSetupGroup {
  kind: 'setup';
  id: string;
  at: string;
  items: TimelineItem[];
  researchDimensions?: ResearchDimension[];
}

interface TimelineUserGroup {
  kind: 'user';
  id: string;
  at: string;
  title: string;
  content: string;
  meta: string[];
}

interface TimelineAssistantGroup {
  kind: 'assistant';
  id: string;
  at: string;
  items: TimelineItem[];
  summary?: AssistantSummary;
  researchDimensions?: ResearchDimension[];
}

interface AssistantSummary {
  artifact?: {
    artifactId?: string;
    label: string;
    preview: string;
    fullContent?: string;
    kind?: string;
    /** Raw parsed content object (for structured rendering without re-parse) */
    contentJson?: unknown;
  };
  metrics?: Array<{
    label: string;
    value: string;
  }>;
}

type TimelineItemKind = 'default' | 'tool' | 'subagent' | 'routing' | 'knowledge' | 'artifact' | 'completion' | 'status' | 'waiting' | 'error';

interface TimelineItem {
  id: string;
  label: string;
  detail?: string;
  tone: 'default' | 'success' | 'warning' | 'danger';
  kind?: TimelineItemKind;
  sourceType?: string;
  artifactId?: string;
  artifactVersion?: number;
  // For status grouping: collapsed items are folded into a parent
  collapsedItems?: Array<{ id: string; label: string }>;
  /** For waiting_user: the AG2U request ID used to submit the answer */
  waitingRequestId?: string;
  /** For waiting_user: available answer options */
  waitingOptions?: string[];
}

const USER_EVENT_TYPES = new Set(['user_message', 'user_input_received']);
const HEAVY_GENERAL_EVENT_TYPES = new Set([
  'knowledge_query_started',
  'knowledge_query_completed',
  'tool_start',
  'tool_progress',
  'tool_complete',
  'tool_error',
  'subagent_spawned',
  'subagent_complete',
  'waiting_user',
]);
const LIGHTWEIGHT_GENERAL_HIDDEN_ASSISTANT_ITEM_TYPES = new Set([
  'plan_created',
  'general_response_started',
  'verifier_finished',
  'run_completed',
]);

// ── Report artifact inline preview ─────────────────────────────────────────

interface ReportScenario {
  name: string;
  coverage: number;
  missing: string[];
}

interface ParsedReportData {
  businessName?: string;
  overallScore?: number;
  scenarios: ReportScenario[];
}

function parseReportFromObject(data: unknown): ParsedReportData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const hasReportFields = 'businessName' in d || 'overallScore' in d || 'coverageMatrix' in d;
  if (!hasReportFields) return null;
  const businessName = typeof d.businessName === 'string' ? d.businessName : undefined;
  const overallScore = typeof d.overallScore === 'number' ? d.overallScore : undefined;
  const matrixRaw = d.coverageMatrix;
  const scenarios: ReportScenario[] = [];
  if (Array.isArray(matrixRaw)) {
    for (const entry of matrixRaw) {
      if (typeof entry !== 'object' || !entry) continue;
      const e = entry as Record<string, unknown>;
      const name = typeof e.scenarioName === 'string' ? e.scenarioName : '';
      const coverage = typeof e.coveragePercent === 'number' ? e.coveragePercent : 0;
      const missing = Array.isArray(e.missingRuleTypes)
        ? (e.missingRuleTypes as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      if (name) scenarios.push({ name, coverage, missing });
    }
  }
  return { businessName, overallScore, scenarios };
}

function ReportInlinePreview({
  contentJson,
  fullContent,
  onSwitchToArtifacts,
}: {
  contentJson?: unknown;
  fullContent?: string;
  onSwitchToArtifacts?: () => void;
}) {
  const data = useMemo(() => parseReportFromObject(contentJson), [contentJson]);

  if (!data) {
    return (
      <pre className="whitespace-pre-wrap text-[10.5px] leading-relaxed text-text-muted">
        {fullContent ?? '（无内容）'}
      </pre>
    );
  }

  const scoreColor =
    data.overallScore !== undefined
      ? data.overallScore >= 80
        ? 'text-success'
        : data.overallScore >= 60
          ? 'text-warning'
          : 'text-danger'
      : 'text-text-muted';

  return (
    <div className="space-y-3">
      {/* Score + business name */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {data.businessName && (
            <p className="truncate text-[12px] font-semibold text-text">{data.businessName}</p>
          )}
          {data.scenarios.length > 0 && (
            <p className="mt-px text-[10px] text-text-subtle/60">{data.scenarios.length} 个场景</p>
          )}
        </div>
        {data.overallScore !== undefined && (
          <div className="shrink-0 text-right">
            <p className={`text-[26px] font-bold tabular-nums leading-none ${scoreColor}`}>
              {data.overallScore}
            </p>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-text-subtle/50">综合得分</p>
          </div>
        )}
      </div>

      {/* Scenario coverage rows */}
      {data.scenarios.length > 0 && (
        <div className="space-y-1.5">
          {data.scenarios.map((s) => {
            const sColor =
              s.coverage >= 80
                ? 'text-success'
                : s.coverage >= 60
                  ? 'text-warning'
                  : 'text-danger';
            const barColor =
              s.coverage >= 80 ? 'bg-success' : s.coverage >= 60 ? 'bg-warning' : 'bg-danger';
            return (
              <div key={s.name}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{s.name}</span>
                  <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${sColor}`}>
                    {s.coverage}%
                  </span>
                </div>
                {/* Mini progress bar — width set imperatively to avoid inline style lint */}
                <div className="mt-0.5 h-[2px] w-full overflow-hidden rounded-full bg-border/30">
                  <div
                    className={`h-full rounded-full ${barColor}`}
                    ref={(el) => { if (el) el.style.width = `${Math.min(100, s.coverage)}%`; }}
                  />
                </div>
                {s.missing.length > 0 && (
                  <p className="mt-0.5 text-[10px] text-text-subtle/50">
                    缺少: {s.missing.slice(0, 3).join('、')}{s.missing.length > 3 ? '…' : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Switch to full report */}
      {onSwitchToArtifacts && (
        <button
          type="button"
          onClick={onSwitchToArtifacts}
          className="flex items-center gap-1 text-[11px] text-accent/70 transition-colors hover:text-accent"
        >
          <IconChevronRight size={10} />
          查看完整报告
        </button>
      )}
    </div>
  );
}

const MODE_LABELS: Record<string, string> = {
  'stop-and-send': 'Stop and send',
  queue: 'Queued follow-up',
  steer: 'Steer current run',
};

// ── Animated typing dots (like LangAlpha) ──────────────────────────────────
function AnimatedTypingDots() {
  return (
    <span className="inline-flex items-end gap-[3px] ml-1 translate-y-[1px]">
      <span className="inline-block h-[3px] w-[3px] rounded-full bg-accent/50 animate-bounce" />
      <span className="inline-block h-[3px] w-[3px] rounded-full bg-accent/50 animate-bounce [animation-delay:0.15s]" />
      <span className="inline-block h-[3px] w-[3px] rounded-full bg-accent/50 animate-bounce [animation-delay:0.3s]" />
    </span>
  );
}

// ── harness-console: raw event log view ────────────────────────────────────
/**
 * HarnessConsoleTimeline renders raw harness events in a terminal-style log.
 *
 * Design interface for the upcoming harness-console CLI integration.
 * Activated via `consoleMode={true}` on RunTimeline.
 *
 * @future Extend with filtering, search, copy-to-clipboard, and ANSI colour
 *         rendering when CLI dev begins (see docs/architecture/agent-framework.md).
 */
function HarnessConsoleTimeline({ events }: { events: RunTimelineEvent[] }) {
  const [filter, setFilter] = useState('');
  const filtered = filter.trim()
    ? events.filter((e) => e.type.includes(filter.trim()))
    : events;
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-surface-sidebar font-mono">
      {/* Terminal title bar */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-surface-sidebar px-3 py-1.5">
        <span className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-danger/50" />
          <span className="h-2 w-2 rounded-full bg-warning/50" />
          <span className="h-2 w-2 rounded-full bg-success/50" />
        </span>
        <span className="flex-1 text-center text-[10px] tracking-[0.18em] text-text-subtle/40 select-none">
          运行事件流
        </span>
        <span className="text-[10px] tabular-nums text-text-subtle/35">{events.length}</span>
      </div>
      {/* Filter bar */}
      <div className="border-b border-border/30 px-3 py-1.5">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="按事件类型筛选…"
          className="w-full bg-transparent text-[11px] text-text-muted placeholder:text-text-subtle/30 outline-none"
        />
      </div>
      {/* Event rows */}
      <div className="max-h-[520px] overflow-y-auto p-3 text-[11px] leading-[1.65]">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-text-subtle/25">
            {events.length === 0 ? '等待事件写入…' : '没有匹配当前筛选条件的事件'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((event, idx) => {
              const ts = event.createdAt
                ? new Date(event.createdAt).toISOString().slice(11, 23)
                : '??:??:??.???';
              const payload = formatConsoleEventPayload(event);
              return (
                <div key={event.eventId ?? idx} className="group flex gap-2">
                  <span className="w-5 shrink-0 select-none text-right text-text-subtle/20 group-hover:text-text-subtle/45">
                    {idx + 1}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-subtle/30">{ts}</span>
                  <span className="w-40 shrink-0 truncate text-accent/60">{event.type}</span>
                  {payload && (
                    <span className="min-w-0 truncate text-text-subtle/45">{payload}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function RunTimeline({
  events,
  run,
  artifacts = [],
  onSwitchToArtifacts,
  onResendUserMessage,
  onSubmitApproval,
  consoleMode = false,
}: {
  events: RunTimelineEvent[];
  run?: RunSummary;
  artifacts?: RunArtifactRecord[];
  /** Called when user clicks "view full report" in an artifact summary band. */
  onSwitchToArtifacts?: () => void;
  onResendUserMessage?: (content: string) => void;
  /** Called when user approves/rejects an inline AG2U decision card. */
  onSubmitApproval?: (requestId: string, option: string) => void;
  /** @future harness-console: toggle raw event log view */
  consoleMode?: boolean;
}) {
  const isRunning = Boolean(run && !['completed', 'failed', 'cancelled'].includes(run.status));

  // harness-console: render raw event log when consoleMode is enabled
  if (consoleMode) {
    return <HarnessConsoleTimeline events={events} />;
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-surface-card text-text-muted">
          {isRunning ? <IconLoader2 size={18} className="animate-spin text-accent" /> : <IconRobot size={18} />}
        </span>
        <p className="text-sm text-text-muted">
          {isRunning ? 'Agent 正在初始化...' : '等待 Agent 开始运行...'}
        </p>
      </div>
    );
  }

  const groups = buildTimelineGroups(events, run, artifacts);
  const latestUserGroupIndex = [...groups]
    .map((group, index) => ({ group, index }))
    .reverse()
    .find((entry) => entry.group.kind === 'user')?.index ?? -1;

  return (
    <ol className="space-y-1.5 py-1 pr-1">
      {groups.map((group, groupIdx) => {
        const isLastGroup = groupIdx === groups.length - 1;
        if (group.kind === 'setup') {
          return <SetupGroupCard key={group.id} group={group} />;
        }
        if (group.kind === 'user') {
          return (
            <UserGroupCard
              key={group.id}
              group={group}
              canResend={Boolean(onResendUserMessage) && groupIdx === latestUserGroupIndex}
              onResend={onResendUserMessage}
            />
          );
        }
        return (
          <AssistantGroupCard
            key={group.id}
            group={group}
            onSwitchToArtifacts={onSwitchToArtifacts}
            isLastGroup={isLastGroup}
            isRunning={isRunning}
            runStatus={run?.status}
            onSubmitApproval={onSubmitApproval}
          />
        );
      })}
      {isRunning && (
        <li className="flex items-center gap-2 py-1 pl-2 text-[11px]">
          <span className="relative inline-flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent/80" />
          </span>
          <span className="text-accent/70">Agent 正在运行…</span>
        </li>
      )}
    </ol>
  );
}

function SetupGroupCard({ group }: { group: TimelineSetupGroup }) {
  const [open, setOpen] = useState(false);
  const hasDims = (group.researchDimensions?.length ?? 0) > 0;
  const allDone = hasDims && group.researchDimensions!.every((d) => d.status === 'completed' || d.status === 'skipped');
  const stepCount = group.items.length + (group.researchDimensions?.length ?? 0);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-[11px] text-text-subtle transition-colors hover:bg-surface-card/40"
      >
        <span className="inline-flex h-4.5 w-4.5 items-center justify-center text-text-subtle/60">
          <IconPlayerPlay size={9} className="fill-current" />
        </span>
        <span className="font-medium tracking-[0.12em] text-text-subtle/80">初始化</span>
        <span className="ml-0.5 text-text-subtle/50">{formatEventTime(group.at)}</span>
        {stepCount > 0 && (
          <span className="rounded-full border border-border/40 px-1.5 py-px text-[10px] text-text-subtle/60">{stepCount}</span>
        )}
        {hasDims && (
          <span className={`rounded-full px-1.5 py-px text-[10px] border ${allDone ? 'border-success/30 bg-success/8 text-success/80' : 'border-accent/20 bg-accent/6 text-accent/70'}`}>
            {allDone ? '研究完成' : '研究中'}
          </span>
        )}
        <span className="ml-auto text-text-subtle/40">
          {open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
        </span>
      </button>
      {open && (
        <div className="mt-1 ml-7 border-l border-border/50 pl-3">
          {hasDims && (
            <ResearchProgressPanel dimensions={group.researchDimensions!} />
          )}
          {group.items.length > 0 && (
            <div className="space-y-0.5 py-1">
              {group.items.map((item) => (
                <CompactStep key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ResearchProgressPanel({ dimensions }: { dimensions: ResearchDimension[] }) {
  const getConfig = (status: ResearchDimension['status']) => {
    switch (status) {
      case 'started': return { icon: <IconLoader2 size={11} className="animate-spin" />, color: 'text-accent border-accent/30 bg-accent/10', progressWidth: 'w-1/3' };
      case 'aggregating': return { icon: <IconFlask size={11} />, color: 'text-warning border-warning/30 bg-warning/10', progressWidth: 'w-2/3' };
      case 'completed': return { icon: <IconCircleCheck size={11} />, color: 'text-success border-success/30 bg-success/10', progressWidth: 'w-full' };
      case 'skipped': return { icon: <IconChecks size={11} />, color: 'text-text-subtle border-border bg-surface-card/50', progressWidth: 'w-full' };
    }
  };
  const allDone = dimensions.every((d) => d.status === 'completed' || d.status === 'skipped');

  return (
    <div className="py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-text-subtle mb-1.5">
        <IconBrain size={11} />
        <span className="uppercase tracking-widest">研究进度</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {dimensions.map((dim) => {
          const cfg = getConfig(dim.status);
          const fillColor = dim.status === 'completed' ? 'bg-success' : dim.status === 'aggregating' ? 'bg-warning' : dim.status === 'skipped' ? 'bg-border' : 'bg-accent';
          return (
            <div
              key={dim.dimension}
              className={`relative flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${cfg.color} overflow-hidden`}
            >
              {/* Progress fill bar */}
              <div className={`absolute inset-0 opacity-20 transition-all duration-700 ${fillColor} ${cfg.progressWidth}`} />
              <span className="relative z-10">{cfg.icon}</span>
              <span className="relative z-10 font-medium truncate">{dim.displayName}</span>
            </div>
          );
        })}
      </div>
      {allDone && (
        <div className="flex items-center gap-1.5 text-[11px] text-success mt-1">
          <IconChecks size={12} />
          <span>所有维度研究完毕</span>
        </div>
      )}
    </div>
  );
}

function getModeMetaIcon(modeMeta: string) {
  if (modeMeta.includes('停止') || modeMeta.includes('Stop')) return <IconPlayerStop size={9} />;
  if (modeMeta.includes('队列') || modeMeta.includes('Queue') || modeMeta.includes('Queued')) return <IconStack2 size={9} />;
  if (modeMeta.includes('引导') || modeMeta.includes('Steer')) return <IconRoute size={9} />;
  return <IconMessageForward size={9} />;
}

function UserGroupCard({
  group,
  canResend = false,
  onResend,
}: {
  group: TimelineUserGroup;
  canResend?: boolean;
  onResend?: (content: string) => void;
}) {
  // Separate send-mode label from other meta (attachments, tools, etc.)
  const modeValues = new Set(Object.values(MODE_LABELS));
  const modeMeta = group.meta.find(m => modeValues.has(m) || m === 'Intervention reply');
  const otherMeta = group.meta.filter(m => m !== modeMeta);
  const [copied, setCopied] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);

  const handleCopy = () => {
    const clipboard = window.navigator?.clipboard;
    if (!clipboard?.writeText) return;

    void clipboard.writeText(group.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };

  return (
    <li
      className="flex justify-end py-0.5"
      onMouseOver={() => setActionsVisible(true)}
      onMouseLeave={() => setActionsVisible(false)}
    >
      <div className="relative max-w-[80%] pb-7">
        <div className="flex items-center justify-end gap-2 mb-1">
          {modeMeta && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border/30 bg-surface-card/50 px-2 py-px text-[10px] text-text-subtle/60">
              {getModeMetaIcon(modeMeta)}
              {modeMeta}
            </span>
          )}
          <time className="text-[10px] text-text-subtle/50">{formatEventTime(group.at)}</time>
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-accent">
            <IconUser size={11} />
          </span>
        </div>
        <div className="rounded-2xl rounded-tr-sm border border-accent/20 bg-surface-card px-4 py-2.5 shadow-[0_1px_8px_rgba(107,138,254,0.06)]">
          <p className="whitespace-pre-wrap text-[13px] leading-[1.65] text-text">{group.content}</p>
          {otherMeta.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {otherMeta.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-full border border-accent/15 bg-accent/8 px-2 py-px text-[10px] text-accent/70"
                >
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
        {actionsVisible ? (
          <div className="absolute bottom-0 right-0 flex h-6 items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="复制用户消息"
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition-colors ${copied ? 'border-success/25 bg-success/10 text-success' : 'border-border/35 bg-surface-card/45 text-text-subtle/70 hover:border-accent/20 hover:text-text'}`}
            >
              {copied ? <IconCircleCheck size={10} /> : <IconCopy size={10} />}
              {copied ? '已复制' : '复制'}
            </button>
            {canResend && onResend ? (
              <button
                type="button"
                onClick={() => onResend(group.content)}
                aria-label="重新发送用户消息"
                className="inline-flex items-center gap-1 rounded-full border border-border/35 bg-surface-card/45 px-2.5 py-1 text-[10px] text-text-subtle/70 transition-colors hover:border-accent/20 hover:text-text"
              >
                <IconRefresh size={10} />
                重新发送
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function AssistantGroupCard({
  group,
  onSwitchToArtifacts,
  isLastGroup = false,
  isRunning = false,
  runStatus,
  onSubmitApproval,
}: {
  group: TimelineAssistantGroup;
  onSwitchToArtifacts?: () => void;
  isLastGroup?: boolean;
  isRunning?: boolean;
  runStatus?: string;
  onSubmitApproval?: (requestId: string, option: string) => void;
}) {
  const [groupOpen, setGroupOpen] = useState(true);

  // Separate high-signal from low-signal items for better visual hierarchy
  const hasHighSignal = group.items.some(
    (item) => item.kind === 'completion' || item.kind === 'artifact' || item.kind === 'error' || item.tone === 'success' || item.tone === 'danger'
  );
  const hasItems = group.items.length > 0;

  // Track color for the vertical step rail — accent when high-signal, subtle otherwise
  const trackClass = hasHighSignal ? 'border-accent/25' : 'border-border/20';

  // Step count badge — show all non-routing steps
  const stepCount = group.items.filter((item) => item.kind !== 'routing').length;
  // Tool / subagent step summary for collapsed header
  const toolCount = group.items.filter((item) => item.kind === 'tool').length;
  const subagentCount = group.items.filter((item) => item.kind === 'subagent').length;

  return (
    <li className="flex justify-start">
      <div className="w-full">
        {hasItems && (
          <>
            {/* Clickable header — toggles step body */}
            <button
              type="button"
              onClick={() => setGroupOpen((v) => !v)}
              className={`group flex w-full items-center gap-1.5 mb-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-card/30 ${
                isRunning && isLastGroup ? 'cursor-default' : ''
              }`}
            >
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
                hasHighSignal ? 'border-accent/35 bg-accent/12 text-accent' : 'border-border/40 bg-surface-card/60 text-text-subtle/50'
              }`}>
                {isRunning && isLastGroup
                  ? <IconLoader2 size={9} className="animate-spin" />
                  : <IconSparkles size={9} />}
              </span>
              <span className="text-[10px] font-medium tracking-[0.12em] text-text-subtle/60">Agent</span>
              {stepCount >= 1 && (
                <span className="rounded-full border border-border/25 bg-surface-card/35 px-1.5 py-px text-[9.5px] text-text-subtle/50">
                  {stepCount} 步
                </span>
              )}
              {/* Collapsed summary chips */}
              {!groupOpen && toolCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-accent/15 bg-accent/5 px-1.5 py-px text-[9px] text-accent/60">
                  <IconTool size={8} />{toolCount}
                </span>
              )}
              {!groupOpen && subagentCount > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-success/15 bg-success/5 px-1.5 py-px text-[9px] text-success/60">
                  <IconRobot size={8} />{subagentCount}
                </span>
              )}
              {isRunning && isLastGroup && !groupOpen && <AnimatedTypingDots />}
              <time className="ml-auto text-[10px] text-text-subtle/35">{formatEventTime(group.at)}</time>
              {!isRunning && (
                <span className="ml-1 shrink-0 text-text-subtle/30 transition-opacity opacity-0 group-hover:opacity-100">
                  {groupOpen ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
                </span>
              )}
            </button>

            {/* Steps flow with kind-aware accent rail — hidden when collapsed */}
            {groupOpen && (
              <div className={`ml-2 border-l pl-3 ${trackClass}`}>
                <div className="space-y-px">
                  {group.items.map((item, idx) => {
                    const isLastItem = idx === group.items.length - 1;
                    return (
                      <CompactStep
                        key={item.id}
                        item={item}
                        isLast={isLastItem && !group.summary}
                        showTypingDots={isRunning && isLastGroup && isLastItem && !group.summary}
                        onSubmitApproval={onSubmitApproval}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {group.summary && (
          <AssistantSummaryBand
            summary={group.summary}
            showLabel={!hasItems}
            labelTime={!hasItems ? formatEventTime(group.at) : undefined}
            onSwitchToArtifacts={onSwitchToArtifacts}
            runStatus={runStatus}
          />
        )}
      </div>
    </li>
  );
}

function AssistantSummaryBand({
  summary,
  showLabel = false,
  labelTime,
  onSwitchToArtifacts,
  runStatus,
}: {
  summary: AssistantSummary;
  showLabel?: boolean;
  labelTime?: string;
  onSwitchToArtifacts?: () => void;
  runStatus?: string;
}) {
  const isStructuredAnswer = summary.artifact?.kind === 'structured-answer';
  const structuredAnswer = useMemo(
    () => (isStructuredAnswer ? readStructuredAnswer(summary.artifact?.contentJson) : null),
    [isStructuredAnswer, summary.artifact?.contentJson],
  );
  const [artifactExpanded, setArtifactExpanded] = useState(!isStructuredAnswer);

  useEffect(() => {
    setArtifactExpanded(!isStructuredAnswer);
  }, [isStructuredAnswer, summary.artifact?.artifactId, summary.artifact?.label]);

  if (!summary.artifact && (!summary.metrics || summary.metrics.length === 0)) {
    return null;
  }

  const isReport = summary.artifact?.kind === 'report' || summary.artifact?.label.startsWith('report');
  const ArtifactIcon = isReport ? IconFileAnalytics : IconFile;

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Agent label when no step items precede */}
      {showLabel && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
            <IconCircleCheck size={9} />
          </span>
          <span className="text-[10px] tracking-[0.12em] text-text-subtle/50">Agent</span>
          {labelTime && <time className="ml-auto text-[10px] text-text-subtle/40">{labelTime}</time>}
        </div>
      )}
      {summary.artifact && (
        <div className="ml-6 rounded-xl border border-accent/15 bg-accent/4 overflow-hidden">
          {/* Artifact header — click to expand */}
          <button
            type="button"
            onClick={() => setArtifactExpanded(v => !v)}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/6 transition-colors"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/10 text-accent">
              <ArtifactIcon size={10} />
            </span>
            <p className="min-w-0 flex-1 text-[10px] font-semibold text-accent/80 truncate">{summary.artifact.label}</p>
            <span className="shrink-0 rounded-full border border-border/30 bg-surface-card/50 px-1.5 py-px text-[9px] text-text-subtle/60">
              {artifactExpanded ? '收起' : '展开'}</span>
            <span className="shrink-0 text-text-subtle/40">
              {artifactExpanded ? <IconChevronDown size={9} /> : <IconChevronRight size={9} />}
            </span>
          </button>

          {isStructuredAnswer && structuredAnswer?.primaryResponse ? (
            <div className="border-t border-accent/10 px-3 py-2.5">
              <div className={`relative overflow-hidden ${artifactExpanded ? '' : 'max-h-[180px]'}`}>
                <ResponseContent content={structuredAnswer.primaryResponse} />
                {!artifactExpanded && structuredAnswer.primaryResponse.length > 320 ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" />
                ) : null}
              </div>
            </div>
          ) : !artifactExpanded ? (
            <p className="border-t border-accent/10 px-2.5 py-1.5 text-[11px] leading-4 text-text-muted line-clamp-4">
              {summary.artifact.preview}
            </p>
          ) : null}

          {/* Expanded: semantic content view */}
          {artifactExpanded && (
            <div className="border-t border-accent/10 px-3 py-2.5">
              {isReport && summary.artifact.contentJson ? (
                <ReportInlinePreview
                  contentJson={summary.artifact.contentJson}
                  fullContent={summary.artifact.fullContent}
                  onSwitchToArtifacts={onSwitchToArtifacts}
                />
              ) : isStructuredAnswer && summary.artifact.contentJson ? (
                <StructuredAnswerSurface
                  content={summary.artifact.contentJson}
                  identityKey={summary.artifact.artifactId ?? summary.artifact.label}
                  runStatus={runStatus}
                  compact
                  detailsOnly
                  className="shadow-none"
                />
              ) : summary.artifact.kind === 'markdown' && summary.artifact.fullContent ? (
                <div className="space-y-1.5">
                  <p className="whitespace-pre-wrap text-[11.5px] leading-[1.65] text-text-muted">
                    {summary.artifact.fullContent}
                  </p>
                  {onSwitchToArtifacts && (
                    <button
                      type="button"
                      onClick={onSwitchToArtifacts}
                      className="flex items-center gap-1 text-[11px] text-accent/70 transition-colors hover:text-accent"
                    >
                      <IconChevronRight size={10} />
                      查看完整内容
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <IconCode size={9} className="text-text-subtle/40" />
                      <span className="text-[9px] uppercase tracking-widest text-text-subtle/40">内容预览</span>
                    </div>
                    {onSwitchToArtifacts && (
                      <button
                        type="button"
                        onClick={onSwitchToArtifacts}
                        className="inline-flex items-center gap-1 text-[9px] text-accent/70 transition-colors hover:text-accent"
                      >
                        <IconChevronRight size={9} />
                        查看完整报告
                      </button>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap text-[10.5px] leading-relaxed text-text-muted">
                    {summary.artifact.fullContent ?? summary.artifact.preview}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {summary.metrics && summary.metrics.length > 0 && (
        <div className="ml-6 flex flex-wrap gap-1">
          {summary.metrics.map((metric) => (
            <span key={metric.label} className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-surface-card/30 px-1.5 py-0.5">
              <span className="text-[10px] text-text-subtle/70">{metric.label}</span>
              <span className="text-[10px] font-semibold text-text-muted">{metric.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const TONE_DOT: Record<TimelineItem['tone'], string> = {
  default: 'bg-text-subtle/40',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const TONE_TEXT: Record<string, string> = {
  // kind-based
  completion_success: 'text-success font-medium',
  completion_default: 'text-text-muted',
  artifact: 'text-accent/80',
  error: 'text-danger',
  waiting: 'text-warning',
  tool: 'text-text-muted',
  subagent: 'text-text-muted',
  knowledge: 'text-text-muted',
  routing: 'text-text-subtle/60',
  status: 'text-text-subtle/70',
  default: 'text-text-muted',
};

function getItemTextClass(item: TimelineItem): string {
  if (item.tone === 'danger') return 'text-danger';
  if (item.tone === 'warning') return 'text-warning';
  if (item.kind === 'completion' && item.tone === 'success') return TONE_TEXT['completion_success'] ?? '';
  if (item.kind === 'artifact') return TONE_TEXT['artifact'] ?? '';
  if (item.kind === 'error') return TONE_TEXT['error'] ?? '';
  if (item.kind === 'waiting') return TONE_TEXT['waiting'] ?? '';
  if (item.kind === 'routing') return TONE_TEXT['routing'] ?? '';
  if (item.kind === 'status') return TONE_TEXT['status'] ?? '';
  if (item.kind === 'tool') return TONE_TEXT['tool'] ?? '';
  if (item.kind === 'subagent') return TONE_TEXT['subagent'] ?? '';
  if (item.kind === 'knowledge') return TONE_TEXT['knowledge'] ?? '';
  if (item.tone === 'success') return 'text-success';
  return TONE_TEXT['default'] ?? '';
}

function KindIcon({ item }: { item: TimelineItem }) {
  if (item.tone === 'danger' || item.kind === 'error') return <IconAlertTriangle size={11} className="text-danger" />;
  if (item.tone === 'warning' && item.kind !== 'status') return <IconClockPause size={11} className="text-warning" />;
  if (item.kind === 'completion' && item.tone === 'success') return <IconCircleCheck size={11} className="text-success" />;
  if (item.kind === 'completion') return <IconChecks size={11} className="text-success/70" />;
  if (item.kind === 'artifact') return <IconFile size={11} className="text-accent/70" />;
  if (item.kind === 'subagent') return <IconRobot size={11} className="text-accent/50" />;
  if (item.kind === 'tool') return <IconTool size={11} className="text-accent/50" />;
  if (item.kind === 'knowledge') return <IconDatabase size={11} className="text-accent/50" />;
  if (item.kind === 'routing') return <IconRoute size={10} className="text-text-subtle/40" />;
  if (item.kind === 'waiting') return <IconClockPause size={11} className="text-warning" />;
  if (item.kind === 'status') {
    if (item.label.includes('正在') || item.label.includes('进行') || item.label.includes('处理') || item.label.includes('生成')) {
      return <IconLoader2 size={10} className="animate-spin text-accent/40" />;
    }
    return <IconBrain size={10} className="text-text-subtle/40" />;
  }
  if (item.tone === 'success') return <IconCircleCheck size={11} className="text-success/80" />;
  // Default fallback dot
  return <span className={`inline-block h-1 w-1 rounded-full ${TONE_DOT[item.tone]}`} />;
}

function CompactStep({
  item,
  isLast = false,
  showTypingDots = false,
  onSubmitApproval,
}: {
  item: TimelineItem;
  isLast?: boolean;
  showTypingDots?: boolean;
  onSubmitApproval?: (requestId: string, option: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [approved, setApproved] = useState<string | null>(null);
  const hasDetail = Boolean(item.detail);
  const hasCollapsed = item.collapsedItems && item.collapsedItems.length > 0;

  const isHighSignal = item.kind === 'completion' || item.kind === 'artifact' || item.kind === 'error' || item.tone === 'danger';
  const isLowSignal = item.kind === 'routing' || item.kind === 'status';
  const isUltraDim = item.kind === 'routing';
  const textClass = getItemTextClass(item);
  const pinnedStatusPreview = isPinnedStatusItem(item) && item.detail
    ? item.detail.split('\n')[0]?.trim()
    : undefined;

  // ── Special card: waiting_user ─────────────────────────────────────────────
  if (item.kind === 'waiting') {
    const options = item.waitingOptions ?? ['批准', '拒绝'];
    const requestId = item.waitingRequestId;
    const question = typeof item.detail === 'string'
      ? item.detail.split('\n')[0] ?? item.label
      : item.label;

    const handleApprove = (option: string) => {
      if (!requestId || approved) return;
      setApproved(option);
      onSubmitApproval?.(requestId, option);
    };

    return (
      <div className="py-1.5">
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <IconClockPause size={12} className="shrink-0 text-warning" />
            <span className="text-[12px] font-medium text-warning">{item.label}</span>
          </div>
          {question && question !== item.label && (
            <p className="mt-1.5 pl-[20px] text-[11px] leading-[1.6] text-text-muted">{question}</p>
          )}
          {!approved && (!requestId || !onSubmitApproval) && options.length > 0 ? (
            <p className="mt-2 pl-[20px] text-[10.5px] text-text-subtle/65">{options.join(' / ')}</p>
          ) : null}
          {approved ? (
            <div className="mt-2 flex items-center gap-1.5 pl-[20px]">
              <span className="text-[10px] text-text-subtle/60">已提交：</span>
              <span className="rounded-full bg-warning/15 px-2 py-px text-[10px] font-medium text-warning">{approved}</span>
            </div>
          ) : requestId && onSubmitApproval ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[20px]">
              {options.map((opt) => {
                const isDeny = /拒绝|否|deny|reject|cancel/i.test(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleApprove(opt)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all hover:brightness-110 active:scale-95
                      ${isDeny
                        ? 'border-danger/25 bg-danger/8 text-danger hover:bg-danger/14'
                        : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/18'
                      }`}
                  >
                    {opt}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => handleApprove('跳过')}
                className="ml-auto rounded-lg border border-border/25 bg-surface-card/40 px-2 py-1 text-[10px] text-text-subtle/60 transition-all hover:bg-surface-card/70 hover:text-text-muted"
                title="跳过此步骤并继续"
              >
                跳过
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Special card: completion (success) ─────────────────────────────────────
  if (item.kind === 'completion' && item.tone === 'success' && isLast) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-2 rounded-lg px-1 py-1">
          <IconCircleCheck size={13} className="shrink-0 text-success" />
          <span className="text-[12px] font-medium text-success">{item.label}</span>
        </div>
      </div>
    );
  }

  // Tool steps get a distinct pill-style inline tag
  const isToolStep = item.kind === 'tool';
  // Subagent steps get a success-tinted left micro-strip
  const isSubagentStep = item.kind === 'subagent';

  // Routing steps: ultra-minimal inline dot row (no expand, no hover)
  if (isUltraDim) {
    return (
      <div className="flex items-center gap-1 px-1 py-[1px] opacity-25">
        <span className="inline-block h-[3px] w-[3px] shrink-0 rounded-full bg-text-subtle/50" />
        <span className="text-[10px] leading-none text-text-subtle truncate">{item.label}</span>
      </div>
    );
  }

  return (
    <div className={`py-px relative ${
      isLowSignal ? 'opacity-60' : ''
    } ${
      isToolStep ? 'before:absolute before:left-[-12px] before:top-[3px] before:h-[calc(100%-4px)] before:w-[2px] before:rounded-full before:bg-accent/30 before:content-[\'\']' : ''
    } ${
      isSubagentStep ? 'before:absolute before:left-[-12px] before:top-[3px] before:h-[calc(100%-4px)] before:w-[2px] before:rounded-full before:bg-success/25 before:content-[\'\']' : ''
    }`}>
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={`group flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors ${
          hasDetail ? 'hover:bg-surface-card/30 cursor-pointer' : 'cursor-default'
        } ${isHighSignal ? 'hover:bg-surface-card/50' : ''} ${
          isToolStep ? 'hover:bg-accent/5' : ''
        }`}
      >
        <span className="mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center">
          <KindIcon item={item} />
        </span>
        {isToolStep ? (
          <span className="flex-1 inline-flex items-center gap-1 min-w-0">
            <span className="inline-flex items-center rounded-sm border border-accent/12 bg-accent/6 px-1 py-px text-[11px] font-mono leading-[1.4] text-accent/70 truncate max-w-[200px]">
              {item.label}
            </span>
            {showTypingDots && <AnimatedTypingDots />}
          </span>
        ) : (
          <span className={`flex-1 text-[11.5px] leading-[1.5] ${textClass} flex items-center gap-1`}>
            {item.label}
            {showTypingDots && <AnimatedTypingDots />}
          </span>
        )}
        {hasCollapsed && (
          <span className="mt-0.5 shrink-0 rounded-full border border-border/25 bg-surface-card/40 px-1.5 py-px text-[10px] text-text-subtle/60">
            +{item.collapsedItems!.length}
          </span>
        )}
        {hasDetail && (
          <span className="mt-0.5 shrink-0 text-text-subtle/50 opacity-0 transition-opacity group-hover:opacity-100">
            {expanded ? <IconChevronDown size={9} /> : <IconChevronRight size={9} />}
          </span>
        )}
      </button>
      {pinnedStatusPreview ? (
        <div className="ml-4 mt-0.5 text-[10.5px] leading-[1.6] text-text-subtle/65">
          {pinnedStatusPreview}
        </div>
      ) : null}
      {/* Collapsed history items */}
      {hasCollapsed && (
        <div className="ml-4 mt-0.5">
          <button
            type="button"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-[10px] text-text-subtle/50 hover:text-text-subtle transition-colors"
          >
            <IconZoomIn size={9} />
            {historyExpanded ? '收起' : `+${item.collapsedItems!.length} 条过程`}
          </button>
          {historyExpanded && (
            <div className="mt-0.5 space-y-px border-l border-border/15 pl-2">
              {item.collapsedItems!.map((h) => (
                <p key={h.id} className="whitespace-pre-wrap break-words text-[10.5px] leading-[1.6] text-text-subtle/50">
                  {h.label}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {expanded && item.detail && (
        <div className="ml-4 mt-1 rounded-lg border border-border/30 bg-surface/60 overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border/20 px-2.5 py-1">
            <span className="text-[9px] uppercase tracking-[0.15em] text-text-subtle/50">Detail</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(item.detail ?? ''); }}
              className="text-[9px] text-text-subtle/40 transition-colors hover:text-text-subtle/80"
              title="复制内容"
            >
              复制
            </button>
          </div>
          <pre className="max-h-[200px] overflow-y-auto px-2.5 py-2 whitespace-pre-wrap text-[10.5px] leading-[1.6] text-text-muted scrollbar-thin">{item.detail}</pre>
        </div>
      )}
    </div>
  );
}

function buildTimelineGroups(
  events: RunTimelineEvent[],
  run?: RunSummary,
  artifacts: RunArtifactRecord[] = [],
): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const setupItems: TimelineItem[] = [];

  // For run-first architecture (Q1's prompt lives in run.input, NOT as a user_message event):
  // - Lightweight general runs: Q1's events MUST go into an assistant group so they survive
  //   pruneTimelineGroupsForLightweightGeneral, which removes all setup groups.
  //   Without this, Q1's response has no home and its artifact bleeds into Q2's slot.
  // - Heavy/analysis runs: Q1's events stay in the setup group, shown as "初始化" toggle.
  const hasInitialPrompt = !!(run?.input && typeof (run.input as { prompt?: unknown }).prompt === 'string' && ((run.input as { prompt: string }).prompt).trim());
  const shouldPreStartConversation = hasInitialPrompt && isLightweightGeneralRun(run, events);

  let assistantGroup: TimelineAssistantGroup | null = shouldPreStartConversation
    ? {
        kind: 'assistant',
        id: 'assistant_initial',
        at: run?.createdAt ?? new Date().toISOString(),
        items: [],
      }
    : null;
  // When pre-starting, conversationStarted=true from the beginning so Q1's events go into
  // the assistant group instead of setupItems.
  let conversationStarted = shouldPreStartConversation;

  // Track research progress dimensions globally (latest status wins per dimension)
  const setupResearchDimMap = new Map<string, ResearchDimension>();
  let currentAssistantResearchDimMap = new Map<string, ResearchDimension>();

  const flushSetup = () => {
    if (setupItems.length === 0 && setupResearchDimMap.size === 0) return;
    const compressed = compressStatusItems(setupItems);
    const setupGroup: TimelineSetupGroup = {
      kind: 'setup',
      id: compressed.length > 0 ? `setup_${compressed[0]!.id}` : `setup_research`,
      at: events.find((event) => event.eventId === setupItems[0]?.id)?.createdAt ?? events[0]?.createdAt ?? new Date().toISOString(),
      items: compressed,
    };
    if (setupResearchDimMap.size > 0) {
      setupGroup.researchDimensions = Array.from(setupResearchDimMap.values());
    }
    groups.push(setupGroup);
    setupItems.length = 0;
    setupResearchDimMap.clear();
  };

  const flushAssistant = () => {
    if (!assistantGroup || assistantGroup.items.length === 0) return;
    // Compress consecutive status items to reduce noise
    assistantGroup.items = compressStatusItems(assistantGroup.items);
    if (currentAssistantResearchDimMap.size > 0) {
      assistantGroup.researchDimensions = Array.from(currentAssistantResearchDimMap.values());
    }
    groups.push(assistantGroup);
    assistantGroup = null;
    currentAssistantResearchDimMap = new Map();
  };

  for (const event of events) {
    // Skip purely internal events — not meaningful to end users
    if (event.type === 'checkpoint_created') continue;
    if (event.type === 'run_started') continue; // implied by run existing
    if (event.type === 'run_created') continue; // implied by run panel existing

    // Extract research_progress events into dimension tracker (not into regular items)
    if (event.type === 'research_progress') {
      const payload = event.payload as Record<string, unknown>;
      const dim = typeof payload.dimension === 'string' ? payload.dimension : undefined;
      const status = typeof payload.status === 'string'
        ? (payload.status as ResearchDimension['status'])
        : 'started';
      if (dim) {
        const dimEntry: ResearchDimension = {
          id: event.eventId,
          dimension: dim,
          displayName: humanizeDimension(dim),
          status,
        };
        if (!conversationStarted) {
          setupResearchDimMap.set(dim, dimEntry);
        } else {
          currentAssistantResearchDimMap.set(dim, dimEntry);
        }
      }
      continue; // Do NOT add to regular timeline items
    }

    if (event.type === 'waiting_user') {
      flushSetup();
      conversationStarted = true;
      if (!assistantGroup) {
        assistantGroup = {
          kind: 'assistant',
          id: `assistant_${event.eventId}`,
          at: event.createdAt,
          items: [],
        };
      }
      assistantGroup.items.push(toTimelineItem(event));
      continue;
    }

    if (
      event.type === 'continuation_decision'
      && typeof event.payload?.decision === 'string'
      && event.payload.decision === 'stop'
      && !conversationStarted
    ) {
      flushSetup();
      conversationStarted = true;
      if (!assistantGroup) {
        assistantGroup = {
          kind: 'assistant',
          id: `assistant_${event.eventId}`,
          at: event.createdAt,
          items: [],
        };
      }
      assistantGroup.items.push(toTimelineItem(event));
      continue;
    }

    if (USER_EVENT_TYPES.has(event.type)) {
      flushSetup();
      flushAssistant();
      conversationStarted = true;
      groups.push(toUserGroup(event));
      continue;
    }

    if (!conversationStarted) {
      setupItems.push(toTimelineItem(event));
      continue;
    }

    if (!assistantGroup) {
      assistantGroup = {
        kind: 'assistant',
        id: `assistant_${event.eventId}`,
        at: event.createdAt,
        items: [],
      };
    }
    assistantGroup.items.push(toTimelineItem(event));
  }

  flushSetup();
  flushAssistant();

  // For run-first architecture: the initial prompt lives in run.input, not in events.
  // Inject a synthetic user bubble at the top so the request is visible in the timeline.
  if (run?.input) {
    const promptText = typeof run.input.prompt === 'string' ? run.input.prompt.trim() : '';
    if (promptText) {
      const inputAttachmentIds = Array.isArray(run.input.attachmentIds)
        ? (run.input.attachmentIds as string[])
        : [];
      const syntheticUser: TimelineUserGroup = {
        kind: 'user',
        id: 'user_initial',
        at: run.createdAt,
        title: 'You',
        content: promptText,
        meta: inputAttachmentIds.length > 0 ? [`${inputAttachmentIds.length} 个附件`] : [],
      };
      groups.unshift(syntheticUser);
    }
  }

  // If no assistant group exists but there are artifacts or non-zero metrics,
  // add a synthetic empty assistant group so AssistantSummaryBand can render.
  const hasAssistantGroup = groups.some((g) => g.kind === 'assistant');
  if (!hasAssistantGroup && run) {
    const hasData =
      artifacts.length > 0 ||
      run.metrics.turnCount > 0 ||
      run.metrics.toolCallCount > 0 ||
      run.metrics.inputTokens > 0;
    if (hasData) {
      const syntheticAssistant: TimelineAssistantGroup = {
        kind: 'assistant',
        id: 'assistant_synthetic',
        at: run.completedAt ?? run.updatedAt,
        items: [],
      };
      // Insert BEFORE the first follow-up user group (not user_initial) so that Q1's
      // response appears between Q1's message and Q2's message, not after Q2's message.
      const firstFollowUpUserIdx = groups.findIndex(
        (g) => g.kind === 'user' && g.id !== 'user_initial',
      );
      if (firstFollowUpUserIdx !== -1) {
        groups.splice(firstFollowUpUserIdx, 0, syntheticAssistant);
      } else {
        groups.push(syntheticAssistant);
      }
    }
  }

  attachAssistantSummaries(groups, run, artifacts);

  return pruneTimelineGroupsForLightweightGeneral(groups, run, events);
}

function pruneTimelineGroupsForLightweightGeneral(
  groups: TimelineGroup[],
  run: RunSummary | undefined,
  events: RunTimelineEvent[],
): TimelineGroup[] {
  if (!isLightweightGeneralRun(run, events)) {
    return groups;
  }

  return groups.flatMap<TimelineGroup>((group) => {
    if (group.kind === 'setup') {
      return [];
    }

    if (group.kind !== 'assistant') {
      return [group];
    }

    const items = group.items.filter(
      (item) => !(item.sourceType && LIGHTWEIGHT_GENERAL_HIDDEN_ASSISTANT_ITEM_TYPES.has(item.sourceType)),
    );

    if (items.length === 0 && !group.summary) {
      return [];
    }

    const nextGroup: TimelineAssistantGroup = {
      ...group,
      items,
      researchDimensions: undefined,
    };

    return [nextGroup];
  });
}

function isLightweightGeneralRun(run: RunSummary | undefined, events: RunTimelineEvent[]): boolean {
  if (!run) {
    return false;
  }

  if (run.routing.acceptedTaskKind !== 'general') {
    return false;
  }

  if (run.metrics.toolCallCount > 0) {
    return false;
  }

  return !events.some((event) => HEAVY_GENERAL_EVENT_TYPES.has(event.type));
}

function attachAssistantSummaries(groups: TimelineGroup[], run?: RunSummary, artifacts: RunArtifactRecord[] = []): void {
  const assistantEntries = groups
    .map((group, index) => ({ group, index }))
    .filter((entry): entry is { group: TimelineAssistantGroup; index: number } => entry.group.kind === 'assistant');

  if (assistantEntries.length === 0) {
    return;
  }

  const metrics = run ? summarizeRunMetrics(run) : [];
  const latestAssistantIndex = assistantEntries[assistantEntries.length - 1]?.index ?? -1;
  // Only use global artifact fallback (allowing any artifact to attach) when there is
  // exactly ONE assistant group AND it is the synthetic placeholder we created because no
  // real assistant events existed. This prevents Q1's completed artifact from bleeding into
  // Q2's in-progress assistant slot during multi-turn conversations.
  const singleEntry = assistantEntries.length === 1 ? assistantEntries[0] : undefined;
  const allowGlobalArtifactFallback =
    singleEntry !== undefined && singleEntry.group.id === 'assistant_synthetic';

  // Track which artifacts are already claimed by non-latest assistant groups, so we can
  // allow the latest group to pick up unclaimed artifacts (race-condition fix: when
  // artifact_updated SSE event hasn't yet been merged into streamEvents but the artifact
  // was already fetched via refetchQueries on run_completed, the latest group has no
  // artifact items yet but the artifact exists in the artifacts array).
  const claimedArtifactIds = new Set<string>();

  // Pre-claim artifacts referenced by setup groups. When a run has tool calls, Q1's events
  // (including artifact_updated) are placed in a setup group rather than an assistant group.
  // Without pre-claiming, the latest Q2 assistant group would pick up Q1's artifact via
  // allowUnclaimedFallback during streaming, showing stale previous-turn content.
  for (const group of groups) {
    if (group.kind !== 'setup') continue;
    for (const item of group.items) {
      if (item.kind === 'artifact' && item.artifactId) {
        claimedArtifactIds.add(item.artifactId);
      }
    }
  }

  // Whether the run has reached a terminal state (completed/failed/cancelled).
  // allowUnclaimedFallback is only meaningful in terminal state — during active streaming
  // we must never attach a previous turn's artifact to the current in-progress assistant slot.
  const isRunTerminal = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled';

  for (const entry of assistantEntries) {
    const isLatest = entry.index === latestAssistantIndex;
    // For the latest assistant group: allow fallback to unclaimed artifacts when group
    // has no artifact items (handles the SSE race condition described above).
    // Guard with isRunTerminal so that during Q2 streaming we never show Q1's artifact.
    const allowUnclaimedFallback =
      isLatest &&
      isRunTerminal &&
      !allowGlobalArtifactFallback &&
      entry.group.items.filter((item) => item.kind === 'artifact').length === 0 &&
      artifacts.some((a) => !claimedArtifactIds.has(a.artifactId));

    const artifact = resolveLatestArtifact(
      entry.group,
      allowUnclaimedFallback ? artifacts.filter((a) => !claimedArtifactIds.has(a.artifactId)) : artifacts,
      allowGlobalArtifactFallback && isLatest || allowUnclaimedFallback,
    );

    // Track this group's artifact as claimed (for subsequent groups' computation, but
    // in practice we only call this for non-latest groups before latest)
    if (artifact?.artifactId) {
      claimedArtifactIds.add(artifact.artifactId);
    } else {
      // Even without a resolved artifact, claim artifacts referenced by this group's items
      for (const item of entry.group.items) {
        if (item.kind === 'artifact' && item.artifactId) {
          claimedArtifactIds.add(item.artifactId);
        }
      }
    }

    const summary: AssistantSummary = {
      ...(artifact ? { artifact } : null),
      ...(isLatest && metrics.length > 0 ? { metrics } : null),
    };

    if (!summary.artifact && (!summary.metrics || summary.metrics.length === 0)) {
      continue;
    }

    groups[entry.index] = {
      ...entry.group,
      summary,
    };
  }
}

function resolveLatestArtifact(
  group: TimelineAssistantGroup,
  artifacts: RunArtifactRecord[],
  allowGlobalFallback = false,
): AssistantSummary['artifact'] | undefined {
  if (artifacts.length === 0) {
    return undefined;
  }

  const artifactItems = group.items.filter((item) => item.kind === 'artifact');
  if (artifactItems.length === 0 && !allowGlobalFallback) {
    return undefined;
  }

  const candidates = artifacts.filter((artifact) =>
    artifactItems.some((item) => {
      if (item.artifactId) {
        return item.artifactId === artifact.artifactId;
      }
      if (item.artifactVersion !== undefined) {
        return item.artifactVersion === artifact.version;
      }
      return false;
    }),
  );
  const artifactPool = candidates.length > 0 ? candidates : allowGlobalFallback ? artifacts : [];
  const sortedArtifacts = sortArtifactsForDisplay(artifactPool);
  const targetArtifact = sortedArtifacts[0];

  if (!targetArtifact) {
    return undefined;
  }

  return {
    artifactId: targetArtifact.artifactId,
    label: `${targetArtifact.kind} v${targetArtifact.version}`,
    preview: summarizeArtifactRecord(targetArtifact),
    kind: targetArtifact.kind,
    contentJson: targetArtifact.contentJson ?? undefined,
    fullContent: targetArtifact.kind === 'markdown'
      ? (targetArtifact.contentText?.slice(0, 1500) ?? '')
      : JSON.stringify(targetArtifact.contentJson ?? {}, null, 2).slice(0, 1500),
  };
}

function isSkillProposalArtifact(artifact: RunArtifactRecord): boolean {
  const value = artifact.contentJson;
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'skill-proposal';
}

function artifactDisplayPriority(artifact: RunArtifactRecord): number {
  if (isSkillProposalArtifact(artifact)) return 2;

  switch (artifact.kind) {
    case 'report': return 0;
    case 'structured-answer': return 1;
    case 'markdown': return 3;
    case 'json': return 4;
    default: return 5;
  }
}

function sortArtifactsForDisplay(artifacts: RunArtifactRecord[]): RunArtifactRecord[] {
  return [...artifacts].sort((left, right) => {
    const priorityDiff = artifactDisplayPriority(left) - artifactDisplayPriority(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    if (left.version !== right.version) {
      return right.version - left.version;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function summarizeArtifactRecord(artifact: RunArtifactRecord): string {
  if (artifact.kind === 'markdown' && artifact.contentText) {
    return artifact.contentText.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  if (artifact.contentJson && typeof artifact.contentJson === 'object') {
    const preview = readArtifactPreviewFromJson(artifact.contentJson as Record<string, unknown>);
    if (preview) {
      return preview;
    }
  }

  return JSON.stringify(artifact.contentJson ?? {}, null, 2).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function readArtifactPreviewFromJson(value: Record<string, unknown>): string | undefined {
  // Risk analysis report: show businessName + score as title
  if (typeof value.businessName === 'string' && value.businessName.trim()) {
    const scoreText = typeof value.overallScore === 'number' ? ` · 得分 ${value.overallScore}` : '';
    const coverageMatrix = value.coverageMatrix && typeof value.coverageMatrix === 'object'
      ? ` · ${Object.keys(value.coverageMatrix as object).length} 维度`
      : '';
    return `${value.businessName.trim()}${scoreText}${coverageMatrix}`;
  }

  const structuredAnswer = readStructuredAnswer(value);
  if (structuredAnswer?.primaryResponse) {
    return structuredAnswer.primaryResponse.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  const candidateKeys = ['response', 'summary', 'overview', 'message', 'title', 'query', 'status'];
  for (const key of candidateKeys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 180);
    }
  }

  if (Array.isArray(value.matches) && value.matches.length > 0) {
    const firstMatch = value.matches[0] as Record<string, unknown>;
    if (typeof firstMatch.title === 'string') {
      return `Top match: ${firstMatch.title}`;
    }
  }

  return undefined;
}

function summarizeRunMetrics(run: RunSummary): Array<{ label: string; value: string }> {
  const totalTokens = run.metrics.inputTokens + run.metrics.outputTokens;
  const hasNonZero =
    run.metrics.turnCount > 0 ||
    run.metrics.toolCallCount > 0 ||
    totalTokens > 0 ||
    run.metrics.estimatedUsd > 0;
  if (!hasNonZero) return [];
  return [
    { label: 'Turns', value: String(run.metrics.turnCount) },
    { label: 'Tools', value: String(run.metrics.toolCallCount) },
    { label: 'Tokens', value: String(totalTokens) },
    { label: 'Cost', value: `$${run.metrics.estimatedUsd.toFixed(4)}` },
  ];
}

function toUserGroup(event: RunTimelineEvent): TimelineUserGroup {
  if (event.type === 'user_input_received') {
    return {
      kind: 'user',
      id: `user_${event.eventId}`,
      at: event.createdAt,
      title: 'You',
      content: readPrimaryText(event.payload, ['input', 'content', 'message']) || 'Submitted input',
      meta: ['Intervention reply'],
    };
  }

  const attachmentIds = readStringArray(event.payload.attachmentIds);
  const toolIds = readStringArray(event.payload.toolIds);
  const mode = typeof event.payload.mode === 'string' ? MODE_LABELS[event.payload.mode] ?? event.payload.mode : undefined;

  return {
    kind: 'user',
    id: `user_${event.eventId}`,
    at: event.createdAt,
    title: 'You',
    content: readPrimaryText(event.payload, ['content', 'input', 'message']) || 'Sent a follow-up message',
    meta: [
      mode,
      attachmentIds.length > 0 ? `${attachmentIds.length} attachment${attachmentIds.length > 1 ? 's' : ''}` : undefined,
      toolIds.length > 0 ? `${toolIds.length} tool${toolIds.length > 1 ? 's' : ''}` : undefined,
    ].filter(Boolean) as string[],
  };
}

function toTimelineItem(event: RunTimelineEvent): TimelineItem {
  const payload = event.payload;
  switch (event.type) {
    case 'run_created':
      return {
        id: event.eventId,
        label: `已创建 ${humanizeTaskKind(payload.taskKind)} 运行`,
        tone: 'default',
        kind: 'routing',
      };
    case 'routed':
      return {
        id: event.eventId,
        label: `路由至 ${humanizeTaskKind(payload.acceptedTaskKind)}`,
        detail: typeof payload.reason === 'string' ? payload.reason : undefined,
        tone: 'default',
        kind: 'routing',
        sourceType: event.type,
      };
    case 'plan_created':
      return {
        id: event.eventId,
        label: '执行计划已生成',
        detail: summarizePayload(payload),
        tone: 'default',
        kind: 'routing',
        sourceType: event.type,
      };
    case 'continuation_decision':
      return {
        id: event.eventId,
        label: summarizeContinuationDecisionLabel(payload),
        detail: summarizeContinuationDecisionDetail(payload),
        tone: payload.decision === 'stop' ? 'success' : 'default',
        kind: 'status',
        sourceType: event.type,
      };
    case 'capability_switched':
      return {
        id: event.eventId,
        label: summarizeCapabilitySwitchLabel(payload),
        detail: summarizeCapabilitySwitchDetail(payload),
        tone: 'default',
        kind: 'status',
        sourceType: event.type,
      };
    case 'knowledge_query_started':
      return {
        id: event.eventId,
        label: '正在检索知识库',
        detail: summarizeKnowledgeStart(payload),
        tone: 'default',
        kind: 'knowledge',
      };
    case 'knowledge_query_completed': {
      const total = readNumber(payload.totalMatches);
      return {
        id: event.eventId,
        label: total !== undefined ? `命中 ${total} 条相关结果` : '知识库检索完成',
        detail: typeof payload.query === 'string' ? `查询：${payload.query}` : undefined,
        tone: total && total > 0 ? 'success' : 'warning',
        kind: 'knowledge',
      };
    }
    case 'general_response_started':
      return {
        id: event.eventId,
        label: '正在整理通用回复',
        detail: summarizeGeneralStart(payload),
        tone: 'default',
        kind: 'status',
        sourceType: event.type,
      };
    case 'tool_start': {
      const toolName = readPrimaryText(payload, ['toolName', 'name']) ?? 'tool';
      return {
        id: event.eventId,
        label: toolName,
        detail: summarizeToolEventDetail(payload),
        tone: 'default',
        kind: 'tool',
      };
    }
    case 'tool_progress': {
      const toolName = readPrimaryText(payload, ['toolName', 'name']) ?? 'tool';
      const progress = readPrimaryText(payload, ['message', 'progress']) ?? `${toolName} 运行中`;
      return {
        id: event.eventId,
        label: progress,
        detail: summarizeToolEventDetail(payload),
        tone: 'default',
        kind: 'tool',
      };
    }
    case 'tool_complete': {
      const toolName = readPrimaryText(payload, ['toolName', 'name']) ?? 'tool';
      return {
        id: event.eventId,
        label: `${toolName} 完成`,
        detail: summarizeToolEventDetail(payload),
        tone: 'success',
        kind: 'tool',
      };
    }
    case 'tool_error': {
      const toolName = readPrimaryText(payload, ['toolName', 'name']) ?? 'tool';
      return {
        id: event.eventId,
        label: `${toolName} 失败`,
        detail: summarizeToolEventDetail(payload),
        tone: 'danger',
        kind: 'error',
      };
    }
    case 'skill_management_started':
      return {
        id: event.eventId,
        label: '正在处理技能任务',
        detail: summarizeSkillStart(payload),
        tone: 'default',
        kind: 'tool',
      };
    case 'skill_management_completed':
      return { ...summarizeSkillCompletion(event), kind: 'completion' };
    case 'subagent_spawned':
      return {
        id: event.eventId,
        label: summarizeSubagentLabel(payload),
        detail: summarizeSubagentSpawn(payload),
        tone: 'default',
        kind: 'subagent',
      };
    case 'subagent_complete':
      return { ...summarizeSubagentCompletion(event), kind: 'subagent' };
    case 'agent_status': {
      const statusMsg = typeof payload.message === 'string' ? payload.message.trim() : '';
      return {
        id: event.eventId,
        label: statusMsg || '实时进度',
        detail: statusMsg ? undefined : summarizePayload(payload),
        tone: 'default',
        kind: 'status',
      };
    }
    case 'research_progress':
      return {
        id: event.eventId,
        label: '研究进度',
        detail: summarizeResearchProgress(payload),
        tone: payload.status === 'completed' ? 'success' : 'default',
        kind: 'status', // treated as status for compression grouping
      };
    case 'checkpoint_created':
      return {
        id: event.eventId,
        label: summarizeCheckpoint(payload),
        tone: 'default',
        kind: 'status',
        sourceType: event.type,
      };
    case 'turn_info': {
      const current = readNumber(payload.current);
      const max = readNumber(payload.max);
      const estimatedTokens = readNumber(payload.estimatedTokens);
      return {
        id: event.eventId,
        label: summarizeTurnInfoLabel(current, max, estimatedTokens),
        tone: 'default',
        kind: 'status',
        sourceType: event.type,
      };
    }
    case 'text_delta': {
      const delta = readPrimaryText(payload, ['delta', 'text', 'content']);
      const label = summarizeTextDeltaLabel(delta);
      return {
        id: event.eventId,
        label,
        detail: delta && delta !== label ? delta : undefined,
        tone: 'default',
        kind: 'status',
        sourceType: event.type,
      };
    }
    case 'text_complete': {
      const fullText = readPrimaryText(payload, ['fullText', 'text', 'content']);
      const label = summarizeTextCompleteLabel(fullText);
      return {
        id: event.eventId,
        label,
        detail: fullText && fullText !== label ? fullText : undefined,
        tone: 'default',
        kind: 'status',
        sourceType: event.type,
      };
    }
    case 'artifact_updated': {
      const artifactKind = typeof payload.kind === 'string' ? payload.kind : undefined;
      const artifactVersion = typeof payload.version === 'number' ? `v${payload.version}` : undefined;
      const versionLabel = [artifactKind, artifactVersion].filter(Boolean).join(' ');
      return {
        id: event.eventId,
        label: versionLabel ? `已生成 ${versionLabel}` : '产物已更新',
        detail: summarizeArtifact(payload),
        tone: 'default',
        kind: 'artifact',
        sourceType: event.type,
        artifactId: typeof payload.artifactId === 'string' ? payload.artifactId : undefined,
        artifactVersion: typeof payload.version === 'number' ? payload.version : undefined,
      };
    }
    case 'waiting_user':
      return {
        id: event.eventId,
        label: 'Agent 需要你的决策',
        detail: [
          typeof payload.question === 'string' ? payload.question : undefined,
          readStringArray(payload.options).length > 0 ? readStringArray(payload.options).join(' / ') : undefined,
        ].filter(Boolean).join('\n'),
        tone: 'warning',
        kind: 'waiting',
        waitingRequestId: typeof payload.requestId === 'string' ? payload.requestId : undefined,
        waitingOptions: readStringArray(payload.options).length > 0 ? readStringArray(payload.options) : undefined,
      };
    case 'verifier_finished':
      return { ...summarizeVerification(event), kind: 'completion', sourceType: event.type };
    case 'run_completed':
      return {
        id: event.eventId,
        label: '运行完成',
        tone: 'success',
        kind: 'completion',
        sourceType: event.type,
      };
    case 'run_failed':
      return {
        id: event.eventId,
        label: '运行失败',
        detail: summarizeRunTerminalState(payload),
        tone: 'danger',
        kind: 'error',
      };
    case 'run_cancelled':
      return {
        id: event.eventId,
        label: '运行已取消',
        detail: summarizeRunTerminalState(payload),
        tone: 'warning',
        kind: 'error',
      };
    default:
      return {
        id: event.eventId,
        label: humanizeEventType(event.type),
        detail: summarizePayload(payload),
        tone: 'default',
        kind: 'default',
      };
  }
}

/** Post-process items to group consecutive low-signal events (status, routing), reducing noise */
function compressStatusItems(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let lowSignalBuffer: TimelineItem[] = [];
  let currentKind: 'status' | 'routing' | null = null;

  const flushBuffer = (mode: 'intermediate' | 'final' = 'intermediate') => {
    if (lowSignalBuffer.length === 0) return;
    if (lowSignalBuffer.length === 1) {
      result.push(lowSignalBuffer[0]!);
    } else {
      // Keep the last message as primary; fold older ones into collapsedItems
      const last = lowSignalBuffer[lowSignalBuffer.length - 1]!;
      const older = lowSignalBuffer.slice(0, -1);

      // When the primary item is a text_delta fragment (e.g. "温"), merge all
      // accumulated text_delta content so the label shows readable text instead
      // of a single-character SSE chunk.
      if (last.sourceType === 'text_delta') {
        const textDeltaItems = lowSignalBuffer.filter((i) => i.sourceType === 'text_delta');
        if (textDeltaItems.length >= 2) {
          const allContents = textDeltaItems
            .map((i) => (i.detail ?? i.label).trim())
            .filter(Boolean);
          const merged = mergeTextDeltaHistory(allContents);
          const lastContent = normalizeCollapsedTextDeltaText((last.detail ?? last.label).trim());
          const shouldUseMergedPreview = mode === 'final'
            || textDeltaItems.every((i) => isMergeableTextDeltaLabel(i.detail ?? i.label));
          const previewSource = shouldUseMergedPreview ? merged : (lastContent || merged);
          const previewLabel = previewSource.replace(/\s+/g, ' ').trim().slice(0, 48) || '正文生成中';
          result.push({
            ...last,
            label: previewLabel,
            detail: merged !== previewSource || mode === 'final'
              ? merged
              : last.detail,
            collapsedItems: collapseStatusHistoryItems(older),
          });
          lowSignalBuffer = [];
          currentKind = null;
          return;
        }
      }

      result.push({
        ...last,
        collapsedItems: collapseStatusHistoryItems(older),
      });
    }
    lowSignalBuffer = [];
    currentKind = null;
  };

  for (const item of items) {
    const isLowSignal = (item.kind === 'status' || item.kind === 'routing') && !isPinnedStatusItem(item);
    if (isLowSignal) {
      // If switching kind (e.g. routing then status), flush first
      if (currentKind !== null && currentKind !== item.kind) {
        flushBuffer('intermediate');
      }
      currentKind = item.kind as 'status' | 'routing';
      lowSignalBuffer.push(item);
    } else {
      flushBuffer('intermediate');
      result.push(item);
    }
  }
  flushBuffer('final');
  return result;
}

function isPinnedStatusItem(item: TimelineItem): boolean {
  return item.sourceType === 'continuation_decision' && item.label.includes('停止继续');
}

function summarizeKnowledgeStart(payload: Record<string, unknown>): string | undefined {
  const keywords = readStringArray(payload.keywords);
  const allowedSources = readStringArray(payload.allowedSources).map(humanizeTaskKind);
  return [
    keywords.length > 0 ? `关键词：${keywords.slice(0, 4).join('、')}` : undefined,
    allowedSources.length > 0 ? `范围：${allowedSources.join(' · ')}` : undefined,
  ].filter(Boolean).join('\n') || undefined;
}

function summarizeGeneralStart(payload: Record<string, unknown>): string | undefined {
  const toolIds = readStringArray(payload.toolIds);
  const attachmentCount = readNumber(payload.attachmentCount);
  return [
    toolIds.length > 0 ? `已选工具：${toolIds.join('、')}` : undefined,
    attachmentCount !== undefined && attachmentCount > 0 ? `附件：${attachmentCount} 个` : undefined,
  ].filter(Boolean).join('\n') || undefined;
}

function summarizeContinuationDecisionLabel(payload: Record<string, unknown>): string {
  const decision = typeof payload.decision === 'string' ? payload.decision : 'continue';
  if (decision === 'stop') {
    const source = typeof payload.source === 'string' ? payload.source : 'model';
    if (source === 'system') {
      return '系统停止继续';
    }
    if (source === 'user') {
      return '审批停止继续';
    }
    return '模型决定停止继续';
  }

  const nextCapability = typeof payload.nextCapabilityProfile === 'string'
    ? humanizeTaskKind(payload.nextCapabilityProfile)
    : '当前能力';
  return `模型决定继续：${nextCapability}`;
}

function summarizeContinuationDecisionDetail(payload: Record<string, unknown>): string | undefined {
  return [
    formatContinuationStopReasonLine(payload),
    typeof payload.reason === 'string' ? `原因：${payload.reason}` : undefined,
    typeof payload.responseModeHint === 'string' ? `模式提示：${payload.responseModeHint}` : undefined,
    typeof payload.delegatedPrompt === 'string' ? `下一步任务：${payload.delegatedPrompt}` : undefined,
  ].filter(Boolean).join('\n') || undefined;
}

function formatContinuationStopReasonLine(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.stopReasonCode !== 'string') {
    return undefined;
  }

  const labels: Record<string, string> = {
    model_complete: '模型完成',
    budget: '预算',
    approval: '审批',
    system_fallback: '系统回退',
    verification_failed: '验证失败',
    max_rounds: '最大轮次',
  };

  return `停止类型：${labels[payload.stopReasonCode] ?? payload.stopReasonCode}`;
}

function summarizeCapabilitySwitchLabel(payload: Record<string, unknown>): string {
  const nextCapability = typeof payload.to === 'string'
    ? humanizeTaskKind(payload.to)
    : '未知能力';
  return `切换至 ${nextCapability}`;
}

function summarizeCapabilitySwitchDetail(payload: Record<string, unknown>): string | undefined {
  return [
    typeof payload.from === 'string' ? `来源：${humanizeTaskKind(payload.from)}` : undefined,
    typeof payload.reason === 'string' ? `原因：${payload.reason}` : undefined,
    typeof payload.source === 'string' ? `触发方：${payload.source}` : undefined,
  ].filter(Boolean).join('\n') || undefined;
}

function summarizeSkillStart(payload: Record<string, unknown>): string | undefined {
  return [
    typeof payload.action === 'string' ? `动作：${payload.action}` : undefined,
    typeof payload.targetSkill === 'string' ? `目标：${payload.targetSkill}` : undefined,
  ].filter(Boolean).join('\n') || undefined;
}

function formatPayloadValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolEventDetail(payload: Record<string, unknown>): string | undefined {
  const parts: string[] = [
    readPrimaryText(payload, ['toolName', 'name']) ? `工具：${readPrimaryText(payload, ['toolName', 'name'])}` : undefined,
    readPrimaryText(payload, ['message', 'progress']) ? `进度：${readPrimaryText(payload, ['message', 'progress'])}` : undefined,
    ...buildSandboxDetailLines(payload.sandbox),
    readPrimaryText(payload, ['error']) ? `错误：${readPrimaryText(payload, ['error'])}` : undefined,
  ].filter((line): line is string => Boolean(line));

  // Include tool input parameters for debugging
  if (payload.input !== undefined && payload.input !== null) {
    const formatted = formatPayloadValue(payload.input);
    if (formatted) {
      parts.push('');
      parts.push('── 输入参数 ──');
      parts.push(formatted.slice(0, 1500));
    }
  }

  // Include tool result for debugging
  if (payload.result !== undefined && payload.result !== null) {
    const formatted = formatPayloadValue(payload.result);
    if (formatted) {
      parts.push('');
      parts.push('── 返回结果 ──');
      parts.push(formatted.slice(0, 2500));
    }
  }

  if (parts.length > 0) {
    return parts.join('\n');
  }

  return summarizePayload(payload);
}

function summarizeRunTerminalState(payload: Record<string, unknown>): string | undefined {
  const lines = [
    readPrimaryText(payload, ['reason', 'terminationReason']) ? `原因：${readPrimaryText(payload, ['reason', 'terminationReason'])}` : undefined,
    ...buildSandboxDetailLines(payload.sandbox),
    readPrimaryText(payload, ['error']) ? `错误：${readPrimaryText(payload, ['error'])}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join('\n') : summarizePayload(payload);
}

function formatConsoleEventPayload(event: RunTimelineEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const sandbox = summarizeSandboxInline(payload.sandbox);
  const primaryText = [
    readPrimaryText(payload, ['toolName', 'name']),
    readPrimaryText(payload, ['message', 'progress', 'reason', 'error']),
  ].filter(Boolean).join(' · ');

  if (sandbox) {
    return [primaryText, sandbox].filter(Boolean).join(' · ');
  }

  if (primaryText) {
    return primaryText;
  }

  return event.payload
    ? JSON.stringify(event.payload).slice(0, 140)
    : '';
}

function summarizeSkillCompletion(event: RunTimelineEvent): TimelineItem {
  const { payload } = event;
  const action = typeof payload.action === 'string' ? payload.action : 'test';

  if (action === 'list') {
    const totalSkills = readNumber(payload.totalSkills);
    return {
      id: event.eventId,
      label: totalSkills !== undefined ? `已返回 ${totalSkills} 个技能` : '技能列表已返回',
      tone: 'success',
    };
  }

  if (action === 'inspect') {
    const found = payload.found !== false;
    return {
      id: event.eventId,
      label: found ? '技能详情已加载' : '未找到技能详情',
      detail: typeof payload.targetSkill === 'string' ? `目标技能：${payload.targetSkill}` : undefined,
      tone: found ? 'success' : 'warning',
    };
  }

  const error = typeof payload.error === 'string' ? payload.error : undefined;
  const label = error === 'tool_selection_blocks_confirmation'
    ? '技能 dry-run 已阻止'
    : error === 'approval_denied'
      ? '技能 dry-run 已取消'
      : payload.success === false
        ? '技能 dry-run 失败'
        : '技能 dry-run 已完成';

  return {
    id: event.eventId,
    label,
    detail: typeof payload.targetSkill === 'string' ? `目标技能：${payload.targetSkill}` : undefined,
    tone: payload.success === false ? 'danger' : 'success',
  };
}

function summarizeSubagentLabel(payload: Record<string, unknown>): string {
  const agentId = typeof payload.agentId === 'string' ? payload.agentId : '';
  if (!agentId) {
    return '子流程';
  }

  const knownLabels: Record<string, string> = {
    riskrule: '风险规则子流程',
    profile: '业务画像子流程',
    verifier: '验证子流程',
    planner: '规划子流程',
  };

  return knownLabels[agentId] ?? `${humanizeTaskKind(agentId)} 子流程`;
}

function summarizeSubagentSpawn(payload: Record<string, unknown>): string | undefined {
  return [
    typeof payload.description === 'string' ? payload.description : undefined,
    typeof payload.taskType === 'string' && payload.taskType !== 'subagent' ? `类型：${payload.taskType}` : undefined,
  ].filter(Boolean).join('\n') || undefined;
}

function summarizeSubagentCompletion(event: RunTimelineEvent): TimelineItem {
  const status = typeof event.payload.status === 'string' ? event.payload.status : undefined;
  const summary = typeof event.payload.summary === 'string' ? event.payload.summary : undefined;
  const detail = [
    summary,
    status && status !== 'completed' ? `状态：${status}` : undefined,
  ].filter(Boolean).join('\n') || undefined;

  return {
    id: event.eventId,
    label: summarizeSubagentLabel(event.payload),
    detail,
    tone: status === 'failed' ? 'danger' : status === 'completed' ? 'success' : 'default',
  };
}

function summarizeCheckpoint(payload: Record<string, unknown>): string {
  if (typeof payload.semanticKind === 'string') {
    return humanizeEventType(payload.semanticKind);
  }
  if (typeof payload.kind === 'string') {
    return `${humanizeEventType(payload.kind)} checkpoint`;
  }
  return 'Checkpoint created';
}

function summarizeArtifact(payload: Record<string, unknown>): string | undefined {
  return [
    typeof payload.kind === 'string' ? payload.kind : undefined,
    typeof payload.version === 'number' ? `v${payload.version}` : undefined,
  ].filter(Boolean).join(' · ') || undefined;
}

function summarizeVerification(event: RunTimelineEvent): TimelineItem {
  const decision = typeof event.payload.decision === 'string' ? event.payload.decision.toLowerCase() : 'warn';
  const reasons = readStringArray(event.payload.reasons);
  return {
    id: event.eventId,
    label: decision === 'pass' ? '验证通过' : decision === 'fail' ? '验证失败' : '验证警告',
    detail: reasons.length > 0 ? reasons.join(' · ') : undefined,
    tone: decision === 'pass' ? 'success' : decision === 'fail' ? 'danger' : 'warning',
  };
}

function summarizeResearchProgress(payload: Record<string, unknown>): string | undefined {
  const dimension = typeof payload.dimension === 'string' ? payload.dimension : undefined;
  const status = typeof payload.status === 'string' ? payload.status : undefined;
  if (!dimension && !status) {
    return undefined;
  }

  return [dimension, status].filter(Boolean).join(' · ');
}

function humanizeDimension(dimension: string): string {
  const CN: Record<string, string> = {
    'risk-rules': '风险规则',
    'business-profile': '业务画像',
    'external-market': '外部市场',
    'regulatory-compliance': '合规要求',
    'operational-risk': '运营风险',
    'credit-risk': '信用风险',
    'fraud-risk': '欺诈风险',
    'market-risk': '市场风险',
    'liquidity-risk': '流动性风险',
    'compliance': '合规维度',
    'summary': '汇总',
  };
  return CN[dimension] ?? dimension.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeTaskKind(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const CN: Record<string, string> = {
    general: '通用对话',
    analysis: '风控分析',
    'knowledge-query': '知识检索',
    'skill-management': '技能管理',
    auto: '自动路由',
  };
  return CN[text] ?? (text ? text.replace(/-/g, ' ') : '运行');
}

function humanizeEventType(type: string): string {
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summarizeTurnInfoLabel(current?: number, max?: number, estimatedTokens?: number): string {
  const turnText = current !== undefined && max !== undefined
    ? max > 0
      ? `第 ${current} 轮 / 共 ${max} 轮`
      : `第 ${current} 轮 / 不限制轮次`
    : current !== undefined
      ? `第 ${current} 轮`
      : '轮次更新';
  const tokenText = estimatedTokens !== undefined ? `约 ${estimatedTokens} tokens` : undefined;
  return [turnText, tokenText].filter(Boolean).join(' · ');
}

function summarizeTextDeltaLabel(delta?: string): string {
  const normalized = delta?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) {
    return '正文生成中';
  }

  const cleaned = normalized
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^`{1,3}/, '')
    .trim();

  return (cleaned || normalized).slice(0, 48);
}

function summarizeTextCompleteLabel(fullText?: string): string {
  if (!fullText) {
    return '正文已整理完成';
  }

  const normalized = normalizeCollapsedTextDeltaText(fullText).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '正文已整理完成';
  }

  if (fullText.includes('---') || /(^|\n)#{1,6}\s+/.test(fullText) || normalized.length > 180) {
    return '正文与过程说明已整理完成';
  }

  return normalized.slice(0, 64);
}

function collapseStatusHistoryItems(items: TimelineItem[]): Array<{ id: string; label: string }> {
  const collapsed: Array<{ id: string; label: string }> = [];
  let textDeltaBuffer: TimelineItem[] = [];

  const flushTextDeltaBuffer = () => {
    if (textDeltaBuffer.length === 0) return;
    collapsed.push(...buildCollapsedTextDeltaItems(textDeltaBuffer));
    textDeltaBuffer = [];
  };

  for (const item of items) {
    if (item.sourceType === 'text_delta') {
      textDeltaBuffer.push(item);
      continue;
    }

    flushTextDeltaBuffer();
    collapsed.push({ id: item.id, label: item.label });
  }

  flushTextDeltaBuffer();
  return collapsed;
}

function buildCollapsedTextDeltaItems(items: TimelineItem[]): Array<{ id: string; label: string }> {
  const contents = items
    .map(readTextDeltaHistoryContent)
    .filter(Boolean);

  if (contents.length === 0) {
    return [];
  }

  if (items.length <= 3) {
    if (contents.every(isMergeableTextDeltaLabel)) {
      return [{
        id: items.map((item) => item.id).join('_'),
        label: mergeTextDeltaHistory(contents),
      }];
    }

    return items.map((item) => ({
      id: item.id,
      label: readTextDeltaHistoryContent(item),
    }));
  }

  const merged = stitchTextDeltaHistory(contents);
  const segments = segmentCollapsedTextDeltaHistory(merged);
  return segments.map((segment, index) => ({
    id: `${items[0]!.id}_${index}`,
    label: segment,
  }));
}

function readTextDeltaHistoryContent(item: TimelineItem): string {
  return (item.detail ?? item.label).trim();
}

function stitchTextDeltaHistory(labels: string[]): string {
  return mergeTextDeltaHistory(labels);
}

function mergeTextDeltaHistory(labels: string[]): string {
  const normalizedLabels = labels
    .map((label) => normalizeCollapsedTextDeltaText(label))
    .filter(Boolean);

  let merged = '';
  for (const label of normalizedLabels) {
    if (!merged) {
      merged = label;
      continue;
    }

    merged = shouldConcatenateTextDeltaWithoutSpace(merged, label)
      ? `${merged}${label}`
      : `${merged} ${label}`;
  }

  merged = merged.replace(/\s+([，。！？：；,.!?;:])/g, '$1').trim();

  return merged || '正文生成中';
}

function segmentCollapsedTextDeltaHistory(text: string): string[] {
  const normalized = normalizeCollapsedTextDeltaText(text);
  if (!normalized) {
    return ['正文生成中'];
  }

  const tokens = normalized
    .split(/\n+|(?<=[。！？])/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [normalized];
  }

  const segments: string[] = [];
  let current = '';

  for (const token of tokens) {
    const nextValue = current ? `${current} ${token}` : token;
    if (current && nextValue.length > 140) {
      segments.push(current.trim());
      current = token;
      continue;
    }

    current = nextValue;
  }

  if (current) {
    segments.push(current.trim());
  }

  return segments.slice(0, 4);
}

function normalizeCollapsedTextDeltaText(value: string): string {
  return value
    .replace(/(?:正文生成中\s*)+/g, '')
    .replace(/(^|\n)\s*#{1,6}\s*/g, '$1')
    .replace(/\n?---+\n?/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/gu, '')
    .replace(/\s+([，。！？：；,.!?;:])/g, '$1')
    .trim();
}

function isMergeableTextDeltaLabel(label: string): boolean {
  const normalized = normalizeCollapsedTextDeltaText(label).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  if (/[。！？.!?]/.test(normalized)) {
    return false;
  }

  return normalized.replace(/\s+/g, '').length <= 6;
}

function shouldConcatenateTextDeltaWithoutSpace(previous: string, next: string): boolean {
  return isCompactCjkFragment(previous) && isCompactCjkFragment(next);
}

function isCompactCjkFragment(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
    && !/[A-Za-z0-9]/.test(value)
    && !/[，。！？：；,.!?;:]/.test(value)
    && !/\s/.test(value);
}

function summarizePayload(payload: Record<string, unknown>): string | undefined {
  const entries = Object.entries(payload).filter(
    ([key, value]) => key !== 'syntheticMetrics' && value !== null && value !== undefined,
  );
  if (entries.length === 0) return undefined;
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${summarizePayloadValue(value)}`)
    .join('\n');
}

function summarizePayloadValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : 'item'))
      .slice(0, 4);
    return items.join(', ');
  }

  if (typeof value === 'object' && value !== null) {
    return 'structured payload';
  }

  return 'unknown';
}

function readPrimaryText(payload: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatEventTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
