import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  HarnessRuntime,
  RunSnapshot,
  RunEvent,
  TaskKind,
  RoutingDecision,
  StorageBackendRegistry,
  RunArtifact,
  VerificationRecord,
} from '@risk-agent/core';
import { RunRouter, createLogger } from '@risk-agent/core';

const log = createLogger('RunService');
import type { FastifyRequest, FastifyReply } from 'fastify';
import { RunRepositories } from './RunRepositories.js';
import { MemoryCurator } from '../agents/MemoryCurator.js';
import { SessionAttachmentService } from '../services/SessionAttachmentService.js';
import { SkillPatternLearner } from '../skills/SkillPatternLearner.js';

interface LiveRun {
  emitter: EventEmitter;
  done: Promise<void>;
  abort: AbortController;
  history: RunEvent[];
  currentSnapshot: RunSnapshot;
  waitingForInput?: {
    requestId: string;
    question: string;
    options?: string[];
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  };
}

export interface AppendRunMessageInput {
  content: string;
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
  mode?: 'stop-and-send' | 'queue' | 'steer';
  approvalMode?: 'default' | 'bypass' | 'autopilot';
}

interface RunTurnEnvelopeRecord {
  kind: 'follow-up';
  userMessage: string;
  priorTaskKind: TaskKind;
  priorCapabilityProfile: TaskKind;
  requestedTaskKind?: TaskKind;
  attachmentIds?: string[];
  toolIds?: string[];
  approvalMode?: 'default' | 'bypass' | 'autopilot';
}

const TERMINAL_RUN_STATUSES = new Set<RunSnapshot['status']>(['completed', 'failed', 'cancelled']);

export class RunService {
  private readonly liveRuns = new Map<string, LiveRun>();
  private readonly backgroundWork = new Set<Promise<void>>();
  private readonly attachmentService: SessionAttachmentService;
  private readonly skillPatternLearner: SkillPatternLearner;

  constructor(
    private readonly storage: StorageBackendRegistry,
    private readonly runtimeFactory: (modelId?: string, surface?: string) => Promise<HarnessRuntime>,
  ) {
    this.attachmentService = new SessionAttachmentService(storage);
    this.skillPatternLearner = new SkillPatternLearner(storage);
  }

  async drainBackgroundWork(): Promise<void> {
    await Promise.allSettled([...this.backgroundWork]);
  }

  async getRun(runId: string): Promise<RunSnapshot | null> {
    const repos = new RunRepositories(this.storage.getStructuredStore());
    const snapshot = await repos.getRun(runId);
    if (!snapshot) {
      return null;
    }
    return this.reconcileDetachedTerminalState(repos, snapshot);
  }

  async listRuns(): Promise<RunSnapshot[]> {
    return new RunRepositories(this.storage.getStructuredStore()).listRuns();
  }

  async createRun(input: {
    taskKind?: TaskKind;
    input: Record<string, unknown>;
    preferredModel?: string;
    surface?: string;
  }): Promise<RunSnapshot> {
    const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const repos = new RunRepositories(this.storage.getStructuredStore());
    const createdAt = new Date().toISOString();
    const routerInput = {
      ...input.input,
      ...(input.surface ? { surface: input.surface } : {}),
    };
    const routing = new RunRouter().route({
      requestedTaskKind: input.taskKind,
      input: routerInput,
    });
    const normalizedInput = mergeDerivedInput(
      routerInput,
      routing.routeParams,
    );

    const snapshot: RunSnapshot = {
      runId,
      taskKind: resolveStoredRunTaskKind(routing),
      currentCapabilityProfile: routing.initialCapabilityProfile,
      status: 'created',
      input: normalizedInput,
      routing,
      metrics: {
        turnCount: 0,
        toolCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        estimatedUsd: 0,
      },
      createdAt,
      updatedAt: createdAt,
    };

    await repos.insertRun(snapshot);

    const createdEvent: RunEvent = {
      eventId: this.createUniqueEventId(runId, 'created'),
      runId,
      type: 'run_created',
      payload: buildCreatedEventPayload(snapshot),
      createdAt,
    };
    await repos.appendEvent(createdEvent);

    await this.launchExecution({
      runId,
      requestedTaskKind: input.taskKind,
      input: normalizedInput,
      preferredModel: input.preferredModel,
      surface: normalizeRunSurface(normalizedInput.surface),
      snapshot,
    });

    return snapshot;
  }

