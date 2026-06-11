import type { AgentToolDefinition, StorageBackendRegistry } from '@risk-agent/core';

type DataSourceType = 'api' | 'git' | 'db' | 'file' | 'mcp' | 'web';

interface StoredDataSourceRow {
  source_id: string;
  name: string;
  source_type: DataSourceType;
  config_json: string | null;
  enabled: number;
}

export interface DataSourceSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
}

export interface DataSourceSchemaTable {
  name: string;
  comment?: string;
  columns: DataSourceSchemaColumn[];
}

export interface DataSourceKnowledgeSummary {
  snapshotId: string;
  sourceId: string;
  sourceType: DataSourceType;
  graphName: string;
  vectorCollection: string;
  nodeCount: number;
  edgeCount: number;
  documentCount: number;
  builtAt: string;
  metadata: Record<string, unknown>;
}

export interface DataSourceKnowledgeSearchHit {
  documentId: string;
  title: string;
  documentType: string;
  score: number;
  excerpt: string;
  metadata?: Record<string, unknown>;
}

export interface DataSourceKnowledgeSearchResult {
  sourceId: string;
  graphName: string;
  vectorCollection: string;
  hits: DataSourceKnowledgeSearchHit[];
}

interface DataSourceKnowledgeDocument {
  documentId: string;
  documentType: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface BuiltKnowledgeAssets {
  sourceId: string;
  sourceType: DataSourceType;
  graphName: string;
  vectorCollection: string;
  metadata: Record<string, unknown>;
  nodes: Array<{ id: string; label: string; attributes?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; label: string; attributes?: Record<string, unknown> }>;
  documents: DataSourceKnowledgeDocument[];
}

interface DataSourceKnowledgeOptions {
  loadDbSchema?: (config: Record<string, unknown>) => Promise<DataSourceSchemaTable[]>;
}

const SNAPSHOT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS datasource_knowledge_snapshots (
  snapshot_id        TEXT PRIMARY KEY,
  source_id          TEXT NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
  source_type        TEXT NOT NULL,
  graph_name         TEXT NOT NULL,
  vector_collection  TEXT NOT NULL,
  status             TEXT DEFAULT 'ready',
  node_count         INTEGER DEFAULT 0,
  edge_count         INTEGER DEFAULT 0,
  document_count     INTEGER DEFAULT 0,
  metadata_json      TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
)`;

const DOCUMENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS datasource_knowledge_documents (
  document_id    TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
  snapshot_id    TEXT NOT NULL,
  document_type  TEXT NOT NULL,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  metadata_json  TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
)`;

export class DataSourceKnowledgeService {
  private readonly loadDbSchema: (config: Record<string, unknown>) => Promise<DataSourceSchemaTable[]>;

  constructor(
    private readonly storage: StorageBackendRegistry,
    options: DataSourceKnowledgeOptions = {},
  ) {
    this.loadDbSchema = options.loadDbSchema ?? (async () => []);
  }

