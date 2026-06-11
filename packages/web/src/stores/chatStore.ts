/**
 * chatStore — 07-streaming-chat.md §5
 *
 * 管理对话会话状态、流式消息累积、工具调用记录、Worker 进度等。
 * 对话内容持久化到 localStorage（最多保留 20 条会话）。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ─── Session State Machine (07-streaming-chat.md §12) ─────────────────────

export type SessionState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'waiting_user'
  | 'compacting'
  | 'subagent_running'
  | 'correcting'
  | 'done'
  | 'error';

export const SESSION_STATE_LABELS: Record<SessionState, string> = {
  idle: '就绪',
  thinking: 'AI 思考中',
  tool_running: '工具执行中',
  waiting_user: '等待您决策',
  compacting: '压缩上下文',
  subagent_running: '子智能体运行中',
  correcting: '自动纠错',
  done: '已完成',
  error: '出错',
};

// ─── Tool Call Record ──────────────────────────────────────────────────────

export interface ToolCallRecord {
  callId: string;
  toolName: string;
  params?: Record<string, unknown>;
  result?: string;
  error?: string;
  durationMs?: number;
  status: 'running' | 'done' | 'error';
}

// ─── Worker (Sub-agent) Record ─────────────────────────────────────────────

export interface WorkerRecord {
  agentId: string;
  description: string;
  role?: string;
  phase?: string;
  progress: string[];
  summary?: string;
  tokenUsage?: { input: number; output: number };
  status: 'running' | 'done';
}

// ─── Dream Task Record (v3.3 agent-framework.md §30) ──────────────────────

export type DreamTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DreamTaskRecord {
  taskId: string;
  description: string;
  status: DreamTaskStatus;
  summary?: string;
  /** Progress messages received so far */
  progress: string[];
}

function stringifyEventValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── Chat Message ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Array<{
    attachmentId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    textPreview?: string;
  }>;
  thinking?: string;
  toolCalls: ToolCallRecord[];
  /** agentIds for workers spawned in this turn */
  workerIds: string[];
  createdAt: string;
  turnNumber?: number;
}

// ─── Tool Partition Info (07-streaming-chat.md §12.2) ─────────────────────

export interface ToolPartitionInfo {
  interrupt: string[];
  parallel: string[];
  serial: string[];
  totalCount: number;
}

// ─── Research Progress (07-streaming-chat.md §10.3) ───────────────────────

export interface ResearchDimensionProgress {
  dimension: string;
  status: 'started' | 'completed' | 'aggregating' | 'skipped';
}

// ─── Compact Event ─────────────────────────────────────────────────────────

export interface CompactEventRecord {
  /** 压缩策略：L1=snip / L2=micro / L3=auto / L4=reactive */
  level: 'snip' | 'micro' | 'auto' | 'reactive';
  timestamp: string;
  tokensBefore: number;
  tokensAfter: number;
  trigger: 'threshold' | 'api_error' | 'manual';
}

// ─── Conversation ──────────────────────────────────────────────────────────

export interface ChatConversation {
  sessionId: string;
  businessName: string;
  messages: ChatMessage[];
  /** All workers keyed by agentId */
  workers: Record<string, WorkerRecord>;
  /** Dream Tasks keyed by taskId (v3.3 §30) */
  dreamTasks: Record<string, DreamTaskRecord>;
  sessionState: SessionState;
  cumulativeCostUsd: number;
  startedAt: string;
  /** system_init model info */
  systemModel?: string;
  /** Tool partition info from last tool_partition_info event */
  lastPartitionInfo?: ToolPartitionInfo;
  /** Research dimension progress list */
  researchProgress: ResearchDimensionProgress[];
  /** Compact snip events count */
  snipCount: number;
  /** Last compact_snip reason */
  lastSnipReason?: string;
  /** Accumulated input tokens from cost_update events */
  totalInputTokens: number;
  /** Accumulated output tokens from cost_update events */
  totalOutputTokens: number;
  /** Context compression event history (09-context-management.md §10) */
  compactEvents: CompactEventRecord[];
  /**
   * agent-framework.md P1: 记忆写入确认
   * 当后端发出 memory_write 事件时，记录写入的 key 列表
   */
  memoryWrittenKeys: string[];
}