  async appendMessage(runId: string, input: AppendRunMessageInput): Promise<{
    runId: string;
    resumed: true;
    interrupted: boolean;
  }> {
    const trimmed = input.content.trim();
    if (!trimmed) {
      throw new Error('content_required');
    }

    const repos = new RunRepositories(this.storage.getStructuredStore());
    const existing = await repos.getRun(runId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }

    const activeHandle = this.liveRuns.get(runId);
    if (activeHandle) {
      activeHandle.waitingForInput?.reject(new Error('aborted by user'));
      activeHandle.abort.abort();
      await activeHandle.done.catch(() => undefined);
    }

    const createdAt = new Date().toISOString();
    const nextInput = this.mergeRunInput(existing, input);
    const nextSnapshot: RunSnapshot = {
      ...existing,
      status: 'created',
      terminationReason: undefined,
      input: nextInput,
      currentCheckpointId: undefined,
      latestArtifactId: undefined,
      verifierState: undefined,
      updatedAt: createdAt,
      completedAt: undefined,
    };
    await repos.updateRun(nextSnapshot);

    await repos.appendEvent({
      eventId: this.createUniqueEventId(runId, 'user_message'),
      runId,
      type: 'user_message',
      payload: {
        content: trimmed,
        attachmentIds: input.attachmentIds ?? [],
        toolIds: input.toolIds ?? [],
        mode: input.mode ?? 'stop-and-send',
      },
      createdAt,
    });

    await this.launchExecution({
      runId,
      requestedTaskKind: resolveContinuationRequestedTaskKind(existing, nextInput),
      input: nextInput,
      preferredModel: input.modelId,
      surface: normalizeRunSurface(nextInput.surface),
      snapshot: nextSnapshot,
    });

    return {
      runId,
      resumed: true,
      interrupted: Boolean(activeHandle),
    };
  }

