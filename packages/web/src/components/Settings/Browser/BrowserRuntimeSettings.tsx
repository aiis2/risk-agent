import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  IconCircleCheck,
  IconDeviceDesktop,
  IconExternalLink,
  IconLink,
  IconLoader2,
  IconRoute,
  IconShare2,
  IconWorld,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  getBrowserState,
  getPreferences,
  putPreferences,
  type BrowserRuntimePreferences,
} from '../../../api/client';
import { getElectronAPI, isElectron } from '../../../lib/electron';
import { Select, SelectItem } from '../../ui/Select';
import { Switch } from '../../ui/Switch';

const DEFAULT_BROWSER_RUNTIME: BrowserRuntimePreferences = {
  defaultProvider: 'embedded-first',
  defaultWorkspaceMode: 'exclusive',
  allowManualAttach: true,
  allowSharedContribution: true,
  externalBrowserMode: 'system-default',
  externalBrowserExecutable: '',
};

const shellCardCls = 'rounded-[26px] border border-border-subtle bg-surface-card shadow-[0_16px_40px_rgba(0,0,0,0.16)]';
const fieldLabelCls = 'text-xs font-semibold uppercase tracking-[0.16em] text-text-subtle';
const fieldHintCls = 'text-xs leading-6 text-text-muted';
const inputCls = 'h-10 w-full rounded-2xl border border-border bg-surface-input px-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent/40';

