/**
 * AnalysisWorkflow — extracted analysis execution logic
 *
 * This module contains the domain-specific analysis flow extracted from OrchestratorAgent
 * so it can be used both by the legacy session path and by the new AnalysisTaskPack.
 */
import { randomUUID } from 'node:crypto';
import type {
  BusinessScenario,
  CoverageMatrixRow,
  Gap,
  GapAnalysisReport,
  RiskRule,
  StreamEvent,
} from '../../agents/base/types.js';
import type { StorageBackendRegistry } from '../../storage/registry.js';
import { ResearchCoordinator } from '../../research/ResearchCoordinator.js';
import { ProfileAgent } from '../../agents/ProfileAgent.js';
import { RiskRuleAgent } from '../../agents/RiskRuleAgent.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AnalysisWorkflowInput {
  runId: string;
  businessName: string;
  locale: string;
  scenarioIds?: string[];
  ruleScope?: { bizTypes?: string[]; ruleTypes?: string[] };
  guidanceMessages?: string[];
}

export interface AnalysisWorkflowDeps {
  storage: StorageBackendRegistry;
  base: {
    sessionId: string;
    scenarios: BusinessScenario[];
    rules: RiskRule[];
    ruleScope?: { bizTypes?: string[]; ruleTypes?: string[] };
    guidanceMessages?: string[];
  };
  emit(event: StreamEvent): Promise<void>;
  setPhase?(phase: string): Promise<void>;
  onSemanticCheckpoint?(kind: string, payload: Record<string, unknown>): Promise<void>;
}

export interface AnalysisResearchResult {
  coverage: CoverageMatrixRow[];
  allGaps: Gap[];
  criticalGaps: Gap[];
}

export interface AnalysisWorkflowResult {
  report: GapAnalysisReport;
  semanticCheckpoints: string[];
}

// ---------------------------------------------------------------------------
// Dimension helpers
// ---------------------------------------------------------------------------

