import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const SystemSchema = z.object({
  systemName: z.string().min(1),
  systemType: z.enum(['realtime', 'offline', 'manual']).optional(),
  syncConfig: z
    .object({
      apiUrl: z.string().optional(),
      syncInterval: z.number().optional(),
      authType: z.enum(['api_key', 'oauth2', 'none']).optional()
    })
    .optional()
});

export function registerRuleSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  // Ensure column exists in existing databases (migration guard)
  void store
    .exec(`ALTER TABLE risk_rules ADD COLUMN system_id TEXT`)
    .catch(() => {/* column already exists – ignore */});

  // GET /api/rule-systems — list all systems with rule counts
  app.get('/api/rule-systems', async () => {
    const systems = await store.all<any>(`SELECT * FROM rule_systems ORDER BY created_at DESC`);
    const counts = await store.all<{ system_id: string; cnt: number }>(
      `SELECT system_id, COUNT(*) AS cnt FROM risk_rules WHERE system_id IS NOT NULL GROUP BY system_id`
    );
    const countMap = Object.fromEntries(counts.map((c) => [c.system_id, c.cnt]));
    return systems.map((s) => serializeSystem(s, countMap[s.system_id] ?? s.rule_count ?? 0));
  });

  // GET /api/rule-systems/:id — get one system with its rules
  app.get('/api/rule-systems/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sys = await store.get<any>(`SELECT * FROM rule_systems WHERE system_id=?`, [id]);
    if (!sys) return reply.code(404).send({ error: 'not_found' });
    const rules = await store.all<any>(`SELECT * FROM risk_rules WHERE system_id=? ORDER BY synced_at DESC`, [id]);
    return { ...serializeSystem(sys, rules.length), rules: rules.map(serializeRule) };
  });

  // POST /api/rule-systems — create
  app.post('/api/rule-systems', async (req, reply) => {
    const parsed = SystemSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const id = randomUUID();
    const d = parsed.data;
    await store.run(
      `INSERT INTO rule_systems(system_id, system_name, system_type, sync_config) VALUES(?,?,?,?)`,
      [id, d.systemName, d.systemType ?? 'manual', d.syncConfig ? JSON.stringify(d.syncConfig) : null]
    );
    const row = await store.get<any>(`SELECT * FROM rule_systems WHERE system_id=?`, [id]);
    reply.code(201).send(serializeSystem(row!, 0));
  });

  // PUT /api/rule-systems/:id — update
  app.put('/api/rule-systems/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = SystemSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const existing = await store.get<any>(`SELECT * FROM rule_systems WHERE system_id=?`, [id]);
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const d = parsed.data;
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (d.systemName !== undefined) { sets.push('system_name=?'); vals.push(d.systemName); }
    if (d.systemType !== undefined) { sets.push('system_type=?'); vals.push(d.systemType); }
    if (d.syncConfig !== undefined) { sets.push('sync_config=?'); vals.push(JSON.stringify(d.syncConfig)); }
    if (sets.length === 0) return reply.code(400).send({ error: 'no_fields' });
    sets.push("updated_at=datetime('now')");
    vals.push(id);
    await store.run(`UPDATE rule_systems SET ${sets.join(', ')} WHERE system_id=?`, vals);
    const updated = await store.get<any>(`SELECT * FROM rule_systems WHERE system_id=?`, [id]);
    const cnt = (await store.get<any>(`SELECT COUNT(*) AS cnt FROM risk_rules WHERE system_id=?`, [id]))?.cnt ?? 0;
    return serializeSystem(updated!, cnt);
  });

  // DELETE /api/rule-systems/:id
  app.delete('/api/rule-systems/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    // Unlink rules before deleting system
    await store.run(`UPDATE risk_rules SET system_id=NULL WHERE system_id=?`, [id]);
    await store.run(`DELETE FROM rule_systems WHERE system_id=?`, [id]);
    reply.code(204).send();
  });

  // POST /api/rule-systems/:id/sync — trigger manual sync
  app.post('/api/rule-systems/:id/sync', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sys = await store.get<any>(`SELECT * FROM rule_systems WHERE system_id=?`, [id]);
    if (!sys) return reply.code(404).send({ error: 'not_found' });
    const syncCfg = safeJson<{ apiUrl?: string }>(sys.sync_config, {});
    if (!syncCfg.apiUrl) {
      return reply.code(400).send({ error: 'no_sync_url', message: '该系统未配置同步 API 地址' });
    }
    // For now: validate connectivity and return status
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(syncCfg.apiUrl, { method: 'HEAD', signal: ac.signal });
      clearTimeout(tid);
      await store.run(`UPDATE rule_systems SET last_sync_at=datetime('now'), updated_at=datetime('now') WHERE system_id=?`, [id]);
      return { ok: true, status: res.status, message: `连接成功 HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? 'connection_failed' };
    }
  });
}

function serializeSystem(s: any, ruleCount: number) {
  return {
    systemId: s.system_id,
    systemName: s.system_name,
    systemType: s.system_type ?? 'manual',
    syncConfig: safeJson<Record<string, unknown>>(s.sync_config, {}),
    ruleCount,
    lastSyncAt: s.last_sync_at,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  };
}

function serializeRule(r: any) {
  return {
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    ruleType: r.rule_type,
    bizType: r.biz_type,
    riskLevel: r.risk_level,
    status: r.status
  };
}

function safeJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
