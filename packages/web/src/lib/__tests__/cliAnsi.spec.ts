import { describe, expect, it } from 'vitest';
import type { RunTimelineEvent } from '../../api/client';
import { eventToAnsi, resolveXtermTheme, welcomeBanner } from '../cliAnsi';

function buildEvent(type: string, payload: Record<string, unknown>): RunTimelineEvent {
  return {
    eventId: `evt_${type}`,
    runId: 'run_cli',
    type,
    payload,
    createdAt: '2026-04-28T10:00:00.000Z',
  };
}

describe('eventToAnsi', () => {
  it('groups success-path routing and verification events into a task transcript tree', () => {
    const transcript = [
      buildEvent('routed', { acceptedTaskKind: 'general', confidence: 0.86 }),
      buildEvent('checkpoint_created', { kind: 'routed' }),
      buildEvent('plan_created', { summary: 'Execution plan prepared' }),
      buildEvent('general_response_started', { responseMode: 'direct' }),
      buildEvent('checkpoint_created', { kind: 'planned' }),
      buildEvent('artifact_updated', { kind: 'structured-answer', version: 1, preview: '你好，我可以帮你分析这个 CLI 页面。' }),
      buildEvent('verifier_finished', { decision: 'pass', reasons: ['runtime_test_pass'] }),
      buildEvent('run_completed', { status: 'completed', terminationReason: 'completed' }),
    ]
      .map((event) => eventToAnsi(event))
      .join('\n');

    expect(transcript).toContain('task transcript');
    expect(transcript).toContain('├─');
    expect(transcript).toContain('route general (86%)');
    expect(transcript).toContain('checkpoint routed');
    expect(transcript).toContain('plan Execution plan prepared');
    expect(transcript).toContain('draft direct response');
    expect(transcript).toContain('artifact structured-answer v1');
    expect(transcript).toContain('你好，我可以帮你分析这个 CLI 页面');
    expect(transcript).toContain('verifier pass');
    expect(transcript).toContain('runtime_test_pass');
    expect(transcript).toContain('└─');
    expect(transcript).toContain('session complete | completed');
  });

  it('renders waiting, interrupt, cancel, and failure branches using the same transcript grammar', () => {
    const transcript = [
      buildEvent('waiting_user', { question: '是否继续执行？', options: ['确认', '取消'] }),
      buildEvent('interrupt_requested', { reason: 'user_cancelled' }),
      buildEvent('run_cancelled', { status: 'cancelled', reason: 'user_cancelled' }),
      buildEvent('run_failed', { error: 'model_error' }),
    ]
      .map((event) => eventToAnsi(event))
      .join('\n');

    expect(transcript).toContain('awaiting input');
    expect(transcript).toContain('是否继续执行');
    expect(transcript).toContain('2 options in prompt dock');
    expect(transcript).toContain('interrupt requested');
    expect(transcript).toContain('session interrupted | user_cancelled');
    expect(transcript).toContain('session failed | model_error');
  });

  it('renders continuation decisions and capability switches with explicit reasons', () => {
    const transcript = [
      buildEvent('continuation_decision', {
        decision: 'continue',
        currentCapabilityProfile: 'general',
        nextCapabilityProfile: 'knowledge-query',
        responseModeHint: 'tool-assisted',
        reason: '先查知识库确认规则，再决定最终答复。',
      }),
      buildEvent('capability_switched', {
        from: 'general',
        to: 'knowledge-query',
        reason: '先查知识库确认规则，再决定最终答复。',
        source: 'model',
      }),
      buildEvent('continuation_decision', {
        decision: 'stop',
        currentCapabilityProfile: 'general',
        nextCapabilityProfile: 'general',
        stopReasonCode: 'budget',
        source: 'system',
        reason: '已经形成最终回答。',
      }),
    ]
      .map((event) => eventToAnsi(event, { taskKind: 'general' }))
      .filter(Boolean)
      .join('\n');

    expect(transcript).toContain('continue -> knowledge-query');
    expect(transcript).toContain('tool-assisted');
    expect(transcript).toContain('switch -> knowledge-query');
    expect(transcript).toContain('stop orchestration');
    expect(transcript).toContain('budget');
    expect(transcript).toContain('system');
  });

  it('includes sandbox lease and tty metadata in tool and cancel transcript lines', () => {
    const transcript = [
      buildEvent('tool_start', {
        toolName: 'git_scan',
        sandbox: {
          hostKind: 'local-process',
          interaction: 'tty',
          leaseId: 'lease_gitscan_12345678',
          state: 'running',
          filesystem: { mode: 'workspace-write' },
          network: { mode: 'restricted' },
        },
      }),
      buildEvent('tool_progress', {
        message: 'lease attached',
        sandbox: {
          leaseId: 'lease_gitscan_12345678',
          state: 'running',
        },
      }),
      buildEvent('interrupt_requested', {
        reason: 'user_cancelled',
        sandbox: {
          leaseId: 'lease_gitscan_12345678',
          state: 'cancelling',
        },
      }),
      buildEvent('run_cancelled', {
        status: 'cancelled',
        reason: 'user_cancelled',
        sandbox: {
          leaseId: 'lease_gitscan_12345678',
          state: 'cancelled',
          cancelled: true,
        },
      }),
    ]
      .map((event) => eventToAnsi(event))
      .join('\n');

    expect(transcript).toContain('git_scan');
    expect(transcript).toContain('lease lease_gitscan_12345678');
    expect(transcript).toContain('local-process');
    expect(transcript).toContain('tty');
    expect(transcript).toContain('workspace-write');
    expect(transcript).toContain('restricted');
    expect(transcript).toContain('lease attached');
    expect(transcript).toContain('cancelling');
    expect(transcript).toContain('session interrupted | user_cancelled');
    expect(transcript).toContain('cancelled');
  });

  it('resolves dedicated xterm palettes for alternate app themes', () => {
    expect(resolveXtermTheme('paper')).toMatchObject({
      background: '#ffffff',
      foreground: '#1a2840',
      cursor: '#2b57d9',
    });
    expect(resolveXtermTheme('sea')).toMatchObject({
      background: '#09161f',
      foreground: '#dff0f5',
      cursor: '#4ad3c5',
    });
  });

  it('suppresses routing/checkpoint/verifier events when taskKind is general', () => {
    const transcript = [
      buildEvent('routed', { acceptedTaskKind: 'general', confidence: 0.86 }),
      buildEvent('checkpoint_created', { kind: 'routed' }),
      buildEvent('plan_created', { summary: 'Execution plan prepared' }),
      buildEvent('general_response_started', { responseMode: 'direct' }),
      buildEvent('checkpoint_created', { kind: 'planned' }),
      buildEvent('artifact_updated', { kind: 'structured-answer', version: 1, preview: '你好' }),
      buildEvent('verifier_finished', { decision: 'pass', reasons: ['runtime_test_pass'] }),
      buildEvent('run_completed', { status: 'completed', terminationReason: 'completed' }),
    ]
      .map((event) => eventToAnsi(event, { taskKind: 'general' }))
      .filter(Boolean)
      .join('\n');

    expect(transcript).not.toContain('task transcript');
    expect(transcript).not.toContain('route general');
    expect(transcript).not.toContain('checkpoint routed');
    expect(transcript).not.toContain('plan Execution plan prepared');
    expect(transcript).not.toContain('draft direct response');
    expect(transcript).not.toContain('artifact structured-answer');
    expect(transcript).not.toContain('verifier pass');
    expect(transcript).not.toContain('session complete');
  });

  it('still shows run_failed error for general task kind', () => {
    const result = eventToAnsi(
      buildEvent('run_failed', { error: 'model_error' }),
      { taskKind: 'general' },
    );
    expect(result).not.toBeNull();
    expect(result).toContain('error');
    expect(result).toContain('model_error');
  });

  it('suppresses text deltas for general task kind so the transcript can reserve space for the final answer', () => {
    const result = eventToAnsi(
      buildEvent('text_delta', { delta: '正在逐段生成正文' }),
      { taskKind: 'general' },
    );

    expect(result).toBeNull();
  });

  it('renders a user-facing welcome banner without internal transport jargon', () => {
    const banner = welcomeBanner();

    expect(banner).toContain('session ready');
    expect(banner).toContain('interactive channel attached');
    expect(banner).not.toContain('run-first transport attached');
  });
});