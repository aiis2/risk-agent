import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BrowserWindowEventHandler = (...args: unknown[]) => void;

type BrowserWindowMock = {
  contentView: {
    addChildView: any;
    removeChildView: any;
  };
  webContents: {
    on: any;
    setWindowOpenHandler: any;
  };
  close: any;
  focus: any;
  getContentBounds: any;
  getTitle: any;
  isAlwaysOnTop: any;
  isDestroyed: any;
  isFocused: any;
  isMinimized: any;
  isVisible: any;
  loadURL: any;
  moveTop: any;
  on: any;
  restore: any;
  setAlwaysOnTop: any;
  setTitle: any;
  show: any;
  __windowHandlers: Map<string, BrowserWindowEventHandler>;
  __webContentsHandlers: Map<string, BrowserWindowEventHandler>;
};

type WebContentsViewMock = {
  setBounds: any;
  webContents: {
    canGoBack: any;
    canGoForward: any;
    capturePage: any;
    close: any;
    executeJavaScript: any;
    focus: any;
    getTitle: any;
    getURL: any;
    isLoading: any;
    loadURL: any;
    on: any;
    reload: any;
  };
  __options: {
    webPreferences?: {
      partition?: string;
    };
  };
};

type MainWindowHostServiceMethods = {
  registerMainWindow(window: BrowserWindowMock): void;
  setMainWindowBrowserBounds(bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>;
};

const browserWindows: BrowserWindowMock[] = [];
const webContentsViews: WebContentsViewMock[] = [];
const appFocusMock = vi.fn();
const execFileMock = vi.fn((_: string, __: string[], callback?: (error: Error | null) => void) => {
  callback?.(null);
});
const shellOpenExternalMock = vi.fn();

function createBrowserWindowMock(): BrowserWindowMock {
  const windowHandlers = new Map<string, BrowserWindowEventHandler>();
  const webContentsHandlers = new Map<string, BrowserWindowEventHandler>();
  const browserWindow: BrowserWindowMock = {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    webContents: {
      on: vi.fn((event: string, handler: BrowserWindowEventHandler) => {
        webContentsHandlers.set(event, handler);
      }),
      setWindowOpenHandler: vi.fn(),
    },
    close: vi.fn(),
    focus: vi.fn(),
    getContentBounds: vi.fn(() => ({ width: 1480, height: 920 })),
    getTitle: vi.fn(() => 'Risk Agent Browser Host'),
    isAlwaysOnTop: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(async () => undefined),
    moveTop: vi.fn(),
    on: vi.fn((event: string, handler: BrowserWindowEventHandler) => {
      windowHandlers.set(event, handler);
      return browserWindow;
    }),
    restore: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setTitle: vi.fn(),
    show: vi.fn(),
    __windowHandlers: windowHandlers,
    __webContentsHandlers: webContentsHandlers,
  };

  return browserWindow;
}

function createWebContentsViewMock(options: { webPreferences?: { partition?: string } }): WebContentsViewMock {
  return {
    setBounds: vi.fn(),
    webContents: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      capturePage: vi.fn(),
      close: vi.fn(),
      executeJavaScript: vi.fn(),
      focus: vi.fn(),
      getTitle: vi.fn(() => 'Embedded Tab'),
      getURL: vi.fn(() => 'https://example.com'),
      isLoading: vi.fn(() => false),
      loadURL: vi.fn(async () => undefined),
      on: vi.fn(),
      reload: vi.fn(),
    },
    __options: options,
  };
}

const BrowserWindowCtor = vi.fn((): BrowserWindowMock => {
  const browserWindow = createBrowserWindowMock();
  browserWindows.push(browserWindow);
  return browserWindow;
});
(BrowserWindowCtor as typeof BrowserWindowCtor & { getAllWindows: () => BrowserWindowMock[] }).getAllWindows = vi.fn(() => browserWindows);

const WebContentsViewCtor = vi.fn((options: { webPreferences?: { partition?: string } }): WebContentsViewMock => {
  const view = createWebContentsViewMock(options);
  webContentsViews.push(view);
  return view;
});

