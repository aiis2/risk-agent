/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ModelConfigRecord, SessionAttachment, ToolSummary } from '../../../api/client';
import { AgentComposerCard } from '../AgentComposerCard';

function renderComposer(overrides: Partial<ComponentProps<typeof AgentComposerCard>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const onValueChange = vi.fn();
  const onSubmit = vi.fn();
  const onModeChange = vi.fn();
  const onToggleTool = vi.fn();
  const onRemoveAttachment = vi.fn();
  const onSelectFiles = vi.fn();
  const onRemoveQueuedMessage = vi.fn();
  const onModelChange = vi.fn();
  const onTextareaHeightChange = vi.fn();

  const models: ModelConfigRecord[] = [
    {
      modelId: 'model-default',
      modelName: 'qwen-plus',
      provider: 'openai-compatible',
      enabled: true,
      isDefault: true,
      config: {},
      createdAt: new Date().toISOString(),
    },
  ];

  const tools: ToolSummary[] = [
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
  ];

  const attachments: SessionAttachment[] = [
    {
      attachmentId: 'att-1',
      filename: 'evidence.txt',
      contentType: 'text/plain',
      sizeBytes: 128,
      textPreview: 'preview',
    },
  ];

  const baseProps: ComponentProps<typeof AgentComposerCard> = {
    value: 'follow-up guidance',
    onValueChange,
    placeholder: '输入你的任务、补充约束，或粘贴附件开始…',
    disabled: false,
    onSubmit,
    submitLabel: '发送',
    busy: false,
    running: false,
    footerHint: '首次发送会创建新 run',
    onTextareaHeightChange,
    models,
    selectedModelId: 'model-default',
    onModelChange,
    tools,
    selectedToolIds: ['query_database'],
    onToggleTool,
    attachments,
    onRemoveAttachment,
    onSelectFiles,
    uploadingNames: [],
    attachmentError: null,
    fileInputRef: createRef<HTMLInputElement>(),
    queueMessages: [
      {
        id: 'q1',
        content: 'queued guidance',
        modeLabel: '添加到队列',
        meta: ['附件 1', '工具 1'],
      },
    ],
    onRemoveQueuedMessage,
    sendModes: [
      { value: 'stop-and-send', label: '停止并发送' },
      { value: 'queue', label: '添加到队列' },
      { value: 'steer', label: '通过消息引导' },
    ],
    selectedSendMode: 'stop-and-send',
    onSelectSendMode: onModeChange,
  };

  const renderUi = (nextOverrides: Partial<ComponentProps<typeof AgentComposerCard>> = {}) => (
    <QueryClientProvider client={queryClient}>
      <AgentComposerCard
        {...baseProps}
        {...overrides}
        {...nextOverrides}
      />
    </QueryClientProvider>
  );

  const result = render(renderUi());

  return {
    ...result,
    onValueChange,
    onSubmit,
    onModeChange,
    onRemoveQueuedMessage,
    onTextareaHeightChange,
    rerenderComposer: (nextOverrides: Partial<ComponentProps<typeof AgentComposerCard>> = {}) => result.rerender(renderUi(nextOverrides)),
  };
}

describe('AgentComposerCard', () => {
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
  });

  it('renders queue state and submits from the shared composer shell', async () => {
    const user = userEvent.setup();
    const { onSubmit, onRemoveQueuedMessage } = renderComposer();

    expect(screen.getByText('待发消息')).toBeTruthy();
    expect(screen.getByText('queued guidance')).toBeTruthy();
    expect(screen.getByText('首次发送会创建新 run')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '移除' }));
    expect(onRemoveQueuedMessage).toHaveBeenCalledWith('q1');

    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the running gradient ring while agent output is executing', () => {
    renderComposer({
      running: true,
      canCancel: true,
      onCancel: vi.fn(),
      onSubmitWithMode: vi.fn(),
      hasActiveRun: true,
    });

    const runningRing = screen.getByTestId('composer-running-ring');

    expect(runningRing).toBeTruthy();
    expect(runningRing.className).not.toContain('animate-[spin');
  });

  it('caps textarea growth and switches to inner scrolling for oversized content', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();
    const { rerenderComposer } = renderComposer({
      value: '短文本',
      textareaRef,
      attachments: [],
      queueMessages: [],
    });

    const textarea = textareaRef.current;
    expect(textarea).toBeTruthy();

    Object.defineProperty(textarea as HTMLTextAreaElement, 'scrollHeight', {
      configurable: true,
      value: 360,
    });

    rerenderComposer({
      value: '这是会持续增长的多行输入\n'.repeat(20),
      textareaRef,
      attachments: [],
      queueMessages: [],
    });

    expect((textarea as HTMLTextAreaElement).style.height).toBe('300px');
    expect((textarea as HTMLTextAreaElement).style.overflowY).toBe('auto');
  });

  it('reports manual textarea resize changes within the 300px limit', () => {
    const textareaRef = createRef<HTMLTextAreaElement>();
    const { onTextareaHeightChange } = renderComposer({
      textareaRef,
      attachments: [],
      queueMessages: [],
    });

    const textarea = textareaRef.current as HTMLTextAreaElement;
    textarea.style.height = '220px';

    fireEvent.mouseUp(textarea);

    expect(onTextareaHeightChange).toHaveBeenCalledWith(220);
  });
});