import { randomUUID } from 'node:crypto';
import type {
  BusinessScenario,
  CoverageMatrixRow,
  Gap,
  GapAnalysisReport,
  RiskRule,
  StreamEvent
} from './base/types.js';
import { BaseAgent, type AgentRunOptions } from './base/BaseAgent.js';
import type { QueryEngine } from '../query/QueryEngine.js';
import type { StorageBackendRegistry } from '../storage/registry.js';
import { ResearchCoordinator } from '../research/ResearchCoordinator.js';
import type { DreamTaskRunner } from './DreamTaskRunner.js';
import { runAnalysisWorkflow } from '../task-packs/analysis/AnalysisWorkflow.js';

export interface AskUserRequest {
  question: string;
  options: string[];
  requestId: string;
  context?: Record<string, unknown>;
}

export type AskUserFn = (req: AskUserRequest) => Promise<string>;

export type AG2UAction = 'report_only' | 'save_kb' | 'write_graph';

export function buildOrchestratorNarrativePrompt(report: GapAnalysisReport, locale: string, guidanceMessages: string[] = []): string {
  const guidanceBlock = guidanceMessages.length
    ? [
        '',
        locale === 'en-US' ? 'User Guidance:' : '用户追加引导：',
        ...guidanceMessages.map((message, index) => `${index + 1}. ${message}`),
      ]
    : [];

  if (guidanceMessages.length > 0) {
    const latestGuidance = guidanceMessages.at(-1) ?? '';
    const heading = locale === 'en-US'
      ? 'Treat the latest user guidance as the primary task and infer intent from the full request instead of keyword routing.'
      : '请根据最新用户引导的完整语义决定本轮任务，不要用关键字规则给任务分流。';

    const instructions = locale === 'en-US'
      ? [
          'The latest user guidance is the primary task for this turn.',
          'Infer intent from the full latest guidance instead of relying on keyword routing.',
          'If the latest guidance asks you to open a URL, inspect a page, capture screenshots, or keep using the browser/Playwright, you must actually call the available browser tools before answering.',
          'If the latest guidance explicitly says not to query the knowledge base, not to reuse the previous template, or to keep using the browser, you must obey those constraints.',
          'Use the Report JSON only as optional background context, not as a fixed output template.',
          'Match the final markdown structure to the latest request.',
        ]
      : [
          '最新一条用户引导是本轮的主任务。',
          '如果最新引导要求访问 URL、查看页面、截图、继续用内置浏览器或 Playwright，必须先实际调用可用的浏览器工具。',
          '如果最新引导明确要求不要检索知识库、不要沿用上一轮模板，或要求继续使用浏览器，必须服从这些约束。',
          'Report JSON 仅作为可选背景上下文，不是固定输出模板。',
          '请根据最新任务输出匹配的简洁 Markdown。',
        ];

    return [
      heading,
      ...instructions,
      ...guidanceBlock,
      '',
      locale === 'en-US' ? 'Latest User Task:' : '最新用户任务：',
      latestGuidance,
      '',
      locale === 'en-US' ? 'Background Report JSON:' : '背景 Report JSON：',
      '```json',
      JSON.stringify({
        businessName: report.businessName,
        overallScore: report.overallScore,
        scenarioCount: report.coverageMatrix.length,
        criticalGapCount: report.criticalGaps.length,
        criticalGaps: report.criticalGaps.slice(0, 5).map((gap) => ({
          title: gap.title,
          severity: gap.severity,
          category: gap.category,
        })),
        suggestions: report.suggestions,
      }, null, 2),
      '```',
    ].join('\n');
  }

  const heading = locale === 'en-US'
    ? 'Write a concise markdown summary for this risk report.'
    : '请为这份风控报告生成简洁的 Markdown 总结。';

  const instructions = locale === 'en-US'
    ? [
        'Output requirements:',
        '1. Start with one short paragraph describing the overall risk conclusion.',
        '2. Then provide a fenced json code block with score, scenarioCount, criticalGapCount.',
        '3. Then provide an unordered list of key gaps.',
        '4. Finally provide a numbered list of recommended actions.',
        'Do not invent data that is not present in the report.',
      ]
    : [
        '输出要求：',
        '1. 先用一小段文字概括整体风险结论；',
        '2. 然后输出一个 json 代码块，包含 score、scenarioCount、criticalGapCount；',
        '3. 再输出一个无序列表，列出关键缺口；',
        '4. 最后输出一个有序列表，给出建议动作。',
        '不要编造报告中不存在的数据。',
      ];

  return [
    heading,
    ...instructions,
    ...guidanceBlock,
    '',
    'Report JSON:',
    '```json',
    JSON.stringify({
      businessName: report.businessName,
      overallScore: report.overallScore,
      scenarioCount: report.coverageMatrix.length,
      criticalGapCount: report.criticalGaps.length,
      criticalGaps: report.criticalGaps.slice(0, 5).map((gap) => ({
        title: gap.title,
        severity: gap.severity,
        category: gap.category,
      })),
      suggestions: report.suggestions,
    }, null, 2),
    '```',
  ].join('\n');
}

