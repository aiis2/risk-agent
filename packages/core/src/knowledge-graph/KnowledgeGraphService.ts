/**
 * KnowledgeGraphService — 统一图谱写入与读取服务
 *
 * 所有 Agent、Route 的图谱读写必须通过此服务，
 * 而不是直接操作 GraphologyStore / ILineageStore 或 SQLite 镜像表。
 *
 * 规则：
 * - 写入路径：lineage.ts / ProfileAgent / OrchestratorAgent / Agent 工具 → KnowledgeGraphService
 * - 读取路径：/api/knowledge-graph/* → KnowledgeGraphService
 */

import type { IGraphStore } from '../storage/interfaces/IGraphStore.js';
import type { ILineageStore } from '../storage/interfaces/ILineageStore.js';
import type { IStructuredStore } from '../storage/interfaces/IStructuredStore.js';
import {
  KG_RELATION_TYPES,
  type KGAddEdgeInput,
  type KGDeleteNodeInput,
  type KGDisplayGraph,
  type KGEdge,
  type KGImpactResult,
  type KGNeighborhoodParams,
  type KGNode,
  type KGNodeType,
  type KGOverviewStats,
  type KGRelationType,
  type KGSearchParams,
  type KGUpsertNodeInput,
} from './types.js';

const LINEAGE_GRAPH = 'rule_lineage';
const BUSINESS_GRAPH = 'business_graph';

export class KnowledgeGraphService {
  constructor(
    private readonly graphStore: IGraphStore,
    private readonly lineageStore: ILineageStore,
    private readonly structuredStore: IStructuredStore,
  ) {}

  // ─── 写入 ──────────────────────────────────────────────────────────────────

  /** 写入或更新一个节点（同时写入 Graphology 和 SQLite 镜像表）*/
  async upsertNode(input: KGUpsertNodeInput): Promise<void> {
    const graphName = this.graphForType(input.nodeType);
    await this.graphStore.upsertNode(graphName, {
      id: input.id,
      label: input.label,
      attributes: { nodeType: input.nodeType, ...input.attributes },
    });
    // 同步 SQLite 镜像表
    if (graphName === BUSINESS_GRAPH) {
      await this.structuredStore.run(
        `INSERT INTO business_graph_nodes(node_id, label, node_type, payload_json)
         VALUES(?,?,?,?)
         ON CONFLICT(node_id) DO UPDATE SET label=excluded.label, node_type=excluded.node_type, payload_json=excluded.payload_json`,
        [input.id, input.label, input.nodeType, JSON.stringify(input.attributes ?? {})],
      ).catch(() => undefined);
    } else if (graphName === LINEAGE_GRAPH) {
      await this.structuredStore.run(
        `INSERT INTO lineage_graph_nodes(node_id, label, node_type, payload_json)
         VALUES(?,?,?,?)
         ON CONFLICT(node_id) DO UPDATE SET label=excluded.label, node_type=excluded.node_type, payload_json=excluded.payload_json`,
        [input.id, input.label, input.nodeType, JSON.stringify(input.attributes ?? {})],
      ).catch(() => undefined);
    }
  }

  /** 写入一条关系边（同时写入 Graphology 和 SQLite 镜像/血缘表）*/
  async addEdge(input: KGAddEdgeInput): Promise<void> {
    if (!KG_RELATION_TYPES.includes(input.relation as KGRelationType)) {
      throw new Error(`Unknown KG relation: ${input.relation}`);
    }
    // 确保两端节点存在
    await this.upsertNode(input.from);
    await this.upsertNode(input.to);

    const graphName = this.graphForType(input.from.nodeType);
    await this.graphStore.upsertEdge(graphName, {
      source: input.from.id,
      target: input.to.id,
      attributes: { relation: input.relation, ...input.attributes },
    });

    // 同步 SQLite 镜像
    if (graphName === LINEAGE_GRAPH) {
      // Use deterministic key (source:target:relation) to prevent duplicate rows
      const edgeKey = `${input.from.id}:${input.to.id}:${input.relation}`;
      await this.structuredStore.run(
        `INSERT INTO rule_lineage(lineage_id, source_rule, target_rule, relation, attributes)
         VALUES(?,?,?,?,?)
         ON CONFLICT(lineage_id) DO UPDATE SET attributes=excluded.attributes`,
        [edgeKey, input.from.id, input.to.id, input.relation, JSON.stringify(input.attributes ?? {})],
      ).catch(() => undefined);
    } else if (graphName === BUSINESS_GRAPH) {
      const edgeKey = `${input.from.id}:${input.to.id}:${input.relation}`;
      await this.structuredStore.run(
        `INSERT INTO business_graph_edges(edge_id, from_node_id, to_node_id, edge_type, payload_json)
         VALUES(?,?,?,?,?)
         ON CONFLICT(edge_id) DO UPDATE SET payload_json=excluded.payload_json`,
        [edgeKey, input.from.id, input.to.id, input.relation, JSON.stringify(input.attributes ?? {})],
      ).catch(() => undefined);
    }
  }

