import { describe, expect, it } from 'vitest';
import { TaskPackRegistry } from '../TaskPackRegistry.js';
import type { TaskKind, TaskPack } from '../types.js';

function createPack(kind: TaskKind): TaskPack<Record<string, unknown>, { ok: true }, { ok: true }> {
  return {
    kind,
    contractVersion: 'phase1',
    inputSchema: {},
    async intake(input) {
      return input as Record<string, unknown>;
    },
    async plan() {
      return { ok: true } as { ok: true };
    },
    async *execute() {
      return { ok: true } as { ok: true };
    },
    async verify(_result, ctx) {
      return {
        verificationId: 'ver_pass',
        runId: ctx.run.runId,
        verifierType: 'contract' as const,
        contractVersion: 'phase1',
        decision: 'pass' as const,
        reasons: [],
        followUpAction: 'none' as const,
        createdAt: ctx.now(),
      };
    },
    async projectResult() {
      return [];
    },
  };
}

describe('TaskPackRegistry', () => {
  it('registers and returns task packs by kind', () => {
    const registry = new TaskPackRegistry();
    const analysisPack = createPack('analysis');

    registry.register(analysisPack);

    expect(registry.get('analysis')).toBe(analysisPack);
    expect(registry.list().map((pack) => pack.kind)).toEqual(['analysis']);
  });

  it('rejects duplicate task-pack registration', () => {
    const registry = new TaskPackRegistry();
    registry.register(createPack('analysis'));

    expect(() => registry.register(createPack('analysis'))).toThrow(/already registered/i);
  });

  it('throws for unregistered task kind', () => {
    const registry = new TaskPackRegistry();
    expect(() => registry.get('general')).toThrow(/not registered/i);
  });

  it('checks existence with has()', () => {
    const registry = new TaskPackRegistry();
    registry.register(createPack('general'));
    expect(registry.has('general')).toBe(true);
    expect(registry.has('analysis')).toBe(false);
  });
});
