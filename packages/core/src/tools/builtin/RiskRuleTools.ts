/**
 * RiskRuleTools — 风控专属工具集（参考 tools-skills-system.md §7.3）
 *
 * 包含：
 *   import_risk_rules  — 从外部导入/解析风控规则（§7.3）
 *   modify_risk_rule   — 修改线上风控规则（isDestructive = true）
 *   delete_risk_rule   — 删除风控规则（isDestructive = true）
 *   export_report      — 导出风险分析报告（§7.3）
 *   build_gap_map      — 构建规则缺口地图（§7.3）
 *   call_external_api  — 调用外部风控系统 API（§7.3）
 */

import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';
import { buildTool } from '../registry/ToolRegistry.js';

// ──────────────────────────────────────────────────────────
// import_risk_rules
// ──────────────────────────────────────────────────────────

export interface ImportRiskRulesInput {
  source: string;            // 数据来源路径或连接字符串
  format?: 'csv' | 'json' | 'db' | 'yaml' | 'xml';
  targetRuleSet?: string;    // 导入到哪个规则集（可选）
  dryRun?: boolean;          // 仅解析，不写入
}

export interface ImportRiskRulesOutput {
  importedCount: number;
  skippedCount: number;
  errors: string[];
  ruleIds: string[];
  preview?: Record<string, unknown>[];
}

export const importRiskRulesTool: AgentToolDefinition<ImportRiskRulesInput, ImportRiskRulesOutput> = buildTool({
  name: 'import_risk_rules',
  description: '从外部数据源（CSV/JSON/数据库/YAML）导入并解析风控规则，自动入库并构建血缘关系。',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'import parse risk control rules from external system CSV JSON',
  maxResultSizeChars: 50_000,
  inputSchema: {
    type: 'object',
    required: ['source'],
    properties: {
      source: { type: 'string', description: '数据来源路径或连接字符串' },
      format: { type: 'string', enum: ['csv', 'json', 'db', 'yaml', 'xml'], description: '数据格式（默认 json）' },
      targetRuleSet: { type: 'string', description: '导入到的规则集名称' },
      dryRun: { type: 'boolean', description: '仅解析预览，不写入数据库' },
    },
  },
  getActivityDescription: (_input) => '正在导入风控规则…',
  async execute(_input: ImportRiskRulesInput, _ctx: ToolExecContext) {
    // 占位实现：返回结构化响应，具体逻辑由 RiskRuleAgent 实现
    return {
      importedCount: 0,
      skippedCount: 0,
      errors: [],
      ruleIds: [],
      preview: [],
    };
  },
});

// ──────────────────────────────────────────────────────────
// modify_risk_rule
// ──────────────────────────────────────────────────────────

export interface ModifyRiskRuleInput {
  ruleId: string;
  updates: Record<string, unknown>;  // 要修改的字段
  reason?: string;                   // 修改原因（写入审计日志）
}

export interface ModifyRiskRuleOutput {
  success: boolean;
  ruleId: string;
  previousValues: Record<string, unknown>;
  auditLogId?: string;
}

export const modifyRiskRuleTool: AgentToolDefinition<ModifyRiskRuleInput, ModifyRiskRuleOutput> = buildTool({
  name: 'modify_risk_rule',
  description: '修改线上风控规则的字段值（如阈值、状态、优先级）。操作不可逆，自动写入审计日志。',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'modify update existing risk rule configuration threshold status',
  maxResultSizeChars: 10_000,
  inputSchema: {
    type: 'object',
    required: ['ruleId', 'updates'],
    properties: {
      ruleId: { type: 'string', description: '要修改的规则ID' },
      updates: { type: 'object', description: '要修改的字段键值对' },
      reason: { type: 'string', description: '修改原因（用于审计日志）' },
    },
  },
  getActivityDescription: (input: ModifyRiskRuleInput) => `正在修改规则 ${input?.ruleId}…`,
  async execute(input: ModifyRiskRuleInput, _ctx: ToolExecContext) {
    return {
      success: false,
      ruleId: input.ruleId,
      previousValues: {},
      auditLogId: undefined,
    };
  },
});

// ──────────────────────────────────────────────────────────
// delete_risk_rule
// ──────────────────────────────────────────────────────────

export interface DeleteRiskRuleInput {
  ruleId: string;
  hardDelete?: boolean;   // true = 物理删除，false = 软删除（默认）
  reason?: string;
}

export interface DeleteRiskRuleOutput {
  success: boolean;
  ruleId: string;
  deletedAt: string;
  auditLogId?: string;
}

export const deleteRiskRuleTool: AgentToolDefinition<DeleteRiskRuleInput, DeleteRiskRuleOutput> = buildTool({
  name: 'delete_risk_rule',
  description: '删除风控规则（支持软删除/硬删除）。操作不可逆，自动写入审计日志。',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: true,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'delete remove risk rule permanently archive',
  maxResultSizeChars: 5_000,
  inputSchema: {
    type: 'object',
    required: ['ruleId'],
    properties: {
      ruleId: { type: 'string', description: '要删除的规则ID' },
      hardDelete: { type: 'boolean', description: '是否物理删除（默认软删除）' },
      reason: { type: 'string', description: '删除原因（用于审计日志）' },
    },
  },
  getActivityDescription: (input: DeleteRiskRuleInput) => `正在删除规则 ${input?.ruleId}…`,
  async execute(input: DeleteRiskRuleInput, _ctx: ToolExecContext) {
    return {
      success: false,
      ruleId: input.ruleId,
      deletedAt: new Date().toISOString(),
      auditLogId: undefined,
    };
  },
});

