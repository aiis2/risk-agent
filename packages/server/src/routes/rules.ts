import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createRuleNlParseTool } from '@risk-agent/core';
import type { AppContext } from '../index.js';

const RuleSchema = z.object({
  ruleName: z.string().min(1),
  ruleCode: z.string().optional(),
  bizType: z.string().optional(),
  ruleType: z.string().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  source: z.string().optional(),
  description: z.string().optional(),
  conditions: z.unknown().optional(),
  actions: z.unknown().optional(),
  coverage: z.array(z.string()).optional(),
  status: z.enum(['active', 'draft', 'retired']).optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
  systemId: z.string().optional()
});

export function registerRuleRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.get('/api/rules', async (req) => {
    const { bizType, ruleType, q } = (req.query ?? {}) as { bizType?: string; ruleType?: string; q?: string };
    const conds: string[] = ['1=1'];
    const params: unknown[] = [];
    if (bizType) { conds.push('biz_type=?'); params.push(bizType); }
    if (ruleType) { conds.push('rule_type=?'); params.push(ruleType); }
    if (q) { conds.push('(rule_name LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const rows = await store.all<any>(`SELECT * FROM risk_rules WHERE ${conds.join(' AND ')} ORDER BY synced_at DESC`, params);
    return rows.map(serialize);
  });

  app.get('/api/rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return serialize(row);
  });

  app.post('/api/rules', async (req, reply) => {
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const id = randomUUID();
    const d = parsed.data;
    await store.run(
      `INSERT INTO risk_rules(rule_id, rule_name, rule_code, biz_type, rule_type, conditions_json, actions_json, coverage_json, risk_level, source, description, status, effective_from, effective_to)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        d.ruleName,
        d.ruleCode ?? null,
        d.bizType ?? null,
        d.ruleType ?? null,
        d.conditions ? JSON.stringify(d.conditions) : null,
        d.actions ? JSON.stringify(d.actions) : null,
        JSON.stringify(d.coverage ?? []),
        d.riskLevel ?? null,
        d.source ?? null,
        d.description ?? null,
        d.status ?? 'active',
        d.effectiveFrom ?? null,
        d.effectiveTo ?? null
      ]
    );
    const row = await store.get<any>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    reply.code(201).send(serialize(row));
  });

  app.put('/api/rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = RuleSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const current = await store.get<any>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const d = parsed.data;
    await store.run(
      `UPDATE risk_rules SET
        rule_name=COALESCE(?, rule_name),
        rule_code=COALESCE(?, rule_code),
        biz_type=COALESCE(?, biz_type),
        rule_type=COALESCE(?, rule_type),
        risk_level=COALESCE(?, risk_level),
        source=COALESCE(?, source),
        description=COALESCE(?, description),
        conditions_json=COALESCE(?, conditions_json),
        actions_json=COALESCE(?, actions_json),
        coverage_json=COALESCE(?, coverage_json),
        status=COALESCE(?, status),
        effective_from=COALESCE(?, effective_from),
        effective_to=COALESCE(?, effective_to),
        synced_at=datetime('now')
       WHERE rule_id=?`,
      [
        d.ruleName ?? null,
        d.ruleCode ?? null,
        d.bizType ?? null,
        d.ruleType ?? null,
        d.riskLevel ?? null,
        d.source ?? null,
        d.description ?? null,
        d.conditions != null ? JSON.stringify(d.conditions) : null,
        d.actions != null ? JSON.stringify(d.actions) : null,
        d.coverage ? JSON.stringify(d.coverage) : null,
        d.status ?? null,
        d.effectiveFrom ?? null,
        d.effectiveTo ?? null,
        id
      ]
    );
    const row = await store.get<any>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    return serialize(row);
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await store.run(`DELETE FROM risk_rules WHERE rule_id=?`, [id]);
    reply.code(204).send();
  });

  // GET /api/rules/dimension/:dim — find rules covering a specific risk dimension
  app.get('/api/rules/dimension/:dim', async (req) => {
    const { dim } = req.params as { dim: string };
    // coverage_json stores an array of strings; search for the dimension
    const rows = await store.all<any>(
      `SELECT * FROM risk_rules WHERE status='active' AND coverage_json LIKE ? ORDER BY synced_at DESC`,
      [`%${dim}%`]
    );
    return rows.map(serialize);
  });

  // GET /api/rules/coverage-matrix/:bizType — get coverage matrix for a biz type
  app.get('/api/rules/coverage-matrix/:bizType', async (req) => {
    const { bizType } = req.params as { bizType: string };
    const rows = await store.all<any>(
      `SELECT * FROM risk_rules WHERE biz_type=? AND status='active' ORDER BY rule_type, synced_at DESC`,
      [bizType]
    );
    // Group by rule_type and aggregate coverage dimensions
    const byType: Record<string, { ruleType: string; count: number; dimensions: string[]; rules: ReturnType<typeof serialize>[] }> = {};
    const allDimensions = new Set<string>();
    for (const row of rows) {
      const rt = row.rule_type ?? 'unknown';
      if (!byType[rt]) byType[rt] = { ruleType: rt, count: 0, dimensions: [], rules: [] };
      byType[rt].count++;
      byType[rt].rules.push(serialize(row)!);
      const cov: string[] = safeJson(row.coverage_json, []);
      cov.forEach((d) => { byType[rt].dimensions.push(d); allDimensions.add(d); });
    }
    // Deduplicate dimensions per type
    for (const v of Object.values(byType)) {
      v.dimensions = [...new Set(v.dimensions)];
    }
    return {
      bizType,
      totalRules: rows.length,
      dimensions: [...allDimensions],
      byRuleType: Object.values(byType)
    };
  });

  // 自然语言/正则文本解析为规则候选
  app.post('/api/rule-import/parse-text', async (req, reply) => {
    const schema = z.object({
      text: z.string().min(1),
      useLLM: z.boolean().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    let llm;
    try {
      const { buildLLMAdapter } = await import('../llm/factory.js');
      llm = buildLLMAdapter();
    } catch {
      llm = undefined;
    }
    const tool = createRuleNlParseTool(llm);
    const out = (await tool.execute(
      { text: parsed.data.text, useLLM: parsed.data.useLLM },
      { sessionId: 'rule-import' }
    )) as { source: string; candidates: unknown[] };
    return out;
  });

  // 从候选列表批量入库（前端确认后调用）
  app.post('/api/rule-import/commit', async (req, reply) => {
    const schema = z.object({ candidates: z.array(RuleSchema).min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const ids: string[] = [];
    for (const d of parsed.data.candidates) {
      const id = randomUUID();
      await store.run(
        `INSERT INTO risk_rules(rule_id, rule_name, rule_code, biz_type, rule_type, conditions_json, actions_json, coverage_json, risk_level, source, description, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          d.ruleName,
          d.ruleCode ?? null,
          d.bizType ?? null,
          d.ruleType ?? null,
          d.conditions ? JSON.stringify(d.conditions) : null,
          d.actions ? JSON.stringify(d.actions) : null,
          JSON.stringify(d.coverage ?? []),
          d.riskLevel ?? null,
          d.source ?? 'nl-import',
          d.description ?? null,
          d.status ?? 'draft'
        ]
      );
      ids.push(id);
    }
    reply.code(201).send({ imported: ids.length, ruleIds: ids });
  });

  /**
   * GET /api/rules/similar — 语义相似规则检索（02-risk-knowledge-base.md §7.2）
   *
   * 使用 VectorStore 查询与目标规则文本最相似的规则。
   * Query params:
   *   - q: 查询文本（规则名称/描述）
   *   - ruleId: 以某条规则为基准查询相似规则
   *   - topK: 返回数量，默认 5
   */
  app.get('/api/rules/similar', async (req, reply) => {
    const { q, ruleId, topK } = (req.query ?? {}) as { q?: string; ruleId?: string; topK?: string };
    const k = Math.min(20, Math.max(1, parseInt(topK ?? '5', 10) || 5));

    let queryText: string;
    if (ruleId) {
      const row = await store.get<any>(`SELECT * FROM risk_rules WHERE rule_id=?`, [ruleId]);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      queryText = [row.rule_name, row.biz_type, row.rule_type, row.description].filter(Boolean).join(' ');
    } else if (q) {
      queryText = q;
    } else {
      return reply.code(400).send({ error: 'provide q or ruleId' });
    }

    const queryVector = buildSimilarityVector(queryText);

    try {
      const vectorStore = ctx.storage.getVectorStore();
      const hits = await vectorStore.query('rules', queryVector, k + 1);
      // 过滤掉自身
      const filtered = hits.filter((h) => h.id !== ruleId).slice(0, k);
      if (!filtered.length) return [];

      const ids = filtered.map((h) => h.id);
      const placeholders = ids.map(() => '?').join(',');
      const rows = await store.all<any>(`SELECT * FROM risk_rules WHERE rule_id IN (${placeholders})`, ids);
      // 按向量距离排序
      const scoreMap = new Map(filtered.map((h) => [h.id, h.score]));
      const sorted = rows.sort((a: any, b: any) => (scoreMap.get(b.rule_id) ?? 0) - (scoreMap.get(a.rule_id) ?? 0));
      return sorted.map((r: any) => ({ ...serialize(r), similarityScore: scoreMap.get(r.rule_id) ?? 0 }));
    } catch {
      // VectorStore 未初始化或无向量数据时，降级到文本 LIKE 搜索
      const words = queryText.split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const first = words[0];
      const rows = await store.all<any>(
        `SELECT * FROM risk_rules WHERE rule_name LIKE ? OR description LIKE ? ORDER BY synced_at DESC LIMIT ?`,
        [`%${first}%`, `%${first}%`, k]
      );
      return rows.map((r: any) => ({ ...serialize(r), similarityScore: 0 }));
    }
  });
}

/** 与 rule-import.ts 中保持一致的文本向量构建（128维 TF-IDF 近似）*/
function buildSimilarityVector(text: string): number[] {
  const DIM = 128;
  const vec = new Array<number>(DIM).fill(0);
  const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    let hash = 5381;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) + hash) ^ token.charCodeAt(i);
      hash = hash >>> 0;
    }
    const idx = hash % DIM;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function serialize(r: any) {
  if (!r) return null;
  return {
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    ruleCode: r.rule_code,
    bizType: r.biz_type,
    ruleType: r.rule_type,
    riskLevel: r.risk_level,
    source: r.source,
    description: r.description,
    coverage: safeJson(r.coverage_json, []),
    conditions: safeJson(r.conditions_json, null),
    actions: safeJson(r.actions_json, null),
    status: r.status,
    systemId: r.system_id ?? null,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    syncedAt: r.synced_at
  };
}

function safeJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