  private async launchExecution(options: {
    runId: string;
    requestedTaskKind?: TaskKind;
    input: Record<string, unknown>;
    preferredModel?: string;
    surface?: string;
    snapshot: RunSnapshot;
  }): Promise<void> {
    const repos = new RunRepositories(this.storage.getStructuredStore());
    const emitter = new EventEmitter();
    const abort = new AbortController();
    const metricsBaseline = options.snapshot.metrics;
    const history = await repos.listEvents(options.runId);
    const executionInput = await this.buildExecutionInput(options.input);
    const artifactVersionOffset = (await repos.listArtifacts(options.runId)).length;
    const artifactIdMap = new Map<string, RunArtifact>();
    const verificationIdMap = new Map<string, VerificationRecord>();
    const liveRun: LiveRun = {
      emitter,
      done: Promise.resolve(),
      abort,
      history,
      currentSnapshot: options.snapshot,
    };

    const done = (async () => {
      try {
        const runtime = await this.runtimeFactory(options.preferredModel, options.surface);
        const result = await runtime.execute({
          runId: options.runId,
          requestedTaskKind: options.requestedTaskKind,
          input: executionInput,
          signal: abort.signal,
          onEvent: async (event) => {
            const normalized = this.normalizeRunEvent(event, artifactIdMap, verificationIdMap);
            history.push(normalized);
            // Persist the event; if the DB write fails, log the error but still
            // emit to SSE subscribers so the client sees the event in real time.
            await repos.appendEvent(normalized).catch((err) => {
              log.error({ err, runId: options.runId, eventType: event.type }, 'failed to persist run event');
            });
            emitter.emit('event', normalized);
          },
          onSnapshot: async (nextSnapshot) => {
            liveRun.currentSnapshot = {
              ...nextSnapshot,
              input: options.snapshot.input,
              metrics: mergeRunMetrics(metricsBaseline, nextSnapshot.metrics),
              createdAt: options.snapshot.createdAt,
            };
            // Snapshot persistence failures are non-fatal: the run continues and
            // the in-memory snapshot remains authoritative for SSE replay.
            await repos.updateRun(liveRun.currentSnapshot).catch((err) => {
              log.error({ err, runId: options.runId }, 'failed to persist run snapshot');
            });
          },
          onCheckpoint: async (checkpoint) => {
            await repos.saveCheckpoint(checkpoint).catch((err) => {
              log.error({ err, runId: options.runId }, 'failed to persist checkpoint');
            });
          },
          onArtifact: async (artifact) => {
            const normalized = this.normalizeArtifact(
              artifact,
              artifactVersionOffset,
            );
            artifactIdMap.set(artifact.artifactId, normalized);
            await repos.saveArtifact(normalized);
          },
          onVerification: async (record) => {
            const normalized = this.normalizeVerification(record);
            verificationIdMap.set(record.verificationId, normalized);
            await repos.saveVerification(normalized);
          },
          waitForInput: async (request) => {
            if (abort.signal.aborted) {
              throw new Error('aborted by user');
            }

            return await new Promise<Record<string, unknown>>((resolve, reject) => {
              const rejectWithAbort = () => {
                liveRun.waitingForInput = undefined;
                reject(new Error('aborted by user'));
              };

              const complete = (value: Record<string, unknown>) => {
                abort.signal.removeEventListener('abort', rejectWithAbort);
                liveRun.waitingForInput = undefined;
                resolve(value);
              };

              const fail = (error: Error) => {
                abort.signal.removeEventListener('abort', rejectWithAbort);
                liveRun.waitingForInput = undefined;
                reject(error);
              };

              liveRun.waitingForInput = {
                requestId: request.requestId,
                question: request.question,
                options: request.options,
                resolve: complete,
                reject: fail,
              };
              abort.signal.addEventListener('abort', rejectWithAbort, { once: true });
            });
          },
        });

        const latestArtifactId = result.snapshot.latestArtifactId
          ? artifactIdMap.get(result.snapshot.latestArtifactId)?.artifactId
          : undefined;
        const verificationId = typeof result.snapshot.verifierState?.verificationId === 'string'
          ? verificationIdMap.get(result.snapshot.verifierState.verificationId)?.verificationId
          : undefined;

        liveRun.currentSnapshot = {
          ...result.snapshot,
          input: options.snapshot.input,
          metrics: mergeRunMetrics(metricsBaseline, result.snapshot.metrics),
          createdAt: options.snapshot.createdAt,
          latestArtifactId,
          verifierState: verificationId
            ? { ...result.snapshot.verifierState, verificationId }
            : result.snapshot.verifierState,
        };
        await repos.updateRun(liveRun.currentSnapshot);

        const learningObservations = await this.skillPatternLearner.observeSuccessfulRun({
          snapshot: liveRun.currentSnapshot,
          artifacts: [...artifactIdMap.values()],
          verification: [...verificationIdMap.values()].at(-1),
        }).catch((err) => {
          log.error({ err, runId: options.runId }, 'failed to learn skills from successful run');
          return [];
        });

        for (const observation of learningObservations) {
          const observedEvent: RunEvent = {
            eventId: this.createUniqueEventId(options.runId, 'skill_pattern_observed'),
            runId: options.runId,
            type: 'skill_pattern_observed',
            payload: {
              patternKey: observation.patternKey,
              patternLabel: observation.patternLabel,
              occurrenceCount: observation.occurrenceCount,
            },
            createdAt: new Date().toISOString(),
          };
          history.push(observedEvent);
          await repos.appendEvent(observedEvent).catch((err) => {
            log.error({ err, runId: options.runId }, 'failed to persist learned skill observation event');
          });
          emitter.emit('event', observedEvent);

          if (observation.promotedNow && observation.promotedSkillName) {
            const learnedEvent: RunEvent = {
              eventId: this.createUniqueEventId(options.runId, 'skill_learned'),
              runId: options.runId,
              type: 'skill_learned',
              payload: {
                patternKey: observation.patternKey,
                patternLabel: observation.patternLabel,
                occurrenceCount: observation.occurrenceCount,
                skillName: observation.promotedSkillName,
              },
              createdAt: new Date().toISOString(),
            };
            history.push(learnedEvent);
            await repos.appendEvent(learnedEvent).catch((err) => {
              log.error({ err, runId: options.runId }, 'failed to persist learned skill promotion event');
            });
            emitter.emit('event', learnedEvent);
          }
        }

        const curationWork = this.curateCompletedRunMemory({
          runId: options.runId,
          rootCreatedAt: options.snapshot.createdAt,
          runInput: options.snapshot.input,
        }).catch((err) => {
          if (isStorageClosedError(err)) {
            return;
          }
          log.error({ err, runId: options.runId }, 'failed to curate completed run memory');
        });
        this.backgroundWork.add(curationWork);
        curationWork.finally(() => {
          this.backgroundWork.delete(curationWork);
        });
      } catch (err) {
        const failedAt = new Date().toISOString();
        const serializedError = String(err);
        const wasCancelled = abort.signal.aborted
          || serializedError.includes('aborted by user')
          || serializedError.includes('AbortError');
        const failedSnapshot: RunSnapshot = {
          ...liveRun.currentSnapshot,
          status: wasCancelled ? 'cancelled' : 'failed',
          terminationReason: wasCancelled ? 'user_cancelled' : 'model_error',
          updatedAt: failedAt,
          completedAt: failedAt,
        };
        liveRun.currentSnapshot = failedSnapshot;
        await repos.updateRun(failedSnapshot);
        const failEvent: RunEvent = {
          eventId: this.createUniqueEventId(options.runId, wasCancelled ? 'cancel' : 'fail'),
          runId: options.runId,
          type: wasCancelled ? 'run_cancelled' : 'run_failed',
          payload: wasCancelled ? { reason: 'user_cancelled' } : { error: serializedError },
          createdAt: failedAt,
        };
        history.push(failEvent);
        await repos.appendEvent(failEvent);
        emitter.emit('event', failEvent);
      }
    })();

    liveRun.done = done;
    this.liveRuns.set(options.runId, liveRun);

    done.finally(() => {
      if (this.liveRuns.get(options.runId) === liveRun) {
        this.liveRuns.delete(options.runId);
      }
    });
  }