vi.mock('electron', () => ({
  app: {
    focus: (...args: unknown[]) => appFocusMock(...args),
  },
  BrowserWindow: BrowserWindowCtor,
  WebContentsView: WebContentsViewCtor,
  shell: {
    openExternal: (...args: unknown[]) => shellOpenExternalMock(...args),
  },
}));

vi.mock('node:child_process', () => ({
  execFile: (...args: [string, string[], ((error: Error | null) => void)?]) => execFileMock(...args),
}));

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const originalBrowserHostDebugEnv = process.env.RISK_AGENT_BROWSER_HOST_DEBUG;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('BrowserHostService', () => {
  beforeEach(() => {
    browserWindows.length = 0;
    webContentsViews.length = 0;
    appFocusMock.mockReset();
    execFileMock.mockClear();
    shellOpenExternalMock.mockReset();
    BrowserWindowCtor.mockClear();
    WebContentsViewCtor.mockClear();
    delete process.env.RISK_AGENT_BROWSER_HOST_DEBUG;
  });

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    }
    process.stderr.write = originalStderrWrite;
    if (originalBrowserHostDebugEnv === undefined) {
      delete process.env.RISK_AGENT_BROWSER_HOST_DEBUG;
    } else {
      process.env.RISK_AGENT_BROWSER_HOST_DEBUG = originalBrowserHostDebugEnv;
    }
    vi.restoreAllMocks();
  });

  it('keeps the Browser Host window title distinct after page title updates', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    await service.ensureWindow();

    const hostWindow = browserWindows[0];
    expect(hostWindow).toBeTruthy();

    const titleHandler = hostWindow.__webContentsHandlers.get('page-title-updated');
    expect(titleHandler).toBeTypeOf('function');

    const event = { preventDefault: vi.fn() };
    titleHandler?.(event, 'Risk Agent');

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(hostWindow.setTitle).toHaveBeenCalledWith('Risk Agent Browser Host');
  });

  it('uses stronger foreground recovery without surfacing the main window on Windows', async () => {
    setPlatform('win32');
    const stderrWriteSpy = vi.fn(() => true);
    process.stderr.write = stderrWriteSpy as typeof process.stderr.write;

    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    mainWindow.getTitle.mockReturnValue('Main Workspace');
    mainWindow.isMinimized.mockReturnValue(true);
    mainWindow.isVisible.mockReturnValue(false);
    browserWindows.push(mainWindow);
    (service as unknown as MainWindowHostServiceMethods).registerMainWindow(mainWindow);

    await service.ensureWindow();

    const hostWindow = browserWindows[1];
    hostWindow.isMinimized.mockReturnValue(true);
    hostWindow.isFocused.mockReturnValue(true);

    await service.focusWindow();

    expect(appFocusMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledOnce();
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-Command', expect.stringContaining('AppActivate')]),
      expect.any(Function),
    );
    const focusCommand = execFileMock.mock.calls[0]?.[1]?.[5];
    expect(focusCommand).toContain('Risk Agent Browser Host');
    expect(focusCommand).not.toContain('Main Workspace');
    expect(mainWindow.restore).not.toHaveBeenCalled();
    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
    expect(hostWindow.restore).toHaveBeenCalledOnce();
    expect(hostWindow.moveTop).toHaveBeenCalledOnce();
    expect(hostWindow.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true, 'screen-saver');
    expect(hostWindow.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false);
    expect(hostWindow.focus).toHaveBeenCalled();
    expect(stderrWriteSpy).toHaveBeenCalledWith(expect.stringContaining('[browser-host] focus'));
    expect(stderrWriteSpy).toHaveBeenCalledWith(expect.stringContaining('strategy=win32-recover'));
  });

  it('uses a shared persistent browser profile instead of per-workspace partitions', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    await service.createTab('tab-shared-profile', 'https://example.com/profile', 'workspace-a');

    expect(WebContentsViewCtor).toHaveBeenCalledOnce();
    expect(webContentsViews[0]?.__options.webPreferences?.partition).toBe('persist:risk-agent-browser-profile');
  });

  it('attaches the active hosted tab into the main window panel when browser bounds are registered', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-main-panel', 'https://example.com/panel', 'workspace-a');

    expect(BrowserWindowCtor).not.toHaveBeenCalled();
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(webContentsViews[0]);
    expect(webContentsViews[0]?.setBounds).toHaveBeenCalledWith({ x: 24, y: 96, width: 640, height: 420 });
  });

  it('keeps tab activation inside the main window panel instead of opening a standalone host window', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-main-activate', 'https://example.com/panel', 'workspace-a');
    BrowserWindowCtor.mockClear();

    await service.activateTab('tab-main-activate');

    expect(BrowserWindowCtor).not.toHaveBeenCalled();
    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
    expect(webContentsViews[0]?.webContents.focus).not.toHaveBeenCalled();
  });

  it('falls back to the standalone host window when embedded bounds are stale on a minimized main window', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-minimized-main-window', 'https://example.com/panel', 'workspace-a');
    mainWindow.isMinimized.mockReturnValue(true);
    mainWindow.isVisible.mockReturnValue(false);
    BrowserWindowCtor.mockClear();
    mainWindow.contentView.addChildView.mockClear();
    mainWindow.contentView.removeChildView.mockClear();

    await service.activateTab('tab-minimized-main-window');

    const hostWindow = browserWindows[0];
    expect(BrowserWindowCtor).toHaveBeenCalledOnce();
    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(webContentsViews[0]);
    expect(hostWindow.contentView.addChildView).toHaveBeenCalledWith(webContentsViews[0]);
    expect(webContentsViews[0]?.webContents.focus).toHaveBeenCalled();
  });

  it('switches main-window tabs without reparenting already attached views', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-main-1', 'https://example.com/panel-1', 'workspace-a');
    await service.createTab('tab-main-2', 'https://example.com/panel-2', 'workspace-a');

    mainWindow.contentView.addChildView.mockClear();
    mainWindow.contentView.removeChildView.mockClear();

    await service.activateTab('tab-main-1');

    expect(mainWindow.contentView.addChildView).not.toHaveBeenCalled();
    expect(mainWindow.contentView.removeChildView).not.toHaveBeenCalled();
    expect(webContentsViews[0]?.setBounds).toHaveBeenLastCalledWith({ x: 24, y: 96, width: 640, height: 420 });
    expect(webContentsViews[1]?.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('moves hosted tabs into the standalone host window when explicitly opening Browser Host', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-open-host', 'https://example.com/panel', 'workspace-a');

    await service.focusWindow();

    const hostWindow = browserWindows[0];
    expect(hostWindow).toBeTruthy();
    expect(mainWindow.contentView.removeChildView).toHaveBeenCalledWith(webContentsViews[0]);
    expect(hostWindow.contentView.addChildView).toHaveBeenCalledWith(webContentsViews[0]);
  });

  it('lays out the standalone host tab using the host window bounds instead of stale main-window panel bounds', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-standalone-layout', 'https://example.com/panel', 'workspace-a');
    await service.focusWindow();

    expect(webContentsViews[0]?.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 104, width: 1480, height: 816 });
  });

  it('hides hosted tabs when the main window panel bounds are cleared without a standalone host window', async () => {
    const { BrowserHostService } = await import('../BrowserHostService.js');

    const service = new BrowserHostService('preload.js');
    service.setServerOrigin('http://127.0.0.1:61028');

    const mainWindow = createBrowserWindowMock();
    (service as typeof service & MainWindowHostServiceMethods).registerMainWindow(mainWindow);
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds({ x: 24, y: 96, width: 640, height: 420 });

    await service.createTab('tab-clear-bounds', 'https://example.com/panel', 'workspace-a');
    await (service as typeof service & MainWindowHostServiceMethods).setMainWindowBrowserBounds(null);

    expect(webContentsViews[0]?.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 });
  });
});