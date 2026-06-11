import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageBackendRegistry } from '@risk-agent/core';
import { BrowserWorkspaceService } from '../../browser/BrowserWorkspaceService.js';
import { startPlaywrightMcpSidecar, stopPlaywrightMcpSidecar } from '../PlaywrightMcpSidecar.js';

describe('PlaywrightMcpSidecar', () => {
  const cleanupPaths: string[] = [];
  const originalPort = process.env.PLAYWRIGHT_MCP_PORT;

  afterEach(async () => {
    await stopPlaywrightMcpSidecar();
    process.env.PLAYWRIGHT_MCP_PORT = originalPort;
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (!path) continue;
      try { rmSync(path, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('serves the embedded browser-host-backed tool manifest and executes browser_tabs_new over HTTP', async () => {
    process.env.PLAYWRIGHT_MCP_PORT = '8957';

    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-playwright-mcp-'));
    cleanupPaths.push(tmp);
    const storage = await StorageBackendRegistry.bootstrap(tmp);
    const store = storage.getStructuredStore();
    const browserWorkspaces = new BrowserWorkspaceService(store);
    await browserWorkspaces.ensureSchema();

    const createTabSpy = vi.fn(async (tabId: string, url: string, workspaceId: string) => ({
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: 'HTTP Browser Host Tab',
      currentUrl: url,
      status: 'ready',
      canGoBack: false,
      canGoForward: false,
    }));

    await startPlaywrightMcpSidecar({
      embeddedController: {
        browserWorkspaces,
        browserHostAdapter: {
          isAvailable: () => true,
          createTab: createTabSpy,
        },
        preferenceStore: store,
      },
    });

    const initializeResponse = await fetch('http://127.0.0.1:8957/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.1.0' },
        },
      }),
    });
    expect(initializeResponse.status).toBe(200);
    const mcpSessionId = initializeResponse.headers.get('mcp-session-id');
    expect(mcpSessionId).toBeTruthy();

    const initializedResponse = await fetch('http://127.0.0.1:8957/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': mcpSessionId ?? '',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
    expect(initializedResponse.status).toBe(200);

    const toolsListResponse = await fetch('http://127.0.0.1:8957/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': mcpSessionId ?? '',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list', params: {} }),
    });
    expect(toolsListResponse.status).toBe(200);
    const toolsListBody = await toolsListResponse.json() as { result?: { tools?: Array<{ name: string }> } };
    expect(toolsListBody.result?.tools?.some((tool) => tool.name === 'browser_tabs_new')).toBe(true);

    const toolsCallResponse = await fetch('http://127.0.0.1:8957/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': mcpSessionId ?? '',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call',
        method: 'tools/call',
        params: {
          name: 'browser_tabs_new',
          arguments: {
            url: 'https://example.com/http-mcp',
            __sessionId: 'session-http-mcp',
          },
        },
      }),
    });
    expect(toolsCallResponse.status).toBe(200);
    const toolsCallBody = await toolsCallResponse.json() as { result?: { workspace?: { ownerSessionId?: string }; tab?: { currentUrl?: string; title?: string } } };
    expect(toolsCallBody.result).toMatchObject({
      workspace: { ownerSessionId: 'session-http-mcp' },
      tab: {
        currentUrl: 'https://example.com/http-mcp',
        title: 'HTTP Browser Host Tab',
      },
    });
    expect(createTabSpy).toHaveBeenCalledOnce();

    await storage.close();
  }, 30_000);
});import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const createConnectionMock = vi.fn(async () => ({
  connect: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}));

const connectAttemptState = { count: 0 };

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('@playwright/mcp', () => ({
  createConnection: (...args: unknown[]) => createConnectionMock(...args),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    sessionId: string | undefined;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    async handleRequest(): Promise<void> {}
    async close(): Promise<void> {
      this.onclose?.();
    }
  },
}));

vi.mock('node:net', () => {
  return {
    default: {
      createConnection: () => {
        const handlers = new Map<string, () => void>();
        const attempt = ++connectAttemptState.count;
        const socket = {
          setTimeout: vi.fn(),
          once(event: string, cb: () => void) {
            handlers.set(event, cb);
            return socket;
          },
          destroy: vi.fn(),
        };

        queueMicrotask(() => {
          if (attempt === 1) {
            handlers.get('error')?.();
            return;
          }
          handlers.get('connect')?.();
        });

        return socket;
      },
    },
  };
});

function createChildProcessStub() {
  const handlers = new Map<string, (value?: unknown) => void>();
  const child = {
    pid: 43210,
    killed: false,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    once: vi.fn((event: string, cb: (value?: unknown) => void) => {
      handlers.set(event, cb);
      return child;
    }),
    kill: vi.fn(() => {
      child.killed = true;
      handlers.get('exit')?.(0);
      return true;
    }),
  };

  return child;
}

describe('PlaywrightMcpSidecar', () => {
  const originalElectronDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'electron');

  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => createChildProcessStub());
    createConnectionMock.mockClear();
    connectAttemptState.count = 0;
    process.env.PLAYWRIGHT_MCP_PORT = '39931';
    Object.defineProperty(process.versions, 'electron', {
      value: '30.0.0',
      configurable: true,
    });
  });

  afterEach(async () => {
    delete process.env.PLAYWRIGHT_MCP_PORT;
    if (originalElectronDescriptor) {
      Object.defineProperty(process.versions, 'electron', originalElectronDescriptor);
    } else {
      delete (process.versions as Record<string, string | undefined>).electron;
    }

    const sidecar = await import('../PlaywrightMcpSidecar.js');
    await sidecar.stopPlaywrightMcpSidecar();
  });

  it('uses an embedded HTTP sidecar instead of respawning the packaged executable under Electron', async () => {
    const sidecar = await import('../PlaywrightMcpSidecar.js');

    const handle = await sidecar.startPlaywrightMcpSidecar();

    expect(handle).toMatchObject({ mode: 'embedded' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('serves the embedded /mcp endpoint with non-fatal probe and JSON-RPC error responses', async () => {
    const sidecar = await import('../PlaywrightMcpSidecar.js');

    await sidecar.startPlaywrightMcpSidecar();

    const probeResponse = await fetch('http://127.0.0.1:39931/mcp');
    expect(probeResponse.status).toBe(400);

    const invalidRpcResponse = await fetch('http://127.0.0.1:39931/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(invalidRpcResponse.status).toBe(400);
    expect(invalidRpcResponse.headers.get('content-type')).toContain('application/json');
    expect(await invalidRpcResponse.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { message: 'Bad Request: No valid session ID provided' },
    });

    const missingSessionResponse = await fetch('http://127.0.0.1:39931/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'missing-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });

    expect(missingSessionResponse.status).toBe(400);
    expect(await missingSessionResponse.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { message: 'Session not found' },
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('keeps using the external CLI sidecar outside Electron', async () => {
    delete (process.versions as Record<string, string | undefined>).electron;

    const sidecar = await import('../PlaywrightMcpSidecar.js');
    const handle = await sidecar.startPlaywrightMcpSidecar();

    expect(handle).toMatchObject({ mode: 'external' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});