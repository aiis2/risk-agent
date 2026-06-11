import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageBackendRegistry, type LLMCallOptions, type LLMCallResult } from '@risk-agent/core';

const llmCallSpy = vi.hoisted(() => vi.fn<(opts: LLMCallOptions) => Promise<LLMCallResult>>());
const capturedMessages = vi.hoisted(() => ({ value: [] as Array<Array<{ role: string; content: string }>> }));
const capturedSystemPrompts = vi.hoisted(() => ({ value: [] as string[] }));
const scrapeToolSpy = vi.hoisted(() => vi.fn(async (input: unknown) => ({
  url: typeof (input as { url?: string })?.url === 'string' ? (input as { url: string }).url : '',
  title: 'Risk Radar',
  text: 'Risk Radar\nRendered with mocked Playwright browser content.',
  extractedChars: 52,
  truncated: false,
})));

vi.mock('../llm/factory.js', () => ({
  buildConfiguredLLMRuntime: vi.fn(async () => ({
    adapter: {
      providerId: 'spy',
      call: llmCallSpy,
    },
    model: 'spy-model',
    provider: 'spy',
    source: 'database',
    settings: {},
  })),
}));

vi.mock('../tools/PlaywrightWebScrapeTool.js', () => ({
  playwrightWebScrapeTool: {
    name: 'web_scrape',
    description: 'Mocked Playwright web scrape tool for runtime orchestration tests.',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: true,
    searchHint: 'mock playwright browser test',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        waitUntil: { type: 'string' },
      },
    },
    execute: scrapeToolSpy,
  },
}));

import { buildHarnessRuntime } from '../runs/buildHarnessRuntime.js';

