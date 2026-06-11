/**
 * PlaywrightMcpSidecar — manages the built-in Playwright MCP server.
 *
 * In standalone Node server mode we spawn the official @playwright/mcp CLI.
 * In Electron/portable builds we must not use process.execPath, because it
 * points to the packaged app executable and would recursively relaunch the app.
 * For Electron runtimes we therefore host a compatible Streamable HTTP /mcp
 * endpoint in-process.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { dirname, join } from 'node:path';
import {
  executeEmbeddedPlaywrightTool,
  listEmbeddedPlaywrightTools,
  type EmbeddedPlaywrightController,
} from './EmbeddedPlaywrightTools.js';

const _require = createRequire(import.meta.url);

type PlaywrightMcpConnection = {
  connect(transport: unknown): Promise<void>;
  close?: () => Promise<void> | void;
};

type StreamableHTTPTransport = {
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void>;
  close(): Promise<void>;
};

export interface PlaywrightMcpSidecarHandle {
  mode: 'embedded' | 'external';
  stop(): Promise<void>;
}

export interface StartPlaywrightMcpSidecarOptions {
  embeddedController?: EmbeddedPlaywrightController | null;
}

function getPlaywrightMcpPort(): number {
  const parsed = parseInt(process.env.PLAYWRIGHT_MCP_PORT ?? '8931', 10);
  return Number.isFinite(parsed) ? parsed : 8931;
}

function isElectronRuntime(): boolean {
  return typeof process.versions.electron === 'string' && process.versions.electron.length > 0;
}

/** Check if a TCP port is already accepting connections. */
function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function isInitializeRequest(body: unknown): body is { method: string } {
  return typeof body === 'object' && body !== null && (body as { method?: unknown }).method === 'initialize';
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

/**
 * Resolve the @playwright/mcp CLI entry point for dev / standalone server mode.
 */
function resolveCliPath(): string | null {
  try {
    const pkgJson = _require.resolve('@playwright/mcp/package.json');
    const cli = join(dirname(pkgJson), 'cli.js');
    if (existsSync(cli)) return cli;
  } catch {
    // @playwright/mcp not installed — silently skip
  }

  return null;
}

let _sidecarHandle: PlaywrightMcpSidecarHandle | null = null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type EmbeddedMcpSession = {
  sessionId: string;
  initialized: boolean;
};

function readSessionIdHeader(req: IncomingMessage): string | undefined {
  const header = req.headers['mcp-session-id'];
  return Array.isArray(header) ? header[0] : header;
}

function sendJsonRpcResponse(
  res: ServerResponse,
  payload: Record<string, unknown>,
  sessionId?: string,
  statusCode = 200,
): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  if (sessionId) {
    res.setHeader('mcp-session-id', sessionId);
  }
  res.end(JSON.stringify(payload));
}

function sendPlainText(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(message);
}

function buildJsonRpcErrorPayload(id: JsonRpcRequest['id'], message: string, code = -32000): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

