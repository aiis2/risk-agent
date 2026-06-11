import type { GraphEdge, GraphNode } from './IGraphStore.js';

export interface LineageRelation extends GraphEdge {
  relation: 'derived_from' | 'belongs_to' | 'covers' | 'references' | 'conflicts_with' | 'replaces' | 'has_profile' | 'has_entity' | 'exposes_gap';
}

export interface LineageRef {
  type: 'rule' | 'scenario' | 'dimension' | 'system' | 'document' | 'source';
  id: string;
  label?: string;
  attributes?: Record<string, unknown>;
}

/** 前端展示格式（04-storage-layer.md §5） */
export interface LineageDisplayData {
  nodes: { id: string; label: string; type: string; attrs: Record<string, unknown> }[];
  edges: { source: string; target: string; label: string; type: string }[];
}

export interface LineageChain {
  nodeId: string;
  upstream: GraphNode[];
  downstream: GraphNode[];
  upstreamEdges: LineageRelation[];
  downstreamEdges: LineageRelation[];
}

export interface ILineageStore {
  upsertRuleNode(node: GraphNode): Promise<void>;
  upsertRelation(rel: LineageRelation): Promise<void>;
  getRuleAncestors(ruleId: string): Promise<GraphNode[]>;
  getRuleDescendants(ruleId: string): Promise<GraphNode[]>;
  listAll(): Promise<{ nodes: GraphNode[]; edges: LineageRelation[] }>;

  /** 通用血缘边写入（04-storage-layer.md §5） */
  addLineageEdge(from: LineageRef, to: LineageRef, relation: LineageRelation['relation']): Promise<void>;
  /** 查询节点完整血缘链路 */
  getLineageChain(nodeId: string, direction?: 'upstream' | 'downstream' | 'both'): Promise<LineageChain>;
  /** 按关系类型过滤查询 */
  queryByRelation(relation: LineageRelation['relation']): Promise<LineageRelation[]>;
  /** 导出为前端展示格式，支持以某个节点为中心 */
  toDisplayGraph(centerNodeId?: string, depth?: number): Promise<LineageDisplayData>;
  /** 删除指定节点及其所有关联边 */
  removeNode(nodeId: string): Promise<void>;
}
