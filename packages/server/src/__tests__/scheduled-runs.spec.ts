import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';

async function waitFor(condition: () => Promise<boolean>, attempts = 40): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition not met in time');
}

describe('scheduled runs API', () => {
  it('creates, triggers, and exposes scheduled runs through the shared Dream Task runner', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-scheduled-runs-api-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-scheduled-runs',
          isDefault: true,
        },
      });
      expect(model.statusCode).toBe(201);

      const created = await app.inject({
        method: 'POST',
        url: '/api/scheduled-runs',
        payload: {
          name: 'Hourly payment risk digest',
          cron: '0 * * * *',
          taskKind: 'general',
          input: {
            prompt: '整理最近一小时的支付风险摘要',
          },
        },
      });

      expect(created.statusCode).toBe(201);
      const scheduleId = JSON.parse(created.body).scheduleId as string;

      const listed = await app.inject({ method: 'GET', url: '/api/scheduled-runs' });
      expect(listed.statusCode).toBe(200);
      expect(listed.body).toContain(scheduleId);

      const triggered = await app.inject({
        method: 'POST',
        url: `/api/scheduled-runs/${scheduleId}/trigger`,
      });
      expect(triggered.statusCode).toBe(202);

      await waitFor(async () => {
        const detail = await built.ctx.scheduledRunService.getSchedule(scheduleId);
        return Boolean(detail?.lastRunId) && detail?.lastStatus === 'completed';
      });

      const detail = await app.inject({ method: 'GET', url: `/api/scheduled-runs/${scheduleId}` });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body)).toMatchObject({
        scheduleId,
        lastStatus: 'completed',
      });

      const dreamTasks = await app.inject({ method: 'GET', url: '/api/dream-tasks' });
      expect(dreamTasks.statusCode).toBe(200);
      expect(dreamTasks.body).toContain('Scheduled run: Hourly payment risk digest');

      const runId = JSON.parse(detail.body).lastRunId as string;
      const runDetail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      expect(runDetail.statusCode).toBe(200);
      expect(JSON.parse(runDetail.body).taskKind).toBe('general');
    } finally {
      await app?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after Fastify shutdown.
      }
    }
  });
});