  async rebuild(sourceId: string): Promise<DataSourceKnowledgeSummary> {
    await this.ensureTables();
    const source = await this.getSourceOrThrow(sourceId);
    const assets = source.sourceType === 'db'
      ? await this.buildDbAssets(source)
      : this.buildMetadataAssets(source);

    await this.clearExistingAssets(sourceId, assets.graphName, assets.vectorCollection);

    for (const node of assets.nodes) {
      await this.storage.getGraphStore().upsertNode(assets.graphName, node);
    }
    for (const edge of assets.edges) {
      await this.storage.getGraphStore().upsertEdge(assets.graphName, edge);
    }

    const vectorRecords = assets.documents.map((document) => ({
      id: document.documentId,
      text: document.content,
      metadata: {
        sourceId,
        title: document.title,
        documentType: document.documentType,
        ...(document.metadata ?? {}),
      },
      vector: embedText(document.content),
    }));
    if (vectorRecords.length > 0) {
      await this.storage.getVectorStore().upsert(assets.vectorCollection, vectorRecords);
    }

    const snapshotId = `dsk_${sourceId}`;
    const structuredStore = this.storage.getStructuredStore();
    await structuredStore.run(`DELETE FROM datasource_knowledge_documents WHERE source_id=?`, [sourceId]);
    for (const document of assets.documents) {
      await structuredStore.run(
        `INSERT INTO datasource_knowledge_documents(document_id, source_id, snapshot_id, document_type, title, content, metadata_json)
         VALUES(?,?,?,?,?,?,?)`,
        [
          document.documentId,
          sourceId,
          snapshotId,
          document.documentType,
          document.title,
          document.content,
          JSON.stringify(document.metadata ?? {}),
        ],
      );
    }

    await structuredStore.run(
      `INSERT INTO datasource_knowledge_snapshots(snapshot_id, source_id, source_type, graph_name, vector_collection, status, node_count, edge_count, document_count, metadata_json, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
       ON CONFLICT(snapshot_id) DO UPDATE SET
         source_type=excluded.source_type,
         graph_name=excluded.graph_name,
         vector_collection=excluded.vector_collection,
         status=excluded.status,
         node_count=excluded.node_count,
         edge_count=excluded.edge_count,
         document_count=excluded.document_count,
         metadata_json=excluded.metadata_json,
         updated_at=datetime('now')`,
      [
        snapshotId,
        sourceId,
        assets.sourceType,
        assets.graphName,
        assets.vectorCollection,
        'ready',
        assets.nodes.length,
        assets.edges.length,
        assets.documents.length,
        JSON.stringify(assets.metadata),
      ],
    );

    return this.getSummary(sourceId);
  }

  async getSummary(sourceId: string): Promise<DataSourceKnowledgeSummary> {
    await this.ensureTables();
    const row = await this.storage.getStructuredStore().get<{
      snapshot_id: string;
      source_id: string;
      source_type: DataSourceType;
      graph_name: string;
      vector_collection: string;
      node_count: number;
      edge_count: number;
      document_count: number;
      metadata_json: string | null;
      updated_at: string;
    }>(`SELECT * FROM datasource_knowledge_snapshots WHERE source_id=? ORDER BY updated_at DESC LIMIT 1`, [sourceId]);

    if (!row) {
      throw new Error(`datasource knowledge not built: ${sourceId}`);
    }

    return {
      snapshotId: row.snapshot_id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      graphName: row.graph_name,
      vectorCollection: row.vector_collection,
      nodeCount: row.node_count,
      edgeCount: row.edge_count,
      documentCount: row.document_count,
      builtAt: row.updated_at,
      metadata: safeParseJson(row.metadata_json),
    };
  }

  async search(sourceId: string, query: string, limit = 5): Promise<DataSourceKnowledgeSearchResult> {
    await this.ensureTables();
    const summary = await this.getSummary(sourceId);
    const structuredStore = this.storage.getStructuredStore();
    const safeLimit = Math.max(1, Math.min(limit, 20));
    const keywordRows = await structuredStore.all<{
      document_id: string;
      title: string;
      document_type: string;
      content: string;
      metadata_json: string | null;
    }>(
      `SELECT document_id, title, document_type, content, metadata_json
       FROM datasource_knowledge_documents
       WHERE source_id=? AND (title LIKE ? OR content LIKE ?)
       ORDER BY created_at DESC
       LIMIT ?`,
      [sourceId, `%${query}%`, `%${query}%`, safeLimit],
    );

    const keywordHits = keywordRows.map((row, index) => ({
      documentId: row.document_id,
      title: row.title,
      documentType: row.document_type,
      score: Math.max(0.7, 1 - index * 0.05),
      excerpt: createExcerpt(row.content, query),
      metadata: safeParseJson(row.metadata_json),
    }));

    const vectorHits = await this.storage.getVectorStore().query(summary.vectorCollection, embedText(query), safeLimit * 2);
    const vectorIds = vectorHits.map((hit) => hit.id);
    const vectorDocuments = await this.loadDocumentsByIds(sourceId, vectorIds);

    const merged = new Map<string, DataSourceKnowledgeSearchHit>();
    for (const hit of keywordHits) {
      merged.set(hit.documentId, hit);
    }
    for (const hit of vectorHits) {
      const document = vectorDocuments.get(hit.id);
      if (!document) continue;
      const existing = merged.get(hit.id);
      const candidate: DataSourceKnowledgeSearchHit = {
        documentId: hit.id,
        title: document.title,
        documentType: document.documentType,
        score: existing ? Math.max(existing.score, hit.score) : hit.score,
        excerpt: createExcerpt(document.content, query),
        metadata: document.metadata,
      };
      merged.set(hit.id, candidate);
    }

    return {
      sourceId,
      graphName: summary.graphName,
      vectorCollection: summary.vectorCollection,
      hits: [...merged.values()].sort((left, right) => right.score - left.score).slice(0, safeLimit),
    };
  }

