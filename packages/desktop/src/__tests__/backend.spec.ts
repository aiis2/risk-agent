import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const getPathMock = vi.fn(() => 'C:/Users/test/AppData/Roaming/RiskAgent');
const listenMock = vi.fn(async () => undefined);
const closeMock = vi.fn(async () => undefined);
const startBackgroundServicesMock = vi.fn(async () => undefined);
const buildAppMock = vi.fn(async () => ({
  app: {
    listen: listenMock,
    close: closeMock,
    server: {
      address: () => ({ port: 4567 }),
    },
  },
  ctx: {} as never,
  startBackgroundServices: startBackgroundServicesMock,
}));

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
}));

describe('startEmbeddedServer', () => {
  beforeEach(() => {
    vi.resetModules();
    listenMock.mockClear();
    closeMock.mockClear();
    startBackgroundServicesMock.mockClear();
    buildAppMock.mockClear();
    delete process.env.RISK_AGENT_DATA_DIR;
  });

  afterEach(async () => {
    const backend = await import('../backend');
    backend.__setServerModuleLoaderForTests();
    await backend.shutdownEmbeddedServer();
  });

  it('waits for background services before resolving the embedded server port', async () => {
    let releaseBackgroundServices: (() => void) | undefined;
    startBackgroundServicesMock.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        releaseBackgroundServices = () => resolve(undefined);
      }),
    );

    const backend = await import('../backend');
    backend.__setServerModuleLoaderForTests(async () => ({
      buildApp: () => buildAppMock(),
    }));

    const pending = backend.startEmbeddedServer();
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });

    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalledOnce();
      expect(startBackgroundServicesMock).toHaveBeenCalledOnce();
    });
    expect(resolved).toBe(false);

    releaseBackgroundServices?.();

    await expect(pending).resolves.toMatchObject({
      port: 4567,
      dataDir: join('C:/Users/test/AppData/Roaming/RiskAgent', 'risk_agent_data'),
    });
  });
});