import type { GraphNode } from '../../interfaces/IGraphStore.js';
import type {
  ILineageStore,
  LineageChain,
  LineageDisplayData,
  LineageRef,
  LineageRelation
} from '../../interfaces/ILineageStore.js';
import type { GraphologyStore } from './GraphologyStore.js';

const LINEAGE_GRAPH = 'rule_lineage';

export class LineageStore implements ILineageStore {
  constructor(private readonly graph: GraphologyStore) {}

  async upsertRuleNode(node: GraphNode): Promise<void> {
    await this.graph.upsertNode(LINEAGE_GRAPH, node);
  }

  async upsertRelation(rel: LineageRelation): Promise<void> {
    await this.graph.upsertEdge(LINEAGE_GRAPH, {
      ...rel,
      attributes: { ...(rel.attributes ?? {}), relation: rel.relation }
    });
  }

  async getRuleAncestors(ruleId: string): Promise<GraphNode[]> {
    const edges = await this.graph.listEdges(LINEAGE_GRAPH);
    const ancestors = new Set<string>();
    const visit = (id: string) => {
      for (const e of edges) {
        if (e.target === id && !ancestors.has(e.source)) {
          ancestors.add(e.source);
          visit(e.source);
        }
      }
    };
    visit(ruleId);
    const all = await this.graph.listNodes(LINEAGE_GRAPH);
    return all.filter((n) => ancestors.has(n.id));
  }

  async getRuleDescendants(ruleId: string): Promise<GraphNode[]> {
    const edges = await this.graph.listEdges(LINEAGE_GRAPH);
    const desc = new Set<string>();
    const visit = (id: string) => {
      for (const e of edges) {
        if (e.source === id && !desc.has(e.target)) {
          desc.add(e.target);
          visit(e.target);
        }
      }
    };
    visit(ruleId);
    const all = await this.graph.listNodes(LINEAGE_GRAPH);
    return all.filter((n) => desc.has(n.id));
  }

  async listAll(): Promise<{ nodes: GraphNode[]; edges: LineageRelation[] }> {
    const nodes = await this.graph.listNodes(LINEAGE_GRAPH);
    const edges = await this.graph.listEdges(LINEAGE_GRAPH);
    return {
      nodes,
      edges: edges.map((e) => ({
        ...e,
        relation: ((e.attributes as any)?.relation as LineageRelation['relation']) ?? 'references'
      }))
    };
  }

  // ─── 04-storage-layer.md §5 新增方法 ─────────────────────────────────────

  async addLineageEdge(from: LineageRef, to: LineageRef, relation: LineageRelation['relation']): Promise<void> {
    // 确保两端节点存在
    await this.graph.upsertNode(LINEAGE_GRAPH, {
      id: from.id,
      label: from.label ?? from.id,
      attributes: { type: from.type, ...(from.attributes ?? {}) }
    });
    await this.graph.upsertNode(LINEAGE_GRAPH, {
      id: to.id,
      label: to.label ?? to.id,
      attributes: { type: to.type, ...(to.attributes ?? {}) }
    });
    await this.graph.upsertEdge(LINEAGE_GRAPH, {
      source: from.id,
      target: to.id,
      attributes: { relation, fromType: from.type, toType: to.type }
    });
  }

  async getLineageChain(nodeId: string, direction: 'upstream' | 'downstream' | 'both' = 'both'): Promise<LineageChain> {
    const edges = await this.graph.listEdges(LINEAGE_GRAPH);
    const allNodes = await this.graph.listNodes(LINEAGE_GRAPH);
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

    const upstream: GraphNode[] = [];
    const downstream: GraphNode[] = [];
    const upstreamEdges: LineageRelation[] = [];
    const downstreamEdges: LineageRelation[] = [];

    if (direction === 'upstream' || direction === 'both') {
      const visited = new Set<string>();
      const bfs = (id: string) => {
        for (const e of edges) {
          if (e.target === id && !visited.has(e.source)) {
            visited.add(e.source);
            const node = nodeMap.get(e.source);
            if (node) upstream.push(node);
            upstreamEdges.push({ ...e, relation: ((e.attributes as any)?.relation ?? 'references') as LineageRelation['relation'] });
            bfs(e.source);
          }
        }
      };
      bfs(nodeId);
    }

    if (direction === 'downstream' || direction === 'both') {
      const visited = new Set<string>();
      const bfs = (id: string) => {
        for (const e of edges) {
          if (e.source === id && !visited.has(e.target)) {
            visited.add(e.target);
            const node = nodeMap.get(e.target);
            if (node) downstream.push(node);
            downstreamEdges.push({ ...e, relation: ((e.attributes as any)?.relation ?? 'references') as LineageRelation['relation'] });
            bfs(e.target);
          }
        }
      };
      bfs(nodeId);
    }

    return { nodeId, upstream, downstream, upstreamEdges, downstreamEdges };
  }

  async queryByRelation(relation: LineageRelation['relation']): Promise<LineageRelation[]> {
    const edges = await this.graph.listEdges(LINEAGE_GRAPH);
    return edges
      .filter((e) => ((e.attributes as any)?.relation) === relation)
      .map((e) => ({ ...e, relation }));
  }

  async toDisplayGraph(centerNodeId?: string, depth = 3): Promise<LineageDisplayData> {
    const allNodes = await this.graph.listNodes(LINEAGE_GRAPH);
    const allEdges = await this.graph.listEdges(LINEAGE_GRAPH);

    let nodeIds: Set<string>;

    if (centerNodeId) {
      nodeIds = new Set([centerNodeId]);
      // BFS up to depth in both directions
      const queue: [string, number][] = [[centerNodeId, 0]];
      while (queue.length > 0) {
        const [id, d] = queue.shift()!;
        if (d >= depth) continue;
        for (const e of allEdges) {
          if (e.source === id && !nodeIds.has(e.target)) {
            nodeIds.add(e.target);
            queue.push([e.target, d + 1]);
          }
          if (e.target === id && !nodeIds.has(e.source)) {
            nodeIds.add(e.source);
            queue.push([e.source, d + 1]);
          }
        }
      }
    } else {
      nodeIds = new Set(allNodes.map((n) => n.id));
    }

    const nodes = allNodes
      .filter((n) => nodeIds.has(n.id))
      .map((n) => ({
        id: n.id,
        label: n.label ?? n.id,
        type: (n.attributes as any)?.type ?? 'rule',
        attrs: (n.attributes as Record<string, unknown>) ?? {}
      }));

    const edges = allEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        label: (e.attributes as any)?.relation ?? 'references',
        type: (e.attributes as any)?.relation ?? 'references'
      }));

    return { nodes, edges };
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.graph.removeNode(LINEAGE_GRAPH, nodeId);
  }
}
