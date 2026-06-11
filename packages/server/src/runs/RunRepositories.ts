import type { IStructuredStore, RoutingDecision } from '@risk-agent/core';
import type {
  RunSnapshot,
  RunEvent,
  RunCheckpoint,
  RunArtifact,
  VerificationRecord,
} from '@risk-agent/core';

/** Safely parse JSON, returning fallback on malformed data instead of throwing. */
function safeJsonParse<T>(json: unknown, fallback: T): T {
  if (typeof json !== 'string' || !json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export class RunRepositories {
  constructor(private readonly store: IStructuredStore) {}

  async getRun(runId: string): Promise<RunSnapshot | null> {
    const row = await this.store.get<Record<string, unknown>>(
      `SELECT * FROM runs WHERE run_id=?`,
      [runId],
    );
    if (!row) return null;
    return {
      runId: row.run_id as string,
      taskKind: row.task_kind as RunSnapshot['taskKind'],
      status: row.status as RunSnapshot['status'],
      terminationReason: (row.termination_reason as RunSnapshot['terminationReason']) ?? undefined,
      input: safeJsonParse(row.input_json, {}),
      routing: safeJsonParse(row.routing_json, {} as RoutingDecision),
      currentCheckpointId: (row.current_checkpoint_id as string) ?? undefined,
      latestArtifactId: (row.latest_artifact_id as string) ?? undefined,
      verifierState: row.verifier_state_json ? safeJsonParse(row.verifier_state_json, undefined) : undefined,
      metrics: safeJsonParse(row.metrics_json, { turnCount: 0, toolCallCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 }),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
    };
  }

  async listRuns(limit = 100): Promise<RunSnapshot[]> {
    // Cap limit to prevent memory exhaustion and eliminate N+1 queries
    const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);
    const rows = await this.store.all<Record<string, unknown>>(
      `SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`,
      [safeLimit],
    );
    return rows.map((row) => ({
      runId: row.run_id as string,
      taskKind: row.task_kind as RunSnapshot['taskKind'],
      status: row.status as RunSnapshot['status'],
      terminationReason: (row.termination_reason as RunSnapshot['terminationReason']) ?? undefined,
      input: safeJsonParse(row.input_json, {}),
      routing: safeJsonParse(row.routing_json, {} as RoutingDecision),
      currentCheckpointId: (row.current_checkpoint_id as string) ?? undefined,
      latestArtifactId: (row.latest_artifact_id as string) ?? undefined,
      verifierState: row.verifier_state_json ? safeJsonParse(row.verifier_state_json, undefined) : undefined,
      metrics: safeJsonParse(row.metrics_json, { turnCount: 0, toolCallCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 }),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
    }));
  }

  async insertRun(snapshot: RunSnapshot): Promise<void> {
    await this.store.run(
      `INSERT INTO runs(run_id, task_kind, status, termination_reason, input_json, routing_json, current_checkpoint_id, latest_artifact_id, verifier_state_json, metrics_json, created_at, updated_at, completed_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        snapshot.runId,
        snapshot.taskKind,
        snapshot.status,
        snapshot.terminationReason ?? null,
        JSON.stringify(snapshot.input),
        JSON.stringify(snapshot.routing),
        snapshot.currentCheckpointId ?? null,
        snapshot.latestArtifactId ?? null,
        snapshot.verifierState ? JSON.stringify(snapshot.verifierState) : null,
        JSON.stringify(snapshot.metrics),
        snapshot.createdAt,
        snapshot.updatedAt,
        snapshot.completedAt ?? null,
      ],
    );
  }

  async updateRun(snapshot: RunSnapshot): Promise<void> {
    await this.store.run(
      `UPDATE runs SET task_kind=?, status=?, termination_reason=?, input_json=?, routing_json=?, current_checkpoint_id=?, latest_artifact_id=?, verifier_state_json=?, metrics_json=?, updated_at=?, completed_at=? WHERE run_id=?`,
      [
        snapshot.taskKind,
        snapshot.status,
        snapshot.terminationReason ?? null,
        JSON.stringify(snapshot.input),
        JSON.stringify(snapshot.routing),
        snapshot.currentCheckpointId ?? null,
        snapshot.latestArtifactId ?? null,
        snapshot.verifierState ? JSON.stringify(snapshot.verifierState) : null,
        JSON.stringify(snapshot.metrics),
        snapshot.updatedAt,
        snapshot.completedAt ?? null,
        snapshot.runId,
      ],
    );
  }

  async appendEvent(event: RunEvent): Promise<void> {
    await this.store.run(
      `INSERT INTO run_events(event_id, run_id, event_type, payload_json, created_at) VALUES(?,?,?,?,?)`,
      [event.eventId, event.runId, event.type, JSON.stringify(event.payload), event.createdAt],
    );
  }

  async listEvents(runId: string): Promise<RunEvent[]> {
    const rows = await this.store.all<Record<string, unknown>>(
      `SELECT event_id, run_id, event_type, payload_json, created_at FROM run_events WHERE run_id=? ORDER BY created_at ASC`,
      [runId],
    );
    return rows.map((row) => ({
      eventId: row.event_id as string,
      runId: row.run_id as string,
      type: row.event_type as string,
      payload: safeJsonParse(row.payload_json, {}),
      createdAt: row.created_at as string,
    }));
  }

  async saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
    await this.store.run(
      `INSERT INTO run_checkpoints(checkpoint_id, run_id, checkpoint_kind, checkpoint_scope, snapshot_json, transcript_offset, artifact_ref, created_at) VALUES(?,?,?,?,?,?,?,?)`,
      [
        checkpoint.checkpointId,
        checkpoint.runId,
        checkpoint.kind,
        checkpoint.scope,
        JSON.stringify(checkpoint.snapshot),
        checkpoint.transcriptOffset,
        checkpoint.artifactRef ?? null,
        checkpoint.createdAt,
      ],
    );
  }

  async getCheckpoint(checkpointId: string): Promise<RunCheckpoint | null> {
    const row = await this.store.get<Record<string, unknown>>(
      `SELECT * FROM run_checkpoints WHERE checkpoint_id=?`,
      [checkpointId],
    );
    if (!row) {
      return null;
    }

    return {
      checkpointId: row.checkpoint_id as string,
      runId: row.run_id as string,
      kind: row.checkpoint_kind as RunCheckpoint['kind'],
      scope: row.checkpoint_scope as RunCheckpoint['scope'],
      snapshot: safeJsonParse(row.snapshot_json, {}),
      transcriptOffset: row.transcript_offset as number,
      artifactRef: (row.artifact_ref as string) ?? undefined,
      createdAt: row.created_at as string,
    };
  }

  async saveArtifact(artifact: RunArtifact): Promise<void> {
    await this.store.run(
      `INSERT INTO run_artifacts(artifact_id, run_id, artifact_kind, mime_type, content_json, content_text, version, created_at) VALUES(?,?,?,?,?,?,?,?)`,
      [
        artifact.artifactId,
        artifact.runId,
        artifact.kind,
        artifact.mimeType,
        artifact.contentJson ? JSON.stringify(artifact.contentJson) : null,
        artifact.contentText ?? null,
        artifact.version,
        artifact.createdAt,
      ],
    );
  }

  async saveVerification(record: VerificationRecord): Promise<void> {
    await this.store.run(
      `INSERT INTO run_verifications(verification_id, run_id, checkpoint_id, verifier_type, contract_version, decision, reasons_json, followup_action, created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        record.verificationId,
        record.runId,
        record.checkpointId ?? null,
        record.verifierType,
        record.contractVersion,
        record.decision,
        JSON.stringify(record.reasons),
        record.followUpAction,
        record.createdAt,
      ],
    );
  }

  async listArtifacts(runId: string): Promise<RunArtifact[]> {
    const rows = await this.store.all<Record<string, unknown>>(
      `SELECT * FROM run_artifacts WHERE run_id=? ORDER BY version DESC`,
      [runId],
    );
    return rows.map((row) => ({
      artifactId: row.artifact_id as string,
      runId: row.run_id as string,
      kind: row.artifact_kind as RunArtifact['kind'],
      mimeType: row.mime_type as string,
      contentJson: row.content_json ? safeJsonParse(row.content_json, undefined) : undefined,
      contentText: (row.content_text as string) ?? undefined,
      version: row.version as number,
      createdAt: row.created_at as string,
    }));
  }
}
