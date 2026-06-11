import { describe, expect, it } from 'vitest';
import { RunStateMachine } from '../RunStateMachine.js';
import type { RunSnapshot } from '../types.js';

function snapshot(status: RunSnapshot['status']): RunSnapshot {
  return {
    runId: 'run_state',
    taskKind: 'analysis',
    status,
    input: {},
    routing: {
      acceptedTaskKind: 'analysis',
      confidence: 1,
      reason: 'test',
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
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
  };
}

describe('RunStateMachine', () => {
  it('allows created -> routing -> planning -> running -> verifying -> completed', () => {
    const sm = new RunStateMachine(() => '2026-04-24T01:00:00.000Z');

    const routed = sm.transition(snapshot('created'), 'routing');
    const planned = sm.transition(routed, 'planning');
    const running = sm.transition(planned, 'running');
    const verifying = sm.transition(running, 'verifying');
    const completed = sm.transition(verifying, 'completed', { terminationReason: 'completed' });

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBe('2026-04-24T01:00:00.000Z');
  });

  it('rejects running -> completed without a verify step', () => {
    const sm = new RunStateMachine(() => '2026-04-24T01:00:00.000Z');
    expect(() => sm.transition(snapshot('running'), 'completed')).toThrow(/illegal transition/i);
  });

  it('allows running -> waiting_user -> running', () => {
    const sm = new RunStateMachine(() => '2026-04-24T01:00:00.000Z');
    const waiting = sm.transition(snapshot('running'), 'waiting_user');
    const resumed = sm.transition(waiting, 'running');
    expect(resumed.status).toBe('running');
  });

  it('allows cancellation from any non-terminal state', () => {
    const sm = new RunStateMachine(() => '2026-04-24T01:00:00.000Z');
    for (const status of ['created', 'routing', 'planning', 'running', 'waiting_user'] as const) {
      const cancelled = sm.transition(snapshot(status), 'cancelled');
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completedAt).toBe('2026-04-24T01:00:00.000Z');
    }
  });

  it('identifies terminal states', () => {
    const sm = new RunStateMachine();
    expect(sm.isTerminal('completed')).toBe(true);
    expect(sm.isTerminal('failed')).toBe(true);
    expect(sm.isTerminal('cancelled')).toBe(true);
    expect(sm.isTerminal('running')).toBe(false);
  });
});
