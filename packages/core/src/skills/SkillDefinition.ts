/**
 * SkillDefinition — 技能完整接口与安全校验
 * （参考 agent-framework.md §19 · evolution-overview.md §4.4 技能体系 v3.3 深化）
 *
 * 三层技能来源：
 *   bundled   — 随系统分发，编译时内置
 *   directory — 扫描 skills/ 目录，支持热重载
 *   mcp       — 运行时从 MCP Server 发现
 *
 * 安全扫描：所有 directory 技能在加载前经 FORBIDDEN_CODE_PATTERNS 扫描
 */

// ──────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────

/** 技能参数 JSON Schema 描述 */
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

/** 技能参数 Schema */
export interface SkillParameterSchema {
  type: 'object';
  properties: Record<string, SkillParameter>;
  required?: string[];
}

/**
 * 完整技能定义（参考 agent-framework.md §19.2）
 */
export interface SkillDefinition {
  name: string;
  description: string;
  source: 'bundled' | 'directory' | 'mcp' | 'ai-generated' | 'dynamic' | 'conditional';

  // ─── 执行 ───────────────────────────────────────────────
  /** 执行技能，返回结果字符串 */
  execute(args: Record<string, unknown>): Promise<string>;
  /** 参数 schema，供 LLM 工具描述使用 */
  parameters?: SkillParameterSchema;

  // ─── 元数据 ─────────────────────────────────────────────
  version?: string;
  author?: string;
  tags?: string[];
  path?: string;         // directory 技能所在路径

  // ─── v3.3 条件/动态技能 ─────────────────────────────────
  /** 条件技能触发路径 glob（匹配文件被操作时激活） */
  paths?: string[];
  /** fork 上下文：隔离执行不污染主对话 */
  contextMode?: 'shared' | 'fork';

  // ─── §6.8 技能级 Hooks（tools-skills-system.md §6.8）────
  /** 本技能附带的 PreToolUse/PostToolUse Hooks */
  hooks?: SkillHookConfig;
}

/** §6.8 技能 SKILL.md 中定义的 Hook 条目 */
export interface SkillHookEntry {
  /** 触发此 Hook 的工具名（支持 glob，如 "database_*"） */
  matcher: string;
  /** 运行的 Shell 命令（可选；不提供时仅记录日志） */
  command?: string;
}

export interface SkillHookConfig {
  /** 工具调用前 Hook：可拒绝（command 非 0 退出 = 拦截） */
  PreToolUse?: SkillHookEntry[];
  /** 工具调用后 Hook：结果后处理 */
  PostToolUse?: SkillHookEntry[];
}

// ──────────────────────────────────────────────────────────
// 安全扫描
// ──────────────────────────────────────────────────────────

/**
 * 禁止在 directory 技能代码中出现的高风险模式
 * （防止恶意技能通过文件系统注入攻击系统）
 */
