/**
 * MCP 服务器管理 API（05-mcp-management.md §6）
 *
 * GET    /api/mcp                    — 列表
 * POST   /api/mcp                    — 创建
 * GET    /api/mcp/:id                — 详情（含工具列表）
 * PUT    /api/mcp/:id                — 完整更新
 * DELETE /api/mcp/:id                — 删除
 * PATCH  /api/mcp/:id/toggle         — 启用/禁用切换
 * POST   /api/mcp/:id/health         — 手动触发健康检查
 * GET    /api/mcp/:id/tools          — 获取已缓存工具列表
 * POST   /api/mcp/:id/refresh        — 重新发现工具
 * POST   /api/mcp/call               — 工具调用代理
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../index.js';

// ─── Validation schemas ──────────────────────────────────────────────────────

const ServerBodySchema = z.object({
  name:        z.string().min(1),
  url:         z.string().url(),
  transport:   z.enum(['http', 'sse', 'stream']).default('http'),
  description: z.string().optional(),
  timeoutMs:   z.number().int().positive().optional(),
  enabled:     z.boolean().optional(),
  headers:     z.record(z.string()).optional(),
  auth:        z.record(z.unknown()).nullable().optional(),
  retryConfig: z.record(z.unknown()).optional(),
});

// ─── Row serializer ──────────────────────────────────────────────────────────

function serialize(r: any) {
  const cfg = JSON.parse(r.config_json ?? '{}');
  return {
    serverId:     r.server_id,
    name:         r.name,
    url:          r.url,
    transport:    r.transport,
    description:  r.description ?? '',
    timeoutMs:    r.timeout_ms ?? 30000,
    enabled:      !!r.enabled,
    headers:      cfg.headers ?? {},
    auth:         cfg.auth ?? null,
    retryConfig:  cfg.retryConfig ?? null,
    healthStatus: r.health_status ?? 'unknown',
    healthError:  r.health_error ?? null,
    lastCheckAt:  r.last_check_at ?? null,
    toolCount:    r.tool_count ?? 0,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

// ─── Bootstrap migration (add new columns to existing DB) ────────────────────

export async function ensureMcpStorageSchema(store: any) {
  const alterations = [
    `ALTER TABLE mcp_servers ADD COLUMN description TEXT`,
    `ALTER TABLE mcp_servers ADD COLUMN timeout_ms INTEGER DEFAULT 30000`,
    `ALTER TABLE mcp_servers ADD COLUMN health_status TEXT DEFAULT 'unknown'`,
    `ALTER TABLE mcp_servers ADD COLUMN health_error TEXT`,
    `ALTER TABLE mcp_servers ADD COLUMN last_check_at TEXT`,
    `ALTER TABLE mcp_servers ADD COLUMN tool_count INTEGER DEFAULT 0`,
  ];
  for (const sql of alterations) {
    try { await store.run(sql); } catch { /* column already exists */ }
  }
  await store.run(`
    CREATE TABLE IF NOT EXISTS mcp_tool_cache (
      cache_id      TEXT PRIMARY KEY,
      server_id     TEXT NOT NULL REFERENCES mcp_servers(server_id) ON DELETE CASCADE,
      tool_name     TEXT NOT NULL,
      description   TEXT,
      schema_json   TEXT,
      discovered_at TEXT DEFAULT (datetime('now')),
      UNIQUE(server_id, tool_name)
    )
  `);
}

// ─── Simple HTTP connectivity probe ─────────────────────────────────────────

export async function probeServer(url: string, timeoutMs = 5000): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const r = await fetch(url, { method: 'GET', signal: controller.signal });
    return { ok: r.status < 500, latencyMs: Date.now() - start };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_CLIENT_INFO = { name: 'risk-agent', version: '0.1.0' };

interface McpProxyEnvelope {
  result?: unknown;
  error?: { message?: string };
  sessionId?: string | null;
}

function isMcpSessionNotFoundMessage(value: unknown): boolean {
  return typeof value === 'string' && /session not found/i.test(value);
}

function buildMcpProxyHeaders(configJson: string | null, sessionId?: string): Record<string, string> {
  const cfg = JSON.parse(configJson ?? '{}');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(cfg.headers ?? {}),
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  if (cfg.auth?.type === 'bearer' && cfg.auth?.token) {
    headers.Authorization = `Bearer ${cfg.auth.token}`;
  }
  return headers;
}

async function initializeMcpSession(row: { url: string; timeout_ms?: number | null; config_json?: string | null }): Promise<string | undefined> {
  const timeoutMs = row.timeout_ms ?? 30_000;
  const initialize = await sendMcpJsonRpcRequest(
    row,
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO,
    },
    undefined,
    timeoutMs,
  );
  const sessionId = initialize.sessionId ?? undefined;
  await sendMcpNotification(row, 'notifications/initialized', {}, sessionId, timeoutMs);
  return sessionId;
}

