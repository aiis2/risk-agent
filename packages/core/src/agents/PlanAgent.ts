/**
 * PlanAgent — 规划层 Agent（参考 agent-framework.md §2.2）
 *
 * PlanAgent 在复杂任务执行前先做规划，产出 TaskPlan 后移交 Coordinator。
 * 核心能力：
 * - 分析用户任务，拆解为 phases（research / synthesis / implementation / verification）
 * - 识别需要澄清的问题（clarifications）
 * - 预估步骤数（estimatedSteps）
 * - 输出结构化 TaskPlan → 供 OrchestratorAgent 执行
 */

import { randomUUID } from 'node:crypto';
import type { StreamEvent, TaskPlan } from './base/types.js';
import { BaseAgent, type AgentRunOptions } from './base/BaseAgent.js';
import type { LLMAdapter } from '../llm/LLMAdapter.js';
import type { PromptAssembler } from '../prompt/PromptAssembler.js';
import type { CostTracker } from '../cost/CostTracker.js';
import { createLogger } from '../logger.js';

const log = createLogger('PlanAgent');

export interface PlanAgentOptions {
  sessionId: string;
  llm: LLMAdapter;
  prompts: PromptAssembler;
  cost: CostTracker;
  model: string;
  locale?: string;
}

/**
 * 从 LLM 输出文本中提取 JSON TaskPlan（支持 ```json 包裹和裸 JSON 两种格式）
 */
function extractTaskPlan(text: string, sessionId: string, prompt: string): TaskPlan {
  // 尝试提取 JSON 代码块
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (jsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      return {
        taskId: parsed.taskId ?? randomUUID(),
        parentTaskId: parsed.parentTaskId,
        taskType: 'local_workflow',
        description: parsed.description ?? prompt.slice(0, 100),
        ...parsed
      };
    } catch {
      /* fall through */
    }
  }

  // Fallback：构建最小可用计划
  log.warn({ sessionId }, 'LLM did not return valid JSON plan, using fallback');
  return {
    taskId: randomUUID(),
    taskType: 'local_workflow',
    description: prompt.slice(0, 200),
    phase: 'research'
  };
}

export class PlanAgent extends BaseAgent {
  constructor(private readonly options: PlanAgentOptions) {
    super(options.sessionId);
  }

  async *run(opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined> {
    const { llm, prompts, cost, model, locale } = this.options;
    const prompt = opts.prompt;

    yield {
      type: 'subagent_spawned',
      agentId: 'plan-agent',
      description: '任务规划',
      taskType: 'local_agent',
      phase: 'research'
    };

    const systemPrompt = await prompts.compile({
      sessionId: this.sessionId,
      locale,
      workerRole: 'plan',
      instructions: [
        '你是 Risk Agent 的规划专家。',
        '分析用户任务，输出结构化的 JSON TaskPlan。',
        '若任务不清晰，在 clarifications 字段列出需要澄清的问题。',
        '',
        'TaskPlan 格式：',
        '```json',
        '{',
        '  "taskId": "<uuid>",',
        '  "taskType": "local_workflow",',
        '  "description": "<任务概述>",',
        '  "estimatedSteps": <数字>,',
        '  "clarifications": ["<问题1>", ...],',
        '  "phases": [',
        '    { "name": "research", "description": "<并行调研内容>", "concurrency": "parallel" },',
        '    { "name": "synthesis", "description": "<综合分析>", "concurrency": "serial" },',
        '    { "name": "implementation", "description": "<报告生成>", "concurrency": "serial" },',
        '    { "name": "verification", "description": "<结果验证>", "concurrency": "serial" }',
        '  ]',
        '}',
        '```'
      ].join('\n')
    });

    yield { type: 'turn_info', current: 1, max: 1, estimatedTokens: 0 };

    let planResult: TaskPlan;
    try {
      const result = await llm.call({
        model,
        systemPrompt,
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        temperature: 0.3,
        maxTokens: 1024,
        signal: opts.signal
      });

      cost.add(this.sessionId, model, result.usage);

      yield {
        type: 'cost_update',
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        estimatedUsd: result.usage.estimatedUsd
      };

      if (result.text) {
        yield { type: 'text_delta', text: result.text };
        yield { type: 'text_complete', fullText: result.text };
      }

      planResult = extractTaskPlan(result.text, this.sessionId, prompt);
    } catch (err: unknown) {
      log.error({ err }, 'PlanAgent LLM call failed, using fallback plan');
      planResult = {
        taskId: randomUUID(),
        taskType: 'local_workflow',
        description: prompt.slice(0, 200),
        phase: 'research'
      };
    }

    // 发布计划事件（前端可展示计划详情）
    yield { type: 'plan', plan: planResult };

    // 若有澄清问题，通过 ask_user 向用户提问
    const clarifications = (planResult as unknown as { clarifications?: string[] }).clarifications;
    if (clarifications?.length && opts.askUserResolver) {
      for (const question of clarifications.slice(0, 3)) {
        const requestId = randomUUID();
        yield { type: 'ask_user', question, requestId };
        try {
          const answer = await opts.askUserResolver(question);
          yield { type: 'user_answer', requestId, answer };
        } catch {
          /* 用户未回复，忽略 */
        }
      }
    }

    yield {
      type: 'subagent_complete',
      agentId: 'plan-agent',
      status: 'completed',
      summary: `计划已生成: ${planResult.description?.slice(0, 80)}`
    };
  }
}
