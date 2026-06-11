import { describe, expect, it, vi } from 'vitest';
import type { RunArtifact, RunCheckpoint, RunEvent, RunSnapshot, TaskPackContext } from '../../../harness/types.js';
import { GeneralTaskPack } from '../GeneralTaskPack.js';

function createContext(runId = 'run_general') {
  const checkpoints: RunCheckpoint[] = [];
  const events: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
  const artifacts: RunArtifact[] = [];

  const run: RunSnapshot = {
    runId,
    taskKind: 'general',
    status: 'running',
    input: { prompt: '总结附件中的风险重点' },
    routing: {
      acceptedTaskKind: 'general',
      confidence: 1,
      reason: 'test',
      routeParams: {},
    },
    metrics: {
      turnCount: 0,
      toolCallCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      estimatedUsd: 0,
    },
    createdAt: '2026-04-27T08:00:00.000Z',
    updatedAt: '2026-04-27T08:00:00.000Z',
  };

  const ctx: TaskPackContext = {
    run,
    signal: new AbortController().signal,
    now: () => '2026-04-27T08:00:00.000Z',
    emit: async (event) => {
      events.push(event);
      return {
        eventId: `evt_${events.length}`,
        runId,
        type: event.type,
        payload: event.payload,
        createdAt: '2026-04-27T08:00:00.000Z',
      };
    },
    createSemanticCheckpoint: async (kind, snapshot) => {
      const checkpoint: RunCheckpoint = {
        checkpointId: `chk_${kind}_${checkpoints.length + 1}`,
        runId,
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: checkpoints.length + 1,
        createdAt: '2026-04-27T08:00:00.000Z',
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    requestUserInput: async () => ({ input: '确认', approved: true }),
    publishArtifact: async (artifact) => {
      const published: RunArtifact = {
        artifactId: `art_${artifacts.length + 1}`,
        runId,
        version: artifacts.length + 1,
        createdAt: '2026-04-27T08:00:00.000Z',
        ...artifact,
      };
      artifacts.push(published);
      return published;
    },
  };

  return { ctx, checkpoints, events, artifacts };
}

describe('GeneralTaskPack', () => {
  it('auto-runs query engine for explicit web-search requests without manual tool selection', async () => {
    let queryEngineCalls = 0;
    const pack = new GeneralTaskPack({
      createQueryEngine: () => {
        queryEngineCalls += 1;
        return ({
          async *submitMessage() {
            yield {
              type: 'text_delta',
              text: '已读取配置并完成联网搜索。',
            };
          },
        }) as any;
      },
    });
    const { ctx } = createContext('run_general_soft_hint');

    const normalized = await pack.intake(
      {
        prompt: '先读取当前 web search 配置，然后联网搜索 Tavily changelog 最新内容。',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(plan.responseModeHint).toBe('tool-assisted');
    expect(queryEngineCalls).toBe(1);
    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      response: '已读取配置并完成联网搜索。',
    });
  });

  it('respects an explicit tool-assisted hint from the orchestrator without manual tool selection', async () => {
    const submittedPrompts: string[] = [];
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage(prompt: string) {
            submittedPrompts.push(prompt);
            yield {
              type: 'text_delta',
              text: '已读取配置并完成联网搜索。',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_orchestrated_hint');

    const normalized = await pack.intake(
      {
        prompt: '先读取当前 web search 配置，然后联网搜索 Tavily changelog 最新内容。',
        responseModeHint: 'tool-assisted',
        _orchestratorHint: true,
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(plan.responseModeHint).toBe('tool-assisted');
    expect(submittedPrompts).toEqual(['先读取当前 web search 配置，然后联网搜索 Tavily changelog 最新内容。']);
    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      response: '已读取配置并完成联网搜索。',
    });
  });

  it('auto-runs query engine for live weather prompts even without explicit tool selection', async () => {
    const submittedPrompts: string[] = [];
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage(prompt: string) {
            submittedPrompts.push(prompt);
            yield {
              type: 'text_delta',
              text: '上海天气：多云 24°C',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_weather_auto');

    const normalized = await pack.intake(
      {
        prompt: '今天上海天气怎么样？',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(plan.responseModeHint).toBe('tool-assisted');
    expect(submittedPrompts).toEqual(['今天上海天气怎么样？']);
    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      response: '上海天气：多云 24°C',
    });
  });

  it('auto-runs query engine for browser URL prompts even without explicit tool selection', async () => {
    const submittedPrompts: string[] = [];
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage(prompt: string) {
            submittedPrompts.push(prompt);
            yield {
              type: 'text_delta',
              text: '页面标题：Example Domain；图片数量：0。',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_browser_auto');

    const normalized = await pack.intake(
      {
        prompt: '请用内置浏览器访问 https://example.com ，然后告诉我页面标题和图片数量。',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(plan.responseModeHint).toBe('tool-assisted');
    expect(submittedPrompts).toEqual(['请用内置浏览器访问 https://example.com ，然后告诉我页面标题和图片数量。']);
    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      response: '页面标题：Example Domain；图片数量：0。',
    });
  });

  it('ignores an orchestrator tool-assisted hint for trivial prompts without tool-worthy content', async () => {
    let queryEngineCalls = 0;
    const pack = new GeneralTaskPack({
      createQueryEngine: () => {
        queryEngineCalls += 1;
        return ({
          async *submitMessage() {
            yield {
              type: 'text_delta',
              text: '5',
            };
          },
        }) as any;
      },
    });
    const { ctx } = createContext('run_general_orchestrated_trivial_prompt');

    const normalized = await pack.intake(
      {
        prompt: '2+3',
        responseModeHint: 'tool-assisted',
        _orchestratorHint: true,
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(plan.responseModeHint).toBe('answer-only');
    expect(queryEngineCalls).toBe(0);
    expect(execution.value).toMatchObject({
      responseMode: 'answer-only',
      response: '已收到您的请求：2+3',
    });
  });

  it('uses the latest follow-up guidance as the active prompt for explicit tool-assisted runs', async () => {
    const submittedPrompts: string[] = [];
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage(prompt: string) {
            submittedPrompts.push(prompt);
            yield {
              type: 'text_delta',
              text: '上海天气：多云 24°C',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_follow_up');

    const normalized = await pack.intake(
      {
        prompt: '你好',
        guidanceMessages: ['请通过 playwright 查询上海天气'],
        toolIds: ['playwright_web_scrape'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(submittedPrompts).toEqual(['请通过 playwright 查询上海天气']);
    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      response: '上海天气：多云 24°C',
    });
  });

  it('bridges QueryEngine ask_user approval through requestUserInput for tool-assisted runs', async () => {
    const prompts: Array<{ question: string; options?: string[] }> = [];
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage(_prompt: string, options?: { askUserResolver?: (question: string, options?: string[]) => Promise<string> }) {
            await options?.askUserResolver?.('批准 package_manager_write 吗？', ['批准', '拒绝']);
            yield {
              type: 'text_delta',
              text: '依赖变更已批准。',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_tool_approval');
    ctx.requestUserInput = async ({ question, options }) => {
      prompts.push({ question, options });
      return { input: '批准', option: '批准', approved: true };
    };

    const normalized = await pack.intake(
      {
        prompt: '添加 lodash 依赖',
        toolIds: ['package_manager_write'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(prompts).toEqual([
      {
        question: '批准 package_manager_write 吗？',
        options: ['批准', '当前会话都批准', '拒绝'],
      },
    ]);
    expect(execution.value).toMatchObject({
      response: '依赖变更已批准。',
    });
  });

  it('surfaces tool-assisted budget stops to the orchestrator instead of silently falling back', async () => {
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage() {
            yield {
              type: 'query_stopped',
              reason: 'budget_exceeded',
            };
            yield {
              type: 'result',
              stop_reason: 'budget_exceeded',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_budget_stop');

    const normalized = await pack.intake(
      {
        prompt: '请用浏览器抓取网页并总结',
        responseModeHint: 'tool-assisted',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      continuationStop: {
        code: 'budget',
      },
    });
  });

  it('surfaces approval stops to the orchestrator when tool approval is rejected', async () => {
    const pack = new GeneralTaskPack({
      createQueryEngine: () =>
        ({
          async *submitMessage() {
            yield {
              type: 'tool_error',
              toolName: 'package_manager_write',
              error: 'User rejected tool approval for package_manager_write',
            };
            yield {
              type: 'result',
              stop_reason: 'natural_stop',
            };
          },
        }) as any,
    });
    const { ctx } = createContext('run_general_approval_stop');

    const normalized = await pack.intake(
      {
        prompt: '添加 lodash 依赖',
        responseModeHint: 'tool-assisted',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(execution.value).toMatchObject({
      responseMode: 'tool-assisted',
      continuationStop: {
        code: 'approval',
      },
    });
  });

  it('does not trigger ambiguity clarification when the conversational model call fails', async () => {
    const requestUserInput = vi.fn(async () => ({ input: '直接回答', option: '直接回答', approved: true }));
    const pack = new GeneralTaskPack({
      llmAdapter: {
        providerId: 'test-llm',
        call: vi.fn(async () => {
          throw new Error('Rate limit exceeded: free-models-per-day');
        }),
      },
      model: 'test-model',
    });
    const { ctx, events } = createContext('run_general_llm_failure_no_ambiguity');
    ctx.requestUserInput = requestUserInput;

    const normalized = await pack.intake(
      {
        prompt: '2+3',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(requestUserInput).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'agent_status',
        payload: expect.objectContaining({
          message: expect.stringContaining('通用对话模型调用失败'),
        }),
      }),
    ]));
    expect(execution.value).toMatchObject({
      responseMode: 'answer-only',
      response: '已收到您的请求：2+3',
    });
  });

  it('uses attachment context when file parsing is enabled', async () => {
    const pack = new GeneralTaskPack();
    const { ctx } = createContext();

    const normalized = await pack.intake(
      {
        prompt: '总结附件中的风险重点',
        guidanceMessages: ['重点关注异常登录链路'],
        attachmentIds: ['att_evidence'],
        attachmentContext: '附件上下文：\n- evidence.txt (text/plain, 32 bytes)\n  摘要: 异常登录与设备切换在 5 分钟内连续出现，并伴随高频失败重试。',
        toolIds: ['file_parse', 'web_fetch'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      responseMode: 'attachment-grounded',
      capabilities: expect.objectContaining({
        fileAnalysis: true,
        webResearch: true,
      }),
      evidence: expect.arrayContaining([
        expect.stringContaining('异常登录与设备切换在 5 分钟内连续出现'),
      ]),
    });
  });

  it('falls back to a restricted path when attachments are present but file parsing is disabled', async () => {
    const pack = new GeneralTaskPack();
    const { ctx } = createContext('run_general_restricted');

    const normalized = await pack.intake(
      {
        prompt: '总结附件中的风险重点',
        attachmentIds: ['att_evidence'],
        attachmentContext: '附件上下文：\n- evidence.txt (text/plain, 32 bytes)\n  摘要: 异常登录与设备切换在 5 分钟内连续出现，并伴随高频失败重试。',
        toolIds: ['web_fetch'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      responseMode: 'restricted',
      capabilities: expect.objectContaining({
        fileAnalysis: false,
        webResearch: true,
      }),
      notes: expect.arrayContaining([
        expect.stringContaining('未启用文件解析工具'),
      ]),
      evidence: [],
    });
  });

  it('emits a post-run skill proposal artifact for grounded general workflows', async () => {
    const pack = new GeneralTaskPack();
    const { ctx } = createContext('run_general_proposal');

    const normalized = await pack.intake(
      {
        prompt: '总结附件中的风险重点并整理问题列表',
        guidanceMessages: ['重点关注异常登录链路'],
        attachmentIds: ['att_evidence'],
        attachmentContext: '附件上下文：\n- evidence.txt (text/plain, 32 bytes)\n  摘要: 异常登录与设备切换在 5 分钟内连续出现，并伴随高频失败重试。',
        toolIds: ['file_parse', 'query_database'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();
    const projected = await pack.projectResult(execution.value, ctx);

    expect(projected).toHaveLength(2);
    expect(projected[1]).toMatchObject({
      kind: 'json',
      mimeType: 'application/json',
      contentJson: expect.objectContaining({
        type: 'skill-proposal',
        sourceRunId: 'run_general_proposal',
        taskKind: 'general',
        publishHint: expect.stringContaining('/api/skills'),
        creationPayload: expect.objectContaining({
          name: expect.stringMatching(/^general-/),
          description: expect.stringContaining('可复用技能'),
          content: expect.stringContaining('## Workflow'),
        }),
      }),
    });
  });

  it('unwraps structured conversational model replies into plain text for follow-up turns and emits usage metrics', async () => {
    const llmCall = vi.fn(async () => ({
      text: '{"type":"text","text":"6"}',
      toolCalls: [],
      stopReason: 'end_turn' as const,
      usage: {
        inputTokens: 10,
        outputTokens: 1,
        cachedTokens: 0,
        estimatedUsd: 0,
      },
    }));

    const pack = new GeneralTaskPack({
      llmAdapter: {
        providerId: 'test-llm',
        call: llmCall,
        stream: async function* () {
          return;
        },
      },
      model: 'test-model',
      resolveRecentTranscript: () => [
        { role: 'user' as const, content: '请直接回答 2+3 等于几，只返回结果' },
        { role: 'assistant' as const, content: '5' },
      ],
    });
    const { ctx, events } = createContext('run_general_wrapped_reply');

    const normalized = await pack.intake(
      {
        prompt: '请直接回答 2+3 等于几，只返回结果',
        guidanceMessages: ['再加 1 呢，只返回结果'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(llmCall).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'user', content: '请直接回答 2+3 等于几，只返回结果' },
        { role: 'assistant', content: '5' },
        {
          role: 'user',
          content: expect.stringContaining('这是同一对话里的追问'),
        },
      ],
    }));
    expect(llmCall.mock.calls[0]?.[0]?.messages?.[2]).toEqual(expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('本轮追问：再加 1 呢，只返回结果'),
    }));
    expect(llmCall.mock.calls[0]?.[0]?.messages?.[2]).toEqual(expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('上一轮助手结果：5'),
    }));
    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      responseMode: 'answer-only',
      response: '6',
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'turn_info',
        payload: expect.objectContaining({
          current: 1,
        }),
      }),
      expect.objectContaining({
        type: 'cost_update',
        payload: expect.objectContaining({
          inputTokens: 10,
          outputTokens: 1,
          cachedTokens: 0,
          estimatedUsd: 0,
        }),
      }),
    ]));
  });
});