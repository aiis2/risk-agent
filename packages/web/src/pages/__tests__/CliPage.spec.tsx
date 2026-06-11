/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { markdownToAnsi, welcomeBanner } from '../../lib/cliAnsi';

const apiMocks = vi.hoisted(() => ({
  appendRunMessage: vi.fn(),
  buildRunStreamUrl: vi.fn(),
  createRun: vi.fn(),
  getRun: vi.fn(),
  getRunArtifacts: vi.fn(),
  getRunEvents: vi.fn(),
  listRuns: vi.fn(),
  listModels: vi.fn(),
  listTools: vi.fn(),
  submitRunInput: vi.fn(),
  uploadSessionAttachment: vi.fn(),
}));

const xtermMocks = vi.hoisted(() => {
  const terminal = {
    write: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
  };

  return {
    terminal,
    clearTerminal: vi.fn(() => terminal.clear()),
  };
});

const eventSourceInstances: Array<{
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
}> = [];

vi.mock('../../api/client', () => ({
  appendRunMessage: apiMocks.appendRunMessage,
  buildRunStreamUrl: apiMocks.buildRunStreamUrl,
  createRun: apiMocks.createRun,
  getRun: apiMocks.getRun,
  getRunArtifacts: apiMocks.getRunArtifacts,
  getRunEvents: apiMocks.getRunEvents,
  listRuns: apiMocks.listRuns,
  listModels: apiMocks.listModels,
  listTools: apiMocks.listTools,
  resolveRunCurrentCapability: (run: {
    taskKind?: string;
    currentCapabilityProfile?: string;
    routing?: { initialCapabilityProfile?: string; acceptedTaskKind?: string };
  } | null | undefined) => run?.currentCapabilityProfile ?? run?.routing?.initialCapabilityProfile ?? run?.routing?.acceptedTaskKind ?? run?.taskKind,
  submitRunInput: apiMocks.submitRunInput,
  uploadSessionAttachment: apiMocks.uploadSessionAttachment,
}));

vi.mock('../../hooks/useXterm', () => ({
  useXterm: () => ({
    terminal: xtermMocks.terminal,
    write: xtermMocks.terminal.write,
    writeln: vi.fn(),
    clear: xtermMocks.clearTerminal,
    fit: vi.fn(),
  }),
}));

import { CliPage } from '../CliPage';

