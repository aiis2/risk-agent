import { buildCapabilityTemplateBundle, type CapabilityTemplateId } from '@risk-agent/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const TemplateIdSchema = z.enum(['feishu-bot', 'dingtalk-bot', 'discord-bot', 'generic-webhook', 'mcp-server']);

const GenerateTemplateSchema = z.object({
  templateId: TemplateIdSchema,
  capabilityName: z.string().trim().min(1).max(80),
});

const TEMPLATE_DESCRIPTORS: Array<{
  templateId: CapabilityTemplateId;
  capabilityKind: 'connector' | 'mcp-server';
  title: string;
  description: string;
  accent: string;
}> = [
  {
    templateId: 'feishu-bot',
    capabilityKind: 'connector',
    title: 'Feishu Connector',
    description: 'Generate a review-first Feishu bot skeleton with manifest, secrets contract, and adapter entrypoint.',
    accent: '#78d3f8',
  },
  {
    templateId: 'dingtalk-bot',
    capabilityKind: 'connector',
    title: 'DingTalk Connector',
    description: 'Generate a DingTalk bridge skeleton for webhook intake, outbound delivery, and secure review.',
    accent: '#6b8afe',
  },
  {
    templateId: 'discord-bot',
    capabilityKind: 'connector',
    title: 'Discord Connector',
    description: 'Generate a Discord bot starter with adapter wiring, env placeholders, and health-check shape.',
    accent: '#8b7bff',
  },
  {
    templateId: 'generic-webhook',
    capabilityKind: 'connector',
    title: 'Webhook Connector',
    description: 'Generate a generic inbound webhook connector for reviewed event normalization and secure delivery.',
    accent: '#30d158',
  },
  {
    templateId: 'mcp-server',
    capabilityKind: 'mcp-server',
    title: 'MCP Server',
    description: 'Generate an MCP server skeleton with manifest, env file, entrypoint, and review notes.',
    accent: '#ffba08',
  },
];

export function registerCapabilityRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get('/api/capabilities/templates', async () => ({ templates: TEMPLATE_DESCRIPTORS }));

  app.post('/api/capabilities/templates/generate', async (req, reply) => {
    const parsed = GenerateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    return {
      bundle: buildCapabilityTemplateBundle(parsed.data),
    };
  });
}