  /** 删除一个节点及其所有关联边 */
  async deleteNode(input: KGDeleteNodeInput): Promise<void> {
    // 从两个图中都尝试删除
    await this.graphStore.removeNode(LINEAGE_GRAPH, input.id).catch(() => undefined);
    await this.graphStore.removeNode(BUSINESS_GRAPH, input.id).catch(() => undefined);
    // 同步镜像表
    await this.structuredStore.run(`DELETE FROM business_graph_nodes WHERE node_id=?`, [input.id]).catch(() => undefined);
    await this.structuredStore.run(`DELETE FROM business_graph_edges WHERE from_node_id=? OR to_node_id=?`, [input.id, input.id]).catch(() => undefined);
    await this.structuredStore.run(`DELETE FROM rule_lineage WHERE source_rule=? OR target_rule=?`, [input.id, input.id]).catch(() => undefined);
  }

  // ─── 读取 ──────────────────────────────────────────────────────────────────

  /** 获取整体图谱统计概览 */
  async getOverview(): Promise<KGOverviewStats> {
    const [lineageNodes, lineageEdges, bizNodes, bizEdges] = await Promise.all([
      this.graphStore.listNodes(LINEAGE_GRAPH),
      this.graphStore.listEdges(LINEAGE_GRAPH),
      this.graphStore.listNodes(BUSINESS_GRAPH),
      this.graphStore.listEdges(BUSINESS_GRAPH),
    ]);

    const allNodes = [...lineageNodes, ...bizNodes];
    const allEdges = [...lineageEdges, ...bizEdges];

    const nodesByType: Record<string, number> = {};
    for (const n of allNodes) {
      const t = (n.attributes?.nodeType as string) ?? 'unknown';
      nodesByType[t] = (nodesByType[t] ?? 0) + 1;
    }

    const edgesByRelation: Record<string, number> = {};
    for (const e of allEdges) {
      const r = (e.attributes?.relation as string) ?? 'unknown';
      edgesByRelation[r] = (edgesByRelation[r] ?? 0) + 1;
    }

    return {
      nodeCount: allNodes.length,
      edgeCount: allEdges.length,
      nodesByType,
      edgesByRelation,
    };
  }

