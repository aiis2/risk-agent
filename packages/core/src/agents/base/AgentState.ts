import type { Message, UsageSnapshot } from './types.js';

/**
 * AgentState — Agent 会话级可变状态
 */
export class AgentState {
  public messages: Message[] = [];
  public usage: UsageSnapshot = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  public turnCount = 0;
  public correctionRound = 0;
  public readonly permissionDenials = new Set<string>();
  public readonly discoveredSkillNames = new Set<string>();

  constructor(public readonly sessionId: string) {}

  pushMessage(m: Message): void {
    this.messages.push(m);
  }

  mergeUsage(u: Partial<UsageSnapshot>): void {
    this.usage.inputTokens += u.inputTokens ?? 0;
    this.usage.outputTokens += u.outputTokens ?? 0;
    this.usage.cachedTokens += u.cachedTokens ?? 0;
  }
}
