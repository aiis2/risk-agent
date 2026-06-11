import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

/**
 * BusinessGraph — 将业务场景 / 规则节点渲染为静态 DAG。
 *
 * 期望的数据形状：
 *  nodes: [{ id, label, type: 'scenario'|'rule'|'gap', data?: any }]
 *  edges: [{ id, source, target, label? }]
 */
export interface GraphNodeInput {
  id: string;
  label: string;
  type: 'scenario' | 'rule' | 'gap' | string;
  data?: Record<string, unknown>;
}
export interface GraphEdgeInput {
  id: string;
  source: string;
  target: string;
  label?: string;
}

const NODE_COLOR: Record<string, string> = {
  scenario: 'rgb(var(--accent))',
  rule: 'rgb(var(--success))',
  gap: 'rgb(var(--warn))'
};

function graphHeightClass(height?: number): string {
  switch (height) {
    case 320:
      return 'h-[320px]';
    case 360:
      return 'h-[360px]';
    case 380:
      return 'h-[380px]';
    case 420:
      return 'h-[420px]';
    case 480:
      return 'h-[480px]';
    default:
      return 'h-[360px]';
  }
}

function layout(nodes: GraphNodeInput[]): Record<string, { x: number; y: number }> {
  const buckets: Record<string, GraphNodeInput[]> = {};
  for (const n of nodes) {
    const k = n.type ?? 'other';
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(n);
  }
  const order = ['scenario', 'rule', 'gap', 'other'];
  const pos: Record<string, { x: number; y: number }> = {};
  let col = 0;
  for (const key of order) {
    const list = buckets[key];
    if (!list?.length) continue;
    list.forEach((n, i) => {
      pos[n.id] = { x: col * 260 + 40, y: i * 80 + 40 };
    });
    col += 1;
  }
  // 兜底：未分类的节点
  for (const n of nodes) {
    if (!pos[n.id]) pos[n.id] = { x: col * 260 + 40, y: Math.random() * 400 };
  }
  return pos;
}

export function BusinessGraph(props: {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  height?: number;
  emptyHint?: string;
}) {
  const positions = useMemo(() => layout(props.nodes), [props.nodes]);
  const rfNodes: Node[] = useMemo(
    () =>
      props.nodes.map((n) => ({
        id: n.id,
        position: positions[n.id] ?? { x: 0, y: 0 },
        data: { label: n.label },
        style: {
          border: `1px solid ${NODE_COLOR[n.type] ?? '#334155'}`,
          borderRadius: 8,
          padding: 8,
          background: 'rgb(var(--surface-card))',
          color: 'rgb(var(--text-primary))',
          fontSize: 12,
          minWidth: 120
        }
      })),
    [props.nodes, positions]
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      props.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        style: { stroke: 'rgb(var(--border-strong))' },
        labelStyle: { fill: 'rgb(var(--text-dim))', fontSize: 10 }
      })),
    [props.edges]
  );

  if (!props.nodes.length) {
    return (
      <div className="p-4 text-text-dim">
        {props.emptyHint ?? 'No graph data.'}
      </div>
    );
  }

  return (
    <div className={`rounded-lg bg-surface ${graphHeightClass(props.height)}`}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} fitView nodesDraggable nodesConnectable={false}>
        <Background color="rgb(var(--border-subtle))" gap={16} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          style={{ background: 'rgb(var(--surface-sidebar))', border: '1px solid rgb(var(--border-subtle))' }}
          maskColor="rgb(var(--surface-bg) / 0.7)"
          nodeColor={(n) => NODE_COLOR[props.nodes.find((node) => node.id === n.id)?.type ?? 'other'] ?? 'rgb(var(--border-strong))'}
        />
      </ReactFlow>
    </div>
  );
}
