import type { StreamEvent, Message, WorkerConfig } from './types.js';
import { AgentState } from './AgentState.js';

/**
 * BaseAgent — Coordinator / Worker / SubAgent 共享入口
 */
export interface AgentRunOptions {
  prompt: string;
  signal?: AbortSignal;
  messages?: Message[];
  workerConfig?: WorkerConfig;
  model?: string;
  askUserResolver?: (question: string, options?: string[]) => Promise<string>;
}

export abstract class BaseAgent {
  protected readonly state: AgentState;

  constructor(public readonly sessionId: string) {
    this.state = new AgentState(sessionId);
  }

  abstract run(opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined>;

  getState(): AgentState {
    return this.state;
  }
}
