/**
 * Knowledge Graph — 统一领域模型与类型定义
 *
 * 所有图谱相关的节点类型、关系类型、查询参数、展示模型
 * 均定义于此文件，不在各 Agent/Route/Service 中硬编码字面量。
 */

// ─── 节点类型 ─────────────────────────────────────────────────────────────────

export const KG_NODE_TYPES = [
  'rule',
  'rule_source',
  'rule_system',
  'scenario',
  'business',
  'profile',
  'dimension',
  'gap',
  'report',
  'document',
] as const;

export type KGNodeType = typeof KG_NODE_TYPES[number];

// ─── 关系类型 ─────────────────────────────────────────────────────────────────

export const KG_RELATION_TYPES = [
  'derived_from',
  'belongs_to',
  'covers',
  'references',
  'conflicts_with',
  'replaces',
  'has_profile',
  'has_entity',
  'exposes_gap',
] as const;

export type KGRelationType = typeof KG_RELATION_TYPES[number];

// ─── 核心数据结构 ─────────────────────────────────────────────────────────────

export interface KGNode {
  id: string;
  label: string;
  nodeType: KGNodeType;
  /** 所属图：rule_lineage | business_graph */
  graph?: string;
  attributes?: Record<string, unknown>;
}

export interface KGEdge {
  source: string;
  target: string;
  relation: KGRelationType;
  attributes?: Record<string, unknown>;
}

// ─── 查询参数 ─────────────────────────────────────────────────────────────────

export interface KGOverviewStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByRelation: Record<string, number>;
}

export interface KGSearchParams {
  query?: string;
  nodeTypes?: KGNodeType[];
  relationTypes?: KGRelationType[];
  limit?: number;
}

export interface KGNeighborhoodParams {
  nodeId: string;
  depth?: number;
  direction?: 'upstream' | 'downstream' | 'both';
  relationTypes?: KGRelationType[];
}

export interface KGDisplayGraph {
  nodes: KGNode[];
  edges: KGEdge[];
}

export interface KGImpactResult {
  directImpact: KGNode[];
  indirectImpact: KGNode[];
  affectedRelations: KGEdge[];
}

// ─── 写入操作参数 ─────────────────────────────────────────────────────────────

export interface KGUpsertNodeInput {
  id: string;
  label: string;
  nodeType: KGNodeType;
  attributes?: Record<string, unknown>;
}

export interface KGAddEdgeInput {
  from: { id: string; label: string; nodeType: KGNodeType; attributes?: Record<string, unknown> };
  to: { id: string; label: string; nodeType: KGNodeType; attributes?: Record<string, unknown> };
  relation: KGRelationType;
  attributes?: Record<string, unknown>;
}

export interface KGDeleteNodeInput {
  id: string;
}
