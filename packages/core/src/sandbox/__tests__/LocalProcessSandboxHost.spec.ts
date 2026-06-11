import { describe, expect, it } from 'vitest';
import { SandboxRuntime } from '../SandboxRuntime.js';
import { createLocalProcessSandboxHost } from '../LocalProcessSandboxHost.js';

describe('LocalProcessSandboxHost', () => {
  it('executes a local process through a lease and records audit events', async () => {
    const auditEvents: Array<{ eventType: string; details: Record<string, unknown> }> = [];
    const runtime = new SandboxRuntime([createLocalProcessSandboxHost()]);

    const lease = runtime.createLease(
      {
        kind: 'local-process',
        command: process.execPath,
        args: ['-e', 'process.stdout.write("alpha"); process.stderr.write("beta");'],
      },
      {
        sessionId: 'sess-process-1',
        entrypoint: 'chat',
        auditLogger: {
          log: async (event) => {
            auditEvents.push({ eventType: event.eventType, details: event.details });
          },
        },
      },
    );

    const envelope = await lease.execute();

    expect(envelope.hostKind).toBe('local-process');
    expect(envelope.result.success).toBe(true);
    expect(envelope.result.stdout).toBe('alpha');
    expect(envelope.result.stderr).toBe('beta');
    expect(auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['sandbox-lease-created', 'sandbox-process-started', 'sandbox-process-complete']),
    );
  });

  it('cancels an active lease and records cancellation semantics', async () => {
    const auditEvents: Array<{ eventType: string; details: Record<string, unknown> }> = [];
    const runtime = new SandboxRuntime([createLocalProcessSandboxHost()]);

    const lease = runtime.createLease(
      {
        kind: 'local-process',
        command: process.execPath,
        args: ['-e', 'setTimeout(() => process.stdout.write("late"), 5000);'],
      },
      {
        sessionId: 'sess-process-2',
        entrypoint: 'chat',
        auditLogger: {
          log: async (event) => {
            auditEvents.push({ eventType: event.eventType, details: event.details });
          },
        },
      },
    );

    const pending = lease.execute();
    setTimeout(() => lease.cancel('user_cancelled'), 50);

    const envelope = await pending;

    expect(envelope.result.success).toBe(false);
    expect(envelope.result.cancelled).toBe(true);
    expect(auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['sandbox-lease-created', 'sandbox-lease-cancelled', 'sandbox-process-cancelled']),
    );
  }, 10_000);
});