  private normalizeRunEvent(
    event: RunEvent,
    artifactIdMap: Map<string, RunArtifact>,
    verificationIdMap: Map<string, VerificationRecord>,
  ): RunEvent {
    const payload = { ...event.payload };
    if (typeof payload.artifactId === 'string') {
      payload.artifactId = artifactIdMap.get(payload.artifactId)?.artifactId ?? payload.artifactId;
    }
    if (typeof payload.verificationId === 'string') {
      payload.verificationId = verificationIdMap.get(payload.verificationId)?.verificationId ?? payload.verificationId;
    }
    return {
      ...event,
      eventId: this.createUniqueEventId(event.runId, event.type),
      payload,
    };
  }

  private normalizeArtifact(artifact: RunArtifact, versionOffset: number): RunArtifact {
    return {
      ...artifact,
      artifactId: `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      version: versionOffset + artifact.version,
    };
  }

  private normalizeVerification(record: VerificationRecord): VerificationRecord {
    return {
      ...record,
      verificationId: `ver_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    };
  }

  private mergeRunInput(existing: RunSnapshot, input: AppendRunMessageInput): Record<string, unknown> {
    return {
      ...existing.input,
      // Propagate follow-up approvalMode to top-level so GeneralTaskPack reads the latest value.
      // Without this, a follow-up sent with autopilot/bypass would still use the original run's approvalMode.
      ...(input.approvalMode ? { approvalMode: input.approvalMode } : {}),
      turnEnvelope: buildFollowUpTurnEnvelope(existing, input),
    };
  }

  private async buildExecutionInput(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const normalizedInput = await this.hydrateAttachmentFields({
      ...input,
      toolIds: normalizeStringArray(input.toolIds),
    });
    const turnEnvelope = asRecord(input.turnEnvelope);
    if (!turnEnvelope) {
      return normalizedInput;
    }

    return {
      ...normalizedInput,
      turnEnvelope: await this.hydrateAttachmentFields({
        ...turnEnvelope,
        toolIds: normalizeStringArray(turnEnvelope.toolIds),
      }),
    };
  }

