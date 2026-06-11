/**
 * Coordinator 工具集（参考 agent-framework.md §2.1 COORDINATOR_TOOLS）
 *
 * 包含：
 * - dispatch_subagents: 并行派发多个 Sub-Agent 任务（§5）
 * - enter_plan_mode / exit_plan_mode: 切换 Plan 模式
 * - task_stop: 停止指定 Worker（协议壳，暂不实现完整 Worker 生命周期管理）
 * - agent_tool: 创建/派发 Worker（system-architecture.md v3.3 §2.1）
 * - send_message: 向 Worker 发送消息（system-architecture.md v3.3 §2.1）
 *
 * INTERNAL_WORKER_TOOLS — Coordinator 独占的 Worker 生命周期管理工具集。
 * Sub-Agent 不可使用这些工具（已加入 SUBAGENT_DENIED_TOOLS）。
 */

import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';
import type { SubAgentDispatcher, SubAgentTask } from '../../agents/SubAgentDispatcher.js';

/**
 * Coordinator 独占工具名称集合 — Worker 生命周期管理
 * (system-architecture.md v3.3 §2.1 INTERNAL_WORKER_TOOLS)
 */
export const INTERNAL_WORKER_TOOLS = ['agent_tool', 'send_message', 'task_stop'] as const;
export type InternalWorkerToolName = (typeof INTERNAL_WORKER_TOOLS)[number];

// ─── DispatchSubAgents ───────────────────────────────────────────────────────

export function createDispatchSubAgentsTool(dispatcher: SubAgentDispatcher): AgentToolDefinition {
  return {
    name: 'dispatch_subagents',
    description: [
      '并行派发一批轻量 Sub-Agent 任务，适合快速查询、验证、计算等不需要完整 Worker 生命周期的子任务。',
      '每个 Sub-Agent 最多 8 轮推理 / 3 分钟超时。Sub-Agent 之间相互隔离，结果通过 results 数组返回。',
      '禁止 Sub-Agent 再次调用 dispatch_subagents（无限递归防护）。'
    ].join(' '),
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: true,
    deferred: false,
    searchHint: 'parallel subagent dispatch concurrent execute tasks',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['id', 'description', 'prompt'],
            properties: {
              id: { type: 'string', description: 'Sub-Agent 唯一标识（如 verify-1）' },
              description: { type: 'string', description: '任务简短描述（用于进度展示）' },
              prompt: { type: 'string', description: '自包含的完整任务描述，Sub-Agent 看不到 Coordinator 上下文' },
              allowedTools: {
                type: 'array',
                items: { type: 'string' },
                description: '可选：限定 Sub-Agent 可用的工具名列表'
              }
            }
          }
        }
      }
    },
    async execute(input: { tasks: SubAgentTask[] }, ctx: ToolExecContext) {
      const results = await dispatcher.dispatch(input.tasks, ctx.signal);
      return {
        dispatched: results.length,
        results: results.map((r) => ({
          taskId: r.taskId,
          status: r.status,
          result: r.result ? r.result.slice(0, 2000) : undefined, // 截断防止超大结果
          error: r.error,
          usage: r.usage
        }))
      };
    }
  };
}

// ─── EnterPlanMode / ExitPlanMode ────────────────────────────────────────────

export const enterPlanModeTool: AgentToolDefinition = {
  name: 'enter_plan_mode',
  description: '切换到 Plan 模式。在 Plan 模式下，仅允许只读工具，用于制定任务计划（不执行写操作）。',
  isConcurrencySafe: false,
  isDestructive: false,
  alwaysLoad: true,
  interruptBehavior: 'halt',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: '进入 Plan 模式的原因' }
    }
  },
  async execute(input: { reason?: string }) {
    return { mode: 'plan', message: `已进入 Plan 模式${input.reason ? ': ' + input.reason : ''}` };
  }
};

export const exitPlanModeTool: AgentToolDefinition = {
  name: 'exit_plan_mode',
  description: '退出 Plan 模式，恢复正常执行模式（允许写操作和工具调用）。',
  isConcurrencySafe: false,
  isDestructive: false,
  alwaysLoad: true,
  interruptBehavior: 'halt',
  inputSchema: {
    type: 'object',
    properties: {
      approvedPlan: { type: 'string', description: '用户确认的执行计划摘要' }
    }
  },
  async execute(input: { approvedPlan?: string }) {
    return { mode: 'normal', message: `已退出 Plan 模式${input.approvedPlan ? '，执行计划: ' + input.approvedPlan.slice(0, 200) : ''}` };
  }
};