// ─── Store Types ───────────────────────────────────────────────────────────

type EventLike = { type: string; [key: string]: unknown };

interface ChatStoreState {
  conversations: Record<string, ChatConversation>;

  /** 初始化或复用已有会话 */
  startConversation(sessionId: string, businessName: string): void;

  /** 重置并重新初始化会话（避免历史数据重复） */
  resetConversation(sessionId: string, businessName: string, attachments?: ChatMessage['attachments']): void;

  /** 处理一条流事件，更新对应会话状态 */
  appendEvent(sessionId: string, event: EventLike): void;

  /** 批量处理事件（用于历史记录加载，单次 setState） */
  appendEvents(sessionId: string, events: EventLike[]): void;

  /** 本地追加一条用户消息（用于 follow-up 发送成功后立即更新 UI） */
  appendUserMessage(sessionId: string, content: string, attachments?: ChatMessage['attachments']): void;

  /** 删除会话 */
  clearConversation(sessionId: string): void;

  /** 获取会话 */
  getConversation(sessionId: string): ChatConversation | undefined;
}

// ─── ID helpers ────────────────────────────────────────────────────────────

let _msgCounter = 0;
function nextMsgId() {
  return `msg-${++_msgCounter}-${Date.now()}`;
}

function newAssistantMsg(turnNumber?: number): ChatMessage {
  return {
    id: nextMsgId(),
    role: 'assistant',
    content: '',
    toolCalls: [],
    workerIds: [],
    createdAt: new Date().toISOString(),
    turnNumber,
  };
}

// ─── Event processor ───────────────────────────────────────────────────────

/**
 * Returns updated conversation (immutable). Returns undefined if no change.
 */
