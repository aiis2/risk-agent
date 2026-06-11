import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { ToolRegistry } from '../registry/ToolRegistry.js';

export function createToolSearchTool(registry: ToolRegistry): AgentToolDefinition {
  return {
    name: 'tool_search',
    description: '按关键字在可用工具清单中检索可能有用的工具，用于延迟加载场景。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: true,
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string' } }
    },
    async execute(input) {
      const { query } = input as { query: string };
      const q = query.toLowerCase();
      const hits = registry
        .list()
        .filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            (t.searchHint ?? '').toLowerCase().includes(q)
        )
        .map((t) => ({
          name: t.name,
          description: t.description,
          alwaysLoad: t.alwaysLoad,
          destructive: t.isDestructive
        }));
      return { hits };
    }
  };
}
