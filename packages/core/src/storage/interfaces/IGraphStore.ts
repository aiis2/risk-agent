export interface GraphNode {
  id: string;
  label?: string;
  attributes?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  attributes?: Record<string, unknown>;
}

export interface IGraphStore {
  init(): Promise<void>;
  close(): Promise<void>;
  upsertNode(graphName: string, node: GraphNode): Promise<void>;
  upsertEdge(graphName: string, edge: GraphEdge): Promise<void>;
  listNodes(graphName: string): Promise<GraphNode[]>;
  listEdges(graphName: string): Promise<GraphEdge[]>;
  removeNode(graphName: string, id: string): Promise<void>;
  query(graphName: string, predicate: (node: GraphNode) => boolean): Promise<GraphNode[]>;
  persist(graphName: string): Promise<void>;
}
