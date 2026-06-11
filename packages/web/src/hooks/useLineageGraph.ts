/**
 * useLineageGraph — 血缘图谱数据 Hook
 * project-structure.md §hooks/useLineageGraph.ts
 *
 * 封装从 report 数据中提取 coverageMatrix/criticalGaps，
 * 供 LineageGraph 组件消费，避免页面层重复转换逻辑。
 */
import { useMemo } from 'react';

export interface LineageNode {
  id: string;
  label: string;
  type: 'scenario' | 'rule' | 'gap';
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CoverageRow {
  scenarioId: string;
  scenarioName: string;
  coveredRuleIds: string[];
  coveragePercent: number;
}

export interface CriticalGap {
  gapId: string;
  title: string;
  severity?: string;
}

/**
 * 从 gap report 的 coverageMatrix + criticalGaps 中派生出
 * 血缘图谱所需的 nodes / edges。
 */
export function useLineageGraph(
  coverageMatrix: CoverageRow[] = [],
  criticalGaps: CriticalGap[] = [],
) {
  return useMemo(() => {
    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    const seenRules = new Set<string>();

    for (const row of coverageMatrix) {
      nodes.push({
        id: row.scenarioId,
        label: `${row.scenarioName} (${row.coveragePercent}%)`,
        type: 'scenario',
      });
      for (const rid of row.coveredRuleIds) {
        if (!seenRules.has(rid)) {
          seenRules.add(rid);
          nodes.push({ id: rid, label: rid, type: 'rule' });
        }
        edges.push({
          id: `${row.scenarioId}->${rid}`,
          source: row.scenarioId,
          target: rid,
          label: 'covers',
        });
      }
    }

    for (const g of criticalGaps) {
      const id = `gap:${g.gapId}`;
      nodes.push({
        id,
        label: `${g.title} [${g.severity ?? ''}]`,
        type: 'gap',
      });
    }

    return { nodes, edges };
  }, [coverageMatrix, criticalGaps]);
}
