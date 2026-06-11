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

describe('chatStore result fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('renders the final result text even when no text_delta event was emitted', async () => {
    const { useChatStore } = await import('../chatStore');
    const sessionId = 'session-result-fallback';

    useChatStore.getState().resetConversation(sessionId, '电商支付风控');
    useChatStore.getState().appendEvent(sessionId, {
      type: 'result',
      result: '整体覆盖率 0%，共涉及 0 个业务场景。',
      is_error: false,
    });

    const conversation = useChatStore.getState().getConversation(sessionId);
    expect(conversation?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '整体覆盖率 0%，共涉及 0 个业务场景。',
    });
    expect(conversation?.sessionState).toBe('done');
  });
});