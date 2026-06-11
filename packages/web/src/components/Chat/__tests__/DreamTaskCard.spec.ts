import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DreamTaskCard } from '../DreamTaskCard';
import type { DreamTaskRecord } from '../../../stores/chatStore';

function makeTask(overrides: Partial<DreamTaskRecord> = {}): DreamTaskRecord {
  return {
    taskId: 'task-001',
    description: '生成可视化报表',
    status: 'running',
    progress: ['正在整理字段映射', '正在输出图表草稿'],
    ...overrides,
  };
}

describe('DreamTaskCard', () => {
  it('renders the background task label and running status', () => {
    const html = renderToStaticMarkup(createElement(DreamTaskCard, {
      task: makeTask(),
    }));

    expect(html).toContain('后台任务');
    expect(html).toContain('生成可视化报表');
    expect(html).toContain('后台运行中');
  });

  it('shows progress logs for running tasks because they default to expanded', () => {
    const html = renderToStaticMarkup(createElement(DreamTaskCard, {
      task: makeTask(),
    }));

    expect(html).toContain('进度日志');
    expect(html).toContain('正在输出图表草稿');
  });

  it('renders completed terminal status in the header', () => {
    const html = renderToStaticMarkup(createElement(DreamTaskCard, {
      task: makeTask({
        status: 'completed',
        progress: [],
        summary: '已完成图表生成与导出。',
      }),
    }));

    expect(html).toContain('已完成');
    expect(html).toContain('task-001');
  });
});