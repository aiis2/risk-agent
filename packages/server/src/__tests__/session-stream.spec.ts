import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../index.js';

describe('session MVP flow', () => {
  it('creates session, runs orchestrator, emits events, persists report', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-flow-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      // seed scenario + rule
      await app.inject({ method: 'POST', url: '/api/scenarios', payload: { name: '快捷支付', domain: 'payment', status: 'active' } });
      await app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: { ruleName: 'limit_single', bizType: 'payment', ruleType: 'limit', riskLevel: 'high' }
      });
      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: '快捷支付', locale: 'zh-CN' }
      });
      expect(start.statusCode).toBe(201);
      const sessionId = JSON.parse(start.body).sessionId;
      const handle = ctx.runner.getHandle(sessionId);
      if (handle) {
        await handle.done;
      }
      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);
      const detailBody = JSON.parse(detail.body);
      const eventTypes = detailBody.events.map((e: any) => e.type);
      expect(eventTypes).toContain('research_complete');
      const reports = await app.inject({ method: 'GET', url: '/api/reports' });
      expect(JSON.parse(reports.body).length).toBeGreaterThan(0);
      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('registers default tools and persists real tool events for scripted mock sessions', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-flow-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-tool-session',
          isDefault: true,
          config: {
            scripts: [
              {
                toolCalls: [
                  {
                    name: 'query_database',
                    input: {
                      sql: 'SELECT session_id, business_name FROM sessions LIMIT 1',
                    },
                  },
                ],
              },
              {
                text: '工具调用完成，已生成摘要。',
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'Tool Event Session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId;
      const handle = ctx.runner.getHandle(sessionId);
      if (handle) {
        await handle.done;
      }

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);

      const body = JSON.parse(detail.body);
      const systemInit = body.events.find((event: any) => event.type === 'system_init');
      expect(Array.isArray(systemInit?.payload?.tools)).toBe(true);
      expect(systemInit.payload.tools.length).toBeGreaterThan(0);
      expect(systemInit.payload.tools.some((tool: any) => tool.name === 'query_database')).toBe(true);

      const eventTypes = body.events.map((event: any) => event.type);
      expect(eventTypes).toContain('tool_start');
      expect(eventTypes).toContain('tool_complete');

      const toolStart = body.events.find((event: any) => event.type === 'tool_start');
      const toolComplete = body.events.find((event: any) => event.type === 'tool_complete');
      expect(toolStart?.payload?.toolName).toBe('query_database');
      expect(toolComplete?.payload?.toolUseId).toBe(toolStart?.payload?.toolUseId);
      expect(eventTypes).not.toContain('tool_error');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('propagates sandbox metadata and audit records through chat session tool execution', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-flow-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-sandbox-session',
          isDefault: true,
          config: {
            scripts: [
              {
                toolCalls: [
                  {
                    name: 'run_js_sandbox',
                    input: {
                      code: 'return 21 * 2;',
                    },
                  },
                ],
              },
              {
                text: 'sandbox done',
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'Sandbox Chat Session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId;
      const handle = ctx.runner.getHandle(sessionId);
      if (handle) {
        await handle.done;
      }

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);

      const body = JSON.parse(detail.body);
      const toolStart = body.events.find((event: any) => event.type === 'tool_start');
      expect(toolStart?.payload?.toolName).toBe('run_js_sandbox');
      expect(toolStart?.payload?.sandbox).toMatchObject({
        profile: 'shared-js-runtime',
        hostKind: 'js-vm',
        entrypoint: 'chat',
      });

      const auditEvents = await ctx.storage.getStructuredStore().all<{ event_type: string }>(
        `SELECT event_type FROM security_audit_events ORDER BY timestamp ASC`,
      );
      const eventTypes = auditEvents.map((event) => event.event_type);
      expect(eventTypes).toContain('sandbox-lease-created');
      expect(eventTypes).toContain('sandbox-lease-complete');

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('loads enabled MCP tools into the session runtime and executes them', async () => {
    const mcpRequests: Array<{ method?: string; toolName?: string; accept?: string; sessionId?: string }> = [];
    let sessionId = 'session-1';
    let initialized = false;
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) as { method?: string; params?: { name?: string } } : {};
      const accept = typeof req.headers.accept === 'string' ? req.headers.accept : '';
      const requestSessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
      mcpRequests.push({ method: body.method, toolName: body.params?.name, accept, sessionId: requestSessionId });

      if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
        res.writeHead(406, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'Not Acceptable: missing MCP accept headers' },
        }));
        return;
      }

      if (body.method === 'initialize') {
        initialized = false;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': sessionId });
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'Playwright', version: 'test' },
          },
        })}\n\n`);
        return;
      }

      if (body.method === 'notifications/initialized') {
        initialized = requestSessionId === sessionId;
        res.writeHead(202, { 'content-type': 'application/json', 'mcp-session-id': sessionId });
        res.end('');
        return;
      }

      if (!initialized || requestSessionId !== sessionId) {
        res.writeHead(400, { 'content-type': 'application/json', 'mcp-session-id': sessionId });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': sessionId });
      if (body.method === 'tools/call') {
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'captured risk page snapshot' },
            ],
          },
        })}\n\n`);
        return;
      }

      res.end(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'browser_snapshot',
              description: 'Capture an accessibility snapshot of the current page',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      })}\n\n`);
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-flow-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      const store = ctx.storage.getStructuredStore();

      await store.run(
        `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, tool_count)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          'mcp-playwright',
          'playwright',
          `http://127.0.0.1:${address.port}/rpc`,
          'http',
          'Playwright MCP',
          5000,
          JSON.stringify({ headers: {} }),
          1,
          'healthy',
          1,
        ],
      );

      await store.run(
        `INSERT INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json)
         VALUES(?,?,?,?,?)`,
        [
          'mcp-tool-browser-snapshot',
          'mcp-playwright',
          'browser_snapshot',
          'Capture an accessibility snapshot of the current page',
          JSON.stringify({ type: 'object', properties: {} }),
        ],
      );

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-mcp-session',
          isDefault: true,
          config: {
            scripts: [
              {
                toolCalls: [
                  {
                    name: 'mcp.playwright.browser_snapshot',
                    input: {},
                  },
                ],
              },
              {
                text: 'MCP tool call completed.',
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'MCP Runtime Session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId;
      const handle = ctx.runner.getHandle(sessionId);
      if (handle) {
        await handle.done;
      }

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);

      const body = JSON.parse(detail.body);
      const systemInit = body.events.find((event: any) => event.type === 'system_init');
      expect(systemInit?.payload?.tools.some((tool: any) => tool.name === 'mcp.playwright.browser_snapshot')).toBe(true);

      const toolStart = body.events.find((event: any) => event.type === 'tool_start');
      const toolComplete = body.events.find((event: any) => event.type === 'tool_complete');
      expect(toolStart?.payload?.toolName).toBe('mcp.playwright.browser_snapshot');
      expect(toolComplete?.payload?.result).toEqual({
        content: [
          { type: 'text', text: 'captured risk page snapshot' },
        ],
      });
      expect(body.events.map((event: any) => event.type)).not.toContain('tool_error');
      expect(mcpRequests.every((request) => request.accept?.includes('application/json') && request.accept?.includes('text/event-stream'))).toBe(true);
      expect(mcpRequests.some((request) => request.method === 'initialize')).toBe(true);
      expect(mcpRequests.some((request) => request.method === 'notifications/initialized')).toBe(true);
      expect(mcpRequests.some((request) => request.method === 'tools/call' && request.toolName === 'browser_snapshot')).toBe(true);

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('reinitializes the MCP session once when tools/call returns Session not found', async () => {
    const mcpRequests: Array<{ method?: string; toolName?: string; sessionId?: string }> = [];
    let sessionCounter = 0;
    const initializedSessions = new Set<string>();
    let firstToolCallFailed = false;

    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) as { method?: string; params?: { name?: string } } : {};
      const requestSessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
      mcpRequests.push({ method: body.method, toolName: body.params?.name, sessionId: requestSessionId });

      if (body.method === 'initialize') {
        const sessionId = `session-${++sessionCounter}`;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': sessionId });
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: sessionCounter,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'Playwright', version: 'test' },
          },
        })}\n\n`);
        return;
      }

      if (body.method === 'notifications/initialized') {
        if (requestSessionId) {
          initializedSessions.add(requestSessionId);
        }
        res.writeHead(202, { 'content-type': 'application/json', ...(requestSessionId ? { 'mcp-session-id': requestSessionId } : {}) });
        res.end('');
        return;
      }

      if (!requestSessionId || !initializedSessions.has(requestSessionId)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
        }));
        return;
      }

      if (body.method === 'tools/call' && !firstToolCallFailed) {
        firstToolCallFailed = true;
        initializedSessions.delete(requestSessionId);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32001, message: 'Session not found' },
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': requestSessionId });
      if (body.method === 'tools/call') {
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'captured risk page snapshot after reinit' },
            ],
          },
        })}\n\n`);
        return;
      }

      res.end(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'search_docs',
              description: 'Search the docs knowledge base',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      })}\n\n`);
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-flow-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      const store = ctx.storage.getStructuredStore();

      await store.run(
        `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, tool_count)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          'mcp-playwright-retry',
          'knowledge',
          `http://127.0.0.1:${address.port}/rpc`,
          'http',
          'Knowledge MCP',
          5000,
          JSON.stringify({ headers: {} }),
          1,
          'healthy',
          1,
        ],
      );

      await store.run(
        `INSERT INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json)
         VALUES(?,?,?,?,?)`,
        [
          'mcp-tool-browser-snapshot-retry',
          'mcp-playwright-retry',
          'search_docs',
          'Search the docs knowledge base',
          JSON.stringify({ type: 'object', properties: {} }),
        ],
      );

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-mcp-retry-session',
          isDefault: true,
          config: {
            scripts: [
              {
                toolCalls: [
                  {
                    name: 'mcp.knowledge.search_docs',
                    input: {},
                  },
                ],
              },
              {
                text: 'MCP tool call completed after reinitialization.',
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'MCP Retry Session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId;
      const handle = ctx.runner.getHandle(sessionId);
      if (handle) {
        await handle.done;
      }

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);

      const body = JSON.parse(detail.body);
      const toolComplete = body.events.find((event: any) => event.type === 'tool_complete');
      expect(toolComplete?.payload?.result).toEqual({
        content: [
          { type: 'text', text: 'captured risk page snapshot after reinit' },
        ],
      });
      expect(body.events.map((event: any) => event.type)).not.toContain('tool_error');

      const initializeCalls = mcpRequests.filter((request) => request.method === 'initialize');
      expect(initializeCalls).toHaveLength(2);
      expect(mcpRequests.filter((request) => request.method === 'notifications/initialized')).toHaveLength(2);

      const toolCalls = mcpRequests.filter((request) => request.method === 'tools/call' && request.toolName === 'search_docs');
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]?.sessionId).toBe('session-1');
      expect(toolCalls[1]?.sessionId).toBe('session-2');

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('surfaces a tool error instead of silently retrying stateful Playwright tools after session loss', async () => {
    const mcpRequests: Array<{ method?: string; toolName?: string; sessionId?: string }> = [];
    let sessionCounter = 0;
    const initializedSessions = new Set<string>();
    let snapshotFailed = false;

    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) as { method?: string; params?: { name?: string } } : {};
      const requestSessionId = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
      mcpRequests.push({ method: body.method, toolName: body.params?.name, sessionId: requestSessionId });

      if (body.method === 'initialize') {
        const sessionId = `session-${++sessionCounter}`;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': sessionId });
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: sessionCounter,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'Playwright', version: 'test' },
          },
        })}\n\n`);
        return;
      }

      if (body.method === 'notifications/initialized') {
        if (requestSessionId) {
          initializedSessions.add(requestSessionId);
        }
        res.writeHead(202, { 'content-type': 'application/json', ...(requestSessionId ? { 'mcp-session-id': requestSessionId } : {}) });
        res.end('');
        return;
      }

      if (!requestSessionId || !initializedSessions.has(requestSessionId)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
        }));
        return;
      }

      if (body.method === 'tools/call' && body.params?.name === 'browser_snapshot' && !snapshotFailed) {
        snapshotFailed = true;
        initializedSessions.delete(requestSessionId);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32001, message: 'Session not found' },
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': requestSessionId });
      if (body.method === 'tools/call' && body.params?.name === 'browser_navigate') {
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'navigated to https://example.com' },
            ],
          },
        })}\n\n`);
        return;
      }

      if (body.method === 'tools/call' && body.params?.name === 'browser_snapshot') {
        res.end(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'about:blank snapshot should never be returned after session reset' },
            ],
          },
        })}\n\n`);
        return;
      }

      res.end(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'browser_navigate',
              description: 'Navigate to a URL',
              inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
            },
            {
              name: 'browser_snapshot',
              description: 'Capture an accessibility snapshot of the current page',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      })}\n\n`);
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('expected tcp address');

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-flow-'));
    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      const store = ctx.storage.getStructuredStore();

      await store.run(
        `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, tool_count)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [
          'mcp-playwright-stateful-retry',
          'playwright',
          `http://127.0.0.1:${address.port}/rpc`,
          'http',
          'Playwright MCP',
          5000,
          JSON.stringify({ headers: {} }),
          1,
          'healthy',
          2,
        ],
      );

      await store.run(
        `INSERT INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json)
         VALUES(?,?,?,?,?)`,
        [
          'mcp-tool-browser-navigate-stateful-retry',
          'mcp-playwright-stateful-retry',
          'browser_navigate',
          'Navigate to a URL',
          JSON.stringify({ type: 'object', properties: { url: { type: 'string' } } }),
        ],
      );
      await store.run(
        `INSERT INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json)
         VALUES(?,?,?,?,?)`,
        [
          'mcp-tool-browser-snapshot-stateful-retry',
          'mcp-playwright-stateful-retry',
          'browser_snapshot',
          'Capture an accessibility snapshot of the current page',
          JSON.stringify({ type: 'object', properties: {} }),
        ],
      );

      const model = await app.inject({
        method: 'POST',
        url: '/api/models',
        payload: {
          provider: 'mock',
          modelName: 'mock-mcp-stateful-retry-session',
          isDefault: true,
          config: {
            scripts: [
              {
                toolCalls: [
                  {
                    name: 'mcp.playwright.browser_navigate',
                    input: { url: 'https://example.com' },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    name: 'mcp.playwright.browser_snapshot',
                    input: {},
                  },
                ],
              },
              {
                text: 'Tool failure was surfaced to the session.',
                stopReason: 'end_turn',
              },
            ],
          },
        },
      });
      expect(model.statusCode).toBe(201);

      const start = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: { businessName: 'MCP Stateful Retry Session', locale: 'zh-CN' },
      });
      expect(start.statusCode).toBe(201);

      const sessionId = JSON.parse(start.body).sessionId;
      const handle = ctx.runner.getHandle(sessionId);
      if (handle) {
        await handle.done;
      }

      const detail = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` });
      expect(detail.statusCode).toBe(200);

      const body = JSON.parse(detail.body);
      const toolError = body.events.find((event: any) => event.type === 'tool_error');
      expect(toolError?.payload?.error).toContain('browser state was lost');

      const snapshotCalls = mcpRequests.filter((request) => request.method === 'tools/call' && request.toolName === 'browser_snapshot');
      expect(snapshotCalls).toHaveLength(1);
      expect(mcpRequests.filter((request) => request.method === 'initialize')).toHaveLength(1);
      expect(body.events.map((event: any) => event.type)).toContain('tool_error');

      await app.close();
    } finally {
      upstream.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);
});
