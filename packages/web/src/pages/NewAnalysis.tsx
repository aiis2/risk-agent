import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  IconSettings2,
  IconLoader2,
  IconShieldCheck,
  IconCurrencyDollar,
  IconChevronDown,
  IconCircle,
  IconCircleCheckFilled,
  IconBrain,
  IconLanguage,
  IconRobot,
  IconFileText,
  IconPhoto,
} from '@tabler/icons-react';
import {
  appendSessionMessage,
  cancelSession,
  getSession,
  listModels,
  listScenarios,
  listSessions,
  listTools,
  startSession,
  uploadSessionAttachment,
} from '../api/client';
import type { SessionAttachment } from '../api/client';
import { useAgentProgress } from '../hooks/useAgentProgress';
import { AG2UActionCard } from '../components/AG2UActionCard';
import { AnalysisSignalStack, AnalysisStepCounter } from '../components/Analysis/AnalysisSignalStack';
import { SessionWorkspaceAside } from '../components/Analysis/SessionWorkspaceAside';
import { AgentComposerCard, COMPOSER_TEXTAREA_MAX_HEIGHT } from '../components/Chat/AgentComposerCard';
import { AgentWorkspaceShell } from '../components/Chat/AgentWorkspaceShell';
import { ThinkingBlock } from '../components/Chat/ThinkingBlock';
import { ToolCallBlock } from '../components/Chat/ToolCallBlock';
import { ResponseContent, CopyButton } from '../components/Chat/responseContent';
import { pickPreferredModel, pickPreferredModelId } from '../lib/preferredModel';
import { useChatStore, SESSION_STATE_LABELS } from '../stores/chatStore';
import { useSessionStore } from '../stores/sessionStore';
import type { ChatMessage, ChatConversation } from '../stores/chatStore';
import type { StreamEventLike as _StreamEventLike } from '../hooks/useAgentProgress';
import { ScrollArea } from '../components/ui/ScrollArea';

const MODEL_PREFERENCE_STORAGE_KEY = 'risk-agent.analysis.composer.modelId';
const SESSION_RUNTIME_TOOL_NAMES = new Set([
  'ask_user',
  'query_database',
  'get_database_schema',
  'query_database_external',
  'graph_query',
  'vector_search',
  'datasource_knowledge_search',
  'datasource_knowledge_graph',
  'file_parse',
  'web_fetch',
  'tool_search',
]);

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
    // ignore storage failures
  }
}

interface QueuedComposerMessage {
  id: string;
  content: string;
  attachmentIds: string[];
  attachments: SessionAttachment[];
  toolIds: string[];
  mode: SendMode;
}

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(contentType: string) {
  if (contentType.startsWith('image/')) {
    return IconPhoto;
  }
  return IconFileText;
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

// 鈹€鈹€鈹€ Session state color helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function stateColor(state: string) {
  switch (state) {
    case 'thinking': return 'text-accent';
    case 'tool_running': return 'text-warn';
    case 'waiting_user': return 'text-warn';
    case 'compacting': return 'text-text-dim';
    case 'subagent_running': return 'text-accent';
    case 'correcting': return 'text-warn';
    case 'done': return 'text-success';
    case 'error': return 'text-danger';
    default: return 'text-text-muted';
  }
}

function stateBg(state: string) {
  switch (state) {
    case 'thinking': return 'border-accent/20 bg-accent/10';
    case 'tool_running': return 'border-warn/20 bg-warn/10';
    case 'waiting_user': return 'border-warn/20 bg-warn/10';
    case 'subagent_running': return 'border-accent/20 bg-accent/10';
    case 'correcting': return 'border-warn/20 bg-warn/10';
    case 'done': return 'border-success/20 bg-success/10';
    case 'error': return 'border-danger/20 bg-danger/10';
    default: return 'border-border/50 bg-surface-soft';
  }
}

