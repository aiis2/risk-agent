/**
 * Custom Agents API Routes — v3.3 自定义代理发现接口
 * (agent-framework.md §29)
 *
 * GET /api/custom-agents         — 列出所有已发现的自定义代理
 * GET /api/custom-agents/:name   — 获取单个代理详情
 */

import type { FastifyInstance } from 'fastify';
import { CustomAgentLoader } from '@risk-agent/core';
import { join } from 'node:path';
import type { AppContext } from '../index.js';

export function registerCustomAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const loader = new CustomAgentLoader({
    projectDir: process.cwd(),
    systemAgentsDir: ctx.config.dataDir ? join(ctx.config.dataDir, 'agents') : undefined,
  });

  // GET /api/custom-agents — list all discovered custom agents
  app.get('/api/custom-agents', async () => {
    const agents = loader.load();
    // Omit systemPrompt from list view (can be large)
    const summary = agents.map(({ systemPrompt: _sp, ...rest }) => rest);
    return { success: true, data: summary };
  });

  // GET /api/custom-agents/:name — get single agent detail (includes systemPrompt)
  app.get<{ Params: { name: string } }>('/api/custom-agents/:name', async (req, reply) => {
    const agent = loader.find(req.params.name);
    if (!agent) {
      return reply.status(404).send({ success: false, error: `Custom agent not found: ${req.params.name}` });
    }
    return { success: true, data: agent };
  });
}
