import { buildTool, type AgentToolDefinition } from '@risk-agent/core';
import { WebSearchService } from '../services/WebSearchService.js';

interface StructuredStoreLike {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface WebSearchToolInput {
  query: string;
  provider?: string;
  limit?: number;
}

export function createWebSearchTool(store: StructuredStoreLike): AgentToolDefinition<WebSearchToolInput> {
  const service = new WebSearchService(store);

  return buildTool<WebSearchToolInput>({
    name: 'web_search',
    description: '使用已配置的网络搜索服务商执行联网搜索，适合验证 Tavily 等 provider 是否可用，并获取最新网页结果。',
    isReadOnly: true,
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: 'tavily web search internet online current network 搜索 联网',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        provider: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    async execute(input) {
      return service.search(input.query, {
        provider: input.provider,
        limit: input.limit,
      });
    },
  });
}