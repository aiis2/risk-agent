/**
 * 核心协议类型 — 所有 Agent / Worker / Sub-Agent / 前后端共享的冻结契约。
 *
 * 参考：
 * - docs/architecture/react-loop-engine.md §2
 * - docs/architecture/data-flow.md
 * - docs/modules/07-streaming-chat.md
 */

import { z } from 'zod';
import type {
  SandboxAccessTier,
  SandboxEntrypoint,
  SandboxFilesystemScope,
  SandboxHostKind,
  SandboxInteractionMode,
  SandboxNetworkScope,
} from '../../sandbox/SandboxRuntime.js';

// ──────────────────────────────────────────────────────────
// TaskType
// ──────────────────────────────────────────────────────────

export const TaskTypeSchema = z.enum([
  'local_agent',       // 'a' 前缀 — 本进程 Worker
  'local_bash',        // 'b' 前缀 — 本地命令执行
  'local_workflow',    // 'w' 前缀 — 结构化工作流
  'subagent',          // 's' 前缀 — Sub-Agent
  'remote_agent',      // 'r' 前缀 — 远端代理（协议壳）
  'in_process_teammate', // 't' 前缀 — 共享状态的同进程协作者
  'monitor_mcp',       // 'm' 前缀 — MCP 事件监听
  'dream'              // 'd' 前缀 — 后台异步任务（Dream Task）
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ──────────────────────────────────────────────────────────
// Agent Phase
// ──────────────────────────────────────────────────────────

export const AgentPhaseSchema = z.enum(['research', 'synthesis', 'implementation', 'verification']);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

// ──────────────────────────────────────────────────────────
// Worker Config
// ──────────────────────────────────────────────────────────

export interface WorkerConfig {
  readonly role: 'datasource' | 'riskrule' | 'profile' | 'gapanalysis' | 'report' | 'research';
  readonly description: string;
  readonly timeoutMs?: number;
  readonly modelOverride?: string;
  readonly allowedTools?: string[];
}

// ──────────────────────────────────────────────────────────
// Task State (react-loop-engine.md §6.2)
// ──────────────────────────────────────────────────────────

/**
 * TaskStateBase — Task 通用状态基类（参考 claude-code-cli Task.ts）
 * 完整移植自 react-loop-engine.md §6.2。
 */
export interface TaskStateBase {
  /** 类型前缀 + 8 位随机 base36，如 "a3k7m2p9" */
  id: string;
  type: TaskType;
  status: TaskStatus;
  /** 对 Coordinator 和用户显示的任务描述 */
  description: string;
  /** 关联的 tool_use block ID */
  toolUseId?: string;
  /** 创建时间 Unix ms */
  startTime: number;
  /** 磁盘输出路径（大结果写磁盘） */
  outputFile: string;
  /** 已读取输出偏移（增量读取） */
  outputOffset: number;
  /** 是否已通知 Coordinator */
  notified: boolean;
}

/**
 * RiskAgentTaskState — 风控 Worker 扩展状态。
 */
export interface RiskAgentTaskState extends TaskStateBase {
  phase: AgentPhase;
  workerRole: 'DataSource' | 'RiskRule' | 'Profile' | 'GapAnalysis' | 'Custom';
  /** 前置 Task ID（DAG 依赖） */
  dependencies: string[];
  tokenUsage?: { input: number; output: number; cost: number };
}

/**
 * 终态判断：completed / failed / cancelled 均不再转换。
 * （文档使用 killed，实现中对应 cancelled）
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

// ──────────────────────────────────────────────────────────
// Task Plan
// ──────────────────────────────────────────────────────────

export interface TaskPlan {
  readonly taskId: string;
  readonly parentTaskId?: string;
  readonly taskType: TaskType;
  readonly description: string;
  readonly worker?: WorkerConfig;
  readonly phase?: AgentPhase;
  readonly dependsOn?: string[];
}

// ──────────────────────────────────────────────────────────
// Validation Result
// ──────────────────────────────────────────────────────────

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues?: Array<{
    readonly code: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly message: string;
    readonly path?: string;
  }>;
}

// ──────────────────────────────────────────────────────────
// Stop Reason
// ──────────────────────────────────────────────────────────

export const StopReasonSchema = z.enum([
  'natural_stop',
  'max_turns',
  'budget_exceeded',
  'diminishing_returns',
  'correction_exhausted',
  'user_interrupt',
  'error'
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

// ──────────────────────────────────────────────────────────
// Tool Progress Data
// ──────────────────────────────────────────────────────────

export interface ToolProgressData {
  readonly phase?: string;
  readonly message?: string;
  readonly percent?: number;
  readonly [key: string]: unknown;
}

export interface ToolSandboxDescriptor {
  readonly profile?: string;
  readonly accessTier?: SandboxAccessTier;
  readonly hostKind?: SandboxHostKind;
  readonly entrypoint?: SandboxEntrypoint;
  readonly filesystem?: SandboxFilesystemScope;
  readonly network?: SandboxNetworkScope;
  readonly interaction?: SandboxInteractionMode;
  readonly leaseId?: string;
  readonly state?: 'planned' | 'lease-created' | 'running' | 'completed' | 'cancelled' | 'failed';
  readonly cancelled?: boolean;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly timedOut?: boolean;
  readonly error?: string;
}

// ──────────────────────────────────────────────────────────
// StreamEvent (v3.3 冻结)
// ──────────────────────────────────────────────────────────

export type StreamEvent =
  | {
      type: 'system_init';
      model: string;
      agentType: 'coordinator' | 'worker' | 'subagent';
      tools: { name: string; alwaysLoad: boolean; deferred: boolean }[];
      skills: { name: string; source: 'bundled' | 'directory' | 'mcp' | 'dynamic' | 'conditional' }[];
      mcpServers: string[];
      permissionMode: string;
      sessionId: string;
      budgetUsd?: number;
      agents?: { name: string; description: string }[];
    }
  | { type: 'turn_info'; current: number; max: number; estimatedTokens: number }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_complete'; fullText: string }
  | {
      type: 'tool_partition_info';
      partitions: { interrupt: string[]; parallel: string[]; serial: string[] };
      totalCount: number;
    }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: unknown; sandbox?: ToolSandboxDescriptor }
  | { type: 'tool_progress'; toolUseId: string; toolName?: string; progress: ToolProgressData; sandbox?: ToolSandboxDescriptor }
  | { type: 'tool_complete'; toolUseId: string; toolName?: string; result: unknown; durationMs: number; sandbox?: ToolSandboxDescriptor }
  | { type: 'tool_error'; toolUseId: string; toolName?: string; error: string; sandbox?: ToolSandboxDescriptor }
  | { type: 'user_message'; content: string; attachments?: AttachmentReference[]; createdAt?: string }
  | { type: 'ask_user'; question: string; options?: string[]; requestId: string }
  | { type: 'user_answer'; requestId: string; answer: string }
  | { type: 'compact_start'; reason: 'token_budget' | 'max_turns' | 'manual' }
  | { type: 'compact_progress'; phase: 'summarizing' | 'rebuilding'; progress: number }
  | { type: 'compact_end'; tokensBefore: number; tokensAfter: number }
  | {
      type: 'compact_snip';
      toolUseIds: string[];
      linesBefore: number;
      linesAfter: number;
      reason: 'file_read' | 'tool_result_oversized';
    }
  | {
      type: 'subagent_spawned';
      agentId: string;
      description: string;
      taskType: TaskType;
      workerRole?: string;
      phase?: AgentPhase;
    }
  | { type: 'subagent_progress'; agentId: string; text: string }
  | { type: 'subagent_complete'; agentId: string; status: TaskStatus; summary: string }
  | { type: 'memory_read'; memoryType: 'long_term' | 'short_term'; keysRead: string[] }
  | { type: 'memory_write'; memoryType: 'long_term'; keysWritten: string[] }
  | { type: 'correction_start'; round: number; reason: string }
  | { type: 'correction_complete'; round: number; success: boolean }
  | {
      type: 'cost_update';
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      cacheCreationTokens?: number;
      estimatedUsd: number;
    }
  | { type: 'usage_summary'; totalTokens: number; totalCostUsd: number; turnCount: number }
  | { type: 'query_stopped'; reason: StopReason }
  | {
      type: 'research_progress';
      dimension: string;
      /** 'skipped' は予算超過で省略された可选维度（research-workflow.md §2.3） */
      status: 'started' | 'completed' | 'aggregating' | 'skipped';
    }
  | { type: 'research_complete'; dimensions: string[]; aggregatedTokens: number }
  | { type: 'skill_activated'; skillName: string; source: 'conditional' | 'dynamic'; trigger: string }
  | { type: 'skill_discovered'; skillName: string; skillDir: string }
  // ─── v3.3 新增类型 ───────────────────────────────────────────────
  | { type: 'content_block_start'; blockType: 'text' | 'tool_use' | 'thinking'; index: number }
  | { type: 'content_block_stop'; blockType: 'text' | 'tool_use' | 'thinking'; index: number }
  | { type: 'session_resume'; sessionId: string; messageCount: number; modeSwitch?: string }
  | { type: 'dream_task_notification'; taskId: string; status: TaskStatus; summary: string }
  | { type: 'agent_invoked'; agentName: string; agentDef: string }
  | {
      type: 'result';
      subtype:
        | 'success'
        | 'error_max_turns'
        | 'error_during_execution'
        | 'error_max_structured_output_retries';
      is_error: boolean;
      duration_ms: number;
      num_turns: number;
      result: string;
      stop_reason: string;
      total_cost_usd: number;
      reportId?: string;
    }
  | { type: 'plan'; plan: TaskPlan }
  | { type: 'agent_status'; message: string };

// ──────────────────────────────────────────────────────────
// SessionEvent — 多会话状态事件（session-lifecycle.md §5.2）
// 服务端通过 /api/ws/sessions 广播，前端渲染会话中央视图
// ──────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  businessName: string;
  description?: string;
  status: 'running' | 'completed' | 'cancelled' | 'error' | 'archived' | 'paused';
  phase?: string;
  locale?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type SessionEvent =
  | { type: 'session_created'; session: SessionInfo }
  | { type: 'session_updated'; sessionId: string; changes: Partial<SessionInfo> }
  | { type: 'session_archived'; sessionId: string }
  | { type: 'session_phase_changed'; sessionId: string; phase: string }
  | { type: 'session_cost_updated'; sessionId: string; costUsd: number }
  | { type: 'session_task_changed'; sessionId: string; tasks: TaskStateBase[] };

// ──────────────────────────────────────────────────────────
// OrphanedPermission — 上次中断遗留的权限请求（v3.3 §3.3）
// 会话恢复时若发现孤立权限请求，需补发给用户确认。
// ──────────────────────────────────────────────────────────

export interface OrphanedPermission {
  /** 遗留的工具调用 ID */
  toolUseId: string;
  /** 遗留的工具名称 */
  toolName: string;
  /** 遗留的工具输入（可选）*/
  toolInput?: Record<string, unknown>;
  /** 遗留请求发生时间 */
  requestedAt: string;
}

// ──────────────────────────────────────────────────────────
// SessionStatus — 会话实时状态快照（v3.3 §8.1）
// 通过 getSessionStatus() 查询，反映当前推理/工具执行阶段。
// ──────────────────────────────────────────────────────────

export interface SessionStatus {
  /** 当前执行阶段 */
  phase: 'idle' | 'thinking' | 'tool_executing' | 'waiting_user';
  /** 活跃 Worker 数量（Coordinator 模式下） */
  activeWorkerCount: number;
  /** 本次会话 Token 消耗汇总 */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  };
  /** 本次会话累计费用（美元） */
  costUsd: number;
}