  async getGraph(sourceId: string): Promise<{ sourceId: string; graphName: string; nodes: unknown[]; edges: unknown[] }> {
    const summary = await this.getSummary(sourceId);
    const [nodes, edges] = await Promise.all([
      this.storage.getGraphStore().listNodes(summary.graphName),
      this.storage.getGraphStore().listEdges(summary.graphName),
    ]);
    return { sourceId, graphName: summary.graphName, nodes, edges };
  }

  private async ensureTables(): Promise<void> {
    const store = this.storage.getStructuredStore();
    await store.exec(SNAPSHOT_TABLE_SQL);
    await store.exec(`CREATE INDEX IF NOT EXISTS idx_ds_knowledge_source ON datasource_knowledge_snapshots(source_id, updated_at DESC)`);
    await store.exec(DOCUMENT_TABLE_SQL);
    await store.exec(`CREATE INDEX IF NOT EXISTS idx_ds_knowledge_docs_source ON datasource_knowledge_documents(source_id, document_type)`);
  }

  private async getSourceOrThrow(sourceId: string): Promise<StoredDataSourceRow & { sourceType: DataSourceType; config: Record<string, unknown> }> {
    const row = await this.storage.getStructuredStore().get<StoredDataSourceRow>(
      `SELECT * FROM data_sources WHERE source_id=?`,
      [sourceId],
    );
    if (!row) throw new Error(`datasource not found: ${sourceId}`);
    return { ...row, sourceType: row.source_type, config: safeParseJson(row.config_json) };
  }

  private async clearExistingAssets(sourceId: string, graphName: string, vectorCollection: string): Promise<void> {
    const structuredStore = this.storage.getStructuredStore();
    const existingDocs = await structuredStore.all<{ document_id: string }>(
      `SELECT document_id FROM datasource_knowledge_documents WHERE source_id=?`,
      [sourceId],
    );

    if (existingDocs.length > 0) {
      await this.storage.getVectorStore().delete(vectorCollection, existingDocs.map((doc) => doc.document_id)).catch(() => undefined);
    }

    const nodes = await this.storage.getGraphStore().listNodes(graphName);
    for (const node of nodes) {
      await this.storage.getGraphStore().removeNode(graphName, node.id);
    }
  }

