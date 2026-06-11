/**
 * ImpactAnalyzer — 节点影响分析（增强版）
 *
 * 在 KnowledgeGraphService.getImpact() 的基础上，提供按节点类型分组的
 * 影响摘要，以及删除/修改某节点时的级联影响范围。
 */

import type { IGraphStore } from '../storage/interfaces/IGraphStore.js';
import type { KGNode, KGEdge, KGNodeType, KGRelationType } from './types.js';

const LINEAGE_GRAPH = 'rule_lineage';
const BUSINESS_GRAPH = 'business_graph';

export interface ImpactSummary {
  nodeId: string;
  /** 直接受影响节点（与目标节点有直接边的）*/
  direct: KGNode[];
  /** 间接受影响节点（通过 direct 节点传播到的）*/
  indirect: KGNode[];
  /** 按节点类型分组的影响统计 */
  byType: Partial<Record<KGNodeType, KGNode[]>>;
  /** 受影响的关系列表 */
  affectedEdges: KGEdge[];
  /** 影响节点总数 */
  totalCount: number;
}

export class ImpactAnalyzer {
  constructor(private readonly graphStore: IGraphStore) {}

  /**
   * 分析删除或修改某节点的级联影响
   * @param nodeId 目标节点 ID
   * @param depth 传播深度（默认 3）
   */
  async analyze(nodeId: string, depth = 3): Promise<ImpactSummary> {
    const [lineageNodes, lineageEdges, bizNodes, bizEdges] = await Promise.all([
      this.graphStore.listNodes(LINEAGE_GRAPH),
      this.graphStore.listEdges(LINEAGE_GRAPH),
      this.graphStore.listNodes(BUSINESS_GRAPH),
      this.graphStore.listEdges(BUSINESS_GRAPH),
    ]);

    const nodeMap = new Map(
      [...lineageNodes, ...bizNodes].map((n) => [n.id, this.toKGNode(n)])
    );
    const allEdges = [...lineageEdges, ...bizEdges];

    // BFS downstream traversal
    const visited = new Set<string>([nodeId]);
    const resultEdges: KGEdge[] = [];
    const directIds = new Set<string>();

    const bfs = (startId: string, maxDepth: number) => {
      const queue: [string, number][] = [[startId, 0]];
      while (queue.length) {
        const [id, d] = queue.shift()!;
        if (d >= maxDepth) continue;
        for (const e of allEdges) {
          if (e.source !== id) continue;
          const rel = (e.attributes?.relation as KGRelationType) ?? 'references';
          if (!visited.has(e.target)) {
            visited.add(e.target);
            if (d === 0) directIds.add(e.target);
            resultEdges.push({ source: e.source, target: e.target, relation: rel });
            queue.push([e.target, d + 1]);
          }
        }
      }
    };

    bfs(nodeId, depth);

    const impactedIds = [...visited].filter((id) => id !== nodeId);
    const direct = [...directIds].map((id) => nodeMap.get(id)).filter(Boolean) as KGNode[];
    const indirect = impactedIds
      .filter((id) => !directIds.has(id))
      .map((id) => nodeMap.get(id))
      .filter(Boolean) as KGNode[];

    // Group by nodeType
    const byType: Partial<Record<KGNodeType, KGNode[]>> = {};
    for (const n of [...direct, ...indirect]) {
      if (!byType[n.nodeType]) byType[n.nodeType] = [];
      byType[n.nodeType]!.push(n);
    }

    return {
      nodeId,
      direct,
      indirect,
      byType,
      affectedEdges: resultEdges,
      totalCount: direct.length + indirect.length,
    };
  }

  // ─── helper ──────────────────────────────────────────────────────────────

  private toKGNode(n: { id: string; label?: string; attributes?: Record<string, unknown> }): KGNode {
    return {
      id: n.id,
      label: n.label ?? n.id,
      nodeType: (n.attributes?.nodeType as KGNodeType) ?? 'rule',
      attributes: n.attributes,
    };
  }
}
