/**
 * electron.ts — Electron 桌面运行时检测与 IPC API 封装
 *
 * 提供 isElectron() 检测函数和类型安全的 electronAPI 访问器。
 * 在 Web 浏览器模式下，getElectronAPI() 返回 undefined，组件应做降级处理。
 *
 * 对应 desktop-app.md §2.2（preload.ts contextBridge 暴露的 API 接口）。
 */

export interface ElectronFileFilter {
  name: string;
  extensions: string[];
}

/**
 * 与 preload.ts contextBridge 暴露的 `window.electronAPI` 保持一致的接口类型。
 */
export interface ElectronAPI {
  /**
   * 打开文件选择对话框（用于导入数据源文件/配置文件）。
   * @returns 所选文件路径数组，用户取消则返回 []
   */
  selectFile(filters: ElectronFileFilter[]): Promise<string[]>;

  /**
   * 选择目录对话框（用于设置数据目录）。
   * @returns 所选目录路径，用户取消则返回 undefined
   */
  selectDirectory(): Promise<string | undefined>;

  /**
   * 获取当前应用版本号（来自 package.json version 字段）。
   */
  getVersion(): Promise<string>;

  /**
   * 获取应用数据目录路径。
   */
  getDataDir(): Promise<string>;

  /**
   * 打开 Browser Host 独立窗口。
   */
  openBrowserHost(): Promise<void>;

  /**
   * 最小化 Browser Host 独立窗口。
   */
  minimizeBrowserHostWindow(): Promise<void>;

  /**
   * 切换 Browser Host 独立窗口的最大化状态。
   */
  toggleBrowserHostMaximize(): Promise<void>;

  /**
   * 关闭 Browser Host 独立窗口。
   */
  closeBrowserHostWindow(): Promise<void>;

  /**
   * 同步主界面内置浏览器面板区域。
   */
  setBrowserPanelBounds(bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>;

  /**
   * 手动触发自动更新检查（desktop-app.md §5）。
   */
  checkForUpdates(): Promise<void>;

  /**
   * 用户确认后重启并安装已下载的更新。
   */
  quitAndInstall(): void;

  /**
   * 订阅「有可用更新」事件。
   */
  onUpdateAvailable(callback: (info: { version: string }) => void): void;

  /**
   * 订阅「更新已下载完成」事件。
   */
  onUpdateDownloaded(callback: (info: { version: string }) => void): void;

  /**
   * 移除所有更新事件监听器（组件卸载时清理）。
   */
  removeUpdateListeners(): void;
}

/**
 * 检测当前是否运行在 Electron 桌面环境中。
 * 判断依据：window.electronAPI 是否存在（由 preload.ts contextBridge 注入）。
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).electronAPI !== 'undefined';
}

/**
 * 获取 electronAPI 实例（类型安全封装）。
 * 在 Web 浏览器模式下返回 undefined，调用方应进行 null 检查。
 */
export function getElectronAPI(): ElectronAPI | undefined {
  if (!isElectron()) return undefined;
  return (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
}
