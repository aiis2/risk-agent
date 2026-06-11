import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageBackendRegistry } from '@risk-agent/core';
import { DataSourceKnowledgeService } from '../DataSourceKnowledgeService.js';

describe('DataSourceKnowledgeService', () => {
  it('builds db datasource knowledge assets with graph nodes and searchable documents', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-ds-knowledge-'));
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    try {
      const store = storage.getStructuredStore();
      await store.run(
        `INSERT INTO data_sources(source_id, name, source_type, config_json, enabled) VALUES(?,?,?,?,1)`,
        ['ds-db', '订单核心库', 'db', JSON.stringify({ dbType: 'mysql', host: 'db.internal', database: 'risk_core' })]
      );

      const service = new DataSourceKnowledgeService(storage, {
        loadDbSchema: async () => [
          {
            name: 'orders',
            comment: '订单主表',
            columns: [
              { name: 'order_id', type: 'bigint', nullable: false, comment: '订单 ID' },
              { name: 'user_id', type: 'bigint', nullable: false, comment: '用户 ID' },
              { name: 'risk_flag', type: 'tinyint', nullable: true, comment: '风险标记' },
            ],
          },
          {
            name: 'payments',
            comment: '支付流水表',
            columns: [
              { name: 'payment_id', type: 'bigint', nullable: false, comment: '支付 ID' },
              { name: 'order_id', type: 'bigint', nullable: false, comment: '订单 ID' },
              { name: 'channel_code', type: 'varchar(32)', nullable: false, comment: '支付渠道' },
            ],
          },
        ],
      });

      const summary = await service.rebuild('ds-db');
      expect(summary.graphName).toContain('datasource_knowledge_');
      expect(summary.vectorCollection).toContain('datasource_knowledge_');
      expect(summary.nodeCount).toBeGreaterThanOrEqual(9);
      expect(summary.edgeCount).toBeGreaterThanOrEqual(8);
      expect(summary.documentCount).toBe(3);

      const nodes = await storage.getGraphStore().listNodes(summary.graphName);
      expect(nodes.some((node) => node.id === 'table:ds-db:orders')).toBe(true);
      expect(nodes.some((node) => node.id === 'column:ds-db:payments:channel_code')).toBe(true);

      const documents = await store.all<{ document_type: string; title: string }>(
        `SELECT document_type, title FROM datasource_knowledge_documents WHERE source_id=? ORDER BY document_type, title`,
        ['ds-db']
      );
      expect(documents).toEqual([
        { document_type: 'schema_summary', title: '订单核心库 数据源概览' },
        { document_type: 'table_schema', title: 'orders' },
        { document_type: 'table_schema', title: 'payments' },
      ]);

      const hits = await service.search('ds-db', '支付渠道', 3);
      expect(hits.hits.length).toBeGreaterThan(0);
      expect(hits.hits.some((hit) => hit.title === 'payments')).toBe(true);
    } finally {
      await storage.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('builds metadata knowledge assets for non-db datasources', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-ds-knowledge-'));
    const storage = await StorageBackendRegistry.bootstrap(tmp);

    try {
      const store = storage.getStructuredStore();
      await store.run(
        `INSERT INTO data_sources(source_id, name, source_type, config_json, enabled) VALUES(?,?,?,?,1)`,
        ['ds-api', '反欺诈画像 API', 'api', JSON.stringify({ baseUrl: 'https://api.example.com', url: 'https://api.example.com/profile', headers: '{"X-Env":"prod"}' })]
      );

      const service = new DataSourceKnowledgeService(storage);
      const summary = await service.rebuild('ds-api');

      expect(summary.nodeCount).toBeGreaterThanOrEqual(2);
      expect(summary.edgeCount).toBeGreaterThanOrEqual(1);
      expect(summary.documentCount).toBe(1);

      const hits = await service.search('ds-api', 'profile', 2);
      expect(hits.hits.length).toBeGreaterThan(0);
      expect(hits.hits[0]?.title).toBe('反欺诈画像 API 数据源概览');
    } finally {
      await storage.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});