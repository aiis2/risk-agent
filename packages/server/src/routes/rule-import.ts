import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const ImportSchema = z.object({
  source: z.string().default('manual'),
  rules: z
    .array(
      z.object({
        ruleName: z.string(),
        ruleCode: z.string().optional(),
        bizType: z.string().optional(),
        ruleType: z.string().optional(),
        riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        description: z.string().optional(),
        coverage: z.array(z.string()).optional()
      })
    )
    .min(1)
});

/**
 * 规则批量导入（02-risk-knowledge-base.md §8 / §11）
 *
 * 导入后自动：
 *  1. 创建规则血缘节点（Lineage Node）
 *  2. 写入 rule_lineage 关联来源
 *  3. 向量化规则文本（02-risk-knowledge-base.md §6.2），存入 VectorStore
 */
export function registerRuleImportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.post('/api/rule-import', async (req, reply) => {
    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const { source, rules } = parsed.data;
    const imported: string[] = [];

    for (const r of rules) {
      const id = randomUUID();
      await store.run(
        `INSERT INTO risk_rules(rule_id, rule_name, rule_code, biz_type, rule_type, risk_level, source, description, coverage_json, status)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          id,
          r.ruleName,
          r.ruleCode ?? null,
          r.bizType ?? null,
          r.ruleType ?? null,
          r.riskLevel ?? null,
          source,
          r.description ?? null,
          JSON.stringify(r.coverage ?? [])
        ]
      );
      imported.push(id);

      // §11 血缘节点自动注册（02-risk-knowledge-base.md §11）
      try {
        const lineage = ctx.storage.getLineageStore();
        await lineage.upsertRuleNode({
          id,
          label: r.ruleName,
          attributes: {
            bizType: r.bizType,
            ruleType: r.ruleType,
            riskLevel: r.riskLevel,
            source
          }
        });
        // 记录来源关联
        await store.run(
          `INSERT INTO rule_lineage(lineage_id, source_rule, target_rule, relation, attributes)
           VALUES(?, ?, ?, 'derived_from', ?)`,
          [randomUUID(), source, id, JSON.stringify({ importedAt: new Date().toISOString() })]
        );
      } catch {
        // 血缘写入非核心路径，失败不影响导入
      }

      // §6.2 规则向量化（TF-IDF 风格的轻量文本向量，02-risk-knowledge-base.md §6.2）
      // 使用 LanceDB 存储规则文本向量以支持后续语义相似搜索
      try {
        const vectorStore = ctx.storage.getVectorStore();
        const ruleText = [r.ruleName, r.bizType, r.ruleType, r.description, ...(r.coverage ?? [])]
          .filter(Boolean).join(' ');
        const vector = buildTextVector(ruleText);
        await vectorStore.upsert('rules', [{
          id,
          vector,
          text: ruleText,
          metadata: {
            ruleName: r.ruleName,
            bizType: r.bizType ?? null,
            ruleType: r.ruleType ?? null,
            riskLevel: r.riskLevel ?? null,
            source
          }
        }]);
      } catch {
        // 向量化非核心路径，失败不影响导入
      }
    }

    reply.code(201).send({ imported, count: imported.length });
  });
}

/**
 * 构建简单的文本特征向量（128维），用于 LanceDB 向量存储。
 * 生产环境应替换为 LLM embedding（text-embedding-3-small等）。
 * 此实现为 MVP：基于字符 hash 的 TF-IDF 近似向量。
 */
function buildTextVector(text: string): number[] {
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
  // L2 归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
