/**
 * Dream Tasks API Routes — v3.3 后台异步任务管理接口
 * (agent-framework.md §30)
 *
 * GET  /api/dream-tasks           — 列出所有 Dream Task
 * GET  /api/dream-tasks/:id       — 获取单个 Dream Task 状态
 * DELETE /api/dream-tasks/:id     — 取消 Dream Task
 * POST /api/dream-tasks/cleanup   — 清理已完成任务
 */

import type { FastifyInstance } from 'fastify';
import { DreamTaskRunner } from '@risk-agent/core';
import type { AppContext } from '../index.js';

export function registerDreamTaskRoutes(app: FastifyInstance, ctx: AppContext): void {
  const runner: DreamTaskRunner = ctx.dreamTaskRunner;

  // GET /api/dream-tasks — list all dream tasks (optionally filtered by status)
  app.get<{ Querystring: { status?: string } }>('/api/dream-tasks', async (req) => {
    const filter = req.query.status as import('@risk-agent/core').DreamTaskStatus | undefined;
    const tasks = runner.list(filter);
    return { success: true, data: tasks };
  });

  // GET /api/dream-tasks/:id — get single task state
  app.get<{ Params: { id: string } }>('/api/dream-tasks/:id', async (req, reply) => {
    const state = runner.getState(req.params.id);
    if (!state) {
      return reply.status(404).send({ success: false, error: `Dream Task not found: ${req.params.id}` });
    }
    return { success: true, data: state };
  });

  // DELETE /api/dream-tasks/:id — cancel task
  app.delete<{ Params: { id: string } }>('/api/dream-tasks/:id', async (req, reply) => {
    const cancelled = runner.cancel(req.params.id);
    if (!cancelled) {
      return reply.status(404).send({ success: false, error: `Dream Task not found or already terminal: ${req.params.id}` });
    }
    return { success: true };
  });

  // POST /api/dream-tasks/cleanup — clean up completed/failed/cancelled tasks
  app.post('/api/dream-tasks/cleanup', async () => {
    const removed = runner.cleanup();
    return { success: true, data: { removed } };
  });
}
