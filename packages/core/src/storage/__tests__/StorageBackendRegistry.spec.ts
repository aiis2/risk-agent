import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { StorageBackendRegistry } from '../registry.js';

describe('StorageBackendRegistry (embedded)', () => {
  it('initializes SQLite + Lance + Graph + LocalFS', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-'));
    try {
      const reg = await StorageBackendRegistry.bootstrap(tmp);
      const s = reg.getStructuredStore();
      const rows = await s.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','business_scenarios','risk_rules','gap_reports')`
      );
      expect(rows.map((r) => r.name).sort()).toEqual(['business_scenarios', 'gap_reports', 'risk_rules', 'sessions']);
      const vec = reg.getVectorStore();
      await vec.upsert('rule_vectors', [{ id: '1', vector: [1, 0, 0] }]);
      const hits = await vec.query('rule_vectors', [1, 0, 0]);
      expect(hits[0].id).toBe('1');
      const g = reg.getGraphStore();
      await g.upsertNode('business_graph', { id: 'scenario:pay', label: 'pay' });
      expect((await g.listNodes('business_graph')).length).toBe(1);
      const obj = reg.getObjectStore();
      await obj.put('reports/r1.json', JSON.stringify({ ok: true }));
      expect(await obj.exists('reports/r1.json')).toBe(true);
      await reg.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('initializes run-first persistence tables alongside the legacy schema', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-'));
    try {
      const reg = await StorageBackendRegistry.bootstrap(tmp);
      const s = reg.getStructuredStore();
      const rows = await s.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('runs','run_checkpoints','run_events','run_artifacts','run_verifications')`
      );

      expect(rows.map((row) => row.name).sort()).toEqual([
        'run_artifacts',
        'run_checkpoints',
        'run_events',
        'run_verifications',
        'runs',
      ]);

      await reg.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
