/**
 * main.ts — Electron 主进程
 *
 * 职责（desktop-app.md §2.1）：
 *  1. 启动内嵌 Fastify 服务（随机端口）
 *  2. 初始化数据目录结构
 *  3. 创建主窗口并加载 React 前端
 *  4. 注册 IPC handlers（dialog / app / updater）
 *  5. 配置 CSP / 自动更新 / 安全加固（§6）
 */
import { app, BrowserWindow, ipcMain, dialog, session, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startEmbeddedServer, shutdownEmbeddedServer, initDataDirectory } from './backend';
import { BrowserHostService } from './browserHost/BrowserHostService';
import { BrowserSessionCookieStore } from './browserHost/BrowserSessionCookieStore';
import { SHARED_BROWSER_PARTITION } from './browserHost/sharedBrowserSession';

// Windows 通知所需的 AppUserModelId
if (process.platform === 'win32') {
  app.setAppUserModelId('ai.aiis2.risk-agent');
}

let mainWindow: BrowserWindow | null = null;
const browserHostService = new BrowserHostService(join(__dirname, 'preload.js'));
let browserSessionCookieStore: BrowserSessionCookieStore | null = null;
let sharedBrowserSession: Electron.Session | null = null;

function canUseAutoUpdater() {
  return app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'));
}

function buildStartupShellUrl() {
  const startupHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Risk Agent</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #202647 0%, #0f1220 58%, #090b14 100%);
        color: #e6e8f2;
      }

      main {
        display: grid;
        gap: 12px;
        justify-items: center;
      }

      .spinner {
        width: 48px;
        height: 48px;
        border-radius: 999px;
        border: 3px solid rgba(107, 138, 254, 0.24);
        border-top-color: #6b8afe;
        animation: spin 0.9s linear infinite;
      }

      .label {
        font-size: 14px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #8d92a8;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <div>Risk Agent 正在启动</div>
      <div class="label">Loading local services...</div>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=UTF-8,${encodeURIComponent(startupHtml)}`;
}

async function createWindow() {
  // 全局移除系统菜单（File / Edit / View / Window / Help）
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Risk Agent',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // 允许 Vite 开发服务器跨域（仅开发模式）
      allowRunningInsecureContent: false,
    }
  });
  browserHostService.registerMainWindow(mainWindow);
  await mainWindow.loadURL(buildStartupShellUrl());

  const startupWindow = mainWindow;
  const { port, dataDir } = await startEmbeddedServer({ browserHostAdapter: browserHostService });
  browserHostService.setServerOrigin(`http://127.0.0.1:${port}`);

  // 初始化数据目录结构（storage.json / config / logs 等）
  await initDataDirectory(dataDir);

  if (mainWindow !== startupWindow) {
    return;
  }

  // ── CSP（desktop-app.md §6）─────────────────────────────
  // 仅允许本地 localhost 资源，防止外部注入
  startupWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self' http://127.0.0.1:${port} ws://127.0.0.1:${port};` +
            ` script-src 'self' 'unsafe-inline' 'unsafe-eval';` +
            ` style-src 'self' 'unsafe-inline';` +
            ` img-src 'self' data: blob:;` +
            ` connect-src 'self' http://127.0.0.1:${port} ws://127.0.0.1:${port};`
          ]
        }
      });
    }
  );

  const webEntry = process.env.RISK_AGENT_WEB_URL ?? `http://127.0.0.1:${port}/`;
  await startupWindow.loadURL(webEntry);

  startupWindow.on('closed', () => {
    if (mainWindow === startupWindow) {
      mainWindow = null;
    }
  });
}

// ── IPC Handlers（desktop-app.md §2.2）──────────────────

/** dialog:openFile — 文件选择对话框 */
ipcMain.handle('dialog:openFile', async (_event, filters: Electron.FileFilter[] = []) => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters
  });
  return result.canceled ? [] : result.filePaths;
});

/** dialog:openDirectory — 目录选择对话框 */
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return undefined;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? undefined : result.filePaths[0];
});

/** app:version — 获取应用版本 */
ipcMain.handle('app:version', () => app.getVersion());

/** app:dataDir — 获取数据目录路径 */
ipcMain.handle('app:dataDir', () =>
  process.env.RISK_AGENT_DATA_DIR ?? join(app.getPath('userData'), 'risk_agent_data')
);

/** browser-host:openWindow — 打开 Browser Host 独立窗口 */
ipcMain.handle('browser-host:openWindow', async () => {
  await browserHostService.focusWindow();
});

ipcMain.handle('browser-host:minimizeWindow', async () => {
  await browserHostService.minimizeWindow();
});

ipcMain.handle('browser-host:toggleMaximize', async () => {
  await browserHostService.toggleMaximizeWindow();
});

ipcMain.handle('browser-host:closeWindow', async () => {
  await browserHostService.closeWindow();
});

ipcMain.handle('browser-host:setPanelBounds', async (_event, bounds: { x: number; y: number; width: number; height: number } | null) => {
  await browserHostService.setMainWindowBrowserBounds(bounds);
});

/** updater:check — 触发更新检查 */
ipcMain.handle('updater:check', async () => {
  try {
    // electron-updater 仅在存在更新配置时启用
    if (canUseAutoUpdater()) {
      const { autoUpdater } = await import('electron-updater');
      await autoUpdater.checkForUpdates();
    }
  } catch {
    // 更新检查失败静默处理（离线或未配置发布服务器时均正常）
  }
});

/** updater:quitAndInstall — 确认后重启安装更新 */
ipcMain.on('updater:quitAndInstall', async () => {
  if (canUseAutoUpdater()) {
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.quitAndInstall();
    } catch {
      // 静默处理
    }
  }
});

// ── 自动更新（desktop-app.md §5）─────────────────────────
async function setupAutoUpdater() {
  if (!canUseAutoUpdater()) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update:available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      // 自动更新错误不应影响主应用运行
      process.stderr.write(`[updater] error: ${err?.message}\n`);
    });

    // 应用就绪后延迟 5s 检查更新，避免影响启动体验
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {/* 静默 */});
    }, 5000);
  } catch {
    // electron-updater 未安装时静默跳过
  }
}

// ── 应用生命周期 ──────────────────────────────────────────

app.whenReady().then(async () => {
  sharedBrowserSession = session.fromPartition(SHARED_BROWSER_PARTITION);
  browserSessionCookieStore = new BrowserSessionCookieStore({
    cookies: sharedBrowserSession.cookies,
    storageFilePath: join(app.getPath('userData'), 'browser-host', 'session-cookies.json'),
    logger: (message) => {
      process.stderr.write(`[browser-session] ${message}\n`);
    },
  });
  await browserSessionCookieStore.initialize();
  await createWindow();
  await setupAutoUpdater();
}).catch((err) => {
  process.stderr.write(`[desktop] failed to start: ${err?.message}\n`);
  app.quit();
});

// macOS：点击 Dock 图标时重新创建窗口（desktop-app.md §2.1）
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(console.error);
  }
});

app.on('window-all-closed', async () => {
  browserHostService.dispose();
  await sharedBrowserSession?.flushStorageData();
  await browserSessionCookieStore?.flush();
  await shutdownEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});

