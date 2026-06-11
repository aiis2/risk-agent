/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ModelConfigRecord, ToolSummary } from '../../../api/client';
import { RunComposerControls } from '../RunComposerControls';

function renderControls() {
  const onModelChange = vi.fn();
  const onToggleTool = vi.fn();
  const onRemoveAttachment = vi.fn();
  const onSelectFiles = vi.fn();

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
    {
      modelId: 'model-coder',
      modelName: 'qwen3-coder-plus',
      provider: 'openai-compatible',
      enabled: true,
      isDefault: false,
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
    {
      name: 'graph_query',
      description: 'Traverse graph knowledge',
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

  render(
    <RunComposerControls
      models={models}
      selectedModelId="model-default"
      onModelChange={onModelChange}
      tools={tools}
      selectedToolIds={['query_database']}
      onToggleTool={onToggleTool}
      attachments={[]}
      onRemoveAttachment={onRemoveAttachment}
      onSelectFiles={onSelectFiles}
      uploadingNames={[]}
      attachmentError={null}
      fileInputRef={createRef<HTMLInputElement>()}
    />,
  );

  return {
    onModelChange,
    onToggleTool,
  };
}

describe('RunComposerControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses custom expandable trays for model and tool selection', async () => {
    const user = userEvent.setup();
    const { onModelChange, onToggleTool } = renderControls();

    await user.click(screen.getByRole('button', { name: /qwen-plus/i }));
    expect(screen.getByText('模型配置')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /qwen3-coder-plus/i }));
    expect(onModelChange).toHaveBeenCalledWith('model-coder');

    await user.click(screen.getByRole('button', { name: '工具 1' }));
    expect(await screen.findByText(/工具(白名单|限制)/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /graph_query/i }));
    expect(onToggleTool).toHaveBeenCalledWith('graph_query');
  });
});