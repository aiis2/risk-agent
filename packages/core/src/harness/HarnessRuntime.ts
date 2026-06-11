import type {
  CapabilitySwitchRecord,
  TaskKind,
  RunSnapshot,
  RunEvent,
  RunCheckpoint,
  RunArtifact,
  VerificationRecord,
  TaskPackContext,
  UserInputRequest,
} from './types.js';
import { TaskPackRegistry } from './TaskPackRegistry.js';
import { RunStateMachine } from './RunStateMachine.js';
import { RunRouter } from './RunRouter.js';
import { CheckpointManager } from './CheckpointManager.js';

export interface HarnessRuntimeDeps {
  registry: TaskPackRegistry;
  stateMachine: RunStateMachine;
  router?: RunRouter;
  now?: () => string;
  orchestrator?: HarnessRuntimeOrchestrator;
}

export interface HarnessExecuteInput {
  runId: string;
  requestedTaskKind?: TaskKind;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  waitForInput?(request: UserInputRequest): Promise<Record<string, unknown>>;
  onSnapshot?(snapshot: RunSnapshot): Promise<void>;
  onEvent(event: RunEvent): Promise<void>;
  onCheckpoint?(checkpoint: RunCheckpoint): Promise<void>;
  onArtifact?(artifact: RunArtifact): Promise<void>;
  onVerification?(record: VerificationRecord): Promise<void>;
}

export interface HarnessExecuteResult {
  snapshot: RunSnapshot;
  artifacts: RunArtifact[];
  verification: VerificationRecord;
}

export interface HarnessRuntimeOrchestratedPackResult {
  kind: TaskKind;
  normalizedInput: Record<string, unknown>;
  plan: unknown;
  result: unknown;
  artifacts: RunArtifact[];
  verification: VerificationRecord;
}

