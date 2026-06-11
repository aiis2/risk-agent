import { BusinessGraph, type GraphNodeInput, type GraphEdgeInput } from './BusinessGraph.js';

/**
 * LineageGraph — 读取 gap report 的 coverageMatrix，渲染为
 * Scenario → Rule 的双列血缘视图；额外附加 Critical Gap 节点。
 */
export function LineageGraph(props: {
  coverageMatrix?: Array<{ scenarioId: string; scenarioName: string; coveredRuleIds: string[]; coveragePercent: number }>;
  criticalGaps?: Array<{ gapId: string; title: string; severity?: string }>;
  height?: number;
}) {
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  const seenRules = new Set<string>();

  for (const row of props.coverageMatrix ?? []) {
    nodes.push({ id: row.scenarioId, label: `${row.scenarioName}\n(${row.coveragePercent}%)`, type: 'scenario' });
    for (const rid of row.coveredRuleIds) {
      if (!seenRules.has(rid)) {
        seenRules.add(rid);
        nodes.push({ id: rid, label: rid, type: 'rule' });
      }
      edges.push({ id: `${row.scenarioId}->${rid}`, source: row.scenarioId, target: rid, label: 'covers' });
    }
  }
  for (const g of props.criticalGaps ?? []) {
    const id = `gap:${g.gapId}`;
    nodes.push({ id, label: `${g.title}\n[${g.severity ?? ''}]`, type: 'gap' });
  }

  return <BusinessGraph nodes={nodes} edges={edges} height={props.height} emptyHint="尚无覆盖血缘数据。" />;
}
