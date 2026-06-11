import { randomBytes, randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type {
  DreamTaskRunner,
  DreamTaskState,
  DreamTaskStatus,
  IStructuredStore,
  RunSnapshot,
  TaskKind,
} from '@risk-agent/core';

const SCHEDULED_RUNS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_runs (
  schedule_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  timezone TEXT,
  task_kind TEXT,
  input_json TEXT NOT NULL,
  preferred_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_triggered_at TEXT,
  last_run_id TEXT,
  last_task_id TEXT,
  last_status TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_runs_due ON scheduled_runs(enabled, next_run_at ASC);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task ON scheduled_runs(last_task_id);
`;

export interface ScheduledRunRecord {
  scheduleId: string;
  name: string;
  cron: string;
  timezone?: string;
  taskKind?: TaskKind;
  input: Record<string, unknown>;
  preferredModel?: string;
  enabled: boolean;
  nextRunAt?: string;
  lastTriggeredAt?: string;
  lastRunId?: string;
  lastTaskId?: string;
  lastStatus?: DreamTaskStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledRunInput {
  name: string;
  cron: string;
  timezone?: string;
  taskKind?: TaskKind;
  input: Record<string, unknown>;
  preferredModel?: string;
  enabled?: boolean;
}

export interface UpdateScheduledRunInput {
  name?: string;
  cron?: string;
  timezone?: string;
  taskKind?: TaskKind;
  input?: Record<string, unknown>;
  preferredModel?: string;
  enabled?: boolean;
}

export interface ScheduledRunLauncher {
  createRun(input: {
    taskKind?: TaskKind;
    input: Record<string, unknown>;
    preferredModel?: string;
  }): Promise<RunSnapshot>;
}

interface ScheduledRunServiceOptions {
  now?: () => string;
}

export class ScheduledRunService {
  private readonly now: () => string;
  private initialized = false;
  private listenersBound = false;

  constructor(
    private readonly store: IStructuredStore,
    private readonly dreamRunner: DreamTaskRunner,
    private readonly launcher: ScheduledRunLauncher,
    options: ScheduledRunServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.store.exec(SCHEDULED_RUNS_TABLE_SQL);
      this.initialized = true;
    }

    if (!this.listenersBound) {
      this.dreamRunner.on('completed', (state) => {
        void this.handleDreamTaskTerminalState(state);
      });
      this.dreamRunner.on('failed', (state) => {
        void this.handleDreamTaskTerminalState(state);
      });
      this.dreamRunner.on('cancelled', (state) => {
        void this.handleDreamTaskTerminalState(state);
      });
      this.listenersBound = true;
    }
  }

  async createSchedule(input: CreateScheduledRunInput): Promise<ScheduledRunRecord> {
    await this.initialize();

    const createdAt = this.now();
    const enabled = input.enabled ?? true;
    const scheduleId = `sched_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const nextRunAt = enabled ? computeNextRunAt(input.cron, createdAt, input.timezone) : undefined;

    await this.store.run(
      `INSERT INTO scheduled_runs(
        schedule_id, name, cron_expr, timezone, task_kind, input_json, preferred_model, enabled,
        next_run_at, last_triggered_at, last_run_id, last_task_id, last_status, last_error, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        scheduleId,
        input.name.trim(),
        input.cron.trim(),
        normalizeOptionalString(input.timezone),
        input.taskKind ?? null,
        JSON.stringify(input.input),
        normalizeOptionalString(input.preferredModel),
        enabled ? 1 : 0,
        nextRunAt ?? null,
        null,
        null,
        null,
        null,
        null,
        createdAt,
        createdAt,
      ],
    );

    return await this.getScheduleOrThrow(scheduleId);
  }

  async updateSchedule(scheduleId: string, patch: UpdateScheduledRunInput): Promise<ScheduledRunRecord> {
    await this.initialize();
    const existing = await this.getScheduleOrThrow(scheduleId);
    const updatedAt = this.now();
    const enabled = patch.enabled ?? existing.enabled;
    const cron = patch.cron?.trim() ?? existing.cron;
    const timezone = normalizeOptionalString(patch.timezone) ?? existing.timezone;
    const nextRunAt = enabled ? computeNextRunAt(cron, updatedAt, timezone) : undefined;

    await this.store.run(
      `UPDATE scheduled_runs
       SET name=?, cron_expr=?, timezone=?, task_kind=?, input_json=?, preferred_model=?, enabled=?, next_run_at=?, updated_at=?
       WHERE schedule_id=?`,
      [
        patch.name?.trim() ?? existing.name,
        cron,
        timezone ?? null,
        patch.taskKind ?? existing.taskKind ?? null,
        JSON.stringify(patch.input ?? existing.input),
        normalizeOptionalString(patch.preferredModel) ?? existing.preferredModel ?? null,
        enabled ? 1 : 0,
        nextRunAt ?? null,
        updatedAt,
        scheduleId,
      ],
    );

    return await this.getScheduleOrThrow(scheduleId);
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.initialize();
    await this.store.run(`DELETE FROM scheduled_runs WHERE schedule_id=?`, [scheduleId]);
  }

  async getSchedule(scheduleId: string): Promise<ScheduledRunRecord | null> {
    await this.initialize();
    const row = await this.store.get<Record<string, unknown>>(
      `SELECT * FROM scheduled_runs WHERE schedule_id=?`,
      [scheduleId],
    );
    return row ? toScheduledRunRecord(row) : null;
  }

  async listSchedules(): Promise<ScheduledRunRecord[]> {
    await this.initialize();
    const rows = await this.store.all<Record<string, unknown>>(
      `SELECT * FROM scheduled_runs ORDER BY created_at DESC`,
    );
    return rows.map(toScheduledRunRecord);
  }

  async triggerNow(scheduleId: string): Promise<ScheduledRunRecord> {
    await this.initialize();
    const schedule = await this.getScheduleOrThrow(scheduleId);
    await this.dispatchSchedule(schedule);
    return await this.getScheduleOrThrow(scheduleId);
  }

  async dispatchDueSchedules(): Promise<ScheduledRunRecord[]> {
    await this.initialize();
    const now = this.now();
    const activeTaskIds = new Set(
      this.dreamRunner
        .list()
        .filter((task) => task.status === 'queued' || task.status === 'running')
        .map((task) => task.id),
    );
    const dueRows = await this.store.all<Record<string, unknown>>(
      `SELECT * FROM scheduled_runs WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=? ORDER BY next_run_at ASC`,
      [now],
    );

    const dispatched: ScheduledRunRecord[] = [];
    for (const row of dueRows) {
      const schedule = toScheduledRunRecord(row);
      if (schedule.lastTaskId && activeTaskIds.has(schedule.lastTaskId)) {
        continue;
      }
      await this.dispatchSchedule(schedule);
      dispatched.push(await this.getScheduleOrThrow(schedule.scheduleId));
    }

    return dispatched;
  }

  private async dispatchSchedule(schedule: ScheduledRunRecord): Promise<void> {
    const triggeredAt = this.now();
    const taskId = `d${randomBytes(4).toString('hex')}`;
    const nextRunAt = schedule.enabled ? computeNextRunAt(schedule.cron, triggeredAt, schedule.timezone) : undefined;

    await this.store.run(
      `UPDATE scheduled_runs
       SET next_run_at=?, last_triggered_at=?, last_task_id=?, last_status=?, last_error=?, updated_at=?
       WHERE schedule_id=?`,
      [
        nextRunAt ?? null,
        triggeredAt,
        taskId,
        'queued',
        null,
        triggeredAt,
        schedule.scheduleId,
      ],
    );

    this.dreamRunner.submit({
      id: taskId,
      description: `Scheduled run: ${schedule.name}`,
      execute: async (_signal, onProgress) => {
        onProgress(`Triggering scheduled run ${schedule.name}`);
        const snapshot = await this.launcher.createRun({
          taskKind: schedule.taskKind,
          input: schedule.input,
          preferredModel: schedule.preferredModel,
        });
        await this.store.run(
          `UPDATE scheduled_runs SET last_run_id=?, updated_at=? WHERE schedule_id=?`,
          [snapshot.runId, this.now(), schedule.scheduleId],
        );
        return `Triggered run ${snapshot.runId}`;
      },
    });
  }

  private async handleDreamTaskTerminalState(state: DreamTaskState): Promise<void> {
    await this.initialize();
    await this.store.run(
      `UPDATE scheduled_runs SET last_status=?, last_error=?, updated_at=? WHERE last_task_id=?`,
      [
        state.status,
        state.status === 'failed' ? state.error ?? 'scheduled_run_failed' : null,
        this.now(),
        state.id,
      ],
    );
  }

  private async getScheduleOrThrow(scheduleId: string): Promise<ScheduledRunRecord> {
    const schedule = await this.getSchedule(scheduleId);
    if (!schedule) {
      throw new Error(`Scheduled run not found: ${scheduleId}`);
    }
    return schedule;
  }
}

function computeNextRunAt(cron: string, currentDate: string, timezone?: string): string {
  const interval = CronExpressionParser.parse(cron, {
    currentDate,
    ...(timezone ? { tz: timezone } : {}),
  });
  return cronDateToIsoString(interval.next());
}

function cronDateToIsoString(value: { toDate?: () => Date; toISOString?: () => string | null; toString(): string }): string {
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value.toISOString === 'function') {
    const iso = value.toISOString();
    if (iso) {
      return iso;
    }
  }
  return new Date(value.toString()).toISOString();
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function toScheduledRunRecord(row: Record<string, unknown>): ScheduledRunRecord {
  return {
    scheduleId: row.schedule_id as string,
    name: row.name as string,
    cron: row.cron_expr as string,
    timezone: normalizeOptionalString(row.timezone),
    taskKind: (row.task_kind as TaskKind | null) ?? undefined,
    input: JSON.parse(String(row.input_json ?? '{}')),
    preferredModel: normalizeOptionalString(row.preferred_model),
    enabled: Number(row.enabled ?? 0) === 1,
    nextRunAt: normalizeOptionalString(row.next_run_at),
    lastTriggeredAt: normalizeOptionalString(row.last_triggered_at),
    lastRunId: normalizeOptionalString(row.last_run_id),
    lastTaskId: normalizeOptionalString(row.last_task_id),
    lastStatus: normalizeOptionalString(row.last_status) as DreamTaskStatus | undefined,
    lastError: normalizeOptionalString(row.last_error),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}