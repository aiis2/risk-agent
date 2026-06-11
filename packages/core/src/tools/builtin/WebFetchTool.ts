import { request } from 'undici';
import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

export const webFetchTool: AgentToolDefinition = {
  name: 'web_fetch',
  description: '拉取公开网页的文本内容（HTML/Markdown），用于规则文档与知识检索。',
  isConcurrencySafe: true,
  isDestructive: false,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string' } }
  },
  async execute(input, ctx) {
    const { url } = input as { url: string };
    const res = await request(url, { method: 'GET', signal: ctx.signal });
    const text = await res.body.text();
    return { status: res.statusCode, url, text: text.slice(0, 50_000) };
  }
};
