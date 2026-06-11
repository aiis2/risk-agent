import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';

async function waitFor(condition: () => Promise<boolean>, attempts = 60): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Condition not met in time');
}

describe('capabilities API', () => {
  it('lists template descriptors and generates connector bundles', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-capabilities-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const list = await app.inject({ method: 'GET', url: '/api/capabilities/templates' });
      expect(list.statusCode).toBe(200);
      expect(JSON.parse(list.body)).toMatchObject({
        templates: expect.arrayContaining([
          expect.objectContaining({ templateId: 'feishu-bot', capabilityKind: 'connector' }),
          expect.objectContaining({ templateId: 'mcp-server', capabilityKind: 'mcp-server' }),
        ]),
      });

      const generated = await app.inject({
        method: 'POST',
        url: '/api/capabilities/templates/generate',
        payload: {
          templateId: 'discord-bot',
          capabilityName: 'risk-ops-bridge',
        },
      });

      expect(generated.statusCode).toBe(200);
      expect(JSON.parse(generated.body)).toMatchObject({
        bundle: {
          templateId: 'discord-bot',
          capabilityKind: 'connector',
          capabilityName: 'risk-ops-bridge',
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'risk-ops-bridge/connector.manifest.json' }),
            expect.objectContaining({ path: 'risk-ops-bridge/src/adapter.ts' }),
          ]),
        },
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

  it('routes MCP debug runs into a capability plan using configured MCP servers', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-capabilities-run-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-capability-router',
          isDefault: true,
          config: {
            scripts: [
              {
                text: JSON.stringify({
                  decision: 'continue',
                  nextCapabilityProfile: 'skill-management',
                  reason: 'The user wants to debug a configured MCP server.',
                  delegatedPrompt: '请帮我调试 docs-mcp MCP 服务',
                }),
                stopReason: 'end_turn',
              },
              {
                text: JSON.stringify({
                  decision: 'stop',
                  nextCapabilityProfile: 'skill-management',
                  reason: 'The MCP capability plan is ready.',
                }),
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const createdServer = await app.inject({
        method: 'POST',
        url: '/api/mcp',
        payload: {
          name: 'docs-mcp',
          url: 'http://127.0.0.1:8877/mcp',
          transport: 'http',
          description: 'Documentation MCP server',
          enabled: true,
        },
      });
      expect(createdServer.statusCode).toBe(201);

      const createdRun = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          input: {
            prompt: '请帮我调试 docs-mcp MCP 服务',
          },
          surface: 'web',
        },
      });
      expect(createdRun.statusCode).toBe(201);

      const runId = JSON.parse(createdRun.body).runId as string;
      await waitFor(async () => (await built.ctx.runService.getRun(runId))?.status === 'completed');

      const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body)).toMatchObject({
        runId,
        taskKind: 'general',
      });

      const artifacts = await app.inject({ method: 'GET', url: `/api/runs/${runId}/artifacts` });
      expect(artifacts.statusCode).toBe(200);

      const structuredAnswer = JSON.parse(artifacts.body).find((artifact: { kind: string }) => artifact.kind === 'structured-answer');
      expect(structuredAnswer).toMatchObject({
        contentJson: {
          capabilityKind: 'mcp-server',
          action: 'debug',
          targetServer: 'docs-mcp',
          capabilityPlan: expect.objectContaining({
            capabilityKind: 'mcp-server',
            intent: 'debug',
          }),
        },
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

  it('routes connector skeleton requests into a generated template bundle', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-capabilities-connector-run-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-connector-router',
          isDefault: true,
          config: {
            scripts: [
              {
                text: JSON.stringify({
                  decision: 'continue',
                  nextCapabilityProfile: 'skill-management',
                  reason: 'The user wants a connector template bundle.',
                  delegatedPrompt: '帮我生成一个 Discord bot 骨架包',
                }),
                stopReason: 'end_turn',
              },
              {
                text: JSON.stringify({
                  decision: 'stop',
                  nextCapabilityProfile: 'skill-management',
                  reason: 'The connector template bundle is ready.',
                }),
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const createdRun = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: {
          input: {
            prompt: '帮我生成一个 Discord bot 骨架包',
          },
          surface: 'web',
        },
      });
      expect(createdRun.statusCode).toBe(201);
      expect(JSON.parse(createdRun.body)).toMatchObject({
        acceptedTaskKind: 'general',
      });

      const runId = JSON.parse(createdRun.body).runId as string;
      await waitFor(async () => (await built.ctx.runService.getRun(runId))?.status === 'completed');

      const detail = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.body)).toMatchObject({
        runId,
        taskKind: 'general',
      });

      const artifacts = await app.inject({ method: 'GET', url: `/api/runs/${runId}/artifacts` });
      expect(artifacts.statusCode).toBe(200);

      const structuredAnswer = JSON.parse(artifacts.body).find((artifact: { kind: string }) => artifact.kind === 'structured-answer');
      expect(structuredAnswer).toMatchObject({
        contentJson: {
          capabilityKind: 'connector',
          action: 'acquire',
          targetTemplateId: 'discord-bot',
          templateBundle: expect.objectContaining({
            templateId: 'discord-bot',
            capabilityKind: 'connector',
            files: expect.arrayContaining([
              expect.objectContaining({ path: 'generated-capability/connector.manifest.json' }),
              expect.objectContaining({ path: 'generated-capability/src/adapter.ts' }),
            ]),
          }),
        },
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