/**
 * MCPClient — 最小可运行骨架。首版只支持 HTTP/SSE 的 list_tools + call_tool。
 */
import { request } from 'undici';

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPClientOptions {
  name: string;
  transport: 'http' | 'sse' | 'stream';
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class MCPClient {
  constructor(public readonly options: MCPClientOptions) {}

  async listTools(): Promise<MCPToolInfo[]> {
    try {
      const res = await request(`${this.options.url.replace(/\/$/, '')}/tools`, {
        headers: this.options.headers
      });
      const json = (await res.body.json()) as any;
      return Array.isArray(json?.tools) ? json.tools : [];
    } catch {
      return [];
    }
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    const res = await request(`${this.options.url.replace(/\/$/, '')}/tools/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.options.headers ?? {}) },
      body: JSON.stringify({ input })
    });
    return res.body.json();
  }

  async health(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await request(`${this.options.url.replace(/\/$/, '')}/health`, {
        headers: this.options.headers,
        method: 'GET'
      });
      return { ok: res.statusCode >= 200 && res.statusCode < 300 };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'unknown' };
    }
  }
}
