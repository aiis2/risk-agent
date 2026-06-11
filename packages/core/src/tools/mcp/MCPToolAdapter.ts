import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { MCPClient, MCPToolInfo } from './MCPClient.js';

export function toolFromMCP(client: MCPClient, info: MCPToolInfo): AgentToolDefinition {
  const prefixed = `mcp.${client.options.name}.${info.name}`;
  return {
    name: prefixed,
    description: info.description ?? `MCP tool ${info.name} from ${client.options.name}`,
    inputSchema: info.inputSchema ?? { type: 'object' },
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    deferred: true,
    searchHint: `mcp ${client.options.name}`,
    async execute(input) {
      return client.callTool(info.name, input);
    }
  };
}
