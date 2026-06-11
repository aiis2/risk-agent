import type { CapabilityKind } from './types.js';

export type CapabilityTemplateId = 'feishu-bot' | 'dingtalk-bot' | 'discord-bot' | 'generic-webhook' | 'mcp-server';

export interface CapabilityTemplateFile {
  path: string;
  purpose: 'manifest' | 'env' | 'program' | 'docs';
  content: string;
}

export interface CapabilityTemplateBundle {
  templateId: CapabilityTemplateId;
  capabilityKind: Extract<CapabilityKind, 'connector' | 'mcp-server'>;
  capabilityName: string;
  description: string;
  files: CapabilityTemplateFile[];
  nextSteps: string[];
}

export function buildCapabilityTemplateBundle(input: {
  templateId: CapabilityTemplateId;
  capabilityName: string;
}): CapabilityTemplateBundle {
  const capabilityName = slugifyName(input.capabilityName);

  switch (input.templateId) {
    case 'feishu-bot':
      return buildConnectorBundle({
        templateId: input.templateId,
        capabilityName,
        platformId: 'feishu',
        platformLabel: 'Feishu',
        envLines: [
          'FEISHU_APP_ID=replace-me',
          'FEISHU_APP_SECRET=replace-me',
          'FEISHU_VERIFICATION_TOKEN=replace-me',
        ],
      });
    case 'dingtalk-bot':
      return buildConnectorBundle({
        templateId: input.templateId,
        capabilityName,
        platformId: 'dingtalk',
        platformLabel: 'DingTalk',
        envLines: [
          'DINGTALK_CLIENT_ID=replace-me',
          'DINGTALK_CLIENT_SECRET=replace-me',
          'DINGTALK_AES_KEY=replace-me',
        ],
      });
    case 'discord-bot':
      return buildConnectorBundle({
        templateId: input.templateId,
        capabilityName,
        platformId: 'discord',
        platformLabel: 'Discord',
        envLines: [
          'DISCORD_BOT_TOKEN=replace-me',
          'DISCORD_APPLICATION_ID=replace-me',
          'DISCORD_PUBLIC_KEY=replace-me',
        ],
      });
    case 'generic-webhook':
      return buildConnectorBundle({
        templateId: input.templateId,
        capabilityName,
        platformId: 'webhook',
        platformLabel: 'Webhook',
        envLines: [
          'WEBHOOK_SHARED_SECRET=replace-me',
          'WEBHOOK_BIND_PORT=8788',
        ],
      });
    case 'mcp-server':
      return buildMcpServerBundle(capabilityName);
  }
}

function buildConnectorBundle(input: {
  templateId: Exclude<CapabilityTemplateId, 'mcp-server'>;
  capabilityName: string;
  platformId: string;
  platformLabel: string;
  envLines: string[];
}): CapabilityTemplateBundle {
  const basePath = input.capabilityName;

  return {
    templateId: input.templateId,
    capabilityKind: 'connector',
    capabilityName: input.capabilityName,
    description: `${input.platformLabel} connector skeleton for autonomous review, approval, and follow-up wiring.`,
    files: [
      {
        path: `${basePath}/connector.manifest.json`,
        purpose: 'manifest',
        content: JSON.stringify({
          version: 1,
          templateId: input.templateId,
          platform: input.platformId,
          capabilityName: input.capabilityName,
          entrypoint: 'src/adapter.ts',
          envFile: '.env.example',
          healthcheck: {
            command: 'node dist/adapter.js --healthcheck',
          },
        }, null, 2),
      },
      {
        path: `${basePath}/.env.example`,
        purpose: 'env',
        content: input.envLines.join('\n'),
      },
      {
        path: `${basePath}/src/adapter.ts`,
        purpose: 'program',
        content: buildConnectorAdapterSource(input.platformLabel, input.platformId, input.capabilityName),
      },
      {
        path: `${basePath}/README.md`,
        purpose: 'docs',
        content: buildConnectorReadme(input.platformLabel, input.capabilityName),
      },
    ],
    nextSteps: [
      'Fill .env.example placeholders with real secrets in a separate secure config path.',
      'Implement the platform-specific verification flow and webhook signature checks.',
      'Register the generated connector with a reviewed runtime route or scheduled bootstrap task.',
    ],
  };
}

