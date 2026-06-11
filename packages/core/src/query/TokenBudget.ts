export class TokenBudget {
  constructor(
    public readonly maxTokens: number,
    public readonly maxUsd?: number
  ) {}

  private tokens = 0;
  private usd = 0;

  add(tokens: number, usd = 0): void {
    this.tokens += tokens;
    this.usd += usd;
  }

  reset(): void {
    this.tokens = 0;
    this.usd = 0;
  }

  get consumedTokens(): number {
    return this.tokens;
  }

  get consumedUsd(): number {
    return this.usd;
  }

  isExceeded(): boolean {
    if (this.maxUsd !== undefined && this.usd >= this.maxUsd) return true;
    return this.tokens >= this.maxTokens;
  }
}