  /** 搜索节点（按 label / nodeType 过滤）*/
  async search(params: KGSearchParams): Promise<KGNode[]> {
    const [lineageNodes, bizNodes] = await Promise.all([
      this.graphStore.listNodes(LINEAGE_GRAPH),
      this.graphStore.listNodes(BUSINESS_GRAPH),
    ]);

    // Deduplicate by ID: prefer the node with more attributes (richer data)
    const nodeMap = new Map<string, { id: string; label?: string; attributes?: Record<string, unknown>; graph: string }>();
    for (const n of lineageNodes) {
      nodeMap.set(n.id, { ...n, graph: LINEAGE_GRAPH });
    }
    for (const n of bizNodes) {
      const existing = nodeMap.get(n.id);
      if (!existing || Object.keys(n.attributes ?? {}).length >= Object.keys(existing.attributes ?? {}).length) {
        nodeMap.set(n.id, { ...n, graph: BUSINESS_GRAPH });
      }
    }
    let allNodes = [...nodeMap.values()];

    if (params.query) {
      const q = params.query.toLowerCase();
      allNodes = allNodes.filter((n) => (n.label ?? '').toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
    }
    if (params.nodeTypes?.length) {
      allNodes = allNodes.filter((n) => params.nodeTypes!.includes((n.attributes?.nodeType as KGNodeType)));
    }

    return allNodes.slice(0, params.limit ?? 100).map((n) => this.toKGNode(n));
  }

  /** 获取节点邻域图（周边节点与关系）*/
  async getNeighborhood(params: KGNeighborhoodParams): Promise<KGDisplayGraph> {
    const depth = Math.min(params.depth ?? 2, 5);
    const direction = params.direction ?? 'both';

    // Merge nodes from both graphs; prefer node with more attributes (BUSINESS_GRAPH usually wins)
    const [lineageNodesRaw, bizNodesRaw] = await Promise.all([
      this.graphStore.listNodes(LINEAGE_GRAPH),
      this.graphStore.listNodes(BUSINESS_GRAPH),
    ]);
    const nodeMap = new Map<string, typeof lineageNodesRaw[0]>();
    for (const n of lineageNodesRaw) nodeMap.set(n.id, n);
    for (const n of bizNodesRaw) {
      const existing = nodeMap.get(n.id);
      if (!existing || Object.keys(n.attributes ?? {}).length >= Object.keys(existing.attributes ?? {}).length) {
        nodeMap.set(n.id, n);
      }
    }

    const allEdges = [
      ...await this.graphStore.listEdges(LINEAGE_GRAPH),
      ...await this.graphStore.listEdges(BUSINESS_GRAPH),
    ];
    const visited = new Set<string>();
    const resultEdges: KGEdge[] = [];

    const bfs = (startId: string, dir: 'upstream' | 'downstream' | 'both', maxDepth: number) => {
      const queue: [string, number][] = [[startId, 0]];
      while (queue.length) {
        const [id, d] = queue.shift()!;
        if (d >= maxDepth) continue;
        for (const e of allEdges) {
          const relation = (e.attributes?.relation as KGRelationType) ?? 'references';
          if (params.relationTypes?.length && !params.relationTypes.includes(relation)) continue;
          if ((dir === 'downstream' || dir === 'both') && e.source === id && !visited.has(e.target)) {
            visited.add(e.target);
            resultEdges.push({ source: e.source, target: e.target, relation });
            queue.push([e.target, d + 1]);
          }
          if ((dir === 'upstream' || dir === 'both') && e.target === id && !visited.has(e.source)) {
            visited.add(e.source);
            resultEdges.push({ source: e.source, target: e.target, relation });
            queue.push([e.source, d + 1]);
          }
        }
      }
    };

    visited.add(params.nodeId);
    bfs(params.nodeId, direction, depth);

    const resultNodeIds = new Set<string>([params.nodeId, ...resultEdges.flatMap((e) => [e.source, e.target])]);
    const resultNodes = [...resultNodeIds].map((id) => nodeMap.get(id)).filter(Boolean).map((n) => this.toKGNode(n!));

    return { nodes: resultNodes, edges: resultEdges };
  }

  /** 获取完整血缘链路（委托 LineageStore）*/
  async getChain(nodeId: string, direction: 'upstream' | 'downstream' | 'both' = 'both'): Promise<KGDisplayGraph> {
    const chain = await this.lineageStore.getLineageChain(nodeId, direction);

    // Enrich bare lineage nodes with richer data from BUSINESS_GRAPH
    const bizNodes = await this.graphStore.listNodes(BUSINESS_GRAPH);
    const bizNodeMap = new Map(bizNodes.map((n) => [n.id, n]));
    const enrich = (n: { id: string; label?: string; attributes?: Record<string, unknown> }) => {
      const biz = bizNodeMap.get(n.id);
      if (biz && Object.keys(biz.attributes ?? {}).length >= Object.keys(n.attributes ?? {}).length) {
        return this.toKGNode(biz);
      }
      return this.toKGNode(n);
    };

    const allNodes = [
      ...chain.upstream.map(enrich),
      ...chain.downstream.map(enrich),
    ];
    // deduplicate
    const seen = new Set<string>();
    const nodes = allNodes.filter((n) => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });

    const edges: KGEdge[] = [
      ...chain.upstreamEdges.map((e) => ({ source: e.source, target: e.target, relation: this.mapRelation(e.relation) })),
      ...chain.downstreamEdges.map((e) => ({ source: e.source, target: e.target, relation: this.mapRelation(e.relation) })),
    ];

    return { nodes, edges };
  }

