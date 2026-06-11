import type { LLMToolSpec } from '../../llm/LLMAdapter.js';
import type { SandboxAccessTier, SandboxExecutionContext, SandboxHostKind, SandboxPolicy, SandboxRuntime } from '../../sandbox/SandboxRuntime.js';

export type ToolPermission = 'allow' | 'deny' | 'ask';

export interface ToolExecContext {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    phase?: string;
    message?: string;
    percent?: number;
    sandbox?: Record<string, unknown>;
  }) => void;
  readonly permissions?: Record<string, ToolPermission>;
  readonly sandboxRuntime?: SandboxRuntime;
  readonly sandboxContext?: SandboxExecutionContext;
  readonly sandboxPolicy?: SandboxPolicy;
}

/**
 * 工具输入校验结果
 */
export interface ToolInputValidation {
  valid: boolean;
  error?: string;
}

/**
 * AgentToolDefinition — 工具完整协议接口（参考 agent-framework.md §11 + evolution-overview.md §4.3）
 */
export interface AgentToolDefinition<Input = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  // ─── 并发与安全属性 ──────────────────────────────────────
  readonly isConcurrencySafe: boolean;
  readonly isDestructive: boolean;
  /** 只读操作可在 Plan 模式下放行，不计入写操作序列化队列 */
  readonly isReadOnly?: boolean;
  readonly interruptBehavior?: 'halt' | 'wait' | 'parallel';

  // ─── 延迟加载（ToolSearch 机制） ──────────────────────────
  readonly alwaysLoad: boolean;
  readonly deferred?: boolean;
  readonly searchHint?: string;

  // ─── v3.3 工具协议扩展 ──────────────────────────────────
  /** 工具重命名时的向后兼容别名 */
  readonly aliases?: string[];
  /** 是否启用 API 层面严格遵循工具指令 */
  readonly strict?: boolean;
  /** 标记可能产生不可预见副作用的工具 */
  readonly isOpenWorld?: boolean;
  /** 标识工具所属的 sandbox 策略档位 */
  readonly sandboxProfile?: string;
  /** 标识工具期望的执行宿主类型 */
  readonly sandboxHostKind?: SandboxHostKind;
  /** 标识工具所属的 sandbox 能力层级 */
  readonly sandboxAccessTier?: SandboxAccessTier;

  // ─── v3.3 工具协议扩展（续）────────────────────────────────
  /** 此工具是否需要用户交互（如 ask_user 确认框）*/
  requiresUserInteraction?(): boolean;
  /** 是否为 MCP 工具（远程不可信，影响技能 shell 执行策略）*/
  readonly isMcp?: boolean;
  /**
   * 为 Transcript 搜索提供可索引的纯文本。
   * 省略此方法时使用字段名启发式。（v3.3 §6.1）
   */
  extractSearchText?(output: Output): string;
  /**
   * 判断非 verbose 渲染是否被截断（是否呈现展开按钮）。（v3.3 §6.1）
   */
  isResultTruncated?(output: Output): boolean;

  // ─── 结果管理 ──────────────────────────────────────────
  readonly maxResultSizeChars?: number;

  // ─── 核心执行方法 ─────────────────────────────────────
  execute(input: Input, ctx: ToolExecContext): Promise<Output>;

  // ─── 校验与权限 ────────────────────────────────────────
  validateInput?(input: Input): Promise<ToolInputValidation>;
  checkPermissions?(input: Input, mode: ToolPermission): Promise<boolean>;

  // ─── UI / 可观测 ─────────────────────────────────────
  getActivityDescription?(input: Input): string;
  isSearchOrReadCommand?(input: Input): boolean;

  // ─── 高级 ────────────────────────────────────────────
  inputsEquivalent?(a: Input, b: Input): boolean;
  /** v3.3：在 observer 看到输入前回填衍生字段 */
  backfillObservableInput?(input: Input): void;
}

export class ToolRegistry {
  private readonly map = new Map<string, AgentToolDefinition>();
  /** 别名映射表：alias → canonical name */
  private readonly aliasMap = new Map<string, string>();

