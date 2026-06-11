import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  domain: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  dataSources: z.array(z.string()).optional(),
  documents: z.array(z.string()).optional(),
  manualNotes: z.string().optional()
});

export function registerScenarioRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.get('/api/scenarios', async () => {
    const rows = await store.all<any>(`SELECT * FROM business_scenarios ORDER BY updated_at DESC`);
    return rows.map(serialize);
  });

  app.get('/api/scenarios/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return serialize(row);
  });

  app.post('/api/scenarios', async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const id = randomUUID();
    const d = parsed.data;
    await store.run(
      `INSERT INTO business_scenarios(scenario_id, name, description, domain, status, data_sources, documents, manual_notes)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        d.name,
        d.description ?? null,
        d.domain ?? null,
        d.status ?? 'draft',
        JSON.stringify(d.dataSources ?? []),
        JSON.stringify(d.documents ?? []),
        d.manualNotes ?? null
      ]
    );
    const row = await store.get<any>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    reply.code(201).send(serialize(row));
  });

  app.put('/api/scenarios/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const current = await store.get<any>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    if (!current) return reply.code(404).send({ error: 'not_found' });
    const d = parsed.data;
    await store.run(
      `UPDATE business_scenarios SET
        name=COALESCE(?, name),
        description=COALESCE(?, description),
        domain=COALESCE(?, domain),
        status=COALESCE(?, status),
        data_sources=COALESCE(?, data_sources),
        documents=COALESCE(?, documents),
        manual_notes=COALESCE(?, manual_notes),
        updated_at=datetime('now')
       WHERE scenario_id=?`,
      [
        d.name ?? null,
        d.description ?? null,
        d.domain ?? null,
        d.status ?? null,
        d.dataSources ? JSON.stringify(d.dataSources) : null,
        d.documents ? JSON.stringify(d.documents) : null,
        d.manualNotes ?? null,
        id
      ]
    );
    const row = await store.get<any>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    return serialize(row);
  });

  app.delete('/api/scenarios/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await store.run(`DELETE FROM business_scenarios WHERE scenario_id=?`, [id]);
    reply.code(204).send();
  });
}

function serialize(r: any) {
  if (!r) return null;
  return {
    scenarioId: r.scenario_id,
    name: r.name,
    description: r.description,
    domain: r.domain,
    status: r.status,
    version: r.version,
    dataSources: safeJson(r.data_sources, []),
    documents: safeJson(r.documents, []),
    manualNotes: r.manual_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
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
