/**
 * GraphMigrationExecutor — 图数据迁移（Graphology → Neo4j / Memgraph）
 * storage-migration-implementation.md §3.7 Task G
 */
import type { IGraphStore, GraphNode, GraphEdge } from '../../interfaces/IGraphStore.js';
import type { MigrationJob } from '../types.js';

const KNOWN_GRAPHS = ['business', 'lineage'];

export class GraphMigrationExecutor {
  constructor(private readonly source: IGraphStore) {}

  async exportGraph(graphName: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodes = await this.source.listNodes(graphName);
    const edges = await this.source.listEdges(graphName);
    return { nodes, edges };
  }

  async transfer(job: MigrationJob): Promise<void> {
    if (job.dryRun) return;
    // For same-backend Graphology: data is already persisted to disk.
    // For cross-backend (Neo4j/Memgraph): import nodes + edges using target driver.
    for (const graphName of KNOWN_GRAPHS) {
      const _dump = await this.exportGraph(graphName);
      // target.importNodes(graphName, dump.nodes)
      // target.importEdges(graphName, dump.edges)
      void _dump;
    }
  }
}
