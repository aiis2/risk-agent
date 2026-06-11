import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunArtifact, RunCheckpoint, RunEvent, RunSnapshot, TaskPackContext } from '../../../harness/types.js';
import { StorageBackendRegistry } from '../../../storage/registry.js';
import { KnowledgeQueryTaskPack } from '../KnowledgeQueryTaskPack.js';

function createContext(runId = 'run_knowledge') {
  const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
  const checkpoints: RunCheckpoint[] = [];
  const artifacts: RunArtifact[] = [];

  const run: RunSnapshot = {
    runId,
    taskKind: 'knowledge-query',
    status: 'running',
    input: { prompt: '账户接管 风险' },
    routing: {
      acceptedTaskKind: 'knowledge-query',
      confidence: 1,
      reason: 'test',
      routeParams: {},
    },
    metrics: {
      turnCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      estimatedUsd: 0,
    },
    createdAt: '2026-04-24T08:00:00.000Z',
    updatedAt: '2026-04-24T08:00:00.000Z',
  };

  const ctx: TaskPackContext = {
    run,
    signal: new AbortController().signal,
    now: () => '2026-04-24T08:00:00.000Z',
    emit: async (event) => {
      emitted.push(event);
      return {
        eventId: `evt_${emitted.length}`,
        runId,
        type: event.type,
        payload: event.payload,
        createdAt: '2026-04-24T08:00:00.000Z',
      };
    },
    createSemanticCheckpoint: async (kind, snapshot) => {
      const checkpoint: RunCheckpoint = {
        checkpointId: `chk_${kind}_${checkpoints.length + 1}`,
        runId,
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: checkpoints.length + 1,
        createdAt: '2026-04-24T08:00:00.000Z',
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    requestUserInput: async () => ({ input: '确认' }),
    publishArtifact: async (artifact) => {
      const published: RunArtifact = {
        artifactId: `art_${artifacts.length + 1}`,
        runId,
        version: artifacts.length + 1,
        createdAt: '2026-04-24T08:00:00.000Z',
        ...artifact,
      };
      artifacts.push(published);
      return published;
    },
  };

  return { ctx, emitted, checkpoints, artifacts };
}

describe('KnowledgeQueryTaskPack', () => {
  it('searches real scenario and rule data instead of returning a stub payload', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-knowledge-pack-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const store = storage.getStructuredStore();
      await store.run(
        `INSERT INTO business_scenarios(scenario_id, name, description, domain, status, version, data_sources, documents, manual_notes)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          'scn_account_takeover',
          '账户接管风险链路',
          '覆盖异常登录与设备漂移的账户接管场景',
          'account-security',
          'active',
          1,
          '[]',
          '[]',
          '重点关注异地登录、设备切换与撞库信号',
        ],
      );
      await store.run(
        `INSERT INTO risk_rules(rule_id, rule_name, biz_type, rule_type, coverage_json, risk_level, source, description, status)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          'rule_account_takeover',
          '账户异常登录拦截',
          'account',
          'anomaly',
          JSON.stringify(['账户接管', '异常登录']),
          'high',
          'unit-test',
          '识别异地登录与设备指纹突变后的账户接管风险',
          'active',
        ],
      );

      const pack = new KnowledgeQueryTaskPack({ storage });
      const { ctx, checkpoints } = createContext();
      const normalized = await pack.intake({ prompt: '账户接管 风险' }, ctx);
      const plan = await pack.plan(normalized, ctx);
      const iterator = pack.execute(plan, ctx);
      const execution = await iterator.next();

      expect(execution.done).toBe(true);
      expect(execution.value).toMatchObject({
        query: '账户接管 风险',
        matches: expect.arrayContaining([
          expect.objectContaining({ sourceType: 'scenario', title: '账户接管风险链路' }),
          expect.objectContaining({ sourceType: 'rule', title: '账户异常登录拦截' }),
        ]),
      });
      expect(checkpoints.map((checkpoint) => checkpoint.snapshot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            query: '账户接管 风险',
            totalMatches: 2,
          }),
        ]),
      );
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('expands the query with attachment context and filters sources by selected tools', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-knowledge-pack-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const store = storage.getStructuredStore();
      await store.run(
        `INSERT INTO business_scenarios(scenario_id, name, description, domain, status, version, data_sources, documents, manual_notes)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          'scn_account_takeover_context',
          '账户接管风险链路',
          '覆盖异常登录与设备漂移的账户接管场景',
          'account-security',
          'active',
          1,
          '[]',
          '[]',
          '重点关注异地登录、设备切换与撞库信号',
        ],
      );
      await store.run(
        `INSERT INTO risk_rules(rule_id, rule_name, biz_type, rule_type, coverage_json, risk_level, source, description, status)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          'rule_account_takeover_context',
          '账户异常登录拦截',
          'account',
          'anomaly',
          JSON.stringify(['账户接管', '异常登录']),
          'high',
          'unit-test',
          '识别异地登录与设备指纹突变后的账户接管风险',
          'active',
        ],
      );
      await store.run(
        `INSERT INTO data_sources(source_id, name, source_type, config_json, enabled) VALUES(?,?,?,?,1)`,
        ['ds_context', '知识库数据源', 'api', '{}'],
      );
      await store.exec(`CREATE TABLE IF NOT EXISTS datasource_knowledge_documents (
        document_id    TEXT PRIMARY KEY,
        source_id      TEXT NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
        snapshot_id    TEXT NOT NULL,
        document_type  TEXT NOT NULL,
        title          TEXT NOT NULL,
        content        TEXT NOT NULL,
        metadata_json  TEXT,
        created_at     TEXT DEFAULT (datetime('now'))
      )`);
      await store.run(
        `INSERT INTO datasource_knowledge_documents(document_id, source_id, snapshot_id, document_type, title, content, metadata_json)
         VALUES(?,?,?,?,?,?,?)`,
        [
          'doc_account_takeover_context',
          'ds_context',
          'snapshot_context',
          'note',
          '账户接管分析手册',
          '异常登录与设备切换同时出现时，需要检查账户接管风险。',
          JSON.stringify({ priority: 'high' }),
        ],
      );

      const pack = new KnowledgeQueryTaskPack({ storage });
      const { ctx, emitted } = createContext('run_knowledge_context');
      const normalized = await pack.intake(
        {
          prompt: '请根据附件补充检索线索',
          attachmentContext: '附件上下文：\n- evidence.txt (text/plain, 32 bytes)\n  摘要: 本次工单涉及账户接管、异常登录与设备切换。',
          toolIds: ['query_database'],
        },
        ctx,
      );
      const plan = await pack.plan(normalized, ctx);
      const execution = await pack.execute(plan, ctx).next();

      expect(execution.done).toBe(true);
      expect(execution.value).toMatchObject({
        counts: {
          scenario: 1,
          rule: 1,
          'datasource-document': 0,
        },
        keywords: expect.arrayContaining(['账户接管', '异常登录']),
        matches: expect.arrayContaining([
          expect.objectContaining({ sourceType: 'scenario', title: '账户接管风险链路' }),
          expect.objectContaining({ sourceType: 'rule', title: '账户异常登录拦截' }),
        ]),
      });
      expect(execution.value.matches).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: 'datasource-document' }),
        ]),
      );
      expect(emitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'knowledge_query_started',
            payload: expect.objectContaining({
              syntheticMetrics: {
                turnCount: 1,
                toolCallCount: 2,
              },
            }),
          }),
          expect.objectContaining({
            type: 'knowledge_query_completed',
            payload: expect.objectContaining({
              syntheticMetrics: {
                turnCount: 1,
              },
            }),
          }),
        ]),
      );
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});