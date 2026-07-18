export interface BrowserHostTabSnapshot {
  tabId: string;
  workspaceId: string;
  providerTabRef: string;
  title: string | null;
  currentUrl: string | null;
  status: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface BrowserHostSnapshotResult {
  title: string | null;
  currentUrl: string | null;
  html?: string;
  text?: string;
}

export interface BrowserHostScreenshotResult {
  mimeType: 'image/png';
  dataBase64: string;
}

export interface BrowserHostScreenshotOptions {
  fullPage?: boolean;
}

export interface BrowserHostImageRecord {
  src: string;
  currentSrc: string | null;
  alt: string | null;
  title: string | null;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface BrowserHostAdapter {
  isAvailable(): boolean;
  ensureWindow?(): Promise<void>;
  focusWindow?(): Promise<void>;
  createTab?(tabId: string, url: string, workspaceId: string): Promise<BrowserHostTabSnapshot>;
  activateTab?(tabId: string): Promise<BrowserHostTabSnapshot | null>;
  closeTab?(tabId: string): Promise<void>;
  navigate?(tabId: string, url: string): Promise<BrowserHostTabSnapshot | null>;
  goBack?(tabId: string): Promise<BrowserHostTabSnapshot | null>;
  goForward?(tabId: string): Promise<BrowserHostTabSnapshot | null>;
  reload?(tabId: string): Promise<BrowserHostTabSnapshot | null>;
  listTabs?(workspaceId?: string): Promise<BrowserHostTabSnapshot[]>;
  readMetadata?(tabId: string): Promise<BrowserHostTabSnapshot | null>;
  snapshot?(tabId: string): Promise<BrowserHostSnapshotResult>;
  screenshot?(tabId: string, options?: BrowserHostScreenshotOptions): Promise<BrowserHostScreenshotResult>;
  listImages?(tabId: string, limit?: number): Promise<BrowserHostImageRecord[]>;
  click?(tabId: string, selector: string): Promise<BrowserHostTabSnapshot | null>;
  type?(tabId: string, selector: string, text: string, submit?: boolean): Promise<BrowserHostTabSnapshot | null>;
  press?(tabId: string, key: string): Promise<BrowserHostTabSnapshot | null>;
  openExternal?(url: string, executablePath?: string): Promise<void>;
}
