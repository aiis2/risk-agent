import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PersonaService } from '@risk-agent/core';
import type { AppContext } from '../index.js';

const ScopeEnum = z.enum(['general', 'analysis', 'knowledge-query', 'skill-management', 'data-analysis']);

const TraitsSchema = z
  .object({
    tone: z.string().optional(),
    style: z.string().optional(),
    expertise: z.array(z.string()).optional(),
    languagePref: z.string().optional(),
  })
  .partial()
  .optional();

const UpsertSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  scope: ScopeEnum.optional(),
  traits: TraitsSchema,
  parentId: z.string().optional(),
  enabled: z.boolean().optional(),
});

const PatchSchema = UpsertSchema.partial();

const ApplyToSessionSchema = z.object({
  personaId: z.string(),
  source: z.enum(['user', 'auto', 'fallback']).optional(),
});

export function registerPersonaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();
  const dbAdapter = {
    run: async (sql: string, params?: unknown[]) => {
      await store.run(sql, params);
    },
    all: async <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params),
  };
  const service = new PersonaService(dbAdapter);
  // 启动时同步执行一次内置注入（幂等）
  void service.ensureBuiltins().catch(() => undefined);

  app.get('/api/personas', async () => {
    await service.ensureBuiltins().catch(() => undefined);
    const items = await service.list();
    return { items };
  });

  app.get('/api/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const persona = await service.get(id);
    if (!persona) return reply.code(404).send({ error: 'not_found' });
    return persona;
  });

  app.post('/api/personas', async (req, reply) => {
    const parsed = UpsertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    try {
      const persona = await service.create(parsed.data);
      return reply.code(201).send(persona);
    } catch (err: any) {
      return reply.code(400).send({ error: 'create_failed', message: err?.message ?? 'unknown' });
    }
  });

  app.patch('/api/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    try {
      const persona = await service.update(id, parsed.data);
      return persona;
    } catch (err: any) {
      const code = /built-?in/i.test(err?.message ?? '') ? 403 : 400;
      return reply.code(code).send({ error: 'update_failed', message: err?.message ?? 'unknown' });
    }
  });

  app.post('/api/personas/:id/fork', async (req, reply) => {
    const { id } = req.params as { id: string };
    const overrides = (req.body ?? {}) as Record<string, unknown>;
    try {
      const persona = await service.fork(id, overrides as any);
      return reply.code(201).send(persona);
    } catch (err: any) {
      return reply.code(400).send({ error: 'fork_failed', message: err?.message ?? 'unknown' });
    }
  });

  app.delete('/api/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await service.delete(id);
      return reply.code(204).send();
    } catch (err: any) {
      const code = /built-?in/i.test(err?.message ?? '') ? 403 : 400;
      return reply.code(code).send({ error: 'delete_failed', message: err?.message ?? 'unknown' });
    }
  });

  // 把 persona 应用到 session
  app.post('/api/sessions/:sessionId/persona', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const parsed = ApplyToSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    try {
      await service.setSessionPersona(sessionId, parsed.data.personaId, parsed.data.source ?? 'user');
      const persona = await service.get(parsed.data.personaId);
      return { ok: true, persona };
    } catch (err: any) {
      return reply.code(400).send({ error: 'apply_failed', message: err?.message ?? 'unknown' });
    }
  });

  app.get('/api/sessions/:sessionId/persona', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const persona = await service.getSessionPersona(sessionId);
    if (!persona) return reply.code(204).send();
    return persona;
  });
}