function renderCliPage(initialEntries: string[] = ['/cli']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={initialEntries}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route path="/cli" element={<CliPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CliPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
    eventSourceInstances.length = 0;

    apiMocks.createRun.mockResolvedValue({
      runId: 'run_cli_1',
      status: 'created',
      acceptedTaskKind: 'general',
      initialCheckpoint: null,
    });
    apiMocks.appendRunMessage.mockResolvedValue({ ok: true, runId: 'run_cli_1', resumed: true, interrupted: false });
    apiMocks.getRun.mockResolvedValue({
      runId: 'run_cli_1',
      taskKind: 'general',
      status: 'running',
      input: { prompt: '你好' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 0.92,
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
    });
    apiMocks.getRunEvents.mockResolvedValue([]);
    apiMocks.getRunArtifacts.mockResolvedValue([]);
    apiMocks.listRuns.mockResolvedValue([]);
    apiMocks.submitRunInput.mockResolvedValue({ ok: true, runId: 'run_cli_1', accepted: true });
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
    apiMocks.buildRunStreamUrl.mockReturnValue('http://127.0.0.1:8787/api/runs/run_cli_1/stream');
  });

  it('handles slash commands locally and carries the configured model and tools into the first run', async () => {
    const user = userEvent.setup();
    renderCliPage();

    const input = await screen.findByRole('textbox', { name: 'CLI input' });

    await user.type(input, '/help');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(apiMocks.createRun).not.toHaveBeenCalled();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '/model qwen3-coder-plus');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(apiMocks.createRun).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: /qwen3-coder-plus/i });

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '/tools query_database');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(apiMocks.createRun).not.toHaveBeenCalled();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '分析快捷支付风控');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '分析快捷支付风控',
          toolIds: ['query_database'],
        },
        preferredModel: 'model-coder',
        surface: 'web-cli',
      });
    });
  });

  it('submits slash commands on Enter even when autocomplete suggestions are visible', async () => {
    const user = userEvent.setup();
    renderCliPage();

    const input = await screen.findByRole('textbox', { name: 'CLI input' });
    const writeCountBefore = xtermMocks.terminal.write.mock.calls.length;

    await user.type(input, '/help{enter}');

    await waitFor(() => {
      expect(xtermMocks.terminal.write.mock.calls.length).toBeGreaterThan(writeCountBefore);
    });
    expect(apiMocks.createRun).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('switches the CLI runtime surface to terminal-cli before creating a new run', async () => {
    const user = userEvent.setup();
    renderCliPage();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '/runtime terminal');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(apiMocks.createRun).not.toHaveBeenCalled();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '请以终端运行时扫描当前仓库');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '请以终端运行时扫描当前仓库',
          toolIds: [],
        },
        preferredModel: 'model-default',
        surface: 'terminal-cli',
      });
    });
  });

  it('prefers a real model over a mock default for the first CLI run', async () => {
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

    renderCliPage();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '请直接回答 2+3 等于几，只返回结果');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '请直接回答 2+3 等于几，只返回结果',
          toolIds: [],
        },
        preferredModel: 'real-model',
        surface: 'web-cli',
      });
    });
  });

  it('starts a detached background run from the slash command', async () => {
    const user = userEvent.setup();
    renderCliPage();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '/background 整理昨晚失败任务');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledWith({
        input: {
          prompt: '整理昨晚失败任务',
          toolIds: [],
        },
        preferredModel: 'model-default',
        surface: 'background',
      });
    });
    expect(eventSourceInstances).toHaveLength(0);
  });

  it('prints the welcome banner on the first animation frame after the terminal mounts', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }));

    renderCliPage();

    expect(xtermMocks.terminal.write).not.toHaveBeenCalledWith(welcomeBanner());
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](16);

    await waitFor(() => {
      expect(xtermMocks.terminal.reset).toHaveBeenCalledTimes(1);
      expect(xtermMocks.terminal.write).toHaveBeenCalledWith(welcomeBanner());
    });
  });

  it('starts a fresh local session after /new instead of appending to the previous run', async () => {
    const user = userEvent.setup();
    renderCliPage();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '先创建一个 run');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledTimes(1);
    });

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '/new');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '重新开始新的 run');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledTimes(2);
    });
    expect(apiMocks.appendRunMessage).not.toHaveBeenCalled();
  });

  it('prints only the primary structured-answer body for general runs and suppresses streaming text deltas', async () => {
    const user = userEvent.setup();
    apiMocks.getRunArtifacts.mockResolvedValue([
      {
        artifactId: 'art_cli_answer',
        runId: 'run_cli_1',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '先完成截图与内容确认，再组织最终回复。\n\n---\n# 最终结论\n\n页面标题为 Example Domain。',
        },
        version: 1,
        createdAt: '2026-05-06T10:20:02.000Z',
      },
    ]);

    renderCliPage();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '请总结页面');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledTimes(1);
      expect(eventSourceInstances).toHaveLength(1);
    });

    const eventSource = eventSourceInstances[0]!;
    eventSource.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_cli_routed',
          runId: 'run_cli_1',
          type: 'routed',
          payload: { acceptedTaskKind: 'general' },
          createdAt: '2026-05-06T10:20:00.000Z',
        }),
      }),
    );
    eventSource.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_cli_delta',
          runId: 'run_cli_1',
          type: 'text_delta',
          payload: { delta: '正在逐段生成正文' },
          createdAt: '2026-05-06T10:20:01.000Z',
        }),
      }),
    );
    eventSource.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_cli_completed',
          runId: 'run_cli_1',
          type: 'run_completed',
          payload: { status: 'completed' },
          createdAt: '2026-05-06T10:20:02.000Z',
        }),
      }),
    );

    await waitFor(() => {
      expect(apiMocks.getRunArtifacts).toHaveBeenCalledWith('run_cli_1');
      expect(xtermMocks.terminal.write).toHaveBeenCalledWith(`${markdownToAnsi('# 最终结论\n\n页面标题为 Example Domain。')}\r\n`);
    });

    expect(xtermMocks.terminal.write).not.toHaveBeenCalledWith('正在逐段生成正文');
    expect(xtermMocks.terminal.write).not.toHaveBeenCalledWith(expect.stringContaining('先完成截图与内容确认'));
  });

  it('reconnects the stream without duplicating replayed transcript events', async () => {
    const user = userEvent.setup();

    renderCliPage();

    await user.type(await screen.findByRole('textbox', { name: 'CLI input' }), '保持连接并观察重连');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(apiMocks.createRun).toHaveBeenCalledTimes(1);
      expect(eventSourceInstances).toHaveLength(1);
    });

    const firstSource = eventSourceInstances[0]!;
    firstSource.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_live_1',
          runId: 'run_cli_1',
          type: 'text_delta',
          payload: { delta: 'live output' },
          createdAt: '2026-05-06T10:20:01.000Z',
        }),
      }),
    );

    firstSource.onerror?.(new Event('error'));

    await waitFor(() => {
      expect(eventSourceInstances).toHaveLength(2);
    }, { timeout: 2500 });

    const secondSource = eventSourceInstances[1]!;
    secondSource.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_live_1',
          runId: 'run_cli_1',
          type: 'text_delta',
          payload: { delta: 'live output' },
          createdAt: '2026-05-06T10:20:01.000Z',
        }),
      }),
    );
    secondSource.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          eventId: 'evt_live_2',
          runId: 'run_cli_1',
          type: 'text_delta',
          payload: { delta: 'after reconnect' },
          createdAt: '2026-05-06T10:20:02.000Z',
        }),
      }),
    );

    const writes = xtermMocks.terminal.write.mock.calls.map(([value]) => String(value));
    expect(writes.filter((value) => value === 'live output')).toHaveLength(1);
    expect(writes.filter((value) => value === 'after reconnect')).toHaveLength(1);
    expect(writes.some((value) => value.includes('stream disconnected, reconnecting...'))).toBe(true);
  });

  it('restores waiting_user approval prompts on resume and replays a compact transcript window', async () => {
    const user = userEvent.setup();
    const updatedAt = new Date().toISOString();

    apiMocks.listRuns.mockResolvedValue([
      {
        runId: 'run_wait_1',
        taskKind: 'skill-management',
        status: 'waiting_user',
        input: { prompt: '审批技能测试' },
        routing: {
          acceptedTaskKind: 'skill-management',
          confidence: 0.96,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        metrics: {
          turnCount: 1,
          toolCallCount: 0,
          inputTokens: 10,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedUsd: 0.001,
        },
        createdAt: updatedAt,
        updatedAt,
      },
    ]);
    apiMocks.getRun.mockImplementation(async (runId: string) => ({
      runId,
      taskKind: 'skill-management',
      status: runId === 'run_wait_1' ? 'waiting_user' : 'running',
      input: { prompt: '审批技能测试' },
      routing: {
        acceptedTaskKind: 'skill-management',
        confidence: 0.96,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 1,
        toolCallCount: 0,
        inputTokens: 10,
        outputTokens: 0,
        cachedTokens: 0,
        estimatedUsd: 0.001,
      },
      createdAt: updatedAt,
      updatedAt,
    }));
    apiMocks.getRunEvents.mockImplementation(async (runId: string) => {
      if (runId !== 'run_wait_1') {
        return [];
      }

      return [
        ...Array.from({ length: 32 }, (_, index) => ({
          eventId: `evt_hist_${index + 1}`,
          runId,
          type: 'text_delta',
          payload: { delta: `hist-${String(index + 1).padStart(2, '0')}` },
          createdAt: `2026-05-06T10:20:${String(index).padStart(2, '0')}.000Z`,
        })),
        {
          eventId: 'evt_waiting',
          runId,
          type: 'waiting_user',
          payload: {
            requestId: 'ask_run_wait_1_1',
            question: '确认执行技能 dry-run：demo-skill？',
            options: ['确认', '取消'],
            promptKind: 'approval',
            checkpointId: 'chk_wait_1',
            checkpoint: {
              action: 'test',
              targetSkill: 'demo-skill',
            },
          },
          createdAt: '2026-05-06T10:21:00.000Z',
        },
      ];
    });

    renderCliPage();

    await user.click(await screen.findByRole('button', { name: 'Toggle sessions panel' }));
    const resumeButton = (await screen.findByText('审批技能测试')).closest('button');
    expect(resumeButton).toBeTruthy();
    await user.click(resumeButton!);

    await waitFor(() => {
      expect(screen.getByText('确认执行技能 dry-run：demo-skill？')).toBeTruthy();
    });
    expect(screen.getByText('waiting_user')).toBeTruthy();
    expect(screen.getByText('approval required')).toBeTruthy();
    expect(xtermMocks.terminal.write).toHaveBeenCalledWith(expect.stringContaining('replay '));
    expect(xtermMocks.terminal.write).not.toHaveBeenCalledWith('hist-01');
    expect(xtermMocks.terminal.write).toHaveBeenCalledWith('hist-32');

    await user.click(screen.getByRole('button', { name: /确认/ }));

    await waitFor(() => {
      expect(apiMocks.submitRunInput).toHaveBeenCalledWith('run_wait_1', {
        input: '确认',
        value: '确认',
        option: '确认',
        index: 0,
      });
    });
  });
});
