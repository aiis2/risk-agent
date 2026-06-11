import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, startTransition, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import {
  IconBolt,
  IconCircleCheck,
  IconDatabase,
  IconLoader2,
  IconMessagePlus,
  IconPlayerStop,
  IconRoute,
  IconSparkles,
  IconShieldCheck,
  IconAlertTriangle,
  IconWifiOff,
  IconSettings2,
} from '@tabler/icons-react';
import {
  appendRunMessage,
  cancelRun,
  createRun,
  getRun,
  getRunArtifacts,
  getRunEvents,
  listModels,
  listTools,
  resolveRunCurrentCapability,
  resolveRunDisplayTaskKind,
  submitRunInput,
  uploadSessionAttachment,
  type RunArtifactRecord,
  type RunApprovalMode,
  type RunComposerPayload,
  type RunSummary,
  type RunTaskKind,
  type RunTimelineEvent,
  type SessionAttachment,
} from '../api/client';
import { ArtifactPanel } from '../components/Runs/ArtifactPanel';
import { InterventionPanel } from '../components/Runs/InterventionPanel';
import { BrowserPanel } from '../components/Chat/BrowserPanel';
import { AgentComposerCard, COMPOSER_TEXTAREA_MAX_HEIGHT } from '../components/Chat/AgentComposerCard';
import { AgentWorkspaceShell } from '../components/Chat/AgentWorkspaceShell';
import { RunTimeline } from '../components/Runs/RunTimeline';
import { ApprovalModeSelector } from '../components/ApprovalModeSelector';
import { pickPreferredModel, pickPreferredModelId } from '../lib/preferredModel';
import { ScrollArea } from '../components/ui';
import { ResponseContent } from '../components/Chat/responseContent';
import { readStructuredAnswer } from '../components/Runs/StructuredAnswerSurface';

type SendMode = 'stop-and-send' | 'queue' | 'steer';
type StartModeValue = RunTaskKind | 'auto';

interface QueuedRunMessage {
  id: string;
  content: string;
  attachmentIds: string[];
  attachments: SessionAttachment[];
  toolIds: string[];
  modelId?: string;
  mode: SendMode;
}

const MODEL_PREFERENCE_STORAGE_KEY = 'risk-agent.chat.composer.modelId';
const APPROVAL_MODE_STORAGE_KEY = 'risk-agent.chat.composer.approvalMode';
const CHAT_DRAFT_STORAGE_PREFIX = 'risk-agent.chat.draft.';
const CHAT_COMPOSER_HEIGHT_STORAGE_PREFIX = 'risk-agent.chat.composer.height.';
const CHAT_NEW_DRAFT_KEY = '__new__';
const CHAT_COMPOSER_MIN_HEIGHT = 60;

const STREAM_RUN_REFRESH_TYPES = new Set([
  'routed',
  'run_status',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'waiting_user',
  'user_input_received',
]);

const STREAM_ARTIFACT_REFRESH_TYPES = new Set([
  'artifact_updated',
  'run_completed',
  'run_failed',
  'run_cancelled',
]);

const SEND_MODE_LABELS: Record<SendMode, string> = {
  'stop-and-send': '停止并发送',
  queue: '添加到队列',
  steer: '通过消息引导',
};

// ── Client-side intent drift detection (mirrors RunRouter.ts patterns) ─────
// When user types in the composer during an active run, we detect if their
// input suggests a different task intent than the current run's task kind.
const INTENT_SKILL_SLASH = /^\/skills?\b/i;
const INTENT_SKILL_PATTERN = /(技能|skill loader|技能包|触发条件|触发器)/iu;
const EXTERNAL_SKILLS_CLI_PATTERN = /((?:^|\s)(?:npx|pnpm|npm|yarn)\s+skills?\b)|(\bskills\s+add\b)|(\B--skill\b)/iu;
const INTENT_ANALYSIS_VERB = /(分析|排查|诊断|评估|审查|review|audit|报告|调查|覆盖缺口|链路)/iu;
const INTENT_ANALYSIS_SUBJ = /(风控|风险|欺诈|支付|交易|登录|设备|信用|贷款|异常|场景|审核)/iu;
const INTENT_KNOWLEDGE = /(查询|检索|查找|图谱|文档|规则库)/iu;
const INTENT_GENERAL_CHAT = /(你好|hello|^hi$|你是谁|什么模型|天气|聊聊|解释一下|帮我解释|总结一下|继续聊)/iu;
const INTENT_GENERAL_UI = /(前端|界面|页面|组件|输入框|按钮|样式|布局|交互|截图|图片|图像|复刻|UI|dropdown|弹窗)/iu;
const INTENT_GENERAL_IMAGE_GUIDED = /(根据图|按图|参考图|看图|看这张图|根据截图|按截图|结合截图|结合图片)/iu;

function hasImageAttachment(attachments: SessionAttachment[]): boolean {
  return attachments.some((attachment) => attachment.contentType?.startsWith('image/'));
}

function detectComposerIntent(text: string, attachments: SessionAttachment[] = []): RunTaskKind | null {
  const t = text.trim();
  if (!t) return null;
  // External CLI skill installation (npx skills add, pnpm skills add, etc.) must go through
  // the general ReAct loop so shell_exec can be invoked — NOT skill-management.
  if (EXTERNAL_SKILLS_CLI_PATTERN.test(t)) return 'general';
  // Explicit /skills slash command → immediately route to skill-management (Hermes pattern)
  if (INTENT_SKILL_SLASH.test(t)) return 'skill-management';
  if (INTENT_SKILL_PATTERN.test(t)) return 'skill-management';
  if (INTENT_KNOWLEDGE.test(t)) return 'knowledge-query';
  if (INTENT_ANALYSIS_VERB.test(t) && INTENT_ANALYSIS_SUBJ.test(t)) return 'analysis';
  if (
    INTENT_GENERAL_CHAT.test(t) ||
    INTENT_GENERAL_UI.test(t) ||
    (hasImageAttachment(attachments) && INTENT_GENERAL_IMAGE_GUIDED.test(t))
  ) {
    return 'general';
  }
  return null;
}

function isExternalSkillsCliHelpPrompt(text: string): boolean {
  return EXTERNAL_SKILLS_CLI_PATTERN.test(text.trim());
}

function isRunNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
}

const INTENT_DRIFT_LABELS: Record<RunTaskKind, string> = {
  analysis: '切换到 风控分析',
  'knowledge-query': '切换到 知识检索',
  'skill-management': '切换到 技能管理',
  general: '切换到 通用对话',
};

interface StartModeOption {
  value: StartModeValue;
  label: string;
  eyebrow: string;
  description: string;
  detail: string;
  footerHint: string;
  examples: string[];
}

