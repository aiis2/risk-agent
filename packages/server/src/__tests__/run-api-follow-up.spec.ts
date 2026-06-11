import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMCallOptions, LLMCallResult } from '@risk-agent/core';

const llmCallSpy = vi.hoisted(() => vi.fn<(opts: LLMCallOptions) => Promise<LLMCallResult>>());
const capturedMessages = vi.hoisted(() => ({
  calls: [] as Array<Array<{ role: string; content: string }>>,
}));

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

import { buildApp } from '../index.js';

async function waitFor(condition: () => Promise<boolean>, attempts = 40): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition not met in time');
}

describe('run API follow-up transcript', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedMessages.calls = [];
  });

  it('replays prior user and assistant turns through /api/runs and /api/runs/:id/messages', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-run-api-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    llmCallSpy.mockImplementation(async (opts) => {
      const messages = opts.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      }));
      capturedMessages.calls.push(messages);

      const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
      const hasPriorAssistantAnswer = messages.some((message) => message.role === 'assistant' && message.content === '5');
      const isFollowUpTurn = hasPriorAssistantAnswer || lastUserMessage.includes('本轮追问：再加 1 呢，只返回结果');
      const responseText = isFollowUpTurn ? '6' : '5';
      return {
        text: responseText,
        toolCalls: [],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: responseText.length,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
      };
    });

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const created = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          taskKind: 'general',
          input: { prompt: '请直接回答 2+3 等于几，只返回结果' },
          surface: 'web',
        },
      });

      expect(created.statusCode).toBe(201);
      const runId = JSON.parse(created.body).runId as string;

      await waitFor(async () => (await built.ctx.runService.getRun(runId))?.status === 'completed', 60);

      const followUp = await app.inject({
        method: 'POST',
        url: `/api/runs/${runId}/messages`,
        payload: {
          content: '再加 1 呢，只返回结果',
          mode: 'steer',
        },
      });

      expect(followUp.statusCode).toBe(201);
      expect(JSON.parse(followUp.body)).toEqual({
        ok: true,
        runId,
        resumed: true,
        interrupted: false,
      });

      await waitFor(async () => (await built.ctx.runService.getRun(runId))?.status === 'completed', 60);

      const transcriptCall = capturedMessages.calls.find((batch) => batch.some((message) => message.role === 'assistant' && message.content === '5'));
      expect(transcriptCall?.[0]).toEqual({ role: 'user', content: '请直接回答 2+3 等于几，只返回结果' });
      expect(transcriptCall?.[1]).toEqual({ role: 'assistant', content: '5' });
      expect(transcriptCall?.[2]?.role).toBe('user');
      expect(transcriptCall?.[2]?.content).toContain('这是同一对话里的追问');
      expect(transcriptCall?.[2]?.content).toContain('上一轮助手结果：5');
      expect(transcriptCall?.[2]?.content).toContain('本轮追问：再加 1 呢，只返回结果');

      const artifacts = await app.inject({ method: 'GET', url: `/api/runs/${runId}/artifacts` });
      expect(artifacts.statusCode).toBe(200);
      expect(artifacts.body).toContain('structured-answer');
      expect(artifacts.body).toContain('6');
    } finally {
      await app?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after Fastify shutdown.
      }
    }
  });
});