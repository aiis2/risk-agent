/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.setConfig({ testTimeout: 15000 });

const apiMocks = vi.hoisted(() => ({
  appendRunMessage: vi.fn(),
  createRun: vi.fn(),
  getRun: vi.fn(),
  getRunArtifacts: vi.fn(),
  getRunEvents: vi.fn(),
  listModels: vi.fn(),
  listTools: vi.fn(),
  submitRunInput: vi.fn(),
  uploadSessionAttachment: vi.fn(),
}));

const eventSourceInstances: Array<{
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
}> = [];

const queryClients: QueryClient[] = [];

vi.mock('../../api/client', () => ({
  appendRunMessage: apiMocks.appendRunMessage,
  createRun: apiMocks.createRun,
  getRun: apiMocks.getRun,
  getRunArtifacts: apiMocks.getRunArtifacts,
  getRunEvents: apiMocks.getRunEvents,
  listModels: apiMocks.listModels,
  listTools: apiMocks.listTools,
  resolveRunCurrentCapability: (run: {
    taskKind?: string;
    currentCapabilityProfile?: string;
    routing?: { initialCapabilityProfile?: string; acceptedTaskKind?: string };
  } | null | undefined) => run?.currentCapabilityProfile ?? run?.routing?.initialCapabilityProfile ?? run?.routing?.acceptedTaskKind ?? run?.taskKind,
  resolveRunDisplayTaskKind: (run: {
    taskKind?: string;
    currentCapabilityProfile?: string;
    routing?: { agentMode?: string; initialCapabilityProfile?: string; acceptedTaskKind?: string };
  } | null | undefined) => {
    const currentCapability = run?.currentCapabilityProfile ?? run?.routing?.initialCapabilityProfile ?? run?.routing?.acceptedTaskKind ?? run?.taskKind;
    if (run?.routing?.agentMode === 'hermes') {
      return currentCapability;
    }
    return run?.taskKind ?? currentCapability;
  },
  submitRunInput: apiMocks.submitRunInput,
  uploadSessionAttachment: apiMocks.uploadSessionAttachment,
}));

import { ChatPage } from '../Chat';

function renderChatPage(initialEntries: string[] = ['/chat']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  queryClients.push(queryClient);

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={initialEntries}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForActiveRun(runId = 'run_chat_1') {
  await waitFor(() => {
    expect(screen.queryAllByTitle(runId).length).toBeGreaterThan(0);
  }, { timeout: 5000 });
}

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((queryClient) => queryClient.clear());
});

