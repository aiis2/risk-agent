import type {
  TaskPack,
  TaskPackContext,
  RunEvent,
  RunArtifact,
  VerificationRecord,
} from '../../harness/types.js';
import type { StorageBackendRegistry } from '../../storage/registry.js';
import type { QueryEngine } from '../../query/QueryEngine.js';
import { tokenCountWithEstimation } from '../../query/ContextCompactor.js';
import type { BusinessScenario, RiskRule, StreamEvent } from '../../agents/base/types.js';
import { runAnalysisWorkflow, type AnalysisWorkflowResult } from './AnalysisWorkflow.js';
import { buildSkillProposal } from '../skills/SkillProposal.js';

const SYNTHETIC_INPUT_USD_PER_1K = 0.003;
const SYNTHETIC_OUTPUT_USD_PER_1K = 0.006;

export class AnalysisTaskPack implements TaskPack<Record<string, unknown>, Record<string, unknown>, AnalysisWorkflowResult> {
  readonly kind = 'analysis' as const;
  readonly contractVersion = 'analysis.phase1';
  readonly inputSchema = {
    type: 'object',
    required: ['businessName'],
    properties: {
      businessName: { type: 'string' },
      locale: { type: 'string' },
      scenarioIds: { type: 'array', items: { type: 'string' } },
      guidanceMessages: { type: 'array', items: { type: 'string' } },
    },
  };

  constructor(private readonly deps: { storage: StorageBackendRegistry; queryEngine: QueryEngine }) {}

  private async loadScenarios(ids?: string[]): Promise<BusinessScenario[]> {
    const store = this.deps.storage.getStructuredStore();
    const rows =
      ids && ids.length > 0
        ? await store.all<Record<string, unknown>>(
            `SELECT scenario_id as scenarioId, name, description, domain, status, version, data_sources as dataSources, documents, manual_notes as manualNotes, created_at as createdAt, updated_at as updatedAt FROM business_scenarios WHERE scenario_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`,
            ids,
          )
        : await store.all<Record<string, unknown>>(
            `SELECT scenario_id as scenarioId, name, description, domain, status, version, data_sources as dataSources, documents, manual_notes as manualNotes, created_at as createdAt, updated_at as updatedAt FROM business_scenarios WHERE status='active' ORDER BY created_at ASC`,
          );

    return rows.map((row) => ({
      ...row,
      dataSources: JSON.parse((row.dataSources as string) ?? '[]'),
      documents: JSON.parse((row.documents as string) ?? '[]'),
    })) as unknown as BusinessScenario[];
  }

  private async loadRules(scope?: { bizTypes?: string[]; ruleTypes?: string[] }): Promise<RiskRule[]> {
    const store = this.deps.storage.getStructuredStore();
    const clauses: string[] = [`status='active'`];
    const params: unknown[] = [];
    if (scope?.bizTypes?.length) {
      clauses.push(`biz_type IN (${scope.bizTypes.map(() => '?').join(',')})`);
      params.push(...scope.bizTypes);
    }
    if (scope?.ruleTypes?.length) {
      clauses.push(`rule_type IN (${scope.ruleTypes.map(() => '?').join(',')})`);
      params.push(...scope.ruleTypes);
    }
    const rows = await store.all<Record<string, unknown>>(
      `SELECT rule_id as ruleId, rule_name as ruleName, biz_type as bizType, rule_type as ruleType, coverage_json as coverage, status, synced_at as syncedAt FROM risk_rules WHERE ${clauses.join(' AND ')} ORDER BY synced_at DESC`,
      params,
    );

    return rows.map((row) => ({
      ...row,
      coverage: JSON.parse((row.coverage as string) ?? '[]'),
    })) as unknown as RiskRule[];
  }

