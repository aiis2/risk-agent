import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StorageBackendRegistry, DreamTaskRunner, type RunSnapshot } from '@risk-agent/core';
import { ScheduledRunService } from '../ScheduledRunService.js';

async function waitFor(condition: () => Promise<boolean>, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition not met in time');
}

describe('ScheduledRunService', () => {
  it('creates a scheduled run and computes the next cron fire time', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-scheduled-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const dreamRunner = new DreamTaskRunner();
      const service = new ScheduledRunService(
        storage.getStructuredStore(),
        dreamRunner,
        {
          createRun: vi.fn(),
        },
        { now: () => '2026-05-01T10:00:00.000Z' },
      );

      await service.initialize();
      const schedule = await service.createSchedule({
        name: 'Every five minutes risk digest',
        cron: '*/5 * * * *',
        taskKind: 'general',
        input: {
          prompt: '整理最近五分钟新增的风险事件',
        },
        preferredModel: 'model-default',
      });

      expect(schedule.name).toBe('Every five minutes risk digest');
      expect(schedule.nextRunAt).toBe('2026-05-01T10:05:00.000Z');
      expect(schedule.enabled).toBe(true);
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('dispatches due schedules through DreamTaskRunner and stores the triggered run id', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-scheduled-runs-'));
    let storage: StorageBackendRegistry | undefined;
    let now = '2026-05-01T10:00:00.000Z';

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const dreamRunner = new DreamTaskRunner();
      const createRun = vi.fn<
        (input: { taskKind?: 'analysis' | 'general' | 'knowledge-query' | 'skill-management'; input: Record<string, unknown>; preferredModel?: string }) => Promise<RunSnapshot>
      >().mockImplementation(async ({ taskKind, input }) => ({
        runId: 'run_scheduled_1',
        taskKind: taskKind ?? 'general',
        status: 'created',
        input,
        routing: {
          requestedTaskKind: taskKind,
          acceptedTaskKind: taskKind ?? 'general',
          confidence: 1,
          reason: 'scheduled_test',
          routeParams: {},
        },
        metrics: {
          turnCount: 0,
          toolCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
        createdAt: now,
        updatedAt: now,
      }));

      const service = new ScheduledRunService(
        storage.getStructuredStore(),
        dreamRunner,
        { createRun },
        { now: () => now },
      );

      await service.initialize();
      const schedule = await service.createSchedule({
        name: 'Minute-by-minute login review',
        cron: '* * * * *',
        taskKind: 'analysis',
        input: {
          prompt: '分析最新一分钟的异常登录风险',
        },
      });

      now = '2026-05-01T10:01:00.000Z';
      await service.dispatchDueSchedules();

      await waitFor(async () => {
        const next = await service.getSchedule(schedule.scheduleId);
        return Boolean(next?.lastRunId) && next?.lastStatus === 'completed';
      });

      expect(createRun).toHaveBeenCalledWith({
        taskKind: 'analysis',
        input: {
          prompt: '分析最新一分钟的异常登录风险',
        },
        preferredModel: undefined,
      });

      const updated = await service.getSchedule(schedule.scheduleId);
      expect(updated).toMatchObject({
        scheduleId: schedule.scheduleId,
        lastRunId: 'run_scheduled_1',
        lastStatus: 'completed',
        nextRunAt: '2026-05-01T10:02:00.000Z',
      });
      expect(updated?.lastTaskId).toMatch(/^d[0-9a-f]{8}$/);
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
