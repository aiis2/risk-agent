/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  createSkill: vi.fn(),
}));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    createSkill: apiMocks.createSkill,
  };
});

import { ArtifactPanel } from '../ArtifactPanel';
import type { RunArtifactRecord } from '../../../api/client';

function renderArtifactPanel(artifacts: RunArtifactRecord[], runStatus?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ArtifactPanel artifacts={artifacts} runStatus={runStatus} />
    </QueryClientProvider>,
  );
}

describe('ArtifactPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.createSkill.mockResolvedValue({
      success: true,
      data: { name: 'analysis-payment-risk-a1b2c3' },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('reviews a skill proposal artifact and publishes the edited payload', async () => {
    const user = userEvent.setup();

    renderArtifactPanel([
      {
        artifactId: 'art_skill_proposal',
        runId: 'run_1',
        kind: 'json',
        mimeType: 'application/json',
        contentJson: {
          type: 'skill-proposal',
          sourceRunId: 'run_1',
          taskKind: 'analysis',
          title: '快捷支付风控分析',
          rationale: '该工作流适合沉淀为可复用技能。',
          triggerHints: ['分析快捷支付风控'],
          workflow: ['加载规则', '生成报告'],
          evidence: ['Overall score: 91'],
          publishHint: 'POST to /api/skills after review.',
          creationPayload: {
            name: 'analysis-payment-risk-a1b2c3',
            description: '快捷支付风控分析可复用技能草案',
            content: '# 快捷支付风控分析\n\n## Workflow\n1. 加载规则',
          },
        },
        version: 2,
        createdAt: '2026-04-27T15:00:00.000Z',
      },
    ]);

    expect(await screen.findByText('Skill proposal')).toBeTruthy();
    expect(screen.getByDisplayValue('analysis-payment-risk-a1b2c3')).toBeTruthy();

    await user.clear(screen.getByLabelText('Skill name'));
    await user.type(screen.getByLabelText('Skill name'), 'analysis-payment-risk-reviewed');
    await user.clear(screen.getByLabelText('Skill description'));
    await user.type(screen.getByLabelText('Skill description'), '审核后的快捷支付风控技能');
    await user.type(screen.getByLabelText('Skill content'), '\n2. 输出报告');
    await user.click(screen.getByRole('button', { name: '发布技能' }));

    await waitFor(() => {
      expect(apiMocks.createSkill).toHaveBeenCalledWith({
        name: 'analysis-payment-risk-reviewed',
        description: '审核后的快捷支付风控技能',
        content: '# 快捷支付风控分析\n\n## Workflow\n1. 加载规则\n2. 输出报告',
      });
    });

    expect(await screen.findByText(/已发布为 analysis-payment-risk-reviewed/i)).toBeTruthy();
  });

  it('prioritizes risk reports over newer skill proposals when both are present', async () => {
    renderArtifactPanel([
      {
        artifactId: 'art_skill_proposal_latest',
        runId: 'run_1',
        kind: 'json',
        mimeType: 'application/json',
        contentJson: {
          type: 'skill-proposal',
          sourceRunId: 'run_1',
          taskKind: 'analysis',
          title: '支付风险巡检',
          rationale: '最新 artifact 应优先显示。',
          triggerHints: ['分析支付风险'],
          workflow: ['加载规则', '输出巡检结论'],
          evidence: ['latest-first'],
          creationPayload: {
            name: 'analysis-payment-risk-latest',
            description: '最新提案',
            content: '# latest',
          },
        },
        version: 2,
        createdAt: '2026-04-27T16:00:00.000Z',
      },
      {
        artifactId: 'art_report_older',
        runId: 'run_1',
        kind: 'report',
        mimeType: 'application/json',
        contentJson: {
          reportId: 'report_1',
          businessName: '支付风险巡检总览',
          overallScore: 91,
        },
        version: 1,
        createdAt: '2026-04-27T15:59:00.000Z',
      },
    ]);

    expect(await screen.findByText('风控分析报告')).toBeTruthy();
    expect(screen.getByText('支付风险巡检总览')).toBeTruthy();
    expect(screen.queryByText('Skill proposal')).toBeNull();
    expect(screen.queryByDisplayValue('analysis-payment-risk-latest')).toBeNull();
  });

  it('renders structured-answer response as markdown and keeps auxiliary sections collapsed by default', async () => {
    const user = userEvent.setup();

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_structured_answer',
        runId: 'run_structured',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '# Example Domain\n\nThis domain is for use in illustrative examples in documents.',
          notes: ['截图来自浏览器工具链路'],
          suggestedNextActions: ['查看 IANA 保留域名说明'],
        },
        version: 1,
        createdAt: '2026-05-06T08:36:37.999Z',
      },
    ];

    renderArtifactPanel(artifacts);

    expect(screen.getByRole('heading', { name: 'Example Domain' })).toBeTruthy();
    expect(screen.getByText(/This domain is for use in illustrative examples/i)).toBeTruthy();
    expect(screen.queryByText('截图来自浏览器工具链路')).toBeNull();
    expect(screen.queryByText('查看 IANA 保留域名说明')).toBeNull();

    await user.click(screen.getByRole('button', { name: /辅助内容/i }));

    expect(screen.getByText('截图来自浏览器工具链路')).toBeTruthy();
    expect(screen.getByText('查看 IANA 保留域名说明')).toBeTruthy();
  });

  it('renders markdown and mermaid content inside the process explanation section', async () => {
    const user = userEvent.setup();

    renderArtifactPanel([
      {
        artifactId: 'art_structured_answer_mermaid_process',
        runId: 'run_structured_mermaid_process',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: [
            '先梳理执行链路：',
            '',
            '```mermaid',
            'graph TD',
            'A[读取设置] --> B[创建场景]',
            'B --> C[写入图谱]',
            '```',
            '',
            '---',
            '',
            '## 最终结论',
            '',
            '全部步骤已完成。',
          ].join('\n'),
        },
        version: 1,
        createdAt: '2026-05-25T08:20:00.000Z',
      },
    ], 'completed');

    expect(screen.getByRole('heading', { name: '最终结论' })).toBeTruthy();
    expect(screen.queryByText('Mermaid 流程图')).toBeNull();

    await user.click(screen.getByRole('button', { name: /辅助内容展开/i }));

    expect(screen.getAllByText('Mermaid 流程图').length).toBeGreaterThan(0);
    expect(screen.getByText('先梳理执行链路：')).toBeTruthy();
    expect(screen.getByText(/graph TD/)).toBeTruthy();
  });

  it('auto-collapses auxiliary sections once the run finishes if the user never toggled them', () => {
    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_structured_answer_running',
        runId: 'run_structured_running',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '# Example Domain\n\nThis domain is for use in illustrative examples in documents.',
          notes: ['截图来自浏览器工具链路'],
        },
        version: 1,
        createdAt: '2026-05-06T08:36:37.999Z',
      },
    ];

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <ArtifactPanel artifacts={artifacts} runStatus="running" />
      </QueryClientProvider>,
    );

    expect(screen.getByText('截图来自浏览器工具链路')).toBeTruthy();

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ArtifactPanel artifacts={artifacts} runStatus="completed" />
      </QueryClientProvider>,
    );

    expect(screen.queryByText('截图来自浏览器工具链路')).toBeNull();
  });

  it('preserves the user-expanded auxiliary state after completion', async () => {
    const user = userEvent.setup();
    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_structured_answer_preserve',
        runId: 'run_structured_preserve',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '# Example Domain\n\nThis domain is for use in illustrative examples in documents.',
          notes: ['截图来自浏览器工具链路'],
        },
        version: 1,
        createdAt: '2026-05-06T08:36:37.999Z',
      },
    ];

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <ArtifactPanel artifacts={artifacts} runStatus="running" />
      </QueryClientProvider>,
    );

    expect(screen.getByText('截图来自浏览器工具链路')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /辅助内容收起/i }));
    expect(screen.queryByText('截图来自浏览器工具链路')).toBeNull();

    await user.click(screen.getByRole('button', { name: /辅助内容展开/i }));
    expect(screen.getByText('截图来自浏览器工具链路')).toBeTruthy();

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ArtifactPanel artifacts={artifacts} runStatus="completed" />
      </QueryClientProvider>,
    );

    expect(screen.getByText('截图来自浏览器工具链路')).toBeTruthy();
  });
});