/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const apiMocks = vi.hoisted(() => ({
  listScenarios: vi.fn(),
  listModels: vi.fn(),
  listSessions: vi.fn(),
  listTools: vi.fn(),
  getSession: vi.fn(),
  startSession: vi.fn(),
  appendSessionMessage: vi.fn(),
  cancelSession: vi.fn(),
  uploadSessionAttachment: vi.fn(),
}));

const useAgentProgressMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/client', () => ({
  listScenarios: apiMocks.listScenarios,
  listModels: apiMocks.listModels,
  listSessions: apiMocks.listSessions,
  listTools: apiMocks.listTools,
  getSession: apiMocks.getSession,
  startSession: apiMocks.startSession,
  appendSessionMessage: apiMocks.appendSessionMessage,
  cancelSession: apiMocks.cancelSession,
  uploadSessionAttachment: apiMocks.uploadSessionAttachment,
}));

vi.mock('../../hooks/useAgentProgress', () => ({
  useAgentProgress: useAgentProgressMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultValueOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const fallback = typeof defaultValueOrOptions === 'string' ? defaultValueOrOptions : undefined;
      const options = (typeof defaultValueOrOptions === 'object' ? defaultValueOrOptions : maybeOptions) ?? {};
      const template = fallback ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, token) => {
        const value = options[token];
        return value === undefined ? `{{${token}}}` : String(value);
      });
    },
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