// ──────────────────────────────────────────────────────────
// export_report
// ──────────────────────────────────────────────────────────

export interface ExportReportInput {
  sessionId: string;
  format?: 'markdown' | 'html' | 'pdf' | 'json';
  locale?: 'zh-CN' | 'en-US';
  outputPath?: string;    // 保存路径（不提供则返回内容）
  includeCharts?: boolean;
}

export interface ExportReportOutput {
  success: boolean;
  format: string;
  locale: string;
  content?: string;       // 若无 outputPath，内联返回
  filePath?: string;      // 若有 outputPath，返回路径
  sizeBytes: number;
}

export const exportReportTool: AgentToolDefinition<ExportReportInput, ExportReportOutput> = buildTool({
  name: 'export_report',
  description: '将会话分析结果导出为风险分析报告（Markdown/HTML/PDF/JSON 格式，支持多语言）。',
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'export generate risk analysis report PDF HTML markdown',
  maxResultSizeChars: 200_000,
  inputSchema: {
    type: 'object',
    required: ['sessionId'],
    properties: {
      sessionId: { type: 'string', description: '会话ID' },
      format: { type: 'string', enum: ['markdown', 'html', 'pdf', 'json'], description: '报告格式（默认 markdown）' },
      locale: { type: 'string', enum: ['zh-CN', 'en-US'], description: '报告语言（默认 zh-CN）' },
      outputPath: { type: 'string', description: '输出文件路径（可选）' },
      includeCharts: { type: 'boolean', description: '是否包含图表（默认 true）' },
    },
  },
  getActivityDescription: (_input) => '正在生成风险报告…',
  async execute(input: ExportReportInput, _ctx: ToolExecContext) {
    return {
      success: false,
      format: input.format ?? 'markdown',
      locale: input.locale ?? 'zh-CN',
      content: undefined,
      filePath: undefined,
      sizeBytes: 0,
    };
  },
});

// ──────────────────────────────────────────────────────────
// build_gap_map
// ──────────────────────────────────────────────────────────

export interface BuildGapMapInput {
  scenarioId: string;
  ruleSetId?: string;       // 要分析的规则集（不提供则分析所有）
  includeRecommendations?: boolean;
}

export interface GapItem {
  gapId: string;
  scenarioPath: string;    // 业务路径
  ruleIds: string[];       // 相关规则
  gapType: 'no_rule' | 'insufficient' | 'outdated' | 'conflict';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation?: string;
}

export interface BuildGapMapOutput {
  scenarioId: string;
  coverageScore: number;   // 0-100
  totalPaths: number;
  coveredPaths: number;
  gaps: GapItem[];
  priorityOrder: string[]; // gap IDs 按优先级排序
}

export const buildGapMapTool: AgentToolDefinition<BuildGapMapInput, BuildGapMapOutput> = buildTool({
  name: 'build_gap_map',
  description: '构建业务场景的规则缺口地图，识别未覆盖或覆盖不足的风险路径。',
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'analyze coverage gap map risk rule missing uncovered scenario',
  maxResultSizeChars: 100_000,
  inputSchema: {
    type: 'object',
    required: ['scenarioId'],
    properties: {
      scenarioId: { type: 'string', description: '业务场景ID' },
      ruleSetId: { type: 'string', description: '要分析的规则集ID（默认分析所有）' },
      includeRecommendations: { type: 'boolean', description: '是否包含修复建议（默认 true）' },
    },
  },
  getActivityDescription: (_input) => '正在构建规则缺口地图…',
  async execute(input: BuildGapMapInput, _ctx: ToolExecContext) {
    return {
      scenarioId: input.scenarioId,
      coverageScore: 0,
      totalPaths: 0,
      coveredPaths: 0,
      gaps: [],
      priorityOrder: [],
    };
  },
});

// ──────────────────────────────────────────────────────────
// call_external_api
// ──────────────────────────────────────────────────────────

export interface CallExternalApiInput {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;        // 超时时间（默认 10000ms）
  retries?: number;          // 重试次数（默认 2）
}

export interface CallExternalApiOutput {
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, string>;
  durationMs: number;
}

export const callExternalApiTool: AgentToolDefinition<CallExternalApiInput, CallExternalApiOutput> = buildTool({
  name: 'call_external_api',
  description: '调用外部风控系统 API（支持 GET/POST 等），需用户确认（Pre-use Hook）。',
  isReadOnly: false,
  isConcurrencySafe: true,
  isDestructive: false,
  isOpenWorld: true,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'call invoke external risk service API endpoint HTTP request',
  maxResultSizeChars: 50_000,
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP 方法（默认 GET）' },
      headers: { type: 'object', description: '请求头（键值对）' },
      body: { description: '请求体（POST/PUT 时）' },
      timeoutMs: { type: 'number', description: '超时毫秒数（默认 10000）' },
      retries: { type: 'number', description: '失败重试次数（默认 2）' },
    },
  },
  getActivityDescription: (input: CallExternalApiInput) => `正在调用 ${input?.method ?? 'GET'} ${input?.url ?? ''}…`,
  async execute(input: CallExternalApiInput, _ctx: ToolExecContext) {
    const start = Date.now();
    const method = input.method ?? 'GET';
    const timeoutMs = input.timeoutMs ?? 10_000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const init: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json', ...(input.headers ?? {}) },
        signal: controller.signal,
      };
      if (input.body && method !== 'GET') {
        init.body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
      }

      const res = await fetch(input.url, init);
      const data = await res.json().catch(() => res.text());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });

      return {
        status: res.status,
        statusText: res.statusText,
        data,
        headers,
        durationMs: Date.now() - start,
      };
    } finally {
      clearTimeout(timer);
    }
  },
});
