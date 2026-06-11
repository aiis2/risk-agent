/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunTimeline } from '../RunTimeline';
import type { RunArtifactRecord, RunSummary, RunTimelineEvent } from '../../../api/client';

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

describe('RunTimeline', () => {
  beforeEach(() => {
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('PointerEvent', MouseEvent);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('groups user follow-up and assistant progress into chat-style blocks', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_1',
        runId: 'run_1',
        type: 'run_created',
        payload: { taskKind: 'analysis' },
        createdAt: '2026-04-27T09:00:00.000Z',
      },
      {
        eventId: 'evt_2',
        runId: 'run_1',
        type: 'routed',
        payload: { acceptedTaskKind: 'analysis' },
        createdAt: '2026-04-27T09:00:01.000Z',
      },
      {
        eventId: 'evt_3',
        runId: 'run_1',
        type: 'user_message',
        payload: {
          content: '请重点补充异常登录链路',
          attachmentIds: ['att_1'],
          toolIds: ['query_database'],
          mode: 'stop-and-send',
        },
        createdAt: '2026-04-27T09:00:02.000Z',
      },
      {
        eventId: 'evt_4',
        runId: 'run_1',
        type: 'knowledge_query_started',
        payload: {
          query: '异常登录链路',
          keywords: ['异常登录', '设备切换'],
          allowedSources: ['scenario', 'rule'],
        },
        createdAt: '2026-04-27T09:00:03.000Z',
      },
      {
        eventId: 'evt_5',
        runId: 'run_1',
        type: 'checkpoint_created',
        payload: {
          checkpointId: 'chk_1',
          kind: 'running-step',
          scope: 'semantic',
          semanticKind: 'knowledge-search-complete',
        },
        createdAt: '2026-04-27T09:00:04.000Z',
      },
      {
        eventId: 'evt_6',
        runId: 'run_1',
        type: 'knowledge_query_completed',
        payload: {
          query: '异常登录链路',
          totalMatches: 3,
        },
        createdAt: '2026-04-27T09:00:05.000Z',
      },
      {
        eventId: 'evt_7',
        runId: 'run_1',
        type: 'verifier_finished',
        payload: {
          decision: 'pass',
          reasons: ['matches_found:3'],
        },
        createdAt: '2026-04-27T09:00:06.000Z',
      },
      {
        eventId: 'evt_8',
        runId: 'run_1',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-04-27T09:00:07.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.getByText('请重点补充异常登录链路')).toBeTruthy();
    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0);
    expect(screen.getByText('正在检索知识库')).toBeTruthy();
    expect(screen.getByText('命中 3 条相关结果')).toBeTruthy();
    expect(screen.getByText('验证通过')).toBeTruthy();
    expect(screen.queryByText('knowledge_query_started')).toBeNull();
  });

  it('shows copy and resend actions for user chat bubbles', async () => {
    const user = userEvent.setup();
    const onResendUserMessage = vi.fn();
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_user_actions_1',
        runId: 'run_user_actions',
        type: 'user_message',
        payload: {
          content: '请重新检查这条 follow-up',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:00:00.000Z',
      },
    ];

    render(<RunTimeline events={events} onResendUserMessage={onResendUserMessage} />);

    const bubble = screen.getByText('请重新检查这条 follow-up').closest('li');
    expect(bubble).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制用户消息' })).toBeNull();

    fireEvent.mouseOver(bubble as HTMLElement);
    await waitFor(() => {
      expect(within(bubble as HTMLElement).getByRole('button', { name: '复制用户消息' })).toBeTruthy();
    });
    await user.click(within(bubble as HTMLElement).getByRole('button', { name: '复制用户消息' }));
    await waitFor(() => {
      expect(within(bubble as HTMLElement).getByRole('button', { name: '复制用户消息' }).textContent).toContain('已复制');
    });

    fireEvent.click(within(bubble as HTMLElement).getByRole('button', { name: '重新发送用户消息' }));
    expect(onResendUserMessage).toHaveBeenCalledWith('请重新检查这条 follow-up');
  });

  it('only exposes resend on the latest user bubble while keeping copy hover-triggered', async () => {
    const onResendUserMessage = vi.fn();
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_user_old',
        runId: 'run_user_actions',
        type: 'user_message',
        payload: {
          content: '第一条用户消息',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:00:00.000Z',
      },
      {
        eventId: 'evt_user_latest',
        runId: 'run_user_actions',
        type: 'user_message',
        payload: {
          content: '最近一条用户消息',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:01:00.000Z',
      },
    ];

    render(<RunTimeline events={events} onResendUserMessage={onResendUserMessage} />);

    const oldBubble = screen.getByText('第一条用户消息').closest('li');
    const latestBubble = screen.getByText('最近一条用户消息').closest('li');

    expect(oldBubble).toBeTruthy();
    expect(latestBubble).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制用户消息' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新发送用户消息' })).toBeNull();

    fireEvent.mouseOver(oldBubble as HTMLElement);
    await waitFor(() => {
      expect(within(oldBubble as HTMLElement).getByRole('button', { name: '复制用户消息' })).toBeTruthy();
    });
    expect(within(oldBubble as HTMLElement).queryByRole('button', { name: '重新发送用户消息' })).toBeNull();

    fireEvent.mouseLeave(oldBubble as HTMLElement);
    fireEvent.mouseOver(latestBubble as HTMLElement);
    await waitFor(() => {
      expect(within(latestBubble as HTMLElement).getByRole('button', { name: '重新发送用户消息' })).toBeTruthy();
    });
    fireEvent.click(within(latestBubble as HTMLElement).getByRole('button', { name: '重新发送用户消息' }));

    expect(onResendUserMessage).toHaveBeenCalledWith('最近一条用户消息');
  });

  it('keeps earlier assistant turn artifacts visible in multi-turn chat history', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_turn_1_user',
        runId: 'run_multiturn',
        type: 'user_message',
        payload: {
          content: '先回答第一轮',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:00:00.000Z',
      },
      {
        eventId: 'evt_turn_1_artifact',
        runId: 'run_multiturn',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_turn_1',
          kind: 'structured-answer',
          version: 1,
        },
        createdAt: '2026-05-06T12:00:10.000Z',
      },
      {
        eventId: 'evt_turn_2_user',
        runId: 'run_multiturn',
        type: 'user_message',
        payload: {
          content: '继续第二轮',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:01:00.000Z',
      },
      {
        eventId: 'evt_turn_2_artifact',
        runId: 'run_multiturn',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_turn_2',
          kind: 'structured-answer',
          version: 1,
        },
        createdAt: '2026-05-06T12:01:10.000Z',
      },
      {
        eventId: 'evt_turn_2_complete',
        runId: 'run_multiturn',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T12:01:20.000Z',
      },
    ];

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_turn_1',
        runId: 'run_multiturn',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '第一轮 Agent 回复',
        },
        version: 1,
        createdAt: '2026-05-06T12:00:10.000Z',
      },
      {
        artifactId: 'art_turn_2',
        runId: 'run_multiturn',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '第二轮 Agent 回复',
        },
        version: 1,
        createdAt: '2026-05-06T12:01:10.000Z',
      },
    ];

    render(<RunTimeline events={events} artifacts={artifacts} />);

    expect(screen.getByText('第一轮 Agent 回复')).toBeTruthy();
    expect(screen.getByText('第二轮 Agent 回复')).toBeTruthy();
  });

  it('does not attach the previous artifact to a newer assistant turn before a new artifact arrives', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_turn_repeat_user_1',
        runId: 'run_turn_repeat',
        type: 'user_message',
        payload: {
          content: '先回答第一轮',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:00:00.000Z',
      },
      {
        eventId: 'evt_turn_repeat_artifact_1',
        runId: 'run_turn_repeat',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_turn_repeat_1',
          kind: 'structured-answer',
          version: 1,
        },
        createdAt: '2026-05-06T12:00:10.000Z',
      },
      {
        eventId: 'evt_turn_repeat_user_2',
        runId: 'run_turn_repeat',
        type: 'user_message',
        payload: {
          content: '继续第二轮',
          mode: 'steer',
        },
        createdAt: '2026-05-06T12:01:00.000Z',
      },
      {
        eventId: 'evt_turn_repeat_assistant_2',
        runId: 'run_turn_repeat',
        type: 'general_response_started',
        payload: {
          responseMode: 'tool-assisted',
          toolIds: ['web_search'],
          attachmentCount: 0,
        },
        createdAt: '2026-05-06T12:01:03.000Z',
      },
    ];

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_turn_repeat_1',
        runId: 'run_turn_repeat',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '第一轮 Agent 回复',
        },
        version: 1,
        createdAt: '2026-05-06T12:00:10.000Z',
      },
    ];

    render(<RunTimeline events={events} artifacts={artifacts} />);

    expect(screen.getAllByText('第一轮 Agent 回复')).toHaveLength(1);
  });

  it('adds artifact and metrics summary cards to the latest assistant group', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_summary_1',
        runId: 'run_summary',
        type: 'user_message',
        payload: {
          content: '请输出这轮分析结论',
          mode: 'stop-and-send',
        },
        createdAt: '2026-04-27T09:20:00.000Z',
      },
      {
        eventId: 'evt_summary_2',
        runId: 'run_summary',
        type: 'general_response_started',
        payload: {
          responseMode: 'attachment-grounded',
          toolIds: ['file_parse', 'query_database'],
          attachmentCount: 1,
        },
        createdAt: '2026-04-27T09:20:01.000Z',
      },
      {
        eventId: 'evt_summary_3',
        runId: 'run_summary',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_summary',
          kind: 'structured-answer',
          version: 2,
        },
        createdAt: '2026-04-27T09:20:02.000Z',
      },
      {
        eventId: 'evt_summary_4',
        runId: 'run_summary',
        type: 'verifier_finished',
        payload: {
          decision: 'pass',
          reasons: ['general_response_prepared'],
        },
        createdAt: '2026-04-27T09:20:03.000Z',
      },
      {
        eventId: 'evt_summary_5',
        runId: 'run_summary',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-04-27T09:20:04.000Z',
      },
    ];

    const run: RunSummary = {
      runId: 'run_summary',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '请输出这轮分析结论' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 6,
        toolCallCount: 3,
        inputTokens: 320,
        outputTokens: 540,
        cachedTokens: 40,
        estimatedUsd: 0.034,
      },
      createdAt: '2026-04-27T09:19:50.000Z',
      updatedAt: '2026-04-27T09:20:04.000Z',
      completedAt: '2026-04-27T09:20:04.000Z',
    };

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_summary',
        runId: 'run_summary',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          summary: '异常登录与设备切换形成了高风险串联信号，需要优先拦截。',
          actions: ['加强设备绑定校验'],
        },
        version: 2,
        createdAt: '2026-04-27T09:20:02.000Z',
      },
    ];

    render(<RunTimeline events={events} run={run} artifacts={artifacts} />);

    expect(screen.getByText('structured-answer v2')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('异常登录与设备切换形成了高风险串联信号，需要优先拦截。'))).toBeTruthy();
    expect(screen.getByText('Turns')).toBeTruthy();
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('Tokens')).toBeTruthy();
    expect(screen.getByText('860')).toBeTruthy();
    expect(screen.getByText('$0.0340')).toBeTruthy();
  });

  it('hides setup and research chrome for lightweight general first-turn answers', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_light_general_1',
        runId: 'run_light_general',
        type: 'run_created',
        payload: { taskKind: 'general' },
        createdAt: '2026-05-09T03:21:38.987Z',
      },
      {
        eventId: 'evt_light_general_2',
        runId: 'run_light_general',
        type: 'routed',
        payload: {
          acceptedTaskKind: 'general',
          confidence: 0.64,
          reason: 'semantic_capability_entry',
          routeParams: {},
        },
        createdAt: '2026-05-09T03:21:39.015Z',
      },
      {
        eventId: 'evt_light_general_3',
        runId: 'run_light_general',
        type: 'plan_created',
        payload: {
          prompt: '请只回答 2+3 等于几，只返回结果。',
          responseMode: 'answer-only',
        },
        createdAt: '2026-05-09T03:21:39.016Z',
      },
      {
        eventId: 'evt_light_general_4',
        runId: 'run_light_general',
        type: 'research_progress',
        payload: {
          dimension: 'coverage',
          status: 'completed',
        },
        createdAt: '2026-05-09T03:21:39.100Z',
      },
      {
        eventId: 'evt_light_general_5',
        runId: 'run_light_general',
        type: 'general_response_started',
        payload: {
          responseMode: 'answer-only',
          toolIds: [],
          attachmentCount: 0,
        },
        createdAt: '2026-05-09T03:21:39.200Z',
      },
      {
        eventId: 'evt_light_general_6',
        runId: 'run_light_general',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_light_general',
          kind: 'structured-answer',
          version: 1,
        },
        createdAt: '2026-05-09T03:21:50.542Z',
      },
      {
        eventId: 'evt_light_general_7',
        runId: 'run_light_general',
        type: 'verifier_finished',
        payload: {
          decision: 'pass',
          reasons: ['general_response_prepared'],
        },
        createdAt: '2026-05-09T03:21:50.542Z',
      },
      {
        eventId: 'evt_light_general_8',
        runId: 'run_light_general',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-09T03:21:50.543Z',
      },
    ];

    const run: RunSummary = {
      runId: 'run_light_general',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '请只回答 2+3 等于几，只返回结果。' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 0.64,
        reason: 'semantic_capability_entry',
        routeParams: {},
      },
      metrics: {
        turnCount: 1,
        toolCallCount: 0,
        inputTokens: 682,
        outputTokens: 59,
        cachedTokens: 0,
        estimatedUsd: 0,
      },
      createdAt: '2026-05-09T03:21:38.987Z',
      updatedAt: '2026-05-09T03:21:50.543Z',
      completedAt: '2026-05-09T03:21:50.543Z',
    };

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_light_general',
        runId: 'run_light_general',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '5',
        },
        version: 1,
        createdAt: '2026-05-09T03:21:50.542Z',
      },
    ];

    render(<RunTimeline events={events} run={run} artifacts={artifacts} />);

    expect(screen.getByText('请只回答 2+3 等于几，只返回结果。')).toBeTruthy();
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    expect(screen.queryByText('初始化')).toBeNull();
    expect(screen.queryByText('研究进度')).toBeNull();
    expect(screen.queryByText('执行计划已生成')).toBeNull();
    expect(screen.queryByText('正在整理通用回复')).toBeNull();
  });

  it('keeps research progress visible for heavy analysis runs', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_heavy_analysis_1',
        runId: 'run_heavy_analysis',
        type: 'run_created',
        payload: { taskKind: 'analysis' },
        createdAt: '2026-05-09T03:30:00.000Z',
      },
      {
        eventId: 'evt_heavy_analysis_2',
        runId: 'run_heavy_analysis',
        type: 'routed',
        payload: {
          acceptedTaskKind: 'analysis',
          confidence: 1,
          reason: 'explicit_task_kind',
          routeParams: {},
        },
        createdAt: '2026-05-09T03:30:01.000Z',
      },
      {
        eventId: 'evt_heavy_analysis_3',
        runId: 'run_heavy_analysis',
        type: 'plan_created',
        payload: {
          businessName: '分析最近十五分钟的支付风控异常并输出摘要',
        },
        createdAt: '2026-05-09T03:30:02.000Z',
      },
      {
        eventId: 'evt_heavy_analysis_4',
        runId: 'run_heavy_analysis',
        type: 'research_progress',
        payload: {
          dimension: 'coverage',
          status: 'completed',
        },
        createdAt: '2026-05-09T03:30:03.000Z',
      },
      {
        eventId: 'evt_heavy_analysis_5',
        runId: 'run_heavy_analysis',
        type: 'research_progress',
        payload: {
          dimension: 'risk-rules',
          status: 'completed',
        },
        createdAt: '2026-05-09T03:30:04.000Z',
      },
      {
        eventId: 'evt_heavy_analysis_6',
        runId: 'run_heavy_analysis',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_heavy_analysis',
          kind: 'report',
          version: 1,
        },
        createdAt: '2026-05-09T03:30:05.000Z',
      },
      {
        eventId: 'evt_heavy_analysis_7',
        runId: 'run_heavy_analysis',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-09T03:30:06.000Z',
      },
    ];

    const run: RunSummary = {
      runId: 'run_heavy_analysis',
      taskKind: 'analysis',
      status: 'completed',
      input: { prompt: '分析最近十五分钟的支付风控异常并输出摘要' },
      routing: {
        acceptedTaskKind: 'analysis',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 1,
        toolCallCount: 3,
        inputTokens: 1000,
        outputTokens: 200,
        cachedTokens: 0,
        estimatedUsd: 0.01,
      },
      createdAt: '2026-05-09T03:30:00.000Z',
      updatedAt: '2026-05-09T03:30:06.000Z',
      completedAt: '2026-05-09T03:30:06.000Z',
    };

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_heavy_analysis',
        runId: 'run_heavy_analysis',
        kind: 'report',
        mimeType: 'application/json',
        contentJson: {
          businessName: '分析最近十五分钟的支付风控异常并输出摘要',
          overallScore: 87,
          coverageMatrix: [],
        },
        version: 1,
        createdAt: '2026-05-09T03:30:05.000Z',
      },
    ];

    render(<RunTimeline events={events} run={run} artifacts={artifacts} />);

    const setupToggle = screen.getByRole('button', { name: /初始化/ });
    expect(setupToggle).toBeTruthy();

    fireEvent.click(setupToggle);

    expect(screen.getByText('研究进度')).toBeTruthy();
    expect(screen.getByText('Coverage')).toBeTruthy();
    expect(screen.getByText('风险规则')).toBeTruthy();
    expect(screen.getByText('执行计划已生成')).toBeTruthy();
  });

  it('renders structured-answer summary cards with markdown body and collapsed auxiliary content', async () => {
    const user = userEvent.setup();

    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_summary_structured_1',
        runId: 'run_structured_timeline',
        type: 'user_message',
        payload: {
          content: '请总结 example.com 页面内容',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-06T08:36:00.000Z',
      },
      {
        eventId: 'evt_summary_structured_2',
        runId: 'run_structured_timeline',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_structured_timeline',
          kind: 'structured-answer',
          version: 3,
        },
        createdAt: '2026-05-06T08:36:37.000Z',
      },
      {
        eventId: 'evt_summary_structured_3',
        runId: 'run_structured_timeline',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T08:36:38.000Z',
      },
    ];

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_structured_timeline',
        runId: 'run_structured_timeline',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '# Example Domain\n\nThis domain is for use in illustrative examples in documents.',
          notes: ['截图来自 browser_take_screenshot'],
          suggestedNextActions: ['查看 IANA 保留域名说明'],
        },
        version: 3,
        createdAt: '2026-05-06T08:36:37.000Z',
      },
    ];

    render(<RunTimeline events={events} artifacts={artifacts} />);

    expect(screen.getByText('structured-answer v3')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Example Domain' })).toBeTruthy();
    expect(screen.queryByText('截图来自 browser_take_screenshot')).toBeNull();

    await user.click(screen.getByRole('button', { name: /structured-answer v3 展开/i }));

    expect(screen.getByText('截图来自 browser_take_screenshot')).toBeTruthy();
    expect(screen.getByText('查看 IANA 保留域名说明')).toBeTruthy();
  });

  it('keeps structured-answer markdown visible while collapsed and moves process details behind the toggle', async () => {
    const user = userEvent.setup();

    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_summary_structured_preview_1',
        runId: 'run_structured_preview',
        type: 'user_message',
        payload: {
          content: '请把截图识别结论直接展示出来',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-06T09:00:00.000Z',
      },
      {
        eventId: 'evt_summary_structured_preview_2',
        runId: 'run_structured_preview',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_structured_preview',
          kind: 'structured-answer',
          version: 4,
        },
        createdAt: '2026-05-06T09:00:02.000Z',
      },
      {
        eventId: 'evt_summary_structured_preview_3',
        runId: 'run_structured_preview',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T09:00:03.000Z',
      },
    ];

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_structured_preview',
        runId: 'run_structured_preview',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '先判断页面主结构与标题，再整理可直接引用的正文结论。\n\n---\n# Example Domain\n\nThis domain is for use in illustrative examples in documents.',
          notes: ['截图来自 browser_take_screenshot'],
        },
        version: 4,
        createdAt: '2026-05-06T09:00:02.000Z',
      },
    ];

    render(<RunTimeline events={events} artifacts={artifacts} />);

    expect(screen.getByRole('heading', { name: 'Example Domain' })).toBeTruthy();
    expect(screen.queryByText('先判断页面主结构与标题，再整理可直接引用的正文结论。')).toBeNull();
    expect(screen.queryByText('截图来自 browser_take_screenshot')).toBeNull();

    await user.click(screen.getByRole('button', { name: /structured-answer v4 展开/i }));

    expect(screen.getByText('先判断页面主结构与标题，再整理可直接引用的正文结论。')).toBeTruthy();
    expect(screen.getByText('截图来自 browser_take_screenshot')).toBeTruthy();
  });

  it('uses the latest artifact id for the newest assistant summary even when artifact versions arrive out of order', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_artifact_switch_1',
        runId: 'run_artifact_switch',
        type: 'user_message',
        payload: {
          content: '请直接回答 2+3 等于几，只返回结果',
          mode: 'steer',
        },
        createdAt: '2026-05-06T10:55:35.000Z',
      },
      {
        eventId: 'evt_artifact_switch_2',
        runId: 'run_artifact_switch',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_latest',
          kind: 'structured-answer',
          version: 1,
        },
        createdAt: '2026-05-06T10:55:38.000Z',
      },
      {
        eventId: 'evt_artifact_switch_3',
        runId: 'run_artifact_switch',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T10:55:39.000Z',
      },
    ];

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_latest',
        runId: 'run_artifact_switch',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '5',
        },
        version: 2,
        createdAt: '2026-05-06T10:55:38.100Z',
      },
      {
        artifactId: 'art_old',
        runId: 'run_artifact_switch',
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '你好！根据您的偏好，我可以提供风控分析、数据分析或其他相关支持。',
        },
        version: 1,
        createdAt: '2026-05-06T10:55:01.000Z',
      },
    ];

    render(<RunTimeline events={events} artifacts={artifacts} />);

    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.queryByText(/根据您的偏好/)).toBeNull();
  });

  it('prefers the report summary over a later skill proposal in the same assistant turn', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_report_preferred_1',
        runId: 'run_report_preferred',
        type: 'user_message',
        payload: {
          content: '分析一轮支付风控并给我结论',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-06T11:10:00.000Z',
      },
      {
        eventId: 'evt_report_preferred_2',
        runId: 'run_report_preferred',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_report_preferred',
          kind: 'report',
          version: 1,
        },
        createdAt: '2026-05-06T11:10:02.000Z',
      },
      {
        eventId: 'evt_report_preferred_3',
        runId: 'run_report_preferred',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_skill_preferred',
          kind: 'json',
          version: 2,
        },
        createdAt: '2026-05-06T11:10:03.000Z',
      },
      {
        eventId: 'evt_report_preferred_4',
        runId: 'run_report_preferred',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T11:10:04.000Z',
      },
    ];

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_report_preferred',
        runId: 'run_report_preferred',
        kind: 'report',
        mimeType: 'application/json',
        contentJson: {
          reportId: 'report_preferred',
          businessName: '支付风险巡检总览',
          overallScore: 91,
        },
        version: 1,
        createdAt: '2026-05-06T11:10:02.000Z',
      },
      {
        artifactId: 'art_skill_preferred',
        runId: 'run_report_preferred',
        kind: 'json',
        mimeType: 'application/json',
        contentJson: {
          type: 'skill-proposal',
          sourceRunId: 'run_report_preferred',
          taskKind: 'analysis',
          title: '支付风险巡检技能提案',
          rationale: '可沉淀为技能。',
          triggerHints: ['分析支付风控'],
          workflow: ['加载规则', '输出巡检结论'],
          evidence: ['latest-first'],
          creationPayload: {
            name: 'analysis-payment-risk-latest',
            description: '最新提案',
            content: '# latest',
          },
        },
        version: 2,
        createdAt: '2026-05-06T11:10:03.000Z',
      },
    ];

    render(<RunTimeline events={events} artifacts={artifacts} />);

    expect(screen.getByText('report v1')).toBeTruthy();
    expect(screen.getByText(/支付风险巡检总览/)).toBeTruthy();
    expect(screen.queryByText('json v2')).toBeNull();
    expect(screen.queryByText(/支付风险巡检技能提案/)).toBeNull();
  });

  it('renders waiting-user requests as assistant prompts and records the next user reply separately', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_wait_1',
        runId: 'run_wait',
        type: 'waiting_user',
        payload: {
          requestId: 'ask_1',
          question: '是否继续执行下一轮技能 dry-run？',
          options: ['确认', '取消'],
        },
        createdAt: '2026-04-27T09:10:00.000Z',
      },
      {
        eventId: 'evt_wait_2',
        runId: 'run_wait',
        type: 'user_input_received',
        payload: {
          requestId: 'ask_1',
          input: '确认',
        },
        createdAt: '2026-04-27T09:10:05.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0);
    expect(screen.getByText('Agent 需要你的决策')).toBeTruthy();
    expect(screen.getByText(/是否继续执行下一轮技能 dry-run/)).toBeTruthy();
    expect(screen.getByText(/确认 \/ 取消/)).toBeTruthy();
    expect(screen.getByText('确认')).toBeTruthy();
  });

  it('coalesces consecutive text delta events into concise progress updates', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_delta_1',
        runId: 'run_delta',
        type: 'user_message',
        payload: {
          content: '继续生成这轮页面识别结论',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-06T09:10:00.000Z',
      },
      {
        eventId: 'evt_delta_2',
        runId: 'run_delta',
        type: 'text_delta',
        payload: {
          delta: '第一段输出正在生成',
        },
        createdAt: '2026-05-06T09:10:01.000Z',
      },
      {
        eventId: 'evt_delta_3',
        runId: 'run_delta',
        type: 'text_delta',
        payload: {
          delta: '第二段输出正在生成',
        },
        createdAt: '2026-05-06T09:10:02.000Z',
      },
      {
        eventId: 'evt_delta_4',
        runId: 'run_delta',
        type: 'text_delta',
        payload: {
          delta: '第三段输出已经完成',
        },
        createdAt: '2026-05-06T09:10:03.000Z',
      },
      {
        eventId: 'evt_delta_5',
        runId: 'run_delta',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T09:10:04.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.queryByText('Text Delta')).toBeNull();
    expect(screen.getByText('第三段输出已经完成')).toBeTruthy();
    expect(screen.getByRole('button', { name: /\+2 条过程/i })).toBeTruthy();
  });

  it('keeps the already streamed text prefix visible before text completion arrives', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_live_delta_1',
        runId: 'run_live_delta',
        type: 'user_message',
        payload: {
          content: '继续流式输出当前思考过程',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-21T11:00:00.000Z',
      },
      {
        eventId: 'evt_live_delta_2',
        runId: 'run_live_delta',
        type: 'text_delta',
        payload: {
          delta: '我先检查浏览器标签拖拽，',
        },
        createdAt: '2026-05-21T11:00:01.000Z',
      },
      {
        eventId: 'evt_live_delta_3',
        runId: 'run_live_delta',
        type: 'text_delta',
        payload: {
          delta: '再处理右键菜单与固定标签页。',
        },
        createdAt: '2026-05-21T11:00:02.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.getByText(/我先检查浏览器标签拖拽.*再处理右键菜单与固定标签页/u)).toBeTruthy();
  });

  it('replaces raw text-complete labels and merges tokenized history into readable process lines', async () => {
    const user = userEvent.setup();

    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_text_complete_1',
        runId: 'run_text_complete',
        type: 'user_message',
        payload: {
          content: '继续展示初始化过程',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-06T10:00:00.000Z',
      },
      {
        eventId: 'evt_text_complete_2',
        runId: 'run_text_complete',
        type: 'turn_info',
        payload: {
          current: 1,
          max: 4,
          estimatedTokens: 42,
        },
        createdAt: '2026-05-06T10:00:01.000Z',
      },
      {
        eventId: 'evt_text_complete_3',
        runId: 'run_text_complete',
        type: 'text_delta',
        payload: {
          delta: '截图',
        },
        createdAt: '2026-05-06T10:00:02.000Z',
      },
      {
        eventId: 'evt_text_complete_4',
        runId: 'run_text_complete',
        type: 'text_delta',
        payload: {
          delta: '已完成',
        },
        createdAt: '2026-05-06T10:00:03.000Z',
      },
      {
        eventId: 'evt_text_complete_5',
        runId: 'run_text_complete',
        type: 'text_complete',
        payload: {
          fullText: '截图已完成。为了准确描述截图中可见的内容，我继续整理最终答案。',
        },
        createdAt: '2026-05-06T10:00:04.000Z',
      },
      {
        eventId: 'evt_text_complete_6',
        runId: 'run_text_complete',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T10:00:05.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.queryByText('Text Complete')).toBeNull();
    expect(screen.queryByText('Turn Info')).toBeNull();
    expect(screen.getByText(/截图已完成。为了准确描述截图中可见的内容/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /\+2 条过程/i }));

    expect(screen.queryByText(/^截图$/)).toBeNull();
    expect(screen.queryByText(/^已完成$/)).toBeNull();
    expect(screen.getByText(/第 1 轮 \/ 共 4 轮.*42 tokens/i)).toBeTruthy();
    expect(screen.getByText(/^截图已完成$/)).toBeTruthy();
  });

  it('heavily compresses long text delta histories into a few readable process paragraphs', async () => {
    const user = userEvent.setup();

    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_long_history_1',
        runId: 'run_long_history',
        type: 'user_message',
        payload: {
          content: '请生成一份长文用于检查 timeline 折叠历史',
          mode: 'stop-and-send',
        },
        createdAt: '2026-05-06T10:10:00.000Z',
      },
      {
        eventId: 'evt_long_history_2',
        runId: 'run_long_history',
        type: 'general_response_started',
        payload: {},
        createdAt: '2026-05-06T10:10:01.000Z',
      },
      {
        eventId: 'evt_long_history_3',
        runId: 'run_long_history',
        type: 'turn_info',
        payload: {
          current: 1,
          max: 12,
          estimatedTokens: 128,
        },
        createdAt: '2026-05-06T10:10:02.000Z',
      },
      {
        eventId: 'evt_long_history_4',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '## 过程说明\n' },
        createdAt: '2026-05-06T10:10:03.000Z',
      },
      {
        eventId: 'evt_long_history_5',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '在组织本次回答时，' },
        createdAt: '2026-05-06T10:10:04.000Z',
      },
      {
        eventId: 'evt_long_history_6',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '我先梳理核心维度。\n\n' },
        createdAt: '2026-05-06T10:10:05.000Z',
      },
      {
        eventId: 'evt_long_history_7',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '随后我补齐表格、引用和代码块，' },
        createdAt: '2026-05-06T10:10:06.000Z',
      },
      {
        eventId: 'evt_long_history_8',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '确保主回答是完整 markdown。\n\n' },
        createdAt: '2026-05-06T10:10:07.000Z',
      },
      {
        eventId: 'evt_long_history_9',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '---\n# 如何验证一个 Agent UI 的流式输出质量\n' },
        createdAt: '2026-05-06T10:10:08.000Z',
      },
      {
        eventId: 'evt_long_history_10',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '第一段正文需要覆盖评估维度与指标。' },
        createdAt: '2026-05-06T10:10:09.000Z',
      },
      {
        eventId: 'evt_long_history_11',
        runId: 'run_long_history',
        type: 'text_delta',
        payload: { delta: '第二段正文需要覆盖测试方法与工具链。' },
        createdAt: '2026-05-06T10:10:10.000Z',
      },
      {
        eventId: 'evt_long_history_12',
        runId: 'run_long_history',
        type: 'text_complete',
        payload: {
          fullText: '## 过程说明\n在组织本次回答时，我先梳理核心维度。\n\n随后我补齐表格、引用和代码块，确保主回答是完整 markdown。\n\n---\n# 如何验证一个 Agent UI 的流式输出质量\n第一段正文需要覆盖评估维度与指标。\n第二段正文需要覆盖测试方法与工具链。',
        },
        createdAt: '2026-05-06T10:10:11.000Z',
      },
      {
        eventId: 'evt_long_history_13',
        runId: 'run_long_history',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-05-06T10:10:12.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.getByText('正文与过程说明已整理完成')).toBeTruthy();

    const historyButton = screen.getByRole('button', { name: /\+[1-6] 条过程/i });
    await user.click(historyButton);

    expect(screen.queryByText(/^。$/)).toBeNull();
    expect(screen.queryByText(/^---$/)).toBeNull();
    expect(screen.getByText(/在组织本次回答时.*核心维度/)).toBeTruthy();
    expect(screen.getByText(/如何验证一个 Agent UI 的流式输出质量/)).toBeTruthy();
  });

  it('renders common harness progress events with concise summaries instead of raw payload JSON', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_harness_1',
        runId: 'run_harness',
        type: 'user_message',
        payload: {
          content: '继续分析跨境支付风险链路',
          mode: 'stop-and-send',
        },
        createdAt: '2026-04-27T10:00:00.000Z',
      },
      {
        eventId: 'evt_harness_2',
        runId: 'run_harness',
        type: 'subagent_spawned',
        payload: {
          agentId: 'riskrule',
          description: '加载风控规则库',
          taskType: 'subagent',
        },
        createdAt: '2026-04-27T10:00:01.000Z',
      },
      {
        eventId: 'evt_harness_3',
        runId: 'run_harness',
        type: 'agent_status',
        payload: {
          message: '计算风控维度覆盖度...',
        },
        createdAt: '2026-04-27T10:00:02.000Z',
      },
      {
        eventId: 'evt_harness_4',
        runId: 'run_harness',
        type: 'research_progress',
        payload: {
          dimension: 'coverage',
          status: 'completed',
        },
        createdAt: '2026-04-27T10:00:03.000Z',
      },
      {
        eventId: 'evt_harness_5',
        runId: 'run_harness',
        type: 'subagent_complete',
        payload: {
          agentId: 'riskrule',
          status: 'completed',
          summary: '已加载 14 条活跃规则',
        },
        createdAt: '2026-04-27T10:00:04.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.getAllByText('风险规则子流程')).toHaveLength(2);
    expect(screen.getByText('计算风控维度覆盖度...')).toBeTruthy();
    expect(screen.queryByText(/"agentId": "riskrule"/)).toBeNull();
    expect(screen.queryByText(/"taskType": "subagent"/)).toBeNull();
  });

  it('preserves the harness-console interface when consoleMode is enabled', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_console_1',
        runId: 'run_console',
        type: 'tool_start',
        payload: {
          toolName: 'query_database',
          query: 'select * from risk_rules',
        },
        createdAt: '2026-04-27T10:10:00.000Z',
      },
      {
        eventId: 'evt_console_2',
        runId: 'run_console',
        type: 'tool_result',
        payload: {
          ok: true,
          rowCount: 12,
        },
        createdAt: '2026-04-27T10:10:01.000Z',
      },
    ];

    render(<RunTimeline events={events} consoleMode />);

    expect(screen.getByText('运行事件流')).toBeTruthy();
    expect(screen.getByPlaceholderText('按事件类型筛选…')).toBeTruthy();
    expect(screen.queryByText('harness-console')).toBeNull();
    expect(screen.getByText('tool_start')).toBeTruthy();
    expect(screen.getByText('tool_result')).toBeTruthy();
  });

  it('renders structured sandbox fields for tool and cancellation events instead of opaque payload labels', async () => {
    const user = userEvent.setup();
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_sandbox_1',
        runId: 'run_sandbox',
        type: 'tool_start',
        payload: {
          toolName: 'git_scan',
          sandbox: {
            hostKind: 'local-process',
            interaction: 'tty',
            leaseId: 'lease_gitscan_12345678',
            state: 'running',
            filesystem: { mode: 'workspace-write' },
            network: { mode: 'restricted' },
          },
        },
        createdAt: '2026-05-06T10:10:00.000Z',
      },
      {
        eventId: 'evt_sandbox_2',
        runId: 'run_sandbox',
        type: 'run_cancelled',
        payload: {
          reason: 'user_cancelled',
          sandbox: {
            leaseId: 'lease_gitscan_12345678',
            state: 'cancelled',
            cancelled: true,
            interaction: 'tty',
          },
        },
        createdAt: '2026-05-06T10:10:02.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    await user.click(screen.getByText('初始化'));
    await user.click(screen.getByText(/Tool Start|git_scan/));
    expect(screen.getByText(/租约：lease_gitscan_12345678/)).toBeTruthy();
    expect(screen.getByText(/主机：local-process/)).toBeTruthy();
    expect(screen.getByText(/交互：tty/)).toBeTruthy();
    expect(screen.getByText(/文件系统：workspace-write/)).toBeTruthy();
    expect(screen.getByText(/网络：restricted/)).toBeTruthy();

    await user.click(screen.getByText('运行已取消'));
    expect(screen.getByText(/状态：cancelled/)).toBeTruthy();
    expect(screen.getByText(/已取消：是/)).toBeTruthy();
  });

  it('shows structured sandbox summaries in harness console mode instead of raw sandbox JSON', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_console_sandbox_1',
        runId: 'run_console_sandbox',
        type: 'tool_progress',
        payload: {
          toolName: 'git_scan',
          message: 'lease attached',
          sandbox: {
            hostKind: 'local-process',
            interaction: 'tty',
            leaseId: 'lease_gitscan_12345678',
            state: 'running',
          },
        },
        createdAt: '2026-05-06T10:12:00.000Z',
      },
    ];

    render(<RunTimeline events={events} consoleMode />);

    expect(screen.getByText(/lease attached/)).toBeTruthy();
    expect(screen.getByText(/lease lease_gitscan_12345678/)).toBeTruthy();
    expect(screen.getByText(/local-process/)).toBeTruthy();
    expect(screen.getByText(/tty/)).toBeTruthy();
    expect(screen.queryByText(/"sandbox"/)).toBeNull();
  });

  it('shows the latest assistant artifact content expanded by default', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_expanded_1',
        runId: 'run_expanded',
        type: 'user_message',
        payload: {
          content: '把这轮总结完整展示出来',
          mode: 'steer',
        },
        createdAt: '2026-04-27T10:20:00.000Z',
      },
      {
        eventId: 'evt_expanded_2',
        runId: 'run_expanded',
        type: 'artifact_updated',
        payload: {
          artifactId: 'art_expanded',
          kind: 'markdown',
          version: 1,
        },
        createdAt: '2026-04-27T10:20:01.000Z',
      },
      {
        eventId: 'evt_expanded_3',
        runId: 'run_expanded',
        type: 'run_completed',
        payload: { status: 'completed' },
        createdAt: '2026-04-27T10:20:02.000Z',
      },
    ];

    const run: RunSummary = {
      runId: 'run_expanded',
      taskKind: 'general',
      status: 'completed',
      input: { prompt: '把这轮总结完整展示出来' },
      routing: {
        acceptedTaskKind: 'general',
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: {},
      },
      metrics: {
        turnCount: 2,
        toolCallCount: 0,
        inputTokens: 48,
        outputTokens: 120,
        cachedTokens: 0,
        estimatedUsd: 0.002,
      },
      createdAt: '2026-04-27T10:19:58.000Z',
      updatedAt: '2026-04-27T10:20:02.000Z',
      completedAt: '2026-04-27T10:20:02.000Z',
    };

    const artifacts: RunArtifactRecord[] = [
      {
        artifactId: 'art_expanded',
        runId: 'run_expanded',
        kind: 'markdown',
        mimeType: 'text/markdown',
        contentText: '预览片段',
        version: 1,
        createdAt: '2026-04-27T10:20:01.000Z',
      },
    ];

    render(<RunTimeline events={events} run={run} artifacts={artifacts} />);

    expect(screen.getByText('预览片段')).toBeTruthy();
    expect(screen.getByText('收起')).toBeTruthy();
  });

  it('shows whether a continuation stop was model-driven or system-enforced', () => {
    const events: RunTimelineEvent[] = [
      {
        eventId: 'evt_stop_model',
        runId: 'run_stop_reason',
        type: 'continuation_decision',
        payload: {
          decision: 'stop',
          currentCapabilityProfile: 'general',
          nextCapabilityProfile: 'general',
          stopReasonCode: 'model_complete',
          source: 'model',
          reason: '已经形成最终回答。',
        },
        createdAt: '2026-05-13T10:00:00.000Z',
      },
      {
        eventId: 'evt_stop_system',
        runId: 'run_stop_reason',
        type: 'continuation_decision',
        payload: {
          decision: 'stop',
          currentCapabilityProfile: 'general',
          nextCapabilityProfile: 'general',
          stopReasonCode: 'budget',
          source: 'system',
          reason: '工具辅助步骤触发预算上限，停止继续编排。',
        },
        createdAt: '2026-05-13T10:00:01.000Z',
      },
    ];

    render(<RunTimeline events={events} />);

    expect(screen.getByText('模型决定停止继续')).toBeTruthy();
    expect(screen.getByText('系统停止继续')).toBeTruthy();
    expect(screen.getByText('停止类型：模型完成')).toBeTruthy();
    expect(screen.getByText('停止类型：预算')).toBeTruthy();
  });
});
