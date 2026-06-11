import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkerProgressCard } from '../WorkerProgressCard';
import type { WorkerRecord } from '../../../stores/chatStore';

function makeWorker(overrides: Partial<WorkerRecord> = {}): WorkerRecord {
  return {
    agentId: 'worker-001',
    description: 'Research phase',
    role: 'research',
    phase: 'research',
    progress: ['正在扫描支付场景规则覆盖'],
    status: 'running',
    ...overrides,
  };
}

describe('WorkerProgressCard', () => {
  it('renders worker badge, title, role and running status', () => {
    const html = renderToStaticMarkup(createElement(WorkerProgressCard, {
      worker: makeWorker(),
    }));

    expect(html).toContain('子智能体');
    expect(html).toContain('Research phase');
    expect(html).toContain('research');
    expect(html).toContain('运行中');
  });

  it('shows collapsed summary preview for completed workers', () => {
    const html = renderToStaticMarkup(createElement(WorkerProgressCard, {
      worker: makeWorker({
        status: 'done',
        summary: '已完成覆盖率汇总与缺口归类。',
        progress: [],
      }),
    }));

    expect(html).toContain('完成');
    expect(html).toContain('已完成覆盖率汇总与缺口归类');
  });

  it('renders an execution trace label with log count metadata', () => {
    const html = renderToStaticMarkup(createElement(WorkerProgressCard, {
      worker: makeWorker({
        progress: ['步骤一', '步骤二'],
      }),
    }));

    expect(html).toContain('执行轨迹');
    expect(html).toContain('2 条日志');
  });
});