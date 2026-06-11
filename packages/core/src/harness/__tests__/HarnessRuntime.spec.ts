import { describe, expect, it } from 'vitest';
import { HarnessRuntime } from '../HarnessRuntime.js';
import { TaskPackRegistry } from '../TaskPackRegistry.js';
import { RunStateMachine } from '../RunStateMachine.js';
import type { RunEvent, TaskPack } from '../types.js';

function createPack(): TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> {
  return {
    kind: 'analysis',
    contractVersion: 'analysis.phase1',
    inputSchema: {},
    async intake(input) { return input as Record<string, unknown>; },
    async plan(input) { return input; },
    async *execute(plan, ctx) {
      await ctx.emit({ type: 'step_progress', payload: { step: 'test' } });
      return plan;
    },
    async verify(_result, ctx) {
      return {
        verificationId: 'ver_runtime',
        runId: ctx.run.runId,
        verifierType: 'contract' as const,
        contractVersion: 'analysis.phase1',
        decision: 'pass' as const,
        reasons: ['runtime_test_pass'],
        followUpAction: 'none' as const,
        createdAt: ctx.now(),
      };
    },
    async projectResult(_result, ctx) {
      return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: { ok: true } })];
    },
  };
}

describe('HarnessRuntime', () => {
  it('routes, checkpoints, verifies, and completes a run', async () => {
    const events: string[] = [];
    const registry = new TaskPackRegistry();
    registry.register(createPack());
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });

    const result = await runtime.execute({
      runId: 'run_runtime',
      requestedTaskKind: 'analysis',
      input: { businessName: '\u5feb\u6377\u652f\u4ed8' },
      onEvent: async (event) => {
        events.push(event.type);
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      'routed',
      'plan_created',
      'step_progress',
      'artifact_updated',
      'verifier_finished',
      'run_completed',
    ]));
    expect(result.snapshot.status).toBe('completed');
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(result.verification.decision).toBe('pass');
  });

  it('includes a preview in artifact_updated events when the artifact carries response text', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const previewPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'general',
      contractVersion: 'general.preview',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan) {
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_preview',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'general.preview',
          decision: 'pass' as const,
          reasons: ['preview_ready'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [
          await ctx.publishArtifact({
            kind: 'structured-answer',
            mimeType: 'application/json',
            contentJson: { response: 'Generated answer preview for CLI transcript' },
          }),
        ];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(previewPack);
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });

    await runtime.execute({
      runId: 'run_preview',
      requestedTaskKind: 'general',
      input: { prompt: 'hello' },
      onEvent: async (event) => {
        events.push({ type: event.type, payload: event.payload });
      },
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'artifact_updated',
      payload: expect.objectContaining({
        kind: 'structured-answer',
        preview: 'Generated answer preview for CLI transcript',
      }),
    }));
  });

  it('accumulates run metrics from emitted turn, tool, and cost events', async () => {
    const metricsPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'analysis',
      contractVersion: 'analysis.metrics',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan, ctx) {
        await ctx.emit({ type: 'turn_info', payload: { current: 2, max: 6, estimatedTokens: 120 } });
        await ctx.emit({ type: 'tool_start', payload: { toolName: 'query_database', toolUseId: 'tool_1', input: { sql: 'select 1' } } });
        await ctx.emit({
          type: 'cost_update',
          payload: {
            inputTokens: 180,
            outputTokens: 45,
            cachedTokens: 10,
            cacheCreationTokens: 5,
            estimatedUsd: 0.0123,
          },
        });
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_metrics',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'analysis.metrics',
          decision: 'pass' as const,
          reasons: ['metrics_captured'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: { ok: true } })];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(metricsPack);
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });

    const result = await runtime.execute({
      runId: 'run_metrics',
      requestedTaskKind: 'analysis',
      input: { prompt: 'collect metrics' },
      onEvent: async () => {},
    });

    expect(result.snapshot.metrics).toEqual({
      turnCount: 2,
      toolCallCount: 1,
      inputTokens: 180,
      outputTokens: 45,
      cachedTokens: 15,
      estimatedUsd: 0.0123,
    });
  });

  it('accumulates synthetic metrics carried by custom task-pack events', async () => {
    const syntheticPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'knowledge-query',
      contractVersion: 'knowledge.synthetic',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan, ctx) {
        await ctx.emit({
          type: 'knowledge_query_started',
          payload: {
            query: plan.prompt ?? '',
            syntheticMetrics: {
              turnCount: 1,
              toolCallCount: 2,
            },
          },
        });
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_synthetic_metrics',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'knowledge.synthetic',
          decision: 'pass' as const,
          reasons: ['synthetic_metrics_captured'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: { ok: true } })];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(syntheticPack);
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });

    const result = await runtime.execute({
      runId: 'run_synthetic_metrics',
      requestedTaskKind: 'knowledge-query',
      input: { prompt: 'synthetic metrics' },
      onEvent: async () => {},
    });

    expect(result.snapshot.metrics).toMatchObject({
      turnCount: 1,
      toolCallCount: 2,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      estimatedUsd: 0,
    });
  });

  it('creates structural checkpoints and passes the caller signal into the task context', async () => {
    const checkpoints: string[] = [];
    let observedSignal: AbortSignal | undefined;

    const checkpointPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'skill-management',
      contractVersion: 'skill.phase1',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan, ctx) {
        observedSignal = ctx.signal;
        await ctx.createSemanticCheckpoint('semantic-step', { prompt: plan.prompt ?? '' });
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_checkpoint',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'skill.phase1',
          decision: 'pass' as const,
          reasons: ['checkpoint_test_pass'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [
          await ctx.publishArtifact({
            kind: 'structured-answer',
            mimeType: 'application/json',
            contentJson: { ok: true },
          }),
        ];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(checkpointPack);
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });
    const controller = new AbortController();

    const result = await runtime.execute({
      runId: 'run_checkpoint',
      requestedTaskKind: 'skill-management',
      signal: controller.signal,
      input: { prompt: 'manage tool routing' },
      onEvent: async () => {},
      onCheckpoint: async (checkpoint) => {
        checkpoints.push(`${checkpoint.scope}:${checkpoint.kind}`);
      },
    });

    expect(observedSignal).toBe(controller.signal);
    expect(checkpoints).toEqual(expect.arrayContaining([
      'structural:routed',
      'structural:planned',
      'semantic:running-step',
      'structural:verify-ready',
      'structural:completed',
    ]));
    expect(result.snapshot.currentCheckpointId).toBeDefined();
  });

  it('enters waiting_user and resumes execution after receiving user input', async () => {
    const events: string[] = [];
    const timeline: RunEvent[] = [];
    const waitingRequests: Array<{ requestId: string; question: string; options?: string[] }> = [];
    let resolveInput: ((value: Record<string, unknown>) => void) | undefined;

    const interactivePack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'skill-management',
      contractVersion: 'skill.phase2',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan, ctx) {
        const answer = await ctx.requestUserInput({
          question: '是否确认启用技能包？',
          options: ['确认', '取消'],
          checkpoint: { changeType: 'enable-skill' },
        });
        await ctx.createSemanticCheckpoint('approval-received', answer);
        return { ...plan, answer };
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_waiting',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'skill.phase2',
          decision: 'pass' as const,
          reasons: ['user_approved_change'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(result, ctx) {
        return [
          await ctx.publishArtifact({
            kind: 'structured-answer',
            mimeType: 'application/json',
            contentJson: result,
          }),
        ];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(interactivePack);
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });

    const execution = runtime.execute({
      runId: 'run_waiting',
      requestedTaskKind: 'skill-management',
      input: { prompt: 'enable approval flow' },
      onEvent: async (event) => {
        events.push(event.type);
        timeline.push(event);
      },
      waitForInput: async (request) => {
        waitingRequests.push(request);
        return await new Promise<Record<string, unknown>>((resolve) => {
          resolveInput = resolve;
        });
      },
    });

    for (let attempt = 0; attempt < 10 && waitingRequests.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(waitingRequests).toHaveLength(1);
    expect(waitingRequests[0]?.question).toBe('是否确认启用技能包？');
    expect(events).toEqual(expect.arrayContaining(['waiting_user']));
    expect(timeline.find((event) => event.type === 'waiting_user')?.payload).toMatchObject({
      requestId: waitingRequests[0]?.requestId,
      question: '是否确认启用技能包？',
      options: ['确认', '取消'],
      promptKind: 'approval',
      checkpointId: expect.any(String),
      checkpoint: {
        requestId: waitingRequests[0]?.requestId,
        question: '是否确认启用技能包？',
        options: ['确认', '取消'],
        changeType: 'enable-skill',
      },
    });

    resolveInput?.({ input: '确认', approved: true });
    const result = await execution;

    expect(result.snapshot.status).toBe('completed');
    expect(result.artifacts[0]?.contentJson).toMatchObject({
      answer: { input: '确认', approved: true },
    });
  });

  it('marks run as failed when verifier returns fail', async () => {
    const failPack: TaskPack = {
      kind: 'general',
      contractVersion: 'general.test',
      inputSchema: {},
      async intake(input) { return input as Record<string, unknown>; },
      async plan(input) { return input; },
      async *execute(plan) { return plan; },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_fail',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'general.test',
          decision: 'fail' as const,
          reasons: ['intentional_failure'],
          followUpAction: 'fail_run' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: {} })];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(failPack);
    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-04-24T03:00:00.000Z'),
      now: () => '2026-04-24T03:00:00.000Z',
    });

    const result = await runtime.execute({
      runId: 'run_fail',
      requestedTaskKind: 'general',
      input: {},
      onEvent: async () => {},
    });

    expect(result.snapshot.status).toBe('failed');
    expect(result.snapshot.terminationReason).toBe('verification_failed');
  });

  it('supports same-run capability switching through an orchestrator while keeping taskKind as a soft label', async () => {
    const events: string[] = [];
    const timeline: RunEvent[] = [];

    const generalPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'general',
      contractVersion: 'general.orchestrated',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan, ctx) {
        await ctx.emit({ type: 'general_step', payload: { prompt: plan.prompt ?? '' } });
        return { response: 'general-complete' };
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_general_orchestrated',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'general.orchestrated',
          decision: 'pass' as const,
          reasons: ['general_complete'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [
          await ctx.publishArtifact({
            kind: 'structured-answer',
            mimeType: 'application/json',
            contentJson: { response: 'general-complete' },
          }),
        ];
      },
    };

    const knowledgePack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'knowledge-query',
      contractVersion: 'knowledge.orchestrated',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan, ctx) {
        await ctx.emit({ type: 'knowledge_step', payload: { query: plan.query ?? '' } });
        return { query: plan.query ?? '', matchCount: 1 };
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_knowledge_orchestrated',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'knowledge.orchestrated',
          decision: 'pass' as const,
          reasons: ['knowledge_complete'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(result, ctx) {
        return [
          await ctx.publishArtifact({
            kind: 'structured-answer',
            mimeType: 'application/json',
            contentJson: result,
          }),
        ];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(generalPack);
    registry.register(knowledgePack);

    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-05-13T08:00:00.000Z'),
      now: () => '2026-05-13T08:00:00.000Z',
      orchestrator: {
        async execute({ executePack, run, switchCapability }) {
          const general = await executePack('general', { prompt: '先帮我梳理问题' });
          await switchCapability('knowledge-query', {
            reason: 'model decided a structured lookup is needed',
            source: 'model',
          });
          const knowledge = await executePack('knowledge-query', { query: '退款规则' });

          return {
            artifacts: [...general.artifacts, ...knowledge.artifacts],
            verification: {
              verificationId: 'ver_orchestrated_runtime',
              runId: run.runId,
              verifierType: 'contract',
              contractVersion: 'orchestrated.runtime.phase1',
              decision: 'pass',
              reasons: ['general_complete', 'knowledge_complete'],
              followUpAction: 'none',
              createdAt: '2026-05-13T08:00:00.000Z',
            },
          };
        },
      },
    });

    const result = await runtime.execute({
      runId: 'run_orchestrated_runtime',
      requestedTaskKind: 'general',
      input: { prompt: '先梳理问题，再去查知识库' },
      onEvent: async (event) => {
        events.push(event.type);
        timeline.push(event);
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      'routed',
      'general_step',
      'capability_switched',
      'knowledge_step',
      'run_completed',
    ]));
    expect(result.snapshot.status).toBe('completed');
    expect(result.snapshot.taskKind).toBe('general');
    expect(result.snapshot.currentCapabilityProfile).toBe('knowledge-query');
    expect(result.snapshot.capabilitySwitches).toEqual([
      {
        from: 'general',
        to: 'knowledge-query',
        reason: 'model decided a structured lookup is needed',
        source: 'model',
      },
    ]);
    expect(timeline.find((event) => event.type === 'capability_switched')?.payload).toMatchObject({
      from: 'general',
      to: 'knowledge-query',
      reason: 'model decided a structured lookup is needed',
      source: 'model',
    });
    expect(result.artifacts).toHaveLength(2);
    expect(result.verification.reasons).toEqual(['general_complete', 'knowledge_complete']);
  });

  it('routes follow-up turn envelopes from the current user message instead of the prior requested task kind', async () => {
    const executedKinds: string[] = [];

    const analysisPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'analysis',
      contractVersion: 'analysis.follow-up',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan) {
        executedKinds.push('analysis');
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_followup_analysis',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'analysis.follow-up',
          decision: 'pass' as const,
          reasons: ['analysis_selected'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: { capability: 'analysis' } })];
      },
    };

    const generalPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'general',
      contractVersion: 'general.follow-up',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan) {
        executedKinds.push('general');
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_followup_general',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'general.follow-up',
          decision: 'pass' as const,
          reasons: ['general_selected'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: { capability: 'general' } })];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(analysisPack);
    registry.register(generalPack);

    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-05-15T03:10:00.000Z'),
      now: () => '2026-05-15T03:10:00.000Z',
    });

    const routedPayloads: Record<string, unknown>[] = [];
    const result = await runtime.execute({
      runId: 'run_followup_envelope',
      requestedTaskKind: 'analysis',
      input: {
        prompt: '分析支付风控首轮请求',
        turnEnvelope: {
          kind: 'follow-up',
          userMessage: '帮我生成一个 Discord bot 骨架',
          priorTaskKind: 'analysis',
          priorCapabilityProfile: 'analysis',
        },
      },
      onEvent: async (event) => {
        if (event.type === 'routed') {
          routedPayloads.push(event.payload);
        }
      },
    });

    expect(routedPayloads[0]).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
    });
    expect(executedKinds).toEqual(['general']);
    expect(result.snapshot.taskKind).toBe('general');
  });

  it('sanitizes follow-up orchestration input while preserving root business lineage', async () => {
    const capturedInputs: Record<string, unknown>[] = [];

    const generalPack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
      kind: 'general',
      contractVersion: 'general.follow-up',
      inputSchema: {},
      async intake(input) {
        return input as Record<string, unknown>;
      },
      async plan(input) {
        return input;
      },
      async *execute(plan) {
        return plan;
      },
      async verify(_result, ctx) {
        return {
          verificationId: 'ver_followup_general',
          runId: ctx.run.runId,
          verifierType: 'contract' as const,
          contractVersion: 'general.follow-up',
          decision: 'pass' as const,
          reasons: ['general_selected'],
          followUpAction: 'none' as const,
          createdAt: ctx.now(),
        };
      },
      async projectResult(_result, ctx) {
        return [await ctx.publishArtifact({ kind: 'structured-answer', mimeType: 'application/json', contentJson: { capability: 'general' } })];
      },
    };

    const registry = new TaskPackRegistry();
    registry.register(generalPack);

    const runtime = new HarnessRuntime({
      registry,
      stateMachine: new RunStateMachine(() => '2026-05-15T03:10:00.000Z'),
      now: () => '2026-05-15T03:10:00.000Z',
      orchestrator: {
        async execute({ input, executePack }) {
          capturedInputs.push(input);
          const general = await executePack('general', input);
          return {
            artifacts: general.artifacts,
            verification: general.verification,
          };
        },
      },
    });

    await runtime.execute({
      runId: 'run_followup_sanitized_input',
      input: {
        prompt: '分析电商支付的风险链路并给我排查报告',
        businessName: '分析电商支付的风险链路并给我排查报告',
        query: '支付风险分析',
        surface: 'web',
        turnEnvelope: {
          kind: 'follow-up',
          userMessage: '你不能使用搜索工具查询吗？',
          priorTaskKind: 'general',
          priorCapabilityProfile: 'general',
        },
      },
      onEvent: async () => undefined,
    });

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.prompt).toBe('你不能使用搜索工具查询吗？');
    expect(capturedInputs[0]?.businessName).toBeUndefined();
    expect(capturedInputs[0]?.query).toBeUndefined();
    expect(capturedInputs[0]?._rootPrompt).toBe('分析电商支付的风险链路并给我排查报告');
    expect(capturedInputs[0]?._rootBusinessName).toBe('分析电商支付的风险链路并给我排查报告');
    expect(capturedInputs[0]?._rootQuery).toBe('支付风险分析');
  });
});