export function expectedRuleTypesForDimension(dimension: string): string[] {
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

export async function produceDimension(
  dimension: string,
  scenarios: BusinessScenario[],
  rules: RiskRule[],
): Promise<{ dimension: string; coverage: CoverageMatrixRow[]; gaps: Gap[]; tokens: number }> {
  const coverage: CoverageMatrixRow[] = [];
  const gaps: Gap[] = [];

  for (const scenario of scenarios) {
    const domain = scenario.domain ?? '';
    const related = rules.filter(
      (rule) => !rule.bizType || rule.bizType === domain || rule.coverage.includes(scenario.scenarioId),
    );
    const covered = related.map((rule) => rule.ruleId);
    const expectedTypes = expectedRuleTypesForDimension(dimension);
    const presentTypes = new Set(related.map((rule) => rule.ruleType ?? 'general'));
    const missing = expectedTypes.filter((type) => !presentTypes.has(type));
    const percent =
      expectedTypes.length > 0
        ? Math.round(((expectedTypes.length - missing.length) / expectedTypes.length) * 100)
        : 0;

    coverage.push({
      scenarioId: scenario.scenarioId,
      scenarioName: scenario.name,
      coveredRuleIds: covered,
      missingRuleTypes: missing,
      coveragePercent: percent,
    });

    for (const type of missing) {
      gaps.push({
        gapId: randomUUID(),
        title: `[${dimension}] \u7f3a\u5931\u89c4\u5219\u7c7b\u578b ${type}\uff08\u573a\u666f ${scenario.name}\uff09`,
        severity: percent < 40 ? 'critical' : percent < 70 ? 'high' : 'medium',
        category: dimension,
        description: `\u4e1a\u52a1\u573a\u666f \u201c${scenario.name}\u201d \u4e0b\u672a\u68c0\u6d4b\u5230 ${type} \u7c7b\u578b\u89c4\u5219\u3002`,
        suggestedRuleTypes: [type],
        evidence: [`dimension=${dimension}`, `scenarioId=${scenario.scenarioId}`],
      });
    }
  }

  return { dimension, coverage, gaps, tokens: 0 };
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

export function buildAnalysisReport(
  runId: string,
  businessName: string,
  research: AnalysisResearchResult,
  locale: string,
  guidanceMessages: string[] = [],
): GapAnalysisReport {
  const overallScore =
    research.coverage.length === 0
      ? 0
      : Math.round(research.coverage.reduce((sum, row) => sum + row.coveragePercent, 0) / research.coverage.length);
  const criticalGaps = research.allGaps.filter((gap) => gap.severity === 'critical');
  return {
    reportId: randomUUID(),
    sessionId: runId,
    businessName,
    locale,
    overallScore,
    coverageMatrix: research.coverage,
    allGaps: research.allGaps,
    criticalGaps,
    suggestions: [
      ...guidanceMessages.slice(-1).map((message) => `\u7ed3\u5408\u7528\u6237\u8ffd\u52a0\u5f15\u5bfc\u7ee7\u7eed\u6838\u67e5\uff1a${message}`),
      ...criticalGaps.slice(0, 5).map((gap) => `\u5efa\u8bae\u8865\u5168\uff1a${gap.title}`),
    ],
    narrative:
      locale === 'en-US'
        ? `Overall coverage is ${overallScore}% across ${research.coverage.length} scenarios.`
        : `\u6574\u4f53\u8986\u76d6\u7387 ${overallScore}%\uff0c\u5171\u6d89\u53ca ${research.coverage.length} \u4e2a\u4e1a\u52a1\u573a\u666f\u3002`,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function runAnalysisWorkflow(
  input: AnalysisWorkflowInput,
  deps: AnalysisWorkflowDeps,
): Promise<AnalysisWorkflowResult> {
  let { scenarios, rules } = deps.base;

  await deps.setPhase?.('collecting');
  await deps.onSemanticCheckpoint?.('scenario-set-resolved', {
    scenarioIds: input.scenarioIds ?? scenarios.map((s) => s.scenarioId),
  });

  // RiskRuleAgent
  const ruleAgent = new RiskRuleAgent({
    sessionId: deps.base.sessionId,
    storage: deps.storage,
    scope: deps.base.ruleScope,
  });
  for await (const event of ruleAgent.run({ prompt: '' })) {
    await deps.emit(event);
  }
  const dbRules = ruleAgent.getRules();
  if (rules.length === 0 && dbRules.length > 0) {
    rules = dbRules;
  }

  await deps.setPhase?.('analysis');
  await deps.onSemanticCheckpoint?.('rule-corpus-resolved', {
    ruleScope: input.ruleScope ?? {},
    ruleCount: rules.length,
  });

  // ProfileAgent
  const profileAgent = new ProfileAgent({
    sessionId: deps.base.sessionId,
    businessName: input.businessName,
    scenarios,
    rules,
    storage: deps.storage,
  });
  for await (const event of profileAgent.run({ prompt: '' })) {
    await deps.emit(event);
  }
  await deps.onSemanticCheckpoint?.('profile-built', { scenarioCount: scenarios.length });

  // Research dimensions
  const coord = new ResearchCoordinator();
  const dims = ['coverage', 'risk-gaps', 'compliance', 'anomaly'];
  const iterator = coord.run(
    dims,
    scenarios.map((scenario) => scenario.scenarioId),
    async (dimension) => {
      return produceDimension(dimension, scenarios, rules);
    },
  );

  let research: AnalysisResearchResult | null = null;
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      const criticalGaps = next.value.allGaps.filter((gap: Gap) => gap.severity === 'critical');
      research = {
        coverage: next.value.coverage,
        allGaps: next.value.allGaps,
        criticalGaps,
      };
      break;
    }
    await deps.emit(next.value);
  }
  if (!research) {
    throw new Error(`analysis research missing for run ${input.runId}`);
  }

  const semanticCheckpoints: string[] = ['scenario-set-resolved', 'rule-corpus-resolved', 'profile-built'];
  const report = buildAnalysisReport(
    input.runId,
    input.businessName,
    research,
    input.locale,
    deps.base.guidanceMessages ?? [],
  );
  semanticCheckpoints.push('report-drafted');
  await deps.onSemanticCheckpoint?.('report-drafted', { businessName: input.businessName });

  return {
    report,
    semanticCheckpoints,
  };
}
