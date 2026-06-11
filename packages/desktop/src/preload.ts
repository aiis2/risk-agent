/**
 * preload.ts — Electron 预加载脚本
 *
 * 通过 contextBridge 向渲染进程安全暴露有限的 IPC API（desktop-app.md §2.2）。
 * contextIsolation: true + nodeIntegration: false 保证渲染进程无法直接访问 Node.js。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 打开文件选择对话框（用于导入数据源文件/配置文件）。
   * @param filters Electron.FileFilter[] 文件类型过滤器
   * @returns 所选文件路径数组，用户取消则返回 []
   */
  selectFile: (filters: Electron.FileFilter[]): Promise<string[]> =>
    ipcRenderer.invoke('dialog:openFile', filters),

  /**
   * 选择目录对话框（用于设置数据目录）。
   * @returns 所选目录路径，用户取消则返回 undefined
   */
  selectDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  /**
   * 获取当前应用版本号（来自 package.json version 字段）。
   */
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:version'),

  /**
   * 获取应用数据目录路径（userData 目录）。
   */
  getDataDir: (): Promise<string> =>
    ipcRenderer.invoke('app:dataDir'),

  /**
   * 打开 Browser Host 独立窗口。
   */
  openBrowserHost: (): Promise<void> =>
    ipcRenderer.invoke('browser-host:openWindow'),

  /**
   * 最小化 Browser Host 独立窗口。
   */
  minimizeBrowserHostWindow: (): Promise<void> =>
    ipcRenderer.invoke('browser-host:minimizeWindow'),

  /**
   * 切换 Browser Host 独立窗口的最大化状态。
   */
  toggleBrowserHostMaximize: (): Promise<void> =>
    ipcRenderer.invoke('browser-host:toggleMaximize'),

  /**
   * 关闭 Browser Host 独立窗口。
   */
  closeBrowserHostWindow: (): Promise<void> =>
    ipcRenderer.invoke('browser-host:closeWindow'),

  /**
   * 同步主界面内置浏览器面板的屏幕坐标与尺寸。
   */
  setBrowserPanelBounds: (bounds: { x: number; y: number; width: number; height: number } | null): Promise<void> =>
    ipcRenderer.invoke('browser-host:setPanelBounds', bounds),

  /**
   * 手动触发自动更新检查（desktop-app.md §5）。
   */
  checkForUpdates: (): Promise<void> =>
    ipcRenderer.invoke('updater:check'),

  /**
   * 用户确认后重启并安装已下载的更新。
   */
  quitAndInstall: (): void =>
    ipcRenderer.send('updater:quitAndInstall'),

  /**
   * 订阅「有可用更新」事件（desktop-app.md §5）。
   */
  onUpdateAvailable: (callback: (info: { version: string }) => void): void => {
    ipcRenderer.on('update:available', (_event, info) => callback(info));
  },

  /**
   * 订阅「更新已下载完成」事件（desktop-app.md §5）。
   */
  onUpdateDownloaded: (callback: (info: { version: string }) => void): void => {
    ipcRenderer.on('update:downloaded', (_event, info) => callback(info));
  },

  /**
   * 移除所有更新事件监听器（组件卸载时清理）。
   */
  removeUpdateListeners: (): void => {
    ipcRenderer.removeAllListeners('update:available');
    ipcRenderer.removeAllListeners('update:downloaded');
  },
});

