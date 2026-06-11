import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessRuntime, TaskPack } from '@risk-agent/core';
import { HarnessRuntime as CoreHarnessRuntime, RunStateMachine, StorageBackendRegistry, TaskPackRegistry } from '@risk-agent/core';
import { RunRepositories } from '../runs/RunRepositories.js';
import { RunService } from '../runs/RunService.js';
import { buildApp } from '../index.js';
import { SessionAttachmentService } from '../services/SessionAttachmentService.js';

vi.mock('../services/SidecarClient.js', () => ({
  getSidecarClient: () => ({
    isHealthy: async () => false,
    curate: async () => null,
  }),
}));

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(condition: () => Promise<boolean>, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition not met in time');
}

describe('RunService', () => {
  it('forwards the requested surface into the runtime factory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => ({
          snapshot: {
            runId: input.runId,
            taskKind: input.requestedTaskKind ?? 'general',
            status: 'completed',
            input: input.input,
            routing: {
              requestedTaskKind: input.requestedTaskKind,
              acceptedTaskKind: input.requestedTaskKind ?? 'general',
              confidence: 1,
              reason: 'test_runtime',
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
            createdAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:00.000Z',
            completedAt: '2026-05-06T00:00:00.000Z',
          },
          artifacts: [],
          verification: {
            verificationId: `ver_${input.runId}`,
            runId: input.runId,
            verifierType: 'contract',
            contractVersion: 'test.phase1',
            decision: 'pass',
            reasons: ['ok'],
            followUpAction: 'none',
            createdAt: '2026-05-06T00:00:00.000Z',
          },
        }),
      } as HarnessRuntime;
      const runtimeFactory = vi.fn(async () => runtime);
      const service = new RunService(storage, runtimeFactory as any);

      await service.createRun({
        taskKind: 'general',
        input: { prompt: 'run terminal cli task' },
        preferredModel: 'model-terminal',
        surface: 'terminal-cli',
      } as any);

      await flushMicrotasks();

      expect(runtimeFactory).toHaveBeenCalledWith('model-terminal', 'terminal-cli');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('forwards the background surface into the runtime factory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => ({
          snapshot: {
            runId: input.runId,
            taskKind: input.requestedTaskKind ?? 'general',
            status: 'completed',
            input: input.input,
            routing: {
              requestedTaskKind: input.requestedTaskKind,
              acceptedTaskKind: input.requestedTaskKind ?? 'general',
              confidence: 1,
              reason: 'test_runtime_background',
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
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:00.000Z',
            completedAt: '2026-05-07T00:00:00.000Z',
          },
          artifacts: [],
          verification: {
            verificationId: `ver_${input.runId}`,
            runId: input.runId,
            verifierType: 'contract',
            contractVersion: 'test.background',
            decision: 'pass',
            reasons: ['ok'],
            followUpAction: 'none',
            createdAt: '2026-05-07T00:00:00.000Z',
          },
        }),
      } as HarnessRuntime;
      const runtimeFactory = vi.fn(async () => runtime);
      const service = new RunService(storage, runtimeFactory as any);

      await service.createRun({
        taskKind: 'general',
        input: { prompt: 'run in background' },
        preferredModel: 'model-background',
        surface: 'background',
      } as any);

      await flushMicrotasks();

      expect(runtimeFactory).toHaveBeenCalledWith('model-background', 'background');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('persists checkpoints emitted by the harness runtime', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          const createdAt = '2026-04-24T06:00:00.000Z';
          await input.onCheckpoint?.({
            checkpointId: 'chk_runtime_profile',
            runId: input.runId,
            kind: 'running-step',
            scope: 'semantic',
            snapshot: { stage: 'profile-built' },
            transcriptOffset: 1,
            createdAt,
          });
          await input.onEvent({
            eventId: `evt_${input.runId}_done`,
            runId: input.runId,
            type: 'run_completed',
            payload: { status: 'completed' },
            createdAt,
          });

          return {
            snapshot: {
              runId: input.runId,
              taskKind: input.requestedTaskKind ?? 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: input.requestedTaskKind ?? 'general',
                confidence: 1,
                reason: 'test_runtime',
                routeParams: {},
              },
              currentCheckpointId: 'chk_runtime_profile',
              metrics: {
                turnCount: 0,
                toolCallCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'general',
        input: { prompt: 'summarize the latest run state' },
      });

      await flushMicrotasks();
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed');

      const checkpoints = await storage.getStructuredStore().all<{ checkpoint_id: string }>(
        `SELECT checkpoint_id FROM run_checkpoints WHERE run_id=?`,
        [run.runId],
      );

      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]?.checkpoint_id).toBe('chk_runtime_profile');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('curates completed runs into long-term memory facts and Hermes-style user profile notes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          const createdAt = '2026-05-21T08:00:00.000Z';

          await input.onArtifact?.({
            artifactId: 'art_memory_summary',
            runId: input.runId,
            kind: 'structured-answer',
            mimeType: 'application/json',
            contentJson: {
              response: '风控规则：登录设备异常需要二次验证。',
            },
            version: 1,
            createdAt,
          });

          return {
            snapshot: {
              runId: input.runId,
              taskKind: input.requestedTaskKind ?? 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: input.requestedTaskKind ?? 'general',
                confidence: 1,
                reason: 'test_memory_curator',
                routeParams: {},
              },
              metrics: {
                turnCount: 1,
                toolCallCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.memory',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'general',
        input: {
          prompt: '请记住我的输出偏好：报告尽量简洁，避免长篇格式化。',
        },
      });

      await flushMicrotasks();
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed');

      await waitFor(async () => {
        const [facts, profiles] = await Promise.all([
          storage!.getStructuredStore().all<{ content: string }>(
            `SELECT content FROM memory_facts WHERE source_run=?`,
            [run.runId],
          ),
          storage!.getStructuredStore().all<{ learned_facts_json: string | null }>(
            `SELECT learned_facts_json FROM user_profiles WHERE owner_key='local-default' LIMIT 1`,
          ),
        ]);

        const learnedFacts = profiles[0]?.learned_facts_json
          ? JSON.parse(profiles[0].learned_facts_json) as Array<{ value?: string }>
          : [];
        return facts.length >= 2 && learnedFacts.some((fact) => String(fact?.value ?? '').includes('简洁'));
      }, 60);

      const facts = await storage.getStructuredStore().all<{ content: string; category: string }>(
        `SELECT content, category FROM memory_facts WHERE source_run=? ORDER BY created_at ASC`,
        [run.runId],
      );
      const profile = await storage.getStructuredStore().get<{ learned_facts_json: string | null }>(
        `SELECT learned_facts_json FROM user_profiles WHERE owner_key='local-default' LIMIT 1`,
      );
      const learnedFacts = profile?.learned_facts_json
        ? JSON.parse(profile.learned_facts_json) as Array<{ value?: string }>
        : [];

      expect(facts.map((fact) => fact.category)).toEqual(expect.arrayContaining(['user_preference', 'domain_knowledge']));
      expect(learnedFacts.some((fact) => String(fact?.value ?? '').includes('简洁'))).toBe(true);
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('keeps the initial run snapshot in general mode so the orchestrator can choose the first capability later', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          const createdAt = '2026-04-24T06:10:00.000Z';
          return {
            snapshot: {
              runId: input.runId,
              taskKind: 'knowledge-query',
              status: 'completed',
              input: input.input,
              routing: {
                acceptedTaskKind: 'knowledge-query',
                confidence: 0.7,
                reason: 'phase1_keyword_match',
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
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        input: { prompt: '请做知识图谱查询：支付链路异常' },
      });

      const createdEvent = await storage.getStructuredStore().get<{ payload_json: string }>(
        `SELECT payload_json FROM run_events WHERE run_id=? AND event_type='run_created' ORDER BY created_at ASC LIMIT 1`,
        [run.runId],
      );

      expect(run.taskKind).toBe('general');
      expect(createdEvent ? JSON.parse(createdEvent.payload_json) : null).toEqual({ taskKind: 'general' });
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not synthesize analysis-only fields before the orchestrator has chosen a capability', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    let capturedInput: Record<string, unknown> | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          capturedInput = input.input;
          const createdAt = '2026-04-27T07:10:00.000Z';
          return {
            snapshot: {
              runId: input.runId,
              taskKind: 'analysis',
              status: 'completed',
              input: input.input,
              routing: {
                acceptedTaskKind: 'analysis',
                confidence: 0.78,
                reason: 'phase2_auto_analysis_route',
                routeParams: {
                  businessName: input.input.businessName as string,
                },
              },
              metrics: {
                turnCount: 0,
                toolCallCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const prompt = '分析电商支付的风险链路并给我一份排查报告';
      const run = await service.createRun({
        input: { prompt },
      });

      await flushMicrotasks();
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed');

      const persisted = await service.getRun(run.runId);

      expect(run.taskKind).toBe('general');
      expect(run.input).toMatchObject({
        prompt,
      });
      expect(run.input).not.toHaveProperty('businessName');
      expect(capturedInput).toMatchObject({
        prompt,
      });
      expect(capturedInput).not.toHaveProperty('businessName');
      expect(persisted?.input).toMatchObject({
        prompt,
      });
      expect(persisted?.input).not.toHaveProperty('businessName');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('creates web chat runs in hermes mode with a semantic general entry capability', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          const createdAt = '2026-05-13T08:00:00.000Z';
          return {
            snapshot: {
              runId: input.runId,
              taskKind: 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: 'analysis',
                initialCapabilityProfile: 'analysis',
                agentMode: 'hermes',
                confidence: 0.78,
                reason: 'phase2_auto_analysis_route',
                routeParams: {
                  businessName: input.input.businessName as string,
                },
              },
              metrics: {
                turnCount: 0,
                toolCallCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.hermes-mode',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const prompt = '分析电商支付的风险链路并给我一份排查报告';
      const run = await service.createRun({
        input: { prompt },
        surface: 'web',
      });

      const createdEvent = await storage.getStructuredStore().get<{ payload_json: string }>(
        `SELECT payload_json FROM run_events WHERE run_id=? AND event_type='run_created' ORDER BY created_at ASC LIMIT 1`,
        [run.runId],
      );

      expect(run.taskKind).toBe('general');
      expect(run.routing).toMatchObject({
        agentMode: 'hermes',
        acceptedTaskKind: 'general',
        initialCapabilityProfile: 'general',
        reason: 'semantic_capability_entry',
      });
      expect(run.input).toMatchObject({
        prompt,
        surface: 'web',
      });
      expect(createdEvent ? JSON.parse(createdEvent.payload_json) : null).toEqual({
        taskKind: 'general',
        agentMode: 'hermes',
        initialCapabilityProfile: 'general',
      });
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hydrates attachment context for harness execution without persisting derived fields into the run snapshot', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    let capturedInput: Record<string, unknown> | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const attachmentService = new SessionAttachmentService(storage);
      const attachment = await attachmentService.upload({
        filename: 'evidence.txt',
        contentType: 'text/plain',
        dataBase64: Buffer.from('异常登录与设备切换在 5 分钟内连续出现').toString('base64'),
      });

      const runtime: HarnessRuntime = {
        execute: async (input) => {
          capturedInput = input.input;
          const createdAt = '2026-04-24T06:12:00.000Z';
          return {
            snapshot: {
              runId: input.runId,
              taskKind: input.requestedTaskKind ?? 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: input.requestedTaskKind ?? 'general',
                confidence: 1,
                reason: 'test_runtime',
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
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'general',
        input: {
          prompt: '总结附件中的关键风险',
          attachmentIds: [attachment.attachmentId],
          toolIds: ['file_parse'],
        },
      });

      await flushMicrotasks();
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed');

      expect(capturedInput).toMatchObject({
        prompt: '总结附件中的关键风险',
        attachmentIds: [attachment.attachmentId],
        toolIds: ['file_parse'],
        attachmentContext: expect.stringContaining('异常登录与设备切换在 5 分钟内连续出现'),
        attachmentRefs: expect.arrayContaining([
          expect.objectContaining({
            id: attachment.attachmentId,
            filename: 'evidence.txt',
          }),
        ]),
      });

      const persisted = await service.getRun(run.runId);
      expect(persisted?.input).toEqual({
        prompt: '总结附件中的关键风险',
        attachmentIds: [attachment.attachmentId],
        toolIds: ['file_parse'],
      });
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('persists waiting_user state and resumes through submitInput', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);

      const interactivePack: TaskPack<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>> = {
        kind: 'skill-management',
        contractVersion: 'skill.phase2',
        inputSchema: {},
        async intake(input) {
          return input as Record<string, unknown>;
        },
        async plan(input) {
          return input;
        },
        async *execute(plan, ctx) {
          const answer = await ctx.requestUserInput({
            question: '是否确认启用技能包？',
            options: ['确认', '取消'],
            checkpoint: { changeType: 'enable-skill' },
          });
          await ctx.createSemanticCheckpoint('approval-received', answer);
          return { ...plan, answer };
        },
        async verify(_result, ctx) {
          return {
            verificationId: `ver_${ctx.run.runId}`,
            runId: ctx.run.runId,
            verifierType: 'contract',
            contractVersion: 'skill.phase2',
            decision: 'pass',
            reasons: ['user_approved_change'],
            followUpAction: 'none',
            createdAt: ctx.now(),
          };
        },
        async projectResult(result, ctx) {
          return [
            await ctx.publishArtifact({
              kind: 'structured-answer',
              mimeType: 'application/json',
              contentJson: result,
            }),
          ];
        },
      };

      const registry = new TaskPackRegistry();
      registry.register(interactivePack);
      const runtime = new CoreHarnessRuntime({
        registry,
        stateMachine: new RunStateMachine(() => '2026-04-24T06:20:00.000Z'),
        now: () => '2026-04-24T06:20:00.000Z',
      });

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'skill-management',
        input: { prompt: 'enable guarded skill flow' },
      });

      await waitFor(async () => (await service.getRun(run.runId))?.status === 'waiting_user', 60);
      const waiting = await service.getRun(run.runId);
      expect(waiting?.status).toBe('waiting_user');

      const waitingEvents = await storage.getStructuredStore().all<{ event_type: string; payload_json: string }>(
        `SELECT event_type, payload_json FROM run_events WHERE run_id=? ORDER BY created_at ASC`,
        [run.runId],
      );
      const waitingPayload = waitingEvents
        .filter((event) => event.event_type === 'waiting_user')
        .map((event) => JSON.parse(event.payload_json) as Record<string, unknown>)[0];

      expect(waitingPayload).toMatchObject({
        question: '是否确认启用技能包？',
        options: ['确认', '取消'],
        promptKind: 'approval',
        checkpointId: expect.any(String),
        checkpoint: {
          requestId: expect.any(String),
          question: '是否确认启用技能包？',
          options: ['确认', '取消'],
          changeType: 'enable-skill',
        },
      });

      const accepted = await service.submitInput(run.runId, { option: '确认', index: 0 });
      expect(accepted).toEqual({ ok: true, runId: run.runId, accepted: true });

      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed', 60);

      const final = await service.getRun(run.runId);
      expect(final?.status).toBe('completed');

      const events = await storage.getStructuredStore().all<{ event_type: string; payload_json: string }>(
        `SELECT event_type, payload_json FROM run_events WHERE run_id=? ORDER BY created_at ASC`,
        [run.runId],
      );
      expect(events.map((event) => event.event_type)).toEqual(
        expect.arrayContaining(['waiting_user', 'user_input_received', 'run_completed']),
      );
      const inputPayload = events
        .filter((event) => event.event_type === 'user_input_received')
        .map((event) => JSON.parse(event.payload_json) as Record<string, unknown>)[0];
      expect(inputPayload).toMatchObject({
        input: '确认',
        option: '确认',
        index: 0,
        approved: true,
      });
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('aborts a live run and records a cancellation event', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          await new Promise<never>((_resolve, reject) => {
            input.signal?.addEventListener(
              'abort',
              () => reject(new Error('aborted by user')),
              { once: true },
            );
          });
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'general',
        input: { prompt: 'cancel me' },
      });

      await service.cancel(run.runId);
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'cancelled', 60);

      const cancelled = await service.getRun(run.runId);
      expect(cancelled?.terminationReason).toBe('user_cancelled');

      const events = await storage.getStructuredStore().all<{ event_type: string }>(
        `SELECT event_type FROM run_events WHERE run_id=? ORDER BY created_at ASC`,
        [run.runId],
      );
      expect(events.map((event) => event.event_type)).toContain('run_cancelled');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('interrupts an active run and resumes the same run id for a follow-up message', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    let executeCount = 0;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          executeCount += 1;
          const createdAt = `2026-04-24T06:30:0${executeCount}.000Z`;

          await input.onSnapshot?.({
            runId: input.runId,
            taskKind: input.requestedTaskKind ?? 'general',
            status: 'running',
            input: input.input,
            routing: {
              requestedTaskKind: input.requestedTaskKind,
              acceptedTaskKind: input.requestedTaskKind ?? 'general',
              confidence: 1,
              reason: 'test_runtime',
              routeParams: {},
            },
            metrics: {
              turnCount: executeCount,
              toolCallCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              estimatedUsd: 0,
            },
            createdAt,
            updatedAt: createdAt,
          });

          if (executeCount === 1) {
            await new Promise<never>((_resolve, reject) => {
              input.signal?.addEventListener(
                'abort',
                () => reject(new Error('aborted by user')),
                { once: true },
              );
            });
          }

          await input.onEvent({
            eventId: `evt_${input.runId}_completed_${executeCount}`,
            runId: input.runId,
            type: 'run_completed',
            payload: { attempt: executeCount },
            createdAt,
          });

          return {
            snapshot: {
              runId: input.runId,
              taskKind: input.requestedTaskKind ?? 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: input.requestedTaskKind ?? 'general',
                confidence: 1,
                reason: 'test_runtime',
                routeParams: {},
              },
              metrics: {
                turnCount: executeCount,
                toolCallCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}_${executeCount}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'general',
        input: { prompt: 'initial run' },
      });

      await flushMicrotasks();

      const followUp = await service.appendMessage(run.runId, {
        content: 'continue with follow-up guidance',
        toolIds: ['query_database'],
      });

      expect(followUp).toEqual({
        runId: run.runId,
        resumed: true,
        interrupted: true,
      });

      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed', 60);

      const events = await storage.getStructuredStore().all<{ event_id: string; event_type: string }>(
        `SELECT event_id, event_type FROM run_events WHERE run_id=? ORDER BY created_at ASC`,
        [run.runId],
      );

      expect(events.map((event) => event.event_type)).toEqual(
        expect.arrayContaining(['user_message', 'run_cancelled', 'run_completed']),
      );
      expect(new Set(events.map((event) => event.event_id)).size).toBe(events.length);
      expect(executeCount).toBe(2);
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('preserves cumulative metrics when a completed run receives a same-run follow-up', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    let executeCount = 0;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          executeCount += 1;
          const createdAt = `2026-04-24T06:40:0${executeCount}.000Z`;
          const deltaMetrics = executeCount === 1
            ? {
                turnCount: 2,
                toolCallCount: 1,
                inputTokens: 120,
                outputTokens: 40,
                cachedTokens: 5,
                estimatedUsd: 0.011,
              }
            : {
                turnCount: 1,
                toolCallCount: 2,
                inputTokens: 80,
                outputTokens: 25,
                cachedTokens: 3,
                estimatedUsd: 0.007,
              };

          await input.onSnapshot?.({
            runId: input.runId,
            taskKind: input.requestedTaskKind ?? 'general',
            status: 'running',
            input: input.input,
            routing: {
              requestedTaskKind: input.requestedTaskKind,
              acceptedTaskKind: input.requestedTaskKind ?? 'general',
              confidence: 1,
              reason: 'test_runtime',
              routeParams: {},
            },
            metrics: deltaMetrics,
            createdAt,
            updatedAt: createdAt,
          });

          return {
            snapshot: {
              runId: input.runId,
              taskKind: input.requestedTaskKind ?? 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: input.requestedTaskKind ?? 'general',
                confidence: 1,
                reason: 'test_runtime',
                routeParams: {},
              },
              metrics: deltaMetrics,
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}_${executeCount}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'general',
        input: { prompt: 'initial metrics run' },
      });

      await flushMicrotasks();
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed', 60);

      await service.appendMessage(run.runId, {
        content: 'follow up with more context',
      });

      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed', 60);

      const final = await service.getRun(run.runId);
      expect(final?.metrics).toMatchObject({
        turnCount: 3,
        toolCallCount: 3,
        inputTokens: 200,
        outputTokens: 65,
        cachedTokens: 8,
      });
      expect(final?.metrics.estimatedUsd ?? 0).toBeCloseTo(0.018, 6);
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reconciles an orphan running run after a final structured answer was already persisted', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const repos = new RunRepositories(storage.getStructuredStore());
      const createdAt = '2026-05-25T07:02:05.114Z';
      const finalizedAt = '2026-05-25T07:03:42.124Z';
      const runId = 'run_orphan_reconcile';

      await repos.insertRun({
        runId,
        taskKind: 'general',
        status: 'running',
        input: { prompt: 'orphaned run' },
        routing: {
          requestedTaskKind: 'general',
          acceptedTaskKind: 'general',
          confidence: 1,
          reason: 'test_orphaned_run',
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
        createdAt,
        updatedAt: createdAt,
      });

      await repos.appendEvent({
        eventId: `evt_${runId}_checkpoint`,
        runId,
        type: 'checkpoint_created',
        payload: {
          checkpointId: 'chk_general_ready',
          kind: 'running-step',
          scope: 'semantic',
          semanticKind: 'general-response-ready',
        },
        createdAt: finalizedAt,
      });

      await repos.saveArtifact({
        artifactId: 'art_orphan_final',
        runId,
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: {
          response: '# 完成\n\n历史挂起 run 的最终输出。',
        },
        version: 1,
        createdAt: finalizedAt,
      });

      const service = new RunService(
        storage,
        async () => ({ execute: async () => { throw new Error('runtime should not be used'); } }) as HarnessRuntime,
      );

      const reconciled = await service.getRun(runId);
      expect(reconciled?.status).toBe('completed');
      expect(reconciled?.latestArtifactId).toBe('art_orphan_final');
      expect(reconciled?.completedAt).toBe(finalizedAt);
      expect(reconciled?.updatedAt).toBe(finalizedAt);

      const persisted = await repos.getRun(runId);
      expect(persisted?.status).toBe('completed');
      expect(persisted?.latestArtifactId).toBe('art_orphan_final');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('passes follow-up turns as a dedicated turn envelope instead of appending top-level guidance messages', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    const capturedInputs: Array<{ requestedTaskKind?: string; input: Record<string, unknown> }> = [];

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          capturedInputs.push({
            requestedTaskKind: input.requestedTaskKind,
            input: input.input,
          });

          const createdAt = '2026-05-15T03:00:00.000Z';
          return {
            snapshot: {
              runId: input.runId,
              taskKind: (input.requestedTaskKind ?? 'analysis') as any,
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind as any,
                acceptedTaskKind: (input.requestedTaskKind ?? 'analysis') as any,
                confidence: 1,
                reason: 'test_runtime',
                routeParams: {},
              },
              metrics: {
                turnCount: 1,
                toolCallCount: 0,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.phase1',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        taskKind: 'analysis',
        input: {
          prompt: '分析支付风控首轮请求',
          guidanceMessages: ['仅保留为历史 pack scratch'],
          surface: 'web',
        },
      });

      await flushMicrotasks();
      await waitFor(async () => (await service.getRun(run.runId))?.status === 'completed', 60);

      await service.appendMessage(run.runId, {
        content: '帮我生成一个 Discord bot 骨架',
        toolIds: ['tool_search'],
        attachmentIds: ['att_123'],
        approvalMode: 'autopilot',
      });

      expect(capturedInputs).toHaveLength(2);
      expect(capturedInputs[1]?.requestedTaskKind).toBeUndefined();
      expect(capturedInputs[1]?.input.prompt).toBe('分析支付风控首轮请求');
      expect(capturedInputs[1]?.input.guidanceMessages).toEqual(['仅保留为历史 pack scratch']);
      expect(capturedInputs[1]?.input.turnEnvelope).toMatchObject({
        kind: 'follow-up',
        userMessage: '帮我生成一个 Discord bot 骨架',
        priorTaskKind: 'analysis',
        priorCapabilityProfile: 'analysis',
        toolIds: ['tool_search'],
        attachmentIds: ['att_123'],
        approvalMode: 'autopilot',
      });
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not re-lock hermes-mode follow-up turns to the stored general task kind', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    const requestedTaskKinds: Array<'analysis' | 'general' | 'knowledge-query' | 'skill-management' | undefined> = [];

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          requestedTaskKinds.push(input.requestedTaskKind);
          const createdAt = '2026-05-13T09:00:00.000Z';
          return {
            snapshot: {
              runId: input.runId,
              taskKind: 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: 'general',
                initialCapabilityProfile: 'general',
                agentMode: 'hermes',
                confidence: 0.78,
                reason: 'semantic_capability_entry',
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
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}_${requestedTaskKinds.length}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.hermes-follow-up',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const run = await service.createRun({
        input: { prompt: '分析电商支付的风险链路并给我一份排查报告' },
        surface: 'web',
      });

      await service.appendMessage(run.runId, {
        content: '再补充下登录链路',
      });

      expect(requestedTaskKinds).toEqual([undefined, undefined]);
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('promotes repeated successful skill proposals into an autonomous learned skill', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let storage: StorageBackendRegistry | undefined;
    let invocation = 0;

    try {
      storage = await StorageBackendRegistry.bootstrap(tmp);
      const runtime: HarnessRuntime = {
        execute: async (input) => {
          invocation += 1;
          const createdAt = `2026-05-13T10:00:0${invocation}.000Z`;
          const prompt = String(input.input.prompt ?? '');

          await input.onArtifact?.({
            artifactId: `art_skill_proposal_${invocation}`,
            runId: input.runId,
            kind: 'json',
            mimeType: 'application/json',
            contentJson: {
              type: 'skill-proposal',
              sourceRunId: input.runId,
              taskKind: 'general',
              title: prompt,
              rationale: 'Successful web price collection workflow.',
              triggerHints: [
                prompt,
                'Open the relevant web pages and compare the price signals.',
              ],
              workflow: [
                'Open the relevant product pages and extract the current price.',
                'Normalize the captured prices into a comparable list.',
                'Return a concise comparison summary.',
              ],
              evidence: [`Observed successful completion for ${prompt}`],
              creationPayload: {
                name: `draft-price-pattern-${invocation}`,
                description: 'Draft web price collection workflow',
                content: '# Draft web price collection workflow',
              },
            },
            version: 1,
            createdAt,
          });

          return {
            snapshot: {
              runId: input.runId,
              taskKind: input.requestedTaskKind ?? 'general',
              status: 'completed',
              input: input.input,
              routing: {
                requestedTaskKind: input.requestedTaskKind,
                acceptedTaskKind: input.requestedTaskKind ?? 'general',
                confidence: 1,
                reason: 'test_autonomous_learning',
                routeParams: {},
              },
              metrics: {
                turnCount: 1,
                toolCallCount: 2,
                inputTokens: 0,
                outputTokens: 0,
                cachedTokens: 0,
                estimatedUsd: 0,
              },
              createdAt,
              updatedAt: createdAt,
              completedAt: createdAt,
            },
            artifacts: [],
            verification: {
              verificationId: `ver_${input.runId}_${invocation}`,
              runId: input.runId,
              verifierType: 'contract',
              contractVersion: 'test.autonomous-learning',
              decision: 'pass',
              reasons: ['ok'],
              followUpAction: 'none',
              createdAt,
            },
          };
        },
      } as HarnessRuntime;

      const service = new RunService(storage, async () => runtime);
      const firstRun = await service.createRun({
        taskKind: 'general',
        input: { prompt: '抓取 iPhone 15 的价格并汇总' },
      });

      await waitFor(async () => (await service.getRun(firstRun.runId))?.status === 'completed', 60);
      await waitFor(async () => {
        const observed = await storage?.getStructuredStore().get<{ payload_json: string }>(
          `SELECT payload_json FROM run_events WHERE run_id=? AND event_type='skill_pattern_observed' LIMIT 1`,
          [firstRun.runId],
        );
        return Boolean(observed);
      }, 60);

      const firstLearnedEvent = await storage.getStructuredStore().get<{ payload_json: string }>(
        `SELECT payload_json FROM run_events WHERE run_id=? AND event_type='skill_learned' LIMIT 1`,
        [firstRun.runId],
      );
      expect(firstLearnedEvent).toBeUndefined();

      const secondRun = await service.createRun({
        taskKind: 'general',
        input: { prompt: '抓取 MacBook Pro 的价格并汇总' },
      });

      await waitFor(async () => (await service.getRun(secondRun.runId))?.status === 'completed', 60);
      await waitFor(async () => {
        const learned = await storage?.getStructuredStore().get<{ payload_json: string }>(
          `SELECT payload_json FROM run_events WHERE run_id=? AND event_type='skill_learned' LIMIT 1`,
          [secondRun.runId],
        );
        return Boolean(learned);
      }, 60);

      const learnedEvent = await storage.getStructuredStore().get<{ payload_json: string }>(
        `SELECT payload_json FROM run_events WHERE run_id=? AND event_type='skill_learned' LIMIT 1`,
        [secondRun.runId],
      );

      expect(learnedEvent).toBeDefined();
      const learnedPayload = JSON.parse(learnedEvent?.payload_json ?? '{}') as {
        patternLabel?: string;
        occurrenceCount?: number;
        skillName?: string;
      };

      expect(learnedPayload).toMatchObject({
        patternLabel: '网页数据抓取并汇总',
        occurrenceCount: 2,
        skillName: expect.stringMatching(/^learned-general-web-data-collection-summary-/),
      });

      const skillPath = join(storage.paths.dataRoot, 'skills', learnedPayload.skillName ?? '', 'SKILL.md');
      expect(existsSync(skillPath)).toBe(true);

      const skillFile = readFileSync(skillPath, 'utf-8');
      expect(skillFile).toContain('description: 网页数据抓取并汇总 自动学习技能');
      expect(skillFile).toContain('# 网页数据抓取并汇总');
      expect(skillFile).toContain('Learned automatically after 2 successful runs.');
    } finally {
      await storage?.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('serves the run-first API and SSE flow for a semantic-entry web run', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-for-runs',
          isDefault: true,
        },
      });
      expect(model.statusCode).toBe(201);

      const created = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          input: { prompt: '请做知识图谱查询：账户接管风险链路' },
          surface: 'web',
        },
      });
      expect(created.statusCode).toBe(201);
      expect(JSON.parse(created.body)).toMatchObject({
        taskKind: 'general',
        acceptedTaskKind: 'general',
        initialCapabilityProfile: 'general',
      });

      const runId = JSON.parse(created.body).runId as string;
      await waitFor(async () => (await built.ctx.runService.getRun(runId))?.status === 'completed', 60);

      const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body)).toMatchObject({
        taskKind: 'general',
        routing: {
          acceptedTaskKind: 'general',
          initialCapabilityProfile: 'general',
          agentMode: 'hermes',
        },
      });

      const events = await app.inject({ method: 'GET', url: `/api/runs/${runId}/events` });
      expect(events.statusCode).toBe(200);
      expect(events.body).toContain('checkpoint_created');
      expect(events.body).toContain('semantic_capability_entry');
      expect(events.body).toContain('continuation_decision');

      const artifacts = await app.inject({ method: 'GET', url: `/api/runs/${runId}/artifacts` });
      expect(artifacts.statusCode).toBe(200);
      expect(artifacts.body).toContain('structured-answer');

      const stream = await app.inject({ method: 'GET', url: `/api/runs/${runId}/stream` });
      expect(stream.statusCode).toBe(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.body).toContain('checkpoint_created');
      expect(stream.body).toContain('run_completed');
    } finally {
      await app?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after Fastify shutdown.
      }
    }
  });

  it('accepts a follow-up message on the same completed run id', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-runs-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-follow-up-model',
          isDefault: true,
        },
      });
      expect(model.statusCode).toBe(201);
      const modelId = JSON.parse(model.body).modelId as string;

      const created = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          taskKind: 'knowledge-query',
          input: { prompt: '请做知识图谱查询：快捷支付异常登录链路' },
          preferredModel: modelId,
          surface: 'web',
        },
      });
      expect(created.statusCode).toBe(201);

      const runId = JSON.parse(created.body).runId as string;
      await waitFor(async () => (await built.ctx.runService.getRun(runId))?.status === 'completed', 60);

      const followUp = await app.inject({
        method: 'POST',
        url: `/api/runs/${runId}/messages`,
        payload: {
          content: '请重点关注异常登录链路，并结合新的引导重写结论。',
          modelId,
          toolIds: ['query_database'],
        },
      });

      expect(followUp.statusCode).toBe(201);
      expect(JSON.parse(followUp.body)).toEqual({
        ok: true,
        runId,
        resumed: true,
        interrupted: false,
      });
    } finally {
      await app?.close();
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // Windows file handles can release slightly after Fastify shutdown.
      }
    }
  });
});
