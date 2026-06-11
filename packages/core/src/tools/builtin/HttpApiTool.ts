import { request } from 'undici';
import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

export const httpApiTool: AgentToolDefinition = {
  name: 'http_api',
  description: '通用 HTTP 调用工具，适合访问业务 API、文档站点等只读接口（GET/POST JSON）。',
  isConcurrencySafe: true,
  isDestructive: false,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' },
      headers: { type: 'object' },
      body: {}
    }
  },
  async execute(input, ctx) {
    const { url, method = 'GET', headers = {}, body } = input as {
      url: string;
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: unknown;
    };
    const res = await request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctx.signal
    });
    const text = await res.body.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { status: res.statusCode, headers: res.headers, body: parsed };
  }
};