export interface OrchestratorOptions {
  sessionId: string;
  businessName: string;
  locale?: string;
  guidanceMessages?: string[];
  scenarios: BusinessScenario[];
  rules: RiskRule[];
  storage: StorageBackendRegistry;
  queryEngine: QueryEngine;
  /** 规则加载范围过滤（传递给 RiskRuleAgent）*/
  ruleScope?: { bizTypes?: string[]; ruleTypes?: string[] };
  /**
   * AG2U (Agent → User) 回调。若存在，则在完成后询问用户决定报告去向。
   * 返回值建议为 `report_only | save_kb | write_graph`，未识别时按 report_only 处理。
   */
  askUser?: AskUserFn;
  /**
   * 可选 Dream Task Runner。若提供，Orchestrator 在各阶段间检查完成通知
   * 并以 dream_task_notification StreamEvent 形式转发（react-loop-engine.md §1.2）。
   */
  dreamRunner?: DreamTaskRunner;
}

/**
 * OrchestratorAgent — 四阶段 Coordinator 实现。
 *
 * Phase 1 Research: 四维并行调研（coverage / risk-gaps / compliance / anomaly）
 * Phase 2 Synthesis: 合成 RuleGapMap
 * Phase 3 Implementation: 生成 GapAnalysisReport
 * Phase 4 Verification: 校验结构、分数一致性，失败则自动纠错一轮
 */
export class OrchestratorAgent extends BaseAgent {
  constructor(private readonly options: OrchestratorOptions) {
    super(options.sessionId);
  }