  register(def: AgentToolDefinition): void {
    this.map.set(def.name, def);
    // 注册别名
    for (const alias of def.aliases ?? []) {
      this.aliasMap.set(alias, def.name);
    }
  }

  unregister(name: string): void {
    const def = this.map.get(name);
    if (def) {
      for (const alias of def.aliases ?? []) this.aliasMap.delete(alias);
    }
    this.map.delete(name);
  }

  /**
   * 按名称获取工具，支持别名解析
   */
  get(name: string): AgentToolDefinition | undefined {
    return this.map.get(name) ?? this.map.get(this.aliasMap.get(name) ?? '');
  }

  list(): AgentToolDefinition[] {
    return Array.from(this.map.values());
  }

  alwaysLoaded(): AgentToolDefinition[] {
    return this.list().filter((t) => t.alwaysLoad);
  }

  /**
   * 只读工具列表（Plan 模式下允许使用）
   */
  readOnly(): AgentToolDefinition[] {
    return this.list().filter((t) => t.isReadOnly === true);
  }

  toLLMToolSpecs(names?: string[]): LLMToolSpec[] {
    const tools = names ? names.map((n) => this.get(n)).filter(Boolean) as AgentToolDefinition[] : this.list();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  }

  partition(names: string[]): { interrupt: string[]; parallel: string[]; serial: string[] } {
    const interrupt: string[] = [];
    const parallel: string[] = [];
    const serial: string[] = [];
    for (const n of names) {
      const t = this.get(n);
      if (!t) {
        serial.push(n);
        continue;
      }
      if (t.interruptBehavior === 'halt' || t.name === 'ask_user') interrupt.push(n);
      else if (t.isConcurrencySafe && !t.isDestructive) parallel.push(n);
      else serial.push(n);
    }
    return { interrupt, parallel, serial };
  }

  /**
   * applyDeferredLoading — 工具数超过阈值时对可延迟工具进行裁剪。
   * 参考 tools-skills-system.md §3
   *
   * alwaysLoad=true / deferred=false 的工具保留完整 schema；
   * deferred=true 的工具替换为仅含 name + searchHint 的摘要（空 inputSchema）。
   */
  applyDeferredLoading(threshold = 40): AgentToolDefinition[] {
    const all = this.list();
    if (all.length <= threshold) return all;

    return all.map((tool) => {
      if (tool.alwaysLoad || !tool.deferred) return tool; // 保留完整版本

      // 延迟加载：仅暴露摘要描述 + 空 schema
      return {
        ...tool,
        description: `[deferred] ${tool.searchHint ?? tool.description}`,
        inputSchema: { type: 'object', properties: {}, required: [] },
        _isDeferred: true,
      } as AgentToolDefinition & { _isDeferred: boolean };
    });
  }
}

// ──────────────────────────────────────────────────────────
// buildTool() 工厂 — 提供合理默认值（参考 tools-skills-system.md §1.2）
// ──────────────────────────────────────────────────────────

const TOOL_DEFAULTS = {
  isReadOnly:         false,
  isConcurrencySafe:  false,
  isDestructive:      false,
  alwaysLoad:         false,
  isMcp:              false,
  deferred:           false,
  strict:             false,
  isOpenWorld:        false,
  maxResultSizeChars: 100_000,
  interruptBehavior:  undefined as AgentToolDefinition['interruptBehavior'],
} as const;

/**
 * buildTool — 工具定义工厂，自动填充未提供的合理默认值。
 *
 * @example
 * const myTool = buildTool({
 *   name: 'my_tool',
 *   description: '...',
 *   inputSchema: { type: 'object', properties: {}, required: [] },
 *   execute: async (input, ctx) => { return 'result' },
 * });
 */
export function buildTool<Input = unknown, Output = unknown>(
  partial: Pick<AgentToolDefinition<Input, Output>, 'name' | 'description' | 'inputSchema' | 'execute'>
    & Partial<AgentToolDefinition<Input, Output>>
): AgentToolDefinition<Input, Output> {
  return {
    ...TOOL_DEFAULTS,
    ...partial,
  } as AgentToolDefinition<Input, Output>;
}
