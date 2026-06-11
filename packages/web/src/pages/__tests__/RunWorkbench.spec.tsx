/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  listModels: vi.fn(),
  listTools: vi.fn(),
  uploadSessionAttachment: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  createRun: apiMocks.createRun,
  listModels: apiMocks.listModels,
  listTools: apiMocks.listTools,
  uploadSessionAttachment: apiMocks.uploadSessionAttachment,
}));

import { RunWorkbench } from '../RunWorkbench';

function renderWorkbench() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/workbench']}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/workbench" element={<RunWorkbench />} />
          <Route path="/runs/:id" element={<div>Run detail route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RunWorkbench', () => {
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
    apiMocks.createRun.mockResolvedValue({
      runId: 'run_web_1',
      status: 'created',
      acceptedTaskKind: 'analysis',
      initialCheckpoint: null,
    });
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
  });

  it('uses user-facing launch copy instead of internal harness wording', async () => {
    renderWorkbench();

    expect(await screen.findByText('从这里直接启动一次运行，模型、工具、附件与提示词统一输入，创建后自动进入时间线详情页。')).toBeTruthy();
    expect(screen.getByText('从这里发起一次运行，不预设必须走分析入口。')).toBeTruthy();
    expect(screen.queryByText(/harness run/i)).toBeNull();
    expect(screen.queryByText(/Create a harness run/i)).toBeNull();
  });

  it('creates a run from the intake panel with model, tools, and attachments', async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const uploadInput = (await screen.findAllByLabelText('上传附件')).find((element) => element.tagName === 'INPUT');
    expect(uploadInput).toBeTruthy();

    await user.upload(
      uploadInput as HTMLInputElement,
      new File(['evidence'], 'evidence.txt', { type: 'text/plain' }),
    );

    await waitFor(() => {
      expect(apiMocks.uploadSessionAttachment).toHaveBeenCalledWith({
        filename: 'evidence.txt',
        contentType: 'text/plain',
        dataBase64: Buffer.from('mock-file').toString('base64'),
      });
    });

    await user.click((await screen.findAllByRole('button', { name: /qwen-plus/i }))[0]!);
    await user.click(await screen.findByRole('button', { name: /qwen3-coder-plus/i }));

    await user.click(screen.getByRole('button', { name: /^工具自动/ }));
    await user.click(await screen.findByRole('button', { name: /query_database/i }));

    await user.type(
      await screen.findByPlaceholderText('输入任务目标、补充约束，或粘贴附件开始…'),
      '分析快捷支付风控',
    );
    await user.click(screen.getByRole('button', { name: '开始运行' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '分析快捷支付风控',
          businessName: '分析快捷支付风控',
          attachmentIds: ['att-1'],
          toolIds: ['query_database'],
        },
        preferredModel: 'model-coder',
        surface: 'web',
      });
    });
  });

  it('prefers a real model over a mock default when starting a run', async () => {
    const user = userEvent.setup();

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

    renderWorkbench();

    const composerInputs = await screen.findAllByPlaceholderText('输入任务目标、补充约束，或粘贴附件开始…');

    await user.type(
      composerInputs[0] as HTMLTextAreaElement,
      '请直接回答 2+3 等于几，只返回结果',
    );
    await user.click(screen.getByRole('button', { name: '开始运行' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '请直接回答 2+3 等于几，只返回结果',
          businessName: '请直接回答 2+3 等于几，只返回结果',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'real-model',
        surface: 'web',
      });
    });
  });
});