async function sendMcpNotification(
  row: { url: string; timeout_ms?: number | null; config_json?: string | null },
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(row.url, {
      method: 'POST',
      headers: buildMcpProxyHeaders(row.config_json ?? null, sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MCP ${method} failed with status ${response.status}${detail ? `: ${detail.slice(0, 300).trim()}` : ''}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function sendMcpJsonRpcRequest(
  row: { url: string; timeout_ms?: number | null; config_json?: string | null },
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
  timeoutMs: number,
): Promise<McpProxyEnvelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(row.url, {
      method: 'POST',
      headers: buildMcpProxyHeaders(row.config_json ?? null, sessionId),
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MCP ${method} failed with status ${response.status}${detail ? `: ${detail.slice(0, 300).trim()}` : ''}`);
    }
    return parseMcpProxyEnvelope(response);
  } finally {
    clearTimeout(timer);
  }
}

export async function executeMcpRequestWithRetry(
  row: { url: string; timeout_ms?: number | null; config_json?: string | null },
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<McpProxyEnvelope> {
  const attempt = async () => {
    const sessionId = await initializeMcpSession(row);
    const body = await sendMcpJsonRpcRequest(row, method, params, sessionId, timeoutMs);
    if (isMcpSessionNotFoundMessage(body.error?.message)) {
      throw new Error(body.error?.message ?? 'Session not found');
    }
    return body;
  };

  try {
    return await attempt();
  } catch (error) {
    if (!isMcpSessionNotFoundMessage(error instanceof Error ? error.message : error)) {
      throw error;
    }
    return attempt();
  }
}

async function parseMcpProxyEnvelope(response: Response): Promise<McpProxyEnvelope> {
  const contentType = response.headers.get('content-type') ?? '';
  const sessionId = response.headers.get('mcp-session-id');
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    return { ...parseMcpEventStreamEnvelope(text), sessionId };
  }

  const text = await response.text();
  if (!text.trim()) {
    return { sessionId };
  }

  const body = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
  return { result: body.result, error: body.error, sessionId };
}

function parseMcpEventStreamEnvelope(text: string): McpProxyEnvelope {
  const chunks = text.split(/\r?\n\r?\n/).map((chunk) => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const dataLines = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) {
      continue;
    }

    try {
      const body = JSON.parse(dataLines.join('\n')) as { result?: unknown; error?: { message?: string } };
      return { result: body.result, error: body.error };
    } catch {
      continue;
    }
  }

  return {};
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerMCPRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();
  // fire-and-forget migration — adds columns / table if missing
  ensureMcpStorageSchema(store).catch(() => {});

  // ── List ──────────────────────────────────────────────────────────────────
  app.get('/api/mcp', async () => {
    const rows = await store.all<any>(`SELECT * FROM mcp_servers ORDER BY created_at DESC`);
    return rows.map(serialize);
  });

  // ── Create ────────────────────────────────────────────────────────────────
  app.post('/api/mcp', async (req, reply) => {
    const parsed = ServerBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const { name, url, transport, description, timeoutMs, enabled, headers, auth, retryConfig } = parsed.data;
    const id = randomUUID();
    const now = new Date().toISOString();
    await store.run(
      `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [id, name, url, transport, description ?? '', timeoutMs ?? 30000,
       JSON.stringify({ headers: headers ?? {}, auth: auth ?? null, retryConfig: retryConfig ?? null }),
       enabled !== false ? 1 : 0, 'unknown', now, now]
    );
    reply.code(201).send({ serverId: id });
  });

  // ── Detail ────────────────────────────────────────────────────────────────
  app.get('/api/mcp/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const tools = await store.all<any>(`SELECT * FROM mcp_tool_cache WHERE server_id=? ORDER BY tool_name`, [id]);
    return {
      ...serialize(row),
      tools: tools.map((t: any) => ({
        name: t.tool_name,
        description: t.description ?? '',
        schema: JSON.parse(t.schema_json ?? 'null'),
        discoveredAt: t.discovered_at,
      })),
    };
  });

  // ── Update ────────────────────────────────────────────────────────────────
  app.put('/api/mcp/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ServerBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const { name, url, transport, description, timeoutMs, enabled, headers, auth, retryConfig } = parsed.data;
    const now = new Date().toISOString();
    await store.run(
      `UPDATE mcp_servers SET name=?, url=?, transport=?, description=?, timeout_ms=?, config_json=?, enabled=?, updated_at=?
       WHERE server_id=?`,
      [name, url, transport, description ?? '', timeoutMs ?? 30000,
       JSON.stringify({ headers: headers ?? {}, auth: auth ?? null, retryConfig: retryConfig ?? null }),
       enabled !== false ? 1 : 0, now, id]
    );
    return { ok: true };
  });

  // ── Delete ────────────────────────────────────────────────────────────────
  app.delete('/api/mcp/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await store.run(`DELETE FROM mcp_servers WHERE server_id=?`, [id]);
    reply.code(204).send();
  });

  // ── Toggle enabled ────────────────────────────────────────────────────────
  app.patch('/api/mcp/:id/toggle', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT enabled FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const newVal = row.enabled ? 0 : 1;
    await store.run(`UPDATE mcp_servers SET enabled=?, updated_at=? WHERE server_id=?`,
      [newVal, new Date().toISOString(), id]);
    return { enabled: !!newVal };
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.post('/api/mcp/:id/health', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const { ok, latencyMs, error } = await probeServer(row.url, Math.min(row.timeout_ms ?? 30000, 8000));
    const status = ok ? 'healthy' : 'unhealthy';
    const now = new Date().toISOString();
    await store.run(
      `UPDATE mcp_servers SET health_status=?, health_error=?, last_check_at=?, updated_at=? WHERE server_id=?`,
      [status, error ?? null, now, now, id]
    );
    return { status, latencyMs: latencyMs ?? null, error: error ?? null, checkedAt: now };
  });

  // ── Get tools ─────────────────────────────────────────────────────────────
  app.get('/api/mcp/:id/tools', async (req, reply) => {
    const { id } = req.params as { id: string };
    const exists = await store.get<any>(`SELECT 1 FROM mcp_servers WHERE server_id=?`, [id]);
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    const tools = await store.all<any>(`SELECT * FROM mcp_tool_cache WHERE server_id=? ORDER BY tool_name`, [id]);
    return tools.map((t: any) => ({
      name: t.tool_name,
      description: t.description ?? '',
      schema: JSON.parse(t.schema_json ?? 'null'),
      discoveredAt: t.discovered_at,
    }));
  });

  // ── Refresh / re-discover tools ───────────────────────────────────────────
  app.post('/api/mcp/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    let discovered: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
    let discoveryError: string | null = null;
    try {
      const body = await executeMcpRequestWithRetry(row, 'tools/list', {}, Math.min(row.timeout_ms ?? 30_000, 10_000));
      if (Array.isArray((body.result as any)?.tools)) {
        discovered = (body.result as any).tools;
      } else if (body.error?.message) {
        discoveryError = body.error.message;
      } else {
        discoveryError = 'unexpected response shape';
      }
    } catch (e: any) {
      discoveryError = e.message ?? 'unreachable';
    }

    const now = new Date().toISOString();
    await store.run(`DELETE FROM mcp_tool_cache WHERE server_id=?`, [id]);
    for (const tool of discovered) {
      await store.run(
        `INSERT OR REPLACE INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json, discovered_at)
         VALUES(?,?,?,?,?,?)`,
        [randomUUID(), id, tool.name, tool.description ?? '', JSON.stringify(tool.inputSchema ?? null), now]
      );
    }
    await store.run(`UPDATE mcp_servers SET tool_count=?, updated_at=? WHERE server_id=?`,
      [discovered.length, now, id]);
    return { discovered: discovered.length, error: discoveryError,
             tools: discovered.map((t) => ({ name: t.name, description: t.description ?? '' })) };
  });

  // ── Tool call proxy ───────────────────────────────────────────────────────
  const CallBodySchema = z.object({
    serverId: z.string(),
    toolName: z.string(),
    params:   z.record(z.unknown()).optional(),
  });

  app.post('/api/mcp/call', async (req, reply) => {
    const parsed = CallBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const { serverId, toolName, params } = parsed.data;
    const row = await store.get<any>(`SELECT * FROM mcp_servers WHERE server_id=?`, [serverId]);
    if (!row) return reply.code(404).send({ error: 'server_not_found' });
    if (!row.enabled) return reply.code(422).send({ error: 'server_disabled' });

    try {
      const body = await executeMcpRequestWithRetry(
        row,
        'tools/call',
        { name: toolName, arguments: params ?? {} },
        row.timeout_ms ?? 30_000,
      );
      if (body.error) return reply.code(502).send({ error: 'mcp_error', detail: body.error });
      return { ok: true, result: body.result ?? null };
    } catch (e: any) {
      return reply.code(504).send({ error: 'timeout_or_unreachable', detail: e.message });
    }
  });
}
