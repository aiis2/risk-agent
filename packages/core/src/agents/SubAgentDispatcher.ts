/**
 * SubAgentDispatcher — Sub-Agent 隔离执行系统（参考 agent-framework.md §5）
 *
 * 设计：
 * - Sub-Agent 是 Coordinator spawn 的轻量一次性执行单元
 * - 最大 8 轮推理、3 分钟超时、无嵌套、无 ask_user
 * - 支持 Promise.allSettled 并行批量派发
 * - 每个 Sub-Agent 拥有独立 AbortController（父级 abort + 自身超时合并）
 */

import type { LLMAdapter } from '../llm/LLMAdapter.js';
import type { ToolRegistry } from '../tools/registry/ToolRegistry.js';
import type { PromptAssembler } from '../prompt/PromptAssembler.js';
import type { CostTracker } from '../cost/CostTracker.js';
import type { StreamEvent } from '../agents/base/types.js';
import { QueryEngine, type QueryEngineConfig } from '../query/QueryEngine.js';
import { createLogger } from '../logger.js';

const log = createLogger('SubAgentDispatcher');

// ── Sub-Agent 受限工具黑名单（不可嵌套、不可交互） ──────────────────────────
const SUBAGENT_DENIED_TOOLS = new Set([
  'dispatch_subagents',
  'agent_tool',
  'send_message',
  'task_stop',
  'ask_user',
  'enter_plan_mode',
  'exit_plan_mode'
]);

/**
 * Sub-Agent 安全配置（10-sandbox-security.md §5）
 * 权限收窄：最大 8 轮、更激进压缩、不可嵌套、不可交互
 */
export const SUB_AGENT_SECURITY = {
  maxSteps: 8,
  compactThresholdTokens: 30_000,
  toolExecutionTimeoutMs: 60_000,
  totalTimeoutMs: 3 * 60 * 1_000,   // 3 分钟
  forbiddenCapabilities: [
    'ask_user',
    'spawn_sub_agent',
    'alert_send',
    'config_write',
  ] as string[],
  allowedToolNames: [
    'query_database',
    'web_fetch',
    'read_file',
    'search_code',
    'run_js_sandbox',
    'graph_read',
  ] as string[],
} as const;

export const SUBAGENT_CONFIG: Partial<QueryEngineConfig> = {
  agentType: 'subagent',
  maxSteps: SUB_AGENT_SECURITY.maxSteps,
  compactThresholdTokens: SUB_AGENT_SECURITY.compactThresholdTokens,
  toolTimeoutMs: SUB_AGENT_SECURITY.toolExecutionTimeoutMs,
  llmRetryAttempts: 2,
  llmRetryBaseDelayMs: 1_000,
  maxCorrectionRounds: 0 // Sub-Agent 不执行纠错循环
};

const PER_SUBAGENT_TIMEOUT_MS = SUB_AGENT_SECURITY.totalTimeoutMs;

export interface SubAgentTask {
  id: string;
  description: string;
  /** 自包含的完整 prompt（Sub-Agent 看不到 Coordinator 上下文） */
  prompt: string;
  /** 可选：指定允许的工具子集（不传则用受限全集） */
  allowedTools?: string[];
}

export interface SubAgentResult {
  taskId: string;
  status: 'completed' | 'failed' | 'timeout';
  result?: string;
  error?: string;
  usage: {
    tokens: number;
    steps: number;
    durationMs: number;
  };
}

export class SubAgentDispatcher {
  constructor(
    private readonly llm: LLMAdapter,
    private readonly prompts: PromptAssembler,
    private readonly tools: ToolRegistry,
    private readonly cost: CostTracker
  ) {}

