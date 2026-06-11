import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const RelationSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.enum(['derived_from', 'covers', 'conflicts_with', 'replaces', 'references']),
  attributes: z.record(z.unknown()).optional()
});

export function registerLineageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const lineage = ctx.storage.getLineageStore();
  const store = ctx.storage.getStructuredStore();

  app.get('/api/lineage', async () => {
    const data = await lineage.listAll();
    return data;
  });

  app.post('/api/lineage/nodes', async (req) => {
    const body = (req.body ?? {}) as { id: string; label?: string; attributes?: Record<string, unknown> };
    await lineage.upsertRuleNode({ id: body.id ?? randomUUID(), label: body.label, attributes: body.attributes });
    return { ok: true };
  });

  app.post('/api/lineage/relations', async (req, reply) => {
    const parsed = RelationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const d = parsed.data;
    await lineage.upsertRelation({ source: d.source, target: d.target, relation: d.relation, attributes: d.attributes });
    await store.run(
      `INSERT INTO rule_lineage(lineage_id, source_rule, target_rule, relation, attributes) VALUES(?,?,?,?,?)`,
      [randomUUID(), d.source, d.target, d.relation, d.attributes ? JSON.stringify(d.attributes) : null]
    );
    return { ok: true };
  });

  app.get('/api/lineage/:id/ancestors', async (req) => {
    const { id } = req.params as { id: string };
    return { nodes: await lineage.getRuleAncestors(id) };
  });

  app.get('/api/lineage/:id/descendants', async (req) => {
    const { id } = req.params as { id: string };
    return { nodes: await lineage.getRuleDescendants(id) };
  });

  // ─── §5 新增：血缘链路 + 展示图 ─────────────────────────────────────────

  // GET /api/lineage/display?center=<id>&depth=<n>
  app.get('/api/lineage/display', async (req) => {
    const { center, depth } = (req.query ?? {}) as { center?: string; depth?: string };
    const d = depth ? Math.min(parseInt(depth, 10) || 3, 10) : 3;
    return lineage.toDisplayGraph(center, d);
  });

  // GET /api/lineage/:id/chain?direction=both|upstream|downstream
  app.get('/api/lineage/:id/chain', async (req) => {
    const { id } = req.params as { id: string };
    const { direction } = (req.query ?? {}) as { direction?: string };
    const dir = (direction === 'upstream' || direction === 'downstream') ? direction : 'both';
    return lineage.getLineageChain(id, dir);
  });

  // GET /api/lineage/by-relation/:relation
  app.get('/api/lineage/by-relation/:relation', async (req, reply) => {
    const { relation } = req.params as { relation: string };
    const validRelations = ['derived_from', 'covers', 'conflicts_with', 'replaces', 'references'];
    if (!validRelations.includes(relation)) return reply.code(400).send({ error: 'invalid_relation' });
    return { edges: await lineage.queryByRelation(relation as any) };
  });
}