// ─── User message bubble ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function UserMessage({ content, attachments }: { content: string; attachments?: SessionAttachment[] }) {
  return (
    <div className="mb-2 flex justify-end">
      <div className="sse-user-request-shell max-w-[760px] overflow-hidden rounded-xl rounded-br-sm border border-accent/20 px-3 py-2.5">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-text">{content}</p>
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {attachments.map((attachment) => {
              const AttachmentIcon = attachmentIcon(attachment.contentType);
              return (
                <div
                  key={attachment.attachmentId}
                  className="flex max-w-full items-center gap-2 rounded-lg border border-accent/20 bg-accent/10 px-2.5 py-1.5 text-[11px] text-text-dim"
                >
                  <AttachmentIcon size={12} className="shrink-0 text-accent" />
                  <span className="truncate">{attachment.filename}</span>
                  <span className="shrink-0 text-text-muted">{formatAttachmentSize(attachment.sizeBytes)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agent Steps Panel ──────────────────────────────────────────────────────
// Unified replacement for CompletedOpsRows + SubtaskProgressPanel + tool sections
// Inspired by auto_report AgentStepsPanel pattern

type StepStatus = 'running' | 'done' | 'error' | 'queued';

function StepRow({
  label,
  detail,
  status,
  children,
}: {
  label: string;
  detail?: string;
  status: StepStatus;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(children);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={clsx(
          'flex items-start gap-2.5 px-3 py-2',
          hasDetail && status === 'done' ? 'cursor-pointer hover:bg-surface-hover/20' : 'cursor-default',
        )}
        onClick={() => hasDetail && status === 'done' && setOpen((v) => !v)}
        onKeyDown={(e) => e.key === 'Enter' && hasDetail && status === 'done' && setOpen((v) => !v)}
      >
        <span className="mt-0.5 flex h-3.5 shrink-0 items-center justify-center">
          {status === 'running' ? (
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />
          ) : status === 'done' ? (
            <IconCircleCheckFilled size={12} className="text-success/60" />
          ) : status === 'error' ? (
            <IconCircle size={12} className="text-danger" />
          ) : (
            <IconCircle size={12} className="text-text-muted/40" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <span
            className={clsx(
              'text-[12px] leading-5',
              status === 'done'
                ? 'text-text-dim'
                : status === 'running'
                  ? 'font-medium text-text'
                  : 'text-text',
            )}
          >
            {label}
          </span>
          {detail && status === 'running' && (
            <p className="truncate text-[11px] text-text-dim">{detail}</p>
          )}
        </div>
        {hasDetail && status === 'done' && (
          <IconChevronDown
            size={10}
            className={clsx('mt-1 shrink-0 text-text-muted/60 transition-transform', !open && '-rotate-90')}
          />
        )}
      </div>
      {open && children && (
        <div className="border-t border-border-subtle/25 px-3 py-2">{children}</div>
      )}
    </div>
  );
}

function AgentStepsPanel({
  tools,
  workers,
  tasks,
  isStreaming,
}: {
  tools: ChatMessage['toolCalls'];
  workers: Array<NonNullable<ChatConversation['workers'][string]>>;
  tasks: Array<ChatConversation['dreamTasks'][string]>;
  isStreaming: boolean;
}) {
  const allToolsDone = tools.every((t) => t.status === 'done' || t.status === 'error');
  const allWorkersDone = workers.every((w) => w.status === 'done');
  const allTasksDone = tasks.every((t) => t.status === 'completed' || t.status === 'failed');
  const allDone = !isStreaming || (allToolsDone && allWorkersDone && allTasksDone);
  const hasError = tasks.some((t) => t.status === 'failed') || tools.some((t) => t.status === 'error');

  const [collapsed, setCollapsed] = useState(!isStreaming);

  useEffect(() => {
    if (allDone && !hasError) {
      const timer = setTimeout(() => setCollapsed(true), 1500);
      return () => clearTimeout(timer);
    }
    if (!allDone || hasError) setCollapsed(false);
  }, [allDone, hasError]);

  const totalSteps = tools.length + workers.length + tasks.length;
  if (totalSteps === 0) return null;

  const doneCount =
    tools.filter((t) => t.status === 'done' || t.status === 'error').length +
    workers.filter((w) => w.status === 'done').length +
    tasks.filter((t) => t.status === 'completed' || t.status === 'failed').length;

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle/60">
      <button
        type="button"
        onClick={() => allDone && setCollapsed((v) => !v)}
        className={clsx(
          'flex w-full select-none items-center gap-2 px-3 py-2 text-left transition-colors',
          !allDone ? 'cursor-default' : 'hover:bg-surface-hover/30',
        )}
      >
        {!allDone ? (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />
        ) : hasError ? (
          <IconCircle size={12} className="shrink-0 text-danger" />
        ) : (
          <IconCircleCheckFilled size={12} className="shrink-0 text-success" />
        )}
        <span
          className={clsx(
            'flex-1 text-[12px] font-medium',
            !allDone ? 'text-accent' : hasError ? 'text-danger' : 'text-text-muted',
          )}
        >
          {!allDone
            ? `执行中…（${doneCount}/${totalSteps}）`
            : hasError
              ? `已执行 ${totalSteps} 步（含错误）`
              : `已完成 ${totalSteps} 步操作`}
        </span>
        {allDone && (
          <IconChevronDown
            size={11}
            className={clsx('shrink-0 text-text-muted transition-transform duration-200', collapsed && '-rotate-90')}
          />
        )}
      </button>
      {!collapsed && (
        <div className="divide-y divide-border-subtle/25">
          {workers.map((w) => (
            <StepRow
              key={w.agentId}
              label={w.description || w.role || w.agentId}
              detail={w.summary ?? w.progress[w.progress.length - 1]}
              status={w.status === 'done' ? 'done' : 'running'}
            >
              {w.summary ? <p className="text-[11px] leading-relaxed text-text-dim">{w.summary}</p> : null}
            </StepRow>
          ))}
          {tasks.map((t) => (
            <StepRow
              key={t.taskId}
              label={t.description || t.taskId}
              detail={t.summary ?? t.progress[t.progress.length - 1]}
              status={
                t.status === 'completed'
                  ? 'done'
                  : t.status === 'failed'
                    ? 'error'
                    : t.status === 'queued'
                      ? 'queued'
                      : 'running'
              }
            >
              {t.summary ? <p className="text-[11px] leading-relaxed text-text-dim">{t.summary}</p> : null}
            </StepRow>
          ))}
          {tools.map((tc) => (
            <StepRow
              key={tc.callId}
              label={tc.toolName}
              status={tc.status === 'done' ? 'done' : tc.status === 'error' ? 'error' : 'running'}
            >
              <ToolCallBlock tool={tc} />
            </StepRow>
          ))}
        </div>
      )}
    </div>
  );
}

// 鈹€鈹€鈹€ Assistant message bubble 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function AssistantMessage({
  msg,
  conv,
  isStreaming,
}: {
  msg: ChatMessage;
  conv: ChatConversation;
  isStreaming: boolean;
}) {
  const hasContent = msg.content || msg.thinking || msg.toolCalls.length > 0 || msg.workerIds.length > 0;
  if (!hasContent) return null;

  const workers = msg.workerIds
    .map((workerId) => conv.workers[workerId])
    .filter((worker): worker is NonNullable<typeof worker> => Boolean(worker));
  const dreamTasks =
    msg.role === 'assistant' && conv.messages[conv.messages.length - 1]?.id === msg.id
      ? Object.values(conv.dreamTasks)
      : [];
  const totalTokens = conv.totalInputTokens + conv.totalOutputTokens;
  const hasSteps = msg.toolCalls.length > 0 || workers.length > 0 || dreamTasks.length > 0;

  return (
    <div className="mb-4 flex items-start gap-2.5">
      {/* Avatar */}
      <div
        className={clsx(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border',
          isStreaming
            ? 'border-accent/35 bg-accent/10 sse-assistant-avatar-live'
            : 'border-border-subtle bg-surface-card/90'
        )}
      >
        <IconRobot size={13} className={clsx('text-accent', isStreaming && 'animate-pulse')} />
      </div>

      <div className="min-w-0 max-w-[920px] flex-1 space-y-2">
        {/* ── Step counter (only while streaming) ── */}
        {isStreaming && (
          <AnalysisStepCounter
            turnNumber={msg.turnNumber}
            totalTokens={totalTokens}
            isStreaming={isStreaming}
          />
        )}

        {/* ── Deep thinking block ── */}
        {msg.thinking && (
          <CollapsibleSection
            label={isStreaming && !msg.content ? '深度思考中' : '推理轨迹'}
            isLive={isStreaming && !msg.content}
            defaultExpanded={isStreaming && !msg.content}
            accentColor="accent"
          >
            <ThinkingBlock text={msg.thinking} streaming={isStreaming && !msg.content} />
          </CollapsibleSection>
        )}

        {/* ── Unified agent steps panel (tools + workers + tasks) ── */}
        {hasSteps && (
          <AgentStepsPanel
            tools={msg.toolCalls}
            workers={workers}
            tasks={dreamTasks}
            isStreaming={isStreaming}
          />
        )}

        {/* ── Final content ── */}
        {msg.content && (
          <div className="sse-content-panel group/content relative rounded-xl border border-border-subtle/60 bg-surface-card/30 px-3.5 py-3">
            {!isStreaming && (
              <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/content:opacity-100">
                <CopyButton text={msg.content} />
              </div>
            )}
            <ResponseContent content={msg.content} streaming={isStreaming && !msg.toolCalls.length} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Collapsible Section ─────────────────────────────────────────────────────
// Compact expandable section used for thinking, tool calls, workers

function CollapsibleSection({
  label,
  count,
  isLive = false,
  defaultExpanded = false,
  accentColor = 'default',
  children,
}: {
  label: string;
  count?: number;
  isLive?: boolean;
  defaultExpanded?: boolean;
  accentColor?: 'accent' | 'default';
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle/60">
      <button
        type="button"
        onClick={() => !isLive && setExpanded((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
          isLive ? 'cursor-default' : 'hover:bg-surface-hover/40'
        )}
      >
        {isLive ? (
          <>
            <IconBrain size={12} className="shrink-0 animate-pulse text-accent" />
            <span className="flex-1 text-[12px] font-medium text-accent">{label}</span>
            <span className="flex items-end gap-0.5">
              <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
              <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:120ms]" />
              <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:240ms]" />
            </span>
          </>
        ) : (
          <>
            <span className={clsx('flex-1 text-[12px] font-medium', accentColor === 'accent' ? 'text-accent' : 'text-text')}>
              {label}
            </span>
            {count !== undefined && (
              <span className="text-[11px] text-text-muted">{count}</span>
            )}
            <IconChevronDown
              size={12}
              className={clsx('shrink-0 text-text-muted transition-transform duration-200', !expanded && '-rotate-90')}
            />
          </>
        )}
      </button>
      {(isLive || expanded) && (
        <div className="border-t border-border-subtle/40 px-3 py-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Welcome State ────────────────────────────────────────────────────────────
function EmptyState({ onQuickStart }: { onQuickStart: (name: string) => void }) {
  const suggestions = [
    { label: '电商支付风控', desc: '端到端支付流程的风险识别与评估' },
    { label: '贷款反欺诈分析', desc: '识别信贷申请中的欺诈行为' },
    { label: '账户安全评估', desc: '用户账户被盗与异常登录检测' },
    { label: '供应链风险评估', desc: '供应商合规与交易风险分析' },
  ];
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15">
        <IconShieldCheck size={24} className="text-accent" />
      </div>
      <h2 className="mb-1.5 text-lg font-semibold text-text">Risk Agent 智能体</h2>
      <p className="mb-7 max-w-sm text-sm text-text-muted">
        输入业务名称，启动 ReAct 智能体进行全面风险分析，生成专业风控报告
      </p>
      <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onQuickStart(s.label)}
            className="group rounded-xl border border-border-subtle bg-surface-card p-3 text-left transition-all hover:border-accent/40 hover:bg-surface-soft"
          >
            <p className="text-sm font-medium text-text transition-colors group-hover:text-accent">{s.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{s.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// 发送模式：参考 VS Code Copilot Chat 三种引导模式
type SendMode = 'stop-and-send' | 'queue' | 'steer';

const SEND_MODE_LABELS: Record<SendMode, string> = {
  'stop-and-send': '停止并发送',
  'queue': '添加到队列',
  'steer': '通过消息引导',
};

export function NewAnalysis() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedRef = useRef(0);
  const lastSessionIdRef = useRef<string | null>(null);
  const historyBootstrapKeyRef = useRef<string | null>(null);

  const [form, setForm] = useState({
    businessName: '',
    description: '',
    scenarioIds: [] as string[],
    bizTypes: '',
    ruleTypes: '',
    locale: 'zh-CN',
    modelId: readPreferredModelId() as string,
  });
  const [followUpInput, setFollowUpInput] = useState('');
  const [streamReconnectKey, setStreamReconnectKey] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [forceStopped, setForceStopped] = useState(false);
  const [composerAttachments, setComposerAttachments] = useState<SessionAttachment[]>([]);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  // 发送模式和消息队列（VS Code Copilot Chat 引导模式）
  const [sendMode, setSendMode] = useState<SendMode>('steer');
  const [queuedMessages, setQueuedMessages] = useState<QueuedComposerMessage[]>([]);
  const sessionId = searchParams.get('session');
  const isResume = Boolean(sessionId && searchParams.get('resume') === '1');

  const chatStore = useChatStore();
  const openSessionIds = useSessionStore((state) => state.openSessionIds);
  const workspaceSessionsById = useSessionStore((state) => state.sessionsById);
  const openWorkspaceSession = useSessionStore((state) => state.openSession);
  const closeWorkspaceSession = useSessionStore((state) => state.closeSession);
  const syncWorkspaceSessionMeta = useSessionStore((state) => state.syncSessionMeta);
  const setWorkspaceActiveSessionId = useSessionStore((state) => state.setActiveSessionId);
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: listScenarios });
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: listModels });
  const toolsQuery = useQuery({ queryKey: ['tools', 'composer'], queryFn: () => listTools() });
  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: listSessions,
    refetchInterval: 5_000,
  });
  const enabledModels = (modelsQuery.data ?? []).filter((m) => m.enabled);
  const availableTools = (toolsQuery.data?.tools ?? []).filter((tool) => SESSION_RUNTIME_TOOL_NAMES.has(tool.name));
  const selectedModel = pickPreferredModel(enabledModels, form.modelId);
  const composerAttachmentIds = composerAttachments.map((attachment) => attachment.attachmentId);
  const isUploadingAttachments = uploadingNames.length > 0;
  const currentSessionSummary = sessionId ? (sessionsQuery.data ?? []).find((session) => session.sessionId === sessionId) : undefined;
  const workspaceSession = sessionId ? workspaceSessionsById[sessionId] : undefined;
  const sessionLifecycleStatus = workspaceSession?.status ?? currentSessionSummary?.status;
  const workspaceOpenSessions = openSessionIds
    .map((openId) => {
      const workspaceRecord = workspaceSessionsById[openId];
      const sessionSummary = (sessionsQuery.data ?? []).find((session) => session.sessionId === openId);

      if (!workspaceRecord && !sessionSummary) {
        return null;
      }

      return {
        sessionId: openId,
        businessName: sessionSummary?.businessName ?? workspaceRecord?.businessName ?? openId,
        status: sessionSummary?.status ?? workspaceRecord?.status,
        phase: sessionSummary?.phase ?? workspaceRecord?.phase,
      };
    })
    .filter((session): session is NonNullable<typeof session> => Boolean(session));
  const recentWorkspaceSessions = (sessionsQuery.data ?? [])
    .filter((session) => session.status !== 'archived' && !openSessionIds.includes(session.sessionId))
    .slice(0, 8);

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT) + 'px';
    el.style.overflowY = el.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  const toggleToolSelection = useCallback((toolName: string) => {
    setSelectedToolIds((prev) => toggleStringItem(prev, toolName));
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.attachmentId !== attachmentId));
  }, []);

  const queueMessage = useCallback((content: string, mode: SendMode) => {
    setQueuedMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        content,
        attachmentIds: composerAttachmentIds,
        attachments: composerAttachments,
        toolIds: selectedToolIds,
        mode,
      },
    ]);
    setFollowUpInput('');
    setComposerAttachments([]);
    setAttachmentError(null);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.focus();
    }
  }, [composerAttachmentIds, composerAttachments, selectedToolIds]);

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
            sessionId: sessionId ?? undefined,
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
  }, [sessionId]);

  useEffect(() => {
    setWorkspaceActiveSessionId(sessionId);
  }, [sessionId, setWorkspaceActiveSessionId]);

  useEffect(() => {
    writePreferredModelId(form.modelId);
  }, [form.modelId]);

  useEffect(() => {
    if (enabledModels.length === 0) return;
    const fallbackModelId = pickPreferredModelId(enabledModels, form.modelId);
    if (!fallbackModelId || fallbackModelId === form.modelId) return;
    setForm((prev) => ({ ...prev, modelId: fallbackModelId }));
  }, [enabledModels, form.modelId]);

  const resumedSessionQuery = useQuery({
    queryKey: ['session-meta', sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: !!sessionId && !currentSessionSummary?.businessName,
    select: (d) => d.businessName ?? '',
  });
  const businessName = currentSessionSummary?.businessName || resumedSessionQuery.data || workspaceSession?.businessName || form.businessName || '';
  const composerValue = sessionId ? followUpInput : form.businessName;
  const hasComposerPayload = Boolean(composerValue.trim() || (sessionId && composerAttachments.length > 0));

  useEffect(() => {
    if (!sessionId) return;

    openWorkspaceSession({
      sessionId,
      businessName: businessName || sessionId,
      status: currentSessionSummary?.status ?? workspaceSession?.status,
      phase: currentSessionSummary?.phase ?? workspaceSession?.phase,
    });
  }, [businessName, currentSessionSummary?.phase, currentSessionSummary?.status, openWorkspaceSession, sessionId, workspaceSession?.phase, workspaceSession?.status]);

  useEffect(() => {
    for (const openSessionId of openSessionIds) {
      const sessionSummary = (sessionsQuery.data ?? []).find((session) => session.sessionId === openSessionId);
      if (!sessionSummary) continue;

      syncWorkspaceSessionMeta(openSessionId, {
        businessName: sessionSummary.businessName,
        status: sessionSummary.status,
        phase: sessionSummary.phase,
      });
    }
  }, [openSessionIds, sessionsQuery.data, syncWorkspaceSessionMeta]);

  useEffect(() => {
    if (!sessionId) {
      historyBootstrapKeyRef.current = null;
      return;
    }

    const bootstrapKey = `${sessionId}:${isResume ? 'resume' : 'live'}`;
    if (historyBootstrapKeyRef.current === bootstrapKey) return;

    historyBootstrapKeyRef.current = bootstrapKey;
    const name = businessName || sessionId;

    if (isResume) {
      chatStore.resetConversation(sessionId, name);
      return;
    }

    if (!chatStore.getConversation(sessionId)) {
      chatStore.startConversation(sessionId, name);
    }
  }, [businessName, chatStore, isResume, sessionId]);

  const start = useMutation({
    mutationFn: () =>
      startSession({
        businessName: form.businessName,
        description: form.description || undefined,
        scenarioIds: form.scenarioIds.length ? form.scenarioIds : undefined,
        ruleScope: {
          bizTypes: form.bizTypes ? form.bizTypes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          ruleTypes: form.ruleTypes ? form.ruleTypes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        },
        locale: form.locale,
        modelId: form.modelId || selectedModel?.modelId || undefined,
        attachmentIds: composerAttachmentIds.length ? composerAttachmentIds : undefined,
        toolIds: selectedToolIds.length ? selectedToolIds : undefined,
      }),
    onSuccess: ({ sessionId: newId }) => {
      openWorkspaceSession({
        sessionId: newId,
        businessName: form.businessName,
        status: 'running',
        phase: 'analysis',
      });
      chatStore.resetConversation(newId, form.businessName, composerAttachments);
      navigate(`/analyze?session=${newId}`);
      setForm((f) => ({ ...f, businessName: '', description: '', scenarioIds: [], bizTypes: '', ruleTypes: '' }));
      setFollowUpInput('');
      setComposerAttachments([]);
      setAttachmentError(null);
      if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    },
  });
  const appendFollowUp = useMutation({
    mutationFn: ({
      id,
      content,
      attachmentIds,
      toolIds,
    }: {
      id: string;
      content: string;
      attachments: SessionAttachment[];
      attachmentIds: string[];
      toolIds: string[];
    }) =>
      appendSessionMessage(id, {
        content,
        modelId: form.modelId || selectedModel?.modelId,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        toolIds: toolIds.length ? toolIds : undefined,
      }),
    onSuccess: (_result, variables) => {
      chatStore.appendUserMessage(variables.id, variables.content, variables.attachments);
      syncWorkspaceSessionMeta(variables.id, { status: 'running', phase: 'analysis' });
      setFollowUpInput('');
      setComposerAttachments([]);
      setAttachmentError(null);
      setStreamReconnectKey((value) => value + 1);
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        inputRef.current.focus();
      }
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSession(id),
    onSuccess: () => setForceStopped(true),
    onError: () => setForceStopped(true),
  });

  const composerBusy = start.isPending || appendFollowUp.isPending;
  const queueItems = queuedMessages.map((message, index) => ({
    id: message.id,
    content: message.content,
    modeLabel: SEND_MODE_LABELS[message.mode],
    meta: [
      `队列 ${index + 1}`,
      message.attachments.length > 0 ? `附件 ${message.attachments.length}` : '',
      message.toolIds.length > 0 ? `工具 ${message.toolIds.length}` : '',
    ].filter(Boolean),
  }));

  // Connect to streaming WebSocket
  const shouldReplayHistory = isResume && streamReconnectKey === 0;
  const { events, status, transport } = useAgentProgress(sessionId, shouldReplayHistory, streamReconnectKey);

  // Feed events into chatStore (batch for history, one-by-one for live)
  useEffect(() => {
    if (!sessionId) {
      processedRef.current = 0;
      return;
    }
    if (lastSessionIdRef.current !== sessionId) {
      processedRef.current = 0;
      lastSessionIdRef.current = sessionId;
    }
    if (events.length < processedRef.current) {
      processedRef.current = 0;
    }
    const newEvents = events.slice(processedRef.current);
    if (!newEvents.length) return;
    chatStore.appendEvents(sessionId, newEvents);
    processedRef.current = events.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, sessionId]);

  useEffect(() => {
    setFollowUpInput('');
    setForceStopped(false);
    setComposerAttachments([]);
    setUploadingNames([]);
    setAttachmentError(null);
    setQueuedMessages([]);
    setSendMode('steer');
  }, [sessionId]);

  // Derived state from raw events
  const hasTerminalEvent = forceStopped || events.some((e) => e.type === 'result' || e.type === 'query_stopped');
  const hasTerminalStatus = ['completed', 'cancelled', 'error', 'archived'].includes(sessionLifecycleStatus ?? '');
  const done = hasTerminalEvent || hasTerminalStatus;
  const reportId = [...events].reverse().find((e) => e.type === 'result' && typeof (e as any).reportId === 'string') as any;
  const isRunning = !!sessionId && !done && sessionLifecycleStatus !== 'paused';

  const answeredIds = new Set(
    events.filter((e: any) => e.type === 'user_answer').map((e: any) => e.requestId as string)
  );
  const pendingAsk = [...events]
    .reverse()
    .find((e: any) => e.type === 'ask_user' && !answeredIds.has(e.requestId)) as
    | { type: 'ask_user'; question: string; options?: string[]; requestId: string }
    | undefined;

  // Current conversation from chat store
  const conv = sessionId ? chatStore.getConversation(sessionId) : undefined;
  const sessionState = conv?.sessionState ?? 'idle';
  const cumulativeCost = conv?.cumulativeCostUsd ?? 0;
  const systemModel = conv?.systemModel;
  const researchProgress = conv?.researchProgress ?? [];
  const snipCount = conv?.snipCount ?? 0;
  const lastSnipReason = conv?.lastSnipReason;
  const totalInputTokens = conv?.totalInputTokens ?? 0;
  const totalOutputTokens = conv?.totalOutputTokens ?? 0;
  const compactEvents = conv?.compactEvents ?? [];
  const memoryWrittenKeys = conv?.memoryWrittenKeys ?? [];
  const lastMessage = conv?.messages[conv.messages.length - 1];
  const lastMessageSignature = lastMessage
    ? `${lastMessage.id}:${lastMessage.content.length}:${(lastMessage.thinking ?? '').length}:${lastMessage.toolCalls.length}:${lastMessage.workerIds.length}`
    : 'empty';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Reset follow mode whenever session changes so new sessions auto-scroll
    shouldFollowRef.current = true;
  }, [sessionId]);

  // Attach scroll listener to Radix ScrollArea viewport for user-scroll detection
  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) return;
    const viewport = root.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    if (!viewport) return;
    viewportRef.current = viewport; // cache for auto-scroll
    const onScroll = () => {
      const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldFollowRef.current = distFromBottom < 120;
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll to bottom only when session is running and user hasn't scrolled up.
  // Use direct scrollTop assignment (instant) instead of scrollIntoView({ behavior: 'smooth' })
  // to prevent overlapping CSS scroll animations from causing visible UI jitter during rapid SSE updates.
  useEffect(() => {
    if (!isRunning) return;
    if (!shouldFollowRef.current) return;
    const vp = viewportRef.current;
    if (vp) {
      requestAnimationFrame(() => { vp.scrollTop = vp.scrollHeight; });
    }
  }, [conv?.messages.length, lastMessageSignature, researchProgress.length, compactEvents.length, memoryWrittenKeys.length, isRunning]);

  const handleSubmit = (mode?: SendMode) => {
    const effectiveMode = mode ?? (sessionId ? sendMode : 'stop-and-send');
    const trimmed = composerValue.trim() || (sessionId && composerAttachments.length > 0 ? '请结合附件继续分析' : '');
    if (isUploadingAttachments) return;
    if (!trimmed) return;
    if (sessionId) {
      if (appendFollowUp.isPending) return;
      if (isRunning && effectiveMode === 'queue') {
        // 添加到队列：保存消息和当前附件/工具配置，等会话结束后自动发送
        queueMessage(trimmed, effectiveMode);
        return;
      }
      // 停止并发送 / 通过消息引导：均调用 appendFollowUp（内部会停止当前会话并续传）
      appendFollowUp.mutate({
        id: sessionId,
        content: trimmed,
        attachments: composerAttachments,
        attachmentIds: composerAttachmentIds,
        toolIds: selectedToolIds,
      });
      return;
    }
    if (start.isPending) return;
    start.mutate();
  };

  // 当会话完成且有待发队列消息时，自动发送第一条
  useEffect(() => {
    if (!done || !sessionId || queuedMessages.length === 0) return;
    if (appendFollowUp.isPending) return;
    const [first, ...rest] = queuedMessages;
    setQueuedMessages(rest);
    appendFollowUp.mutate({
      id: sessionId,
      content: first.content,
      attachments: first.attachments,
      attachmentIds: first.attachmentIds,
      toolIds: first.toolIds,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (e.altKey) { e.preventDefault(); handleSubmit('steer'); return; }
    if (!e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleQuickStart = (name: string) => {
    setForm((f) => ({ ...f, businessName: name }));
    setTimeout(() => { inputRef.current?.focus(); }, 50);
  };

  const handleNewSession = () => {
    navigate('/analyze');
    setForm((prev) => ({
      ...prev,
      businessName: '',
      description: '',
      scenarioIds: [],
      bizTypes: '',
      ruleTypes: '',
    }));
    setFollowUpInput('');
    setConfigOpen(false);
    setSelectedToolIds([]);
    if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.focus(); }
  };

  const handleActivateWorkspaceSession = useCallback((targetSessionId: string) => {
    navigate(`/analyze?session=${targetSessionId}&resume=1`);
  }, [navigate]);

  const handleCloseWorkspaceSession = useCallback((targetSessionId: string) => {
    const currentIndex = openSessionIds.indexOf(targetSessionId);
    const remainingIds = openSessionIds.filter((openId) => openId !== targetSessionId);
    const fallbackId =
      currentIndex > 0
        ? remainingIds[currentIndex - 1] ?? null
        : remainingIds[currentIndex] ?? remainingIds[remainingIds.length - 1] ?? null;

    closeWorkspaceSession(targetSessionId);

    if (sessionId !== targetSessionId) {
      return;
    }

    if (fallbackId) {
      navigate(`/analyze?session=${fallbackId}&resume=1`);
      return;
    }

    navigate('/analyze');
  }, [closeWorkspaceSession, navigate, openSessionIds, sessionId]);

  const shellStatus = (
    <span
      className={clsx(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
        sessionId ? stateBg(sessionState) : 'border-accent/20 bg-accent/10',
        sessionId ? stateColor(sessionState) : 'text-accent'
      )}
    >
      {sessionId && (sessionState === 'thinking' || sessionState === 'tool_running' || sessionState === 'subagent_running' || sessionState === 'correcting') ? (
        <IconLoader2 size={12} className="animate-spin" />
      ) : null}
      {sessionId ? (SESSION_STATE_LABELS[sessionState] ?? sessionState) : '草稿模式'}
    </span>
  );

  const shellMeta = sessionId ? (
    <div className="flex flex-wrap items-center gap-2">
      {businessName ? (
        <span className="rounded-full border border-border bg-surface-card px-3 py-1 text-[11px] text-text-muted">
          业务 · {businessName}
        </span>
      ) : null}
      {cumulativeCost > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-card px-3 py-1 font-mono text-[11px] text-text-muted">
          <IconCurrencyDollar size={11} className="text-warn" />
          ${cumulativeCost.toFixed(4)}
        </span>
      ) : null}
      {isResume ? (
        <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] text-accent">
          {t('analysis.resumed', '已恢复')}
        </span>
      ) : null}
      {systemModel ? (
        <span className="rounded-full border border-border bg-surface-card px-3 py-1 font-mono text-[11px] text-text-muted">
          {systemModel.length > 32 ? `${systemModel.slice(0, 32)}…` : systemModel}
        </span>
      ) : null}
      <span className="rounded-full border border-border bg-surface-card px-3 py-1 font-mono text-[11px] text-text-muted">
        {transport}:{status}
      </span>
      <span className="rounded-full border border-border bg-surface-card px-3 py-1 font-mono text-[11px] text-text-muted">
        {sessionId}
      </span>
    </div>
  ) : '继续使用 legacy session runtime，消息流与附件、工具白名单保持不变。';

  const main = (
    <ScrollArea className="h-full px-5 py-4">
      <div ref={scrollAreaRef} className="chat-content-area flex min-h-full flex-col">
        <div className="w-full flex-1 pb-2">
          {!sessionId ? (
            <EmptyState onQuickStart={handleQuickStart} />
          ) : (
            <div className="space-y-3">
              {conv ? (
                conv.messages.map((msg, i) => {
                  const isLastMsg = i === conv.messages.length - 1;
                  const isStreamingMsg = isRunning && isLastMsg;
                  if (msg.role === 'user') {
                    return <UserMessage key={msg.id} content={msg.content} attachments={msg.attachments} />;
                  }
                  return (
                    <AssistantMessage
                      key={msg.id}
                      msg={msg}
                      conv={conv}
                      isStreaming={isStreamingMsg}
                    />
                  );
                })
              ) : (
                <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
                  <IconLoader2 size={14} className="animate-spin" />
                  <span>加载中...</span>
                </div>
              )}

              <AnalysisSignalStack
                researchProgress={researchProgress}
                snipCount={snipCount}
                lastSnipReason={lastSnipReason}
                totalInputTokens={totalInputTokens}
                totalOutputTokens={totalOutputTokens}
                compactEvents={compactEvents}
                memoryWrittenCount={memoryWrittenKeys.length}
                done={done}
                reportId={reportId?.reportId}
              />

              {pendingAsk && (
                <div className="mt-2">
                  <AG2UActionCard
                    sessionId={sessionId}
                    requestId={pendingAsk.requestId}
                    question={pendingAsk.question}
                    options={pendingAsk.options}
                  />
                </div>
              )}

            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </ScrollArea>
  );

  const composer = (
    <div className="space-y-3">
      {configOpen && (
        <div className="rounded-[26px] border border-border bg-surface-card/60 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.14)]">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-muted">{t('analysis.description', '业务描述')}</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="可选"
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-1.5 text-xs text-text placeholder:text-text-muted transition-colors focus:border-accent/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">{t('analysis.ruleBizTypes', '业务类型')}</label>
              <input
                value={form.bizTypes}
                onChange={(e) => setForm({ ...form, bizTypes: e.target.value })}
                placeholder="payment,transfer"
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-1.5 text-xs text-text placeholder:text-text-muted transition-colors focus:border-accent/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">{t('analysis.ruleTypes', '规则类型')}</label>
              <input
                value={form.ruleTypes}
                onChange={(e) => setForm({ ...form, ruleTypes: e.target.value })}
                placeholder="limit,blacklist"
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-1.5 text-xs text-text placeholder:text-text-muted transition-colors focus:border-accent/50 focus:outline-none"
              />
            </div>
            {(scenarios.data?.length ?? 0) > 0 && (
              <div>
                <label className="mb-1 block text-xs text-text-muted">{t('analysis.scenarioIds', '关联场景')}</label>
                <select
                  multiple
                  title={t('analysis.scenarioIds', '关联场景')}
                  value={form.scenarioIds}
                  onChange={(e) => setForm({ ...form, scenarioIds: Array.from(e.target.selectedOptions).map((option) => option.value) })}
                  className="min-h-[48px] w-full rounded-lg border border-border bg-surface-input px-3 py-1.5 text-xs text-text transition-colors focus:border-accent/50 focus:outline-none"
                >
                  {(scenarios.data ?? []).map((scenario) => (
                    <option key={scenario.scenarioId} value={scenario.scenarioId}>{scenario.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      <AgentComposerCard
        value={composerValue}
        onValueChange={(value) => {
          if (sessionId) {
            setFollowUpInput(value);
            return;
          }
          setForm((prev) => ({ ...prev, businessName: value }));
        }}
        placeholder={sessionId ? (isRunning ? '补充引导消息，继续当前分析…' : '继续当前会话…') : t('analysis.businessName', '输入业务名称，开始风险分析…')}
        disabled={composerBusy || isUploadingAttachments}
        onSubmit={() => handleSubmit()}
        onSubmitWithMode={sessionId && isRunning ? (mode) => handleSubmit(mode as SendMode) : undefined}
        submitLabel={sessionId ? (composerBusy ? '发送中' : '发送消息') : (start.isPending ? '分析中' : '分析')}
        busy={composerBusy}
        running={isRunning}
        submitDisabled={!hasComposerPayload}
        textareaRef={inputRef}
        onKeyDown={handleKeyDown}
        footerHint={sessionId ? (isRunning ? '沿用当前会话上下文继续分析' : '已完成会话可直接继续追问') : '首次发送会启动 legacy 风险分析会话'}
        footerBadges={
          <>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, locale: prev.locale === 'zh-CN' ? 'en-US' : 'zh-CN' }))}
              disabled={!!sessionId || isRunning}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent/20 hover:text-text disabled:opacity-50"
            >
              <IconLanguage size={12} />
              {form.locale === 'zh-CN' ? '中文' : 'EN'}
            </button>
            <button
              type="button"
              onClick={() => setConfigOpen((value) => !value)}
              aria-label="高级配置"
              className={clsx(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors',
                configOpen ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border bg-surface text-text-muted hover:border-accent/20 hover:text-text'
              )}
            >
              <IconSettings2 size={12} />
              高级配置
            </button>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-muted">
              <IconRobot size={12} className="text-accent/70" />
              ReAct
            </span>
          </>
        }
        models={enabledModels}
        selectedModelId={form.modelId}
        onModelChange={(modelId) => setForm((prev) => ({ ...prev, modelId }))}
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
        sendModes={sessionId && isRunning ? [
          { value: 'stop-and-send', label: '停止并发送' },
          { value: 'queue', label: '添加到队列' },
          { value: 'steer', label: '通过消息引导' },
        ] : []}
        selectedSendMode={sessionId && isRunning ? sendMode : undefined}
        onSelectSendMode={sessionId && isRunning ? (value) => setSendMode(value as SendMode) : undefined}
        canCancel={Boolean(sessionId && isRunning)}
        onCancel={sessionId && isRunning ? () => cancel.mutate(sessionId) : undefined}
        onPasteFiles={(files) => {
          void handleAttachmentFiles(files);
        }}
        textareaProps={{
          rows: 1,
          onInput: (event) => autoResize(event.currentTarget as HTMLTextAreaElement),
        }}
      />
    </div>
  );

  const aside = (
    <SessionWorkspaceAside
      activeSessionId={sessionId}
      openSessions={workspaceOpenSessions}
      recentSessions={recentWorkspaceSessions}
      totalSessionCount={(sessionsQuery.data ?? []).filter((session) => session.status !== 'archived').length}
      onActivateSession={handleActivateWorkspaceSession}
      onResumeSession={handleActivateWorkspaceSession}
      onCloseSession={handleCloseWorkspaceSession}
    />
  );

  return (
    <AgentWorkspaceShell
      eyebrow="Legacy Analyze"
      title={t('analysis.title', '新建风险分析')}
      status={shellStatus}
      meta={shellMeta}
      actions={sessionId ? (
        <button
          type="button"
          onClick={handleNewSession}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-card px-3 py-2 text-xs font-medium text-text transition-colors hover:border-accent/25 hover:text-accent"
        >
          <IconShieldCheck size={14} />
          新建分析
        </button>
      ) : null}
      main={main}
      composer={composer}
      aside={aside}
    />
  );
}
