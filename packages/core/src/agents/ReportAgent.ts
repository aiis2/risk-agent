import type { StreamEvent } from './base/types.js';
import { BaseAgent, type AgentRunOptions } from './base/BaseAgent.js';

export class ReportAgent extends BaseAgent {
  async *run(_opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined> {
    yield { type: 'subagent_spawned', agentId: 'report', description: '生成缺口分析报告', taskType: 'subagent', workerRole: 'report' };
    yield { type: 'subagent_complete', agentId: 'report', status: 'completed', summary: 'report noop' };
  }
}
