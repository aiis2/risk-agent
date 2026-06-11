import type { RunSnapshot, RunStatus } from './types.js';

const ALLOWED: Record<RunStatus, RunStatus[]> = {
  created: ['routing', 'cancelled'],
  routing: ['planning', 'failed', 'cancelled'],
  planning: ['running', 'failed', 'cancelled'],
  running: ['waiting_user', 'verifying', 'failed', 'cancelled'],
  waiting_user: ['running', 'cancelled', 'failed'],
  verifying: ['completed', 'failed', 'waiting_user'],
  completed: [],
  failed: [],
  cancelled: [],
};

export class RunStateMachine {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  transition(snapshot: RunSnapshot, next: RunStatus, patch: Partial<RunSnapshot> = {}): RunSnapshot {
    if (!ALLOWED[snapshot.status]?.includes(next)) {
      throw new Error(`Illegal transition: ${snapshot.status} -> ${next}`);
    }

    const completedAt = ['completed', 'failed', 'cancelled'].includes(next)
      ? this.now()
      : snapshot.completedAt;

    return {
      ...snapshot,
      ...patch,
      status: next,
      updatedAt: this.now(),
      completedAt,
    };
  }

  isTerminal(status: RunStatus): boolean {
    return ALLOWED[status]?.length === 0;
  }
}
