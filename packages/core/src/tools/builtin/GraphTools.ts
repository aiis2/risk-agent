import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { IGraphStore } from '../../storage/interfaces/IGraphStore.js';
import type { KnowledgeGraphService } from '../../knowledge-graph/KnowledgeGraphService.js';
import { KG_NODE_TYPES, KG_RELATION_TYPES } from '../../knowledge-graph/types.js';

export function createGraphQueryTool(store: IGraphStore): AgentToolDefinition {
  return {
    name: 'graph_query',
    description: '查询指定图（business_graph / rule_lineage）中的节点与边。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['graph'],
      properties: {
        graph: { type: 'string', enum: ['business_graph', 'rule_lineage'] },
        nodeIdPrefix: { type: 'string' }
      }
    },
    async execute(input) {
      const { graph, nodeIdPrefix } = input as { graph: string; nodeIdPrefix?: string };
      const nodes = await store.listNodes(graph);
      const edges = await store.listEdges(graph);
      return {
        nodes: nodeIdPrefix ? nodes.filter((n) => n.id.startsWith(nodeIdPrefix)) : nodes,
        edges
      };
    }
  };
}

export function createGraphWriteTool(store: IGraphStore): AgentToolDefinition {
  return {
    name: 'graph_write',
    description: '向图中写入节点或边（受 AG2U 决策调用）。',
    isConcurrencySafe: false,
    isDestructive: true,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['graph', 'operation'],
      properties: {
        graph: { type: 'string' },
        operation: { type: 'string', enum: ['upsert_node', 'upsert_edge'] },
        node: { type: 'object' },
        edge: { type: 'object' }
      }
    },
    async execute(input) {
      const { graph, operation, node, edge } = input as any;
      if (operation === 'upsert_node' && node) {
        await store.upsertNode(graph, node);
      } else if (operation === 'upsert_edge' && edge) {
        await store.upsertEdge(graph, edge);
      } else {
        throw new Error(`Invalid graph_write input: ${operation}`);
      }
      return { ok: true };
    }
  };
}

// ─── 统一知识图谱工具（Agent 可通过这些工具操作 KG）────────────────────────────

/**
 * kg_node_upsert — Agent 新建或更新图谱节点
 */
export function createKGNodeUpsertTool(kgs: KnowledgeGraphService): AgentToolDefinition {
  return {
    name: 'kg_node_upsert',
    description: `在知识图谱中新建或更新一个节点。nodeType 必须是 ${KG_NODE_TYPES.join(' | ')} 之一。`,
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['id', 'label', 'nodeType'],
      properties: {
        id:         { type: 'string', description: '节点唯一 ID' },
        label:      { type: 'string', description: '显示名称' },
        nodeType:   { type: 'string', enum: KG_NODE_TYPES as unknown as string[], description: '节点类型' },
        attributes: { type: 'object', description: '扩展属性（可选）' },
      }
    },
    async execute(input) {
      const { id, label, nodeType, attributes } = input as any;
      await kgs.upsertNode({ id, label, nodeType, attributes });
      return { ok: true, id };
    }
  };
}

/**
 * kg_edge_add — Agent 新增图谱关系边
 */
export function createKGEdgeAddTool(kgs: KnowledgeGraphService): AgentToolDefinition {
  return {
    name: 'kg_edge_add',
    description: `在知识图谱中新增两节点间的关系。relation 必须是 ${KG_RELATION_TYPES.join(' | ')} 之一。`,
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['from', 'to', 'relation'],
      properties: {
        from:       { type: 'object', required: ['id', 'label', 'nodeType'], properties: { id: { type: 'string' }, label: { type: 'string' }, nodeType: { type: 'string', enum: KG_NODE_TYPES as unknown as string[] } } },
        to:         { type: 'object', required: ['id', 'label', 'nodeType'], properties: { id: { type: 'string' }, label: { type: 'string' }, nodeType: { type: 'string', enum: KG_NODE_TYPES as unknown as string[] } } },
        relation:   { type: 'string', enum: KG_RELATION_TYPES as unknown as string[], description: '关系类型' },
        attributes: { type: 'object', description: '关系扩展属性（可选）' },
      }
    },
    async execute(input) {
      const { from, to, relation, attributes } = input as any;
      await kgs.addEdge({ from, to, relation, attributes });
      return { ok: true };
    }
  };
}

/**
 * kg_node_delete — Agent 删除图谱节点及其所有关联边
 */
export function createKGNodeDeleteTool(kgs: KnowledgeGraphService): AgentToolDefinition {
  return {
    name: 'kg_node_delete',
    description: '从知识图谱中删除指定节点及其所有关联边。',
    isConcurrencySafe: false,
    isDestructive: true,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: '要删除的节点 ID' },
      }
    },
    async execute(input) {
      const { id } = input as { id: string };
      await kgs.deleteNode({ id });
      return { ok: true };
    }
  };
}

/**
 * kg_neighborhood — Agent 查询节点邻域图
 */
export function createKGNeighborhoodTool(kgs: KnowledgeGraphService): AgentToolDefinition {
  return {
    name: 'kg_neighborhood',
    description: '查询知识图谱中某个节点的邻域图（周边节点与关系），支持深度和方向过滤。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId:        { type: 'string', description: '中心节点 ID' },
        depth:         { type: 'number', description: '遍历深度，默认 2，最大 5' },
        direction:     { type: 'string', enum: ['upstream', 'downstream', 'both'], description: '方向，默认 both' },
        relationTypes: { type: 'array', items: { type: 'string', enum: KG_RELATION_TYPES as unknown as string[] }, description: '关系类型过滤（可选）' },
      }
    },
    async execute(input) {
      const { nodeId, depth, direction, relationTypes } = input as any;
      return kgs.getNeighborhood({ nodeId, depth, direction, relationTypes });
    }
  };
}

/**
 * kg_search — Agent 在知识图谱中搜索节点
 */
export function createKGSearchTool(kgs: KnowledgeGraphService): AgentToolDefinition {
  return {
    name: 'kg_search',
    description: '在知识图谱中按名称关键字和节点类型搜索节点。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: '搜索关键字' },
        nodeTypes: { type: 'array', items: { type: 'string', enum: KG_NODE_TYPES as unknown as string[] }, description: '节点类型过滤（可选）' },
        limit:     { type: 'number', description: '最多返回条数，默认 50' },
      }
    },
    async execute(input) {
      const { query, nodeTypes, limit } = input as any;
      return kgs.search({ query, nodeTypes, limit: limit ?? 50 });
    }
  };
}

/**
 * kg_impact — Agent 查询删除某节点的影响范围
 */
export function createKGImpactTool(kgs: KnowledgeGraphService): AgentToolDefinition {
  return {
    name: 'kg_impact',
    description: '分析删除或变更某个知识图谱节点会影响到哪些下游节点、关系和报告。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: { type: 'string', description: '要分析的节点 ID' },
      }
    },
    async execute(input) {
      const { nodeId } = input as { nodeId: string };
      return kgs.getImpact(nodeId);
    }
  };
}