  private async buildDbAssets(source: StoredDataSourceRow & { config: Record<string, unknown> }): Promise<BuiltKnowledgeAssets> {
    const schema = await this.loadDbSchema(source.config);
    const graphName = graphNameForSource(source.source_id);
    const vectorCollection = vectorCollectionForSource(source.source_id);
    const databaseName = readConfigString(source.config, 'database') || source.name;

    const nodes: BuiltKnowledgeAssets['nodes'] = [
      {
        id: `datasource:${source.source_id}`,
        label: source.name,
        attributes: { nodeType: 'datasource', sourceType: source.source_type, sourceId: source.source_id },
      },
      {
        id: `database:${source.source_id}:${databaseName}`,
        label: databaseName,
        attributes: { nodeType: 'database', sourceId: source.source_id, dbType: readConfigString(source.config, 'dbType') || 'mysql' },
      },
    ];
    const edges: BuiltKnowledgeAssets['edges'] = [
      {
        source: `datasource:${source.source_id}`,
        target: `database:${source.source_id}:${databaseName}`,
        label: 'contains',
        attributes: { relation: 'contains', sourceId: source.source_id },
      },
    ];

    const documents: DataSourceKnowledgeDocument[] = [
      {
        documentId: `doc:${source.source_id}:summary`,
        documentType: 'schema_summary',
        title: `${source.name} 数据源概览`,
        content: [
          `数据源：${source.name}`,
          `类型：${source.source_type}`,
          `数据库：${databaseName}`,
          `表数量：${schema.length}`,
          `表清单：${schema.map((table) => table.name).join(', ')}`,
        ].join('\n'),
        metadata: { sourceId: source.source_id, sourceType: source.source_type, tableCount: schema.length },
      },
    ];

    for (const table of schema) {
      const tableId = `table:${source.source_id}:${table.name}`;
      nodes.push({
        id: tableId,
        label: table.name,
        attributes: { nodeType: 'table', sourceId: source.source_id, comment: table.comment },
      });
      edges.push({
        source: `database:${source.source_id}:${databaseName}`,
        target: tableId,
        label: 'contains',
        attributes: { relation: 'contains', sourceId: source.source_id },
      });

      documents.push({
        documentId: `doc:${source.source_id}:table:${table.name}`,
        documentType: 'table_schema',
        title: table.name,
        content: [
          `表名：${table.name}`,
          table.comment ? `说明：${table.comment}` : '',
          '字段：',
          ...table.columns.map((column) => `- ${column.name} ${column.type}${column.nullable ? ' nullable' : ' not null'}${column.comment ? ` // ${column.comment}` : ''}`),
        ].filter(Boolean).join('\n'),
        metadata: { sourceId: source.source_id, tableName: table.name, columnCount: table.columns.length },
      });

      for (const column of table.columns) {
        const columnId = `column:${source.source_id}:${table.name}:${column.name}`;
        nodes.push({
          id: columnId,
          label: column.name,
          attributes: { nodeType: 'column', sourceId: source.source_id, tableName: table.name, dataType: column.type, nullable: column.nullable, comment: column.comment },
        });
        edges.push({
          source: tableId,
          target: columnId,
          label: 'contains',
          attributes: { relation: 'contains', sourceId: source.source_id },
        });
      }
    }

    return {
      sourceId: source.source_id,
      sourceType: source.source_type,
      graphName,
      vectorCollection,
      metadata: { tableCount: schema.length, database: databaseName },
      nodes,
      edges,
      documents,
    };
  }

  private buildMetadataAssets(source: StoredDataSourceRow & { config: Record<string, unknown> }): BuiltKnowledgeAssets {
    const graphName = graphNameForSource(source.source_id);
    const vectorCollection = vectorCollectionForSource(source.source_id);
    const target = readConfigString(source.config, 'baseUrl') || readConfigString(source.config, 'url') || readConfigString(source.config, 'filePath') || source.name;
    const nodes: BuiltKnowledgeAssets['nodes'] = [
      {
        id: `datasource:${source.source_id}`,
        label: source.name,
        attributes: { nodeType: 'datasource', sourceType: source.source_type, sourceId: source.source_id },
      },
      {
        id: `${source.source_type}:${source.source_id}:primary`,
        label: target,
        attributes: { nodeType: source.source_type, sourceId: source.source_id },
      },
    ];
    const edges: BuiltKnowledgeAssets['edges'] = [
      {
        source: `datasource:${source.source_id}`,
        target: `${source.source_type}:${source.source_id}:primary`,
        label: 'describes',
        attributes: { relation: 'describes', sourceId: source.source_id },
      },
    ];
    const content = [
      `数据源：${source.name}`,
      `类型：${source.source_type}`,
      `目标：${target}`,
      `配置：${JSON.stringify(redactConfig(source.config), null, 2)}`,
    ].join('\n');

    return {
      sourceId: source.source_id,
      sourceType: source.source_type,
      graphName,
      vectorCollection,
      metadata: { target },
      nodes,
      edges,
      documents: [{
        documentId: `doc:${source.source_id}:summary`,
        documentType: 'metadata_summary',
        title: `${source.name} 数据源概览`,
        content,
        metadata: { sourceId: source.source_id, sourceType: source.source_type, target },
      }],
    };
  }

  private async loadDocumentsByIds(sourceId: string, documentIds: string[]): Promise<Map<string, { title: string; documentType: string; content: string; metadata?: Record<string, unknown> }>> {
    if (documentIds.length === 0) return new Map();
    const placeholders = documentIds.map(() => '?').join(', ');
    const rows = await this.storage.getStructuredStore().all<{
      document_id: string;
      title: string;
      document_type: string;
      content: string;
      metadata_json: string | null;
    }>(
      `SELECT document_id, title, document_type, content, metadata_json FROM datasource_knowledge_documents WHERE source_id=? AND document_id IN (${placeholders})`,
      [sourceId, ...documentIds],
    );

    return new Map(rows.map((row) => [
      row.document_id,
      {
        title: row.title,
        documentType: row.document_type,
        content: row.content,
        metadata: safeParseJson(row.metadata_json),
      },
    ]));
  }
}

export function createDataSourceKnowledgeSearchTool(service: DataSourceKnowledgeService): AgentToolDefinition {
  return {
    name: 'datasource_knowledge_search',
    description: '检索某个数据源的内置知识索引，快速定位相关表、字段、端点和查询线索。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['datasourceId', 'query'],
      properties: {
        datasourceId: { type: 'string', description: '数据源 ID' },
        query: { type: 'string', description: '检索关键词，例如“支付渠道”或“order_id”' },
        topK: { type: 'number', description: '最多返回条数，默认 5' },
      },
    },
    async execute(input) {
      const { datasourceId, query, topK } = input as { datasourceId: string; query: string; topK?: number };
      return service.search(datasourceId, query, topK ?? 5);
    },
  };
}

export function createDataSourceKnowledgeGraphTool(service: DataSourceKnowledgeService): AgentToolDefinition {
  return {
    name: 'datasource_knowledge_graph',
    description: '读取某个数据源的内置知识图谱节点与边，帮助 Agent 理解表、字段和端点之间的结构关系。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['datasourceId'],
      properties: {
        datasourceId: { type: 'string', description: '数据源 ID' },
      },
    },
    async execute(input) {
      const { datasourceId } = input as { datasourceId: string };
      return service.getGraph(datasourceId);
    },
  };
}

function graphNameForSource(sourceId: string): string {
  return `datasource_knowledge_${sanitizeId(sourceId)}`;
}

function vectorCollectionForSource(sourceId: string): string {
  return `datasource_knowledge_${sanitizeId(sourceId)}`;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function embedText(text: string, dimensions = 48): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  for (const token of tokens) {
    let hash = 0;
    for (const char of token) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    vector[hash % dimensions] += 1;
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? vector : vector.map((value) => value / length);
}

function createExcerpt(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return content.slice(0, 120);
  const start = Math.max(0, idx - 24);
  return content.slice(start, start + 120);
}

function safeParseJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readConfigString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (/password|secret|key|token/i.test(key) && typeof value === 'string') {
        return [key, '***'];
      }
      return [key, value];
    }),
  );
}