  async *run(_opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined> {
    const { businessName, storage } = this.options;
    let { scenarios, rules } = this.options;
    const locale = this.options.locale ?? 'zh-CN';
    const guidanceMessages = (this.options.guidanceMessages ?? []).map((entry) => entry.trim()).filter(Boolean);
    const store = storage.getStructuredStore();

    // ── Delegate to extracted AnalysisWorkflow ────────────────────────────────
    const bufferedEvents: StreamEvent[] = [];
    const result = await runAnalysisWorkflow({
      runId: this.options.sessionId,
      businessName,
      locale,
      scenarioIds: scenarios.map((scenario) => scenario.scenarioId),
      ruleScope: this.options.ruleScope,
      guidanceMessages,
    }, {
      storage,
      base: {
        sessionId: this.options.sessionId,
        scenarios,
        rules,
        ruleScope: this.options.ruleScope,
        guidanceMessages,
      },
      emit: async (event) => {
        bufferedEvents.push(event);
      },
      setPhase: async (phase) => {
        await store.run(`UPDATE sessions SET phase=?, updated_at=datetime('now') WHERE session_id=?`, [phase, this.options.sessionId]).catch(() => undefined);
      },
      onSemanticCheckpoint: async () => undefined,
    });

    for (const event of bufferedEvents) {
      yield event;
    }

    // 转发 Dream Task 完成通知
    for (const ev of this.options.dreamRunner?.drainNotifications() ?? []) yield ev;

    const report = result.report;

    // Phase 4: Verification + 多轮自动纠错（参考 agent-framework.md §6.2）
    yield {
      type: 'subagent_spawned',
      agentId: 'verify',
      description: 'Verification phase',
      taskType: 'local_workflow',
      phase: 'verification'
    };

    const MAX_CORRECTION_ROUNDS = 3;
    let correctionRound = 0;
    let validation = this.verify(report);

    while (!validation.valid && correctionRound < MAX_CORRECTION_ROUNDS) {
      correctionRound++;
      const issueMessages = (validation.issues ?? []).map((i) => i.message).join('；');
      yield {
        type: 'correction_start',
        round: correctionRound,
        reason: issueMessages || 'validation failed'
      };

      // 将验证错误注入修正逻辑：逐轮加强
      report.coverageMatrix = report.coverageMatrix.map((r) => ({
        ...r,
        coveragePercent: Math.max(0, Math.min(100, r.coveragePercent))
      }));
      // 修正 overallScore
      if (report.overallScore < 0) report.overallScore = 0;
      if (report.overallScore > 100) report.overallScore = 100;
      // 第二轮及以上：额外修正，重新计算 overallScore
      if (correctionRound >= 2) {
        report.overallScore = report.coverageMatrix.length
          ? Math.round(
              report.coverageMatrix.reduce((s, r) => s + r.coveragePercent, 0) /
                report.coverageMatrix.length
            )
          : 0;
      }

      validation = this.verify(report);
      yield {
        type: 'correction_complete',
        round: correctionRound,
        success: validation.valid
      };
    }

    let streamedNarrative = '';
    for await (const event of this.options.queryEngine.submitMessage(this.buildNarrativePrompt(report, locale, guidanceMessages), {
      signal: _opts.signal,
      workerRole: 'report_writer',
    })) {
      if (event.type === 'result') {
        if (!event.is_error && event.result.trim()) {
          streamedNarrative = event.result.trim();
        }
        continue;
      }
      yield event;
    }
    if (streamedNarrative) {
      report.narrative = streamedNarrative;
    }

    // 持久化
    await store.run(
      `INSERT OR REPLACE INTO gap_reports(report_id, session_id, business_name, locale, overall_score, payload_json) VALUES(?,?,?,?,?,?)`,
      [report.reportId, report.sessionId, report.businessName, report.locale, report.overallScore, JSON.stringify(report)]
    );

    // AG2U 决策：若提供 askUser 回调，询问用户后续动作
    let chosenAction: AG2UAction = 'report_only';
    if (this.options.askUser) {
      const requestId = randomUUID();
      const question =
        locale === 'en-US'
          ? `Report generated (score ${report.overallScore}). Choose next action.`
          : `报告已生成（综合分 ${report.overallScore}）。请选择后续动作。`;
      const options: AG2UAction[] = ['report_only', 'save_kb', 'write_graph'];
      yield { type: 'ask_user', question, options, requestId };
      let answer: string;
      try {
        answer = await this.options.askUser({ question, options, requestId, context: { reportId: report.reportId } });
      } catch {
        answer = 'report_only';
      }
      const normalized = (options as string[]).includes(answer) ? (answer as AG2UAction) : 'report_only';
      chosenAction = normalized;
      yield { type: 'user_answer', requestId, answer: chosenAction };

      if (chosenAction === 'save_kb') {
        const memKey = `report:${report.reportId}`;
        await store.run(
          `INSERT OR REPLACE INTO memories(memory_id, memory_type, key, value, metadata) VALUES(?, 'long_term', ?, ?, ?)`,
          [
            randomUUID(),
            memKey,
            JSON.stringify({ summary: report.narrative, overallScore: report.overallScore, criticalGaps: report.criticalGaps.length }),
            JSON.stringify({ sessionId: this.options.sessionId, businessName })
          ]
        ).catch(() => undefined);
        // agent-framework.md P1: 通知前端内存写入完成
        yield { type: 'memory_write', memoryType: 'long_term', keysWritten: [memKey] } as any;
      } else if (chosenAction === 'write_graph') {
        for (const row of report.coverageMatrix) {
          await store
            .run(
              `INSERT OR IGNORE INTO business_graph_nodes(node_id, label, node_type, payload_json) VALUES(?, ?, 'scenario', ?)`,
              [row.scenarioId, row.scenarioName, JSON.stringify({ coveragePercent: row.coveragePercent })]
            )
            .catch(() => undefined);
          for (const rid of row.coveredRuleIds) {
            await store
              .run(
                `INSERT OR IGNORE INTO business_graph_nodes(node_id, label, node_type, payload_json) VALUES(?, ?, 'rule', ?)`,
                [rid, rid, JSON.stringify({ reportId: report.reportId })]
              )
              .catch(() => undefined);
            await store
              .run(
                `INSERT OR IGNORE INTO business_graph_edges(edge_id, from_node_id, to_node_id, edge_type, payload_json) VALUES(?, ?, ?, 'covers', ?)`,
                [randomUUID(), row.scenarioId, rid, JSON.stringify({ reportId: report.reportId })]
              )
              .catch(() => undefined);
          }
        }
        for (const g of report.criticalGaps) {
          await store
            .run(
              `INSERT OR IGNORE INTO rule_lineage(lineage_id, source_rule, target_rule, relation, attributes) VALUES(?, ?, ?, 'exposes_gap', ?)`,
              [randomUUID(), g.gapId, report.reportId, JSON.stringify({ severity: g.severity, category: g.category, title: g.title })]
            )
            .catch(() => undefined);
        }
        // agent-framework.md P1: 通知前端图谱写入完成
        const nodesWritten = report.coverageMatrix.length + report.criticalGaps.length;
        yield { type: 'agent_status', message: `业务图谱已更新：${nodesWritten} 个节点写入` } as any;
      }
    }

    await store.run(`UPDATE sessions SET status='completed', phase='archive', completed_at=datetime('now'), updated_at=datetime('now') WHERE session_id=?`, [this.options.sessionId]);

    // 转发最后的 Dream Task 完成通知
    for (const ev of this.options.dreamRunner?.drainNotifications() ?? []) yield ev;

    yield {
      type: 'subagent_complete',
      agentId: 'verify',
      status: 'completed',
      summary: `score=${report.overallScore}`
    };

    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 0,
      num_turns: 1,
      result: report.narrative,
      stop_reason: 'natural_stop',
      total_cost_usd: 0,
      reportId: report.reportId,
    };
  }