const START_MODE_OPTIONS: StartModeOption[] = [
  {
    value: 'auto',
    label: 'Auto',
    eyebrow: '自动分流',
    description: '让系统先判断是普通对话、资料查询、技能操作，还是需要直接进入风控分析。',
    detail: '适合还没完全定型的首条消息。只有识别到明确分析意图时，才会自动补齐业务主题并切到风控分析。',
    footerHint: '首次发送会自动进入最合适的工作流',
    examples: ['你好，先帮我看看应该怎么开始', '查询设备指纹相关规则', '分析电商支付的风险链路并给我排查报告'],
  },
  {
    value: 'general',
    label: '通用对话',
    eyebrow: '先聊清楚',
    description: '先把目标、范围和附件重点聊清楚，再决定要不要转成分析或检索。',
    detail: '适合需求澄清、整理截图或附件要点、先确认做法。',
    footerHint: '首次发送会创建通用会话',
    examples: ['你好，先帮我梳理下我该怎么开始', '读完附件后先给我提炼重点', '我想先确认这个任务应该怎么拆'],
  },
  {
    value: 'analysis',
    label: '风控分析',
    eyebrow: '直接分析',
    description: '直接开始场景排查、规则覆盖核对和风险摘要输出。',
    detail: '适合已经明确要做一轮风控诊断的情况，输入会直接作为分析主题。',
    footerHint: '首次发送会创建风控分析会话',
    examples: ['分析电商支付的风险链路', '排查异常登录的规则覆盖缺口', '给我一份贷款信用风控报告'],
  },
  {
    value: 'knowledge-query',
    label: '知识检索',
    eyebrow: '先查资料',
    description: '先查规则、文档和图谱，再决定是否升级为完整分析。',
    detail: '适合确认现状、定位已有规则或快速复用知识资产。',
    footerHint: '首次发送会创建知识检索会话',
    examples: ['查询设备指纹相关规则', '图谱里有哪些高风险实体关系', '检索贷款场景的 anomaly 规则'],
  },
  {
    value: 'skill-management',
    label: '技能管理',
    eyebrow: '能力管理',
    description: '查看、诊断、生成或改进技能与触发条件。',
    detail: '适合盘点当前能力边界，或给新流程搭好技能骨架。',
    footerHint: '首次发送会创建技能管理会话',
    examples: ['列出当前项目里的技能', '帮我设计一个新的技能', '检查某个技能为什么没有被触发'],
  },
];

const ROUTING_REASON_LABELS: Record<string, string> = {
  explicit_task_kind: '显式模式',
  phase1_keyword_match: '关键词匹配',
  phase1_default_analysis_route: '默认分析回退',
  semantic_capability_entry: 'Auto · 语义编排入口',
  phase2_auto_general_conversation: 'Auto · 通用对话',
  phase2_auto_lookup_route: 'Auto · 知识检索',
  phase2_auto_analysis_route: 'Auto · 风控分析',
  phase2_auto_skill_route: 'Auto · 技能管理',
};

const TERMINAL_RUN_STATUSES = new Set<RunSummary['status']>(['completed', 'failed', 'cancelled']);

interface MermaidMetricDiagram {
  id: string;
  title: string;
  source: string;
}

const MERMAID_BLOCK_PATTERN = /```mermaid\s*\n([\s\S]*?)```/giu;

function extractMermaidBlocks(content: string): string[] {
  const matches = content.matchAll(MERMAID_BLOCK_PATTERN);
  return [...matches]
    .map((match) => match[1]?.trim())
    .filter((diagram): diagram is string => Boolean(diagram));
}

function pushMermaidDiagrams(
  collection: MermaidMetricDiagram[],
  artifactId: string,
  title: string,
  content: string,
) {
  const diagrams = extractMermaidBlocks(content);
  diagrams.forEach((source, index) => {
    collection.push({
      id: `${artifactId}_${title}_${index}`,
      title: diagrams.length > 1 ? `${title} ${index + 1}` : title,
      source,
    });
  });
}

function extractMermaidMetricDiagrams(artifacts: RunArtifactRecord[]): MermaidMetricDiagram[] {
  const diagrams: MermaidMetricDiagram[] = [];
  const recentArtifacts = [...artifacts]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.version - left.version)
    .slice(0, 6);

  for (const artifact of recentArtifacts) {
    if (artifact.kind === 'structured-answer' && artifact.contentJson) {
      const structured = readStructuredAnswer(artifact.contentJson);
      if (!structured) {
        continue;
      }

      pushMermaidDiagrams(diagrams, artifact.artifactId, '最终回复', structured.primaryResponse);
      structured.auxiliarySections.forEach((section) => {
        section.items.forEach((item, index) => {
          const title = section.items.length > 1 ? `${section.label} ${index + 1}` : section.label;
          pushMermaidDiagrams(diagrams, artifact.artifactId, title, item);
        });
      });
      continue;
    }

    if (artifact.kind === 'markdown' && artifact.contentText) {
      pushMermaidDiagrams(diagrams, artifact.artifactId, 'Markdown 产物', artifact.contentText);
    }
  }

  return diagrams.slice(0, 3);
}

function getStartModeOption(taskKind: StartModeValue): StartModeOption {
  return START_MODE_OPTIONS.find((option) => option.value === taskKind) ?? START_MODE_OPTIONS[0];
}

function StartModeIcon({ taskKind, size = 18 }: { taskKind: StartModeValue; size?: number }) {
  if (taskKind === 'analysis') {
    return <IconShieldCheck size={size} />;
  }
  if (taskKind === 'knowledge-query') {
    return <IconRoute size={size} />;
  }
  if (taskKind === 'skill-management') {
    return <IconBolt size={size} />;
  }
  return <IconSparkles size={size} />;
}

function toggleStringItem(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('attachment_read_failed'));
        return;
      }
      const [, payload = result] = result.split(',', 2);
      resolve(payload);
    };
    reader.onerror = () => reject(new Error('attachment_read_failed'));
    reader.readAsDataURL(file);
  });
}