  async intake(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      businessName: String(input.businessName ?? '').trim(),
      locale: String(input.locale ?? 'zh-CN'),
      scenarioIds: Array.isArray(input.scenarioIds) ? input.scenarioIds : undefined,
      guidanceMessages: Array.isArray(input.guidanceMessages)
        ? input.guidanceMessages.filter((entry): entry is string => typeof entry === 'string')
        : undefined,
      ruleScope: input.ruleScope as { bizTypes?: string[]; ruleTypes?: string[] } | undefined,
    };
  }

  async plan(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return input;
  }

  async *execute(
    plan: Record<string, unknown>,
    ctx: TaskPackContext,
  ): AsyncGenerator<RunEvent, AnalysisWorkflowResult> {
    const scenarios = await this.loadScenarios(plan.scenarioIds as string[] | undefined);
    const rules = await this.loadRules(plan.ruleScope as { bizTypes?: string[]; ruleTypes?: string[] } | undefined);

    const result = await runAnalysisWorkflow(
      {
        runId: ctx.run.runId,
        businessName: String(plan.businessName),
        locale: String(plan.locale ?? 'zh-CN'),
        scenarioIds: plan.scenarioIds as string[] | undefined,
        guidanceMessages: plan.guidanceMessages as string[] | undefined,
        ruleScope: plan.ruleScope as { bizTypes?: string[]; ruleTypes?: string[] } | undefined,
      },
      {
        storage: this.deps.storage,
        base: {
          sessionId: ctx.run.runId,
          scenarios,
          rules,
          guidanceMessages: plan.guidanceMessages as string[] | undefined,
          ruleScope: plan.ruleScope as { bizTypes?: string[]; ruleTypes?: string[] } | undefined,
        },
        emit: async (event) => {
          await ctx.emit({
            type: event.type,
            payload: enrichAnalysisEvent(event, String(plan.businessName)),
          });
        },
        onSemanticCheckpoint: async (kind, payload) => {
          await ctx.createSemanticCheckpoint(kind, payload);
        },
      },
    );

    return result;
  }

  async verify(result: AnalysisWorkflowResult, ctx: TaskPackContext): Promise<VerificationRecord> {
    const reasons: string[] = [
      result.report.coverageMatrix.length > 0 ? 'coverage_present' : 'coverage_missing',
      result.report.allGaps.length > 0 ? 'gaps_present' : 'gaps_missing',
      result.report.suggestions.length > 0 ? 'suggestions_present' : 'suggestions_missing',
    ];

    const coverageMissing = reasons.includes('coverage_missing');
    const suggestionsMissing = reasons.includes('suggestions_missing');
    const suggestionsPresent = reasons.includes('suggestions_present');
    const hasRecoverableCoverageGap = coverageMissing && suggestionsPresent && !suggestionsMissing;
    const hasCritical = suggestionsMissing || (coverageMissing && !hasRecoverableCoverageGap);
    const decision = hasCritical ? 'fail' : hasRecoverableCoverageGap ? 'warn' : 'pass';
    const followUpAction = hasCritical ? 'fail_run' : hasRecoverableCoverageGap ? 'retry' : 'none';

    return {
      verificationId: `ver_${ctx.run.runId}`,
      runId: ctx.run.runId,
      verifierType: 'contract',
      contractVersion: this.contractVersion,
      decision,
      reasons,
      followUpAction,
      createdAt: ctx.now(),
    };
  }

  async projectResult(result: AnalysisWorkflowResult, ctx: TaskPackContext): Promise<RunArtifact[]> {
    const artifacts = [
      await ctx.publishArtifact({
        kind: 'report',
        mimeType: 'application/json',
        contentJson: result.report as unknown as Record<string, unknown>,
      }),
    ];

    const proposal = buildAnalysisSkillProposal(result, ctx.run.runId);
    if (proposal) {
      artifacts.push(
        await ctx.publishArtifact({
          kind: 'json',
          mimeType: 'application/json',
          contentJson: proposal as unknown as Record<string, unknown>,
        }),
      );
    }

    return artifacts;
  }
}

function enrichAnalysisEvent(event: StreamEvent, businessName: string): Record<string, unknown> {
  const syntheticMetrics = resolveSyntheticMetrics(event, businessName);
  if (!syntheticMetrics) {
    return event as unknown as Record<string, unknown>;
  }

  return {
    ...(event as unknown as Record<string, unknown>),
    syntheticMetrics,
  };
}

function resolveSyntheticMetrics(
  event: StreamEvent,
  businessName: string,
):
  | {
      turnCount?: number;
      toolCallCount?: number;
      inputTokens?: number;
      outputTokens?: number;
      estimatedUsd?: number;
    }
  | undefined {
  if (event.type === 'subagent_spawned') {
    const inputTokens = tokenCountWithEstimation([businessName, event.description].filter(Boolean).join(' '));
    return {
      toolCallCount: 1,
      inputTokens,
      estimatedUsd: estimateSyntheticUsd(inputTokens, 0),
    };
  }

  if (event.type === 'subagent_complete') {
    const outputTokens = tokenCountWithEstimation(event.summary);
    return {
      turnCount: 1,
      outputTokens,
      estimatedUsd: estimateSyntheticUsd(0, outputTokens),
    };
  }

  if (event.type === 'research_complete') {
    const outputTokens = Math.max(
      event.aggregatedTokens,
      tokenCountWithEstimation(event.dimensions.join(' ')),
    );
    return {
      turnCount: 1,
      outputTokens,
      estimatedUsd: estimateSyntheticUsd(0, outputTokens),
    };
  }

  return undefined;
}

function estimateSyntheticUsd(inputTokens: number, outputTokens: number): number {
  const inputUsd = (inputTokens / 1000) * SYNTHETIC_INPUT_USD_PER_1K;
  const outputUsd = (outputTokens / 1000) * SYNTHETIC_OUTPUT_USD_PER_1K;
  return Number((inputUsd + outputUsd).toFixed(6));
}

function buildAnalysisSkillProposal(result: AnalysisWorkflowResult, runId: string) {
  if (!result.report) {
    return null;
  }

  return buildSkillProposal({
    sourceRunId: runId,
    taskKind: 'analysis',
    title: result.report.businessName,
    objective: `对 ${result.report.businessName} 执行一轮可复用的风控分析并输出结构化报告。`,
    rationale: '本次分析 run 产出了结构化报告、覆盖差距和整改建议，适合固化为可复用分析技能。',
    triggerHints: [
      `分析 ${result.report.businessName} 的风险链路`,
      ...result.report.suggestions.slice(0, 2),
    ],
    workflow: [
      'Load active scenarios and rules for the target business scope.',
      'Run the analysis workflow and synthesize coverage, gaps, and narrative findings.',
      'Publish a final report with concrete remediation suggestions.',
    ],
    evidence: [
      `Overall score: ${result.report.overallScore}`,
      ...result.report.suggestions.slice(0, 3),
    ],
  });
}
