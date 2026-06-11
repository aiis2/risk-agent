import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const TaskKindSchema = z.enum(['analysis', 'general', 'knowledge-query', 'skill-management']);

const CreateScheduledRunSchema = z.object({
  name: z.string().trim().min(1),
  cron: z.string().trim().min(1),
  timezone: z.string().trim().optional(),
  taskKind: TaskKindSchema.optional(),
  input: z.record(z.unknown()),
  preferredModel: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

const UpdateScheduledRunSchema = z.object({
  name: z.string().trim().min(1).optional(),
  cron: z.string().trim().min(1).optional(),
  timezone: z.string().trim().optional(),
  taskKind: TaskKindSchema.optional(),
  input: z.record(z.unknown()).optional(),
  preferredModel: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

export function registerScheduledRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/scheduled-runs', async () => {
    return ctx.scheduledRunService.listSchedules();
  });

  app.get('/api/scheduled-runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const schedule = await ctx.scheduledRunService.getSchedule(id);
    if (!schedule) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return schedule;
  });

  app.post('/api/scheduled-runs', async (req, reply) => {
    const parsed = CreateScheduledRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    try {
      const created = await ctx.scheduledRunService.createSchedule(parsed.data);
      return reply.code(201).send(created);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'scheduled_run_create_failed';
      return reply.code(400).send({ error: 'scheduled_run_create_failed', detail });
    }
  });

  app.patch('/api/scheduled-runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateScheduledRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    try {
      const updated = await ctx.scheduledRunService.updateSchedule(id, parsed.data);
      return updated;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'scheduled_run_update_failed';
      const statusCode = detail.includes('not found') ? 404 : 400;
      return reply.code(statusCode).send({ error: 'scheduled_run_update_failed', detail });
    }
  });

  app.delete('/api/scheduled-runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.scheduledRunService.deleteSchedule(id);
    return reply.code(204).send();
  });

  app.post('/api/scheduled-runs/:id/trigger', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const updated = await ctx.scheduledRunService.triggerNow(id);
      return reply.code(202).send(updated);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'scheduled_run_trigger_failed';
      const statusCode = detail.includes('not found') ? 404 : 400;
      return reply.code(statusCode).send({ error: 'scheduled_run_trigger_failed', detail });
    }
  });
}