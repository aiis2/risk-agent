import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Graph from 'graphology';
import type { GraphEdge, GraphNode, IGraphStore } from '../../interfaces/IGraphStore.js';

export class GraphologyStore implements IGraphStore {
  private readonly graphs = new Map<string, Graph>();

  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
  }

  async close(): Promise<void> {
    for (const name of this.graphs.keys()) {
      await this.persist(name);
    }
  }

  private filePath(name: string): string {
    return join(this.rootDir, `${name}.json`);
  }

  private load(name: string): Graph {
    if (this.graphs.has(name)) return this.graphs.get(name)!;
    const g = new Graph({ multi: false, allowSelfLoops: true });
    const p = this.filePath(name);
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf-8')) as {
          nodes?: GraphNode[];
          edges?: GraphEdge[];
        };
        for (const node of data.nodes ?? []) {
          g.addNode(node.id, { label: node.label, ...(node.attributes ?? {}) });
        }
        for (const edge of data.edges ?? []) {
          if (!g.hasNode(edge.source)) g.addNode(edge.source);
          if (!g.hasNode(edge.target)) g.addNode(edge.target);
          g.addEdgeWithKey(`${edge.source}->${edge.target}`, edge.source, edge.target, {
            label: edge.label,
            ...(edge.attributes ?? {})
          });
        }
      } catch {
        // ignore
      }
    }
    this.graphs.set(name, g);
    return g;
  }

  async persist(name: string): Promise<void> {
    const g = this.graphs.get(name);
    if (!g) return;
    const nodes: GraphNode[] = [];
    g.forEachNode((id, attrs) => {
      const { label, ...rest } = attrs as Record<string, unknown>;
      nodes.push({ id, label: (label as string) ?? undefined, attributes: rest });
    });
    const edges: GraphEdge[] = [];
    g.forEachEdge((_key, attrs, src, tgt) => {
      const { label, ...rest } = attrs as Record<string, unknown>;
      edges.push({ source: src, target: tgt, label: (label as string) ?? undefined, attributes: rest });
    });
    mkdirSync(dirname(this.filePath(name)), { recursive: true });
    writeFileSync(this.filePath(name), JSON.stringify({ nodes, edges }, null, 2), 'utf-8');
  }

  async upsertNode(graphName: string, node: GraphNode): Promise<void> {
    const g = this.load(graphName);
    if (g.hasNode(node.id)) {
      g.mergeNodeAttributes(node.id, { label: node.label, ...(node.attributes ?? {}) });
    } else {
      g.addNode(node.id, { label: node.label, ...(node.attributes ?? {}) });
    }
  }

  async upsertEdge(graphName: string, edge: GraphEdge): Promise<void> {
    const g = this.load(graphName);
    if (!g.hasNode(edge.source)) g.addNode(edge.source);
    if (!g.hasNode(edge.target)) g.addNode(edge.target);
    const key = `${edge.source}->${edge.target}`;
    if (g.hasEdge(key)) {
      g.mergeEdgeAttributes(key, { label: edge.label, ...(edge.attributes ?? {}) });
    } else {
      g.addEdgeWithKey(key, edge.source, edge.target, {
        label: edge.label,
        ...(edge.attributes ?? {})
      });
    }
  }

  async listNodes(graphName: string): Promise<GraphNode[]> {
    const g = this.load(graphName);
    const list: GraphNode[] = [];
    g.forEachNode((id, attrs) => {
      const { label, ...rest } = attrs as Record<string, unknown>;
      list.push({ id, label: label as string | undefined, attributes: rest });
    });
    return list;
  }

  async listEdges(graphName: string): Promise<GraphEdge[]> {
    const g = this.load(graphName);
    const list: GraphEdge[] = [];
    g.forEachEdge((_k, attrs, src, tgt) => {
      const { label, ...rest } = attrs as Record<string, unknown>;
      list.push({ source: src, target: tgt, label: label as string | undefined, attributes: rest });
    });
    return list;
  }

  async removeNode(graphName: string, id: string): Promise<void> {
    const g = this.load(graphName);
    if (g.hasNode(id)) g.dropNode(id);
  }

  async query(graphName: string, predicate: (node: GraphNode) => boolean): Promise<GraphNode[]> {
    const all = await this.listNodes(graphName);
    return all.filter(predicate);
  }
}
