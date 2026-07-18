import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, WebContentsView, shell } from 'electron';
import { spawn } from 'node:child_process';
import type {
  BrowserHostAdapter,
  BrowserHostImageRecord,
  BrowserHostScreenshotOptions,
  BrowserHostScreenshotResult,
  BrowserHostSnapshotResult,
  BrowserHostTabSnapshot,
} from '@risk-agent/core/browser/BrowserHostAdapter';
import { SHARED_BROWSER_PARTITION } from './sharedBrowserSession';

const HOST_HEADER_HEIGHT = 104;
const HOST_WINDOW_TITLE = 'Risk Agent Browser Host';
const BROWSER_HOST_DEBUG_ENV = 'RISK_AGENT_BROWSER_HOST_DEBUG';

type HostedTab = {
  workspaceId: string;
  tabId: string;
  view: WebContentsView;
  snapshot: BrowserHostTabSnapshot;
  containerWindow: BrowserWindow | null;
};

type BrowserPanelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function cloneSnapshot(snapshot: BrowserHostTabSnapshot): BrowserHostTabSnapshot {
  return { ...snapshot };
}

export class BrowserHostService implements BrowserHostAdapter {
  private hostWindow: BrowserWindow | null = null;
  private mainWindow: BrowserWindow | null = null;
  private mainWindowBrowserBounds: BrowserPanelBounds | null = null;
  private surfaceMode: 'main-window' | 'standalone' = 'standalone';
  private serverOrigin: string | null = null;
  private readonly tabs = new Map<string, HostedTab>();
  private activeTabId: string | null = null;

  constructor(private readonly preloadPath: string) {}

  isAvailable(): boolean {
    return true;
  }

  setServerOrigin(serverOrigin: string): void {
    this.serverOrigin = serverOrigin.replace(/\/$/, '');
  }

  registerMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.bindWindowDebugEvents('main', mainWindow);
  }

  async setMainWindowBrowserBounds(bounds: BrowserPanelBounds | null): Promise<void> {
    this.mainWindowBrowserBounds = bounds;
    this.surfaceMode = bounds ? 'main-window' : 'standalone';
    this.writeDebugLog(`setMainWindowBrowserBounds bounds=${this.describeBounds(bounds)} surfaceMode=${this.surfaceMode} main=${this.describeWindow(this.mainWindow)}`);
    this.syncTabParentage();
    this.layoutActiveTab();
  }

  async ensureWindow(): Promise<void> {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      this.setHostWindowTitle(this.hostWindow);
      if (!this.hostWindow.isVisible()) this.hostWindow.show();
      return;
    }

    if (!this.serverOrigin) {
      throw new Error('Browser host server origin has not been configured');
    }

    const hostWindow = new BrowserWindow({
      width: 1480,
      height: 920,
      minWidth: 1240,
      minHeight: 760,
      title: HOST_WINDOW_TITLE,
      autoHideMenuBar: true,
      backgroundColor: '#0f1220',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        sandbox: true,
      },
    });

    hostWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    hostWindow.webContents.on('page-title-updated', (event) => {
      event.preventDefault();
      this.setHostWindowTitle(hostWindow);
    });

    hostWindow.on('resize', () => this.layoutActiveTab());
    hostWindow.on('closed', () => {
      this.hostWindow = null;
      this.activeTabId = null;
      this.tabs.clear();
    });

    this.hostWindow = hostWindow;
    this.bindWindowDebugEvents('host', hostWindow);
    await hostWindow.loadURL(`${this.serverOrigin}/browser-host`);
    this.setHostWindowTitle(hostWindow);
    hostWindow.show();
    this.layoutActiveTab();
  }

  async focusWindow(): Promise<void> {
    this.surfaceMode = 'standalone';
    await this.ensureWindow();
    this.syncTabParentage();
    this.layoutActiveTab();
    const hostWindow = this.hostWindow;
    if (!hostWindow || hostWindow.isDestroyed()) {
      return;
    }

    let strategy: 'default' | 'win32-recover' = 'default';
    if (process.platform === 'win32') {
      strategy = 'win32-recover';
      await this.requestWindowsAppActivate([hostWindow.getTitle()]);
      this.bumpWindowToForeground(hostWindow);
    } else {
      this.bumpWindowToForeground(hostWindow);
    }

    this.setHostWindowTitle(hostWindow);
    this.writeFocusLog(hostWindow, strategy);
  }

  async createTab(tabId: string, url: string, workspaceId: string): Promise<BrowserHostTabSnapshot> {
    await this.ensureSurfaceWindow();

    const existing = this.tabs.get(tabId);
    if (existing) {
      await this.navigate(tabId, url);
      return cloneSnapshot(existing.snapshot);
    }

    const view = new WebContentsView({
      webPreferences: {
        partition: SHARED_BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });

    const snapshot: BrowserHostTabSnapshot = {
      tabId,
      workspaceId,
      providerTabRef: `browser-host:${tabId}`,
      title: null,
      currentUrl: null,
      status: 'loading',
      canGoBack: false,
      canGoForward: false,
    };

    const hostedTab: HostedTab = { workspaceId, tabId, view, snapshot, containerWindow: null };
    this.tabs.set(tabId, hostedTab);
    this.bindViewEvents(hostedTab);
    this.syncTabParentage();
    this.activeTabId = tabId;
    this.layoutActiveTab();

    await view.webContents.loadURL(url);
    this.updateSnapshot(hostedTab, { status: 'ready' });
    return cloneSnapshot(hostedTab.snapshot);
  }

  async activateTab(tabId: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return null;
    }

    const usingMainWindowSurface = this.hasMainWindowSurface();
    this.writeDebugLog(`activateTab:start tab=${tabId} route=${usingMainWindowSurface ? 'main-window' : 'standalone'} surfaceMode=${this.surfaceMode} main=${this.describeWindow(this.mainWindow)} host=${this.describeWindow(this.hostWindow)}`);

    if (usingMainWindowSurface) {
      this.surfaceMode = 'main-window';
      this.syncTabParentage();
    } else {
      await this.focusWindow();
    }

    this.activeTabId = tabId;
    this.layoutActiveTab();
    if (!usingMainWindowSurface) {
      hostedTab.view.webContents.focus();
    }
    this.writeDebugLog(`activateTab:done tab=${tabId} route=${usingMainWindowSurface ? 'main-window' : 'standalone'} focusedView=${usingMainWindowSurface ? 'skipped' : 'applied'} surfaceMode=${this.surfaceMode} main=${this.describeWindow(this.mainWindow)} host=${this.describeWindow(this.hostWindow)}`);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async closeTab(tabId: string): Promise<void> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return;
    }

    if (hostedTab.containerWindow && !hostedTab.containerWindow.isDestroyed()) {
      hostedTab.containerWindow.contentView.removeChildView(hostedTab.view);
      hostedTab.containerWindow = null;
    }
    hostedTab.view.webContents.close();
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const replacement = this.tabs.values().next();
      this.activeTabId = replacement.done ? null : replacement.value.tabId;
      this.layoutActiveTab();
    }
  }

  async navigate(tabId: string, url: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return null;
    }
    this.updateSnapshot(hostedTab, { status: 'loading' });
    await hostedTab.view.webContents.loadURL(url);
    this.updateSnapshot(hostedTab, { status: 'ready' });
    return cloneSnapshot(hostedTab.snapshot);
  }

  async goBack(tabId: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) return null;
    if (hostedTab.view.webContents.canGoBack()) {
      hostedTab.view.webContents.goBack();
    }
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async goForward(tabId: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) return null;
    if (hostedTab.view.webContents.canGoForward()) {
      hostedTab.view.webContents.goForward();
    }
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async reload(tabId: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) return null;
    hostedTab.view.webContents.reload();
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async listTabs(workspaceId?: string): Promise<BrowserHostTabSnapshot[]> {
    return [...this.tabs.values()]
      .filter((tab) => !workspaceId || tab.workspaceId === workspaceId)
      .map((tab) => cloneSnapshot(tab.snapshot));
  }

  async readMetadata(tabId: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return null;
    }
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async snapshot(tabId: string): Promise<BrowserHostSnapshotResult> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      throw new Error(`Browser host tab ${tabId} not found`);
    }
    const [html, text] = await Promise.all([
      hostedTab.view.webContents.executeJavaScript('document.documentElement?.outerHTML ?? ""', true),
      hostedTab.view.webContents.executeJavaScript('document.body?.innerText ?? document.documentElement?.innerText ?? ""', true),
    ]);
    this.syncSnapshot(hostedTab);
    return {
      title: hostedTab.snapshot.title,
      currentUrl: hostedTab.snapshot.currentUrl,
      html: typeof html === 'string' ? html : '',
      text: typeof text === 'string' ? text : '',
    };
  }

  async screenshot(tabId: string, options: BrowserHostScreenshotOptions = {}): Promise<BrowserHostScreenshotResult> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      throw new Error(`Browser host tab ${tabId} not found`);
    }
    if (options.fullPage) {
      return this.captureFullPageScreenshot(hostedTab);
    }
    const image = await hostedTab.view.webContents.capturePage();
    return {
      mimeType: 'image/png',
      dataBase64: image.toPNG().toString('base64'),
    };
  }

  async listImages(tabId: string, limit = 50): Promise<BrowserHostImageRecord[]> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      throw new Error(`Browser host tab ${tabId} not found`);
    }

    const rawImages = await hostedTab.view.webContents.executeJavaScript(`(() => {
      const maxCount = ${JSON.stringify(Math.max(1, limit))};
      return Array.from(document.images)
        .filter((image) => Boolean(image.getAttribute('src') || image.currentSrc))
        .slice(0, maxCount)
        .map((image) => ({
          src: image.getAttribute('src') || image.currentSrc || '',
          currentSrc: image.currentSrc || null,
          alt: image.getAttribute('alt'),
          title: image.getAttribute('title'),
          width: image.width || 0,
          height: image.height || 0,
          naturalWidth: image.naturalWidth || 0,
          naturalHeight: image.naturalHeight || 0,
        }));
    })();`, true);

    if (!Array.isArray(rawImages)) {
      return [];
    }

    return rawImages.map((image) => ({
      src: typeof image?.src === 'string' ? image.src : '',
      currentSrc: typeof image?.currentSrc === 'string' ? image.currentSrc : null,
      alt: typeof image?.alt === 'string' ? image.alt : null,
      title: typeof image?.title === 'string' ? image.title : null,
      width: typeof image?.width === 'number' ? image.width : 0,
      height: typeof image?.height === 'number' ? image.height : 0,
      naturalWidth: typeof image?.naturalWidth === 'number' ? image.naturalWidth : 0,
      naturalHeight: typeof image?.naturalHeight === 'number' ? image.naturalHeight : 0,
    }));
  }

  async click(tabId: string, selector: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return null;
    }

    const script = `(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) {
        throw new Error('Selector not found: ' + ${JSON.stringify(selector)});
      }
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      if (target instanceof HTMLElement) {
        target.focus();
        target.click();
      } else {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return true;
    })();`;
    await hostedTab.view.webContents.executeJavaScript(script, true);
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async type(tabId: string, selector: string, text: string, submit = false): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return null;
    }

    const script = `(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) {
        throw new Error('Selector not found: ' + ${JSON.stringify(selector)});
      }
      const value = ${JSON.stringify(text)};
      const shouldSubmit = ${submit ? 'true' : 'false'};
      const dispatch = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        target.value = value;
        dispatch(target, 'input');
        dispatch(target, 'change');
        if (shouldSubmit && target.form) {
          if (typeof target.form.requestSubmit === 'function') {
            target.form.requestSubmit();
          } else {
            target.form.submit();
          }
        }
        return true;
      }
      if (target instanceof HTMLElement && target.isContentEditable) {
        target.focus();
        target.textContent = value;
        dispatch(target, 'input');
        if (shouldSubmit) {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        }
        return true;
      }
      throw new Error('Selector is not a typable element: ' + ${JSON.stringify(selector)});
    })();`;
    await hostedTab.view.webContents.executeJavaScript(script, true);
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async press(tabId: string, key: string): Promise<BrowserHostTabSnapshot | null> {
    const hostedTab = this.tabs.get(tabId);
    if (!hostedTab) {
      return null;
    }

    const script = `(() => {
      const active = document.activeElement || document.body;
      const key = ${JSON.stringify(key)};
      const eventInit = { key, bubbles: true, cancelable: true };
      active.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      active.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      active.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      if (key === 'Enter' && active instanceof HTMLInputElement && active.form) {
        if (typeof active.form.requestSubmit === 'function') {
          active.form.requestSubmit();
        } else {
          active.form.submit();
        }
      }
      return true;
    })();`;
    await hostedTab.view.webContents.executeJavaScript(script, true);
    this.syncSnapshot(hostedTab);
    return cloneSnapshot(hostedTab.snapshot);
  }

  async openExternal(url: string, executablePath?: string): Promise<void> {
    if (executablePath && executablePath.trim().length > 0) {
      const child = spawn(executablePath, [url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }
    await shell.openExternal(url);
  }

  dispose(): void {
    for (const tab of this.tabs.values()) {
      try {
        tab.view.webContents.close();
      } catch {
        // ignore teardown failures during app shutdown
      }
    }
    this.tabs.clear();
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      this.hostWindow.close();
    }
    this.hostWindow = null;
    this.activeTabId = null;
  }

  private async ensureSurfaceWindow(): Promise<void> {
    if (this.surfaceMode === 'main-window' && this.hasMainWindowSurface()) {
      return;
    }
    await this.ensureWindow();
  }

  private hasMainWindowSurface(): boolean {
    return Boolean(
      this.mainWindow &&
      !this.mainWindow.isDestroyed() &&
      this.mainWindow.isVisible() &&
      !this.mainWindow.isMinimized() &&
      this.mainWindowBrowserBounds,
    );
  }

  async minimizeWindow(): Promise<void> {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      return;
    }

    this.hostWindow.minimize();
  }

  async toggleMaximizeWindow(): Promise<void> {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      return;
    }

    if (this.hostWindow.isMaximized()) {
      this.hostWindow.unmaximize();
      return;
    }

    this.hostWindow.maximize();
  }

  async closeWindow(): Promise<void> {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      return;
    }

    this.hostWindow.close();
  }

  private getActiveContainerWindow(): BrowserWindow | null {
    if (this.surfaceMode === 'main-window' && this.hasMainWindowSurface()) {
      return this.mainWindow;
    }
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      return this.hostWindow;
    }
    return null;
  }

  private syncTabParentage(): void {
    const activeWindow = this.getActiveContainerWindow();
    if (!activeWindow) {
      return;
    }

    for (const hostedTab of this.tabs.values()) {
      if (hostedTab.containerWindow === activeWindow) {
        continue;
      }

      if (hostedTab.containerWindow && !hostedTab.containerWindow.isDestroyed()) {
        hostedTab.containerWindow.contentView.removeChildView(hostedTab.view);
      } else {
        if (this.hostWindow && this.hostWindow !== activeWindow && !this.hostWindow.isDestroyed()) {
          this.hostWindow.contentView.removeChildView(hostedTab.view);
        }
        if (this.mainWindow && this.mainWindow !== activeWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.contentView.removeChildView(hostedTab.view);
        }
      }

      activeWindow.contentView.addChildView(hostedTab.view);
      hostedTab.containerWindow = activeWindow;
    }
  }

  private bindViewEvents(hostedTab: HostedTab): void {
    const contents = hostedTab.view.webContents;
    const sync = () => this.syncSnapshot(hostedTab);

    contents.on('did-start-loading', () => this.updateSnapshot(hostedTab, { status: 'loading' }));
    contents.on('did-stop-loading', () => this.updateSnapshot(hostedTab, { status: 'ready' }));
    contents.on('page-title-updated', (event) => {
      event.preventDefault();
      sync();
    });
    contents.on('did-navigate', sync);
    contents.on('did-navigate-in-page', sync);
    contents.on('did-fail-load', () => this.updateSnapshot(hostedTab, { status: 'error' }));
  }

  private layoutActiveTab(): void {
    const activeWindow = this.getActiveContainerWindow();
    if (!activeWindow || activeWindow.isDestroyed()) {
      for (const hostedTab of this.tabs.values()) {
        hostedTab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
      return;
    }

    const panelBounds = this.surfaceMode === 'main-window' && this.hasMainWindowSurface()
      ? this.mainWindowBrowserBounds
      : null;

    const tabBounds = panelBounds
      ? {
          x: panelBounds.x,
          y: panelBounds.y,
          width: Math.max(0, panelBounds.width),
          height: Math.max(0, panelBounds.height),
        }
      : (() => {
          const bounds = activeWindow.getContentBounds();
          return {
            x: 0,
            y: HOST_HEADER_HEIGHT,
            width: Math.max(0, bounds.width),
            height: Math.max(0, bounds.height - HOST_HEADER_HEIGHT),
          };
        })();

    for (const hostedTab of this.tabs.values()) {
      if (hostedTab.tabId === this.activeTabId) {
        hostedTab.view.setBounds(tabBounds);
      } else {
        hostedTab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
  }

  private syncSnapshot(hostedTab: HostedTab): void {
    const contents = hostedTab.view.webContents;
    this.updateSnapshot(hostedTab, {
      title: contents.getTitle() || null,
      currentUrl: contents.getURL() || null,
      canGoBack: contents.canGoBack(),
      canGoForward: contents.canGoForward(),
      status: contents.isLoading() ? 'loading' : hostedTab.snapshot.status === 'error' ? 'error' : 'ready',
    });
  }

  private updateSnapshot(hostedTab: HostedTab, patch: Partial<BrowserHostTabSnapshot>): void {
    hostedTab.snapshot = {
      ...hostedTab.snapshot,
      ...patch,
    };
  }

  private async captureFullPageScreenshot(hostedTab: HostedTab): Promise<BrowserHostScreenshotResult> {
    const debuggerClient = hostedTab.view.webContents.debugger;
    const attachedByUs = !debuggerClient.isAttached();
    if (attachedByUs) {
      debuggerClient.attach('1.3');
    }

    try {
      await debuggerClient.sendCommand('Page.enable');
      const metrics = await debuggerClient.sendCommand('Page.getLayoutMetrics');
      const contentSize = metrics.contentSize ?? metrics.cssContentSize ?? null;
      const viewBounds = hostedTab.view.getBounds();
      const width = Math.max(1, Math.ceil(Number(contentSize?.width ?? viewBounds.width ?? 1)));
      const height = Math.max(1, Math.ceil(Number(contentSize?.height ?? viewBounds.height ?? 1)));
      const screenshot = await debuggerClient.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width,
          height,
          scale: 1,
        },
      });

      return {
        mimeType: 'image/png',
        dataBase64: typeof screenshot.data === 'string' ? screenshot.data : '',
      };
    } finally {
      if (attachedByUs && debuggerClient.isAttached()) {
        debuggerClient.detach();
      }
    }
  }

  private setHostWindowTitle(hostWindow: BrowserWindow): void {
    hostWindow.setTitle(HOST_WINDOW_TITLE);
  }

  private bumpWindowToForeground(targetWindow: BrowserWindow): void {
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }

    targetWindow.show();
    targetWindow.moveTop();

    const wasAlwaysOnTop = targetWindow.isAlwaysOnTop();
    targetWindow.setAlwaysOnTop(true, 'screen-saver');
    targetWindow.focus();
    if (!wasAlwaysOnTop) {
      targetWindow.setAlwaysOnTop(false);
    }
  }

  private async requestWindowsAppActivate(windowTitles: Array<string | undefined>): Promise<void> {
    const activatableTitles = windowTitles
      .filter((title): title is string => Boolean(title?.trim()))
      .filter((title, index, values) => values.indexOf(title) === index);

    if (activatableTitles.length === 0) {
      return;
    }

    const escapedTitles = activatableTitles
      .map((title) => `'${title.replace(/'/g, "''")}'`)
      .join(', ');
    const command = [
      '$wshell = New-Object -ComObject WScript.Shell',
      `$titles = @(${escapedTitles})`,
      'foreach ($title in $titles) {',
      '  [void]$wshell.AppActivate($title)',
      '}',
    ].join('; ');

    await new Promise<void>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
        () => resolve(),
      );
    });
  }

  private writeFocusLog(hostWindow: BrowserWindow, strategy: 'default' | 'win32-recover'): void {
    const details = [
      '[browser-host] focus',
      `strategy=${strategy}`,
      `visible=${hostWindow.isVisible()}`,
      `minimized=${hostWindow.isMinimized()}`,
      `focused=${hostWindow.isFocused()}`,
      `activeTabId=${this.activeTabId ?? 'none'}`,
      `title=${JSON.stringify(hostWindow.getTitle())}`,
    ].join(' ');
    process.stderr.write(`${details}\n`);
  }

  private bindWindowDebugEvents(label: 'main' | 'host', window: BrowserWindow): void {
    if (!this.isDebugEnabled()) {
      return;
    }

    const logState = (event: string) => {
      this.writeDebugLog(`window:${label}:${event} ${this.describeWindow(window)}`);
    };

    window.on('show', () => logState('show'));
    window.on('hide', () => logState('hide'));
    window.on('minimize', () => logState('minimize'));
    window.on('restore', () => logState('restore'));
    window.on('maximize', () => logState('maximize'));
    window.on('unmaximize', () => logState('unmaximize'));
    window.on('focus', () => logState('focus'));
    window.on('blur', () => logState('blur'));
  }

  private isDebugEnabled(): boolean {
    return process.env[BROWSER_HOST_DEBUG_ENV] === '1';
  }

  private writeDebugLog(message: string): void {
    if (!this.isDebugEnabled()) {
      return;
    }

    const line = `[browser-host-debug] ${message}`;
    process.stderr.write(`${line}\n`);

    try {
      if (typeof app.getPath === 'function') {
        const logPath = join(app.getPath('userData'), 'browser-host-debug.log');
        appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
      }
    } catch {
      // Best-effort debug logging only.
    }
  }

  private describeBounds(bounds: BrowserPanelBounds | null): string {
    if (!bounds) {
      return 'null';
    }

    return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  }

  private describeWindow(targetWindow: BrowserWindow | null): string {
    if (!targetWindow || targetWindow.isDestroyed()) {
      return 'destroyed';
    }

    return [
      `visible=${targetWindow.isVisible()}`,
      `minimized=${targetWindow.isMinimized()}`,
      `focused=${targetWindow.isFocused()}`,
    ].join(',');
  }
}
