/**
 * DesktopSettingsPanel.tsx — 桌面应用专属设置面板
 *
 * 展示桌面应用信息与自动更新控制（desktop-app.md §2.2、§4、§5）：
 *  - 应用版本号
 *  - 数据目录路径
 *  - 手动检查更新
 *  - 更新状态徽章
 *
 * 仅在 Electron 桌面环境中显示，Web 浏览器模式返回提示信息。
 */
import { useEffect, useState } from 'react';
import {
  IconDeviceDesktop,
  IconFolderOpen,
  IconRefresh,
  IconCircleCheck,
  IconDownload,
  IconLoader2,
  IconInfoCircle,
} from '@tabler/icons-react';
import { isElectron, getElectronAPI } from '../../../lib/electron';

type UpdateCheckState = 'idle' | 'checking' | 'available' | 'downloaded' | 'up-to-date' | 'error';

export function DesktopSettingsPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateCheckState>('idle');
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    // 获取版本号和数据目录
    api.getVersion().then(setVersion).catch(() => setVersion('unknown'));
    api.getDataDir().then(setDataDir).catch(() => setDataDir('unknown'));

    // 监听更新事件（用于面板内状态同步）
    api.onUpdateAvailable((info) => {
      setUpdateState('available');
      setUpdateVersion(info.version);
    });
    api.onUpdateDownloaded((info) => {
      setUpdateState('downloaded');
      setUpdateVersion(info.version);
    });

    return () => {
      api.removeUpdateListeners();
    };
  }, []);

  async function handleCheckUpdate() {
    const api = getElectronAPI();
    if (!api) return;
    setUpdateState('checking');
    try {
      await api.checkForUpdates();
      // 如果 3s 内没有收到 update:available，则认为已是最新版
      setTimeout(() => {
        setUpdateState((prev) => (prev === 'checking' ? 'up-to-date' : prev));
      }, 3000);
    } catch {
      setUpdateState('error');
    }
  }

  function handleInstall() {
    getElectronAPI()?.quitAndInstall();
  }

  if (!isElectron()) {
    return (
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <IconDeviceDesktop size={14} className="text-text-muted" />
          <h2 className="text-sm font-semibold text-text">桌面应用</h2>
        </div>
        <div className="flex items-start gap-2 p-3 bg-surface rounded-lg border border-border-subtle">
          <IconInfoCircle size={14} className="text-text-muted shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted">
            当前运行在 Web 浏览器模式，桌面专属功能（版本管理、本地数据目录、自动更新）在 Electron 桌面客户端中可用。
          </p>
        </div>
      </section>
    );
  }

  const updateBadge = () => {
    switch (updateState) {
      case 'checking':
        return (
          <span className="flex items-center gap-1 text-xs text-accent">
            <IconLoader2 size={11} className="animate-spin" />
            检查中…
          </span>
        );
      case 'available':
        return (
          <span className="flex items-center gap-1 text-xs text-warn">
            <IconDownload size={11} />
            v{updateVersion} 下载中
          </span>
        );
      case 'downloaded':
        return (
          <span className="flex items-center gap-1 text-xs text-success">
            <IconCircleCheck size={11} />
            v{updateVersion} 已就绪
          </span>
        );
      case 'up-to-date':
        return (
          <span className="flex items-center gap-1 text-xs text-success">
            <IconCircleCheck size={11} />
            已是最新版
          </span>
        );
      case 'error':
        return (
          <span className="text-xs text-danger">检查失败</span>
        );
      default:
        return null;
    }
  };

  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <IconDeviceDesktop size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text">桌面应用</h2>
        <span className="ml-1 text-xs text-text-muted">（desktop-app.md §2/§4/§5）</span>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* App version */}
        <div className="space-y-1.5">
          <label className="text-xs text-text-muted flex items-center gap-1">
            <IconDeviceDesktop size={10} className="text-accent" />
            应用版本
          </label>
          <div className="h-8 flex items-center px-3 bg-surface border border-border rounded-lg">
            <span className="text-sm text-text font-mono">
              {version ?? '…'}
            </span>
          </div>
        </div>

        {/* Update status */}
        <div className="space-y-1.5">
          <label className="text-xs text-text-muted">更新状态</label>
          <div className="h-8 flex items-center gap-2">
            {updateBadge()}
            {updateState === 'downloaded' ? (
              <button
                onClick={handleInstall}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-success/15 hover:bg-success/25 text-success text-xs transition-colors"
              >
                <IconRefresh size={11} />
                重启安装
              </button>
            ) : (
              <button
                onClick={handleCheckUpdate}
                disabled={updateState === 'checking'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent/10 hover:bg-accent/20 text-accent text-xs transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <IconRefresh size={11} className={updateState === 'checking' ? 'animate-spin' : ''} />
                检查更新
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Data directory */}
      <div className="space-y-1.5">
        <label className="text-xs text-text-muted flex items-center gap-1">
          <IconFolderOpen size={10} className="text-accent" />
          数据目录路径
        </label>
        <div className="flex items-center h-8 px-3 bg-surface border border-border rounded-lg gap-2 min-w-0">
          <span className="text-xs text-text-dim font-mono truncate flex-1">
            {dataDir ?? '…'}
          </span>
        </div>
        <p className="text-xs text-text-muted">
          SQLite 数据库、向量索引、图数据、对象文件均存储于此目录。
        </p>
      </div>
    </section>
  );
}
