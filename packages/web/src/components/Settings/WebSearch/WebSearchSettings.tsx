/**
 * WebSearchSettings — 网络搜索服务设置
 * 参考 Cherry Studio 实现，支持多个搜索服务商的 API 密钥配置。
 * 配置持久化到服务端 preferences，便于 Chat / CLI agent 直接读取与修改。
 */

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  IconSearch,
  IconWorld,
  IconKey,
  IconCheck,
  IconChevronRight,
  IconLoader2,
  IconBrandGoogle,
  IconBrandBing,
  IconSparkles,
  IconAlertCircle,
  IconExternalLink,
} from '@tabler/icons-react';
import { getPreferences, putPreferences, testWebSearch, type WebSearchConfig, type WebSearchTestResponse } from '../../../api/client';
import { ScrollArea } from '../../ui/ScrollArea';
import { Switch } from '../../ui/Switch';

// ─── Provider definitions ────────────────────────────────────────────────────

interface SearchProvider {
  id: string;
  name: string;
  group: 'api' | 'local';
  description: string;
  requiresApiKey: boolean;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
  apiKeyHint?: string;
  endpointLabel?: string;
  endpointPlaceholder?: string;
  docsUrl?: string;
  settingsUrl?: string;
  recommendedQuery?: string;
  icon?: React.ReactNode;
}

const PROVIDERS: SearchProvider[] = [
  // API 服务商
  {
    id: 'tavily',
    name: 'Tavily',
    group: 'api',
    description: '适合联网问答、研究检索和时效性信息补充，优先返回高质量摘要结果。',
    requiresApiKey: true,
    apiKeyLabel: 'API 密钥',
    apiKeyPlaceholder: 'tvly-xxxxxxxxxxxx',
    apiKeyHint: '从 https://tavily.com 获取 API 密钥',
    docsUrl: 'https://tavily.com',
    recommendedQuery: 'Tavily latest release notes',
  },
  {
    id: 'searxng',
    name: 'Searxng',
    group: 'api',
    description: '适合自建聚合搜索，便于统一管理多个公开搜索源和隐私策略。',
    requiresApiKey: false,
    endpointLabel: '服务端点',
    endpointPlaceholder: 'http://localhost:8080',
    apiKeyHint: '可自建 Searxng 实例，无需 API 密钥',
    docsUrl: 'https://docs.searxng.org',
    recommendedQuery: 'Searxng public instances',
  },
  {
    id: 'exa',
    name: 'Exa',
    group: 'api',
    description: '适合语义网页搜索与知识发现，结果更偏研发与技术内容。',
    requiresApiKey: true,
    apiKeyLabel: 'API 密钥',
    apiKeyPlaceholder: 'exa-xxxxxxxxxxxx',
    apiKeyHint: '从 https://exa.ai 获取 API 密钥',
    docsUrl: 'https://exa.ai',
    recommendedQuery: 'Exa AI developer updates',
  },
  {
    id: 'examcp',
    name: 'ExaMCP',
    group: 'api',
    description: '通过 MCP 接入 Exa，适合把搜索能力直接接入工具链和代理工作流。',
    requiresApiKey: true,
    apiKeyLabel: 'API 密钥',
    apiKeyPlaceholder: 'exa-xxxxxxxxxxxx',
    apiKeyHint: '使用 Exa 的 MCP 接口模式，需要 Exa API 密钥',
    docsUrl: 'https://exa.ai',
    recommendedQuery: 'Exa MCP integration',
  },
  {
    id: 'bocha',
    name: 'Bocha',
    group: 'api',
    description: '偏中文语境与问答摘要，适合本地化搜索和中文内容补充。',
    requiresApiKey: true,
    apiKeyLabel: 'API 密钥',
    apiKeyPlaceholder: 'sk-xxxxxxxxxxxx',
    apiKeyHint: '从 https://open.bochaai.com 获取 API 密钥',
    docsUrl: 'https://open.bochaai.com',
    recommendedQuery: '博查 AI 开放平台',
  },
  {
    id: 'zhipu',
    name: 'Zhipu',
    group: 'api',
    description: '适合中文互联网检索与智谱生态整合。',
    requiresApiKey: true,
    apiKeyLabel: 'API 密钥',
    apiKeyPlaceholder: 'xxxxxxxxxxxx.xxxxxxxxxxxxxxxx',
    apiKeyHint: '从智谱 AI 开放平台获取 API 密钥',
    docsUrl: 'https://open.bigmodel.cn',
    recommendedQuery: '智谱 AI 开放平台 搜索',
  },
  {
    id: 'querit',
    name: 'Querit',
    group: 'api',
    description: '适合通用网页问答与搜索结果摘要。',
    requiresApiKey: true,
    apiKeyLabel: 'API 密钥',
    apiKeyPlaceholder: 'sk-xxxxxxxxxxxx',
    apiKeyHint: '从 https://querit.io 获取 API 密钥',
    docsUrl: 'https://querit.io',
    recommendedQuery: 'Querit docs',
  },
  // 本地搜索（直接调用搜索引擎，无需 API 密钥）
  {
    id: 'google',
    name: 'Google',
    group: 'local',
    description: '直接使用浏览器访问 Google 搜索，适合无需额外密钥的轻量联网检索。',
    requiresApiKey: false,
    icon: <IconBrandGoogle size={14} />,
    apiKeyHint: '通过浏览器直接访问 Google 搜索，无需 API 密钥',
    settingsUrl: 'https://www.google.com/preferences',
    recommendedQuery: 'Google Search Console latest updates',
  },
  {
    id: 'bing',
    name: 'Bing',
    group: 'local',
    description: '直接使用浏览器访问 Bing 搜索，适合微软生态与公开网页快速检索。',
    requiresApiKey: false,
    icon: <IconBrandBing size={14} />,
    apiKeyHint: '通过浏览器直接访问 Bing 搜索，无需 API 密钥',
    settingsUrl: 'https://www.bing.com/account/general',
    recommendedQuery: 'Microsoft Copilot announcements',
  },
  {
    id: 'baidu',
    name: 'Baidu',
    group: 'local',
    description: '直接使用浏览器访问百度搜索，适合中文网页、资讯与站点检索。',
    requiresApiKey: false,
    apiKeyHint: '通过浏览器直接访问百度搜索，无需 API 密钥',
    settingsUrl: 'https://www.baidu.com/gaoji/preferences.html',
    recommendedQuery: '百度搜索 最新功能',
  },
];

