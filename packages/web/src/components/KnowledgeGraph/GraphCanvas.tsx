import { useMemo, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { KGNode, KGEdge } from '../../api/client';

/** 节点类型颜色（与 GraphLegend 一致） */
const NODE_COLOR: Record<string, string> = {
  rule:         '#6b8afe',
  rule_source:  '#8b7fee',
  rule_system:  '#a78bfa',
  scenario:     '#30d158',
  business:     '#ffba08',
  profile:      '#ff9f0a',
  dimension:    '#64d2ff',
  gap:          '#ff5a5f',
  report:       '#98e1c2',
  document:     '#8d92a8',
};

/** 关系边颜色 */
const EDGE_COLOR: Record<string, string> = {
  derived_from:   '#6b8afe',
  belongs_to:     '#30d158',
  covers:         '#64d2ff',
  references:     '#8d92a8',
  conflicts_with: '#ff5a5f',
  replaces:       '#ffba08',
  has_profile:    '#ff9f0a',
  has_entity:     '#a78bfa',
  exposes_gap:    '#ff5a5f',
};

const FLOW_ARIA_LABELS = {
  'controls.ariaLabel': '图谱控制面板',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '适应视图',
  'controls.interactive.ariaLabel': '切换交互模式',
  'minimap.ariaLabel': '缩略图',
} as const;

const EDGE_LABELS: Record<string, string> = {
  derived_from: '衍生自',
  belongs_to: '归属于',
  covers: '覆盖',
  references: '引用',
  conflicts_with: '冲突',
  replaces: '替换',
  has_profile: '有画像',
  has_entity: '有实体',
  exposes_gap: '揭示缺口',
};

function readEdgeLabel(relation: string) {
  return EDGE_LABELS[relation] ?? relation;
}

/** 按 nodeType 分列布局 */
function layout(nodes: KGNode[]): Record<string, { x: number; y: number }> {
  const buckets: Record<string, KGNode[]> = {};
  for (const n of nodes) {
    const k = n.nodeType ?? 'document';
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(n);
  }
  const order = [
    'rule_system', 'rule_source', 'rule', 'scenario',
    'business', 'profile', 'dimension', 'gap', 'report', 'document',
  ];
  const pos: Record<string, { x: number; y: number }> = {};
  let col = 0;
  for (const key of order) {
    const list = buckets[key];
    if (!list?.length) continue;
    list.forEach((n, i) => { pos[n.id] = { x: col * 280 + 40, y: i * 90 + 40 }; });
    col += 1;
  }
  // fallback
  for (const n of nodes) {
    if (!pos[n.id]) pos[n.id] = { x: col * 280 + 40, y: 40 };
  }
  return pos;
}

interface Props {
  nodes: KGNode[];
  edges: KGEdge[];
  selectedNodeId?: string;
  onNodeClick?: (node: KGNode) => void;
  emptyHint?: string;
}

export function GraphCanvas({ nodes, edges, selectedNodeId, onNodeClick, emptyHint }: Props) {
  // Deduplicate nodes by ID as safety net (prevents React key collision)
  const uniqueNodes = useMemo(() => {
    const seen = new Set<string>();
    return nodes.filter((n) => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });
  }, [nodes]);
  const positions = useMemo(() => layout(uniqueNodes), [uniqueNodes]);

  const rfNodes: Node[] = useMemo(
    () => uniqueNodes.map((n) => ({
      id: n.id,
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: { label: n.label ?? n.id },
      style: {
        border: `2px solid ${n.id === selectedNodeId ? '#ffffff' : (NODE_COLOR[n.nodeType] ?? '#334155')}`,
        borderRadius: 8,
        padding: '6px 10px',
        background: n.id === selectedNodeId ? '#1e2340' : '#161a2c',
        color: '#e6e8f2',
        fontSize: 11,
        minWidth: 100,
        maxWidth: 200,
        boxShadow: n.id === selectedNodeId ? `0 0 0 2px ${NODE_COLOR[n.nodeType] ?? '#6b8afe'}` : 'none',
      },
    })),
    [uniqueNodes, positions, selectedNodeId]
  );

  const rfEdges: Edge[] = useMemo(
    () => edges.map((e, i) => ({
      id: `${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      label: readEdgeLabel(e.relation),
      style: { stroke: EDGE_COLOR[e.relation] ?? '#334155', strokeWidth: 1.5 },
      labelStyle: { fill: '#8d92a8', fontSize: 10 },
    })),
    [edges]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, rfNode: Node) => {
      const kg = uniqueNodes.find((n) => n.id === rfNode.id);
      if (kg) onNodeClick?.(kg);
    },
    [uniqueNodes, onNodeClick]
  );

  if (!uniqueNodes.length) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-border bg-surface text-sm text-text-muted min-h-[400px]"
      >
        {emptyHint ?? 'No graph data.'}
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden border border-border min-h-[400px] flex-1 h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        ariaLabelConfig={FLOW_ARIA_LABELS}
        style={{ background: '#0f1220' }}
      >
        <Background color="#1e2340" gap={20} />
        <Controls style={{ background: '#161a2c', border: '1px solid #2a3054', borderRadius: 8 }} />
        <MiniMap
          nodeColor={(n) => NODE_COLOR[(n.data as any)?.nodeType as string] ?? '#334155'}
          style={{ background: '#161a2c', border: '1px solid #2a3054' }}
        />
      </ReactFlow>
    </div>
  );
}
