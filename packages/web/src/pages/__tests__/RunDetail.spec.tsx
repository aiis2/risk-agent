/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  appendRunMessage: vi.fn(),
  cancelRun: vi.fn(),
  getRun: vi.fn(),
  getRunEvents: vi.fn(),
  getRunArtifacts: vi.fn(),
  listModels: vi.fn(),
  listTools: vi.fn(),
  submitRunInput: vi.fn(),
  uploadSessionAttachment: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  appendRunMessage: apiMocks.appendRunMessage,
  cancelRun: apiMocks.cancelRun,
  getRun: apiMocks.getRun,
  getRunEvents: apiMocks.getRunEvents,
  getRunArtifacts: apiMocks.getRunArtifacts,
  listModels: apiMocks.listModels,
  listTools: apiMocks.listTools,
  submitRunInput: apiMocks.submitRunInput,
  uploadSessionAttachment: apiMocks.uploadSessionAttachment,
}));

import { RunDetail } from '../RunDetail';

function renderRunDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/runs/run_web_1']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/runs/:id" element={<RunDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RunDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal(
      'FileReader',
      class FileReader {
        result: string | ArrayBuffer | null = null;
        onload: null | (() => void) = null;
        onerror: null | (() => void) = null;

        readAsDataURL(file: Blob) {
          this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from('mock-file').toString('base64')}`;
          this.onload?.();
        }
      } as any,
    );
    apiMocks.getRun.mockResolvedValue({
      runId: 'run_web_1',
      taskKind: 'analysis',
      status: 'waiting_user',
      input: { prompt: '分析快捷支付风控' },
      routing: {
        acceptedTaskKind: 'analysis',
        confidence: 1,
        reason: 'explicit_task_kind',
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    apiMocks.getRunEvents.mockResolvedValue([]);
    apiMocks.getRunArtifacts.mockResolvedValue([]);
    apiMocks.cancelRun.mockResolvedValue({ ok: true });
    apiMocks.submitRunInput.mockResolvedValue({ ok: true, runId: 'run_web_1', accepted: true });
    apiMocks.appendRunMessage.mockResolvedValue({ ok: true, runId: 'run_web_1', resumed: true, interrupted: true });
    apiMocks.listModels.mockResolvedValue([
      {
        modelId: 'model-default',
        modelName: 'qwen-plus',
        provider: 'openai-compatible',
        enabled: true,
        isDefault: true,
      },
      {
        modelId: 'model-coder',
        modelName: 'qwen3-coder-plus',
        provider: 'openai-compatible',
        enabled: true,
        isDefault: false,
      },
    ]);
    apiMocks.listTools.mockResolvedValue({
      total: 2,
      tools: [
        {
          name: 'query_database',
          description: 'Query relational data',
          aliases: [],
          isReadOnly: true,
          isConcurrencySafe: true,
          isDestructive: false,
          alwaysLoad: false,
          deferred: false,
          strict: false,
          isOpenWorld: false,
          inputSchema: {},
        },
        {
          name: 'file_parse',
          description: 'Parse uploaded files',
          aliases: [],
          isReadOnly: true,
          isConcurrencySafe: true,
          isDestructive: false,
          alwaysLoad: false,
          deferred: false,
          strict: false,
          isOpenWorld: false,
          inputSchema: {},
        },
      ],
    });
    apiMocks.uploadSessionAttachment.mockResolvedValue({
      attachmentId: 'att-1',
      filename: 'evidence.txt',
      contentType: 'text/plain',
      sizeBytes: 9,
      textPreview: 'mock-file',
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('cancels the run from the detail header while it is still active', async () => {
    const user = userEvent.setup();
    renderRunDetail();

    await user.click(await screen.findByRole('button', { name: 'Cancel run' }));

    await waitFor(() => {
      expect(apiMocks.cancelRun).toHaveBeenCalledWith('run_web_1');
    });
  });

  it('submits intervention input when the run is waiting_user', async () => {
    const user = userEvent.setup();
    renderRunDetail();

    await user.type(
      await screen.findByPlaceholderText('输入你的决策或补充说明...'),
      '继续执行并补充异常登录链路',
    );
    await user.click(screen.getByRole('button', { name: '提交决策' }));

    await waitFor(() => {
      expect(apiMocks.submitRunInput).toHaveBeenCalledWith('run_web_1', { input: '继续执行并补充异常登录链路' });
    });
  });

  it('sends follow-up messages with selected model, tools, attachments, and mode', async () => {
    const user = userEvent.setup();
    apiMocks.getRun.mockResolvedValue({
      runId: 'run_web_1',
      taskKind: 'analysis',
      status: 'completed',
      input: { prompt: '分析快捷支付风控' },
      routing: {
        acceptedTaskKind: 'analysis',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 4,
        toolCallCount: 2,
        inputTokens: 100,
        outputTokens: 200,
        cachedTokens: 0,
        estimatedUsd: 0.02,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    renderRunDetail();

    await user.upload(
      await screen.findByLabelText('上传附件', { selector: 'input' }),
      new File(['evidence'], 'evidence.txt', { type: 'text/plain' }),
    );

    await waitFor(() => {
      expect(apiMocks.uploadSessionAttachment).toHaveBeenCalled();
    });

    await user.click(await screen.findByRole('button', { name: /qwen-plus/i }));
    await user.click(await screen.findByRole('button', { name: /qwen3-coder-plus/i }));

    await user.click(screen.getByRole('button', { name: /^工具自动/ }));
    await user.click(await screen.findByRole('button', { name: /query_database/i }));

    await user.type(await screen.findByPlaceholderText('通过消息补充引导或继续当前 run...'), '请重点补充异常登录链路');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.appendRunMessage).toHaveBeenCalledWith('run_web_1', {
        content: '请重点补充异常登录链路',
        modelId: 'model-coder',
        attachmentIds: ['att-1'],
        toolIds: ['query_database'],
        mode: 'steer',
      });
    });
  });

  it('prefers a real model over a mock default for follow-up messages', async () => {
    const user = userEvent.setup();

    apiMocks.getRun.mockResolvedValue({
      runId: 'run_web_1',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '请直接回答 2+3 等于几，只返回结果' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 1,
        toolCallCount: 0,
        inputTokens: 10,
        outputTokens: 20,
        cachedTokens: 0,
        estimatedUsd: 0.001,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    apiMocks.listModels.mockResolvedValueOnce([
      {
        modelId: 'mock-default',
        modelName: 'browser-sandbox-check',
        provider: 'mock',
        enabled: true,
        isDefault: true,
      },
      {
        modelId: 'real-model',
        modelName: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        provider: 'openrouter',
        enabled: true,
        isDefault: false,
      },
    ]);

    renderRunDetail();

    await user.type(await screen.findByPlaceholderText('通过消息补充引导或继续当前 run...'), '继续，直接回答 2+3');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.appendRunMessage).toHaveBeenCalledWith(
        'run_web_1',
        expect.objectContaining({
          content: '继续，直接回答 2+3',
          modelId: 'real-model',
        }),
      );
    });
  });

  it('queues a follow-up message while the run is active and flushes it after completion', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    apiMocks.getRun
      .mockResolvedValueOnce({
        runId: 'run_web_1',
        taskKind: 'analysis',
        status: 'running',
        input: { prompt: '分析快捷支付风控' },
        routing: {
          acceptedTaskKind: 'analysis',
          confidence: 1,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        metrics: {
          turnCount: 2,
          toolCallCount: 1,
          inputTokens: 80,
          outputTokens: 140,
          cachedTokens: 0,
          estimatedUsd: 0.01,
        },
        createdAt: now,
        updatedAt: now,
      })
      .mockResolvedValue({
        runId: 'run_web_1',
        taskKind: 'analysis',
        status: 'completed',
        input: { prompt: '分析快捷支付风控' },
        routing: {
          acceptedTaskKind: 'analysis',
          confidence: 1,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        metrics: {
          turnCount: 3,
          toolCallCount: 1,
          inputTokens: 120,
          outputTokens: 200,
          cachedTokens: 0,
          estimatedUsd: 0.02,
        },
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });

    renderRunDetail();

    await user.type(await screen.findByPlaceholderText('通过消息补充引导或继续当前 run...'), '第二轮补充分析');
    await user.click(screen.getByRole('button', { name: '更多发送选项' }));
    await user.click(await screen.findByRole('button', { name: /添加到队列/i }));

    await waitFor(() => {
      expect(apiMocks.appendRunMessage).toHaveBeenCalledWith('run_web_1', {
        content: '第二轮补充分析',
        modelId: 'model-default',
        attachmentIds: [],
        toolIds: [],
        mode: 'queue',
      });
    });
  });
});