  /**
   * 并行派发一批 Sub-Agent 任务（Promise.allSettled）。
   * 每个任务独立超时控制，单任务失败不影响其他任务。
   */
  async dispatch(
    tasks: SubAgentTask[],
    parentSignal?: AbortSignal
  ): Promise<SubAgentResult[]> {
    log.info({ count: tasks.length }, 'Dispatching sub-agents');

    const settled = await Promise.allSettled(
      tasks.map((task) => this.runSingleTask(task, parentSignal))
    );

    return settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        taskId: tasks[i].id,
        status: 'failed' as const,
        error: (r.reason as Error)?.message ?? String(r.reason),
        usage: { tokens: 0, steps: 0, durationMs: 0 }
      };
    });
  }

  /**
   * 派发并 yield StreamEvent（用于 Coordinator 工具调用时实时推送进度）
   * 依次：subagent_spawned → subagent_progress(running) → 并行执行 → subagent_complete
   */
  async *dispatchStreaming(
    tasks: SubAgentTask[],
    parentSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent, SubAgentResult[]> {
    // 1. 广播所有任务 spawned + 初始 running 状态
    for (const task of tasks) {
      yield {
        type: 'subagent_spawned',
        agentId: task.id,
        description: task.description,
        taskType: 'subagent'
      };
      yield {
        type: 'subagent_progress',
        agentId: task.id,
        text: '已排队，等待执行…'
      };
    }

    // 2. 并行执行（用 channel 模式以便在完成时立即 yield）
    type ResultEntry = { result: SubAgentResult; index: number };
    const channel: ResultEntry[] = [];

    const allPromises = tasks.map((task, index) =>
      this.runSingleTask(task, parentSignal).then((result) => {
        channel.push({ result, index });
        return result;
      })
    );

    // 等待所有任务完成，同时 yield 完成事件
    const settled = await Promise.allSettled(allPromises);

    // 3. yield 完成事件（按完成顺序）
    for (const entry of channel) {
      const r = entry.result;
      yield {
        type: 'subagent_complete',
        agentId: r.taskId,
        status: r.status === 'completed' ? 'completed' : 'failed',
        summary: r.result ?? r.error ?? 'no result'
      };
    }

    // 4. 补全任何未在 channel 中的（Promise.allSettled rejected 情况）
    const returnResults = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        taskId: tasks[i].id,
        status: 'failed' as const,
        error: (r.reason as Error)?.message ?? String(r.reason),
        usage: { tokens: 0, steps: 0, durationMs: 0 }
      };
    });

    return returnResults;
  }

  private async runSingleTask(
    task: SubAgentTask,
    parentSignal?: AbortSignal
  ): Promise<SubAgentResult> {
    const startTime = Date.now();
    const controller = new AbortController();

    // 合并信号：父级 abort + 自身超时
    const timeout = setTimeout(() => controller.abort(), PER_SUBAGENT_TIMEOUT_MS);
    if (parentSignal) {
      parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      // 构建受限工具列表（过滤黑名单工具）
      const allowedTools = task.allowedTools
        ? this.tools.list().filter(
            (t) => task.allowedTools!.includes(t.name) && !SUBAGENT_DENIED_TOOLS.has(t.name)
          )
        : this.tools.list().filter((t) => !SUBAGENT_DENIED_TOOLS.has(t.name));

      // 创建独立 QueryEngine 实例（Sub-Agent 隔离）
      const engine = new QueryEngine(this.llm, this.prompts, this.tools, this.cost, {
        ...SUBAGENT_CONFIG,
        sessionId: `subagent:${task.id}`,
        model: '', // 由 LLMAdapter 使用默认配置
        allowedToolNames: allowedTools.map((t) => t.name)
      });

      let finalResult = '';
      let stepCount = 0;

      for await (const event of engine.submitMessage(task.prompt, { signal: controller.signal })) {
        if (event.type === 'text_complete') finalResult = event.fullText;
        if (event.type === 'turn_info') stepCount = event.current;
        if (event.type === 'result') {
          finalResult = event.result || finalResult;
        }
      }

      // 超时检测：若仍被 abort，转为 timeout 状态
      if (controller.signal.aborted) {
        return {
          taskId: task.id,
          status: 'timeout',
          error: `Sub-Agent ${task.id} 执行超时 (${PER_SUBAGENT_TIMEOUT_MS / 1000}s)`,
          usage: { tokens: 0, steps: stepCount, durationMs: Date.now() - startTime }
        };
      }

      return {
        taskId: task.id,
        status: 'completed',
        result: finalResult,
        usage: { tokens: 0, steps: stepCount, durationMs: Date.now() - startTime }
      };
    } catch (err: unknown) {
      const isTimeout = controller.signal.aborted;
      return {
        taskId: task.id,
        status: isTimeout ? 'timeout' : 'failed',
        error: (err as Error)?.message ?? String(err),
        usage: { tokens: 0, steps: 0, durationMs: Date.now() - startTime }
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
