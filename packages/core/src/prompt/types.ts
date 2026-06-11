export interface PromptLayer {
  readonly name: string;
  readonly priority: number; // lower = earlier in prompt
  readonly stable: boolean;
  compile(context: PromptContext): Promise<string | null>;
}

export interface PromptContext {
  sessionId: string;
  workerRole?: string;
  domain?: string;
  businessName?: string;
  scenarios?: Array<{ name: string; description?: string }>;
  rules?: Array<{ name: string; ruleType?: string }>;
  memorySnippets?: string[];
  shortTermSummary?: string;          // 当前会话短期记忆摘要
  ragSnippets?: string[];
  dataSourceSummaries?: string[];
  locale?: string;
  instructions?: string;
  // 动态多层 — §17
  availableComponents?: Array<{ name: string; description: string }>;  // System RAG
  riskDomainContext?: string;         // 风控领域上下文
  previousAnalysisSummary?: string;   // 前次分析摘要
  presetPromptModifier?: string;      // 分析预设修饰器
  userPrompts?: string[];             // 用户自定义提示片段
  currentTime?: string;               // 当前时间（LLM 感知时间）
  // ─── Coordinator 模式上下文（v3.3-evolution-delta.md §4.3）────────────────
  coordinatorMode?: boolean;                // 是否处于 Coordinator 模式
  coordinatorWorkerContext?: string;        // Worker 可用工具 + Scratchpad 信息

  // ─── Hermes 风格人格 / 用户画像（A1/A2，2026-04-29 实施计划）────────────
  persona?: {
    personaId: string;
    name: string;
    scope: string;
    systemPrompt: string;
    traits?: Record<string, unknown>;
  };
  userProfile?: {
    displayName?: string;
    traits?: { industry?: string; role?: string; languagePref?: string; [k: string]: unknown };
    preferences?: { verbosity?: string; format?: string; [k: string]: unknown };
    learnedFacts?: Array<{ key?: string; value: string; learnedAt?: string }>;
  };
  /** 最近 N 轮 transcript 摘要（A6 通用模式上下文化） */
  recentTranscriptSummary?: string;
}
