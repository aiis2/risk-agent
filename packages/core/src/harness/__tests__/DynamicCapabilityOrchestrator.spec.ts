import { describe, expect, it, vi } from 'vitest';
import type { RunArtifact, RunEvent, RunSnapshot, VerificationRecord } from '../types.js';
import { DynamicCapabilityOrchestrator } from '../DynamicCapabilityOrchestrator.js';
import {
  CapabilityAdapterRegistry,
  createAnalysisCapabilityAdapter,
  createGeneralCapabilityAdapter,
  createKnowledgeQueryCapabilityAdapter,
} from '../CapabilityAdapter.js';
import { MockProvider } from '../../llm/providers/MockProvider.js';

function createRun(): RunSnapshot {
  return {
    runId: 'run_dynamic_orchestrator',
    taskKind: 'general',
    currentCapabilityProfile: 'general',
    capabilitySwitches: [],
    status: 'running',
    input: { prompt: '支付风控规则有哪些？' },
    routing: {
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
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
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: '2026-05-13T00:00:00.000Z',
  };
}

function createArtifact(kind: RunArtifact['kind'], contentJson: Record<string, unknown>): RunArtifact {
  return {
    artifactId: `art_${kind}`,
    runId: 'run_dynamic_orchestrator',
    kind,
    mimeType: 'application/json',
    contentJson,
    version: 1,
    createdAt: '2026-05-13T00:00:00.000Z',
  };
}

function createVerification(
  decision: VerificationRecord['decision'],
  reasons: string[],
  followUpAction: VerificationRecord['followUpAction'] = 'none',
): VerificationRecord {
  return {
    verificationId: `ver_${decision}`,
    runId: 'run_dynamic_orchestrator',
    verifierType: 'contract',
    contractVersion: 'test',
    decision,
    reasons,
    followUpAction,
    createdAt: '2026-05-13T00:00:00.000Z',
  };
}

describe('DynamicCapabilityOrchestrator', () => {
  it('tells the decision model to prioritize browser follow-ups over prior knowledge-query labels', async () => {
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({
        decision: 'stop',
        nextCapabilityProfile: 'general',
        reason: '先读取最新约束。',
      }),
      toolCalls: [],
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 10, outputTokens: 10, cachedTokens: 0, estimatedUsd: 0 },
    }));

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createAnalysisCapabilityAdapter());
    adapters.register(createGeneralCapabilityAdapter());
    adapters.register(createKnowledgeQueryCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter: {
        providerId: 'spy',
        call: llmCall,
      },
      model: 'mock-model',
      adapters,
      maxRounds: 2,
    });

    await orchestrator.execute({
      run: createRun(),
      input: {
        prompt: '支付风控规则有哪些？',
        turnEnvelope: {
          kind: 'follow-up',
          userMessage: '不要检索知识库，继续用内置浏览器访问 https://docs.stripe.com/radar 并总结页面内容。',
          priorTaskKind: 'knowledge-query',
          priorCapabilityProfile: 'knowledge-query',
        },
      },
      signal: new AbortController().signal,
      emit: async (event) => ({
        eventId: `evt_${event.type}`,
        runId: 'run_dynamic_orchestrator',
        type: event.type,
        payload: event.payload,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => ({
        kind,
        normalizedInput: packInput ?? {},
        plan: {},
        result: {},
        artifacts: [createArtifact('structured-answer', { response: '已读取最新约束。' })],
        verification: createVerification('pass', ['general_response_prepared']),
      }),
      switchCapability: async () => undefined,
    });

    expect(llmCall).toHaveBeenCalled();
    const request = llmCall.mock.calls[0]?.[0] as {
      systemPrompt: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(request.systemPrompt).toContain('If the latest user request explicitly rejects a capability or data source, do not choose it unless the user changes direction.');
    expect(request.systemPrompt).toContain('If the latest user request asks to open a URL, inspect a page, capture screenshots, or keep using the browser, prefer the general capability with responseModeHint="tool-assisted" over knowledge-query.');
    expect(request.messages[0]?.content).toContain('不要检索知识库，继续用内置浏览器访问 https://docs.stripe.com/radar 并总结页面内容。');
    expect(request.messages[0]?.content).toContain('"priorTaskKind": "knowledge-query"');
  });

  it('emits continuation decisions and delegates across capability adapters before stopping', async () => {
    const llmAdapter = new MockProvider([
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'knowledge-query',
          reason: '先查知识库确认命中的规则，再决定是否需要汇总输出。',
          delegatedPrompt: '检索支付风控规则',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'general',
          responseModeHint: 'answer-only',
          reason: '已经拿到规则摘要，下一步需要给用户一个可直接阅读的结论。',
          delegatedPrompt: '请结合刚才命中的规则，总结支付风控规则。',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'stop',
          nextCapabilityProfile: 'general',
          reason: '已经形成最终回答，不需要再继续切换能力。',
        }),
      },
    ]);

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createAnalysisCapabilityAdapter());
    adapters.register(createGeneralCapabilityAdapter());
    adapters.register(createKnowledgeQueryCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter,
      model: 'mock-model',
      adapters,
      maxRounds: 4,
    });

    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
    const executed: Array<{ kind: string; input: Record<string, unknown> | undefined }> = [];
    const switches: Array<{ next: string; metadata: { reason: string; source?: 'model' | 'system' | 'user' } }> = [];

    const result = await orchestrator.execute({
      run: createRun(),
      input: { prompt: '支付风控规则有哪些？' },
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run_dynamic_orchestrator',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-05-13T00:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => {
        executed.push({ kind, input: packInput });

        if (kind === 'knowledge-query') {
          return {
            kind,
            normalizedInput: packInput ?? {},
            plan: {},
            result: {},
            artifacts: [createArtifact('json', { summary: '命中支付风控规则 3 条。' })],
            verification: createVerification('pass', ['knowledge_query_completed']),
          };
        }

        return {
          kind,
          normalizedInput: packInput ?? {},
          plan: {},
          result: {},
          artifacts: [createArtifact('structured-answer', { response: '支付风控规则包括实名核验、额度分层和异常交易拦截。' })],
          verification: createVerification('pass', ['general_response_prepared']),
        };
      },
      switchCapability: async (next, metadata) => {
        switches.push({ next, metadata });
      },
    });

    expect(executed.map((entry) => entry.kind)).toEqual(['knowledge-query', 'general']);
    expect(executed[0]?.input).toMatchObject({
      query: '检索支付风控规则',
      prompt: '检索支付风控规则',
    });
    expect(executed[1]?.input).toMatchObject({
      prompt: '请结合刚才命中的规则，总结支付风控规则。',
      guidanceMessages: expect.arrayContaining([
        expect.stringContaining('knowledge-query'),
      ]),
    });

    const decisions = emitted.filter((event) => event.type === 'continuation_decision');
    expect(decisions).toHaveLength(3);
    expect(decisions[0]?.payload).toMatchObject({
      round: 1,
      decision: 'continue',
      nextCapabilityProfile: 'knowledge-query',
      reason: '先查知识库确认命中的规则，再决定是否需要汇总输出。',
    });
    expect(decisions[1]?.payload).toMatchObject({
      round: 2,
      decision: 'continue',
      nextCapabilityProfile: 'general',
      responseModeHint: 'answer-only',
    });
    expect(decisions[2]?.payload).toMatchObject({
      round: 3,
      decision: 'stop',
      reason: '已经形成最终回答，不需要再继续切换能力。',
    });

    expect(switches).toEqual([
      {
        next: 'knowledge-query',
        metadata: {
          reason: '先查知识库确认命中的规则，再决定是否需要汇总输出。',
          source: 'model',
        },
      },
      {
        next: 'general',
        metadata: {
          reason: '已经拿到规则摘要，下一步需要给用户一个可直接阅读的结论。',
          source: 'model',
        },
      },
    ]);
    expect(result.verification.reasons).toEqual(expect.arrayContaining([
      'knowledge_query_completed',
      'general_response_prepared',
    ]));
  });

  it('emits a system fallback stop when the next continuation decision cannot be parsed', async () => {
    const llmAdapter = new MockProvider([
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'general',
          responseModeHint: 'answer-only',
          reason: '先执行当前通用能力。',
          delegatedPrompt: '先给出一个初步结论。',
        }),
      },
      {
        text: 'not valid json',
      },
    ]);

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createGeneralCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter,
      model: 'mock-model',
      adapters,
      maxRounds: 4,
    });

    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];

    await orchestrator.execute({
      run: createRun(),
      input: { prompt: '请先给出一个初步结论' },
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run_dynamic_orchestrator',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-05-13T00:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => ({
        kind,
        normalizedInput: packInput ?? {},
        plan: {},
        result: {},
        artifacts: [createArtifact('structured-answer', { response: '这是初步结论。' })],
        verification: createVerification('pass', ['general_response_prepared']),
      }),
      switchCapability: async () => undefined,
    });

    const decisions = emitted.filter((event) => event.type === 'continuation_decision');
    expect(decisions).toHaveLength(2);
    expect(decisions[1]?.payload).toMatchObject({
      decision: 'stop',
      stopReasonCode: 'system_fallback',
      source: 'system',
    });
  });

  it('continues orchestrating after a recoverable verification warning instead of forcing verification_failed', async () => {
    const llmAdapter = new MockProvider([
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'analysis',
          reason: '先补齐分析报告缺失的覆盖信息。',
          delegatedPrompt: '重新整理分析缺失项并给出下一步建议。',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'general',
          responseModeHint: 'answer-only',
          reason: '已经拿到补救建议，整理成最终回复。',
          delegatedPrompt: '结合补救建议生成最终答复。',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'stop',
          nextCapabilityProfile: 'general',
          reason: '最终答复已经准备完成。',
        }),
      },
    ]);

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createAnalysisCapabilityAdapter());
    adapters.register(createGeneralCapabilityAdapter());
    adapters.register(createKnowledgeQueryCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter,
      model: 'mock-model',
      adapters,
      maxRounds: 4,
    });

    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
    const executedKinds: string[] = [];

    const result = await orchestrator.execute({
      run: createRun(),
      input: { prompt: '请继续完成分析并整理最终答复。' },
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run_dynamic_orchestrator',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-05-13T00:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => {
        executedKinds.push(kind);

        if (kind === 'analysis') {
          return {
            kind,
            normalizedInput: packInput ?? {},
            plan: {},
            result: {},
            artifacts: [createArtifact('report', { summary: '覆盖矩阵仍待补齐，但建议已生成。' })],
            verification: createVerification(
              'warn',
              ['coverage_missing', 'gaps_missing', 'suggestions_present'],
              'retry',
            ),
          };
        }

        return {
          kind,
          normalizedInput: packInput ?? {},
          plan: {},
          result: {},
          artifacts: [createArtifact('structured-answer', { response: '已根据建议整理最终答复。' })],
          verification: createVerification('pass', ['general_response_prepared']),
        };
      },
      switchCapability: async () => undefined,
    });

    expect(executedKinds).toEqual(['analysis', 'general']);

    const verificationStop = emitted.find(
      (event) => event.type === 'continuation_decision'
        && (event.payload as Record<string, unknown>).stopReasonCode === 'verification_failed',
    );
    expect(verificationStop).toBeUndefined();
    expect(result.verification.decision).toBe('warn');
    expect(result.verification.reasons).toEqual(expect.arrayContaining([
      'coverage_missing',
      'suggestions_present',
      'general_response_prepared',
    ]));
  });

  it('stops immediately when a capability result reports a forced budget stop', async () => {
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({
        decision: 'continue',
        nextCapabilityProfile: 'general',
        responseModeHint: 'tool-assisted',
        reason: '先执行浏览器步骤。',
        delegatedPrompt: '请先打开页面并读取内容。',
      }),
      toolCalls: [],
      stopReason: 'end_turn' as const,
      usage: { inputTokens: 10, outputTokens: 10, cachedTokens: 0, estimatedUsd: 0 },
    }));

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createGeneralCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter: {
        providerId: 'spy',
        call: llmCall,
      },
      model: 'mock-model',
      adapters,
      maxRounds: 4,
    });

    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];

    await orchestrator.execute({
      run: createRun(),
      input: { prompt: '请先打开页面并读取内容。' },
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run_dynamic_orchestrator',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-05-13T00:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => ({
        kind,
        normalizedInput: packInput ?? {},
        plan: {},
        result: {
          continuationStop: {
            code: 'budget',
            reason: '工具辅助步骤触发预算上限，停止继续编排。',
            source: 'system',
          },
        },
        artifacts: [createArtifact('structured-answer', { response: '预算达到上限，已停止。' })],
        verification: createVerification('warn', ['budget_exhausted']),
      }),
      switchCapability: async () => undefined,
    });

    const decisions = emitted.filter((event) => event.type === 'continuation_decision');
    expect(decisions).toHaveLength(2);
    expect(decisions[1]?.payload).toMatchObject({
      decision: 'stop',
      stopReasonCode: 'budget',
      source: 'system',
    });
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('keeps the first forced continue on the current capability when the model tries to stop immediately', async () => {
    const llmAdapter = new MockProvider([
      {
        text: JSON.stringify({
          decision: 'stop',
          nextCapabilityProfile: 'analysis',
          reason: '已经足够，不需要继续。',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'stop',
          nextCapabilityProfile: 'general',
          reason: '通用回复已经完成。',
        }),
      },
    ]);

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createGeneralCapabilityAdapter());
    adapters.register(createKnowledgeQueryCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter,
      model: 'mock-model',
      adapters,
      maxRounds: 4,
    });

    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
    const executedKinds: string[] = [];
    const switches: Array<string> = [];

    await orchestrator.execute({
      run: createRun(),
      input: { prompt: '请直接回答 2+3 等于几，只返回结果' },
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run_dynamic_orchestrator',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-05-13T00:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => {
        executedKinds.push(kind);
        return {
          kind,
          normalizedInput: packInput ?? {},
          plan: {},
          result: {},
          artifacts: [createArtifact('structured-answer', { response: '5' })],
          verification: createVerification('pass', ['general_response_prepared']),
        };
      },
      switchCapability: async (next) => {
        switches.push(next);
      },
    });

    const decisions = emitted.filter((event) => event.type === 'continuation_decision');
    expect(decisions[0]?.payload).toMatchObject({
      decision: 'continue',
      currentCapabilityProfile: 'general',
      nextCapabilityProfile: 'general',
      source: 'system',
    });
    expect(executedKinds).toEqual(['general']);
    expect(switches).toEqual([]);
  });

  it('treats maxRounds=0 as unlimited and lets the model decide when to stop', async () => {
    const llmAdapter = new MockProvider([
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'general',
          responseModeHint: 'answer-only',
          reason: '先给出第 1 轮回复。',
          delegatedPrompt: '第 1 轮',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'general',
          responseModeHint: 'answer-only',
          reason: '继续第 2 轮。',
          delegatedPrompt: '第 2 轮',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'continue',
          nextCapabilityProfile: 'general',
          responseModeHint: 'answer-only',
          reason: '继续第 3 轮。',
          delegatedPrompt: '第 3 轮',
        }),
      },
      {
        text: JSON.stringify({
          decision: 'stop',
          nextCapabilityProfile: 'general',
          reason: '已经完成第 3 轮处理，可以停止。',
        }),
      },
    ]);

    const adapters = new CapabilityAdapterRegistry();
    adapters.register(createGeneralCapabilityAdapter());

    const orchestrator = new DynamicCapabilityOrchestrator({
      llmAdapter,
      model: 'mock-model',
      adapters,
      maxRounds: 0,
    });

    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
    const executedKinds: string[] = [];

    await orchestrator.execute({
      run: createRun(),
      input: { prompt: '请连续处理 3 轮后再停止。' },
      signal: new AbortController().signal,
      emit: async (event) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run_dynamic_orchestrator',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-05-13T00:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (kind, snapshot) => ({
        checkpointId: `chk_${kind}`,
        runId: 'run_dynamic_orchestrator',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
      }),
      requestUserInput: async () => ({ input: 'ok' }),
      publishArtifact: async (artifact) => ({
        artifactId: `published_${artifact.kind}`,
        runId: 'run_dynamic_orchestrator',
        version: 1,
        createdAt: '2026-05-13T00:00:00.000Z',
        ...artifact,
      }),
      executePack: async (kind, packInput) => {
        executedKinds.push(kind);
        return {
          kind,
          normalizedInput: packInput ?? {},
          plan: {},
          result: {},
          artifacts: [createArtifact('structured-answer', { response: '处理中' })],
          verification: createVerification('pass', ['general_response_prepared']),
        };
      },
      switchCapability: async () => undefined,
    });

    const decisions = emitted.filter((event) => event.type === 'continuation_decision');
    expect(executedKinds).toEqual(['general', 'general', 'general']);
    expect(decisions).toHaveLength(4);
    expect(decisions[3]?.payload).toMatchObject({
      decision: 'stop',
      stopReasonCode: 'model_complete',
      reason: '已经完成第 3 轮处理，可以停止。',
    });
    expect(decisions.some((event) => (event.payload as Record<string, unknown>).stopReasonCode === 'max_rounds')).toBe(false);
  });
});