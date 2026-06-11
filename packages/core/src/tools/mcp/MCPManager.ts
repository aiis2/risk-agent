import { MCPClient, type MCPClientOptions } from './MCPClient.js';
import { toolFromMCP } from './MCPToolAdapter.js';
import type { ToolRegistry } from '../registry/ToolRegistry.js';

export class MCPManager {
  private readonly clients = new Map<string, MCPClient>();

  constructor(private readonly registry: ToolRegistry) {}

  async register(opts: MCPClientOptions): Promise<{ toolsRegistered: number; healthOk: boolean }> {
    const client = new MCPClient(opts);
    const health = await client.health();
    this.clients.set(opts.name, client);
    if (!health.ok) return { toolsRegistered: 0, healthOk: false };
    const tools = await client.listTools();
    for (const t of tools) {
      this.registry.register(toolFromMCP(client, t));
    }
    return { toolsRegistered: tools.length, healthOk: true };
  }

  unregister(name: string): void {
    const prefix = `mcp.${name}.`;
    for (const t of this.registry.list()) {
      if (t.name.startsWith(prefix)) this.registry.unregister(t.name);
    }
    this.clients.delete(name);
  }

  list(): string[] {
    return Array.from(this.clients.keys());
  }
}
