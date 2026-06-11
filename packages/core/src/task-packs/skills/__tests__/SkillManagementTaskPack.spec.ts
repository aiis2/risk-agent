import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunArtifact, RunCheckpoint, RunEvent, RunSnapshot, TaskPackContext } from '../../../harness/types.js';
import { SkillManagementTaskPack } from '../SkillManagementTaskPack.js';

function createContext(runId = 'run_skill') {
  const checkpoints: RunCheckpoint[] = [];
  const events: Array<Omit<RunEvent, 'eventId' | 'runId' | 'createdAt'>> = [];
  const prompts: string[] = [];
  const artifacts: RunArtifact[] = [];

  const run: RunSnapshot = {
    runId,
    taskKind: 'skill-management',
    status: 'running',
    input: { prompt: '测试 demo-skill 技能' },
    routing: {
      acceptedTaskKind: 'skill-management',
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
    createdAt: '2026-04-24T08:10:00.000Z',
    updatedAt: '2026-04-24T08:10:00.000Z',
  };

  const ctx: TaskPackContext = {
    run,
    signal: new AbortController().signal,
    now: () => '2026-04-24T08:10:00.000Z',
    emit: async (event) => {
      events.push(event);
      return {
        eventId: `evt_${events.length}`,
        runId,
        type: event.type,
        payload: event.payload,
        createdAt: '2026-04-24T08:10:00.000Z',
      };
    },
    createSemanticCheckpoint: async (kind, snapshot) => {
      const checkpoint: RunCheckpoint = {
        checkpointId: `chk_${kind}_${checkpoints.length + 1}`,
        runId,
        kind: 'running-step',
        scope: 'semantic',
        snapshot,
        transcriptOffset: checkpoints.length + 1,
        createdAt: '2026-04-24T08:10:00.000Z',
      };
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    requestUserInput: async ({ question }) => {
      prompts.push(question);
      return { input: '确认', approved: true };
    },
    publishArtifact: async (artifact) => {
      const published: RunArtifact = {
        artifactId: `art_${artifacts.length + 1}`,
        runId,
        version: artifacts.length + 1,
        createdAt: '2026-04-24T08:10:00.000Z',
        ...artifact,
      };
      artifacts.push(published);
      return published;
    },
  };

  return { ctx, checkpoints, events, prompts, artifacts };
}

describe('SkillManagementTaskPack', () => {
  it('returns a connector template bundle for connector skeleton requests', async () => {
    const pack = new SkillManagementTaskPack();
    const { ctx, events } = createContext('run_connector_template');
    const normalized = await pack.intake(
      {
        prompt: '帮我生成一个 Discord bot 骨架包',
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(normalized).toMatchObject({
      capabilityKind: 'connector',
      action: 'acquire',
      targetTemplateId: 'discord-bot',
      targetCapabilityName: 'generated-capability',
    });
    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      capabilityKind: 'connector',
      action: 'acquire',
      targetTemplateId: 'discord-bot',
      templateBundle: {
        templateId: 'discord-bot',
        capabilityKind: 'connector',
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'generated-capability/connector.manifest.json' }),
          expect.objectContaining({ path: 'generated-capability/src/adapter.ts' }),
        ]),
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'skill_management_completed',
          payload: expect.objectContaining({
            capabilityKind: 'connector',
            action: 'acquire',
            success: true,
          }),
        }),
      ]),
    );
  });

  it('builds a structured MCP acquisition plan for connect requests', async () => {
    const pack = new SkillManagementTaskPack({
      mcpCatalog: {
        listServers: async () => [],
      },
    });
    const { ctx, events } = createContext('run_mcp_acquire');
    const normalized = await pack.intake(
      {
        prompt: '帮我接入 payments-mcp MCP 服务',
        toolIds: ['tool_search'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(normalized).toMatchObject({
      capabilityKind: 'mcp-server',
      action: 'acquire',
      targetServer: 'payments-mcp',
    });
    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      capabilityKind: 'mcp-server',
      action: 'acquire',
      targetServer: 'payments-mcp',
      capabilityPlan: {
        capabilityKind: 'mcp-server',
        capabilityName: 'payments-mcp',
        intent: 'acquire',
        availability: 'missing',
        steps: expect.arrayContaining([
          expect.objectContaining({ kind: 'discover', status: 'ready' }),
          expect.objectContaining({ kind: 'install', status: 'pending' }),
          expect.objectContaining({ kind: 'verify', status: 'pending' }),
        ]),
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'skill_management_completed',
          payload: expect.objectContaining({
            capabilityKind: 'mcp-server',
            action: 'acquire',
            success: true,
          }),
        }),
      ]),
    );
  });

  it('builds a structured MCP debug plan for configured servers', async () => {
    const pack = new SkillManagementTaskPack({
      mcpCatalog: {
        listServers: async () => [
          {
            serverId: 'srv_docs',
            name: 'docs-mcp',
            url: 'http://127.0.0.1:8877/mcp',
            transport: 'http',
            enabled: true,
            healthStatus: 'unhealthy',
            healthError: 'connect ECONNREFUSED',
            toolCount: 0,
            lastCheckAt: '2026-04-24T08:09:00.000Z',
            description: 'Documentation MCP',
          },
        ],
      },
    });
    const { ctx, events } = createContext('run_mcp_debug');
    const normalized = await pack.intake(
      {
        prompt: '请帮我调试 docs-mcp MCP 服务',
        toolIds: ['tool_search'],
      },
      ctx,
    );
    const plan = await pack.plan(normalized, ctx);
    const execution = await pack.execute(plan, ctx).next();

    expect(normalized).toMatchObject({
      capabilityKind: 'mcp-server',
      action: 'debug',
      targetServer: 'docs-mcp',
    });
    expect(execution.done).toBe(true);
    expect(execution.value).toMatchObject({
      capabilityKind: 'mcp-server',
      action: 'debug',
      targetServer: 'docs-mcp',
      server: expect.objectContaining({
        serverId: 'srv_docs',
        healthStatus: 'unhealthy',
      }),
      capabilityPlan: {
        capabilityKind: 'mcp-server',
        capabilityName: 'docs-mcp',
        intent: 'debug',
        availability: 'available',
        steps: expect.arrayContaining([
          expect.objectContaining({ kind: 'health-check', status: 'ready' }),
          expect.objectContaining({ kind: 'refresh-tools', status: 'ready' }),
          expect.objectContaining({ kind: 'verify', status: 'pending' }),
        ]),
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'skill_management_completed',
          payload: expect.objectContaining({
            capabilityKind: 'mcp-server',
            action: 'debug',
            success: true,
          }),
        }),
      ]),
    );
  });

  it('builds a structured capability acquisition plan for install requests', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-skill-pack-'));

    try {
      const userSkillDir = join(tmp, 'skills');
      const pack = new SkillManagementTaskPack({ userSkillDir });
      const { ctx, events } = createContext('run_skill_acquire');
      const normalized = await pack.intake(
        {
          prompt: '帮我安装 find-skills 技能',
          toolIds: ['tool_search'],
        },
        ctx,
      );
      const plan = await pack.plan(normalized, ctx);
      const execution = await pack.execute(plan, ctx).next();

      expect(normalized).toMatchObject({
        action: 'acquire',
        targetSkill: 'find-skills',
      });
      expect(execution.done).toBe(true);
      expect(execution.value).toMatchObject({
        action: 'acquire',
        targetSkill: 'find-skills',
        capabilityPlan: {
          capabilityKind: 'skill',
          capabilityName: 'find-skills',
          availability: 'missing',
          requiredCapabilities: ['tool_search'],
          steps: expect.arrayContaining([
            expect.objectContaining({ kind: 'discover' }),
            expect.objectContaining({ kind: 'fetch' }),
            expect.objectContaining({ kind: 'security-scan' }),
            expect.objectContaining({ kind: 'dry-run' }),
            expect.objectContaining({ kind: 'install' }),
            expect.objectContaining({ kind: 'verify' }),
          ]),
        },
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'skill_management_completed',
            payload: expect.objectContaining({
              action: 'acquire',
              targetSkill: 'find-skills',
              success: true,
            }),
          }),
        ]),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lists real skills and emits completion metrics for discovery runs', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-skill-pack-'));

    try {
      const userSkillDir = join(tmp, 'skills');
      const demoSkillDir = join(userSkillDir, 'demo-skill');
      mkdirSync(demoSkillDir, { recursive: true });
      writeFileSync(
        join(demoSkillDir, 'SKILL.md'),
        ['---', 'description: Demo skill', '---', '', '# Demo skill', '', 'Demo skill executed successfully.'].join('\n'),
        'utf-8',
      );

      const pack = new SkillManagementTaskPack({ userSkillDir });
      const { ctx, events } = createContext('run_skill_list');
      const normalized = await pack.intake({ prompt: '列出当前可用技能', toolIds: ['tool_search'] }, ctx);
      const plan = await pack.plan(normalized, ctx);
      const execution = await pack.execute(plan, ctx).next();

      expect(execution.done).toBe(true);
      expect(execution.value).toMatchObject({
        action: 'list',
        skills: expect.arrayContaining([
          expect.objectContaining({ name: 'demo-skill' }),
        ]),
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'skill_management_started',
            payload: expect.objectContaining({
              action: 'list',
              syntheticMetrics: expect.objectContaining({
                toolCallCount: 1,
              }),
            }),
          }),
          expect.objectContaining({
            type: 'skill_management_completed',
            payload: expect.objectContaining({
              action: 'list',
              totalSkills: expect.any(Number),
              syntheticMetrics: expect.objectContaining({
                turnCount: 1,
              }),
            }),
          }),
        ]),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('tests a real skill after waiting_user confirmation instead of returning a stub payload', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-skill-pack-'));

    try {
      const userSkillDir = join(tmp, 'skills');
      const demoSkillDir = join(userSkillDir, 'demo-skill');
      mkdirSync(demoSkillDir, { recursive: true });
      writeFileSync(
        join(demoSkillDir, 'SKILL.md'),
        ['---', 'description: Demo skill', '---', '', '# Demo skill', '', 'Demo skill executed successfully.'].join('\n'),
        'utf-8',
      );

      const pack = new SkillManagementTaskPack({ userSkillDir });
      const { ctx, prompts, checkpoints, events } = createContext();
      const normalized = await pack.intake({ prompt: '测试 demo-skill 技能' }, ctx);
      const plan = await pack.plan(normalized, ctx);
      const iterator = pack.execute(plan, ctx);
      const execution = await iterator.next();

      expect(execution.done).toBe(true);
      expect(prompts).toEqual(expect.arrayContaining(['确认执行技能 dry-run：demo-skill？']));
      expect(execution.value).toMatchObject({
        action: 'test',
        targetSkill: 'demo-skill',
        approval: { approved: true },
        testResult: {
          success: true,
          output: expect.stringContaining('Demo skill executed successfully.'),
        },
      });
      expect(checkpoints.map((checkpoint) => checkpoint.snapshot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'test',
            targetSkill: 'demo-skill',
          }),
        ]),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'skill_management_started',
            payload: expect.objectContaining({
              syntheticMetrics: {
                turnCount: 1,
                toolCallCount: 0,
              },
            }),
          }),
          expect.objectContaining({
            type: 'skill_management_completed',
            payload: expect.objectContaining({
              syntheticMetrics: {
                turnCount: 1,
                toolCallCount: 1,
              },
            }),
          }),
        ]),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses attachment context to resolve the target skill when discovery is enabled', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-skill-pack-'));

    try {
      const userSkillDir = join(tmp, 'skills');
      const demoSkillDir = join(userSkillDir, 'demo-skill');
      mkdirSync(demoSkillDir, { recursive: true });
      writeFileSync(
        join(demoSkillDir, 'SKILL.md'),
        ['---', 'description: Demo skill', '---', '', '# Demo skill', '', 'Demo skill executed successfully.'].join('\n'),
        'utf-8',
      );

      const pack = new SkillManagementTaskPack({ userSkillDir });
      const { ctx } = createContext('run_skill_attachment');
      const normalized = await pack.intake(
        {
          prompt: '请帮我测试附件里提到的技能',
          attachmentContext: '附件上下文：\n- note.txt (text/plain, 16 bytes)\n  摘要: 本轮需要重新测试 demo-skill 的执行效果。',
          toolIds: ['tool_search', 'ask_user'],
        },
        ctx,
      );

      expect(normalized).toMatchObject({
        action: 'test',
        targetSkill: 'demo-skill',
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('blocks dry-run confirmation when ask_user is not selected', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-skill-pack-'));

    try {
      const userSkillDir = join(tmp, 'skills');
      const demoSkillDir = join(userSkillDir, 'demo-skill');
      mkdirSync(demoSkillDir, { recursive: true });
      writeFileSync(
        join(demoSkillDir, 'SKILL.md'),
        ['---', 'description: Demo skill', '---', '', '# Demo skill', '', 'Demo skill executed successfully.'].join('\n'),
        'utf-8',
      );

      const pack = new SkillManagementTaskPack({ userSkillDir });
      const { ctx, prompts, checkpoints, events } = createContext('run_skill_restricted');
      const normalized = await pack.intake(
        {
          prompt: '测试 demo-skill 技能',
          toolIds: ['tool_search'],
        },
        ctx,
      );
      const plan = await pack.plan(normalized, ctx);
      const execution = await pack.execute(plan, ctx).next();

      expect(execution.done).toBe(true);
      expect(prompts).toEqual([]);
      expect(execution.value).toMatchObject({
        action: 'test',
        targetSkill: 'demo-skill',
        testResult: {
          success: false,
          error: 'tool_selection_blocks_confirmation',
        },
      });
      expect(checkpoints.map((checkpoint) => checkpoint.snapshot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'test',
            targetSkill: 'demo-skill',
            reason: 'ask_user_not_enabled',
          }),
        ]),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'skill_management_started',
            payload: expect.objectContaining({
              action: 'test',
              syntheticMetrics: {
                toolCallCount: 0,
              },
            }),
          }),
          expect.objectContaining({
            type: 'skill_management_completed',
            payload: expect.objectContaining({
              action: 'test',
              success: false,
              error: 'tool_selection_blocks_confirmation',
              syntheticMetrics: {
                turnCount: 1,
                toolCallCount: 0,
              },
            }),
          }),
        ]),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});