import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RunArtifact, RunCheckpoint, RunEvent } from '../../../harness/types.js';

const workflowMocks = vi.hoisted(() => ({
  runAnalysisWorkflow: vi.fn(),
}));

vi.mock('../AnalysisWorkflow.js', () => ({
  runAnalysisWorkflow: workflowMocks.runAnalysisWorkflow,
}));

import { AnalysisTaskPack } from '../AnalysisTaskPack.js';

describe('AnalysisTaskPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks recoverable missing coverage as warn and requests retry when suggestions are present', async () => {
    const all = vi.fn().mockResolvedValue([]);
    const storage = {
      getStructuredStore: () => ({ all }),
    } as any;

    const pack = new AnalysisTaskPack({
      storage,
      queryEngine: {} as any,
    });

    const verification = await pack.verify(
      {
        report: {
          reportId: 'report_retry',
          sessionId: 'run-analysis-retry',
          businessName: '快捷支付风控',
          locale: 'zh-CN',
          overallScore: 0,
          coverageMatrix: [],
          allGaps: [],
          criticalGaps: [],
          suggestions: ['先补齐实名核验覆盖，再重试分析。'],
          narrative: '当前缺少覆盖矩阵，但已经生成下一步建议。',
          createdAt: '2026-05-25T00:00:00.000Z',
        },
        semanticCheckpoints: ['report-drafted'],
      },
      {
        run: {
          runId: 'run-analysis-retry',
        },
        now: () => '2026-05-25T00:00:00.000Z',
      } as any,
    );

    expect(verification.decision).toBe('warn');
    expect(verification.reasons).toEqual([
      'coverage_missing',
      'gaps_missing',
      'suggestions_present',
    ]);
    expect(verification.followUpAction).toBe('retry');
  });

  it('passes guidance messages through intake and execute into the analysis workflow', async () => {
    const all = vi.fn().mockResolvedValue([]);
    const storage = {
      getStructuredStore: () => ({ all }),
    } as any;

    workflowMocks.runAnalysisWorkflow.mockResolvedValue({
      report: {
        reportId: 'report_1',
        sessionId: 'run-analysis',
        businessName: '快捷支付风控',
        locale: 'zh-CN',
        overallScore: 0,
        coverageMatrix: [],
        allGaps: [],
        criticalGaps: [],
        suggestions: ['结合用户追加引导继续核查：最新引导'],
        narrative: '整体覆盖率 0%，共涉及 0 个业务场景。',
        createdAt: '2026-04-24T06:00:00.000Z',
      },
      semanticCheckpoints: ['report-drafted'],
    });

    const pack = new AnalysisTaskPack({
      storage,
      queryEngine: {} as any,
    });

    const normalized = await pack.intake({
      businessName: '快捷支付风控',
      guidanceMessages: ['旧引导', '最新引导'],
    });

    expect(normalized.guidanceMessages).toEqual(['旧引导', '最新引导']);

    const plan = await pack.plan(normalized);
    const ctx = {
      run: {
        runId: 'run-analysis',
        taskKind: 'analysis',
        status: 'running',
        input: {},
        routing: {
          acceptedTaskKind: 'analysis',
          confidence: 1,
          reason: 'test',
          routeParams: {},
        },
        metrics: {
          turnCount: 0,
          toolCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
        createdAt: '2026-04-24T06:00:00.000Z',
        updatedAt: '2026-04-24T06:00:00.000Z',
      },
      signal: new AbortController().signal,
      now: () => '2026-04-24T06:00:00.000Z',
      emit: async (event: Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>) => ({
        eventId: 'evt_1',
        runId: 'run-analysis',
        type: event.type,
        payload: event.payload,
        createdAt: '2026-04-24T06:00:00.000Z',
      }),
      createSemanticCheckpoint: async (_kind: string, snapshot: Record<string, unknown>) => ({
        checkpointId: 'chk_1',
        runId: 'run-analysis',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 0,
        createdAt: '2026-04-24T06:00:00.000Z',
      } satisfies RunCheckpoint),
      publishArtifact: async (artifact: Omit<RunArtifact, 'artifactId' | 'runId' | 'version' | 'createdAt'>) => ({
        artifactId: 'art_1',
        runId: 'run-analysis',
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        contentJson: artifact.contentJson,
        contentText: artifact.contentText,
        version: 1,
        createdAt: '2026-04-24T06:00:00.000Z',
      }),
    };

    const execution = await pack.execute(plan, ctx as any).next();

    expect(execution.done).toBe(true);
    expect(workflowMocks.runAnalysisWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        guidanceMessages: ['旧引导', '最新引导'],
      }),
      expect.objectContaining({
        base: expect.objectContaining({
          guidanceMessages: ['旧引导', '最新引导'],
        }),
      }),
    );
    expect(execution.value.report.suggestions).toContain('结合用户追加引导继续核查：最新引导');
  });

  it('enriches forwarded analysis workflow events with synthetic metric deltas', async () => {
    const all = vi.fn().mockResolvedValue([]);
    const storage = {
      getStructuredStore: () => ({ all }),
    } as any;

    workflowMocks.runAnalysisWorkflow.mockImplementation(async (_input, deps) => {
      await deps.emit({
        type: 'subagent_spawned',
        agentId: 'riskrule',
        description: '加载风控规则库',
        taskType: 'subagent',
      } as any);
      await deps.emit({
        type: 'subagent_complete',
        agentId: 'riskrule',
        status: 'completed',
        summary: '已加载 14 条活跃规则',
      } as any);
      await deps.emit({
        type: 'research_complete',
        dimensions: ['coverage', 'anomaly'],
        aggregatedTokens: 0,
      } as any);

      return {
        report: {
          reportId: 'report_metrics',
          sessionId: 'run-analysis-metrics',
          businessName: '快捷支付风控',
          locale: 'zh-CN',
          overallScore: 93,
          coverageMatrix: [],
          allGaps: [],
          criticalGaps: [],
          suggestions: ['优先补齐异常登录拦截规则'],
          narrative: '整体覆盖率 93%，异常登录链路仍有缺口。',
          createdAt: '2026-04-24T06:00:00.000Z',
        },
        semanticCheckpoints: ['report-drafted'],
      };
    });

    const pack = new AnalysisTaskPack({
      storage,
      queryEngine: {} as any,
    });

    const normalized = await pack.intake({ businessName: '快捷支付风控' });
    const plan = await pack.plan(normalized);
    const emitted: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
    const ctx = {
      run: {
        runId: 'run-analysis-metrics',
        taskKind: 'analysis',
        status: 'running',
        input: {},
        routing: {
          acceptedTaskKind: 'analysis',
          confidence: 1,
          reason: 'test',
          routeParams: {},
        },
        metrics: {
          turnCount: 0,
          toolCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
        createdAt: '2026-04-24T06:00:00.000Z',
        updatedAt: '2026-04-24T06:00:00.000Z',
      },
      signal: new AbortController().signal,
      now: () => '2026-04-24T06:00:00.000Z',
      emit: async (event: Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>) => {
        emitted.push(event);
        return {
          eventId: `evt_${emitted.length}`,
          runId: 'run-analysis-metrics',
          type: event.type,
          payload: event.payload,
          createdAt: '2026-04-24T06:00:00.000Z',
        };
      },
      createSemanticCheckpoint: async (_kind: string, snapshot: Record<string, unknown>) => ({
        checkpointId: 'chk_metrics',
        runId: 'run-analysis-metrics',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 0,
        createdAt: '2026-04-24T06:00:00.000Z',
      } satisfies RunCheckpoint),
      publishArtifact: async (artifact: Omit<RunArtifact, 'artifactId' | 'runId' | 'version' | 'createdAt'>) => ({
        artifactId: 'art_metrics',
        runId: 'run-analysis-metrics',
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        contentJson: artifact.contentJson,
        contentText: artifact.contentText,
        version: 1,
        createdAt: '2026-04-24T06:00:00.000Z',
      }),
    };

    const execution = await pack.execute(plan, ctx as any).next();

    expect(execution.done).toBe(true);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'subagent_spawned',
          payload: expect.objectContaining({
            syntheticMetrics: expect.objectContaining({
              toolCallCount: 1,
              inputTokens: expect.any(Number),
              estimatedUsd: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          type: 'subagent_complete',
          payload: expect.objectContaining({
            syntheticMetrics: expect.objectContaining({
              turnCount: 1,
              outputTokens: expect.any(Number),
              estimatedUsd: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          type: 'research_complete',
          payload: expect.objectContaining({
            syntheticMetrics: expect.objectContaining({
              turnCount: 1,
              outputTokens: expect.any(Number),
              estimatedUsd: expect.any(Number),
            }),
          }),
        }),
      ]),
    );
  });

  it('emits a post-run skill proposal artifact for completed analysis reports', async () => {
    const all = vi.fn().mockResolvedValue([]);
    const storage = {
      getStructuredStore: () => ({ all }),
    } as any;

    const pack = new AnalysisTaskPack({
      storage,
      queryEngine: {} as any,
    });

    const published: RunArtifact[] = [];
    const ctx = {
      run: {
        runId: 'run-analysis-proposal',
        taskKind: 'analysis',
        status: 'running',
        input: {},
        routing: {
          acceptedTaskKind: 'analysis',
          confidence: 1,
          reason: 'test',
          routeParams: {},
        },
        metrics: {
          turnCount: 0,
          toolCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          estimatedUsd: 0,
        },
        createdAt: '2026-04-24T06:00:00.000Z',
        updatedAt: '2026-04-24T06:00:00.000Z',
      },
      signal: new AbortController().signal,
      now: () => '2026-04-24T06:00:00.000Z',
      emit: async (event: Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>) => ({
        eventId: `evt_${published.length + 1}`,
        runId: 'run-analysis-proposal',
        type: event.type,
        payload: event.payload,
        createdAt: '2026-04-24T06:00:00.000Z',
      }),
      createSemanticCheckpoint: async (_kind: string, snapshot: Record<string, unknown>) => ({
        checkpointId: 'chk_analysis_proposal',
        runId: 'run-analysis-proposal',
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: 0,
        createdAt: '2026-04-24T06:00:00.000Z',
      } satisfies RunCheckpoint),
      publishArtifact: async (artifact: Omit<RunArtifact, 'artifactId' | 'runId' | 'version' | 'createdAt'>) => {
        const next: RunArtifact = {
          artifactId: `art_${published.length + 1}`,
          runId: 'run-analysis-proposal',
          kind: artifact.kind,
          mimeType: artifact.mimeType,
          contentJson: artifact.contentJson,
          contentText: artifact.contentText,
          version: published.length + 1,
          createdAt: '2026-04-24T06:00:00.000Z',
        };
        published.push(next);
        return next;
      },
    };

    const projected = await pack.projectResult(
      {
        report: {
          reportId: 'report_1',
          sessionId: 'run-analysis-proposal',
          businessName: '快捷支付风控',
          locale: 'zh-CN',
          overallScore: 91,
          coverageMatrix: [],
          allGaps: [{ severity: 'high', title: '异常登录规则缺口' }],
          criticalGaps: [],
          suggestions: ['优先补齐异常登录拦截规则', '补充设备指纹交叉验证'],
          narrative: '整体覆盖率较高，但异常登录链路仍有缺口。',
          createdAt: '2026-04-24T06:00:00.000Z',
        },
        semanticCheckpoints: ['report-drafted'],
      },
      ctx as any,
    );

    expect(projected).toHaveLength(2);
    expect(projected[1]).toMatchObject({
      kind: 'json',
      mimeType: 'application/json',
      contentJson: expect.objectContaining({
        type: 'skill-proposal',
        sourceRunId: 'run-analysis-proposal',
        taskKind: 'analysis',
        creationPayload: expect.objectContaining({
          name: expect.stringMatching(/^analysis-/),
          content: expect.stringContaining('## Trigger Hints'),
        }),
      }),
    });
  });
});