describe('ChatPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
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
      'EventSource',
      class EventSource {
        onmessage: ((event: MessageEvent<string>) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;

        constructor(_url: string) {
          eventSourceInstances.push(this);
        }

        close() {}
      },
    );
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
    eventSourceInstances.length = 0;

    apiMocks.createRun.mockResolvedValue({
      runId: 'run_chat_1',
      status: 'created',
      acceptedTaskKind: 'general',
      initialCheckpoint: null,
    });
    apiMocks.getRun.mockResolvedValue({
      runId: 'run_chat_1',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '你好' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 3,
        toolCallCount: 1,
        inputTokens: 120,
        outputTokens: 220,
        cachedTokens: 0,
        estimatedUsd: 0.03,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    apiMocks.getRunEvents.mockResolvedValue([]);
    apiMocks.getRunArtifacts.mockResolvedValue([]);
    apiMocks.appendRunMessage.mockResolvedValue({ ok: true, runId: 'run_chat_1', resumed: true, interrupted: false });
    apiMocks.submitRunInput.mockResolvedValue({ ok: true, runId: 'run_chat_1', accepted: true });
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

  it('renders an action-oriented first-turn launcher without internal routing copy', async () => {
    renderChatPage();

    expect(await screen.findByText('先发第一条消息，系统会自动分配到合适的工作流。')).toBeTruthy();
    expect(screen.getByText('默认推荐 Auto，需要时再明确指定分析、检索或技能管理。')).toBeTruthy();
    expect(screen.queryByText(/harness 运行路径/)).toBeNull();
    expect(screen.queryByText('Create')).toBeNull();
  });

  it('shows a missing-run state instead of waiting forever when the requested run no longer exists', async () => {
    const notFoundError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    apiMocks.getRun.mockRejectedValueOnce(notFoundError);

    renderChatPage(['/chat?run=run_missing_404']);

    expect(await screen.findByText('当前对话 run 不存在或已失效。')).toBeTruthy();
    expect(screen.queryByText('等待 Agent 开始运行...')).toBeNull();
    expect(screen.getByRole('button', { name: '返回新对话' })).toBeTruthy();
  });

  it('adds a browser side-panel tab for built-in browser workflows on active runs', async () => {
    renderChatPage(['/chat?run=run_chat_1']);

    expect(await screen.findByRole('button', { name: 'Browser' })).toBeTruthy();
  });

  it('renders mermaid diagrams inside the Metrics tab when the run artifacts contain them', async () => {
    const user = userEvent.setup();
    apiMocks.getRunArtifacts.mockResolvedValueOnce([
      {
        artifactId: 'art_metrics_mermaid',
        runId: 'run_chat_1',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: [
            '```mermaid',
            'graph TD',
            'A[读取设置] --> B[打开浏览器]',
            'B --> C[写入资源]',
            '```',
          ].join('\n'),
        },
        version: 1,
        createdAt: new Date().toISOString(),
      },
    ]);

    renderChatPage(['/chat?run=run_chat_1']);

    await user.click(await screen.findByRole('button', { name: 'Metrics' }));

    expect(await screen.findByText('流程图')).toBeTruthy();
    expect((await screen.findAllByText('Mermaid 流程图')).length).toBeGreaterThan(0);
  });

  it('creates an auto-routed run by default and continues the same run from the unified chat surface with steer as the default follow-up mode', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.upload(
      await screen.findByLabelText('上传附件', { selector: 'input' }),
      new File(['evidence'], 'evidence.txt', { type: 'text/plain' }),
    );

    await waitFor(() => {
      expect(apiMocks.uploadSessionAttachment).toHaveBeenCalledWith({
        filename: 'evidence.txt',
        contentType: 'text/plain',
        dataBase64: Buffer.from('mock-file').toString('base64'),
      });
    });

    await user.click(await screen.findByRole('button', { name: /qwen-plus/i }));
    await user.click(await screen.findByRole('button', { name: /qwen3-coder-plus/i }));

    await user.click(screen.getByRole('button', { name: '工具自动（全部可用）' }));
    await user.click(await screen.findByRole('button', { name: /query_database/i }));

    await user.type(
      await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'),
      '你好',
    );
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'general',
        input: {
          prompt: '你好',
          attachmentIds: ['att-1'],
          toolIds: ['query_database'],
        },
        preferredModel: 'model-coder',
        surface: 'web',
        approvalMode: 'default',
      });
    });

    await waitForActiveRun();

    await user.type(await screen.findByPlaceholderText('继续追问或补充新任务…'), '继续帮我整理需求');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.appendRunMessage).toHaveBeenCalledWith('run_chat_1', {
        content: '继续帮我整理需求',
        modelId: 'model-coder',
        attachmentIds: [],
        toolIds: ['query_database'],
        mode: 'steer',
        approvalMode: 'default',
      });
    });
  });

  it('offers switching generic follow-up questions into a new general run', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    apiMocks.createRun.mockResolvedValueOnce({
      runId: 'run_chat_general_2',
      status: 'created',
      acceptedTaskKind: 'general',
      initialCheckpoint: null,
    });
    apiMocks.getRun.mockResolvedValue({
      runId: 'run_chat_1',
      taskKind: 'analysis',
      status: 'completed',
      input: { prompt: '分析电商支付风险' },
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
        outputTokens: 220,
        cachedTokens: 0,
        estimatedUsd: 0.03,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    renderChatPage(['/chat?run=run_chat_1']);

    await user.type(await screen.findByPlaceholderText('继续追问或补充新任务…'), '你是什么模型？');

    const switchButtons = await screen.findAllByRole('button', { name: '切换到 通用对话' });
    await user.click(switchButtons[0]!);

    expect((await screen.findAllByText('首次发送会创建通用会话')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'general',
        input: {
          prompt: '你是什么模型？',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'model-default',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('detects intent drift from the active Hermes capability instead of the stored general top-level kind', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    apiMocks.getRun.mockResolvedValueOnce({
      runId: 'run_chat_hermes_analysis',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '分析电商支付风险' },
      routing: {
        acceptedTaskKind: 'general',
        initialCapabilityProfile: 'general',
        agentMode: 'hermes',
        confidence: 0.92,
        reason: 'semantic_capability_entry',
        routeParams: {},
      },
      currentCapabilityProfile: 'analysis',
      metrics: {
        turnCount: 3,
        toolCallCount: 1,
        inputTokens: 120,
        outputTokens: 220,
        cachedTokens: 0,
        estimatedUsd: 0.03,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    renderChatPage(['/chat?run=run_chat_hermes_analysis']);

    await user.type(await screen.findByPlaceholderText('继续追问或补充新任务…'), '你是什么模型？');

    const switchButtons = await screen.findAllByRole('button', { name: '切换到 通用对话' });
    expect(switchButtons.length).toBeGreaterThan(0);
  });

  it('preserves pasted image attachments when switching a mid-run UI request into a new general run', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const screenshotFile = new File(['image-bytes'], 'composer-shot.png', { type: 'image/png' });

    apiMocks.createRun.mockResolvedValueOnce({
      runId: 'run_chat_general_3',
      status: 'created',
      acceptedTaskKind: 'general',
      initialCheckpoint: null,
    });
    apiMocks.getRun.mockResolvedValue({
      runId: 'run_chat_1',
      taskKind: 'analysis',
      status: 'completed',
      input: { prompt: '分析电商支付风险' },
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
        outputTokens: 220,
        cachedTokens: 0,
        estimatedUsd: 0.03,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    apiMocks.uploadSessionAttachment.mockResolvedValueOnce({
      attachmentId: 'att-image-1',
      filename: 'composer-shot.png',
      contentType: 'image/png',
      sizeBytes: 11,
      textPreview: undefined,
    });

    renderChatPage(['/chat?run=run_chat_1']);

    const textarea = await screen.findByPlaceholderText('继续追问或补充新任务…');
    fireEvent.paste(textarea, {
      clipboardData: {
        files: [screenshotFile],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshotFile }],
        types: ['Files'],
      },
    });

    await waitFor(() => {
      expect(apiMocks.uploadSessionAttachment).toHaveBeenCalledWith({
        filename: 'composer-shot.png',
        contentType: 'image/png',
        dataBase64: Buffer.from('mock-file').toString('base64'),
      });
    });

    await user.type(textarea, '根据截图优化这个输入框 UI');
    const switchButtons = await screen.findAllByRole('button', { name: '切换到 通用对话' });
    await user.click(switchButtons[0]!);
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'general',
        input: {
          prompt: '根据截图优化这个输入框 UI',
          attachmentIds: ['att-image-1'],
          toolIds: undefined,
        },
        preferredModel: 'model-default',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('allows switching the first turn to analysis explicitly', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const analysisMode = (await screen.findByText('风控分析')).closest('button');
    expect(analysisMode).toBeTruthy();
    await user.click(analysisMode!);
    await user.type(await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'), '电商支付风险测试');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'analysis',
        input: {
          prompt: '电商支付风险测试',
          businessName: '电商支付风险测试',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'model-default',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('routes external skills CLI help prompts through general chat even when skill-management is selected', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const skillMode = (await screen.findByText('技能管理')).closest('button');
    expect(skillMode).toBeTruthy();
    await user.click(skillMode!);
    await user.type(
      await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'),
      '帮我通过npx skills add https://github.com/anthropics/skills --skill frontend-design 方式安装这个skill',
    );
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'general',
        input: {
          prompt: '帮我通过npx skills add https://github.com/anthropics/skills --skill frontend-design 方式安装这个skill',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'model-default',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('lets the server infer businessName for auto prompts that clearly route to analysis', async () => {
    const user = userEvent.setup();
    renderChatPage();

    await user.type(
      await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'),
      '分析电商支付的风险链路并给我排查报告',
    );
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'analysis',
        input: {
          prompt: '分析电商支付的风险链路并给我排查报告',
          businessName: '分析电商支付的风险链路并给我排查报告',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'model-default',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('allows switching the first turn to general explicitly', async () => {
    const user = userEvent.setup();
    renderChatPage();

    const generalMode = (await screen.findByText('通用对话')).closest('button');
    expect(generalMode).toBeTruthy();
    await user.click(generalMode!);
    await user.type(await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'), '先帮我整理附件重点');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        taskKind: 'general',
        input: {
          prompt: '先帮我整理附件重点',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'model-default',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('persists the selected model across remounts', async () => {
    const user = userEvent.setup();
    const firstRender = renderChatPage();

    await user.click(await screen.findByRole('button', { name: /qwen-plus/i }));
    await user.click(await screen.findByRole('button', { name: /qwen3-coder-plus/i }));

    firstRender.unmount();
    renderChatPage();

    await user.type(
      await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'),
      '请继续回答',
    );
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '请继续回答',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'model-coder',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('prefers a real model over a mock default for normal chat sends', async () => {
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

    renderChatPage();

    await user.type(
      await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…'),
      '请直接回答 2+3 等于几，只返回结果',
    );
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '请直接回答 2+3 等于几，只返回结果',
          attachmentIds: undefined,
          toolIds: undefined,
        },
        preferredModel: 'real-model',
        surface: 'web',
        approvalMode: 'default',
      });
    });
  });

  it('resends a previous user bubble through the current run follow-up flow', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();

    apiMocks.getRun.mockResolvedValue({
      runId: 'run_chat_1',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '你好' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 3,
        toolCallCount: 1,
        inputTokens: 120,
        outputTokens: 220,
        cachedTokens: 0,
        estimatedUsd: 0.03,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    apiMocks.getRunEvents.mockResolvedValue([
      {
        eventId: 'evt_user_resend_1',
        runId: 'run_chat_1',
        type: 'user_message',
        payload: {
          content: '继续帮我整理需求',
          mode: 'steer',
        },
        createdAt: now,
      },
    ]);

    renderChatPage(['/chat?run=run_chat_1']);

    const userBubble = await screen.findByText('继续帮我整理需求');
    const bubbleShell = userBubble.closest('li');
    expect(bubbleShell).toBeTruthy();

    fireEvent.mouseOver(bubbleShell as HTMLElement);
    await waitFor(() => {
      expect(within(bubbleShell as HTMLElement).getByRole('button', { name: '重新发送用户消息' })).toBeTruthy();
    });

    await user.click(within(bubbleShell as HTMLElement).getByRole('button', { name: '重新发送用户消息' }));

    await waitFor(() => {
      expect(apiMocks.appendRunMessage).toHaveBeenCalledWith('run_chat_1', {
        content: '继续帮我整理需求',
        modelId: 'model-default',
        attachmentIds: [],
        toolIds: [],
        mode: 'steer',
        approvalMode: 'default',
      });
    });
  });

  it('subscribes to the active run stream and renders streamed events in place', async () => {
    const now = new Date().toISOString();

    renderChatPage(['/chat?run=run_chat_1']);

    await waitFor(() => {
      expect(eventSourceInstances).toHaveLength(1);
    });

    eventSourceInstances[0]!.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_stream_user_1',
          runId: 'run_chat_1',
          type: 'user_message',
          payload: {
            content: '这是来自 SSE 的追问',
            mode: 'steer',
          },
          createdAt: now,
        }),
      }),
    );

    expect(await screen.findByText('这是来自 SSE 的追问')).toBeTruthy();
  });

  it('reconnects the run stream when a completed run becomes active again after a follow-up', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    let runStatus: 'completed' | 'running' = 'completed';

    apiMocks.getRun.mockImplementation(async () => ({
      runId: 'run_chat_1',
      taskKind: 'general',
      status: runStatus,
      input: { prompt: '你好' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: runStatus === 'completed' ? 1 : 2,
        toolCallCount: 0,
        inputTokens: 120,
        outputTokens: 220,
        cachedTokens: 0,
        estimatedUsd: 0.03,
      },
      createdAt: now,
      updatedAt: now,
      completedAt: runStatus === 'completed' ? now : undefined,
    }));
    apiMocks.appendRunMessage.mockImplementation(async () => {
      runStatus = 'running';
      return { ok: true, runId: 'run_chat_1', resumed: true, interrupted: false };
    });

    renderChatPage(['/chat?run=run_chat_1']);

    await waitFor(() => {
      expect(eventSourceInstances).toHaveLength(1);
    });

    const composer = await screen.findByPlaceholderText('继续追问或补充新任务…');
    await user.type(composer, '第二轮追问');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(apiMocks.appendRunMessage).toHaveBeenCalledWith('run_chat_1', {
        content: '第二轮追问',
        modelId: 'model-default',
        attachmentIds: [],
        toolIds: [],
        mode: 'steer',
        approvalMode: 'default',
      });
    });

    await waitFor(() => {
      expect(eventSourceInstances).toHaveLength(2);
    });

    eventSourceInstances[1]!.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_stream_followup_1',
          runId: 'run_chat_1',
          type: 'user_message',
          payload: {
            content: '第二轮追问',
            mode: 'steer',
          },
          createdAt: now,
        }),
      }),
    );

    expect(await screen.findByText('第二轮追问')).toBeTruthy();
  });

  it('restores the in-progress composer draft after remounting the same run', async () => {
    const user = userEvent.setup();
    const firstRender = renderChatPage(['/chat?run=run_chat_1']);

    const composer = await screen.findByPlaceholderText('继续追问或补充新任务…');
    await user.type(composer, '这个草稿在离开页面后不能丢');

    firstRender.unmount();
    renderChatPage(['/chat?run=run_chat_1']);

    expect(await screen.findByDisplayValue('这个草稿在离开页面后不能丢')).toBeTruthy();
  });

  it('restores composer height per run without leaking it into a new chat', async () => {
    window.localStorage.setItem('risk-agent.chat.composer.height.run_chat_1', '300');

    const firstRender = renderChatPage(['/chat?run=run_chat_1']);
    const existingRunComposer = await screen.findByPlaceholderText('继续追问或补充新任务…');

    await waitFor(() => {
      expect((existingRunComposer as HTMLTextAreaElement).style.height).toBe('300px');
    });

    firstRender.unmount();

    renderChatPage();
    const newChatComposer = await screen.findByPlaceholderText('输入你的任务、补充约束，或粘贴附件开始…');

    expect((newChatComposer as HTMLTextAreaElement).style.height).toBe('60px');
  });
});