  /** 获取节点影响分析：删除该节点会影响哪些下游 */
  async getImpact(nodeId: string): Promise<KGImpactResult> {
    const downstream = await this.getNeighborhood({ nodeId, depth: 3, direction: 'downstream' });
    const direct = downstream.nodes.filter((n) => downstream.edges.some((e) => e.source === nodeId && e.target === n.id));
    const indirect = downstream.nodes.filter((n) => n.id !== nodeId && !direct.some((d) => d.id === n.id));
    return { directImpact: direct, indirectImpact: indirect, affectedRelations: downstream.edges };
  }

  // ─── 回填（从现有 SQLite 数据重建图谱）──────────────────────────────────────

  /** 从 SQLite 镜像表重建 Graphology 图 */
  async backfill(): Promise<{ nodesRestored: number; edgesRestored: number }> {
    let nodesRestored = 0;
    let edgesRestored = 0;

    // 回填 lineage_graph_nodes
    const lineageNodes = await this.structuredStore.all<{ node_id: string; label: string; node_type: string; payload_json: string }>(
      `SELECT node_id, label, node_type, payload_json FROM lineage_graph_nodes`
    ).catch(() => []);
    for (const n of lineageNodes) {
      let attrs: Record<string, unknown> = {};
      try { attrs = JSON.parse(n.payload_json); } catch { /* ignore */ }
      await this.graphStore.upsertNode(LINEAGE_GRAPH, { id: n.node_id, label: n.label, attributes: { nodeType: n.node_type, ...attrs } });
      nodesRestored++;
    }

    // 回填 business_graph_nodes
    const bizNodes = await this.structuredStore.all<{ node_id: string; label: string; node_type: string; payload_json: string }>(
      `SELECT node_id, label, node_type, payload_json FROM business_graph_nodes`
    ).catch(() => []);
    for (const n of bizNodes) {
      let attrs: Record<string, unknown> = {};
      try { attrs = JSON.parse(n.payload_json); } catch { /* ignore */ }
      await this.graphStore.upsertNode(BUSINESS_GRAPH, { id: n.node_id, label: n.label, attributes: { nodeType: n.node_type, ...attrs } });
      nodesRestored++;
    }

    // 回填 business_graph_edges
    const bizEdges = await this.structuredStore.all<{ from_node_id: string; to_node_id: string; edge_type: string; payload_json: string }>(
      `SELECT from_node_id, to_node_id, edge_type, payload_json FROM business_graph_edges`
    ).catch(() => []);
    for (const e of bizEdges) {
      let attrs: Record<string, unknown> = {};
      try { attrs = JSON.parse(e.payload_json); } catch { /* ignore */ }
      await this.graphStore.upsertEdge(BUSINESS_GRAPH, { source: e.from_node_id, target: e.to_node_id, attributes: { relation: e.edge_type, ...attrs } });
      edgesRestored++;
    }

    // 回填 rule_lineage
    const lineageRows = await this.structuredStore.all<{ source_rule: string; target_rule: string; relation: string; attributes: string }>(
      `SELECT source_rule, target_rule, relation, attributes FROM rule_lineage`
    ).catch(() => []);
    for (const r of lineageRows) {
      let attrs: Record<string, unknown> = {};
      try { attrs = r.attributes ? JSON.parse(r.attributes) : {}; } catch { /* ignore */ }
      const rel = KG_RELATION_TYPES.includes(r.relation as KGRelationType) ? r.relation as KGRelationType : 'references';
      await this.graphStore.upsertEdge(LINEAGE_GRAPH, { source: r.source_rule, target: r.target_rule, attributes: { relation: rel, ...attrs } });
      edgesRestored++;
    }

    return { nodesRestored, edgesRestored };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private graphForType(nodeType: KGNodeType): string {
    const lineageTypes: KGNodeType[] = ['rule', 'rule_source', 'rule_system', 'document', 'gap', 'report'];
    return lineageTypes.includes(nodeType) ? LINEAGE_GRAPH : BUSINESS_GRAPH;
  }

  private toKGNode(n: { id: string; label?: string; attributes?: Record<string, unknown> }): KGNode {
    return {
      id: n.id,
      label: n.label ?? n.id,
      nodeType: (n.attributes?.nodeType as KGNodeType) ?? 'rule',
      attributes: n.attributes,
    };
  }

  private mapRelation(r: string): KGRelationType {
    if (KG_RELATION_TYPES.includes(r as KGRelationType)) return r as KGRelationType;
    return 'references';
  }
}
