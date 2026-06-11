import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../index.js';
import { AppPreferencesPatchSchema, loadAppPreferences, savePreferencesPatch } from '../preferences/appPreferences.js';

export function registerPreferencesRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.get('/api/preferences', async () => {
    return loadAppPreferences(store);
  });

  app.put('/api/preferences', async (req, reply) => {
    const parsed = AppPreferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const preferences = await savePreferencesPatch(store, parsed.data);
    return { ok: true, preferences };
  });
}
