import { describe, it, expect, vi } from 'vitest';
import { QueryEngine } from '../QueryEngine.js';
import { MockProvider } from '../../llm/providers/MockProvider.js';
import { PromptAssembler } from '../../prompt/PromptAssembler.js';
import { ToolRegistry, buildTool } from '../../tools/registry/ToolRegistry.js';
import { CostTracker } from '../../cost/CostTracker.js';
import { SandboxRuntime } from '../../sandbox/SandboxRuntime.js';
import { createLocalProcessSandboxHost } from '../../sandbox/LocalProcessSandboxHost.js';

describe('QueryEngine with MockProvider', () => {
  it('emits system_init / text_delta / result in order', async () => {
    const mock = new MockProvider([{ text: 'hello from mock', stopReason: 'end_turn' }]);
    const engine = new QueryEngine(mock, new PromptAssembler(), new ToolRegistry(), new CostTracker(), {
      sessionId: 's1',
      model: 'mock-1',
      maxSteps: 5
    });
    const events: string[] = [];
    for await (const e of engine.submitMessage('你好')) {
      events.push(e.type);
    }
    expect(events[0]).toBe('system_init');
    expect(events).toContain('text_delta');
    expect(events[events.length - 1]).toBe('result');
  });

  it('stops on max_turns when model keeps producing nothing final', async () => {
    const mock = new MockProvider([{ text: 'a', stopReason: 'end_turn' }]);
    const engine = new QueryEngine(mock, new PromptAssembler(), new ToolRegistry(), new CostTracker(), {
      sessionId: 's2',
      model: 'mock',
      maxSteps: 1
    });
    const events: string[] = [];
    for await (const e of engine.submitMessage('hi')) {
      events.push(e.type);
    }
    expect(events).toContain('result');
  });

  it('treats maxSteps=0 as unlimited instead of stopping immediately', async () => {
    const mock = new MockProvider([{ text: 'hello from mock', stopReason: 'end_turn' }]);
    const engine = new QueryEngine(mock, new PromptAssembler(), new ToolRegistry(), new CostTracker(), {
      sessionId: 's2-unlimited',
      model: 'mock',
      maxSteps: 0,
    });
    const events: string[] = [];
    for await (const event of engine.submitMessage('hi')) {
      events.push(event.type);
    }
    expect(events).toContain('text_delta');
    expect(events).toContain('result');
  });

  it('parses sandbox metadata into tool execution context', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'process_probe', input: {} }] },
      { text: 'done', stopReason: 'end_turn' },
    ]);
    const registry = new ToolRegistry();
    const runtime = new SandboxRuntime([createLocalProcessSandboxHost()]);
    let capturedContext: any;

    registry.register(buildTool({
      name: 'process_probe',
      description: 'Probe sandbox context propagation',
      inputSchema: { type: 'object', properties: {} },
      isConcurrencySafe: true,
      isDestructive: false,
      sandboxProfile: 'local-process',
      sandboxHostKind: 'local-process',
      execute: async (_input, ctx) => {
        capturedContext = ctx;
        return { ok: true };
      },
    }));

    const engine = new QueryEngine(mock, new PromptAssembler(), registry, new CostTracker(), {
      sessionId: 's3',
      model: 'mock',
      maxSteps: 3,
      sandboxRuntime: runtime,
      sandboxEntrypoint: 'chat',
      sandboxWorkspaceRoots: ['D:/workspace'],
      toolTimeoutMs: 3210,
    });

    const events: any[] = [];
    for await (const event of engine.submitMessage('probe sandbox context')) {
      events.push(event);
    }

    expect(capturedContext.sandboxRuntime).toBe(runtime);
    expect(capturedContext.sandboxContext).toMatchObject({
      sessionId: 's3',
      entrypoint: 'chat',
      trustLevel: 'builtin',
      workspaceRoots: ['D:/workspace'],
    });
    expect(capturedContext.sandboxPolicy).toMatchObject({
      hostKind: 'local-process',
      filesystem: 'workspace-read',
      network: 'deny',
      interaction: 'none',
      maxDurationMs: 3210,
    });

    const toolStart = events.find((event) => event.type === 'tool_start');
    expect(toolStart?.sandbox).toMatchObject({
      profile: 'local-process',
      hostKind: 'local-process',
      entrypoint: 'chat',
    });
  });

  it('grants workspace-write to explicit interactive-write-capable tools outside terminal-cli', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'file_write', input: { path: 'notes.txt', content: 'hello' } }] },
      { text: 'done', stopReason: 'end_turn' },
    ]);
    const registry = new ToolRegistry();
    let capturedContext: any;

    registry.register(buildTool({
      name: 'file_write',
      description: 'Write a file through the sandbox',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      isReadOnly: false,
      isConcurrencySafe: false,
      isDestructive: false,
      sandboxProfile: 'local-process',
      sandboxHostKind: 'local-process',
      sandboxAccessTier: 'interactive-write-capable',
      execute: async (_input, ctx) => {
        capturedContext = ctx;
        return { ok: true };
      },
    }));

    const engine = new QueryEngine(mock, new PromptAssembler(), registry, new CostTracker(), {
      sessionId: 's5',
      model: 'mock',
      maxSteps: 3,
      sandboxEntrypoint: 'chat',
      sandboxWorkspaceRoots: ['D:/workspace'],
    });

    const events: any[] = [];
    for await (const event of engine.submitMessage('write a file', {
      askUserResolver: async () => '批准',
    })) {
      events.push(event);
    }

    expect(capturedContext.sandboxPolicy).toMatchObject({
      hostKind: 'local-process',
      filesystem: 'workspace-write',
      network: 'deny',
      interaction: 'none',
    });

    const toolStart = events.find((event) => event.type === 'tool_start');
    expect(toolStart?.sandbox).toMatchObject({
      hostKind: 'local-process',
      entrypoint: 'chat',
      filesystem: 'workspace-write',
    });
  });

  it('carries sandbox telemetry into tool progress and completion events', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'process_probe', input: {} }] },
      { text: 'done', stopReason: 'end_turn' },
    ]);
    const registry = new ToolRegistry();

    registry.register(buildTool({
      name: 'process_probe',
      description: 'Emit sandbox telemetry updates',
      inputSchema: { type: 'object', properties: {} },
      isConcurrencySafe: true,
      isDestructive: false,
      sandboxProfile: 'local-process',
      sandboxHostKind: 'local-process',
      async execute(_input, ctx) {
        ctx.onProgress?.({
          phase: 'sandbox',
          message: 'lease created',
          sandbox: {
            leaseId: 'lease-123',
            state: 'lease-created',
          },
        });
        ctx.onProgress?.({
          phase: 'sandbox',
          message: 'lease complete',
          sandbox: {
            leaseId: 'lease-123',
            state: 'completed',
            exitCode: 0,
          },
        });
        return { ok: true };
      },
    }));

    const engine = new QueryEngine(mock, new PromptAssembler(), registry, new CostTracker(), {
      sessionId: 's4',
      model: 'mock',
      maxSteps: 3,
      sandboxEntrypoint: 'chat',
    });

    const events: any[] = [];
    for await (const event of engine.submitMessage('probe sandbox telemetry')) {
      events.push(event);
    }

    const toolProgress = events.find((event) => event.type === 'tool_progress');
    const toolUseId = toolProgress?.toolUseId;
    expect(toolProgress).toMatchObject({
      progress: {
        phase: 'sandbox',
        message: 'lease created',
      },
      sandbox: {
        hostKind: 'local-process',
        entrypoint: 'chat',
        leaseId: 'lease-123',
        state: 'lease-created',
      },
    });

    const toolComplete = events.find((event) => event.type === 'tool_complete');
    expect(toolComplete).toMatchObject({
      toolUseId,
      sandbox: {
        hostKind: 'local-process',
        entrypoint: 'chat',
        leaseId: 'lease-123',
        state: 'completed',
        exitCode: 0,
      },
    });
  });

  it('requests approval before executing interactive-write-capable tools', async () => {
    const mock = new MockProvider([
      { toolCalls: [{ name: 'package_manager_write', input: { operation: 'add', packages: ['lodash'] } }] },
      { text: 'done', stopReason: 'end_turn' },
    ]);
    const registry = new ToolRegistry();
    const execute = vi.fn().mockResolvedValue({ ok: true });

    registry.register(buildTool({
      name: 'package_manager_write',
      description: 'Mutate dependencies through the package manager',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string' },
          packages: { type: 'array', items: { type: 'string' } },
        },
        required: ['operation', 'packages'],
      },
      isReadOnly: false,
      isConcurrencySafe: false,
      isDestructive: true,
      sandboxProfile: 'local-process',
      sandboxHostKind: 'local-process',
      sandboxAccessTier: 'interactive-write-capable',
      execute,
    }));

    const engine = new QueryEngine(mock, new PromptAssembler(), registry, new CostTracker(), {
      sessionId: 's6',
      model: 'mock',
      maxSteps: 3,
      sandboxEntrypoint: 'chat',
      permissionMode: 'default',
    });

    const events: any[] = [];
    for await (const event of engine.submitMessage('add lodash', {
      askUserResolver: async () => '批准',
    })) {
      events.push(event);
    }

    const approval = events.find((event) => event.type === 'ask_user');
    expect(approval).toMatchObject({
      question: expect.stringContaining('package_manager_write'),
      options: expect.arrayContaining(['批准', '拒绝']),
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('suppresses echoed system prompts and retries with a corrective user turn', async () => {
    let attempt = 0;
    const capturedMessages: Array<Array<{ role: string; content: string }>> = [];
    const call = vi.fn(async (opts: { systemPrompt: string; messages: Array<{ role: string; content: string }> }) => {
      attempt += 1;
      capturedMessages.push(opts.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      })));
      if (attempt === 1) {
        return {
          text: opts.systemPrompt,
          toolCalls: [],
          stopReason: 'end_turn' as const,
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cachedTokens: 0,
            estimatedUsd: 0,
          },
        };
      }

      return {
        text: 'Example Domain',
        toolCalls: [],
        stopReason: 'end_turn' as const,
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
      };
    });

    const engine = new QueryEngine({ providerId: 'test', call } as any, new PromptAssembler(), new ToolRegistry(), new CostTracker(), {
      sessionId: 's-prompt-echo',
      model: 'mock',
      maxSteps: 4,
      maxCorrectionRounds: 2,
    });

    const deltas: string[] = [];
    let resultEvent: any;
    for await (const event of engine.submitMessage('请用浏览器打开 https://example.com 并告诉我页面标题')) {
      if (event.type === 'text_delta') {
        deltas.push(event.text);
      }
      if (event.type === 'result') {
        resultEvent = event;
      }
    }

    expect(call).toHaveBeenCalledTimes(2);
    expect(deltas.join('')).toBe('Example Domain');
    expect(capturedMessages[1]?.at(-1)?.role).toBe('user');
    expect(capturedMessages[1]?.at(-1)?.content).toContain('你刚才重复或泄露了系统提示');
    expect(resultEvent).toMatchObject({
      result: 'Example Domain',
      stop_reason: 'natural_stop',
    });
  });

  it('attaches synthetic reasoning content when replaying automatic tool plans to thinking models', async () => {
    const capturedCalls: Array<{ messages: Array<{ role: string; reasoningContent?: string; toolCalls?: Array<{ name: string }> }> }> = [];
    const call = vi.fn(async (opts: { messages: Array<{ role: string; reasoningContent?: string; toolCalls?: Array<{ name: string }> }> }) => {
      capturedCalls.push({ messages: opts.messages });
      return {
        text: '已读取当前设置。',
        toolCalls: [],
        stopReason: 'end_turn' as const,
        usage: {
          inputTokens: 8,
          outputTokens: 4,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
      };
    });

    const registry = new ToolRegistry();
    registry.register(buildTool({
      name: 'system_settings',
      description: 'Read current settings',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
        },
        required: ['action'],
      },
      isReadOnly: false,
      isConcurrencySafe: true,
      isDestructive: false,
      alwaysLoad: true,
      execute: async () => ({
        ok: true,
        preferences: {
          webSearch: {
            defaultProvider: 'baidu',
          },
        },
      }),
    }));

    const engine = new QueryEngine({ providerId: 'test', call } as any, new PromptAssembler(), registry, new CostTracker(), {
      sessionId: 's-auto-tool-reasoning',
      model: 'deepseek-v4-pro',
      maxSteps: 4,
    });

    for await (const _event of engine.submitMessage('请读取当前 web search settings 并告诉我默认 provider')) {
      // consume stream
    }

    expect(call).toHaveBeenCalledTimes(1);
    const assistantMessage = capturedCalls[0]?.messages.find((message) => message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0);
    expect(assistantMessage?.toolCalls?.[0]?.name).toBe('system_settings');
    expect(assistantMessage?.reasoningContent).toContain('Automatic tool plan');
  });
});