function buildMcpServerBundle(capabilityName: string): CapabilityTemplateBundle {
  const basePath = capabilityName;

  return {
    templateId: 'mcp-server',
    capabilityKind: 'mcp-server',
    capabilityName,
    description: 'MCP server skeleton for reviewed tool exposure and health validation.',
    files: [
      {
        path: `${basePath}/mcp-server.manifest.json`,
        purpose: 'manifest',
        content: JSON.stringify({
          version: 1,
          transport: 'stdio',
          capabilityName,
          entrypoint: 'src/server.ts',
          envFile: '.env.example',
        }, null, 2),
      },
      {
        path: `${basePath}/.env.example`,
        purpose: 'env',
        content: ['MCP_SERVER_NAME=' + capabilityName, 'MCP_LOG_LEVEL=info'].join('\n'),
      },
      {
        path: `${basePath}/src/server.ts`,
        purpose: 'program',
        content: buildMcpServerSource(capabilityName),
      },
      {
        path: `${basePath}/README.md`,
        purpose: 'docs',
        content: buildMcpReadme(capabilityName),
      },
    ],
    nextSteps: [
      'Replace the placeholder tool definitions with concrete tool metadata and handlers.',
      'Add authentication, health checks, and timeouts before registering the server in config/mcp-servers.json.',
      'Validate the generated server with a dry-run transport before enabling it for agents.',
    ],
  };
}

function buildConnectorAdapterSource(platformLabel: string, platformId: string, capabilityName: string): string {
  return [
    `export class ${platformLabel}ConnectorAdapter {`,
    '  constructor(private readonly connectorName = ' + JSON.stringify(capabilityName) + ') {}',
    '',
    '  async handleIncomingEvent(payload: unknown): Promise<void> {',
    '    void payload;',
    '    // TODO: validate webhook signature and normalize the incoming event.',
    '  }',
    '',
    '  async sendMessage(target: string, message: string): Promise<void> {',
    '    void target;',
    '    void message;',
    `    // TODO: map normalized replies back into ${platformLabel} delivery primitives.`,
    '  }',
    '',
    '  async healthcheck(): Promise<{ ok: boolean; platform: string }> {',
    `    return { ok: true, platform: ${JSON.stringify(platformId)} };`,
    '  }',
    '}',
    '',
    'export async function handleIncomingEvent(payload: unknown): Promise<void> {',
    `  const adapter = new ${platformLabel}ConnectorAdapter();`,
    '  await adapter.handleIncomingEvent(payload);',
    '}',
  ].join('\n');
}

function buildMcpServerSource(capabilityName: string): string {
  return [
    `const serverName = ${JSON.stringify(capabilityName)};`,
    '',
    'export function listTools() {',
    '  return [',
    '    {',
    "      name: 'health_check',",
    "      description: 'Return the current server health.',",
    '      inputSchema: { type: \"object\", properties: {} },',
    '    },',
    '  ];',
    '}',
    '',
    'export async function main(): Promise<void> {',
    '  const tools = listTools();',
    '  void tools;',
    '  // TODO: wire stdio transport and tool handlers for the generated MCP server.',
    `  process.stdout.write(${JSON.stringify(`${capabilityName} ready\n`)});`,
    '}',
    '',
    'void main();',
  ].join('\n');
}

function buildConnectorReadme(platformLabel: string, capabilityName: string): string {
  return [
    `# ${capabilityName}`,
    '',
    `Generated ${platformLabel} connector skeleton.`,
    '',
    'This bundle is intentionally incomplete: it exists so an agent or human reviewer can inspect the manifest, secrets contract, adapter skeleton, and health-check shape before any real external integration is enabled.',
  ].join('\n');
}

function buildMcpReadme(capabilityName: string): string {
  return [
    `# ${capabilityName}`,
    '',
    'Generated MCP server skeleton.',
    '',
    'This bundle defines the manifest, env placeholders, and server entrypoint shape needed to review and extend an MCP server before it is registered in runtime config.',
  ].join('\n');
}

function slugifyName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'generated-capability';
}