async function startBrowserHostEmbeddedPlaywrightMcpSidecar(
  port: number,
  controller: EmbeddedPlaywrightController,
): Promise<PlaywrightMcpSidecarHandle> {
  const sessions = new Map<string, EmbeddedMcpSession>();

  const httpServer = createServer(async (req, res) => {
    const urlPath = req.url ? new URL(req.url, 'http://127.0.0.1').pathname : '/';
    if (urlPath !== '/mcp') {
      sendPlainText(res, 404, 'Not Found');
      return;
    }
    if (req.method !== 'POST') {
      sendPlainText(res, 405, 'Method Not Allowed');
      return;
    }

    let body: JsonRpcRequest;
    try {
      body = (await readJsonBody(req)) as JsonRpcRequest;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON body';
      sendJsonRpcResponse(res, buildJsonRpcErrorPayload(null, message, -32700));
      return;
    }

    const rpcId = body.id ?? null;
    const method = typeof body.method === 'string' ? body.method : '';
    const params = body.params ?? {};

    if (method === 'initialize') {
      const sessionId = randomUUID();
      sessions.set(sessionId, { sessionId, initialized: false });
      sendJsonRpcResponse(
        res,
        {
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'risk-agent-browser-host', version: '0.1.0' },
          },
        },
        sessionId,
      );
      return;
    }

    const mcpSessionId = readSessionIdHeader(req);
    const session = mcpSessionId ? sessions.get(mcpSessionId) : undefined;
    if (!session) {
      sendPlainText(res, 400, 'Session not found');
      return;
    }

    if (method === 'notifications/initialized') {
      session.initialized = true;
      sendJsonRpcResponse(res, { jsonrpc: '2.0', id: rpcId, result: {} }, session.sessionId);
      return;
    }

    if (method === 'tools/list') {
      sendJsonRpcResponse(
        res,
        {
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            tools: listEmbeddedPlaywrightTools().map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        },
        session.sessionId,
      );
      return;
    }

    if (method === 'tools/call') {
      const toolName = typeof params.name === 'string' ? params.name : '';
      const toolArguments = params.arguments && typeof params.arguments === 'object'
        ? { ...(params.arguments as Record<string, unknown>) }
        : {};
      const embeddedSessionId = typeof toolArguments.__sessionId === 'string'
        ? toolArguments.__sessionId
        : undefined;
      delete toolArguments.__sessionId;

      try {
        const result = await executeEmbeddedPlaywrightTool(controller, {
          toolName,
          arguments: toolArguments,
          sessionId: embeddedSessionId,
        });
        sendJsonRpcResponse(
          res,
          { jsonrpc: '2.0', id: rpcId, result },
          session.sessionId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJsonRpcResponse(
          res,
          buildJsonRpcErrorPayload(rpcId, message),
          session.sessionId,
        );
      }
      return;
    }

    sendJsonRpcResponse(
      res,
      buildJsonRpcErrorPayload(rpcId, `Unsupported MCP method: ${method}`, -32601),
      session.sessionId,
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, '127.0.0.1');
  });

  return {
    mode: 'embedded',
    stop: async () => {
      sessions.clear();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    },
  };
}

async function startOfficialEmbeddedPlaywrightMcpSidecar(port: number): Promise<PlaywrightMcpSidecarHandle> {
  const [{ createConnection }, { StreamableHTTPServerTransport }] = await Promise.all([
    import('@playwright/mcp') as Promise<{ createConnection: (config?: unknown) => Promise<PlaywrightMcpConnection> }>,
    import('@modelcontextprotocol/sdk/server/streamableHttp.js') as Promise<{
      StreamableHTTPServerTransport: new (options?: Record<string, unknown>) => StreamableHTTPTransport;
    }>,
  ]);

  const sessions = new Map<string, { transport: StreamableHTTPTransport; connection: PlaywrightMcpConnection }>();
  const trackedConnections = new Set<PlaywrightMcpConnection>();

  async function closeConnection(connection: PlaywrightMcpConnection): Promise<void> {
    if (!trackedConnections.delete(connection)) {
      return;
    }

    try {
      await connection.close?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[playwright-mcp] Failed to close embedded connection:', message);
    }
  }

  const httpServer = createServer(async (req, res) => {
    const urlPath = req.url ? new URL(req.url, 'http://127.0.0.1').pathname : '/';
    if (urlPath !== '/mcp') {
      res.writeHead(404).end('Not Found');
      return;
    }

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      if (req.method === 'GET') {
        const existing = sessionId ? sessions.get(sessionId) : undefined;
        if (!existing) {
          res.writeHead(400).end('Invalid or missing session ID');
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'DELETE') {
        const existing = sessionId ? sessions.get(sessionId) : undefined;
        if (!existing) {
          res.writeHead(400).end('Invalid or missing session ID');
          return;
        }
        await existing.transport.handleRequest(req, res);
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }

      const parsedBody = await readJsonBody(req);

      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session not found' },
            id: null,
          }));
          return;
        }
        await existing.transport.handleRequest(req, res, parsedBody);
        return;
      }

      if (!isInitializeRequest(parsedBody)) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        }));
        return;
      }

      let connection: PlaywrightMcpConnection | null = null;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (initializedSessionId: string) => {
          if (connection) {
            sessions.set(initializedSessionId, { transport, connection });
          }
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
        if (connection) {
          void closeConnection(connection);
        }
      };

      try {
        connection = await createConnection({
          browser: {
            launchOptions: {
              headless: true,
            },
          },
        });
        trackedConnections.add(connection);
        await connection.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
      } catch (error) {
        if (connection) {
          await closeConnection(connection);
        }
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[playwright-mcp] Embedded sidecar request failed:', message);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(port, '127.0.0.1');
  });

  return {
    mode: 'embedded',
    stop: async () => {
      for (const { transport, connection } of sessions.values()) {
        trackedConnections.add(connection);
        await transport.close().catch(() => undefined);
      }
      sessions.clear();

      for (const connection of [...trackedConnections]) {
        await closeConnection(connection);
      }

      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    },
  };
}

