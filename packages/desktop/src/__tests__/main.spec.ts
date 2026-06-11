import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AppEventHandler = (...args: unknown[]) => unknown;

const appHandlers = new Map<string, AppEventHandler>();
const browserHostServiceInstances: BrowserHostServiceMock[] = [];
const browserSessionCookieStoreInstances: BrowserSessionCookieStoreMock[] = [];

const initDataDirectoryMock = vi.fn(async () => undefined);
const shutdownEmbeddedServerMock = vi.fn(async () => undefined);
const startEmbeddedServerMock = vi.fn(async () => ({
  port: 61087,
  dataDir: 'D:/risk-agent-data',
}));
const browserSessionFlushStorageDataMock = vi.fn(async () => undefined);
const cookiesMock = {
  flushStore: vi.fn(async () => undefined),
};

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferredPromise<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

async function waitForAssertion(assertion: () => void, attempts = 20) {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushAsyncWork();
    }
  }

  throw lastError;
}

const appMock = {
  getPath: vi.fn((name: string) => {
    if (name === 'userData') {
      return 'C:/Users/test/AppData/Roaming/@risk-agent/desktop';
    }

    return 'C:/Users/test/AppData/Roaming';
  }),
  getVersion: vi.fn(() => '0.1.0'),
  isPackaged: false,
  on: vi.fn((event: string, handler: AppEventHandler) => {
    appHandlers.set(event, handler);
  }),
  quit: vi.fn(),
  setAppUserModelId: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
};

const browserWindowMock = {
  loadURL: vi.fn(async () => undefined),
  on: vi.fn(),
  webContents: {
    session: {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    },
  },
};

const BrowserWindowMock = vi.fn(() => browserWindowMock);
const dialogMock = {
  showOpenDialog: vi.fn(),
};
const ipcMainHandleMock = vi.fn();
const ipcMainOnMock = vi.fn();
const menuSetApplicationMenuMock = vi.fn();
const sessionFromPartitionMock = vi.fn(() => ({
  cookies: cookiesMock,
  flushStorageData: browserSessionFlushStorageDataMock,
}));

class BrowserHostServiceMock {
  focusWindow = vi.fn(async () => undefined);
  dispose = vi.fn();
  registerMainWindow = vi.fn();
  setMainWindowBrowserBounds = vi.fn(async () => undefined);
  setServerOrigin = vi.fn();

  constructor(_preloadPath: string) {
    browserHostServiceInstances.push(this);
  }
}

class BrowserSessionCookieStoreMock {
  flush = vi.fn(async () => undefined);
  initialize = vi.fn(async () => undefined);
  options: { cookies: typeof cookiesMock; storageFilePath: string; logger?: (message: string) => void };

  constructor(options: { cookies: typeof cookiesMock; storageFilePath: string; logger?: (message: string) => void }) {
    this.options = options;
    browserSessionCookieStoreInstances.push(this);
  }
}

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: {
    handle: ipcMainHandleMock,
    on: ipcMainOnMock,
  },
  Menu: {
    setApplicationMenu: menuSetApplicationMenuMock,
  },
  session: {
    fromPartition: sessionFromPartitionMock,
  },
}));

vi.mock('../backend', () => ({
  initDataDirectory: initDataDirectoryMock,
  shutdownEmbeddedServer: shutdownEmbeddedServerMock,
  startEmbeddedServer: startEmbeddedServerMock,
}));

vi.mock('../browserHost/BrowserHostService', () => ({
  BrowserHostService: BrowserHostServiceMock,
}));

vi.mock('../browserHost/BrowserSessionCookieStore', () => ({
  BrowserSessionCookieStore: BrowserSessionCookieStoreMock,
}));

vi.mock('../browserHost/sharedBrowserSession', () => ({
  SHARED_BROWSER_PARTITION: 'persist:risk-agent-browser-profile',
}));

describe('desktop main lifecycle', () => {
  beforeEach(() => {
    appHandlers.clear();
    browserHostServiceInstances.length = 0;
    browserSessionCookieStoreInstances.length = 0;
    vi.clearAllMocks();
    delete process.env.RISK_AGENT_WEB_URL;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('creates the shared browser session cookie store inside userData before opening the window', async () => {
    await import('../main.js');
    await flushAsyncWork();

    expect(sessionFromPartitionMock).toHaveBeenCalledWith('persist:risk-agent-browser-profile');
    expect(browserSessionCookieStoreInstances).toHaveLength(1);
    expect(browserSessionCookieStoreInstances[0]?.options.storageFilePath).toBe(
      'C:\\Users\\test\\AppData\\Roaming\\@risk-agent\\desktop\\browser-host\\session-cookies.json',
    );
    expect(browserSessionCookieStoreInstances[0]?.initialize).toHaveBeenCalledOnce();
    expect(startEmbeddedServerMock).toHaveBeenCalledOnce();
    expect(BrowserWindowMock).toHaveBeenCalledOnce();
  });

  it('shows a local loading shell before the embedded server finishes booting', async () => {
    const deferredServerStartup = createDeferredPromise<{ port: number; dataDir: string }>();
    startEmbeddedServerMock.mockImplementationOnce(() => deferredServerStartup.promise);

    await import('../main.js');
    await flushAsyncWork();

    expect(BrowserWindowMock).toHaveBeenCalledOnce();
    expect(browserWindowMock.loadURL).toHaveBeenCalledWith(expect.stringContaining('data:text/html'));

    deferredServerStartup.resolve({
      port: 61087,
      dataDir: 'D:/risk-agent-data',
    });

    await waitForAssertion(() => {
      expect(browserWindowMock.loadURL).toHaveBeenLastCalledWith('http://127.0.0.1:61087/');
    });
  });

  it('flushes the shared browser session storage when all windows close', async () => {
    await import('../main.js');
    await flushAsyncWork();

    const windowAllClosedHandler = appHandlers.get('window-all-closed');

    expect(windowAllClosedHandler).toBeTypeOf('function');

    await windowAllClosedHandler?.();

    expect(browserHostServiceInstances[0]?.dispose).toHaveBeenCalledOnce();
    expect(browserSessionFlushStorageDataMock).toHaveBeenCalledOnce();
    expect(browserSessionCookieStoreInstances[0]?.flush).toHaveBeenCalledOnce();
    expect(shutdownEmbeddedServerMock).toHaveBeenCalledOnce();
    expect(appMock.quit).toHaveBeenCalledOnce();
  });
});