// ──────────────────────────────────────────────────────────
// SessionManager 接口（v3.3-evolution-delta.md §8.1）
// 参考 vscode-copilot-chat 多会话管理，提供统一生命周期管控。
// ──────────────────────────────────────────────────────────

export interface SessionManager {
  /** 获取所有活跃（内存中）会话列表 */
  getActiveSessions(): SessionInfo[];
  /** 获取指定会话实时状态快照 */
  getSessionStatus(sessionId: string): SessionStatus;
  /** 终止会话（取消运行中任务并从内存中清除） */
  terminateSession(sessionId: string): void;
}

// ──────────────────────────────────────────────────────────
// CompactBoundaryMessage — 压缩边界标记（session-lifecycle.md §4.1）
// 存入 conversations 表（subtype='compact_boundary'），
// 恢复时只加载 boundary 之后的消息
// ──────────────────────────────────────────────────────────

export interface CompactBoundaryMetadata {
  /** 保留段起始 / 结束消息 UUID（可选）*/
  preservedSegment?: { headUuid: string; tailUuid: string };
  tokensBefore: number;
  tokensAfter: number;
  strategy: 'auto' | 'snip' | 'reactive';
}

/**
 * isSnipBoundaryMessage — 判断一条 Message 是否为 snip boundary 标记。
 * v3.3-evolution-delta.md §7.1
 *
 * snip boundary 在消息历史中起分隔符作用，恢复时只加载 boundary 之后的消息。
 */