async function startEmbeddedPlaywrightMcpSidecar(
  port: number,
  options?: StartPlaywrightMcpSidecarOptions,
): Promise<PlaywrightMcpSidecarHandle> {
  if (options?.embeddedController) {
    return startBrowserHostEmbeddedPlaywrightMcpSidecar(port, options.embeddedController);
  }

  return startOfficialEmbeddedPlaywrightMcpSidecar(port);
}

async function startExternalPlaywrightMcpSidecar(port: number): Promise<PlaywrightMcpSidecarHandle | null> {
  const cliPath = resolveCliPath();
  if (!cliPath) {
    console.warn('[playwright-mcp] @playwright/mcp not found – sidecar skipped');
    return null;
  }

  const child = spawn(process.execPath, [cliPath, '--port', String(port), '--headless'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout?.on('data', (data: Buffer) => process.stdout.write(`[playwright-mcp] ${data}`));
  child.stderr?.on('data', (data: Buffer) => process.stderr.write(`[playwright-mcp] ${data}`));

  child.once('error', (err) => {
    console.error('[playwright-mcp] Sidecar spawn error:', err.message);
  });

  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.warn(`[playwright-mcp] Sidecar exited with code ${code}`);
    }
    if (_sidecarHandle?.mode === 'external') {
      _sidecarHandle = null;
    }
  });

  for (let i = 0; i < 50; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    if (await isPortListening(port)) {
      console.info(`[playwright-mcp] Sidecar ready on port ${port} (pid=${child.pid})`);
      return {
        mode: 'external',
        stop: async () => {
          if (!child.killed) {
            child.kill();
          }
        },
      };
    }
  }

  console.warn('[playwright-mcp] Sidecar started but port not ready after 10 s');
  return {
    mode: 'external',
    stop: async () => {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

/**
 * Start the Playwright MCP sidecar unless the port is already occupied.
 *
 * - Standalone Node server: spawn the official CLI.
 * - Electron runtime: host a compatible /mcp endpoint in-process.
 */
export async function startPlaywrightMcpSidecar(options?: StartPlaywrightMcpSidecarOptions): Promise<PlaywrightMcpSidecarHandle | null> {
  const port = getPlaywrightMcpPort();
  if (await isPortListening(port)) {
    console.info(`[playwright-mcp] Port ${port} already in use – skipping start`);
    return null;
  }

  const handle = options?.embeddedController
    ? await startEmbeddedPlaywrightMcpSidecar(port, options)
    : isElectronRuntime()
      ? await startEmbeddedPlaywrightMcpSidecar(port, options)
      : await startExternalPlaywrightMcpSidecar(port);

  _sidecarHandle = handle;
  return handle;
}

/** Stop the sidecar if it was started by this module. */
export async function stopPlaywrightMcpSidecar(): Promise<void> {
  const handle = _sidecarHandle;
  _sidecarHandle = null;
  await handle?.stop();
}