  /** 生成每个 Research 维度的结果（MVP：基于 scenarios/rules 做覆盖计算） */
  private async produceDimension(
    dimension: string,
    scenarios: BusinessScenario[],
    rules: RiskRule[]
  ) {
    const coverage: CoverageMatrixRow[] = [];
    const gaps: Gap[] = [];
    for (const s of scenarios) {
      const domain = s.domain ?? '';
      const related = rules.filter((r) => !r.bizType || r.bizType === domain || r.coverage.includes(s.scenarioId));
      const covered = related.map((r) => r.ruleId);
      const expectedTypes = expectedRuleTypesForDimension(dimension);
      const presentTypes = new Set(related.map((r) => r.ruleType ?? 'general'));
      const missing = expectedTypes.filter((t) => !presentTypes.has(t));
      const percent = expectedTypes.length ? Math.round(((expectedTypes.length - missing.length) / expectedTypes.length) * 100) : 0;
      coverage.push({
        scenarioId: s.scenarioId,
        scenarioName: s.name,
        coveredRuleIds: covered,
        missingRuleTypes: missing,
        coveragePercent: percent
      });
      for (const t of missing) {
        gaps.push({
          gapId: randomUUID(),
          title: `[${dimension}] 缺失规则类型 ${t}（场景 ${s.name}）`,
          severity: percent < 40 ? 'critical' : percent < 70 ? 'high' : 'medium',
          category: dimension,
          description: `业务场景 "${s.name}" 下未检测到 ${t} 类型规则。`,
          suggestedRuleTypes: [t],
          evidence: [`dimension=${dimension}`, `scenarioId=${s.scenarioId}`]
        });
      }
    }
    return { dimension, coverage, gaps, tokens: 0 };
  }

  private buildReport(
    businessName: string,
    map: NonNullable<Awaited<ReturnType<ResearchCoordinator['run']>> extends AsyncGenerator<any, infer R, any> ? R : never>,
    locale: string,
    guidanceMessages: string[] = []
  ): GapAnalysisReport {
    const overallScore =
      map.coverage.length === 0
        ? 0
        : Math.round(map.coverage.reduce((s, r) => s + r.coveragePercent, 0) / map.coverage.length);
    const suggestions = [
      ...guidanceMessages.slice(-1).map((message) => `结合用户追加引导继续核查：${message}`),
      ...map.criticalGaps.slice(0, 5).map((g) => `建议补全：${g.title}`),
    ];
    return {
      reportId: randomUUID(),
      sessionId: this.options.sessionId,
      businessName,
      locale,
      overallScore,
      coverageMatrix: map.coverage,
      criticalGaps: map.criticalGaps,
      allGaps: map.allGaps,
      suggestions,
      narrative: locale === 'en-US'
        ? `Overall coverage is ${overallScore}% across ${map.coverage.length} scenarios.`
        : `整体覆盖率 ${overallScore}%，共涉及 ${map.coverage.length} 个业务场景。`,
      createdAt: new Date().toISOString()
    };
  }

  private buildNarrativePrompt(report: GapAnalysisReport, locale: string, guidanceMessages: string[] = []): string {
    return buildOrchestratorNarrativePrompt(report, locale, guidanceMessages);
  }

  private verify(r: GapAnalysisReport): { valid: boolean; issues?: Array<{ message: string }> } {
    const issues: Array<{ message: string }> = [];
    if (r.overallScore < 0 || r.overallScore > 100) issues.push({ message: 'overallScore 越界' });
    for (const row of r.coverageMatrix) {
      if (row.coveragePercent < 0 || row.coveragePercent > 100) issues.push({ message: `row ${row.scenarioId} 越界` });
    }
    return { valid: issues.length === 0, issues };
  }
}

function expectedRuleTypesForDimension(dimension: string): string[] {
  const base = ['limit', 'frequency', 'blacklist', 'anomaly', 'compliance'];
  switch (dimension) {
    case 'coverage':
      return base;
    case 'risk-gaps':
      return ['limit', 'frequency', 'blacklist'];
    case 'compliance':
      return ['compliance'];
    case 'anomaly':
      return ['anomaly'];
    default:
      return base;
  }
}