export function isSnipBoundaryMessage(msg: Message): boolean {
  return msg.role === 'system'
    && (msg as SnipBoundaryMessage).subtype === 'compact_boundary'
    && (msg as SnipBoundaryMessage).compactMetadata !== undefined;
}

/**
 * SnipBoundaryMessage — 携带 CompactBoundaryMetadata 的系统消息（内部格式）。
 */
export interface SnipBoundaryMessage extends Message {
  subtype: 'compact_boundary';
  compactMetadata: CompactBoundaryMetadata;
}

/**
 * CompactEvent — 上下文压缩事件记录（09-context-management.md §10）。
 * 每次压缩完成后追加到会话的压缩历史中。
 */
export interface CompactEvent {
  /** 压缩策略级别 */
  level: 'snip' | 'micro' | 'auto' | 'reactive';
  timestamp: Date;
  beforeTokens: number;
  afterTokens: number;
  removedMessages: number;
  summaryLength?: number;
  trigger: 'threshold' | 'api_error' | 'manual';
}

/**
 * ContextPointer — 存储感知的上下文指针（09-context-management.md §13）。
 *
 * 规则：
 *   small  → inline（直接嵌入消息）
 *   medium → summary + pointer（摘要 + 外部引用）
 *   large  → object store + pointer（磁盘存储 + 引用）
 */
