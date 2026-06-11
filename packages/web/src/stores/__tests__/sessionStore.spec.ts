import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('sessionStore workspace', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('opens sessions, updates existing metadata, and falls back when closing the active session', async () => {
    const { useSessionStore } = await import('../sessionStore');
    const store = useSessionStore.getState();

    store.openSession({ sessionId: 'session-a', businessName: '电商支付风控', status: 'running' });
    store.openSession({ sessionId: 'session-b', businessName: '贷款反欺诈', status: 'running' });
    store.openSession(
      { sessionId: 'session-a', businessName: '电商支付风控（更新）', status: 'completed', phase: 'report' },
      { activate: false }
    );

    let snapshot = useSessionStore.getState();
    expect(snapshot.openSessionIds).toEqual(['session-a', 'session-b']);
    expect(snapshot.activeSessionId).toBe('session-b');
    expect(snapshot.sessionsById['session-a']).toMatchObject({
      businessName: '电商支付风控（更新）',
      status: 'completed',
      phase: 'report',
    });

    snapshot.closeSession('session-b');

    snapshot = useSessionStore.getState();
    expect(snapshot.openSessionIds).toEqual(['session-a']);
    expect(snapshot.activeSessionId).toBe('session-a');
  });

  it('keeps workspace metadata in sync and resets cleanly', async () => {
    const { useSessionStore } = await import('../sessionStore');
    const store = useSessionStore.getState();

    store.openSession({ sessionId: 'session-c', businessName: '账户安全评估', status: 'running' });
    store.syncSessionMeta('session-c', { status: 'error', phase: 'analysis' });
    store.setFilterStatus('running');
    store.setFilterKeyword('账户');

    let snapshot = useSessionStore.getState();
    expect(snapshot.sessionsById['session-c']).toMatchObject({
      status: 'error',
      phase: 'analysis',
    });
    expect(snapshot.filterStatus).toBe('running');
    expect(snapshot.filterKeyword).toBe('账户');

    snapshot.reset();

    snapshot = useSessionStore.getState();
    expect(snapshot.openSessionIds).toEqual([]);
    expect(snapshot.sessionsById).toEqual({});
    expect(snapshot.activeSessionId).toBeNull();
    expect(snapshot.filterStatus).toBe('');
    expect(snapshot.filterKeyword).toBe('');
  });
});