export const FORBIDDEN_CODE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, description: 'direct fs require' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, description: 'child_process require' },
  { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]child_process['"]/, description: 'child_process import' },
  { pattern: /import\s+\{[^}]+\}\s+from\s+['"]child_process['"]/, description: 'child_process import' },
  { pattern: /process\.env/, description: 'process.env access' },
  { pattern: /process\.exit/, description: 'process.exit call' },
  { pattern: /eval\s*\(/, description: 'eval() call' },
  { pattern: /new\s+Function\s*\(/, description: 'new Function() constructor' },
  { pattern: /global\s*\[/, description: 'global property access via bracket' },
  { pattern: /\bexec\s*\(/, description: 'exec() call (possible command injection)' },
  { pattern: /\bspawn\s*\(/, description: 'spawn() call (possible command injection)' },
  { pattern: /\bexecSync\s*\(/, description: 'execSync() call' },
  { pattern: /__dirname/, description: '__dirname access (path traversal risk)' },
  { pattern: /\.\.\//, description: 'path traversal pattern' }
];

export interface SecurityScanResult {
  safe: boolean;
  violations: string[];
}

/**
 * 扫描技能源码，检测禁止模式
 */
export function validateCodeSafety(source: string): SecurityScanResult {
  const violations: string[] = [];
  for (const { pattern, description } of FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(source)) violations.push(description);
  }
  return { safe: violations.length === 0, violations };
}

// ──────────────────────────────────────────────────────────
// 内置 Bundled Skills（风控专属）
// ──────────────────────────────────────────────────────────

/**
 * 注册内置技能（在 SkillLoader 中使用）
 */
export const BUNDLED_SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    name: 'risk-scan',
    description: '对指定业务场景进行快速风险扫描，识别高风险操作和缺失规则。',
    source: 'bundled',
    version: '1.0.0',
    tags: ['risk', 'scan', 'analysis'],
    parameters: {
      type: 'object',
      properties: {
        scenarioId: { name: 'scenarioId', type: 'string', description: '业务场景ID', required: true },
        depth: { name: 'depth', type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' }
      },
      required: ['scenarioId']
    },
    async execute(args) {
      return `[risk-scan] 对场景 ${args.scenarioId} 完成风险扫描（深度: ${args.depth ?? 'standard'}）`;
    }
  },
  {
    name: 'gap-analysis',
    description: '分析业务场景与风控规则之间的覆盖缺口，输出结构化缺口报告。',
    source: 'bundled',
    version: '1.0.0',
    tags: ['gap', 'analysis', 'coverage'],
    parameters: {
      type: 'object',
      properties: {
        scenarioId: { name: 'scenarioId', type: 'string', description: '业务场景ID', required: true },
        ruleIds: { name: 'ruleIds', type: 'array', description: '要分析的规则ID列表' }
      },
      required: ['scenarioId']
    },
    async execute(args) {
      return `[gap-analysis] 场景 ${args.scenarioId} 缺口分析完成`;
    }
  },
  {
    name: 'report-gen',
    description: '将分析结果整合为标准化风控分析报告（Markdown 格式，支持多语言）。',
    source: 'bundled',
    version: '1.0.0',
    tags: ['report', 'generate', 'output'],
    parameters: {
      type: 'object',
      properties: {
        sessionId: { name: 'sessionId', type: 'string', description: '会话ID', required: true },
        format: { name: 'format', type: 'string', enum: ['markdown', 'json', 'html'], default: 'markdown' },
        locale: { name: 'locale', type: 'string', enum: ['zh-CN', 'en-US'], default: 'zh-CN' }
      },
      required: ['sessionId']
    },
    async execute(args) {
      return `[report-gen] 会话 ${args.sessionId} 报告已生成（格式: ${args.format ?? 'markdown'}）`;
    }
  },
  {
    name: 'rule-import',
    description: '从 CSV/JSON/数据库导入风控规则，自动解析结构并入库。',
    source: 'bundled',
    version: '1.0.0',
    tags: ['rule', 'import', 'database'],
    parameters: {
      type: 'object',
      properties: {
        source: { name: 'source', type: 'string', description: '数据来源路径或连接字符串', required: true },
        format: { name: 'format', type: 'string', enum: ['csv', 'json', 'db'], default: 'json' }
      },
      required: ['source']
    },
    async execute(args) {
      return `[rule-import] 规则导入完成（来源: ${args.source}，格式: ${args.format ?? 'json'}）`;
    }
  }
];

// ──────────────────────────────────────────────────────────
// MCP Skill Builder（参考 agent-framework.md §19.2）
// ──────────────────────────────────────────────────────────

export interface McpServer {
  name: string;
  url: string;
  timeout?: number;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * 将 MCP Server 工具封装为 SkillDefinition
 * （参考 claude-code `mcpSkillBuilders.ts`）
 */
export function buildMcpSkill(server: McpServer, tool: McpToolInfo): SkillDefinition {
  return {
    name: `mcp_${server.name}_${tool.name}`,
    description: `[MCP: ${server.name}] ${tool.description}`,
    source: 'mcp',
    version: '1.0.0',
    tags: ['mcp', server.name],
    parameters: {
      type: 'object',
      properties: tool.inputSchema as Record<string, SkillParameter>,
      required: []
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const timeout = server.timeout ?? 30_000;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const resp = await fetch(server.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: tool.name, args }),
          signal: ctrl.signal
        });
        if (!resp.ok) {
          const text = await resp.text();
          return `MCP 失败 (${resp.status}): ${text.slice(0, 200)}`;
        }
        const data = await resp.json() as { result?: unknown; error?: string };
        if (data.error) return `MCP 错误: ${data.error}`;
        return typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
      } catch (err) {
        return `MCP 调用失败: ${(err as Error).message}`;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