export interface ContextPointer {
  /** 全局唯一指针 ID */
  id: string;
  /** 内容类型：工具结果 / 摘要 / 用户上传 / 推理过程 */
  kind: 'tool_result' | 'summary' | 'user_upload' | 'reasoning';
  /** 存储后端：内存 / 磁盘 / 向量库 */
  store: 'inline' | 'disk' | 'vector';
  /** 存储位置：inline 为空，disk/vector 为路径或 collection+id */
  location?: string;
  /** 人类可读的内容预览（前 200 字符）*/
  preview: string;
  /** Token 估算量 */
  tokenEstimate: number;
}

// ──────────────────────────────────────────────────────────
// Message (对话历史)
// ──────────────────────────────────────────────────────────

export interface ToolCall {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolResult {
  readonly toolUseId: string;
  readonly isError: boolean;
  readonly content: unknown;
}

export interface AttachmentReference {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly textPreview?: string;
}

export interface Message {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly reasoningContent?: string;
  readonly toolCalls?: ToolCall[];
  readonly toolResults?: ToolResult[];
  readonly attachmentRefs?: AttachmentReference[];
  readonly timestamp?: number;
}

// ──────────────────────────────────────────────────────────
// Usage & Cost
// ──────────────────────────────────────────────────────────

export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

// ──────────────────────────────────────────────────────────
// 业务场景 / 风控规则 / 画像 / 缺口报告 领域模型
// ──────────────────────────────────────────────────────────

export const BusinessScenarioSchema = z.object({
  scenarioId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  domain: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  version: z.number().int().default(1),
  dataSources: z.array(z.string()).default([]),
  documents: z.array(z.string()).default([]),
  manualNotes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type BusinessScenario = z.infer<typeof BusinessScenarioSchema>;

export const RiskRuleSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  ruleCode: z.string().optional(),
  bizType: z.string().optional(),
  ruleType: z.string().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  source: z.string().optional(),
  description: z.string().optional(),
  conditions: z.unknown().optional(),
  actions: z.unknown().optional(),
  coverage: z.array(z.string()).default([]),
  status: z.enum(['active', 'draft', 'retired']).default('active'),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  syncedAt: z.string()
});
export type RiskRule = z.infer<typeof RiskRuleSchema>;

export const BusinessProfileSchema = z.object({
  profileId: z.string(),
  sessionId: z.string(),
  businessName: z.string(),
  version: z.number().int().default(1),
  entities: z.array(z.any()).default([]),
  behaviors: z.array(z.any()).default([]),
  apiFeatures: z.array(z.any()).default([]),
  overallScore: z.number().min(0).max(100).default(0),
  createdAt: z.string()
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const CoverageMatrixRowSchema = z.object({
  scenarioId: z.string(),
  scenarioName: z.string(),
  coveredRuleIds: z.array(z.string()).default([]),
  missingRuleTypes: z.array(z.string()).default([]),
  coveragePercent: z.number().min(0).max(100).default(0)
});
export type CoverageMatrixRow = z.infer<typeof CoverageMatrixRowSchema>;

export const GapSchema = z.object({
  gapId: z.string(),
  title: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.string(),
  description: z.string(),
  suggestedRuleTypes: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  /** 缺口类型（research-workflow.md §3.2） */
  gapType: z.enum(['no_rule', 'insufficient', 'outdated', 'conflict']).optional(),
  /** 预计影响范围（research-workflow.md §3.2） */
  estimatedImpact: z.object({
    affectedVolume: z.number().optional(),   // 预计受影响交易量/天
    potentialLoss: z.number().optional()      // 预计潜在损失（元/天）
  }).optional()
});
export type Gap = z.infer<typeof GapSchema>;

export const RuleGapMapSchema = z.object({
  scenarioIds: z.array(z.string()).default([]),
  coverage: z.array(CoverageMatrixRowSchema).default([]),
  criticalGaps: z.array(GapSchema).default([]),
  allGaps: z.array(GapSchema).default([]),
  aggregatedAt: z.string(),
  // ─── research-workflow.md §3.2 扩展字段（可选，向后兼容）───
  /** 现有规则对业务场景的覆盖评分（0-100） */
  coverageScore: z.number().min(0).max(100).optional(),
  /** gap IDs 按优先级排序 */
  priorityOrder: z.array(z.string()).default([]),
  /** 数据质量/可信度备注 */
  dataQualityNotes: z.array(z.string()).default([]),
  /** 聚合时间戳（Unix ms） */
  researchTimestamp: z.number().optional(),
  /** 本次聚合覆盖的调查维度 */
  dimensionsCovered: z.array(z.string()).default([])
});
export type RuleGapMap = z.infer<typeof RuleGapMapSchema>;

export const GapAnalysisReportSchema = z.object({
  reportId: z.string(),
  sessionId: z.string(),
  businessName: z.string(),
  locale: z.string().default('zh-CN'),
  overallScore: z.number().min(0).max(100).default(0),
  coverageMatrix: z.array(CoverageMatrixRowSchema).default([]),
  criticalGaps: z.array(GapSchema).default([]),
  allGaps: z.array(GapSchema).default([]),
  suggestions: z.array(z.string()).default([]),
  narrative: z.string().default(''),
  createdAt: z.string()
});
export type GapAnalysisReport = z.infer<typeof GapAnalysisReportSchema>;

// ──────────────────────────────────────────────────────────
// Synthesis 接口（research-workflow.md §4）
// ──────────────────────────────────────────────────────────

/**
 * Finding — Research 阶段的关键发现（来源于调查 Worker 输出）。
 * Coordinator Synthesis 阶段自己读取并综合，禁止委托给 Worker 处理。
 */
export interface Finding {
  /** 来源维度 ID（如 'data_source', 'rule_coverage'） */
  dimension: string;
  /** 发现标识（唯一键） */
  key: string;
  /** 精确描述（含字段名/表名/接口名，不得泛化） */
  description: string;
  /** 证据引用（来自哪个 Worker 调查结果） */
  evidence: string;
}

/**
 * ImplTask — 精确实施任务规范，含文件路径/字段/操作。
 */
export interface ImplTask {
  description: string;
  /** 涉及文件/数据库表列表 */
  files: string[];
  /** 具体操作（INSERT rule / UPDATE config / ...） */
  operations: string[];
  /** 前置任务 ID（DAG 依赖） */
  dependencies: string[];
  /** 建议的验证命令 */
  verificationCommand?: string;
  /** 验证标准（如何证明实施成功） */
  verificationCriteria?: string[];
}

/**
 * SynthesisOutput — Coordinator Synthesis 阶段的标准输出结构。
 * 参考 research-workflow.md §4.2 Synthesis 输出模板。
 */
export interface SynthesisOutput {
  /** Coordinator 的理解摘要（供用户确认） */
  understanding: string;
  /** 关键发现（至少 3 条） */
  keyFindings: Finding[];
  /** 精确实施规范（每条含文件路径/字段/操作） */
  implementationPlan: ImplTask[];
  /** 验证标准（如何证明实施成功） */
  verificationCriteria: string[];
  /** 需要用户确认的关键决策点（可选） */
  userConfirmRequired?: string;
}

// ──────────────────────────────────────────────────────────
// StorageConfig
// ──────────────────────────────────────────────────────────

export const StorageConfigSchema = z.object({
  backend: z.enum(['embedded', 'external', 'hybrid']).default('embedded'),
  structured: z
    .object({
      /** storage-profiles.md: sqlite | postgresql | mysql */
      backend: z.enum(['sqlite', 'postgresql', 'mysql']).default('sqlite'),
      file: z.string().optional(),
      url: z.string().optional()
    })
    .default({ backend: 'sqlite' }),
  vector: z
    .object({
      /** storage-profiles.md: lancedb | milvus | qdrant | chroma */
      backend: z.enum(['lancedb', 'milvus', 'qdrant', 'chroma']).default('lancedb'),
      path: z.string().optional(),
      url: z.string().optional()
    })
    .default({ backend: 'lancedb' }),
  graph: z
    .object({
      /** storage-profiles.md: graphology | neo4j */
      backend: z.enum(['graphology', 'neo4j']).default('graphology'),
      path: z.string().optional(),
      url: z.string().optional()
    })
    .default({ backend: 'graphology' }),
  object: z
    .object({
      /** storage-profiles.md: local | s3 | minio | oss */
      backend: z.enum(['local', 's3', 'minio', 'oss']).default('local'),
      path: z.string().optional(),
      bucket: z.string().optional(),
      endpoint: z.string().optional()
    })
    .default({ backend: 'local' })
});
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