function processEvent(conv: ChatConversation, event: EventLike): ChatConversation {
  const messages = [...conv.messages];
  const workers = { ...conv.workers };
  const dreamTasks = { ...conv.dreamTasks };
  let sessionState: SessionState = conv.sessionState;
  let cumulativeCostUsd = conv.cumulativeCostUsd;
  let systemModel = conv.systemModel;
  let lastPartitionInfo = conv.lastPartitionInfo;
  const researchProgress = [...conv.researchProgress];
  let snipCount = conv.snipCount;
  let lastSnipReason = conv.lastSnipReason;
  let totalInputTokens = conv.totalInputTokens;
  let totalOutputTokens = conv.totalOutputTokens;
  const compactEvents = [...conv.compactEvents];
  let memoryWrittenKeys = conv.memoryWrittenKeys;

  /** Ensure last message is assistant, return index */
  const ensureAssistant = (): number => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') return messages.length - 1;
    messages.push(newAssistantMsg());
    return messages.length - 1;
  };

  /** Mutate the last assistant message via a copy */
  const mutateAssistant = (fn: (msg: ChatMessage) => ChatMessage): void => {
    const idx = ensureAssistant();
    messages[idx] = fn({ ...messages[idx], toolCalls: [...messages[idx].toolCalls], workerIds: [...messages[idx].workerIds] });
  };

  switch (event.type) {
    // ── Lifecycle ────────────────────────────────────────────────────────
    case 'system_init':
      sessionState = 'thinking';
      systemModel = String(event.model ?? conv.systemModel ?? '');
      break;

    case 'turn_info': {
      const turnNum = (event.current ?? event.turn) as number | undefined;
      const lastMsg = messages[messages.length - 1];
      // New turn = new assistant message if previous turn has content or tools
      if (lastMsg?.role === 'assistant' && (lastMsg.content || lastMsg.toolCalls.length)) {
        messages.push(newAssistantMsg(turnNum));
      } else if (lastMsg?.role === 'assistant') {
        messages[messages.length - 1] = { ...lastMsg, turnNumber: turnNum };
      } else {
        messages.push(newAssistantMsg(turnNum));
      }
      sessionState = 'thinking';
      break;
    }

    // ── Text streaming ───────────────────────────────────────────────────
    case 'text_delta':
      mutateAssistant((m) => ({ ...m, content: m.content + String(event.text ?? event.delta ?? '') }));
      sessionState = 'thinking';
      break;

    case 'thinking_delta':
    case 'reasoning_delta':
      mutateAssistant((m) => ({ ...m, thinking: (m.thinking ?? '') + String(event.text ?? event.delta ?? '') }));
      break;

    // ── Tool calls ───────────────────────────────────────────────────────
    case 'tool_call':
    case 'tool_start': {
      const callId = String(event.callId ?? event.toolUseId ?? event.id ?? '');
      const toolName = String(event.toolName ?? event.name ?? '');
      const params = (event.params ?? event.input ?? event.arguments) as Record<string, unknown> | undefined;
      mutateAssistant((m) => ({
        ...m,
        toolCalls: [...m.toolCalls, { callId, toolName, params, status: 'running' as const }],
      }));
      sessionState = 'tool_running';
      break;
    }

    case 'tool_result':
    case 'tool_complete': {
      const callId = String(event.callId ?? event.toolUseId ?? event.id ?? '');
      mutateAssistant((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((tc) =>
          tc.callId === callId
            ? {
                ...tc,
                result: stringifyEventValue(event.result ?? event.output ?? ''),
                durationMs: event.durationMs as number,
                status: 'done' as const,
              }
            : tc
        ),
      }));
      sessionState = 'thinking';
      break;
    }

    case 'tool_error': {
      const callId = String(event.callId ?? event.toolUseId ?? event.id ?? '');
      mutateAssistant((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((tc) =>
          tc.callId === callId
            ? { ...tc, error: stringifyEventValue(event.error ?? ''), status: 'error' as const }
            : tc
        ),
      }));
      break;
    }

    case 'user_message': {
      const content = String(event.content ?? '').trim();
      if (!content) break;
      const attachments = Array.isArray(event.attachments)
        ? (event.attachments as Array<Record<string, unknown>>).map((attachment) => ({
            attachmentId: String(attachment.attachmentId ?? attachment.id ?? ''),
            filename: String(attachment.filename ?? ''),
            contentType: String(attachment.contentType ?? ''),
            sizeBytes: Number(attachment.sizeBytes ?? 0),
            textPreview: typeof attachment.textPreview === 'string' ? attachment.textPreview : undefined,
          }))
        : undefined;
      const last = messages[messages.length - 1];
      const sameAsLastUser =
        last?.role === 'user'
        && last.content === content
        && JSON.stringify(last.attachments ?? []) === JSON.stringify(attachments ?? []);
      if (!sameAsLastUser) {
        messages.push({
          id: nextMsgId(),
          role: 'user',
          content,
          attachments,
          toolCalls: [],
          workerIds: [],
          createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
        });
      }
      sessionState = 'thinking';
      break;
    }

    // ── Sub-agents / Workers ─────────────────────────────────────────────
    case 'subagent_spawned': {
      const agentId = String(event.agentId ?? '');
      workers[agentId] = {
        agentId,
        description: String(event.description ?? ''),
        role: event.workerRole as string,
        phase: event.phase as string,
        progress: [],
        status: 'running',
      };
      mutateAssistant((m) => ({
        ...m,
        workerIds: m.workerIds.includes(agentId) ? m.workerIds : [...m.workerIds, agentId],
      }));
      sessionState = 'subagent_running';
      break;
    }

    case 'subagent_progress': {
      const agentId = String(event.agentId ?? '');
      if (workers[agentId]) {
        workers[agentId] = {
          ...workers[agentId],
          progress: [...workers[agentId].progress, String(event.progress ?? event.text ?? '')],
        };
      }
      break;
    }

    case 'subagent_complete': {
      const agentId = String(event.agentId ?? '');
      if (workers[agentId]) {
        workers[agentId] = {
          ...workers[agentId],
          summary: String(event.summary ?? ''),
          tokenUsage: event.tokenUsage as { input: number; output: number },
          status: 'done',
        };
      }
      if (sessionState === 'subagent_running') sessionState = 'thinking';
      break;
    }

    // ── Cost tracking ────────────────────────────────────────────────────
    case 'cost_update': {
      const cu = Number((event.usage as any)?.cumulativeUsd ?? event.cumulativeUsd ?? cumulativeCostUsd);
      cumulativeCostUsd = cu;
      // Accumulate input/output tokens for budget visualization (09-context-management.md §7)
      totalInputTokens += Number(event.inputTokens ?? 0);
      totalOutputTokens += Number(event.outputTokens ?? 0);
      break;
    }

    case 'usage_summary': {
      const total = Number((event.summary as any)?.totalUsd ?? (event.usage as any)?.cumulativeUsd ?? cumulativeCostUsd);
      cumulativeCostUsd = total;
      break;
    }

    // ── State transitions ────────────────────────────────────────────────
    case 'ask_user':
      sessionState = 'waiting_user';
      break;

    case 'compact_start':
      sessionState = 'compacting';
      break;

    case 'compact_snip':
      sessionState = 'compacting';
      snipCount = snipCount + 1;
      lastSnipReason = String(event.reason ?? event.summary ?? '');
      // Record snip compact event
      compactEvents.push({
        level: 'snip',
        timestamp: new Date().toISOString(),
        tokensBefore: Number(event.tokensBefore ?? 0),
        tokensAfter: Number(event.tokensAfter ?? 0),
        trigger: 'threshold',
      });
      break;

    case 'compact_end': {
      sessionState = 'thinking';
      // Record full compact event (L2/L3/L4 based on strategy)
      const strategy = String(event.strategy ?? 'auto') as CompactEventRecord['level'];
      const validLevels: CompactEventRecord['level'][] = ['snip', 'micro', 'auto', 'reactive'];
      compactEvents.push({
        level: validLevels.includes(strategy) ? strategy : 'auto',
        timestamp: new Date().toISOString(),
        tokensBefore: Number(event.tokensBefore ?? 0),
        tokensAfter: Number(event.tokensAfter ?? 0),
        trigger: 'threshold',
      });
      break;
    }

    case 'correction_start':
      sessionState = 'correcting';
      break;

    case 'correction_complete':
      sessionState = 'thinking';
      break;

    // ── Tool partition info ───────────────────────────────────────────────
    case 'tool_partition_info': {
      const interrupt = (event.interrupt as string[] | undefined) ?? [];
      const parallel = (event.parallel as string[] | undefined) ?? [];
      const serial = (event.serial as string[] | undefined) ?? [];
      lastPartitionInfo = {
        interrupt,
        parallel,
        serial,
        totalCount: interrupt.length + parallel.length + serial.length,
      };
      break;
    }

    // ── Research progress ────────────────────────────────────────────────
    case 'research_progress': {
      const dim = String(event.dimension ?? event.dim ?? '');
      const status = String(event.status ?? 'started') as ResearchDimensionProgress['status'];
      const existIdx = researchProgress.findIndex((r) => r.dimension === dim);
      if (existIdx >= 0) {
        researchProgress[existIdx] = { dimension: dim, status };
      } else {
        researchProgress.push({ dimension: dim, status });
      }
      break;
    }

    // ── Memory events ────────────────────────────────────────────────────
    case 'memory_write': {
      // agent-framework.md P1: 记录已写入的 key，用于 AG2U 决策后展示确认
      const written = event.keysWritten as string[] | undefined;
      if (Array.isArray(written) && written.length > 0) {
        memoryWrittenKeys = [...memoryWrittenKeys, ...written];
      }
      break;
    }
    case 'memory_read':
      break;

    // ── Dream Task notifications (v3.3 agent-framework.md §30) ──────────
    case 'dream_task_notification': {
      const taskId = String(event.taskId ?? '');
      const status = String(event.status ?? 'running') as DreamTaskStatus;
      const summary = String(event.summary ?? '');
      if (taskId) {
        const existing = dreamTasks[taskId];
        if (existing) {
          dreamTasks[taskId] = {
            ...existing,
            status,
            summary: summary || existing.summary,
          };
        } else {
          dreamTasks[taskId] = {
            taskId,
            description: summary,
            status,
            summary,
            progress: [],
          };
        }
      }
      break;
    }

    // ── Agent plan ───────────────────────────────────────────────────────
    case 'plan':
      sessionState = 'thinking';
      break;

    // ── Agent status ─────────────────────────────────────────────────────
    case 'agent_status': {
      const newState = event.state as string | undefined;
      const statusMap: Partial<Record<string, SessionState>> = {
        thinking: 'thinking',
        tool_running: 'tool_running',
        waiting_user: 'waiting_user',
        compacting: 'compacting',
        subagent_running: 'subagent_running',
        correcting: 'correcting',
        done: 'done',
        error: 'error',
      };
      if (newState && statusMap[newState]) {
        sessionState = statusMap[newState]!;
      }
      break;
    }

    case 'result': {
      const resultText = String(event.result ?? '').trim();
      if (resultText) {
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') {
          if (!last.content.trim()) {
            messages[messages.length - 1] = { ...last, content: resultText };
          }
        } else {
          messages.push({ ...newAssistantMsg(), content: resultText });
        }
      }
      sessionState = 'done';
      break;
    }

    case 'query_stopped':
    case 'done':
      sessionState = 'done';
      break;

    case 'error':
      if (event.fatal !== false) sessionState = 'error';
      break;

    default:
      break;
  }

  return {
    ...conv,
    messages,
    workers,
    dreamTasks,
    sessionState,
    cumulativeCostUsd,
    systemModel,
    lastPartitionInfo,
    researchProgress,
    snipCount,
    lastSnipReason,
    totalInputTokens,
    totalOutputTokens,
    compactEvents,
    memoryWrittenKeys,
  };
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      conversations: {},

      startConversation(sessionId, businessName) {
        if (get().conversations[sessionId]) return;
        const userMsg: ChatMessage = {
          id: nextMsgId(),
          role: 'user',
          content: businessName,
          toolCalls: [],
          workerIds: [],
          createdAt: new Date().toISOString(),
        };
        const conv: ChatConversation = {
          sessionId,
          businessName,
          messages: [userMsg],
          workers: {},
          dreamTasks: {},
          sessionState: 'idle',
          cumulativeCostUsd: 0,
          startedAt: new Date().toISOString(),
          researchProgress: [],
          snipCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          compactEvents: [],
          memoryWrittenKeys: [],
        };
        set((s) => ({ conversations: { ...s.conversations, [sessionId]: conv } }));
      },

      resetConversation(sessionId, businessName, attachments) {
        const userMsg: ChatMessage = {
          id: nextMsgId(),
          role: 'user',
          content: businessName,
          attachments,
          toolCalls: [],
          workerIds: [],
          createdAt: new Date().toISOString(),
        };
        const conv: ChatConversation = {
          sessionId,
          businessName,
          messages: [userMsg],
          workers: {},
          dreamTasks: {},
          sessionState: 'idle',
          cumulativeCostUsd: 0,
          startedAt: new Date().toISOString(),
          researchProgress: [],
          snipCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          compactEvents: [],
          memoryWrittenKeys: [],
        };
        set((s) => ({ conversations: { ...s.conversations, [sessionId]: conv } }));
      },

      appendEvent(sessionId, event) {
        const conv = get().conversations[sessionId];
        if (!conv) return;
        const updated = processEvent(conv, event);
        set((s) => ({ conversations: { ...s.conversations, [sessionId]: updated } }));
      },

      appendEvents(sessionId, events) {
        const conv = get().conversations[sessionId];
        if (!conv) return;
        let updated = conv;
        for (const event of events) {
          updated = processEvent(updated, event);
        }
        set((s) => ({ conversations: { ...s.conversations, [sessionId]: updated } }));
      },

      appendUserMessage(sessionId, content, attachments) {
        const conv = get().conversations[sessionId];
        if (!conv) return;
        const updated = processEvent(conv, {
          type: 'user_message',
          content,
          attachments,
          createdAt: new Date().toISOString(),
        });
        set((s) => ({ conversations: { ...s.conversations, [sessionId]: updated } }));
      },

      clearConversation(sessionId) {
        set((s) => {
          const { [sessionId]: _, ...rest } = s.conversations;
          return { conversations: rest };
        });
      },

      getConversation(sessionId) {
        return get().conversations[sessionId];
      },
    }),
    {
      name: 'risk-agent-chat-v1',
      storage: createJSONStorage(() => localStorage),
      // Keep last 20 conversations to prevent localStorage overflow
      partialize: (state) => ({
        conversations: Object.fromEntries(
          Object.entries(state.conversations)
            .sort(([, a], [, b]) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, 20)
        ),
      }),
    }
  )
);
