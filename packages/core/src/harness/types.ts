/**
 * Harness Kernel Phase 1 — Run-first domain model
 *
 * Central types for the run-first harness architecture.
 * The kernel is task-agnostic; analysis is just one task pack.
 */

// ---------------------------------------------------------------------------
// Task Kind
// ---------------------------------------------------------------------------

export type TaskKind = 'analysis' | 'general' | 'knowledge-query' | 'skill-management';

export type CapabilityProfile = TaskKind;
export type AgentMode = 'task-pack' | 'hermes';

export type ContinuationStopReasonCode =
  | 'model_complete'
  | 'budget'
  | 'approval'
  | 'system_fallback'
  | 'verification_failed'
  | 'max_rounds';

export interface CapabilitySwitchRecord {
  from: CapabilityProfile;
  to: CapabilityProfile;
  reason: string;
  source?: 'model' | 'system' | 'user';
}

export interface ContinuationDecisionRecord {
  round: number;
  decision: 'continue' | 'stop';
  currentCapabilityProfile: CapabilityProfile;
  nextCapabilityProfile?: CapabilityProfile;
  responseModeHint?: 'answer-only' | 'tool-assisted' | 'attachment-grounded' | 'restricted';
  stopReasonCode?: ContinuationStopReasonCode;
  reason: string;
  delegatedPrompt?: string;
  source?: 'model' | 'system' | 'user';
}

// ---------------------------------------------------------------------------
// Run Status & Termination
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'created'
  | 'routing'
  | 'planning'
  | 'running'
  | 'waiting_user'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TerminationReason =
  | 'completed'
  | 'user_cancelled'
  | 'approval_denied'
  | 'tool_error'
  | 'model_error'
  | 'budget_exhausted'
  | 'max_turns'
  | 'verification_failed'
  | 'checkpoint_exit';

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export type CheckpointKind =
  | 'routed'
  | 'planned'
  | 'running-step'
  | 'waiting-user'
  | 'verify-ready'
  | 'completed';

export interface RunCheckpoint {
  checkpointId: string;
  runId: string;
  kind: CheckpointKind;
  scope: 'structural' | 'semantic';
  snapshot: Record<string, unknown>;
  transcriptOffset: number;
  artifactRef?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

export type ArtifactKind = 'markdown' | 'json' | 'structured-answer' | 'report';

export interface RunArtifact {
  artifactId: string;
  runId: string;
  kind: ArtifactKind;
  mimeType: string;
  contentJson?: Record<string, unknown>;
  contentText?: string;
  version: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerificationDecision = 'pass' | 'warn' | 'fail';
export type VerificationFollowUpAction = 'none' | 'retry' | 'rollback' | 'wait_user' | 'fail_run';

export interface VerificationRecord {
  verificationId: string;
  runId: string;
  checkpointId?: string;
  verifierType: 'deterministic' | 'contract' | 'model';
  contractVersion: string;
  decision: VerificationDecision;
  reasons: string[];
  followUpAction: VerificationFollowUpAction;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RoutingDecision {
  agentMode?: AgentMode;
  requestedTaskKind?: TaskKind;
  acceptedTaskKind: TaskKind;
  initialCapabilityProfile?: CapabilityProfile;
  confidence: number;
  reason: string;
  routeParams: Record<string, unknown>;
  /**
   * Hermes 风格人格推荐 scope（A1，2026-04-29）。
   * SessionRunner 在 RoutingDecision 落地后，可调用
   * PersonaService.resolveForRun({ routerHintScope: this }) 推荐人格。
   */
  recommendedPersonaScope?: 'general' | 'analysis' | 'knowledge-query' | 'skill-management' | 'data-analysis';
}

// ---------------------------------------------------------------------------
// Run Metrics
// ---------------------------------------------------------------------------

export interface RunMetrics {
  turnCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedUsd: number;
}

// ---------------------------------------------------------------------------
// Run Snapshot
// ---------------------------------------------------------------------------

export interface RunSnapshot {
  runId: string;
  taskKind: TaskKind;
  currentCapabilityProfile?: CapabilityProfile;
  capabilitySwitches?: CapabilitySwitchRecord[];
  status: RunStatus;
  terminationReason?: TerminationReason;
  input: Record<string, unknown>;
  routing: RoutingDecision;
  currentCheckpointId?: string;
  latestArtifactId?: string;
  verifierState?: Record<string, unknown>;
  metrics: RunMetrics;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Run Event (immutable transcript entry)
// ---------------------------------------------------------------------------

export interface RunEvent {
  eventId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface UserInputRequest {
  requestId: string;
  question: string;
  options?: string[];
}

// ---------------------------------------------------------------------------
// Task Pack Context
// ---------------------------------------------------------------------------

export interface TaskPackContext {
  run: RunSnapshot;
  signal: AbortSignal;
  now(): string;
  emit(event: Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>): Promise<RunEvent>;
  createSemanticCheckpoint(kind: string, snapshot: Record<string, unknown>): Promise<RunCheckpoint>;
  requestUserInput(request: {
    question: string;
    options?: string[];
    checkpoint?: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  publishArtifact(artifact: Omit<RunArtifact, 'artifactId' | 'runId' | 'version' | 'createdAt'>): Promise<RunArtifact>;
}

// ---------------------------------------------------------------------------
// Task Pack Interface
// ---------------------------------------------------------------------------

export interface TaskPack<TInput = unknown, TPlan = unknown, TResult = unknown> {
  kind: TaskKind;
  inputSchema: unknown;
  contractVersion: string;
  intake(input: TInput, ctx: TaskPackContext): Promise<Record<string, unknown>>;
  plan(input: Record<string, unknown>, ctx: TaskPackContext): Promise<TPlan>;
  execute(plan: TPlan, ctx: TaskPackContext): AsyncGenerator<RunEvent, TResult>;
  verify(result: TResult, ctx: TaskPackContext): Promise<VerificationRecord>;
  projectResult(result: TResult, ctx: TaskPackContext): Promise<RunArtifact[]>;
}