  private async curateCompletedRunMemory(options: {
    runId: string;
    rootCreatedAt: string;
    runInput: Record<string, unknown>;
  }): Promise<void> {
    const store = this.storage.getStructuredStore();
    const repos = new RunRepositories(store);
    const [events, artifacts] = await Promise.all([
      repos.listEvents(options.runId),
      repos.listArtifacts(options.runId),
    ]);
    const transcript = buildRunMemoryTranscript(
      options.rootCreatedAt,
      options.runInput,
      events,
      artifacts,
    );
    if (!transcript) {
      return;
    }

    const dbAdapter = {
      run: async (sql: string, params?: unknown[]) => {
        await store.run(sql, params);
      },
      all: async <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params),
    };
    const curator = new MemoryCurator({ db: dbAdapter });
    await curator.curate({
      sessionId: normalizeOptionalString(options.runInput.sessionId),
      runId: options.runId,
      transcript,
    });
  }

  private async hydrateAttachmentFields(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const attachmentIds = normalizeStringArray(input.attachmentIds);
    if (attachmentIds.length === 0) {
      return {
        ...input,
        attachmentIds,
      };
    }

    const attachments = await this.attachmentService.getByIds(attachmentIds);
    if (attachments.length === 0) {
      return {
        ...input,
        attachmentIds,
      };
    }

    return {
      ...input,
      attachmentIds,
      attachmentContext: this.attachmentService.buildPromptContext(attachments),
      attachmentRefs: this.attachmentService.toMessageRefs(attachments),
    };
  }

  private createUniqueEventId(runId: string, label: string): string {
    return `evt_${runId}_${label}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  async attachSse(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { id } = req.params as { id: string };
    const handle = this.liveRuns.get(id);

    reply.hijack();
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.write(': connected\n\n');

    const write = (event: RunEvent) => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed)
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    if (handle) {
      // Live run — replay history then stream new events
      for (const event of handle.history) write(event);
      const onEvent = (event: RunEvent) => write(event);
      handle.emitter.on('event', onEvent);

      // Heartbeat: send a SSE comment every 15 s so proxies and load balancers
      // do not close idle connections, and dead TCP connections are detected.
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
      }, 15_000);

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        handle.emitter.off('event', onEvent);
      };

      handle.done.finally(() => {
        cleanup();
        if (!reply.raw.writableEnded) reply.raw.end();
      });
      reply.raw.on('close', cleanup);
      return;
    }

    // Completed run — replay from DB
    const rows = await this.storage.getStructuredStore().all<{
      event_id: string;
      event_type: string;
      payload_json: string;
      created_at: string;
    }>(
      `SELECT event_id, event_type, payload_json, created_at FROM run_events WHERE run_id=? ORDER BY created_at ASC`,
      [id],
    );
    for (const row of rows) {
      write({
        eventId: row.event_id,
        runId: id,
        type: row.event_type,
        payload: JSON.parse(row.payload_json),
        createdAt: row.created_at,
      });
    }
    reply.raw.end();
  }

  async submitInput(runId: string, body: Record<string, unknown>): Promise<{ ok: true; runId: string; accepted: boolean }> {
    const repos = new RunRepositories(this.storage.getStructuredStore());
    const snap = await repos.getRun(runId);
    if (!snap) throw new Error(`Run not found: ${runId}`);
    const handle = this.liveRuns.get(runId);
    if (snap.status !== 'waiting_user' || !handle?.waitingForInput) {
      return { ok: true, runId, accepted: false };
    }

    const checkpoint = snap.currentCheckpointId
      ? await repos.getCheckpoint(snap.currentCheckpointId)
      : null;
    handle.waitingForInput.resolve(normalizeWaitingUserInput(body, checkpoint?.snapshot));
    return { ok: true, runId, accepted: true };
  }

  async cancel(runId: string): Promise<void> {
    const handle = this.liveRuns.get(runId);
    handle?.waitingForInput?.reject(new Error('aborted by user'));
    handle?.abort.abort();
    // Wait for the execution to settle before writing to DB, so we don't race
    // with launchExecution's own catch block or overwrite a completed run.
    await handle?.done.catch(() => undefined);
    await this.storage.getStructuredStore().run(
      `UPDATE runs SET status='cancelled', termination_reason='user_cancelled', updated_at=datetime('now'), completed_at=datetime('now') WHERE run_id=? AND status NOT IN ('completed', 'failed', 'cancelled')`,
      [runId],
    );
  }

  private async reconcileDetachedTerminalState(
    repos: RunRepositories,
    snapshot: RunSnapshot,
  ): Promise<RunSnapshot> {
    if (
      TERMINAL_RUN_STATUSES.has(snapshot.status)
      || this.liveRuns.has(snapshot.runId)
      || (snapshot.status !== 'running' && snapshot.status !== 'created')
    ) {
      return snapshot;
    }

    const events = await repos.listEvents(snapshot.runId);
    const latestTerminalEvent = [...events].reverse().find((event) => isTerminalRunEvent(event.type));
    if (latestTerminalEvent) {
      const reconciled = reconcileRunFromTerminalEvent(snapshot, latestTerminalEvent);
      await repos.updateRun(reconciled);
      return reconciled;
    }

    const latestReadyCheckpoint = [...events].reverse().find(
      (event) => event.type === 'checkpoint_created'
        && isRecord(event.payload)
        && event.payload.semanticKind === 'general-response-ready',
    );
    if (!latestReadyCheckpoint) {
      return snapshot;
    }

    const latestStructuredAnswer = (await repos.listArtifacts(snapshot.runId)).find(
      (artifact) => artifact.kind === 'structured-answer',
    );
    if (!latestStructuredAnswer) {
      return snapshot;
    }

    const completedAt = latestTimestamp([
      snapshot.updatedAt,
      latestReadyCheckpoint.createdAt,
      latestStructuredAnswer.createdAt,
    ]);
    const checkpointId = isRecord(latestReadyCheckpoint.payload) && typeof latestReadyCheckpoint.payload.checkpointId === 'string'
      ? latestReadyCheckpoint.payload.checkpointId
      : snapshot.currentCheckpointId;
    const reconciled: RunSnapshot = {
      ...snapshot,
      status: 'completed',
      terminationReason: undefined,
      currentCheckpointId: checkpointId,
      latestArtifactId: snapshot.latestArtifactId ?? latestStructuredAnswer.artifactId,
      updatedAt: completedAt,
      completedAt,
    };
    await repos.updateRun(reconciled);
    return reconciled;
  }
}

function resolveStoredRunTaskKind(routing: RoutingDecision): TaskKind {
  if (routing.agentMode === 'hermes') {
    return 'general';
  }

  return routing.acceptedTaskKind;
}

function resolveContinuationRequestedTaskKind(
  snapshot: RunSnapshot,
  nextInput?: Record<string, unknown>,
): TaskKind | undefined {
  const turnEnvelope = asRecord(nextInput?.turnEnvelope);
  if (turnEnvelope) {
    const requestedTaskKind = normalizeTaskKind(turnEnvelope.requestedTaskKind);
    return requestedTaskKind;
  }

  if (snapshot.routing.agentMode === 'hermes') {
    return snapshot.routing.requestedTaskKind;
  }

  return snapshot.taskKind;
}

function buildFollowUpTurnEnvelope(
  snapshot: RunSnapshot,
  input: AppendRunMessageInput,
): RunTurnEnvelopeRecord {
  const envelope: RunTurnEnvelopeRecord = {
    kind: 'follow-up',
    userMessage: input.content.trim(),
    priorTaskKind: snapshot.taskKind,
    priorCapabilityProfile: snapshot.currentCapabilityProfile ?? snapshot.taskKind,
  };

  if (Array.isArray(input.attachmentIds)) {
    envelope.attachmentIds = normalizeStringArray(input.attachmentIds);
  }
  if (Array.isArray(input.toolIds)) {
    envelope.toolIds = normalizeStringArray(input.toolIds);
  }
  if (input.approvalMode) {
    envelope.approvalMode = input.approvalMode;
  }

  return envelope;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTerminalRunEvent(type: string): type is 'run_completed' | 'run_failed' | 'run_cancelled' {
  return type === 'run_completed' || type === 'run_failed' || type === 'run_cancelled';
}

function reconcileRunFromTerminalEvent(snapshot: RunSnapshot, event: RunEvent): RunSnapshot {
  const status = event.type === 'run_completed'
    ? 'completed'
    : event.type === 'run_cancelled'
      ? 'cancelled'
      : 'failed';
  const terminationReason = event.type === 'run_cancelled'
    ? 'user_cancelled'
    : event.type === 'run_failed'
      ? 'model_error'
      : undefined;

  return {
    ...snapshot,
    status,
    terminationReason,
    updatedAt: event.createdAt,
    completedAt: event.createdAt,
  };
}

function latestTimestamp(values: Array<string | undefined>): string {
  return values.reduce<string>((latest, current) => {
    if (!current) {
      return latest;
    }
    if (!latest) {
      return current;
    }
    return Date.parse(current) > Date.parse(latest) ? current : latest;
  }, new Date(0).toISOString());
}

function normalizeTaskKind(value: unknown): TaskKind | undefined {
  return value === 'analysis' || value === 'general' || value === 'knowledge-query' || value === 'skill-management'
    ? value
    : undefined;
}

function buildCreatedEventPayload(snapshot: RunSnapshot): Record<string, unknown> {
  if (snapshot.routing.agentMode !== 'hermes') {
    return { taskKind: snapshot.taskKind };
  }

  return {
    taskKind: snapshot.taskKind,
    agentMode: snapshot.routing.agentMode,
    initialCapabilityProfile: snapshot.routing.initialCapabilityProfile,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
}

function mergeRunMetrics(
  baseline: RunSnapshot['metrics'],
  delta: RunSnapshot['metrics'],
): RunSnapshot['metrics'] {
  return {
    turnCount: baseline.turnCount + delta.turnCount,
    toolCallCount: baseline.toolCallCount + delta.toolCallCount,
    inputTokens: baseline.inputTokens + delta.inputTokens,
    outputTokens: baseline.outputTokens + delta.outputTokens,
    cachedTokens: baseline.cachedTokens + delta.cachedTokens,
    estimatedUsd: baseline.estimatedUsd + delta.estimatedUsd,
  };
}

function normalizeRunSurface(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'terminal-cli') {
    return 'terminal-cli';
  }
  if (normalized === 'background') {
    return 'background';
  }
  return 'web-cli';
}

function mergeDerivedInput(
  input: Record<string, unknown>,
  derived: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(derived).length === 0) {
    return input;
  }

  const next = { ...input };
  for (const [key, value] of Object.entries(derived)) {
    const existing = next[key];
    if (existing === undefined || existing === null || (typeof existing === 'string' && existing.trim() === '')) {
      next[key] = value;
    }
  }
  return next;
}

  function buildRunMemoryTranscript(
    rootCreatedAt: string,
    runInput: Record<string, unknown>,
    events: RunEvent[],
    artifacts: RunArtifact[],
  ): string {
    const turns: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string; order: number }> = [];
    const prompt = normalizeOptionalString(runInput.prompt);
    if (prompt) {
      turns.push({ role: 'user', content: prompt, createdAt: rootCreatedAt, order: 0 });
    }

    for (const [index, event] of events.entries()) {
      if (event.type !== 'user_message') {
        continue;
      }
      const content = normalizeOptionalString((event.payload as Record<string, unknown>).content);
      if (!content) {
        continue;
      }
      turns.push({ role: 'user', content, createdAt: event.createdAt, order: 100 + index });
    }

    for (const artifact of artifacts) {
      if (artifact.kind !== 'structured-answer') {
        continue;
      }
      const content = extractStructuredAnswerText(artifact);
      if (!content) {
        continue;
      }
      turns.push({ role: 'assistant', content, createdAt: artifact.createdAt, order: 200 + artifact.version });
    }

    if (turns.length === 0) {
      return '';
    }

    turns.sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt);
      return byTime !== 0 ? byTime : left.order - right.order;
    });

    return turns
      .slice(-20)
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');
  }

  function extractStructuredAnswerText(artifact: RunArtifact): string | undefined {
    const directText = normalizeOptionalString(artifact.contentText);
    if (directText) {
      return directText;
    }

    const payload = artifact.contentJson && typeof artifact.contentJson === 'object' && !Array.isArray(artifact.contentJson)
      ? artifact.contentJson as Record<string, unknown>
      : undefined;
    if (!payload) {
      return undefined;
    }

    return normalizeOptionalString(payload.response)
      ?? normalizeOptionalString(payload.summary)
      ?? normalizeOptionalString(payload.text);
  }

function normalizeWaitingUserInput(
  input: Record<string, unknown>,
  checkpointSnapshot: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...input };
  const options = normalizeStringArray(checkpointSnapshot?.options);

  const explicitIndex = typeof normalized.index === 'number' && Number.isInteger(normalized.index)
    ? normalized.index
    : undefined;
  const indexedOption = explicitIndex !== undefined && explicitIndex >= 0 && explicitIndex < options.length
    ? options[explicitIndex]
    : undefined;
  const optionFromBody = normalizeOptionalString(normalized.option);
  const valueFromBody = normalizeOptionalString(normalized.value);
  const inputFromBody = normalizeOptionalString(normalized.input);
  const selectedOption = optionFromBody && options.includes(optionFromBody)
    ? optionFromBody
    : indexedOption ?? (valueFromBody && options.includes(valueFromBody) ? valueFromBody : undefined);

  if (selectedOption) {
    normalized.option = selectedOption;
    if (normalized.index === undefined) {
      normalized.index = options.indexOf(selectedOption);
    }
  }

  if (!inputFromBody && selectedOption) {
    normalized.input = selectedOption;
  } else if (inputFromBody) {
    normalized.input = inputFromBody;
  } else if (valueFromBody) {
    normalized.input = valueFromBody;
  }

  if (valueFromBody) {
    normalized.value = valueFromBody;
  }

  const promptKind = resolveWaitingUserPromptKind(checkpointSnapshot, options);
  if (typeof normalized.promptKind !== 'string' && promptKind) {
    normalized.promptKind = promptKind;
  }

  if (typeof normalized.approved !== 'boolean' && promptKind === 'approval') {
    const approved = resolveApprovalDecision(normalized, checkpointSnapshot, options);
    if (approved !== undefined) {
      normalized.approved = approved;
      normalized.decision = approved ? 'approved' : 'denied';
    }
  }

  return normalized;
}

function resolveWaitingUserPromptKind(
  checkpointSnapshot: Record<string, unknown> | undefined,
  options: string[],
): string | undefined {
  const explicitKind = normalizeOptionalString(checkpointSnapshot?.promptKind);
  if (explicitKind) {
    return explicitKind;
  }
  if (checkpointSnapshot?.approval && typeof checkpointSnapshot.approval === 'object') {
    return 'approval';
  }
  if (
    typeof checkpointSnapshot?.changeType === 'string'
    || typeof checkpointSnapshot?.action === 'string'
    || typeof checkpointSnapshot?.targetSkill === 'string'
  ) {
    return 'approval';
  }
  return options.length > 0 ? 'choice' : undefined;
}

function resolveApprovalDecision(
  input: Record<string, unknown>,
  checkpointSnapshot: Record<string, unknown> | undefined,
  options: string[],
): boolean | undefined {
  const approval = asRecord(checkpointSnapshot?.approval);
  const approveLabel = normalizeOptionalString(approval?.approveLabel);
  const denyLabel = normalizeOptionalString(approval?.denyLabel);
  const selected = [
    normalizeOptionalString(input.option),
    normalizeOptionalString(input.input),
    normalizeOptionalString(input.value),
  ].find((value): value is string => Boolean(value));

  if (selected) {
    if (approveLabel && selected === approveLabel) {
      return true;
    }
    if (denyLabel && selected === denyLabel) {
      return false;
    }

    const classified = classifyApprovalOption(selected);
    if (classified === 'approve') {
      return true;
    }
    if (classified === 'deny') {
      return false;
    }
  }

  if (typeof input.index === 'number' && Number.isInteger(input.index) && input.index >= 0 && input.index < options.length) {
    const indexedClassification = classifyApprovalOption(options[input.index]);
    if (indexedClassification === 'approve') {
      return true;
    }
    if (indexedClassification === 'deny') {
      return false;
    }
  }

  return undefined;
}

function classifyApprovalOption(value: string): 'approve' | 'deny' | undefined {
  const normalized = value.replace(/\s+/g, '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/^(确认|同意|批准|允许|继续|执行|启用|安装|approve|approved|allow|continue|run|yes|y|ok)$/i.test(normalized)) {
    return 'approve';
  }
  if (/^(取消|拒绝|终止|停止|deny|denied|reject|abort|stop|no|n)$/i.test(normalized)) {
    return 'deny';
  }
  return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isStorageClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'SQLiteStore not initialized';
}
