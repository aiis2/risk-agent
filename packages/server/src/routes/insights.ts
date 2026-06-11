/**
 * A4 Insights + Session Search API routes
 *
 * GET  /api/insights                  — 最近记忆洞察汇总（?days=30）
 * GET  /api/sessions/search           — FTS5 记忆搜索（?q=xxx&days=0&category=&limit=20）
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SessionSearchService } from '../services/SessionSearchService.js';
import { InsightsService } from '../services/InsightsService.js';
import type { StorageBackendRegistry } from '@risk-agent/core';

function makeDbAdapter(storage: StorageBackendRegistry) {
  const store = storage.getStructuredStore();
  return {
    all: <T = unknown>(sql: string, params?: unknown[]) =>
      store.all<T>(sql, params as any[]),
    run: (sql: string, params?: unknown[]) =>
      store.run(sql, params as any[]),
  };
}

export async function registerInsightsRoutes(
  app: FastifyInstance,
  storage: StorageBackendRegistry,
): Promise<void> {
  const dbAdapter = makeDbAdapter(storage);
  const searchService = new SessionSearchService({ db: dbAdapter });
  const insightsService = new InsightsService({ db: dbAdapter });

  // ─── GET /api/insights ────────────────────────────────────────────────────
  const insightsQuerySchema = z.object({
    days: z.coerce.number().int().min(0).max(365).optional().default(30),
  });

  app.get('/api/insights', async (req, reply) => {
    const parsed = insightsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params', details: parsed.error.flatten() });
    }
    const summary = await insightsService.getRecentInsights(parsed.data.days);
    return reply.send(summary);
  });

  // ─── GET /api/sessions/search ─────────────────────────────────────────────
  const searchQuerySchema = z.object({
    q: z.string().min(1).max(200),
    days: z.coerce.number().int().min(0).max(365).optional().default(0),
    category: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  });

  app.get('/api/sessions/search', async (req, reply) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params', details: parsed.error.flatten() });
    }
    const { q, days, category, limit } = parsed.data;
    const results = await searchService.searchMemoryFacts({ query: q, category, days, limit });
    // 记录使用次数（异步，不阻塞响应）
    void searchService.recordFactUsage(results.map((r) => r.fact_id));
    return reply.send({ query: q, total: results.length, results });
  });
}
