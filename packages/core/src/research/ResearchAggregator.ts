import type { Gap, CoverageMatrixRow, RuleGapMap } from '../agents/base/types.js';

export interface ResearchDimensionResult {
  dimension: string;
  coverage?: CoverageMatrixRow[];
  gaps?: Gap[];
  notes?: string;
  tokens?: number;
}

export class ResearchAggregator {
  aggregate(results: ResearchDimensionResult[], scenarioIds: string[]): RuleGapMap {
    const coverageMap = new Map<string, CoverageMatrixRow>();
    const gaps: Gap[] = [];
    for (const r of results) {
      for (const row of r.coverage ?? []) {
        const prev = coverageMap.get(row.scenarioId);
        if (!prev) {
          coverageMap.set(row.scenarioId, { ...row });
        } else {
          const merged: CoverageMatrixRow = {
            scenarioId: row.scenarioId,
            scenarioName: row.scenarioName ?? prev.scenarioName,
            coveredRuleIds: dedup([...prev.coveredRuleIds, ...row.coveredRuleIds]),
            missingRuleTypes: dedup([...prev.missingRuleTypes, ...row.missingRuleTypes]),
            coveragePercent: Math.max(prev.coveragePercent, row.coveragePercent)
          };
          coverageMap.set(row.scenarioId, merged);
        }
      }
      for (const g of r.gaps ?? []) gaps.push(g);
    }
    const criticalGaps = gaps.filter((g) => g.severity === 'critical' || g.severity === 'high');
    return {
      scenarioIds,
      coverage: Array.from(coverageMap.values()),
      criticalGaps,
      allGaps: gaps,
      aggregatedAt: new Date().toISOString(),
      priorityOrder: criticalGaps.map((g) => g.gapId),
      dataQualityNotes: [],
      dimensionsCovered: results.map((r) => r.dimension),
    };
  }
}

function dedup<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
