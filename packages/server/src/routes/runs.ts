import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const CreateRunSchema = z.object({
  taskKind: z.enum(['analysis', 'general', 'knowledge-query', 'skill-management']).optional(),
  input: z.record(z.unknown()),
  uiContext: z.record(z.unknown()).optional(),
  preferredModel: z.string().optional(),
  surface: z.string().optional(),
  approvalMode: z.enum(['default', 'bypass', 'autopilot']).optional(),
});

const FollowUpRunSchema = z.object({
  content: z.string().trim().min(1),
  modelId: z.string().trim().optional(),
  attachmentIds: z.array(z.string().trim().min(1)).optional(),
  toolIds: z.array(z.string().trim().min(1)).optional(),
  mode: z.enum(['stop-and-send', 'queue', 'steer']).optional(),
  approvalMode: z.enum(['default', 'bypass', 'autopilot']).optional(),
});

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/runs', async () => {
    return ctx.runService.listRuns();
  });

  app.post('/api/runs', async (req, reply) => {
    const parsed = CreateRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    const snapshot = await ctx.runService.createRun({
      taskKind: parsed.data.taskKind,
      input: {
        ...parsed.data.input,
        // Inject approvalMode into the input so GeneralTaskPack can read it
        ...(parsed.data.approvalMode ? { approvalMode: parsed.data.approvalMode } : {}),
      },
      preferredModel: parsed.data.preferredModel,
      surface: parsed.data.surface,
    });
    const initialCapabilityProfile = snapshot.routing.initialCapabilityProfile
      ?? snapshot.routing.acceptedTaskKind
      ?? snapshot.taskKind;
    return reply.code(201).send({
      runId: snapshot.runId,
      status: snapshot.status,
      taskKind: snapshot.taskKind,
      acceptedTaskKind: initialCapabilityProfile,
      agentMode: snapshot.routing.agentMode ?? 'task-pack',
      initialCapabilityProfile,
      initialCheckpoint: null,
    });
  });

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = await ctx.runService.getRun(id);
    if (!snapshot) return reply.code(404).send({ error: 'not_found' });
    return snapshot;
  });

  app.get('/api/runs/:id/stream', async (req, reply) => {
    return ctx.runService.attachSse(req, reply);
  });

  app.post('/api/runs/:id/input', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'validation_failed' });
    }
    return reply.send(await ctx.runService.submitInput(id, body as Record<string, unknown>));
  });

  app.post('/api/runs/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = FollowUpRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    try {
      const result = await ctx.runService.appendMessage(id, {
        ...parsed.data,
        approvalMode: parsed.data.approvalMode,
      });
      return reply.code(201).send({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'append_run_message_failed';
      if (message.includes('Run not found')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (message === 'content_required') {
        return reply.code(400).send({ error: 'validation_failed' });
      }
      app.log.error({ runId: id, err: error }, 'append_run_message_failed');
      return reply.code(500).send({ error: 'append_run_message_failed' });
    }
  });

  app.post('/api/runs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.runService.cancel(id);
    return reply.send({ ok: true });
  });

  app.get('/api/runs/:id/artifacts', async (req) => {
    const { id } = req.params as { id: string };
    const { RunRepositories } = await import('../runs/RunRepositories.js');
    const repos = new RunRepositories(ctx.storage.getStructuredStore());
    return repos.listArtifacts(id);
  });

  app.get('/api/runs/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    const { RunRepositories } = await import('../runs/RunRepositories.js');
    const repos = new RunRepositories(ctx.storage.getStructuredStore());
    return repos.listEvents(id);
  });
}
