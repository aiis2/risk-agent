/**
 * Neo4jStore — Neo4j 图数据库适配器。
 * packages/core/src/storage/adapters/Neo4jStore.ts
 *
 * 依赖 `neo4j-driver`（按需安装：pnpm add -w neo4j-driver）。
 * 当 storage.json 中 graph.backend === 'neo4j' 时由 registry.ts 加载。
 */
import type { GraphEdge, GraphNode, IGraphStore } from '../interfaces/IGraphStore.js';

export interface Neo4jStoreConfig {
  url: string;
  username?: string;
  password?: string;
  database?: string;
}

export class Neo4jStore implements IGraphStore {
  private driver: any = null;
  private readonly db: string;

  constructor(private readonly config: Neo4jStoreConfig) {
    this.db = config.database ?? 'neo4j';
  }

  async init(): Promise<void> {
    let neo4j: any;
    try {
      // @ts-ignore — optional peer dep, install when using neo4j backend
      neo4j = await import('neo4j-driver');
    } catch {
      throw new Error(
        'Neo4jStore: `neo4j-driver` not installed. Run: pnpm add -w neo4j-driver',
      );
    }
    const driver = neo4j.default ?? neo4j;
    const auth = this.config.username
      ? driver.auth.basic(this.config.username, this.config.password ?? '')
      : undefined;
    this.driver = driver.driver(this.config.url, auth);
    await this.driver.verifyConnectivity();
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
  }

  private session() {
    return this.driver.session({ database: this.db });
  }

  async upsertNode(graphName: string, node: GraphNode): Promise<void> {
    const s = this.session();
    try {
      await s.run(
        `MERGE (n:${graphName} {id: $id}) SET n.label = $label, n.attrs = $attrs`,
        { id: node.id, label: node.label ?? '', attrs: JSON.stringify(node.attributes ?? {}) },
      );
    } finally { await s.close(); }
  }

  async upsertEdge(graphName: string, edge: GraphEdge): Promise<void> {
    const s = this.session();
    const rel = (edge.label ?? 'RELATED').replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
    try {
      await s.run(
        `MATCH (a:${graphName} {id: $src}), (b:${graphName} {id: $tgt})
         MERGE (a)-[r:${rel}]->(b) SET r.attrs = $attrs`,
        { src: edge.source, tgt: edge.target, attrs: JSON.stringify(edge.attributes ?? {}) },
      );
    } finally { await s.close(); }
  }

  async listNodes(graphName: string): Promise<GraphNode[]> {
    const s = this.session();
    try {
      const res = await s.run(`MATCH (n:${graphName}) RETURN n.id AS id, n.label AS label, n.attrs AS attrs`);
      return res.records.map((r: any) => ({
        id: r.get('id'),
        label: r.get('label') ?? undefined,
        attributes: r.get('attrs') ? JSON.parse(r.get('attrs')) : undefined,
      }));
    } finally { await s.close(); }
  }

  async listEdges(graphName: string): Promise<GraphEdge[]> {
    const s = this.session();
    try {
      const res = await s.run(
        `MATCH (a:${graphName})-[r]->(b:${graphName}) RETURN a.id AS src, b.id AS tgt, type(r) AS label, r.attrs AS attrs`,
      );
      return res.records.map((r: any) => ({
        source: r.get('src'),
        target: r.get('tgt'),
        label: r.get('label') ?? undefined,
        attributes: r.get('attrs') ? JSON.parse(r.get('attrs')) : undefined,
      }));
    } finally { await s.close(); }
  }

  async removeNode(graphName: string, id: string): Promise<void> {
    const s = this.session();
    try {
      await s.run(`MATCH (n:${graphName} {id: $id}) DETACH DELETE n`, { id });
    } finally { await s.close(); }
  }

  async query(graphName: string, predicate: (node: GraphNode) => boolean): Promise<GraphNode[]> {
    const all = await this.listNodes(graphName);
    return all.filter(predicate);
  }

  // Neo4j is persistent by default — no-op
  async persist(_graphName: string): Promise<void> {}
}
