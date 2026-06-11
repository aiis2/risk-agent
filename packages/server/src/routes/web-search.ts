import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../index.js';
import { WebSearchService } from '../services/WebSearchService.js';

const WebSearchRequestSchema = z.object({
  query: z.string().trim().min(1),
  provider: z.string().trim().optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export function registerWebSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const service = new WebSearchService(ctx.storage.getStructuredStore());

  app.post('/api/web-search/test', async (req, reply) => {
    const parsed = WebSearchRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    try {
      const data = await service.search(parsed.data.query, {
        provider: parsed.data.provider,
        limit: parsed.data.limit,
      });
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'web_search_failed';
      const statusCode = message.includes('missing') || message.includes('unsupported') || message.includes('disabled')
        ? 400
        : 502;
      return reply.code(statusCode).send({ error: 'web_search_failed', detail: message });
    }
  });
}