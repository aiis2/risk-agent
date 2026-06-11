/**
 * CostTracker — 按 session / model 累计 token 与 USD，支持可选的快照回调（用于持久化到 `cost_snapshots`）。
 */
export interface CostRecord {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheCreationTokens: number;
  estimatedUsd: number;
  updatedAt: number;
}

export interface CostUpdate {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheCreationTokens?: number;
  estimatedUsd: number;
}

export type CostSnapshotWriter = (update: CostRecord) => void | Promise<void>;

export class CostTracker {
  private readonly records = new Map<string, CostRecord>();
  private writer: CostSnapshotWriter | null = null;

  onSnapshot(writer: CostSnapshotWriter): void {
    this.writer = writer;
  }

  add(sessionId: string, model: string, u: CostUpdate): CostRecord {
    const key = `${sessionId}::${model}`;
    const prev =
      this.records.get(key) ??
      ({
        sessionId,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        estimatedUsd: 0,
        updatedAt: 0
      } as CostRecord);
    const next: CostRecord = {
      sessionId,
      model,
      inputTokens: prev.inputTokens + u.inputTokens,
      outputTokens: prev.outputTokens + u.outputTokens,
      cachedTokens: prev.cachedTokens + u.cachedTokens,
      cacheCreationTokens: prev.cacheCreationTokens + (u.cacheCreationTokens ?? 0),
      estimatedUsd: prev.estimatedUsd + u.estimatedUsd,
      updatedAt: Date.now()
    };
    this.records.set(key, next);
    if (this.writer) {
      try {
        const p = this.writer(next);
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => {
            /* best-effort persistence */
          });
        }
      } catch {
        /* ignore writer errors */
      }
    }
    return next;
  }

  getSession(sessionId: string): CostRecord[] {
    return Array.from(this.records.values()).filter((r) => r.sessionId === sessionId);
  }

  total(sessionId: string): { tokens: number; usd: number; cachedTokens: number; cacheCreationTokens: number } {
    let tokens = 0;
    let usd = 0;
    let cachedTokens = 0;
    let cacheCreationTokens = 0;
    for (const r of this.getSession(sessionId)) {
      tokens += r.inputTokens + r.outputTokens;
      usd += r.estimatedUsd;
      cachedTokens += r.cachedTokens;
      cacheCreationTokens += r.cacheCreationTokens;
    }
    return { tokens, usd, cachedTokens, cacheCreationTokens };
  }
}