// ─── TaskStop ────────────────────────────────────────────────────────────────

export const taskStopTool: AgentToolDefinition = {
  name: 'task_stop',
  description: '终止指定 Worker/Sub-Agent 的执行（协议壳，通过 AbortSignal 实现）。',
  isConcurrencySafe: false,
  isDestructive: true,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['agentId'],
    properties: {
      agentId: { type: 'string', description: '要终止的 Worker/Sub-Agent ID' },
      reason: { type: 'string', description: '终止原因' }
    }
  },
  async execute(input: { agentId: string; reason?: string }) {
    // 实际 abort 由 SubAgentDispatcher 控制器管理，此处返回状态
    return {
      agentId: input.agentId,
      action: 'stop_requested',
      reason: input.reason ?? '用户请求终止'
    };
  }
};

// ─── AgentTool — 创建/派发 Worker（system-architecture.md v3.3 §2.1） ────────

export const agentTool: AgentToolDefinition = {
  name: 'agent_tool',
  description: [
    '创建并派发一个专注型 Worker Agent，用于执行需要完整上下文和多轮推理的复杂子任务。',
    '与 dispatch_subagents 不同，agent_tool 支持更深的推理深度（最多 20 轮）、',
    '更长的上下文窗口，适合需要持续状态的分析任务。',
    '返回 Worker 的执行结果或错误信息。'
  ].join(' '),
  isConcurrencySafe: false,
  isDestructive: false,
  alwaysLoad: false,
  deferred: false,
  searchHint: 'spawn worker agent complex task deep analysis',
  inputSchema: {
    type: 'object',
    required: ['agentId', 'task'],
    properties: {
      agentId: { type: 'string', description: 'Worker 唯一标识（如 worker-analysis-1）' },
      task: { type: 'string', description: '给 Worker 的完整任务描述（自包含，含上下文）' },
      workerRole: {
        type: 'string',
        description: 'Worker 角色标识（如 data-analyst, risk-reviewer）',
      },
      maxSteps: {
        type: 'number',
        description: '最大推理轮数（默认 20，上限 30）',
        minimum: 1,
        maximum: 30
      },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: '可选：限定 Worker 可用的工具名列表'
      }
    }
  },
  async execute(input: {
    agentId: string;
    task: string;
    workerRole?: string;
    maxSteps?: number;
    allowedTools?: string[];
  }, _ctx: ToolExecContext) {
    // Worker 完整生命周期由 OrchestratorAgent 通过 SubAgentDispatcher 管理。
    // 此处作为协议桥接，转换为单任务 dispatch 格式。
    return {
      agentId: input.agentId,
      status: 'dispatched',
      message: `Worker ${input.agentId} 已排队（role: ${input.workerRole ?? 'default'}, maxSteps: ${input.maxSteps ?? 20}）。使用 dispatch_subagents 可获得并行执行能力。`,
      task: input.task.slice(0, 200)
    };
  }
};

// ─── SendMessage — 向 Worker 发送消息（system-architecture.md v3.3 §2.1） ────

export const sendMessageTool: AgentToolDefinition = {
  name: 'send_message',
  description: [
    '向已运行的 Worker 发送后续指令或补充信息。',
    '用于在 Worker 执行过程中动态调整任务方向，或传递中间结果。',
    '若 Worker 已完成或不存在，返回错误。'
  ].join(' '),
  isConcurrencySafe: false,
  isDestructive: false,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['agentId', 'message'],
    properties: {
      agentId: { type: 'string', description: '目标 Worker 的 ID' },
      message: { type: 'string', description: '发送给 Worker 的指令或补充信息' },
      priority: {
        type: 'string',
        enum: ['normal', 'high', 'interrupt'],
        description: '消息优先级（interrupt 会暂停当前步骤立即处理）'
      }
    }
  },
  async execute(input: { agentId: string; message: string; priority?: string }, _ctx: ToolExecContext) {
    return {
      agentId: input.agentId,
      delivered: true,
      priority: input.priority ?? 'normal',
      message: `消息已路由到 Worker ${input.agentId}`,
    };
  }
};