function readPreferredModelId(): string {
  try {
    return window.localStorage.getItem(MODEL_PREFERENCE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writePreferredModelId(modelId: string): void {
  try {
    if (modelId) {
      window.localStorage.setItem(MODEL_PREFERENCE_STORAGE_KEY, modelId);
      return;
    }
    window.localStorage.removeItem(MODEL_PREFERENCE_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the in-memory choice.
  }
}

function readApprovalMode(): RunApprovalMode {
  try {
    const stored = window.localStorage.getItem(APPROVAL_MODE_STORAGE_KEY);
    if (stored === 'bypass' || stored === 'autopilot') return stored;
    return 'default';
  } catch {
    return 'default';
  }
}

function writeApprovalMode(mode: RunApprovalMode): void {
  try {
    window.localStorage.setItem(APPROVAL_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures.
  }
}

function getComposerDraftStorageKey(runId: string): string {
  return `${CHAT_DRAFT_STORAGE_PREFIX}${runId || CHAT_NEW_DRAFT_KEY}`;
}

function getComposerHeightStorageKey(runId: string): string {
  return `${CHAT_COMPOSER_HEIGHT_STORAGE_PREFIX}${runId || CHAT_NEW_DRAFT_KEY}`;
}

function clampComposerHeight(height: number): number {
  return Math.min(Math.max(height, CHAT_COMPOSER_MIN_HEIGHT), COMPOSER_TEXTAREA_MAX_HEIGHT);
}

function buildChatRunStreamUrl(runId: string): string {
  const runtimeOverride = typeof window !== 'undefined'
    ? window.localStorage.getItem('risk-agent.apiBaseUrl')?.trim()
    : undefined;
  const envOverride = import.meta.env.VITE_API_BASE_URL?.trim();

  if (import.meta.env.DEV && !runtimeOverride && !envOverride) {
    return `/api/runs/${runId}/stream`;
  }

  const apiBase = runtimeOverride || envOverride || '/api';
  const normalizedBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  return `${normalizedBase}/runs/${runId}/stream`;
}

function readComposerDraft(runId: string): string {
  try {
    return window.localStorage.getItem(getComposerDraftStorageKey(runId)) ?? '';
  } catch {
    return '';
  }
}

function writeComposerDraft(runId: string, value: string): void {
  try {
    const storageKey = getComposerDraftStorageKey(runId);
    if (value) {
      window.localStorage.setItem(storageKey, value);
      return;
    }
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures and keep the in-memory draft.
  }
}

function readComposerHeight(runId: string): number | null {
  try {
    const rawValue = window.localStorage.getItem(getComposerHeightStorageKey(runId));
    if (!rawValue) {
      return null;
    }
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? clampComposerHeight(parsed) : null;
  } catch {
    return null;
  }
}

function writeComposerHeight(runId: string, height: number): void {
  try {
    window.localStorage.setItem(getComposerHeightStorageKey(runId), String(clampComposerHeight(height)));
  } catch {
    // ignore localStorage write failures
  }
}

function mergeTimelineEvents(existing: RunTimelineEvent[], incoming: RunTimelineEvent[]): RunTimelineEvent[] {
  if (existing.length === 0) {
    if (incoming.length === 0) {
      return existing;
    }
    return incoming;
  }
  if (incoming.length === 0) {
    return existing;
  }

  const merged = new Map<string, RunTimelineEvent>();
  const order: string[] = [];

  const pushEvent = (event: RunTimelineEvent) => {
    const key = event.eventId || `${event.type}:${event.createdAt}`;
    if (!merged.has(key)) {
      order.push(key);
    }
    merged.set(key, event);
  };

  existing.forEach(pushEvent);
  incoming.forEach(pushEvent);

  return order
    .map((key) => merged.get(key))
    .filter((event): event is RunTimelineEvent => Boolean(event))
    .sort((left, right) => {
      const leftAt = Date.parse(left.createdAt);
      const rightAt = Date.parse(right.createdAt);
      if (Number.isNaN(leftAt) || Number.isNaN(rightAt) || leftAt === rightAt) {
        return 0;
      }
      return leftAt - rightAt;
    });
}

function WelcomePanel({
  selectedTaskKind,
  onSelectTaskKind,
  onExampleSelect,
}: {
  selectedTaskKind: StartModeValue;
  onSelectTaskKind: (taskKind: StartModeValue) => void;
  onExampleSelect: (value: string) => void;
}) {
  const selectedMode = getStartModeOption(selectedTaskKind);
  const autoMode = selectedTaskKind === 'auto';

  // Keyboard shortcut: press 1-5 to select start mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < START_MODE_OPTIONS.length) {
        onSelectTaskKind(START_MODE_OPTIONS[idx]!.value);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectTaskKind]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-4 px-4 py-8">
      {/* ── Compact single card ───────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-surface-card/60 p-5">

        {/* Header row */}
        <div className="flex items-center gap-3 pb-4 border-b border-border/40">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
            <StartModeIcon taskKind={selectedTaskKind} size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-text">Risk Agent 智能助手</h2>
            <p className="mt-0.5 text-[12px] text-text-muted leading-5">
              {autoMode
                ? '先发第一条消息，系统会自动分配到合适的工作流。'
                : `从「${selectedMode.label}」启动，第一句直接进入对应流程。`}
            </p>
          </div>
        </div>

        {/* Mode tabs — compact horizontal row */}
        <div className="mt-3 flex gap-1">
          {START_MODE_OPTIONS.map((option, idx) => {
            const selected = option.value === selectedTaskKind;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelectTaskKind(option.value)}
                aria-label={`${option.label} 启动方式`}
                title={option.description}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-1.5 py-2 text-center transition-colors ${
                  selected
                    ? 'bg-accent/12 text-accent ring-1 ring-accent/25'
                    : 'text-text-muted hover:bg-surface-soft hover:text-text'
                }`}
              >
                <StartModeIcon taskKind={option.value} size={14} />
                <span className="text-[11px] font-medium leading-tight">{option.label}</span>
                <span className="font-mono text-[9px] text-text-subtle/50">{idx + 1}</span>
              </button>
            );
          })}
        </div>

        {/* Selected mode description */}
        <div className="mt-3 rounded-lg border border-border/50 bg-surface/50 px-3 py-2.5">
          <p className="text-[12px] text-text-muted leading-[1.6]">{selectedMode.description}</p>
          <p className="mt-1 text-[11px] text-accent/80">{selectedMode.footerHint}</p>
        </div>

        {/* Example quick starters */}
        <div className="mt-4 border-t border-border/40 pt-4">
          <p className="mb-2.5 text-[10px] uppercase tracking-[0.14em] text-text-subtle">快速起手</p>
          <div className="flex flex-wrap gap-2">
            {selectedMode.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onExampleSelect(example)}
                className="rounded-full border border-border/60 bg-surface px-3 py-1.5 text-[12px] text-text-muted transition-colors hover:border-accent/30 hover:text-text"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}



export function ChatPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentRunId = searchParams.get('run') ?? '';
  const composerDraftKey = getComposerDraftStorageKey(currentRunId);
  const composerHeightKey = getComposerHeightStorageKey(currentRunId);
  const [composerValue, setComposerValue] = useState(() => readComposerDraft(currentRunId));
  const [composerHeight, setComposerHeight] = useState<number | null>(() => readComposerHeight(currentRunId));
  const [selectedTaskKind, setSelectedTaskKind] = useState<StartModeValue>('auto');
  const [selectedModelId, setSelectedModelId] = useState(() => readPreferredModelId());
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [approvalMode, setApprovalModeState] = useState<RunApprovalMode>(() => readApprovalMode());
  const [composerAttachments, setComposerAttachments] = useState<SessionAttachment[]>([]);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<SendMode>('steer');
  const [queuedMessages, setQueuedMessages] = useState<QueuedRunMessage[]>([]);
  const [interventionInput, setInterventionInput] = useState('');
  const [sidePanelTab, setSidePanelTab] = useState<'artifacts' | 'intervention' | 'metrics' | 'browser'>('artifacts');
  const [streamEvents, setStreamEvents] = useState<RunTimelineEvent[]>([]);
  // Incrementing this key forces the SSE useLayoutEffect to re-run and establish a
  // fresh connection after a follow-up message is submitted. Without this, the effect
  // only re-runs when currentRunId changes (new runs), never for follow-up turns on
  // the same run, leaving Turn N+1 without an active SSE connection.
  const [sseConnectKey, setSseConnectKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueDispatchBlockedRef = useRef(false);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const seenStreamEventIdsRef = useRef(new Set<string>());
  const previousDraftKeyRef = useRef(composerDraftKey);
  const previousComposerHeightKeyRef = useRef(composerHeightKey);
  const runStatusRef = useRef<RunSummary['status'] | undefined>(undefined);
  const composerValueRef = useRef(composerValue);
  // Set to true when a follow-up message is submitted; cleared when the new SSE
  // turn receives its first live event. While true, onerror will not suppress
  // reconnection even if runStatusRef still shows a terminal status.
  const pendingFollowUpRef = useRef(false);

  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: listModels });
  const toolsQuery = useQuery({ queryKey: ['tools', 'chat'], queryFn: () => listTools() });
  const enabledModels = (modelsQuery.data ?? []).filter((model) => model.enabled);
  const availableTools = toolsQuery.data?.tools ?? [];
  const selectedModel = pickPreferredModel(enabledModels, selectedModelId);
  const backendOffline = modelsQuery.isError;
  const composerAttachmentIds = composerAttachments.map((attachment) => attachment.attachmentId);
  const selectedStartMode = useMemo(() => getStartModeOption(selectedTaskKind), [selectedTaskKind]);

  const runQuery = useQuery<RunSummary>({
    queryKey: ['chat-run', currentRunId],
    queryFn: () => getRun(currentRunId),
    enabled: Boolean(currentRunId),
    retry: (failureCount, error) => !isRunNotFoundError(error) && failureCount < 2,
    // Stop polling once run reaches a terminal state — SSE already delivers real-time updates
    refetchInterval: (query) => {
      const status = (query.state.data as RunSummary | undefined)?.status;
      if (status && TERMINAL_RUN_STATUSES.has(status)) return false;
      if (isRunNotFoundError(query.state.error)) return false;
      return 5000;
    },
  });
  const { data: run } = runQuery;
  const runNotFound = Boolean(currentRunId) && isRunNotFoundError(runQuery.error);

  const { data: fetchedEvents = [] } = useQuery<RunTimelineEvent[]>({
    queryKey: ['chat-run-events', currentRunId],
    queryFn: () => getRunEvents(currentRunId),
    enabled: Boolean(currentRunId) && !runNotFound,
    refetchOnWindowFocus: false,
  });

  const { data: artifacts = [] } = useQuery<RunArtifactRecord[]>({
    queryKey: ['chat-run-artifacts', currentRunId],
    queryFn: () => getRunArtifacts(currentRunId),
    enabled: Boolean(currentRunId) && !runNotFound,
    refetchOnWindowFocus: false,
    // Always treat cached artifact list as stale so invalidateQueries triggers
    // an immediate refetch. Without this, React Query may skip a background
    // refetch and the newly-produced artifact stays invisible until the next
    // render cycle that happens to trigger a cache miss.
    staleTime: 0,
  });
  const metricsMermaidDiagrams = useMemo(() => extractMermaidMetricDiagrams(artifacts), [artifacts]);

  const events = streamEvents;
  const handleComposerValueChange = useCallback((nextValue: string) => {
    setComposerValue(nextValue);
    writeComposerDraft(currentRunId, nextValue);
  }, [currentRunId]);

  const handleComposerHeightChange = useCallback((nextHeight: number) => {
    setComposerHeight(nextHeight);
    writeComposerHeight(currentRunId, nextHeight);
  }, [currentRunId]);

  useEffect(() => {
    runStatusRef.current = run?.status;
  }, [run?.status]);

  useEffect(() => {
    composerValueRef.current = composerValue;
  }, [composerValue]);

  useEffect(() => {
    if (previousDraftKeyRef.current === composerDraftKey) {
      return;
    }
    previousDraftKeyRef.current = composerDraftKey;
    const nextDraft = readComposerDraft(currentRunId);
    if (!nextDraft && composerValueRef.current) {
      writeComposerDraft(currentRunId, composerValueRef.current);
      return;
    }
    setComposerValue(nextDraft);
  }, [composerDraftKey, currentRunId]);

  useEffect(() => {
    if (previousComposerHeightKeyRef.current === composerHeightKey) {
      return;
    }
    previousComposerHeightKeyRef.current = composerHeightKey;
    setComposerHeight(readComposerHeight(currentRunId));
  }, [composerHeightKey, currentRunId]);

  useEffect(() => {
    setStreamEvents((prev) => mergeTimelineEvents(prev, fetchedEvents));
    seenStreamEventIdsRef.current = new Set(
      mergeTimelineEvents([], fetchedEvents)
        .map((event) => event.eventId)
        .filter((eventId): eventId is string => Boolean(eventId)),
    );
  }, [currentRunId, fetchedEvents]);

  // runLoaded tracks whether the run object has been fetched at least once.
  // It is added to the effect deps so SSE connection is established once `run`
  // arrives from React Query (the effect early-returns when run is null, so
  // without this dependency the connection would never be made on page refresh).
  const runLoaded = Boolean(run);
  useLayoutEffect(() => {
    if (!currentRunId) {
      setStreamEvents((prev) => (prev.length === 0 ? prev : []));
      seenStreamEventIdsRef.current.clear();
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    if (!run) {
      return;
    }

    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      clearReconnectTimer();
      eventSourceRef.current?.close();

      const source = new EventSource(buildChatRunStreamUrl(currentRunId));
      eventSourceRef.current = source;

      source.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as RunTimelineEvent;
          if (!event?.type) {
            return;
          }

          reconnectAttemptRef.current = 0;
          // First live event received — follow-up turn is now streaming.
          pendingFollowUpRef.current = false;

          if (event.eventId && seenStreamEventIdsRef.current.has(event.eventId)) {
            return;
          }

          if (event.eventId) {
            seenStreamEventIdsRef.current.add(event.eventId);
          }

          // Mark streaming updates as non-urgent so user input stays responsive.
          // This prevents visible jitter in the answer area when the user types
          // while text_delta events are streaming in concurrently.
          //
          // For terminal run events (run_completed/failed/cancelled): eagerly refetch
          // artifacts BEFORE adding the event to streamEvents. This ensures that when
          // buildTimelineGroups runs with the terminal event in streamEvents, the artifacts
          // array already contains the newest artifact. Without this, the latest assistant
          // turn shows only the metrics footer until the next React Query refetch cycle
          // (which often requires a manual page reload to trigger).
          const isTerminalRunEvent = event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled';
          if (isTerminalRunEvent) {
            void queryClient.refetchQueries({ queryKey: ['chat-run-artifacts', currentRunId] }).then(() => {
              startTransition(() => {
                setStreamEvents((prev) => mergeTimelineEvents(prev, [event]));
              });
            });
          } else {
            startTransition(() => {
              setStreamEvents((prev) => mergeTimelineEvents(prev, [event]));
            });
          }

          if (STREAM_RUN_REFRESH_TYPES.has(event.type)) {
            void queryClient.invalidateQueries({ queryKey: ['chat-run', currentRunId] });
          }

          if (STREAM_ARTIFACT_REFRESH_TYPES.has(event.type)) {
            void queryClient.invalidateQueries({ queryKey: ['chat-run-artifacts', currentRunId] });
          }
        } catch (sseParseErr) {
          if (import.meta.env.DEV) {
            console.warn('[Chat SSE] malformed payload, skipping event:', sseParseErr);
          }
          // Keep the stream alive — malformed payloads are non-fatal.
        }
      };

      source.onerror = () => {
        source.close();
        if (eventSourceRef.current === source) {
          eventSourceRef.current = null;
        }

        // Don't suppress reconnection if a follow-up was just submitted (pendingFollowUpRef)
        // even when runStatusRef still shows a terminal status from the previous turn.
        if (disposed || (!pendingFollowUpRef.current && runStatusRef.current && TERMINAL_RUN_STATUSES.has(runStatusRef.current))) {
          return;
        }

        reconnectAttemptRef.current += 1;
        const delayMs = Math.min(1000 * reconnectAttemptRef.current, 3000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delayMs);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  // Note: run?.status is intentionally omitted – runStatusRef.current is used inside
  // onerror to decide whether to reconnect, avoiding unnecessary SSE reconnects on
  // every status transition. runLoaded is included so the effect fires once `run`
  // arrives from React Query after a page refresh. sseConnectKey is incremented by
  // followUpMutation.onSuccess to force reconnect for each new follow-up turn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRunId, queryClient, runLoaded, sseConnectKey]);

  useEffect(() => () => {
    writeComposerDraft(currentRunId, composerValueRef.current);
  }, [currentRunId]);

  useEffect(() => {
    writePreferredModelId(selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    if (enabledModels.length === 0) return;
    const selectedStillEnabled = enabledModels.some((model) => model.modelId === selectedModelId);
    if (selectedStillEnabled) return;
    const fallbackModelId = pickPreferredModelId(enabledModels, selectedModelId);
    if (!fallbackModelId || fallbackModelId === selectedModelId) return;
    setSelectedModelId(fallbackModelId);
  }, [enabledModels, selectedModelId]);

  const handleApprovalModeChange = useCallback((mode: RunApprovalMode) => {
    setApprovalModeState(mode);
    writeApprovalMode(mode);
  }, []);

  useEffect(() => {
    if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) {
      queueDispatchBlockedRef.current = false;
    }
  }, [run?.status]);

  // Auto-switch to intervention tab when run enters waiting_user state
  useEffect(() => {
    if (run?.status === 'waiting_user') {
      setSidePanelTab('intervention');
    }
  }, [run?.status]);

  // Auto-scroll to bottom when new events arrive (only when user is near bottom)
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el || !currentRunId) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 320;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [events.length, currentRunId]);

  // Extract the latest waiting_user event — use backwards linear scan (O(n) but
  // avoids the O(n) array copy that [...events].reverse() would create).
  let pendingWaitingEvent: (typeof events)[number] | undefined;
  if (run?.status === 'waiting_user') {
    for (let _i = events.length - 1; _i >= 0; _i--) {
      if (events[_i]?.type === 'waiting_user') { pendingWaitingEvent = events[_i]; break; }
    }
  }
  const pendingQuestion = typeof pendingWaitingEvent?.payload?.question === 'string'
    ? pendingWaitingEvent.payload.question
    : undefined;
  const rawPendingOptions = pendingWaitingEvent?.payload?.options;
  const pendingOptions = Array.isArray(rawPendingOptions)
    ? rawPendingOptions.filter((o): o is string => typeof o === 'string')
    : [];
  const pendingRequestId = typeof pendingWaitingEvent?.payload?.requestId === 'string'
    ? pendingWaitingEvent.payload.requestId
    : undefined;

  const handleSkipIntervention = useCallback(() => {
    if (!pendingRequestId || !currentRunId) return;
    void submitRunInput(currentRunId, { requestId: pendingRequestId, option: '跳过' }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-run', currentRunId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-events', currentRunId] });
    });
  }, [currentRunId, pendingRequestId, queryClient]);

  const toggleToolSelection = useCallback((toolName: string) => {
    setSelectedToolIds((prev) => toggleStringItem(prev, toolName));
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.attachmentId !== attachmentId));
  }, []);

  const handleAttachmentFiles = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    setAttachmentError(null);
    setUploadingNames((prev) => [...prev, ...fileList.map((file) => file.name)]);

    try {
      const uploaded = await Promise.all(
        fileList.map(async (file) => {
          const dataBase64 = await readFileAsBase64(file);
          return uploadSessionAttachment({
            filename: file.name,
            contentType: file.type || undefined,
            dataBase64,
          });
        }),
      );

      setComposerAttachments((prev) => {
        const next = [...prev];
        for (const attachment of uploaded) {
          if (!next.some((item) => item.attachmentId === attachment.attachmentId)) {
            next.push(attachment);
          }
        }
        return next;
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'attachment_upload_failed');
    } finally {
      setUploadingNames((prev) => prev.filter((name) => !fileList.some((file) => file.name === name)));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const queueMessage = useCallback((content: string, mode: SendMode) => {
    setQueuedMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        content,
        attachmentIds: [...composerAttachmentIds],
        attachments: [...composerAttachments],
        toolIds: [...selectedToolIds],
        modelId: selectedModelId || selectedModel?.modelId,
        mode,
      },
    ]);
    handleComposerValueChange('');
    setComposerAttachments([]);
    setAttachmentError(null);
  }, [composerAttachmentIds, composerAttachments, handleComposerValueChange, selectedModel?.modelId, selectedModelId, selectedToolIds]);

  const createMutation = useMutation({
    mutationFn: () => {
      const trimmed = composerValue.trim();
      // Hermes pattern: when 'auto', detect explicit intent from message text before routing
      const clientDetected = selectedTaskKind === 'auto' ? detectComposerIntent(trimmed, composerAttachments) : null;
      const requestedTaskKind = selectedTaskKind === 'auto'
        ? (clientDetected ?? undefined)
        : selectedTaskKind === 'skill-management' && isExternalSkillsCliHelpPrompt(trimmed)
          ? 'general'
          : selectedTaskKind;
      const input: Record<string, unknown> = {
        prompt: trimmed,
        attachmentIds: composerAttachmentIds.length ? composerAttachmentIds : undefined,
        toolIds: selectedToolIds.length ? selectedToolIds : undefined,
      };

      if (requestedTaskKind === 'analysis') {
        input.businessName = trimmed;
      }

      return createRun({
        ...(requestedTaskKind ? { taskKind: requestedTaskKind } : {}),
        input,
        preferredModel: selectedModelId || selectedModel?.modelId || undefined,
        surface: 'web',
        approvalMode,
      });
    },
    onSuccess: (result) => {
      const next = new URLSearchParams(searchParams);
      next.set('run', result.runId);
      setSearchParams(next, { replace: true });
      handleComposerValueChange('');
      setComposerAttachments([]);
      setAttachmentError(null);
      queryClient.invalidateQueries({ queryKey: ['chat-run', result.runId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-events', result.runId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-artifacts', result.runId] });
    },
    onError: () => {
      // Restore composer state so the user can retry.
      setAttachmentError('发送失败，请重试');
    },
  });

  const followUpMutation = useMutation({
    mutationFn: (payload: RunComposerPayload) => appendRunMessage(currentRunId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-run', currentRunId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-events', currentRunId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-artifacts', currentRunId] });
      // Force SSE reconnect for the new execution turn. After the previous turn
      // completed, the server closed the SSE stream and the onerror handler
      // suppressed reconnection (run status was 'completed'). Incrementing
      // sseConnectKey causes useLayoutEffect to re-run and open a fresh SSE
      // connection to the newly-launched execution.
      reconnectAttemptRef.current = 0;
      pendingFollowUpRef.current = true;
      setSseConnectKey((k) => k + 1);
    },
    onError: () => {
      // Unblock queue dispatch so subsequent messages can retry.
      queueDispatchBlockedRef.current = false;
    },
  });

  const submitInterventionMutation = useMutation({
    mutationFn: () => submitRunInput(currentRunId, { input: interventionInput }),
    onSuccess: () => {
      setInterventionInput('');
      queryClient.invalidateQueries({ queryKey: ['chat-run', currentRunId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-events', currentRunId] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(currentRunId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-run', currentRunId] });
      queryClient.invalidateQueries({ queryKey: ['chat-run-events', currentRunId] });
    },
  });

  useEffect(() => {
    if (!currentRunId || !run || queuedMessages.length === 0 || followUpMutation.isPending || queueDispatchBlockedRef.current) {
      return;
    }
    if (!TERMINAL_RUN_STATUSES.has(run.status)) {
      return;
    }

    const [first, ...rest] = queuedMessages;
    queueDispatchBlockedRef.current = true;
    setQueuedMessages(rest);
    followUpMutation.mutate({
      content: first.content,
      modelId: first.modelId,
      attachmentIds: first.attachmentIds,
      toolIds: first.toolIds,
      mode: first.mode,
      approvalMode,
    });
  }, [currentRunId, followUpMutation, queuedMessages, run, approvalMode]);

  const handleSubmit = useCallback(() => {
    const trimmed = composerValue.trim();
    if (!trimmed) return;

    if (!currentRunId) {
      createMutation.mutate();
      return;
    }

    if (sendMode === 'queue' && run && !TERMINAL_RUN_STATUSES.has(run.status)) {
      queueMessage(trimmed, sendMode);
      return;
    }

    handleComposerValueChange('');
    setComposerAttachments([]);
    setAttachmentError(null);
    followUpMutation.mutate({
      content: trimmed,
      modelId: selectedModelId || selectedModel?.modelId || undefined,
      attachmentIds: composerAttachmentIds,
      toolIds: selectedToolIds,
      mode: sendMode,
      approvalMode,
    });
  }, [composerAttachmentIds, composerValue, createMutation, currentRunId, followUpMutation, handleComposerValueChange, queueMessage, run, selectedModel?.modelId, selectedModelId, selectedToolIds, sendMode]);

  const canCancel = run ? !TERMINAL_RUN_STATUSES.has(run.status) : false;
  const composerBusy = createMutation.isPending || followUpMutation.isPending;
  const composerRunning = run?.status === 'running' || composerBusy;
  const composerDisabled = composerBusy || runNotFound || (run?.status === 'waiting_user');
  const activeTaskKind = resolveRunDisplayTaskKind(run) ?? selectedTaskKind;
  const activeCapabilityKind = resolveRunCurrentCapability(run);
  const activeMode = useMemo(() => getStartModeOption(activeTaskKind), [activeTaskKind]);
  const statusLabel = useMemo(() => {
    if (runNotFound) return 'run 不存在';
    if (!run) return '等待第一轮';
    if (run.status === 'waiting_user') return '等待你的决策';
    if (run.status === 'running') return '执行中';
    if (run.status === 'completed') return '本轮完成';
    if (run.status === 'failed') return '执行失败';
    if (run.status === 'cancelled') return '已取消';
    return '准备继续';
  }, [run, runNotFound]);

  const clearCurrentRun = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('run');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Intent drift: detect if composer text diverges from the active run's task kind
  const composerDetectedIntent = useMemo(
    () => detectComposerIntent(composerValue, composerAttachments),
    [composerAttachments, composerValue],
  );
  const intentDrifts = Boolean(
    currentRunId &&
    composerDetectedIntent &&
    activeCapabilityKind &&
    composerDetectedIntent !== activeCapabilityKind,
  );

  const handleIntentSwitch = useCallback((taskKind: RunTaskKind) => {
    setSelectedTaskKind(taskKind as StartModeValue);
    setQueuedMessages([]);
    setSendMode('steer');

    if (!currentRunId) {
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.delete('run');
    setSearchParams(next, { replace: true });
  }, [currentRunId, searchParams, setSearchParams]);

  // Submit with an explicit mode — used by the action popup in AgentComposerCard
  const handleSubmitWithMode = useCallback((mode: SendMode) => {
    const trimmed = composerValue.trim();
    if (!trimmed || !currentRunId) return;
    if (mode === 'queue' && run && !TERMINAL_RUN_STATUSES.has(run.status)) {
      queueMessage(trimmed, mode);
      setSendMode(mode);
      return;
    }
    setSendMode(mode);
    handleComposerValueChange('');
    setComposerAttachments([]);
    setAttachmentError(null);
    followUpMutation.mutate({
      content: trimmed,
      modelId: selectedModelId || selectedModel?.modelId || undefined,
      attachmentIds: composerAttachmentIds,
      toolIds: selectedToolIds,
      mode,
      approvalMode,
    });
  }, [composerAttachmentIds, composerValue, currentRunId, followUpMutation, handleComposerValueChange, queueMessage, run, selectedModel?.modelId, selectedModelId, selectedToolIds]);

  const handleResendUserMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !currentRunId) return;

    followUpMutation.mutate({
      content: trimmed,
      modelId: selectedModelId || selectedModel?.modelId || undefined,
      attachmentIds: [],
      toolIds: selectedToolIds,
      mode: 'steer',
      approvalMode,
    });
  }, [currentRunId, followUpMutation, selectedModel?.modelId, selectedModelId, selectedToolIds]);

  const queueItems = useMemo(
    () => queuedMessages.map((message) => ({
      id: message.id,
      content: message.content,
      modeLabel: SEND_MODE_LABELS[message.mode],
      meta: [
        message.attachments.length > 0 ? `${message.attachments.length} 个附件` : '',
        message.toolIds.length > 0 ? `${message.toolIds.length} 个工具` : '',
      ].filter(Boolean),
    })),
    [queuedMessages],
  );

  const composerPlaceholder = useMemo(() => {
    if (!currentRunId) return '输入你的任务、补充约束，或粘贴附件开始…';
    if (runNotFound) return '当前 run 已失效，请先返回新对话…';
    if (run && !TERMINAL_RUN_STATUSES.has(run.status)) {
      if (sendMode === 'steer') return '通过消息引导当前 Agent 的执行方向…';
      if (sendMode === 'queue') return '输入消息，Agent 完成后自动发送…';
      return '输入消息后发送（会停止当前 Agent）…';
    }
    return '继续追问或补充新任务…';
  }, [currentRunId, runNotFound, run, sendMode]);

  const composer = (
    <AgentComposerCard
      key={composerHeightKey}
      value={composerValue}
      onValueChange={handleComposerValueChange}
      textareaHeight={composerHeight}
      onTextareaHeightChange={handleComposerHeightChange}
      placeholder={composerPlaceholder}
      disabled={composerDisabled}
      onSubmit={handleSubmit}
      submitLabel={composerBusy ? '发送中' : '发送'}
      busy={composerBusy}
      running={composerRunning}
      submitDisabled={!composerValue.trim()}
      footerHint={currentRunId ? `继续在当前 ${activeMode.label} run 内协作` : selectedStartMode.footerHint}
      footerBadges={
        run?.status === 'completed' ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2.5 py-0.5 text-[11px] text-success">
            <IconCircleCheck size={11} />
            可以继续追问
          </span>
        ) : null
      }
      models={enabledModels}
      selectedModelId={selectedModelId}
      onModelChange={setSelectedModelId}
      tools={availableTools}
      selectedToolIds={selectedToolIds}
      onToggleTool={toggleToolSelection}
      attachments={composerAttachments}
      onRemoveAttachment={removeComposerAttachment}
      onSelectFiles={handleAttachmentFiles}
      uploadingNames={uploadingNames}
      attachmentError={attachmentError}
      fileInputRef={fileInputRef}
      queueMessages={queueItems}
      onRemoveQueuedMessage={(id) => setQueuedMessages((prev) => prev.filter((item) => item.id !== id))}
      sendModes={
        currentRunId
          ? [
              { value: 'stop-and-send', label: '停止并发送' },
              { value: 'queue', label: '添加到队列' },
              { value: 'steer', label: '通过消息引导' },
            ]
          : []
      }
      selectedSendMode={currentRunId ? sendMode : undefined}
      onSelectSendMode={currentRunId ? (value) => setSendMode(value as SendMode) : undefined}
      onSubmitWithMode={currentRunId ? (mode) => handleSubmitWithMode(mode as SendMode) : undefined}
      canCancel={canCancel}
      onCancel={() => cancelMutation.mutate()}
      contextHeader={
        currentRunId ? (
          <div className="flex items-center gap-2 px-4 py-2">
            {/* Pulsing run indicator */}
            <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
              {canCancel ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </>
              ) : (
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${run?.status === 'completed' ? 'bg-success' : 'bg-border'}`} />
              )}
            </span>
            <span className="text-[11px] font-medium text-text-muted">{activeMode.label}</span>
            {run && (
              <>
                <span className="text-text-subtle/30">·</span>
                <span className="text-[11px] text-text-subtle/60">{statusLabel}</span>
              </>
            )}
            {intentDrifts && composerDetectedIntent && (
              <button
                type="button"
                onClick={() => handleIntentSwitch(composerDetectedIntent)}
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/8 px-2 py-px text-[10px] text-accent/80 transition-colors hover:bg-accent/14"
                title="切换到新的意图并保留当前输入与附件"
              >
                <IconAlertTriangle size={9} />
                {INTENT_DRIFT_LABELS[composerDetectedIntent]}
              </button>
            )}
          </div>
        ) : undefined
      }
      approvalModePicker={
        <ApprovalModeSelector
          value={approvalMode}
          onChange={handleApprovalModeChange}
          disabled={composerBusy}
        />
      }
      onPasteFiles={(files) => {
        void handleAttachmentFiles(files);
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      }}
      modeOptions={START_MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label, eyebrow: o.eyebrow }))}
      selectedMode={currentRunId ? activeTaskKind : selectedTaskKind}
      onModeChange={(v) => setSelectedTaskKind(v as StartModeValue)}
      hasActiveRun={Boolean(currentRunId)}
    />
  );

  const routingLabel = run ? (ROUTING_REASON_LABELS[run.routing.reason] ?? run.routing.reason) : '等待首轮创建';

  const main = (
    <div ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
      {!currentRunId ? (
        <WelcomePanel
          selectedTaskKind={selectedTaskKind}
          onSelectTaskKind={setSelectedTaskKind}
          onExampleSelect={handleComposerValueChange}
        />
      ) : (
        <div className="space-y-4 pb-4">
          {runNotFound && (
            <div className="rounded-[28px] border border-danger/20 bg-danger/6 p-6 shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-danger/10 text-danger">
                  <IconAlertTriangle size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text">当前对话 run 不存在或已失效。</p>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    这通常发生在后端重启、数据目录切换，或当前 URL 指向了一个已经不存在的历史 run。
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={clearCurrentRun}
                      className="inline-flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/15"
                    >
                      <IconMessagePlus size={14} />
                      返回新对话
                    </button>
                    <span className="text-xs text-text-subtle/70">当前链接中的 run id：{currentRunId.slice(-10)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Compact run status strip — LangAlpha-style single chip row */}
          <div className="flex items-center gap-2 pb-1">
            {/* Run state pulse dot */}
            <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
              {run && !TERMINAL_RUN_STATUSES.has(run.status) ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </>
              ) : (
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${run?.status === 'completed' ? 'bg-success' : run?.status === 'failed' ? 'bg-danger' : 'bg-border'}`} />
              )}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-accent/80">
              <StartModeIcon taskKind={activeTaskKind} size={10} />
              <span className="font-medium">{activeMode.label}</span>
            </span>
            <span className="text-[10px] text-text-subtle/50">·</span>
            <span className="text-[11px] text-text-subtle/65">{routingLabel}</span>
            {run && (
              <span className={`text-[10px] ${run.routing.confidence < 0.6 ? 'text-warning/70' : 'text-text-subtle/45'}`}>
                {Math.round(run.routing.confidence * 100)}%
              </span>
            )}
            {/* Low-confidence routing hint */}
            {run && run.routing.confidence < 0.6 && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/25 bg-warning/8 px-1.5 py-px text-[10px] text-warning/80">
                意图不确定
              </span>
            )}
            {/* Intent drift hint: user's input suggests a different task kind */}
            {intentDrifts && composerDetectedIntent && (
              <button
                type="button"
                onClick={() => handleIntentSwitch(composerDetectedIntent)}
                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-1.5 py-px text-[10px] text-accent/90 transition-colors hover:bg-accent/18"
                title="检测到意图切换，点击切换模式"
              >
                <IconAlertTriangle size={9} />
                {INTENT_DRIFT_LABELS[composerDetectedIntent]}
              </button>
            )}
            {selectedToolIds.length > 0 && (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border border-accent/12 bg-accent/6 px-1.5 py-px text-[10px] text-accent/70">
                <IconDatabase size={9} />{selectedToolIds.length}
              </span>
            )}
            {queuedMessages.length > 0 && (
              <span className="ml-auto rounded-full bg-warning/12 px-2 py-px text-[10px] font-medium text-warning">
                {queuedMessages.length} 排队
              </span>
            )}
          </div>
          {!runNotFound && (
            <RunTimeline
              events={events}
              run={run}
              artifacts={artifacts}
              onSwitchToArtifacts={() => setSidePanelTab('artifacts')}
              onResendUserMessage={handleResendUserMessage}
              onSubmitApproval={(requestId, option) => {
                void submitRunInput(currentRunId, { requestId, option }).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['chat-run', currentRunId] });
                  queryClient.invalidateQueries({ queryKey: ['chat-run-events', currentRunId] });
                });
              }}
            />
          )}
        </div>
      )}
    </div>
  );

  const aside = currentRunId ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/50 px-3 pb-2.5 pt-3">
        {/* Run ID + status */}
        <div className="mb-2.5 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              run?.status === 'completed' ? 'bg-success/10 text-success' :
              run?.status === 'running' ? 'bg-accent/10 text-accent' :
              run?.status === 'failed' ? 'bg-danger/10 text-danger' :
              run?.status === 'cancelled' ? 'bg-text-subtle/10 text-text-subtle' :
              'bg-surface text-text-muted'
            }`}
          >
            <StartModeIcon taskKind={activeTaskKind} size={10} />
            {statusLabel}
          </span>
          <span className="ml-auto select-all font-mono text-[9px] text-text-subtle/40" title={currentRunId}>
            {currentRunId.slice(-10)}
          </span>
        </div>
        {/* Compact tab row */}
        <div className="flex items-center gap-0.5 rounded-xl bg-surface p-0.5">
          {([
            ['artifacts', 'Artifacts', artifacts.length > 0 ? String(artifacts.length) : null],
            ['intervention', 'Input', null],
            ['browser', 'Browser', null],
            ['metrics', 'Metrics', null],
          ] as const).map(([value, label, badge]) => {
            const selected = sidePanelTab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSidePanelTab(value)}
                className={`relative flex flex-1 items-center justify-center gap-1 rounded-[10px] px-2 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'bg-surface-card text-text shadow-[0_2px_8px_rgba(0,0,0,0.12)]'
                    : 'text-text-subtle hover:bg-surface-card/50 hover:text-text-muted'
                }`}
              >
                {label}
                {badge && (
                  <span
                    className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-semibold ${
                      selected ? 'bg-accent/15 text-accent' : 'bg-border/50 text-text-subtle'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4">
        {runNotFound ? (
          <div className="rounded-[24px] border border-danger/20 bg-danger/6 px-4 py-4">
            <p className="text-xs tracking-[0.18em] text-text-subtle">运行状态</p>
            <p className="mt-2 text-sm font-semibold text-text">找不到当前 run</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">请返回新对话后重新发起任务，避免继续轮询一个失效链接。</p>
          </div>
        ) : (
          <>
        {sidePanelTab === 'artifacts' && (
          <ScrollArea className="h-full pr-2">
            <ArtifactPanel artifacts={artifacts} runStatus={run?.status} />
          </ScrollArea>
        )}
        {sidePanelTab === 'intervention' && (
          <ScrollArea className="h-full pr-2">
            <InterventionPanel
              runId={currentRunId}
              status={run?.status ?? 'created'}
              value={interventionInput}
              onChange={setInterventionInput}
              onSubmit={() => submitInterventionMutation.mutate()}
              onSkip={pendingRequestId ? handleSkipIntervention : undefined}
              busy={submitInterventionMutation.isPending}
              pendingQuestion={pendingQuestion}
              pendingOptions={pendingOptions}
            />
          </ScrollArea>
        )}
        {sidePanelTab === 'browser' && (
          <ScrollArea className="h-full pr-2">
            <BrowserPanel runId={currentRunId} />
          </ScrollArea>
        )}
        {sidePanelTab === 'metrics' && (
          <ScrollArea className="h-full pr-2">
            {run ? (
              <div className="space-y-3 pb-4">
                <div className="rounded-[18px] border border-border bg-surface-card/60 px-4 py-3">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-text-subtle">运行状态</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">状态</span>
                      <span className="text-xs font-medium text-text">{statusLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">路由</span>
                      <span className="max-w-[140px] truncate text-right text-xs text-text">{routingLabel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">置信度</span>
                      <span className="text-xs text-text">{Math.round(run.routing.confidence * 100)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">Run ID</span>
                      <span className="max-w-[140px] truncate text-right font-mono text-[10px] text-text-muted">{run.runId}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Turns', value: String(run.metrics.turnCount) },
                    { label: 'Tools', value: String(run.metrics.toolCallCount) },
                    { label: 'Tokens', value: String(run.metrics.inputTokens + run.metrics.outputTokens) },
                    { label: 'Cost', value: `$${run.metrics.estimatedUsd.toFixed(4)}` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col items-center rounded-[14px] border border-border bg-surface px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">{label}</p>
                      <p className="mt-1 text-sm font-semibold text-text">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-[18px] border border-border bg-surface-card/60 px-4 py-3">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-text-subtle">时间信息</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-text-muted">创建时间</span>
                      <span className="text-xs text-text">{new Date(run.createdAt).toLocaleTimeString()}</span>
                    </div>
                    {run.completedAt && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-text-muted">完成时间</span>
                        <span className="text-xs text-text">{new Date(run.completedAt).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                </div>
                {metricsMermaidDiagrams.length > 0 && (
                  <div className="rounded-[18px] border border-border bg-surface-card/60 px-4 py-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-text-subtle">
                        <IconRoute size={11} className="text-accent/75" />
                        流程图
                      </div>
                      <span className="text-[10px] text-text-subtle/70">检测到 Mermaid 输出后自动渲染</span>
                    </div>

                    <div className="space-y-3">
                      {metricsMermaidDiagrams.map((diagram) => (
                        <section key={diagram.id} className="rounded-[16px] border border-border/70 bg-surface px-3 py-3">
                          <p className="mb-2 text-[11px] font-medium text-text">{diagram.title}</p>
                          <ResponseContent content={`\`\`\`mermaid\n${diagram.source}\n\`\`\``} />
                        </section>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-muted">运行完成后将显示执行指标。</p>
            )}
          </ScrollArea>
        )}
          </>
        )}
      </div>
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
      <div className="rounded-[28px] border border-border bg-surface-card/88 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
        <p className="text-[11px] tracking-[0.18em] text-text-subtle">启动摘要</p>
        {backendOffline && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-danger/25 bg-danger/8 px-2.5 py-1.5">
            <IconWifiOff size={12} className="shrink-0 text-danger/80" />
            <span className="text-[11px] text-danger/80">后端服务未连接</span>
          </div>
        )}
        <div className="mt-4 flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <StartModeIcon taskKind={selectedTaskKind} size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text">{selectedStartMode.label}</p>
            <p className="mt-1 text-xs leading-6 text-text-muted">{selectedStartMode.detail}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className={`rounded-[24px] border px-4 py-4 ${modelsQuery.isError ? 'border-danger/25 bg-danger/5' : 'border-border bg-surface'}`}>
          <p className="text-xs tracking-[0.18em] text-text-subtle">模型</p>
          {modelsQuery.isLoading ? (
            <div className="mt-2 flex items-center gap-2">
              <IconLoader2 size={13} className="animate-spin text-text-muted" />
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          ) : modelsQuery.isError ? (
            <div className="mt-2">
              <div className="flex items-center gap-1.5">
                <IconWifiOff size={13} className="shrink-0 text-danger" />
                <p className="text-sm font-medium text-danger">服务器未连接</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">请确认后端服务已启动（默认端口 8787）。</p>
              <Link
                to="/settings"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
              >
                <IconSettings2 size={11} />
                前往系统设置
              </Link>
            </div>
          ) : selectedModel ? (
            <>
              <p className="mt-2 text-sm font-semibold text-text">{selectedModel.modelName}</p>
              <p className="mt-1 text-xs leading-6 text-text-muted">首轮会沿用当前默认模型，后续可以在同一 run 内继续覆盖。</p>
            </>
          ) : (
            <div className="mt-2">
              <div className="flex items-center gap-1.5">
                <IconAlertTriangle size={13} className="shrink-0 text-warning" />
                <p className="text-sm font-medium text-text">未发现可用模型</p>
              </div>
              <Link
                to="/settings"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
              >
                <IconSettings2 size={11} />
                前往设置添加模型
              </Link>
            </div>
          )}
        </div>
        <div className="rounded-[24px] border border-border bg-surface px-4 py-4">
          <p className="text-xs tracking-[0.18em] text-text-subtle">工具</p>
          <p className="mt-2 text-sm font-semibold text-text">{selectedToolIds.length > 0 ? `${selectedToolIds.length} 个显式启用` : '默认工具集'}</p>
          <p className="mt-1 text-xs leading-6 text-text-muted">如果先只想聊天，可以保持默认；如果要约束能力边界，再勾选具体工具。</p>
        </div>
        <div className="rounded-[24px] border border-border bg-surface px-4 py-4">
          <p className="text-xs tracking-[0.18em] text-text-subtle">首轮影响</p>
          <p className="mt-2 text-sm font-semibold text-text">首条消息会进入 {selectedStartMode.label} 工作流</p>
          <p className="mt-1 text-xs leading-6 text-text-muted">
            {selectedTaskKind === 'analysis'
              ? '分析模式会把输入同时视为分析入口和业务主题。'
              : selectedTaskKind === 'auto'
                ? 'Auto 只有在识别到明确分析意图时，才会自动补齐业务主题并切到风控分析。'
                : '当前不会隐式切回风控分析，适合先确认上下文。'}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <AgentWorkspaceShell
      eyebrow="智能聊天"
      title="Agent 工作台"
      status={
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">
          <StartModeIcon taskKind={activeTaskKind} size={12} />
          {statusLabel}
        </span>
      }
      meta={
        currentRunId ? (
          <span className="flex items-center gap-2 text-[10px] text-text-subtle/55">
            <span className="font-mono select-all" title={currentRunId}>{currentRunId.slice(-10)}</span>
            {run?.createdAt && (
              <>
                <span className="text-text-subtle/30">·</span>
                <span>{new Date(run.createdAt).toLocaleTimeString()}</span>
              </>
            )}
          </span>
        ) : (
          <span>默认推荐 Auto，需要时再明确指定分析、检索或技能管理。</span>
        )
      }
      actions={
        <div className="flex items-center gap-2">
          {canCancel && (
            <button
              type="button"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
            >
              {cancelMutation.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerStop size={14} />}
              {cancelMutation.isPending ? '取消中' : '停止运行'}
            </button>
          )}
          {currentRunId && (
            <Link
              to={`/browser?session=${encodeURIComponent(currentRunId)}`}
              className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs text-text-subtle transition-colors hover:bg-surface-card hover:text-text"
            >
              <IconRoute size={14} />
              {t('browser.openWorkspace', '浏览器工作区')}
            </Link>
          )}
          {currentRunId && (
            <button
              type="button"
              onClick={clearCurrentRun}
              title="新建对话"
              aria-label="新建对话"
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 text-text-subtle transition-colors hover:bg-surface-card hover:text-text"
            >
              <IconMessagePlus size={15} />
            </button>
          )}
        </div>
      }
      main={main}
      composer={composer}
      aside={aside}
      asideTitle="状态与产物"
    />
  );
}
