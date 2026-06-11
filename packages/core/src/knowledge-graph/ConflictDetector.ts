/**
 * ConflictDetector — 规则冲突检测
 *
 * 基于知识图谱中的 `conflicts_with` 关系，检测冲突规则对。
 * 也支持通过规则属性（相同场景 + 不同动作）做结构性冲突推断。
 */

import type { IGraphStore } from '../storage/interfaces/IGraphStore.js';
import type { KGNode, KGRelationType } from './types.js';

const LINEAGE_GRAPH = 'rule_lineage';
const BUSINESS_GRAPH = 'business_graph';

export interface ConflictPair {
  nodeA: KGNode;
  nodeB: KGNode;
  /** conflict detection source */
  source: 'explicit' | 'inferred';
  reason?: string;
}

export class ConflictDetector {
  constructor(private readonly graphStore: IGraphStore) {}

  /**
   * 检测全图中所有冲突对（基于 `conflicts_with` 关系）
   */
  async detectAll(): Promise<ConflictPair[]> {
    const [lineageEdges, bizEdges, lineageNodes, bizNodes] = await Promise.all([
      this.graphStore.listEdges(LINEAGE_GRAPH),
      this.graphStore.listEdges(BUSINESS_GRAPH),
      this.graphStore.listNodes(LINEAGE_GRAPH),
      this.graphStore.listNodes(BUSINESS_GRAPH),
    ]);

    const allEdges = [...lineageEdges, ...bizEdges];
    const nodeMap = new Map(
      [...lineageNodes, ...bizNodes].map((n) => [n.id, this.toKGNode(n)])
    );

    const pairs: ConflictPair[] = [];
    const seen = new Set<string>();

    for (const e of allEdges) {
      const rel = (e.attributes?.relation as KGRelationType) ?? '';
      if (rel !== 'conflicts_with') continue;

      // deduplicate A↔B
      const key = [e.source, e.target].sort().join('||');
      if (seen.has(key)) continue;
      seen.add(key);

      const nodeA = nodeMap.get(e.source);
      const nodeB = nodeMap.get(e.target);
      if (!nodeA || !nodeB) continue;

      pairs.push({
        nodeA,
        nodeB,
        source: 'explicit',
        reason: (e.attributes?.reason as string) ?? undefined,
      });
    }

    return pairs;
  }

  /**
   * 检测与特定节点相关的冲突
   */
  async detectForNode(nodeId: string): Promise<ConflictPair[]> {
    const all = await this.detectAll();
    return all.filter((p) => p.nodeA.id === nodeId || p.nodeB.id === nodeId);
  }

  // ─── helper ──────────────────────────────────────────────────────────────

  private toKGNode(n: { id: string; label?: string; attributes?: Record<string, unknown> }): KGNode {
    return {
      id: n.id,
      label: n.label ?? n.id,
      nodeType: (n.attributes?.nodeType as KGNode['nodeType']) ?? 'rule',
      attributes: n.attributes,
    };
  }
}
