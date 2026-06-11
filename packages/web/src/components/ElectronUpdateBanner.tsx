/**
 * ElectronUpdateBanner.tsx — Electron 自动更新通知横幅
 *
 * 监听 preload.ts 暴露的更新事件，展示可关闭的通知横幅：
 *  - "有可用更新（正在下载）"：版本号 + 下载中状态
 *  - "更新已下载完成"：版本号 + 立即重启按钮
 *
 * 对应 desktop-app.md §5（自动更新）。
 * 仅在 isElectron() 为 true 时渲染，否则返回 null。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconDownload,
  IconCircleCheck,
  IconRefresh,
  IconX,
  IconLoader2,
} from '@tabler/icons-react';
import { isElectron, getElectronAPI } from '../lib/electron';

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloaded'; version: string };

export function ElectronUpdateBanner() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    const api = getElectronAPI();
    if (!api) return;

    api.onUpdateAvailable((info) => {
      setUpdate({ status: 'available', version: info.version });
      setDismissed(false);
    });

    api.onUpdateDownloaded((info) => {
      setUpdate({ status: 'downloaded', version: info.version });
      setDismissed(false);
    });

    return () => {
      api.removeUpdateListeners();
    };
  }, []);

  if (!isElectron() || update.status === 'idle' || dismissed) return null;

  function handleInstall() {
    getElectronAPI()?.quitAndInstall();
  }

  const isDownloaded = update.status === 'downloaded';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 shrink-0 border-b ${
        isDownloaded
          ? 'border-success/20 bg-success/10'
          : 'border-accent/20 bg-accent/10'
      }`}
      role="alert"
      aria-live="polite"
    >
      {/* Icon */}
      {isDownloaded ? (
        <IconCircleCheck size={15} className="shrink-0 text-success" />
      ) : (
        <IconLoader2 size={15} className="shrink-0 animate-spin text-accent" />
      )}

      {/* Message */}
      <p className="flex-1 text-xs text-text">
        {isDownloaded ? (
          <>
            <span className="font-medium">{t('updateBanner.downloadedTitle', '更新已就绪 v{{version}}', { version: update.version })}</span>
            <span className="ml-1.5 text-text-dim">- {t('updateBanner.downloadedHint', '重启后即可安装')}</span>
          </>
        ) : (
          <>
            <span className="font-medium">{t('updateBanner.availableTitle', '发现新版本 v{{version}}', { version: update.version })}</span>
            <span className="ml-1.5 text-text-dim">- {t('updateBanner.availableHint', '正在后台下载…')}</span>
          </>
        )}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isDownloaded && (
          <button
            onClick={handleInstall}
            className="flex items-center gap-1 rounded-md bg-success/20 px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/30"
          >
            <IconRefresh size={12} />
            {t('updateBanner.restartNow', '立即重启')}
          </button>
        )}
        {!isDownloaded && (
          <div className="flex items-center gap-1 px-2.5 py-1 text-xs text-accent">
            <IconDownload size={12} />
            {t('updateBanner.downloading', '下载中')}
          </div>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-soft hover:text-text-dim"
          aria-label={t('updateBanner.close', '关闭更新提示')}
        >
          <IconX size={13} />
        </button>
      </div>
    </div>
  );
}