describe('buildHarnessRuntime conversational transcript', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedMessages.value = [];
    capturedSystemPrompts.value = [];
  });

  it('includes prior run-first prompt and assistant answer for general follow-up turns', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runtime-'));
    let storage: StorageBackendRegistry | undefined;

    llmCallSpy.mockImplementation(async (opts) => {
      capturedMessages.value.push(opts.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      })));
      return {
        text: '6',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 1,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
      };
    });

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const store = storage.getStructuredStore();
      const runId = 'run_follow_up_context';

      await store.run(
        `INSERT INTO runs(run_id, task_kind, status, termination_reason, input_json, routing_json, current_checkpoint_id, latest_artifact_id, verifier_state_json, metrics_json, created_at, updated_at, completed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          runId,
          'general',
          'completed',
          null,
          JSON.stringify({ prompt: '请直接回答 2+3 等于几，只返回结果', surface: 'web' }),
          JSON.stringify({ acceptedTaskKind: 'general', confidence: 1, reason: 'test', routeParams: {} }),
          null,
          'art_prev_answer',
          null,
          JSON.stringify({ turnCount: 1, toolCallCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 }),
          '2026-05-07T05:48:50.000Z',
          '2026-05-07T05:48:53.000Z',
          '2026-05-07T05:48:53.000Z',
        ],
      );

      await store.run(
        `INSERT INTO run_artifacts(artifact_id, run_id, artifact_kind, mime_type, content_json, content_text, version, created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        [
          'art_prev_answer',
          runId,
          'structured-answer',
          'application/json',
          JSON.stringify({ response: '5' }),
          null,
          1,
          '2026-05-07T05:48:53.000Z',
        ],
      );

      const runtime = await buildHarnessRuntime(storage);
      await runtime.execute({
        runId,
        requestedTaskKind: 'general',
        input: {
          prompt: '请直接回答 2+3 等于几，只返回结果',
          guidanceMessages: ['再加 1 呢，只返回结果'],
          surface: 'web',
        },
        onEvent: async () => undefined,
        onSnapshot: async () => undefined,
        onArtifact: async () => undefined,
        onVerification: async () => undefined,
      });

      const transcriptCall = capturedMessages.value.find((batch) => batch.some((message) => message.role === 'assistant' && message.content === '5'));
      expect(transcriptCall?.[0]).toEqual({ role: 'user', content: '请直接回答 2+3 等于几，只返回结果' });
      expect(transcriptCall?.[1]).toEqual({ role: 'assistant', content: '5' });
      expect(transcriptCall?.[2]?.role).toBe('user');
      expect(transcriptCall?.[2]?.content).toContain('这是同一对话里的追问');
      expect(transcriptCall?.[2]?.content).toContain('上一轮助手结果：5');
      expect(transcriptCall?.[2]?.content).toContain('本轮追问：再加 1 呢，只返回结果');
    } finally {
      await storage?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after close.
      }
    }
  });

  it('recalls Chinese memory facts into the conversational system prompt', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runtime-memory-'));
    let storage: StorageBackendRegistry | undefined;

    llmCallSpy.mockImplementation(async (opts) => {
      capturedSystemPrompts.value.push(opts.systemPrompt);
      return {
        text: '已按偏好简短回复。',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
      };
    });

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const store = storage.getStructuredStore();

      await store.run(
        `INSERT INTO memory_facts(fact_id, content, content_hash, category, source_run, confidence, embedding_status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        [
          'fact_pref_runtime_cn',
          '请记住我的输出偏好：报告尽量简洁，避免长篇格式化。',
          'fact_pref_runtime_cn_hash',
          'user_preference',
          'run_pref_runtime_cn',
          0.55,
        ],
      );

      const runtime = await buildHarnessRuntime(storage);
      await runtime.execute({
        runId: 'run_recall_memory_cn',
        requestedTaskKind: 'general',
        input: {
          prompt: '请根据我简洁的偏好回复，只返回一句话。',
          surface: 'web',
        },
        onEvent: async () => undefined,
        onSnapshot: async () => undefined,
        onArtifact: async () => undefined,
        onVerification: async () => undefined,
      });

      expect(capturedSystemPrompts.value.some((prompt) => prompt.includes('请记住我的输出偏好：报告尽量简洁，避免长篇格式化。'))).toBe(true);
    } finally {
      await storage?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after close.
      }
    }
  });

  it('drives a browser request through the default orchestrator into general tool-assisted execution and model stop', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runtime-browser-'));
    let storage: StorageBackendRegistry | undefined;
    const timeline: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const pageUrl = 'https://example.test/risk-radar';
    let stage = 0;

    llmCallSpy.mockImplementation(async (opts) => {
      stage += 1;

      if (stage === 1) {
        expect(opts.tools).toBeUndefined();
        return {
          text: JSON.stringify({
            decision: 'continue',
            nextCapabilityProfile: 'general',
            responseModeHint: 'tool-assisted',
            reason: '需要先用浏览器读取页面内容，再生成结论。',
            delegatedPrompt: `请使用 Playwright 打开 ${pageUrl} 并总结页面标题。`,
          }),
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 10, cachedTokens: 0, estimatedUsd: 0 },
        };
      }

      if (stage === 2) {
        expect(opts.tools?.some((tool) => tool.name === 'web_scrape')).toBe(true);
        return {
          text: '',
          toolCalls: [{ toolUseId: 'tool_web_scrape_1', name: 'web_scrape', input: { url: pageUrl, waitUntil: 'networkidle' } }],
          stopReason: 'tool_use',
          usage: { inputTokens: 12, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 },
        };
      }

      if (stage === 3) {
        const toolMessage = opts.messages.find((message) => message.role === 'tool');
        expect(toolMessage?.content).toContain('Risk Radar');
        return {
          text: '页面标题是 Risk Radar。',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 16, outputTokens: 7, cachedTokens: 0, estimatedUsd: 0 },
        };
      }

      if (stage === 4) {
        return {
          text: JSON.stringify({
            decision: 'stop',
            nextCapabilityProfile: 'general',
            reason: '浏览器结果已经整理成最终答复。',
          }),
          toolCalls: [],
          stopReason: 'end_turn',
          usage: { inputTokens: 8, outputTokens: 8, cachedTokens: 0, estimatedUsd: 0 },
        };
      }

      throw new Error(`Unexpected LLM call stage ${stage}`);
    });

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime = await buildHarnessRuntime(storage);
      const result = await runtime.execute({
        runId: 'run_browser_orchestrated',
        requestedTaskKind: 'general',
        input: {
          prompt: `请用 Playwright 打开 ${pageUrl} 并总结页面标题。`,
          surface: 'web',
        },
        onEvent: async (event) => {
          timeline.push({ type: event.type, payload: event.payload });
        },
        onSnapshot: async () => undefined,
        onArtifact: async () => undefined,
        onVerification: async () => undefined,
      });

      expect(scrapeToolSpy).toHaveBeenCalledTimes(1);
      expect(timeline.map((event) => event.type)).toEqual(expect.arrayContaining([
        'plan_created',
        'continuation_decision',
        'general_response_started',
        'tool_start',
        'tool_complete',
        'run_completed',
      ]));
      expect(timeline.find((event) => event.type === 'plan_created')?.payload).toMatchObject({ orchestration: 'dynamic' });
      expect(timeline.find((event) => event.type === 'general_response_started')?.payload).toMatchObject({
        responseMode: 'tool-assisted',
      });

      const continuationEvents = timeline.filter((event) => event.type === 'continuation_decision');
      expect(continuationEvents).toHaveLength(2);
      expect(continuationEvents[1]?.payload).toMatchObject({
        decision: 'stop',
        stopReasonCode: 'model_complete',
        source: 'model',
      });
      expect(result.artifacts.at(-1)?.contentJson).toMatchObject({
        response: '页面标题是 Risk Radar。',
      });
    } finally {
      await storage?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after close.
      }
    }
  });
});