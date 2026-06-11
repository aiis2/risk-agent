import { describe, expect, it } from 'vitest';
import { buildCapabilityTemplateBundle } from '../ConnectorTemplateCatalog.js';

describe('buildCapabilityTemplateBundle', () => {
  it('builds a Feishu connector bundle with manifest, env, adapter, and docs', () => {
    const bundle = buildCapabilityTemplateBundle({
      templateId: 'feishu-bot',
      capabilityName: 'risk-alert-bot',
    });

    expect(bundle).toMatchObject({
      templateId: 'feishu-bot',
      capabilityKind: 'connector',
      capabilityName: 'risk-alert-bot',
    });
    expect(bundle.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'risk-alert-bot/connector.manifest.json' }),
        expect.objectContaining({ path: 'risk-alert-bot/.env.example' }),
        expect.objectContaining({ path: 'risk-alert-bot/src/adapter.ts' }),
        expect.objectContaining({ path: 'risk-alert-bot/README.md' }),
      ]),
    );

    const manifest = bundle.files.find((file) => file.path.endsWith('connector.manifest.json'));
    const adapter = bundle.files.find((file) => file.path.endsWith('src/adapter.ts'));

    expect(manifest?.content).toContain('feishu');
    expect(manifest?.content).toContain('risk-alert-bot');
    expect(adapter?.content).toContain('Feishu');
    expect(adapter?.content).toContain('handleIncomingEvent');
  });

  it('builds an MCP server bundle with manifest, env, server program, and docs', () => {
    const bundle = buildCapabilityTemplateBundle({
      templateId: 'mcp-server',
      capabilityName: 'risk-docs-mcp',
    });

    expect(bundle).toMatchObject({
      templateId: 'mcp-server',
      capabilityKind: 'mcp-server',
      capabilityName: 'risk-docs-mcp',
    });
    expect(bundle.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'risk-docs-mcp/mcp-server.manifest.json' }),
        expect.objectContaining({ path: 'risk-docs-mcp/.env.example' }),
        expect.objectContaining({ path: 'risk-docs-mcp/src/server.ts' }),
        expect.objectContaining({ path: 'risk-docs-mcp/README.md' }),
      ]),
    );

    const manifest = bundle.files.find((file) => file.path.endsWith('mcp-server.manifest.json'));
    const server = bundle.files.find((file) => file.path.endsWith('src/server.ts'));

    expect(manifest?.content).toContain('stdio');
    expect(server?.content).toContain('risk-docs-mcp');
    expect(server?.content).toContain('listTools');
  });
});