import { NewAnalysis } from '../NewAnalysis';
import { useChatStore } from '../../stores/chatStore';
import { useSessionStore } from '../../stores/sessionStore';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[initialEntry]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <LocationProbe />
        <Routes>
          <Route path="/analyze" element={<NewAnalysis />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function seedWorkspaceSession(sessionId: string, businessName: string, status: string, phase: string) {
  useSessionStore.getState().openSession({
    sessionId,
    businessName,
    status,
    phase,
  }, { activate: false });
}

beforeEach(() => {
  localStorage.clear();
  useChatStore.setState({ conversations: {} });
  useSessionStore.getState().reset();
  vi.clearAllMocks();

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal('PointerEvent', MouseEvent);

  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
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

  apiMocks.listScenarios.mockResolvedValue([]);
  apiMocks.listModels.mockResolvedValue([
    {
      modelId: 'model-default',
      modelName: 'qwen3-coder-plus',
      provider: 'openai-compatible',
      enabled: true,
      isDefault: true,
    },
  ]);
  apiMocks.listTools.mockResolvedValue({
    total: 2,
    tools: [
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
    ],
  });
  apiMocks.listSessions.mockResolvedValue([]);
  apiMocks.getSession.mockResolvedValue({ businessName: '回放恢复会话' });
  apiMocks.startSession.mockResolvedValue({ sessionId: 'session-new' });
  apiMocks.appendSessionMessage.mockResolvedValue({ ok: true, sessionId: 'session-a', resumed: true, interrupted: true });
  apiMocks.cancelSession.mockResolvedValue(undefined);
  apiMocks.uploadSessionAttachment.mockResolvedValue({
    attachmentId: 'att-1',
    filename: 'evidence.txt',
    contentType: 'text/plain',
    sizeBytes: 9,
    textPreview: 'mock-file',
  });
  useAgentProgressMock.mockReturnValue({ events: [], status: 'idle', transport: 'sse' });
});

afterEach(() => {
  cleanup();
});

describe('NewAnalysis multi-session workspace', () => {
  it('sends the selected enabled modelId when starting a session', async () => {
    const user = userEvent.setup();

    apiMocks.listModels.mockResolvedValue([
      {
        modelId: 'model-default',
        modelName: 'qwen-plus',
        provider: 'openai-compatible',
        enabled: true,
        isDefault: true,
        config: { baseUrl: 'https://models.example.com/v1' },
      },
      {
        modelId: 'model-coder',
        modelName: 'qwen3-coder-plus',
        provider: 'openai-compatible',
        enabled: true,
        isDefault: false,
        config: { baseUrl: 'https://models.example.com/v1' },
      },
    ]);

    renderPage('/analyze');

    const modelTrigger = await screen.findByRole('button', { name: /qwen-plus/i });
    await user.click(modelTrigger);
    expect(await screen.findByText('模型配置')).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /qwen3-coder-plus/i }));

    const businessInput = screen.getByPlaceholderText('输入业务名称，开始风险分析…');
    await user.type(businessInput, '多模型配置验证');
    await user.click(screen.getByRole('button', { name: '分析' }));

    await waitFor(() => {
      expect(apiMocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
        businessName: '多模型配置验证',
        modelId: 'model-coder',
      }));
    });
  });

  it('prefers a real model over a mock default when starting a session', async () => {
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

    renderPage('/analyze');

    await user.type(screen.getByPlaceholderText('输入业务名称，开始风险分析…'), '直接计算 2+3');
    await user.click(screen.getByRole('button', { name: '分析' }));

    await waitFor(() => {
      expect(apiMocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
        businessName: '直接计算 2+3',
        modelId: 'real-model',
      }));
    });
  });

  it('persists the last selected composer model across remounts', async () => {
    const user = userEvent.setup();

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

    const first = renderPage('/analyze');

    await user.click(await screen.findByRole('button', { name: /qwen-plus/i }));
    await user.click(await screen.findByRole('button', { name: /qwen3-coder-plus/i }));

    first.unmount();

    renderPage('/analyze');

    expect(await screen.findByRole('button', { name: /qwen3-coder-plus/i })).toBeTruthy();
  });

  it('uploads attachments and selected tools before starting a new session', async () => {
    const user = userEvent.setup();

    renderPage('/analyze');

    const fileInput = screen.getByLabelText('上传附件', { selector: 'input' });
    await user.upload(fileInput, new File(['evidence'], 'evidence.txt', { type: 'text/plain' }));

    await waitFor(() => {
      expect(apiMocks.uploadSessionAttachment).toHaveBeenCalledWith({
        sessionId: undefined,
        filename: 'evidence.txt',
        contentType: 'text/plain',
        dataBase64: expect.any(String),
      });
    });

    await user.click(screen.getByRole('button', { name: /^工具自动/ }));
    const fileParseButton = await screen.findByRole('button', { name: /file_parse/i });
    await user.click(fileParseButton);

    await user.type(screen.getByPlaceholderText('输入业务名称，开始风险分析…'), '附件启动会话');
    await user.click(screen.getByRole('button', { name: '分析' }));

    await waitFor(() => {
      expect(apiMocks.startSession).toHaveBeenCalledWith(expect.objectContaining({
        businessName: '附件启动会话',
        attachmentIds: ['att-1'],
        toolIds: ['file_parse'],
      }));
    });
  });

  it('resets stale conversation state before replaying resumed history', async () => {
    seedWorkspaceSession('session-a', '贷款反欺诈分析', 'completed', 'report');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '贷款反欺诈分析',
        status: 'completed',
        phase: 'report',
      },
    ]);

    useChatStore.getState().startConversation('session-a', '旧会话草稿');
    useChatStore.getState().appendEvent('session-a', {
      type: 'text_delta',
      delta: '不应重复保留的旧回答',
    });

    useAgentProgressMock.mockImplementation((sessionId: string | null, loadHistory = false) => ({
      events:
        sessionId === 'session-a'
          ? [
              { type: 'system_init', model: 'qwen3-coder-plus' },
              { type: 'result', result: '恢复后的唯一结论', reportId: 'report-1' },
            ]
          : [],
      status: 'closed',
      transport: 'sse',
      loadHistory,
    }));

    renderPage('/analyze?session=session-a&resume=1');

    await screen.findByText('恢复后的唯一结论');

    expect(screen.queryByText('不应重复保留的旧回答')).toBeNull();
    expect(screen.getAllByText('贷款反欺诈分析')).toHaveLength(1);
    expect(useAgentProgressMock).toHaveBeenCalledWith('session-a', true, 0);
  });

  it('allows follow-up guidance while a session is streaming and inserts the new user message locally', async () => {
    const user = userEvent.setup();

    seedWorkspaceSession('session-a', '电商支付风控', 'running', 'analysis');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '电商支付风控',
        status: 'running',
        phase: 'analysis',
      },
    ]);
    useAgentProgressMock.mockReturnValue({ events: [], status: 'open', transport: 'sse' });

    renderPage('/analyze?session=session-a');

    const composer = await screen.findByPlaceholderText('补充引导消息，继续当前分析…');
    expect((composer as HTMLTextAreaElement).disabled).toBe(false);

    await user.type(composer, '请重点关注高频异常登录');
    await user.click(screen.getByRole('button', { name: '通过消息引导' }));

    await waitFor(() => {
      expect(apiMocks.appendSessionMessage).toHaveBeenCalledWith('session-a', {
        content: '请重点关注高频异常登录',
        modelId: 'model-default',
        attachmentIds: undefined,
        toolIds: undefined,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('请重点关注高频异常登录')).toBeTruthy();
    });
  });

  it('uses regular send controls for completed sessions and disables history replay after a follow-up resume', async () => {
    const user = userEvent.setup();

    seedWorkspaceSession('session-a', '电商支付风控', 'completed', 'report');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '电商支付风控',
        status: 'completed',
        phase: 'report',
      },
    ]);
    useAgentProgressMock.mockImplementation((sessionId: string | null, loadHistory = false, reconnectKey = 0) => ({
      events:
        sessionId === 'session-a' && loadHistory && reconnectKey === 0
          ? [
              { type: 'system_init', model: 'qwen3-coder-plus' },
              { type: 'result', result: '历史报告总结', reportId: 'report-1' },
            ]
          : [],
      status: 'closed',
      transport: 'sse',
    }));

    renderPage('/analyze?session=session-a&resume=1');

    await screen.findByText('历史报告总结');
    expect(screen.queryByRole('button', { name: '选择发送模式' })).toBeNull();

    const composer = screen.getByRole('textbox');
    await user.type(composer, '继续分析退款欺诈链路');

    expect(screen.queryByRole('button', { name: '选择发送模式' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(apiMocks.appendSessionMessage).toHaveBeenCalledWith('session-a', {
        content: '继续分析退款欺诈链路',
        modelId: 'model-default',
        attachmentIds: undefined,
        toolIds: undefined,
      });
    });
    await waitFor(() => {
      expect(useAgentProgressMock).toHaveBeenCalledWith('session-a', false, 1);
    });
  });

  it('exposes a shell action to reset back to a fresh analysis draft', async () => {
    const user = userEvent.setup();

    seedWorkspaceSession('session-a', '电商支付风控', 'running', 'analysis');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '电商支付风控',
        status: 'running',
        phase: 'analysis',
      },
    ]);
    useAgentProgressMock.mockReturnValue({ events: [], status: 'open', transport: 'sse' });

    renderPage('/analyze?session=session-a');

    const resetButton = await screen.findByRole('button', { name: '新建分析' });
    await user.click(resetButton);

    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/analyze');
    });
    expect(screen.getByPlaceholderText('输入业务名称，开始风险分析…')).toBeTruthy();
  });

  it('shows a multi-session workspace aside and lets the user switch sessions from it', async () => {
    const user = userEvent.setup();

    seedWorkspaceSession('session-a', '电商支付风控', 'running', 'analysis');
    seedWorkspaceSession('session-b', '贷款反欺诈分析', 'completed', 'report');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '电商支付风控',
        status: 'running',
        phase: 'analysis',
      },
      {
        sessionId: 'session-b',
        businessName: '贷款反欺诈分析',
        status: 'completed',
        phase: 'report',
      },
      {
        sessionId: 'session-c',
        businessName: '账户安全评估',
        status: 'completed',
        phase: 'report',
      },
    ]);
    useAgentProgressMock.mockReturnValue({ events: [], status: 'open', transport: 'sse' });

    renderPage('/analyze?session=session-a');

    expect(await screen.findByText('多会话工作台')).toBeTruthy();
    expect(screen.getByRole('button', { name: '切换到会话 贷款反欺诈分析' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '恢复会话 账户安全评估' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '切换到会话 贷款反欺诈分析' }));

    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe('/analyze?session=session-b&resume=1');
    });
  });

  it('groups assistant output into answer, tool execution and step sections', async () => {
    seedWorkspaceSession('session-a', '电商支付风控', 'running', 'analysis');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '电商支付风控',
        status: 'running',
        phase: 'analysis',
      },
    ]);

    useChatStore.getState().startConversation('session-a', '电商支付风控');
    useChatStore.getState().appendEvents('session-a', [
      { type: 'system_init', model: 'openai-compatible/qwen3-coder-plus' },
      { type: 'thinking_delta', delta: '先检查异常登录，再回看限额策略。' },
      { type: 'text_delta', delta: '已生成初步风险判断。' },
      { type: 'tool_start', toolUseId: 'tool-1', toolName: 'query_database', params: { table: 'orders' } },
      { type: 'tool_complete', toolUseId: 'tool-1', result: '{"count": 12}', durationMs: 120 },
      { type: 'subagent_spawned', agentId: 'worker-1', description: '扫描限额规则', workerRole: 'research', phase: 'analysis' },
      { type: 'subagent_progress', agentId: 'worker-1', progress: '检索高风险登录链路' },
    ] as any);

    renderPage('/analyze?session=session-a');

    // New compact UI: shows content text directly, thinking as collapsible "推理轨迹",
    // AgentStepsPanel shows running state when there is still an active worker
    await screen.findByText('已生成初步风险判断。');
    expect(screen.getByText('推理轨迹')).toBeTruthy();
    // Panel header shows "执行中…" when a worker is still running alongside a done tool
    expect(screen.getByText(/执行中/)).toBeTruthy();
  });

  it('renders a compact turn snapshot card from real turn and token usage data', async () => {
    seedWorkspaceSession('session-a', '电商支付风控', 'running', 'analysis');
    apiMocks.listSessions.mockResolvedValue([
      {
        sessionId: 'session-a',
        businessName: '电商支付风控',
        status: 'running',
        phase: 'analysis',
      },
    ]);

    useChatStore.getState().startConversation('session-a', '电商支付风控');
    useChatStore.getState().appendEvents('session-a', [
      { type: 'system_init', model: 'openai-compatible/qwen3.5-plus' },
      { type: 'turn_info', current: 2, max: 30, estimatedTokens: 11500 },
      { type: 'thinking_delta', delta: '正在准备分析链路。' },
      { type: 'cost_update', cumulativeUsd: 0.002, inputTokens: 800, outputTokens: 300 },
    ] as any);

    renderPage('/analyze?session=session-a');

    // New compact UI: CompactStepCounter shows "步骤 N / 30" and "~X.XK tokens"
    await screen.findByText('步骤 2 / 30');
    expect(screen.getByText('~1.1K tokens')).toBeTruthy();
  });

});
