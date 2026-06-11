import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserProfileService } from '@risk-agent/core';
import type { AppContext } from '../index.js';

const TraitsSchema = z
  .object({
    industry: z.string().optional(),
    role: z.string().optional(),
    expertise: z.array(z.string()).optional(),
    timezone: z.string().optional(),
  })
  .partial()
  .optional();

const PreferencesSchema = z
  .object({
    languagePref: z.string().optional(),
    verbosity: z.enum(['concise', 'detailed']).optional(),
    format: z.enum(['markdown', 'plain']).optional(),
  })
  .partial()
  .optional();

const PatchSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  traits: TraitsSchema,
  preferences: PreferencesSchema,
});

const FactsSchema = z.object({
  facts: z
    .array(
      z.object({
        key: z.string().optional(),
        value: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1),
});

export function registerUserProfileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();
  const dbAdapter = {
    run: async (sql: string, params?: unknown[]) => {
      await store.run(sql, params);
    },
    all: async <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params),
  };
  const service = new UserProfileService(dbAdapter);

  app.get('/api/user-profile', async () => {
    return service.getOrCreate();
  });

  app.patch('/api/user-profile', async (req, reply) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    return service.update('local-default', parsed.data);
  });

  app.post('/api/user-profile/facts', async (req, reply) => {
    const parsed = FactsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const updated = await service.mergeFacts('local-default', parsed.data.facts);
    return updated;
  });

  app.post('/api/user-profile/reset', async () => {
    return service.reset('local-default');
  });
}
