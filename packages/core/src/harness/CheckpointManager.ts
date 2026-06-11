import { randomUUID } from 'node:crypto';
import type { RunCheckpoint, RunSnapshot } from './types.js';

export interface CheckpointPersister {
  save(checkpoint: RunCheckpoint): Promise<void>;
}

export class CheckpointManager {
  constructor(
    private readonly persister: CheckpointPersister,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async create(
    snapshot: RunSnapshot,
    kind: RunCheckpoint['kind'],
    scope: RunCheckpoint['scope'],
    payload: Record<string, unknown>,
    transcriptOffset: number,
  ): Promise<RunCheckpoint> {
    const checkpoint: RunCheckpoint = {
      checkpointId: `chk_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      runId: snapshot.runId,
      kind,
      scope,
      snapshot: payload,
      transcriptOffset,
      createdAt: this.now(),
    };
    await this.persister.save(checkpoint);
    return checkpoint;
  }
}