function defaultConfig(): WebSearchConfig {
  return {
    defaultProvider: 'searxng',
    includeDate: true,
    resultCount: 5,
    compressionMethod: 'none',
    blacklist: '',
    providerEnabled: {},
    providerApiKey: {},
    providerEndpoint: {},
  };
}

// ─── Provider icon (text-based) ──────────────────────────────────────────────

function ProviderIconText({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-[11px] font-semibold text-text-muted">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function WebSearchSettings() {
  const queryClient = useQueryClient();
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['preferences'],
    queryFn: getPreferences,
  });
  const [cfg, setCfg] = useState<WebSearchConfig>(defaultConfig);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState('Tavily latest release notes');
  const [testResult, setTestResult] = useState<WebSearchTestResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (nextConfig: WebSearchConfig) => putPreferences({ webSearch: nextConfig }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider) throw new Error('请先选择搜索引擎');
      await saveMutation.mutateAsync(cfg);
      return testWebSearch({
        query: testQuery.trim(),
        provider: selectedProvider.id,
        limit: Math.min(cfg.resultCount, 5),
      });
    },
    onSuccess: (result) => {
      setTestError(null);
      setTestResult(result);
    },
    onError: (error) => {
      setTestResult(null);
      setTestError(error instanceof Error ? error.message : '搜索测试失败');
    },
  });

  const selectedProvider = selectedId ? PROVIDERS.find((p) => p.id === selectedId) ?? null : null;
  const selectedProviderEnabled = selectedProvider ? (cfg.providerEnabled[selectedProvider.id] ?? true) : false;

  useEffect(() => {
    const serverConfig = preferences?.webSearch;
    if (!serverConfig) {
      return;
    }

    const nextConfig: WebSearchConfig = {
      ...defaultConfig(),
      ...serverConfig,
      providerEnabled: serverConfig.providerEnabled ?? {},
      providerApiKey: serverConfig.providerApiKey ?? {},
      providerEndpoint: serverConfig.providerEndpoint ?? {},
    };

    setCfg(nextConfig);
    setSelectedId((prev) => (prev === null || PROVIDERS.some((provider) => provider.id === prev) ? prev : null));
  }, [preferences?.webSearch]);

  useEffect(() => {
    if (!saved) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  function updateCfg(patch: Partial<WebSearchConfig>) {
    setSaved(false);
    setCfg((prev) => ({ ...prev, ...patch }));
  }

  function updateProviderKey(id: string, key: string) {
    setSaved(false);
    setCfg((prev) => ({
      ...prev,
      providerApiKey: { ...prev.providerApiKey, [id]: key },
    }));
  }

  function updateProviderEndpoint(id: string, endpoint: string) {
    setSaved(false);
    setCfg((prev) => ({
      ...prev,
      providerEndpoint: { ...prev.providerEndpoint, [id]: endpoint },
    }));
  }

  function toggleProvider(id: string) {
    const current = cfg.providerEnabled[id] ?? true;
    setSaved(false);
    setCfg((prev) => ({
      ...prev,
      providerEnabled: { ...prev.providerEnabled, [id]: !current },
    }));
  }

  function openProviderSettings(url?: string) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const apiGroup = PROVIDERS.filter((p) => p.group === 'api');
  const localGroup = PROVIDERS.filter((p) => p.group === 'local');

  const inputCls = 'h-9 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none transition-colors';

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-surface-card text-sm text-text-muted">
        <span className="inline-flex items-center gap-2">
          <IconLoader2 size={14} className="animate-spin" />
          正在加载网络搜索配置…
        </span>
      </div>
    );
  }

  return (
    <div className="grid min-h-[600px] gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      {/* ── LEFT: provider list ── */}
      <aside className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-card">
        <div className="shrink-0 border-b border-border px-3 py-3">
          <div className="relative">
            <IconSearch size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              readOnly
              placeholder="网络搜索"
              className="w-full rounded-lg border border-border-subtle bg-surface-input py-1.5 pl-7 pr-3 text-sm font-semibold text-text placeholder:text-text focus:outline-none"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border-subtle bg-surface px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-subtle">可用引擎</p>
              <p className="mt-1 text-sm font-semibold text-text">{PROVIDERS.filter((provider) => cfg.providerEnabled[provider.id] ?? true).length}</p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-surface px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-subtle">默认</p>
              <p className="mt-1 truncate text-sm font-semibold text-text">
                {PROVIDERS.find((p) => p.id === cfg.defaultProvider)?.name ?? cfg.defaultProvider}
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 p-2">
          {/* 全局设置入口 */}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={clsx(
              'group flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors',
              selectedId === null ? 'bg-accent/10' : 'hover:bg-surface-hover'
            )}
          >
            <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', selectedId === null ? 'text-accent' : 'text-text-muted')}>
              <IconWorld size={14} />
            </span>
            <span className={clsx('flex-1 truncate text-sm', selectedId === null ? 'font-medium text-accent' : 'text-text')}>
              常规设置
            </span>
          </button>

          {/* API 服务商 */}
          <p className="mb-1 px-2 pt-2 text-[10px] uppercase tracking-[0.12em] text-text-subtle">API 服务商</p>
          {apiGroup.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              active={selectedId === p.id}
              enabled={cfg.providerEnabled[p.id] ?? true}
              isDefault={cfg.defaultProvider === p.id}
              onSelect={() => { setSelectedId(p.id); if (p.recommendedQuery) setTestQuery(p.recommendedQuery); }}
            />
          ))}

          {/* 本地搜索 */}
          <p className="mb-1 mt-3 px-2 text-[10px] uppercase tracking-[0.12em] text-text-subtle">本地搜索</p>
          {localGroup.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              active={selectedId === p.id}
              enabled={cfg.providerEnabled[p.id] ?? true}
              isDefault={cfg.defaultProvider === p.id}
              onSelect={() => { setSelectedId(p.id); if (p.recommendedQuery) setTestQuery(p.recommendedQuery); }}
            />
          ))}
        </ScrollArea>
      </aside>

      {/* ── RIGHT: settings panel ── */}
      <section className="flex flex-col gap-4">
        {selectedProvider === null ? (
          /* ── Global settings view (image 4: no provider selected) ── */
          <>
            <div className="rounded-2xl border border-border bg-surface-card p-5">
              <p className="mb-4 text-sm font-semibold text-text">常规设置</p>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-text-muted">默认搜索引擎</label>
                  <select
                    title="默认搜索引擎"
                    value={cfg.defaultProvider}
                    onChange={(e) => updateCfg({ defaultProvider: e.target.value })}
                    className="h-9 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-text focus:border-accent/50 focus:outline-none"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface px-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-text">搜索包含日期</p>
                    <p className="mt-1 text-[11px] leading-5 text-text-muted">适合时效性问题，结果会包含日期偏好。</p>
                  </div>
                  <Switch checked={cfg.includeDate} onCheckedChange={(v) => updateCfg({ includeDate: v })} />
                </div>

                <div className="rounded-xl border border-border-subtle bg-surface px-3 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-text">搜索结果个数</p>
                      <p className="mt-1 text-[11px] leading-5 text-text-muted">每次搜索返回的最大结果数量，限制为 1-20。</p>
                    </div>
                    <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{cfg.resultCount}</span>
                  </div>
                  <input
                    type="range"
                    title="搜索结果个数"
                    min={1}
                    max={20}
                    value={cfg.resultCount}
                    onChange={(e) => updateCfg({ resultCount: Number(e.target.value) })}
                    className="mt-3 w-full accent-[var(--color-accent,#6b8afe)]"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface-card p-5">
              <p className="mb-3 text-sm font-semibold text-text">搜索结果压缩</p>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-text-muted">压缩方法</label>
                <select
                  title="压缩方法"
                  value={cfg.compressionMethod}
                  onChange={(e) => updateCfg({ compressionMethod: e.target.value as WebSearchConfig['compressionMethod'] })}
                  className="h-9 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-text focus:border-accent/50 focus:outline-none"
                >
                  <option value="none">不压缩</option>
                  <option value="summary">LLM 摘要</option>
                  <option value="extract">关键内容提取</option>
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface-card p-5">
              <p className="mb-1.5 text-sm font-semibold text-text">黑名单</p>
              <p className="mb-3 text-xs leading-5 text-text-muted">以下域名的结果不会出现在搜索中</p>
              <textarea
                value={cfg.blacklist}
                onChange={(e) => updateCfg({ blacklist: e.target.value })}
                placeholder={`*.example.com/*\n/example\\.net|org/`}
                rows={5}
                className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-text placeholder:text-text-subtle focus:border-accent/50 focus:outline-none"
              />
            </div>
          </>
        ) : (
          /* ── Provider config view (images 2 & 3: specific provider selected) ── */
          <>
        {/* Provider header + config — Cherry Studio style */}
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-card">
          {/* Header row */}
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface text-text-muted">
                {selectedProvider.icon ?? <ProviderIconText name={selectedProvider.name} />}
              </span>
              <span className="truncate text-sm font-semibold text-text">{selectedProvider.name}</span>
              {(selectedProvider.docsUrl || selectedProvider.settingsUrl) && (
                <button
                  type="button"
                  onClick={() => openProviderSettings(selectedProvider.docsUrl ?? selectedProvider.settingsUrl)}
                  className="shrink-0 text-text-subtle transition-colors hover:text-accent"
                  title="打开文档"
                >
                  <IconExternalLink size={13} />
                </button>
              )}
              {cfg.defaultProvider === selectedProvider.id && (
                <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">默认</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <Switch checked={selectedProviderEnabled} onCheckedChange={() => toggleProvider(selectedProvider.id)} />
              <button
                type="button"
                onClick={() => updateCfg({ defaultProvider: selectedProvider.id })}
                disabled={cfg.defaultProvider === selectedProvider.id}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-40"
              >
                设为默认
              </button>
            </div>
          </div>

          {/* Provider-specific config body */}
          <div className="px-5 py-5">
            {selectedProvider.group === 'api' ? (
              <div className="space-y-5">
                {selectedProvider.requiresApiKey && (
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="text-xs font-medium text-text">
                        <IconKey size={12} className="mr-1 inline" />
                        {selectedProvider.apiKeyLabel ?? 'API 密钥'}
                      </label>
                      <div className="flex items-center gap-3 text-[11px]">
                        {selectedProvider.docsUrl && (
                          <a href={selectedProvider.docsUrl} target="_blank" rel="noreferrer" className="text-accent transition-colors hover:underline">
                            点击这里获取密钥
                          </a>
                        )}
                        <span className="text-text-subtle">多个密钥使用逗号分隔</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (!testQuery.trim() && selectedProvider.recommendedQuery) {
                              setTestQuery(selectedProvider.recommendedQuery);
                            }
                            testMutation.mutate();
                          }}
                          disabled={testMutation.isPending}
                          className="text-accent transition-colors hover:underline disabled:opacity-50"
                        >
                          检测
                        </button>
                      </div>
                    </div>
                    <input
                      type="password"
                      value={cfg.providerApiKey[selectedProvider.id] ?? ''}
                      onChange={(e) => updateProviderKey(selectedProvider.id, e.target.value)}
                      placeholder={selectedProvider.apiKeyPlaceholder ?? 'sk-...'}
                      className={inputCls}
                    />
                  </div>
                )}

                {selectedProvider.endpointLabel && (
                  <div>
                    <label className="mb-2 block text-xs font-medium text-text">{selectedProvider.endpointLabel}</label>
                    <input
                      type="text"
                      value={cfg.providerEndpoint[selectedProvider.id] ?? ''}
                      onChange={(e) => updateProviderEndpoint(selectedProvider.id, e.target.value)}
                      placeholder={selectedProvider.endpointPlaceholder}
                      className={inputCls}
                    />
                  </div>
                )}

                {!selectedProvider.requiresApiKey && !selectedProvider.endpointLabel && selectedProvider.apiKeyHint && (
                  <p className="text-sm leading-6 text-text-muted">{selectedProvider.apiKeyHint}</p>
                )}
              </div>
            ) : (
              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text">本地搜索设置</p>
                  <button
                    type="button"
                    onClick={() => openProviderSettings(selectedProvider.settingsUrl)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <IconExternalLink size={14} />
                    打开 {selectedProvider.name} 设置
                  </button>
                </div>
                <p className="text-sm leading-6 text-text-muted">
                  {selectedProvider.apiKeyHint ?? `登录网站可获得更好的搜索结果，也可对 ${selectedProvider.name} 搜索进行个性化配置。`}
                </p>
                <button
                  type="button"
                  onClick={() => setTestQuery(selectedProvider.recommendedQuery ?? `${selectedProvider.name} search`)}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/30 hover:text-text"
                >
                  使用示例查询
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface-card p-5">
          {/* 连通性测试 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text">连通性测试</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">保存配置后，立即用当前 provider 发送一次真实搜索请求，确认配置已生效。</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] text-text-muted">
              <IconWorld size={12} />
              {selectedProvider.name}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row">
            <input
              type="text"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              placeholder={selectedProvider.recommendedQuery ?? '输入测试查询，例如：Tavily latest release notes'}
              className={clsx(inputCls, 'flex-1')}
            />
            <button
              type="button"
              onClick={() => testMutation.mutate()}
              disabled={!testQuery.trim() || testMutation.isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-4 text-sm font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testMutation.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconSparkles size={14} />}
              测试搜索
            </button>
          </div>

          {testError && (
            <div className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
              <span className="inline-flex items-center gap-2">
                <IconAlertCircle size={14} />
                {testError}
              </span>
            </div>
          )}

          {testResult && (
            <div className="mt-4 rounded-xl border border-success/20 bg-success/5 p-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-success">
                  <IconCheck size={12} />
                  {testResult.provider} 可用
                </span>
                <span>{testResult.elapsedMs} ms</span>
                <span>{testResult.results.length} 条结果</span>
              </div>
              {testResult.answer && (
                <p className="mt-3 text-sm leading-6 text-text">{testResult.answer}</p>
              )}
              <div className="mt-3 space-y-2">
                {testResult.results.slice(0, 3).map((result) => (
                  <a
                    key={result.url}
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-border-subtle bg-surface px-3 py-2 transition-colors hover:border-accent/30"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-text">
                      <span className="truncate">{result.title}</span>
                      <IconExternalLink size={12} className="shrink-0 text-text-subtle" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">{result.content || result.url}</p>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

          </>
        )}

        {/* ── Save bar (always shown) ── */}
        <div className="sticky bottom-0 z-10 rounded-2xl border border-border bg-surface-card/95 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-text-muted">
              {saved ? '配置已保存，Chat / CLI agent 可立即读取。' : '未保存的修改不会进入实际运行配置。'}
            </div>
            <button
              type="button"
              onClick={() => saveMutation.mutate(cfg)}
              disabled={saveMutation.isPending}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saveMutation.isPending ? <IconLoader2 size={14} className="animate-spin" /> : saved ? <IconCheck size={14} /> : null}
              {saveMutation.isPending ? '保存中…' : saved ? '已保存' : '保存设置'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Provider row ─────────────────────────────────────────────────────────────

function ProviderRow({
  provider,
  active,
  enabled,
  isDefault,
  onSelect,
}: {
  provider: SearchProvider;
  active: boolean;
  enabled: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'group flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition-colors',
        active ? 'bg-accent/10' : 'hover:bg-surface-hover'
      )}
    >
      {provider.icon ? (
        <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', active ? 'text-accent' : 'text-text-muted')}>
          {provider.icon}
        </span>
      ) : (
        <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold', active ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-text-subtle')}>
          {provider.name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={clsx('min-w-0 flex-1 truncate text-sm', active ? 'font-medium text-accent' : 'text-text')}>
            {provider.name}
          </span>
          {isDefault && (
            <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[9px] text-success">默认</span>
          )}
          {!enabled && (
            <span className="shrink-0 rounded-full border border-border-subtle bg-surface px-1.5 py-0.5 text-[9px] text-text-subtle">OFF</span>
          )}
        </div>
      </div>
      <IconChevronRight size={12} className={clsx('shrink-0 transition-opacity', active ? 'text-accent' : 'text-text-subtle opacity-0 group-hover:opacity-100')} />
    </button>
  );
}
