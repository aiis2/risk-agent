/**
 * Worker Prompt 构造函数
 * 参考 research-workflow.md §6 — Worker Prompt 规范
 *
 * §6.1 Research Worker Prompt 模板
 * §6.2 实施 Worker Prompt 模板
 *
 * 附：§3.1 聚合节点 Prompt 构造
 */

import type { WorkerSpec } from './ResearchDimensions.js';
import type { Finding, ImplTask } from '../agents/base/types.js';

// ──────────────────────────────────────────────────────────
// Research Worker Prompt
// ──────────────────────────────────────────────────────────

export interface ResearchWorkerSpec extends WorkerSpec {
  scope: string;
  availableTables: string[];
  availableAPIs?: string[];
  knowledgeBases?: string[];
  focusPoints: string[];
}

/**
 * buildResearchWorkerPrompt — 构造 Research Worker 的系统提示词。
 * 参考 research-workflow.md §6.1。
 *
 * 原则：含具体字段名/表名/接口名，禁止泛化；仅报告发现，不修改数据。
 */
export function buildResearchWorkerPrompt(spec: ResearchWorkerSpec): string {
  const apis = spec.availableAPIs?.join(', ') ?? '无';
  const kbs = spec.knowledgeBases?.join(', ') ?? '无';
  const focusLines = spec.focusPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const tableLines = spec.availableTables.join(', ');

  return `你是 Risk Agent 风控调查 Worker，专门负责：${spec.task}

## 分析目标
${spec.analysisGoal ?? spec.task}

## 调查范围
${spec.scope}

## 数据访问
- 可用数据表: ${tableLines}
- 可用接口: ${apis}
- 向量知识库: ${kbs}

## 调查重点
${focusLines}

## 输出要求
以下信息必须包含在报告中：
- 具体字段名、表名、接口路径（不得泛化）
- 数字量化结果（如：命中规则数量、近 7 日交易量）
- 数据质量问题（如：字段缺失率、时间范围限制）

重要：
- 仅报告发现，不修改任何数据
- 如果数据不可访问，明确说明原因而非假设
- 完成后输出结构化摘要（含结果和数据来源）
`.trim();
}

// ──────────────────────────────────────────────────────────
// 实施 Worker Prompt
// ──────────────────────────────────────────────────────────

/**
 * buildImplWorkerPrompt — 构造实施 Worker 的系统提示词。
 * 参考 research-workflow.md §6.2。
 *
 * 原则：精确到字段和操作，不得自行假设修复方案。
 */
export function buildImplWorkerPrompt(task: ImplTask, findings: Finding[]): string {
  const findingLines = findings
    .map((f) => `- [${f.dimension}] ${f.description}`)
    .join('\n');
  const opLines = task.operations.map((op, i) => `${i + 1}. ${op}`).join('\n');
  const fileLines = task.files.join('\n');
  const criteria = task.verificationCriteria?.map((c) => `- ${c}`).join('\n')
    ?? '- 操作无报错\n- 验证命令输出符合预期';

  return `你是 Risk Agent 风控实施 Worker，执行以下精确任务。

## 实施目标
${task.description}

## 关键发现（Research 阶段结论）
${findingLines}

## 具体操作
${opLines}

## 涉及文件/数据库
${fileLines}

## 完成标准
执行完成的判断标准（必须全部满足）：
${criteria}

## 执行后报告
完成后报告：
1. 已执行的具体操作（含实际字段值、生成的 ID）
2. 执行结果验证（运行验证命令并输出结果）
3. 如遇到问题，报告具体错误信息（不要自行假设修复方案）
`.trim();
}

// ──────────────────────────────────────────────────────────
// 聚合节点 Prompt（研究聚合器使用）
// ──────────────────────────────────────────────────────────

export interface AggregatorWorkerResult {
  status: 'completed' | 'failed' | 'skipped';
  description?: string;
  result?: string;
}

/**
 * buildAggregatorPrompt — 构造 ResearchAggregator 子 Agent 的系统提示词。
 * 参考 research-workflow.md §3.1。
 *
 * 原则：自包含（含所有维度摘要）；只基于实际证据，不虚构数据。
 */
export function buildAggregatorPrompt(
  results: Map<string, AggregatorWorkerResult[]>,
): string {
  const sections = Array.from(results.entries()).map(([dimId, workers]) => {
    const summaries = workers
      .filter((w) => w.status === 'completed')
      .map((w) => `  - ${w.description ?? dimId}: ${w.result ?? '（无详情）'}`)
      .join('\n');
    return `## ${dimId}\n${summaries || '  （该维度无已完成的 Worker 结果）'}`;
  });

  return `你是一个风控分析专家。以下是多维度调查结果，请综合分析并生成结构化的「规则缺口地图」。

调查结果：
${sections.join('\n\n')}

输出要求：
使用 output_structured_result 工具输出 RuleGapMap 结构，包含：
1. allGaps: 识别出的规则缺口列表（每条含：场景描述、风险等级、建议规则类型、gapType）
2. coverageScore: 现有规则对业务场景的覆盖评分（0-100）
3. priorityOrder: 按风险等级排序的优先处理顺序（gap IDs）
4. dataQualityNotes: 数据质量问题（如数据缺失、接口不可访问等）

重要：只基于调查所发现的实际证据，不要虚构数据。

分析时关注：
- 高价值业务场景（高交易金额/高频操作）是否有充分的规则保护
- 历史漏报样本揭示的规则盲区
- 新兴业务模式（近 3 个月上线）是否已有对应规则
- 跨渠道/跨产品的协同攻击场景
`.trim();
}