export interface HarnessRuntimeOrchestratorContext {
  run: RunSnapshot;
  input: Record<string, unknown>;
  signal: AbortSignal;
  emit(event: Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>): Promise<RunEvent>;
  createSemanticCheckpoint(kind: string, snapshot: Record<string, unknown>): Promise<RunCheckpoint>;
  requestUserInput(request: {
    question: string;
    options?: string[];
    checkpoint?: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  publishArtifact(artifact: Omit<RunArtifact, 'artifactId' | 'runId' | 'version' | 'createdAt'>): Promise<RunArtifact>;
  executePack(kind: TaskKind, packInput?: Record<string, unknown>): Promise<HarnessRuntimeOrchestratedPackResult>;
  switchCapability(
    next: TaskKind,
    metadata: { reason: string; source?: CapabilitySwitchRecord['source'] },
  ): Promise<void>;
}

export interface HarnessRuntimeOrchestratorResult {
  artifacts: RunArtifact[];
  verification: VerificationRecord;
}

export interface HarnessRuntimeOrchestrator {
  execute(context: HarnessRuntimeOrchestratorContext): Promise<HarnessRuntimeOrchestratorResult>;
}

export class HarnessRuntime {
  constructor(private readonly deps: HarnessRuntimeDeps) {}

  async execute(input: HarnessExecuteInput): Promise<HarnessExecuteResult> {
    const now = this.deps.now ?? (() => new Date().toISOString());
    const router = this.deps.router ?? new RunRouter();
    const activeInput = buildActiveTurnInput(input.input);
    const routed = router.route({
      requestedTaskKind: resolveRequestedTaskKind(input.requestedTaskKind, input.input),
      input: activeInput,
    });
    const routing = {
      ...routed,
      initialCapabilityProfile: routed.initialCapabilityProfile ?? routed.acceptedTaskKind,
    };
    const signal = input.signal ?? new AbortController().signal;

    let snapshot: RunSnapshot = {
      runId: input.runId,
      taskKind: resolveTopLevelTaskKind(routing),
      currentCapabilityProfile: routing.initialCapabilityProfile,
      capabilitySwitches: [],
      status: 'created',
      input: input.input,
      routing,
      metrics: { turnCount: 0, toolCallCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 },
      createdAt: now(),
      updatedAt: now(),
    };

    const checkpointManager = new CheckpointManager(
      {
        save: async (checkpoint) => {
          await input.onCheckpoint?.(checkpoint);
        },
      },
      now,
    );

    let artifactVersion = 0;
    let transcriptOffset = 0;

    const persistSnapshot = async (): Promise<void> => {
      await input.onSnapshot?.(snapshot);
    };

    const publishEvent = async (
      event: Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>,
      label?: string,
    ): Promise<RunEvent> => {
      transcriptOffset += 1;
      const normalizedEvent: RunEvent = {
        eventId: label ? `evt_${input.runId}_${label}` : `evt_${input.runId}_${transcriptOffset}`,
        runId: input.runId,
        type: event.type,
        payload: event.payload,
        createdAt: now(),
      };
      snapshot = {
        ...snapshot,
        metrics: accumulateRunMetrics(snapshot.metrics, normalizedEvent),
      };
      await input.onEvent(normalizedEvent);
      return normalizedEvent;
    };

    const publishCheckpoint = async (
      kind: RunCheckpoint['kind'],
      scope: RunCheckpoint['scope'],
      payload: Record<string, unknown>,
      label: string,
    ): Promise<RunCheckpoint> => {
      const checkpoint = await checkpointManager.create(snapshot, kind, scope, payload, transcriptOffset);
      snapshot = {
        ...snapshot,
        currentCheckpointId: checkpoint.checkpointId,
        updatedAt: now(),
      };
      await publishEvent(
        {
          type: 'checkpoint_created',
          payload: { checkpointId: checkpoint.checkpointId, kind: checkpoint.kind, scope: checkpoint.scope },
        },
        `checkpoint_${label}`,
      );
      return checkpoint;
    };

    const finalizeRun = async (
      artifacts: RunArtifact[],
      verification: VerificationRecord,
    ): Promise<HarnessExecuteResult> => {
      await input.onVerification?.(verification);

      snapshot = this.deps.stateMachine.transition(
        snapshot,
        verification.decision === 'fail' ? 'failed' : 'completed',
        {
          latestArtifactId: artifacts.at(-1)?.artifactId,
          terminationReason: verification.decision === 'fail' ? 'verification_failed' : 'completed',
          verifierState: { verificationId: verification.verificationId, decision: verification.decision },
        },
      );

      await publishEvent({
        type: 'verifier_finished',
        payload: verification as unknown as Record<string, unknown>,
      }, 'verify');
      await publishCheckpoint(
        'completed',
        'structural',
        { status: snapshot.status, terminationReason: snapshot.terminationReason ?? null },
        'completed',
      );
      await publishEvent({
        type: snapshot.status === 'completed' ? 'run_completed' : 'run_failed',
        payload: { status: snapshot.status, terminationReason: snapshot.terminationReason ?? null },
      }, 'done');
      await persistSnapshot();

      return { snapshot, artifacts, verification };
    };

    snapshot = this.deps.stateMachine.transition(snapshot, 'routing');
    await publishEvent({
      type: 'routed',
      payload: routing as unknown as Record<string, unknown>,
    }, 'routed');
    await publishCheckpoint('routed', 'structural', routing as unknown as Record<string, unknown>, 'routed');
    await persistSnapshot();

    const context: TaskPackContext = {
      get run() {
        return snapshot;
      },
      signal,
      now,
      emit: async (event) => publishEvent(event),
      createSemanticCheckpoint: async (kind, payload) => {
        const checkpoint = await checkpointManager.create(
          snapshot,
          'running-step',
          'semantic',
          { semanticKind: kind, ...payload },
          transcriptOffset,
        );
        snapshot = {
          ...snapshot,
          currentCheckpointId: checkpoint.checkpointId,
          updatedAt: now(),
        };
        await publishEvent(
          {
            type: 'checkpoint_created',
            payload: { checkpointId: checkpoint.checkpointId, kind: checkpoint.kind, scope: checkpoint.scope, semanticKind: kind },
          },
          `checkpoint_${kind.replace(/[^a-z0-9_-]/gi, '_')}`,
        );
        return checkpoint;
      },
      requestUserInput: async ({ question, options, checkpoint }) => {
        if (!input.waitForInput) {
          throw new Error('waitForInput not configured for this harness execution');
        }

        snapshot = this.deps.stateMachine.transition(snapshot, 'waiting_user');
        const requestId = `ask_${input.runId}_${transcriptOffset + 1}`;
        const promptKind = resolveWaitingUserPromptKind(checkpoint, options);
        const approval = promptKind === 'approval' ? resolveApprovalDescriptor(options) : undefined;
        const checkpointPayload = {
          requestId,
          question,
          options,
          promptKind,
          ...(approval ? { approval } : {}),
          ...(checkpoint ?? {}),
        };

        const waitingCheckpoint = await publishCheckpoint(
          'waiting-user',
          'structural',
          checkpointPayload,
          `waiting_user_${requestId}`,
        );
        await publishEvent(
          {
            type: 'waiting_user',
            payload: {
              requestId,
              question,
              options,
              promptKind,
              checkpointId: waitingCheckpoint.checkpointId,
              checkpoint: checkpointPayload,
              ...(approval ? { approval } : {}),
            },
          },
          `waiting_user_${requestId}`,
        );
        await persistSnapshot();

        const answer = await input.waitForInput({ requestId, question, options });
        snapshot = this.deps.stateMachine.transition(snapshot, 'running');
        await persistSnapshot();
        await publishEvent(
          {
            type: 'user_input_received',
            payload: { requestId, ...answer },
          },
          `user_input_${requestId}`,
        );
        return answer;
      },
      publishArtifact: async (artifact) => {
        artifactVersion += 1;
        const published: RunArtifact = {
          artifactId: `art_${input.runId}_${artifactVersion}`,
          runId: input.runId,
          kind: artifact.kind,
          mimeType: artifact.mimeType,
          contentJson: artifact.contentJson,
          contentText: artifact.contentText,
          version: artifactVersion,
          createdAt: now(),
        };
        await input.onArtifact?.(published);
        const preview = buildArtifactPreview(published);
        await publishEvent({
          type: 'artifact_updated',
          payload: {
            artifactId: published.artifactId,
            kind: published.kind,
            version: published.version,
            ...(preview ? { preview } : {}),
          },
        }, `artifact_${artifactVersion}`);
        return published;
      },
    };

    const executePack = async (
      kind: TaskKind,
      packInput: Record<string, unknown> = activeInput,
    ): Promise<HarnessRuntimeOrchestratedPackResult> => {
      const pack = this.deps.registry.get(kind);
      const normalized = await pack.intake(packInput, context);
      const plan = await pack.plan(normalized, context);
      const iterator = pack.execute(plan, context);
      let execution = await iterator.next();
      while (!execution.done) {
        await publishEvent({ type: execution.value.type, payload: execution.value.payload });
        execution = await iterator.next();
      }
      const artifacts = await pack.projectResult(execution.value, context);
      const verification = await pack.verify(execution.value, context);
      return {
        kind,
        normalizedInput: normalized,
        plan,
        result: execution.value,
        artifacts,
        verification,
      };
    };

    const switchCapability = async (
      next: TaskKind,
      metadata: { reason: string; source?: CapabilitySwitchRecord['source'] },
    ): Promise<void> => {
      const from = snapshot.currentCapabilityProfile ?? snapshot.taskKind;
      if (from === next) {
        return;
      }

      const entry: CapabilitySwitchRecord = {
        from,
        to: next,
        reason: metadata.reason,
        ...(metadata.source ? { source: metadata.source } : {}),
      };

      snapshot = {
        ...snapshot,
        currentCapabilityProfile: next,
        capabilitySwitches: [...(snapshot.capabilitySwitches ?? []), entry],
        updatedAt: now(),
      };
      const switchCount = snapshot.capabilitySwitches?.length ?? 0;

      await publishEvent({
        type: 'capability_switched',
        payload: entry as unknown as Record<string, unknown>,
      }, `capability_switched_${switchCount}`);
      await persistSnapshot();
    };

    if (this.deps.orchestrator) {
      snapshot = this.deps.stateMachine.transition(snapshot, 'planning');
      await publishEvent({
        type: 'plan_created',
        payload: {
          orchestration: 'dynamic',
          taskKind: snapshot.taskKind,
          initialCapabilityProfile: snapshot.currentCapabilityProfile,
        },
      }, 'plan');
      await publishCheckpoint(
        'planned',
        'structural',
        {
          orchestration: 'dynamic',
          taskKind: snapshot.taskKind,
          initialCapabilityProfile: snapshot.currentCapabilityProfile,
        },
        'planned',
      );
      await persistSnapshot();

      snapshot = this.deps.stateMachine.transition(snapshot, 'running');
      await persistSnapshot();

      const orchestrated = await this.deps.orchestrator.execute({
        run: snapshot,
        input: activeInput,
        signal: context.signal,
        emit: context.emit,
        createSemanticCheckpoint: context.createSemanticCheckpoint,
        requestUserInput: context.requestUserInput,
        publishArtifact: context.publishArtifact,
        executePack,
        switchCapability,
      });

      snapshot = this.deps.stateMachine.transition(snapshot, 'verifying');
      await publishCheckpoint('verify-ready', 'structural', { taskKind: snapshot.taskKind }, 'verify_ready');
      await persistSnapshot();

      return finalizeRun(orchestrated.artifacts, orchestrated.verification);
    }

    const pack = this.deps.registry.get(resolvePackKind(routing));
    snapshot = this.deps.stateMachine.transition(snapshot, 'planning');
    const normalized = await pack.intake(activeInput, context);
    const plan = await pack.plan(normalized, context);
    await publishEvent({
      type: 'plan_created',
      payload: plan as Record<string, unknown>,
    }, 'plan');
    await publishCheckpoint('planned', 'structural', plan as Record<string, unknown>, 'planned');
    await persistSnapshot();

    snapshot = this.deps.stateMachine.transition(snapshot, 'running');
    await persistSnapshot();
    const iterator = pack.execute(plan, context);
    let execution = await iterator.next();
    while (!execution.done) {
      await publishEvent({ type: execution.value.type, payload: execution.value.payload });
      execution = await iterator.next();
    }

    snapshot = this.deps.stateMachine.transition(snapshot, 'verifying');
    await publishCheckpoint('verify-ready', 'structural', { taskKind: snapshot.taskKind }, 'verify_ready');
    await persistSnapshot();
    const artifacts = await pack.projectResult(execution.value, context);
    const verification = await pack.verify(execution.value, context);
    return finalizeRun(artifacts, verification);
  }
}

function buildActiveTurnInput(input: Record<string, unknown>): Record<string, unknown> {
  const turnEnvelope = asRecord(input.turnEnvelope);
  if (!turnEnvelope) {
    return input;
  }

  const userMessage = normalizeString(turnEnvelope.userMessage);
  const activeInput: Record<string, unknown> = {
    ...input,
    _rootPrompt: normalizeString(input.prompt),
    _rootQuery: normalizeString(input.query),
    _rootBusinessName: normalizeString(input.businessName),
    guidanceMessages: mergeGuidanceMessages(input.guidanceMessages, userMessage ? [userMessage] : []),
  };

  if (userMessage) {
    activeInput.prompt = userMessage;
    activeInput.query = undefined;
    activeInput.businessName = undefined;
  }

  if (Array.isArray(turnEnvelope.toolIds)) {
    activeInput.toolIds = normalizeStringArray(turnEnvelope.toolIds);
  }
  if (Array.isArray(turnEnvelope.attachmentIds)) {
    activeInput.attachmentIds = normalizeStringArray(turnEnvelope.attachmentIds);
  }
  if (typeof turnEnvelope.attachmentContext === 'string') {
    activeInput.attachmentContext = turnEnvelope.attachmentContext;
  }
  if (Array.isArray(turnEnvelope.attachmentRefs)) {
    activeInput.attachmentRefs = turnEnvelope.attachmentRefs;
  }
  if (typeof turnEnvelope.approvalMode === 'string') {
    activeInput.approvalMode = turnEnvelope.approvalMode;
  }

  return activeInput;
}

function resolveRequestedTaskKind(
  requestedTaskKind: TaskKind | undefined,
  input: Record<string, unknown>,
): TaskKind | undefined {
  const turnEnvelope = asRecord(input.turnEnvelope);
  if (!turnEnvelope) {
    return requestedTaskKind;
  }

  return normalizeTaskKind(turnEnvelope.requestedTaskKind);
}

function resolveTopLevelTaskKind(routing: Pick<RunSnapshot['routing'], 'acceptedTaskKind' | 'agentMode'>): TaskKind {
  if (routing.agentMode === 'hermes') {
    return 'general';
  }

  return routing.acceptedTaskKind;
}

function resolvePackKind(
  routing: Pick<RunSnapshot['routing'], 'acceptedTaskKind' | 'agentMode' | 'initialCapabilityProfile'>,
): TaskKind {
  if (routing.agentMode === 'hermes' && routing.initialCapabilityProfile) {
    return routing.initialCapabilityProfile;
  }

  return routing.acceptedTaskKind;
}

function buildArtifactPreview(artifact: Pick<RunArtifact, 'contentJson' | 'contentText'>): string | undefined {
  const textPreview = normalizeArtifactPreview(artifact.contentText);
  if (textPreview) {
    return textPreview;
  }

  if (!artifact.contentJson || typeof artifact.contentJson !== 'object') {
    return undefined;
  }

  const preferredKeys = ['response', 'summary', 'message', 'title'] as const;
  for (const key of preferredKeys) {
    const value = artifact.contentJson[key];
    if (typeof value === 'string') {
      const preview = normalizeArtifactPreview(value);
      if (preview) {
        return preview;
      }
    }
  }

  if (typeof artifact.contentJson.query === 'string') {
    const totalMatches = typeof artifact.contentJson.totalMatches === 'number'
      ? ` (${artifact.contentJson.totalMatches} matches)`
      : '';
    const preview = normalizeArtifactPreview(`query ${artifact.contentJson.query}${totalMatches}`);
    if (preview) {
      return preview;
    }
  }

  return undefined;
}

function normalizeArtifactPreview(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return undefined;
  }

  return collapsed.length > 160 ? `${collapsed.slice(0, 159)}…` : collapsed;
}

function resolveWaitingUserPromptKind(
  checkpoint: Record<string, unknown> | undefined,
  options: string[] | undefined,
): 'approval' | 'choice' | 'text' | 'secret' {
  const explicitKind = typeof checkpoint?.promptKind === 'string' ? checkpoint.promptKind.trim().toLowerCase() : '';
  if (explicitKind === 'approval' || explicitKind === 'choice' || explicitKind === 'text' || explicitKind === 'secret') {
    return explicitKind;
  }

  if (explicitKind === 'password') {
    return 'secret';
  }

  if (isApprovalCheckpoint(checkpoint, options)) {
    return 'approval';
  }

  return Array.isArray(options) && options.length > 0 ? 'choice' : 'text';
}

function isApprovalCheckpoint(
  checkpoint: Record<string, unknown> | undefined,
  options: string[] | undefined,
): boolean {
  if (!checkpoint) {
    return false;
  }

  if (
    typeof checkpoint.changeType === 'string'
    || typeof checkpoint.action === 'string'
    || typeof checkpoint.requiresApproval === 'boolean'
    || typeof checkpoint.targetSkill === 'string'
  ) {
    return true;
  }

  return hasApprovalOptionPair(options);
}

function resolveApprovalDescriptor(options: string[] | undefined): { approveLabel?: string; denyLabel?: string } | undefined {
  if (!Array.isArray(options) || options.length === 0) {
    return undefined;
  }

  const approveLabel = options.find((option) => classifyApprovalOption(option) === 'approve');
  const denyLabel = options.find((option) => classifyApprovalOption(option) === 'deny');
  if (!approveLabel && !denyLabel) {
    return undefined;
  }

  return {
    ...(approveLabel ? { approveLabel } : {}),
    ...(denyLabel ? { denyLabel } : {}),
  };
}

function hasApprovalOptionPair(options: string[] | undefined): boolean {
  if (!Array.isArray(options) || options.length < 2) {
    return false;
  }

  const decisions = options
    .map((option) => classifyApprovalOption(option))
    .filter((decision): decision is 'approve' | 'deny' => decision !== undefined);
  return decisions.includes('approve') && decisions.includes('deny');
}

function classifyApprovalOption(option: string): 'approve' | 'deny' | undefined {
  const normalized = option.replace(/\s+/g, '').trim().toLowerCase();
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

function accumulateRunMetrics(metrics: RunSnapshot['metrics'], event: Pick<RunEvent, 'type' | 'payload'>): RunSnapshot['metrics'] {
  const metricsWithSyntheticDelta = mergeMetricDelta(metrics, readSyntheticMetricDelta(event.payload));

  switch (event.type) {
    case 'turn_info': {
      const current = readFiniteNumber(event.payload.current);
      if (current === undefined || current <= metricsWithSyntheticDelta.turnCount) {
        return metricsWithSyntheticDelta;
      }
      return {
        ...metricsWithSyntheticDelta,
        turnCount: current,
      };
    }
    case 'tool_start':
      return {
        ...metricsWithSyntheticDelta,
        toolCallCount: metricsWithSyntheticDelta.toolCallCount + 1,
      };
    case 'cost_update': {
      const inputTokens = readFiniteNumber(event.payload.inputTokens) ?? 0;
      const outputTokens = readFiniteNumber(event.payload.outputTokens) ?? 0;
      const cachedTokens = readFiniteNumber(event.payload.cachedTokens) ?? 0;
      const cacheCreationTokens = readFiniteNumber(event.payload.cacheCreationTokens) ?? 0;
      const estimatedUsd = readFiniteNumber(event.payload.estimatedUsd) ?? 0;

      if (
        inputTokens === 0
        && outputTokens === 0
        && cachedTokens === 0
        && cacheCreationTokens === 0
        && estimatedUsd === 0
      ) {
        return metricsWithSyntheticDelta;
      }

      return {
        turnCount: metricsWithSyntheticDelta.turnCount,
        toolCallCount: metricsWithSyntheticDelta.toolCallCount,
        inputTokens: metricsWithSyntheticDelta.inputTokens + inputTokens,
        outputTokens: metricsWithSyntheticDelta.outputTokens + outputTokens,
        cachedTokens: metricsWithSyntheticDelta.cachedTokens + cachedTokens + cacheCreationTokens,
        estimatedUsd: metricsWithSyntheticDelta.estimatedUsd + estimatedUsd,
      };
    }
    default:
      return metricsWithSyntheticDelta;
  }
}

function readSyntheticMetricDelta(payload: Record<string, unknown>): Partial<RunSnapshot['metrics']> {
  const raw = payload.syntheticMetrics;
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const synthetic = raw as Record<string, unknown>;
  return {
    turnCount: readFiniteNumber(synthetic.turnCount),
    toolCallCount: readFiniteNumber(synthetic.toolCallCount),
    inputTokens: readFiniteNumber(synthetic.inputTokens),
    outputTokens: readFiniteNumber(synthetic.outputTokens),
    cachedTokens: readFiniteNumber(synthetic.cachedTokens),
    estimatedUsd: readFiniteNumber(synthetic.estimatedUsd),
  };
}

function mergeMetricDelta(
  metrics: RunSnapshot['metrics'],
  delta: Partial<RunSnapshot['metrics']>,
): RunSnapshot['metrics'] {
  if (
    delta.turnCount === undefined
    && delta.toolCallCount === undefined
    && delta.inputTokens === undefined
    && delta.outputTokens === undefined
    && delta.cachedTokens === undefined
    && delta.estimatedUsd === undefined
  ) {
    return metrics;
  }

  return {
    turnCount: metrics.turnCount + (delta.turnCount ?? 0),
    toolCallCount: metrics.toolCallCount + (delta.toolCallCount ?? 0),
    inputTokens: metrics.inputTokens + (delta.inputTokens ?? 0),
    outputTokens: metrics.outputTokens + (delta.outputTokens ?? 0),
    cachedTokens: metrics.cachedTokens + (delta.cachedTokens ?? 0),
    estimatedUsd: metrics.estimatedUsd + (delta.estimatedUsd ?? 0),
  };
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function mergeGuidanceMessages(...sources: unknown[]): string[] {
  const merged = sources.flatMap((source) => normalizeStringArray(source));
  return merged.filter((entry, index) => merged.indexOf(entry) === index);
}

function normalizeTaskKind(value: unknown): TaskKind | undefined {
  return value === 'analysis' || value === 'general' || value === 'knowledge-query' || value === 'skill-management'
    ? value
    : undefined;
}
