import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const startSidecarMock = vi.fn(async () => null);
const stopSidecarMock = vi.fn(async () => undefined);

vi.mock('../services/PlaywrightMcpSidecar.js', () => ({
  startPlaywrightMcpSidecar: (...args: unknown[]) => startSidecarMock(...args),
  stopPlaywrightMcpSidecar: (...args: unknown[]) => stopSidecarMock(...args),
}));

describe('built-in MCP bootstrap', () => {
  const originalElectronDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'electron');

  beforeEach(() => {
    vi.resetModules();
    startSidecarMock.mockClear();
    stopSidecarMock.mockClear();
    delete process.env.PLAYWRIGHT_MCP_PORT;
  });

  afterEach(() => {
    if (originalElectronDescriptor) {
      Object.defineProperty(process.versions, 'electron', originalElectronDescriptor);
    } else {
      delete (process.versions as Record<string, string | undefined>).electron;
    }
  });

  it('seeds the built-in Playwright MCP server for Electron runtimes on a fresh data dir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-mcp-bootstrap-'));
    Object.defineProperty(process.versions, 'electron', {
      value: '30.0.0',
      configurable: true,
    });

    try {
      const { buildApp } = await import('../index.js');
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const response = await app.inject({ method: 'GET', url: '/api/mcp' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual([
        expect.objectContaining({
          name: 'playwright',
          url: 'http://127.0.0.1:8931/mcp',
          transport: 'http',
          enabled: true,
        }),
      ]);

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('does not seed the built-in Playwright MCP server outside Electron runtimes', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-mcp-bootstrap-'));
    delete (process.versions as Record<string, string | undefined>).electron;

    try {
      const { buildApp } = await import('../index.js');
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      const response = await app.inject({ method: 'GET', url: '/api/mcp' });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual([]);

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);

  it('does not start the Playwright sidecar during buildApp before the server is listening', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-mcp-bootstrap-'));

    try {
      const { buildApp } = await import('../index.js');
      const { app } = await buildApp({ dataDir: tmp, port: 0 });

      expect(startSidecarMock).not.toHaveBeenCalled();

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  }, 30_000);
});