function MetricTile({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'accent' | 'success';
}) {
  return (
    <div className={clsx(
      'rounded-3xl border px-4 py-4',
      tone === 'accent' && 'border-accent/25 bg-accent/8',
      tone === 'success' && 'border-success/25 bg-success/8',
      tone === 'default' && 'border-border-subtle bg-surface/70',
    )}>
      <div className="flex items-center gap-3">
        <div className={clsx(
          'flex h-10 w-10 items-center justify-center rounded-2xl border text-sm',
          tone === 'accent' && 'border-accent/25 bg-accent/10 text-accent',
          tone === 'success' && 'border-success/25 bg-success/10 text-success',
          tone === 'default' && 'border-border-subtle bg-surface-card text-text-muted',
        )}>
          {icon}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-text-subtle">{label}</p>
          <p className="mt-1 text-lg font-semibold text-text">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-3xl border border-border-subtle bg-surface/70 px-4 py-4">
      <div>
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="mt-1 text-xs leading-6 text-text-muted">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function BrowserRuntimeSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<BrowserRuntimePreferences>(DEFAULT_BROWSER_RUNTIME);
  const [openingHost, setOpeningHost] = useState(false);

  const preferencesQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
    staleTime: 60_000,
  });
  const browserStateQuery = useQuery({
    queryKey: ['browser', 'state'],
    queryFn: getBrowserState,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (preferencesQuery.data?.browserRuntime) {
      setDraft(preferencesQuery.data.browserRuntime);
    }
  }, [preferencesQuery.data?.browserRuntime]);

  const saveMutation = useMutation({
    mutationFn: (nextDraft: BrowserRuntimePreferences) => putPreferences({ browserRuntime: nextDraft }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['browser', 'state'] }),
      ]);
    },
  });

  const remoteDraft = preferencesQuery.data?.browserRuntime;
  const isDirty = remoteDraft ? JSON.stringify(remoteDraft) !== JSON.stringify(draft) : false;
  const hostAvailable = browserStateQuery.data?.hostAvailable ?? false;
  const workspacesCount = browserStateQuery.data?.workspaces.length ?? 0;
  const tabsCount = browserStateQuery.data?.tabs.length ?? 0;
  const bindingsCount = browserStateQuery.data?.bindings.length ?? 0;

  async function handleOpenBrowserHost() {
    const electron = getElectronAPI();
    if (!electron) {
      return;
    }

    try {
      setOpeningHost(true);
      await electron.openBrowserHost();
    } finally {
      setOpeningHost(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className={clsx(shellCardCls, 'relative overflow-hidden px-5 py-5')}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(107,138,254,0.22),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(74,211,197,0.14),transparent_32%)]" />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className={fieldLabelCls}>{t('settings.browser.eyebrow', 'Browser Runtime')}</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-text">
                {t('settings.browser.title', '为会话绑定可共享的内置浏览器工作区')}
              </h3>
              <p className="mt-2 max-w-[72ch] text-sm leading-7 text-text-muted">
                {t('settings.browser.description', '这里决定 Playwright 默认优先走内置 Browser Host 还是外部浏览器，并控制工作区共享、手动附着和外部浏览器回退策略。')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigate('/browser')}
                className="inline-flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-accent/35 hover:text-accent"
              >
                <IconRoute size={16} />
                {t('settings.browser.openWorkspace', '打开 Browser Workspace')}
              </button>
              {isElectron() && (
                <button
                  type="button"
                  onClick={handleOpenBrowserHost}
                  disabled={openingHost}
                  className="inline-flex items-center gap-2 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/15 disabled:opacity-60"
                >
                  {openingHost ? <IconLoader2 size={16} className="animate-spin" /> : <IconDeviceDesktop size={16} />}
                  {t('settings.browser.openHostWindow', '打开 Browser Host 窗口')}
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile icon={<IconDeviceDesktop size={18} />} label={t('settings.browser.metrics.host', 'Host')} value={hostAvailable ? t('settings.browser.hostAvailable', '已接入') : t('settings.browser.hostUnavailable', '未接入')} tone={hostAvailable ? 'success' : 'default'} />
            <MetricTile icon={<IconWorld size={18} />} label={t('settings.browser.metrics.workspaces', 'Workspaces')} value={String(workspacesCount)} tone="accent" />
            <MetricTile icon={<IconLink size={18} />} label={t('settings.browser.metrics.tabs', 'Tabs')} value={String(tabsCount)} />
            <MetricTile icon={<IconShare2 size={18} />} label={t('settings.browser.metrics.bindings', 'Bindings')} value={String(bindingsCount)} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
        <div className={clsx(shellCardCls, 'p-5')}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
              <IconRoute size={18} />
            </div>
            <div>
              <p className={fieldLabelCls}>{t('settings.browser.defaultFlowEyebrow', 'Default Flow')}</p>
              <h4 className="mt-1 text-base font-semibold text-text">{t('settings.browser.defaultFlowTitle', '默认浏览器路由')}</h4>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className={fieldLabelCls}>{t('settings.browser.defaultProviderLabel', '默认提供方')}</span>
              <Select value={draft.defaultProvider} onValueChange={(value) => setDraft((prev) => ({ ...prev, defaultProvider: value as BrowserRuntimePreferences['defaultProvider'] }))}>
                <SelectItem value="embedded-first">{t('settings.browser.providers.embeddedFirst', '优先使用内置 Browser Host')}</SelectItem>
                <SelectItem value="external-preferred">{t('settings.browser.providers.externalPreferred', '优先使用外部浏览器')}</SelectItem>
                <SelectItem value="external-only">{t('settings.browser.providers.externalOnly', '仅使用外部浏览器')}</SelectItem>
              </Select>
              <p className={fieldHintCls}>{t('settings.browser.defaultProviderHint', '控制 Playwright 浏览器工具默认先绑定 Electron Browser Host，还是优先退回到系统外部浏览器。')}</p>
            </label>

            <label className="space-y-2">
              <span className={fieldLabelCls}>{t('settings.browser.workspaceModeLabel', '默认工作区模式')}</span>
              <Select value={draft.defaultWorkspaceMode} onValueChange={(value) => setDraft((prev) => ({ ...prev, defaultWorkspaceMode: value as BrowserRuntimePreferences['defaultWorkspaceMode'] }))}>
                <SelectItem value="exclusive">{t('settings.browser.workspaceModes.exclusive', '独占工作区')}</SelectItem>
                <SelectItem value="global-shared">{t('settings.browser.workspaceModes.globalShared', '全局共享工作区')}</SelectItem>
              </Select>
              <p className={fieldHintCls}>{t('settings.browser.workspaceModeHint', '独占模式隔离的是会话与标签工作区，不再单独切分浏览器资料；共享模式允许多个会话围绕同一组标签页协作。')}</p>
            </label>
          </div>
        </div>

        <div className={clsx(shellCardCls, 'p-5')}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
              <IconShare2 size={18} />
            </div>
            <div>
              <p className={fieldLabelCls}>{t('settings.browser.sharingEyebrow', 'Sharing')}</p>
              <h4 className="mt-1 text-base font-semibold text-text">{t('settings.browser.sharingTitle', '附着与共享权限')}</h4>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <ToggleRow
              title={t('settings.browser.allowManualAttachLabel', '允许手动附着共享工作区')}
              description={t('settings.browser.allowManualAttachHint', '关闭后，观察者会话只能通过默认共享策略接入，不能手动附着到指定工作区。')}
              checked={draft.allowManualAttach}
              onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, allowManualAttach: checked }))}
            />
            <ToggleRow
              title={t('settings.browser.allowSharedContributionLabel', '允许共享观察者贡献新标签页')}
              description={t('settings.browser.allowSharedContributionHint', '关闭后，共享会话只能浏览当前标签页状态，不能在共享工作区内新建或追加标签页。')}
              checked={draft.allowSharedContribution}
              onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, allowSharedContribution: checked }))}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr,auto]">
        <div className={clsx(shellCardCls, 'p-5')}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
              <IconExternalLink size={18} />
            </div>
            <div>
              <p className={fieldLabelCls}>{t('settings.browser.externalEyebrow', 'External Fallback')}</p>
              <h4 className="mt-1 text-base font-semibold text-text">{t('settings.browser.externalTitle', '外部浏览器回退')}</h4>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[220px,1fr]">
            <label className="space-y-2">
              <span className={fieldLabelCls}>{t('settings.browser.externalModeLabel', '回退模式')}</span>
              <Select value={draft.externalBrowserMode} onValueChange={(value) => setDraft((prev) => ({ ...prev, externalBrowserMode: value as BrowserRuntimePreferences['externalBrowserMode'] }))}>
                <SelectItem value="system-default">{t('settings.browser.externalModes.systemDefault', '系统默认浏览器')}</SelectItem>
                <SelectItem value="configured">{t('settings.browser.externalModes.configured', '指定可执行文件')}</SelectItem>
              </Select>
            </label>

            <label className="space-y-2">
              <span className={fieldLabelCls}>{t('settings.browser.externalExecutableLabel', '浏览器可执行文件')}</span>
              <input
                value={draft.externalBrowserExecutable}
                onChange={(event) => setDraft((prev) => ({ ...prev, externalBrowserExecutable: event.target.value }))}
                placeholder={t('settings.browser.externalExecutablePlaceholder', '例如 C:/Program Files/Google/Chrome/Application/chrome.exe')}
                disabled={draft.externalBrowserMode !== 'configured'}
                className={clsx(inputCls, draft.externalBrowserMode !== 'configured' && 'cursor-not-allowed opacity-60')}
              />
              <p className={fieldHintCls}>{t('settings.browser.externalExecutableHint', '仅在“指定可执行文件”模式下生效，用于在 Browser Host 不可用时明确回退目标。')}</p>
            </label>
          </div>
        </div>

        <div className="flex items-end justify-end gap-2">
          <button
            type="button"
            onClick={() => remoteDraft && setDraft(remoteDraft)}
            disabled={!isDirty || saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl border border-border-subtle bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-border hover:bg-surface-card disabled:opacity-50"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate(draft)}
            disabled={!isDirty || saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? <IconLoader2 size={16} className="animate-spin" /> : saveMutation.isSuccess && !isDirty ? <IconCircleCheck size={16} /> : <IconWorld size={16} />}
            {saveMutation.isPending ? t('common.saving', '保存中…') : t('common.save', '保存')}
          </button>
        </div>
      </section>
    </div>
  );
}