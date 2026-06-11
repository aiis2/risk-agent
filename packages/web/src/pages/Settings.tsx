import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconSettings,
  IconDatabase,
  IconCpu,
  IconLink,
  IconBook,
  IconTool,
  IconPlus,
  IconCircleCheck,
  IconActivity,
  IconShield,
  IconAdjustments,
  IconRobot,
  IconDeviceDesktop,
  IconPlayerPlay,
  IconLoader2,
  IconCircleX,
  IconMinus,
  IconChevronDown,
  IconChevronUp,
  IconDroplet,
  IconMoon,
  IconSun,
  IconWorld,
  IconLayout,
  IconRoute,
  IconEye,
  IconBrain,
  IconArrowsSort,
  IconCopy,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  discoverModels,
  createModel,
  deleteModel,
  listModels,
  getPreferences as _getPreferences,
  putPreferences,
  testModel,
  updateModel,
  type DiscoveredModelCatalogItem,
  type ModelConfigPayload,
  type ModelConfigRecord,
  type ModelProviderId,
  type ModelTestResponse,
} from '../api/client';
import { ResponseContent } from '../components/Chat/responseContent';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { Select, SelectItem } from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import { SkillsTabContent } from '../components/Settings/Skills/SkillsTabContent';
import { ToolsRegistryTabContent } from '../components/Settings/Tools/ToolsRegistryTabContent';
import { StorageSettingsPage } from '../components/Settings/Storage/StorageSettingsPage';
import { ObservabilityTab } from '../components/Settings/Observability/ObservabilityTab';
import { DatasourcesTab } from '../components/Settings/DataSources/DatasourcesTab';
import { MCPManagementTab } from '../components/Settings/MCP/MCPManagementTab';
import { SecurityTab } from '../components/Settings/Security/SecurityTab';
import { CustomAgentsTab } from '../components/Settings/Agents/CustomAgentsTab';
import { DesktopSettingsPanel } from '../components/Settings/Desktop/DesktopSettingsPanel';
import { PersonaSection } from '../components/Settings/Personas/PersonaSection';
import { UserProfileSection } from '../components/Settings/UserProfile/UserProfileSection';
import { WebSearchSettings } from '../components/Settings/WebSearch/WebSearchSettings';
import { DisplaySettingsTab } from '../components/Settings/Display/DisplaySettingsTab';
import { GeneralSettingsTab } from '../components/Settings/General/GeneralSettingsTab';
import { BrowserRuntimeSettings } from '../components/Settings/Browser/BrowserRuntimeSettings';
import { isElectron } from '../lib/electron';
import { hasEnabledRealModels } from '../lib/preferredModel';
import { getNextThemeMode, type ThemeMode } from '../lib/theme';
import { usePreferenceStore } from '../stores/preferenceStore';

// ─── Tab definitions ────────────────────────────────────────────────────────

type TabId = 'general' | 'display' | 'browser' | 'models' | 'datasources' | 'mcp' | 'skills' | 'tools' | 'agents' | 'storage' | 'observability' | 'security' | 'desktop' | 'personas' | 'user-profile' | 'websearch';

// 基础 tabs（始终显示）
const BASE_TABS: { id: TabId; labelKey: string; Icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: 'general',        labelKey: 'settings.tabs.general',        Icon: IconSettings        },
  { id: 'display',        labelKey: 'settings.tabs.display',        Icon: IconLayout          },
  { id: 'browser',        labelKey: 'settings.tabs.browser',        Icon: IconRoute           },
  { id: 'models',         labelKey: 'settings.tabs.models',         Icon: IconCpu             },
  { id: 'datasources',    labelKey: 'settings.tabs.datasources',    Icon: IconLink            },
  { id: 'mcp',            labelKey: 'settings.tabs.mcp',            Icon: IconCpu             },
  { id: 'skills',         labelKey: 'settings.tabs.skills',         Icon: IconBook            },
  { id: 'tools',          labelKey: 'settings.tabs.tools',          Icon: IconTool            },
  { id: 'agents',         labelKey: 'settings.tabs.agents',         Icon: IconRobot           },
  { id: 'websearch',      labelKey: 'settings.tabs.webSearch',      Icon: IconWorld           },
  { id: 'storage',        labelKey: 'settings.tabs.storage',        Icon: IconDatabase        },
  { id: 'observability',  labelKey: 'settings.tabs.observability',  Icon: IconActivity        },
  { id: 'security',       labelKey: 'settings.tabs.security',       Icon: IconShield          },
  { id: 'personas',       labelKey: 'settings.tabs.personas',       Icon: IconRobot           },
  { id: 'user-profile',   labelKey: 'settings.tabs.userProfile',    Icon: IconAdjustments     },
];

// 桌面专属 tab（仅 Electron 环境显示）
const DESKTOP_TAB = { id: 'desktop' as TabId, labelKey: 'settings.tabs.desktop', Icon: IconDeviceDesktop };

// ─── Shared input style ──────────────────────────────────────────────────────

const inputCls = 'w-full h-8 rounded-lg border border-border bg-surface-input px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors';
const btnPrimaryCls = 'flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/25';

const MODEL_PROVIDER_OPTIONS: Array<{
  value: ModelProviderId;
  label: string;
  protocol: string;
  endpointHint: string;
  helper: string;
}> = [
  {
    value: 'openai',
    label: 'OpenAI',
    protocol: 'OpenAI Tools',
    endpointHint: '官方 / 自定义 OpenAI endpoint',
    helper: '适合 OpenAI 官方模型，支持 OpenAI tools 与 SSE 输出。',
  },
  {
    value: 'openai-compatible',
    label: 'OpenAI Compatible',
    protocol: 'OpenAI Tools',
    endpointHint: '例如 https://coding.dashscope.aliyuncs.com/v1',
    helper: '适合 DashScope、兼容 OpenAI 协议的第三方服务，沿用 OpenAI tools 协议。',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    protocol: 'OpenAI Tools',
    endpointHint: 'https://openrouter.ai/api/v1',
    helper: '聚合型 OpenAI-compatible 网关，统一接入不同上游模型。',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    protocol: 'Anthropic Messages',
    endpointHint: '官方 / 自定义 Anthropic endpoint',
    helper: '适合 Claude 官方模型，工具调用遵循 Anthropic Messages 协议。',
  },
  {
    value: 'anthropic-compatible',
    label: 'Anthropic Compatible',
    protocol: 'Anthropic Messages',
    endpointHint: '输入兼容 Anthropic 的网关地址',
    helper: '适合兼容 Anthropic Messages 的第三方服务，保留原生 tool_use 行为。',
  },
  {
    value: 'ollama',
    label: 'Ollama',
    protocol: 'Local Chat',
    endpointHint: 'http://localhost:11434',
    helper: '本地模型运行时，不需要 API Key，建议配置基础地址。',
  },
  {
    value: 'mock',
    label: 'Mock',
    protocol: 'Mock Stream',
    endpointHint: '无需配置 endpoint',
    helper: '开发调试用 provider，用于验证 SSE 与前端流式渲染。',
  },
];

const SIDEBAR_THEME_META: Record<ThemeMode, {
  label: string;
  description: string;
  swatch: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}> = {
  system: {
    label: '跟随系统',
    description: '自动匹配系统浅色或深色。',
    swatch: 'from-[#0f1220] via-[#6b8afe] to-[#f3f6fb]',
    Icon: IconDeviceDesktop,
  },
  midnight: {
    label: 'Midnight',
    description: '深色蓝调工作台。',
    swatch: 'from-[#0f1220] via-[#161a2c] to-[#6b8afe]',
    Icon: IconMoon,
  },
  paper: {
    label: 'Paper',
    description: '浅色高对比审阅模式。',
    swatch: 'from-[#f3f6fb] via-[#ffffff] to-[#3058dc]',
    Icon: IconSun,
  },
  sea: {
    label: 'Sea',
    description: '冷色结构化视图。',
    swatch: 'from-[#0a171f] via-[#113240] to-[#4ad3c5]',
    Icon: IconDroplet,
  },
};

function getProviderMeta(provider: ModelProviderId) {
  return MODEL_PROVIDER_OPTIONS.find((item) => item.value === provider) ?? MODEL_PROVIDER_OPTIONS[0];
}

function readConfigString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function readConfigNumberString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function readConfigBoolean(config: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readConfigStringArray(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function getDefaultBaseUrl(provider: ModelProviderId): string {
  if (provider === 'mock') return '';
  if (provider === 'ollama') return 'http://localhost:11434';
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'anthropic' || provider === 'anthropic-compatible') return 'https://api.anthropic.com';
  return 'https://coding.dashscope.aliyuncs.com/v1';
}

// ─── Models Tab ──────────────────────────────────────────────────────────────

type ModelFormState = {
  provider: ModelProviderId;
  modelName: string;
  displayName: string;
  groupName: string;
  baseUrl: string;
  apiKey: string;
  apiKeyMasked: string;
  enabled: boolean;
  isDefault: boolean;
  capabilities: string;
  inputPrice: string;
  outputPrice: string;
  pricingCurrency: string;
  streamOutput: boolean;
  temperature: string;
  maxTokens: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
};

const DEFAULT_MODEL_TEST_PROMPT = [
  '请用中文输出一段 Markdown 风险摘要。',
  '',
  '要求：',
  '- 先给出一句结论',
  '- 再给出一个无序列表',
  '- 最后补一个 json 代码块',
].join('\n');

type ModelTestMode = 'connect' | 'call' | 'stream';

function createModelFormState(model?: ModelConfigRecord): ModelFormState {
  const provider = model?.provider ?? 'openai-compatible';
  return {
    provider,
    modelName: model?.modelName ?? '',
    displayName: readConfigString(model?.config ?? {}, 'displayName') || (model?.modelName ?? ''),
    groupName: readConfigString(model?.config ?? {}, 'groupName') || getModelNamespace(model?.modelName ?? '') || '',
    baseUrl: readConfigString(model?.config ?? {}, 'baseUrl') || getDefaultBaseUrl(provider),
    apiKey: '',
    apiKeyMasked: readConfigString(model?.config ?? {}, 'apiKeyMasked'),
    enabled: model?.enabled ?? true,
    isDefault: model?.isDefault ?? false,
    capabilities: readConfigStringArray(model?.config ?? {}, 'capabilities').join(', '),
    inputPrice: readConfigNumberString(model?.config ?? {}, 'inputPrice'),
    outputPrice: readConfigNumberString(model?.config ?? {}, 'outputPrice'),
    pricingCurrency: readConfigString(model?.config ?? {}, 'pricingCurrency') || 'USD',
    streamOutput: readConfigBoolean(model?.config ?? {}, 'streamOutput', true),
    temperature: readConfigNumberString(model?.config ?? {}, 'temperature'),
    maxTokens: readConfigNumberString(model?.config ?? {}, 'maxTokens'),
    topP: readConfigNumberString(model?.config ?? {}, 'topP'),
    presencePenalty: readConfigNumberString(model?.config ?? {}, 'presencePenalty'),
    frequencyPenalty: readConfigNumberString(model?.config ?? {}, 'frequencyPenalty'),
  };
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function shouldPreventMockDefault(provider: ModelProviderId, models: ModelConfigRecord[], currentModelId?: string): boolean {
  return provider === 'mock' && hasEnabledRealModels(models, currentModelId);
}

function resolveModelDefaultFlag(form: ModelFormState, models: ModelConfigRecord[], currentModelId?: string): boolean {
  return form.isDefault && !shouldPreventMockDefault(form.provider, models, currentModelId);
}

function buildModelPayload(form: ModelFormState, models: ModelConfigRecord[] = [], currentModelId?: string): ModelConfigPayload {
  const config: Record<string, unknown> = {};
  const showEndpoint = form.provider !== 'mock';
  const showApiKey = !['mock', 'ollama'].includes(form.provider);
  const capabilities = form.capabilities.split(/[,，]/).map((item) => item.trim()).filter(Boolean);

  if (showEndpoint && form.baseUrl.trim()) config.baseUrl = form.baseUrl.trim();
  if (showApiKey && form.apiKey.trim()) config.apiKey = form.apiKey.trim();
  if (form.displayName.trim()) config.displayName = form.displayName.trim();
  if (form.groupName.trim()) config.groupName = form.groupName.trim();
  if (capabilities.length) config.capabilities = Array.from(new Set(capabilities));
  config.streamOutput = form.streamOutput;

  const inputPrice = parseOptionalNumber(form.inputPrice);
  const outputPrice = parseOptionalNumber(form.outputPrice);
  if (inputPrice !== undefined) config.inputPrice = inputPrice;
  if (outputPrice !== undefined) config.outputPrice = outputPrice;
  if (form.pricingCurrency.trim()) config.pricingCurrency = form.pricingCurrency.trim().toUpperCase();

  const temperature = parseOptionalNumber(form.temperature);
  const maxTokens = parseOptionalNumber(form.maxTokens);
  const topP = parseOptionalNumber(form.topP);
  const presencePenalty = parseOptionalNumber(form.presencePenalty);
  const frequencyPenalty = parseOptionalNumber(form.frequencyPenalty);

  if (temperature !== undefined) config.temperature = temperature;
  if (maxTokens !== undefined) config.maxTokens = maxTokens;
  if (topP !== undefined) config.topP = topP;
  if (presencePenalty !== undefined) config.presencePenalty = presencePenalty;
  if (frequencyPenalty !== undefined) config.frequencyPenalty = frequencyPenalty;

  return {
    provider: form.provider,
    modelName: form.modelName.trim(),
    isDefault: resolveModelDefaultFlag(form, models, currentModelId),
    enabled: form.enabled,
    config,
  };
}

// ─── Model dialog helpers ────────────────────────────────────────────────────

const CAPABILITY_OPTIONS: { id: string; label: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }[] = [
  { id: 'vision', label: '视觉', icon: IconEye },
  { id: 'web-search', label: '联网', icon: IconWorld },
  { id: 'reasoning', label: '推理', icon: IconBrain },
  { id: 'tools', label: '工具', icon: IconTool },
  { id: 'rerank', label: '重排', icon: IconArrowsSort },
  { id: 'embedding', label: '嵌入', icon: IconDatabase },
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: '$ USD' },
  { value: 'CNY', label: '¥ CNY' },
  { value: 'EUR', label: '€ EUR' },
];

function toggleCapabilityInString(caps: string, capId: string): string {
  const arr = caps.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const idx = arr.indexOf(capId);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(capId);
  return arr.join(', ');
}

function hasCapabilityInString(caps: string, capId: string): boolean {
  return caps.split(/[,，]/).map((s) => s.trim()).includes(capId);
}

function formatEndpoint(model: ModelConfigRecord): string {
  return readConfigString(model.config, 'baseUrl') || (model.provider === 'mock' ? '无需 endpoint' : '使用默认 endpoint');
}

// ─── Provider group helpers (Cherry-Studio style) ─────────────────────────────

type ProviderGroup = {
  key: string;
  provider: ModelProviderId;
  baseUrl: string;
  apiKeyMasked: string;
  providerAlias: string;
  models: ModelConfigRecord[];
};

const PROVIDER_DOT_CLASS: Record<string, string> = {
  openai: 'bg-[#10a37f]',
  'openai-compatible': 'bg-accent',
  openrouter: 'bg-[#7c3aed]',
  anthropic: 'bg-[#d97706]',
  'anthropic-compatible': 'bg-[#b45309]',
  ollama: 'bg-[#4b5563]',
  mock: 'bg-[#374151]',
};

function getProviderDotClass(provider: string): string {
  return PROVIDER_DOT_CLASS[provider] ?? 'bg-accent';
}

function getModelNamespace(modelName: string): string {
  if (modelName.includes('/')) return modelName.split('/')[0];
  return '';
}

function getModelDisplayName(model: ModelConfigRecord): string {
  return readConfigString(model.config, 'displayName') || model.modelName;
}

function getModelGroupName(model: ModelConfigRecord): string {
  return readConfigString(model.config, 'groupName') || getModelNamespace(model.modelName) || getProviderMeta(model.provider as ModelProviderId).label;
}

function getModelCapabilities(model: ModelConfigRecord): string[] {
  return readConfigStringArray(model.config, 'capabilities');
}

function formatModelPricing(model: ModelConfigRecord): string | null {
  const inputPrice = readConfigNumberString(model.config, 'inputPrice');
  const outputPrice = readConfigNumberString(model.config, 'outputPrice');
  const currency = readConfigString(model.config, 'pricingCurrency') || 'USD';
  if (!inputPrice && !outputPrice) return null;
  if (inputPrice && outputPrice) return `${currency} ${inputPrice} / ${outputPrice} / 1M`;
  return `${currency} ${inputPrice || outputPrice} / 1M`;
}

function groupDisplayName(group: ProviderGroup, allGroups: ProviderGroup[]): string {
  if (group.providerAlias.trim()) return group.providerAlias.trim();
  const meta = getProviderMeta(group.provider);
  const sameType = allGroups.filter((g) => g.provider === group.provider);
  if (sameType.length <= 1) return meta.label;
  if (group.baseUrl) {
    try {
      const url = new URL(group.baseUrl);
      return `${meta.label} (${url.hostname})`;
    } catch {
      return meta.label;
    }
  }
  return meta.label;
}

function getParamSummary(model: ModelConfigRecord): string[] {
  const summary: string[] = [];
  const temperature = readConfigNumberString(model.config, 'temperature');
  const maxTokens = readConfigNumberString(model.config, 'maxTokens');
  const topP = readConfigNumberString(model.config, 'topP');
  const presencePenalty = readConfigNumberString(model.config, 'presencePenalty');
  const frequencyPenalty = readConfigNumberString(model.config, 'frequencyPenalty');

  if (temperature) summary.push(`temperature ${temperature}`);
  if (maxTokens) summary.push(`maxTokens ${maxTokens}`);
  if (topP) summary.push(`topP ${topP}`);
  if (presencePenalty) summary.push(`presence ${presencePenalty}`);
  if (frequencyPenalty) summary.push(`frequency ${frequencyPenalty}`);
  return summary;
}

function ModelsTab() {
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ['models'], queryFn: listModels });

  // ── Editor state ──────────────────────────────────────────────────────────
  const [form, setForm] = useState<ModelFormState>(() => createModelFormState());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfigRecord | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  // ── Test state ────────────────────────────────────────────────────────────
  const [testingModel, setTestingModel] = useState<ModelConfigRecord | null>(null);
  const [testMode, setTestMode] = useState<ModelTestMode>('connect');
  const [testPrompt, setTestPrompt] = useState(DEFAULT_MODEL_TEST_PROMPT);
  const [testResult, setTestResult] = useState<ModelTestResponse | null>(null);

  // ── Discovery state ───────────────────────────────────────────────────────
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModelCatalogItem[]>([]);
  const [selectedDiscoveredModelIds, setSelectedDiscoveredModelIds] = useState<string[]>([]);
  const [discoveredCatalogKey, setDiscoveredCatalogKey] = useState('');
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);

  // ── Provider group state (Cherry-Studio style) ────────────────────────────
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editProviderAlias, setEditProviderAlias] = useState('');

  // ── Model dialog more-settings collapse state ───────────────────────────
  const [showMoreSettings, setShowMoreSettings] = useState(false);

  // ── Quick add state ───────────────────────────────────────────────────────
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddModelId, setQuickAddModelId] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  // ── Derived data ──────────────────────────────────────────────────────────
  const modelList = models.data ?? [];
  const backendOffline = models.isError;
  const modelsErrorMessage = models.error ? readModelRequestError(models.error, '模型服务暂时不可用') : null;

  const groups = useMemo(() => {
    const map = new Map<string, ProviderGroup>();
    for (const m of modelList) {
      const baseUrl = readConfigString(m.config, 'baseUrl') || '';
      const apiKeyMasked = readConfigString(m.config, 'apiKeyMasked') || '';
      const providerAlias = readConfigString(m.config, 'providerAlias');
      const key = `${m.provider}::${baseUrl}`;
      if (!map.has(key)) {
        map.set(key, { key, provider: m.provider as ModelProviderId, baseUrl, apiKeyMasked, providerAlias, models: [] });
      }
      const group = map.get(key)!;
      if (!group.apiKeyMasked && apiKeyMasked) group.apiKeyMasked = apiKeyMasked;
      if (!group.providerAlias && providerAlias) group.providerAlias = providerAlias;
      group.models.push(m);
    }
    return Array.from(map.values());
  }, [modelList]);

  const selectedGroup = groups.find((g) => g.key === selectedGroupKey) ?? groups[0] ?? null;

  useEffect(() => {
    if (selectedGroup && selectedGroup.key !== selectedGroupKey) setSelectedGroupKey(selectedGroup.key);
  }, [selectedGroup?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedGroup) {
      setEditApiKey('');
      setEditBaseUrl(selectedGroup.baseUrl);
      setEditProviderAlias(selectedGroup.providerAlias);
    }
  }, [selectedGroup?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentCatalogKey = `${form.provider}::${form.baseUrl.trim()}`;
  const isCurrentCatalog = discoveredCatalogKey === currentCatalogKey;
  const visibleDiscoveredModels = isCurrentCatalog ? discoveredModels : [];

  const modelsByGroupName = useMemo(() => {
    if (!selectedGroup) return {} as Record<string, ModelConfigRecord[]>;
    return selectedGroup.models.reduce((acc, m) => {
      const groupName = getModelGroupName(m);
      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(m);
      return acc;
    }, {} as Record<string, ModelConfigRecord[]>);
  }, [selectedGroup]);

  const showEndpoint = form.provider !== 'mock';
  const showApiKey = !['mock', 'ollama'].includes(form.provider);
  const groupManagedConnectionSettings = Boolean(selectedGroup) && form.provider === selectedGroup.provider;
  const isGroupConfigDirty = editApiKey.trim() !== ''
    || (selectedGroup ? editBaseUrl.trim() !== selectedGroup.baseUrl.trim() : false)
    || (selectedGroup ? editProviderAlias.trim() !== selectedGroup.providerAlias.trim() : false);
  const providerDotCls = selectedGroup ? getProviderDotClass(selectedGroup.provider) : 'bg-accent';
  const providerLabel = selectedGroup ? groupDisplayName(selectedGroup, groups) : '';
  const allGroupsEnabled = !!selectedGroup && selectedGroup.models.length > 0 && selectedGroup.models.every((m) => m.enabled);
  const mockDefaultGuardActive = shouldPreventMockDefault(form.provider, models.data ?? [], editingModel?.modelId);

  useEffect(() => {
    if (!mockDefaultGuardActive || !form.isDefault) return;
    setForm((prev) => ({ ...prev, isDefault: false }));
  }, [form.isDefault, mockDefaultGuardActive]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function resetDiscoveryState() {
    setDiscoveredModels([]); setSelectedDiscoveredModelIds([]); setDiscoveredCatalogKey(''); setDiscoveryError(null);
  }

  function readDiscoverError(error: unknown): string {
    return readModelRequestError(error, '模型目录获取失败');
  }

  function readModelRequestError(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error && 'response' in error) {
      const response = (error as { response?: { data?: { message?: string; error?: string } } }).response;
      if (response?.data?.message) return response.data.message;
      if (response?.data?.error) return response.data.error;
    }
    const message = error instanceof Error ? error.message : '';
    if (/network error|failed to fetch|load failed|connection refused|err_connection_refused/i.test(message)) {
      return '无法连接到模型服务，请先启动 server（默认端口 8787）后再重试。';
    }
    return message || fallback;
  }

  async function handleFetchModels(opts?: { provider?: ModelProviderId; baseUrl?: string; apiKey?: string; modelId?: string }) {
    const provider = opts?.provider ?? form.provider;
    const baseUrl = (opts?.baseUrl ?? form.baseUrl).trim();
    const apiKey = opts?.apiKey ?? form.apiKey.trim();
    const modelId = opts?.modelId ?? editingModel?.modelId;
    if (!baseUrl) return;
    setFetchingModels(true);
    setDiscoveryError(null);
    try {
      const result = await discoverModels({ provider, baseUrl, apiKey: apiKey || undefined, modelId });
      setDiscoveredModels(result.models);
      setSelectedDiscoveredModelIds(result.models.map((item) => item.id));
      setDiscoveredCatalogKey(`${provider}::${baseUrl}`);
      if (!form.modelName.trim() && result.models[0]?.id) setForm((prev) => ({ ...prev, modelName: result.models[0]?.id ?? prev.modelName }));
      if (result.models.length === 0) setDiscoveryError('当前 endpoint 未返回可用模型目录，可继续手动输入模型名。');
    } catch (error) {
      resetDiscoveryState();
      setDiscoveryError(readDiscoverError(error));
    } finally {
      setFetchingModels(false);
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveGroupConfig = useMutation({
    mutationFn: async () => {
      if (!selectedGroup) return;
      await Promise.all(selectedGroup.models.map((m) => {
        const basePayload = buildModelPayload(createModelFormState(m), models.data ?? [], m.modelId);
        const configPatch: Record<string, unknown> = { ...m.config };
        if (editBaseUrl.trim()) configPatch.baseUrl = editBaseUrl.trim();
        if (editApiKey.trim()) configPatch.apiKey = editApiKey.trim();
        configPatch.providerAlias = editProviderAlias.trim();
        return updateModel(m.modelId, { ...basePayload, config: configPatch });
      }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['models'] }); setEditApiKey(''); },
  });

  const saveModel = useMutation({
    mutationFn: async ({ modelId, payload }: { modelId?: string; payload: ModelConfigPayload }) =>
      modelId ? updateModel(modelId, payload) : createModel(payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['models'] }); handleCloseEditor(); },
    onError: (error) => setEditorError(readModelRequestError(error, editingModel ? '模型保存失败' : '模型创建失败')),
  });

  const bulkCreateModels = useMutation({
    mutationFn: async (modelNames: string[]) => {
      const existingKeys = new Set((models.data ?? []).map((model) => `${model.provider}::${formatEndpoint(model)}::${model.modelName}`));
      const uniqueNames = modelNames.filter((modelName) => !existingKeys.has(`${form.provider}::${form.baseUrl.trim() || 'default'}::${modelName}`));
      await Promise.all(uniqueNames.map((modelName) => createModel({ ...buildModelPayload({ ...form, modelName }, models.data ?? []), isDefault: false })));
      return uniqueNames.length;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['models'] }); handleCloseEditor(); },
  });

  const delModel = useMutation({ mutationFn: deleteModel, onSuccess: () => qc.invalidateQueries({ queryKey: ['models'] }) });

  const runModelTest = useMutation({
    mutationFn: ({ modelId, prompt, mode }: { modelId: string; prompt?: string; mode: ModelTestMode }) =>
      testModel(modelId, mode === 'connect' ? { mode } : { prompt, mode }),
    onSuccess: (result) => setTestResult(result),
  });

  // ── Dialog handlers ───────────────────────────────────────────────────────
  function handleOpenCreate() {
    const nextProvider = selectedGroup?.provider ?? 'openai-compatible';
    const nextGroupName = selectedGroup?.models[0] ? getModelGroupName(selectedGroup.models[0]) : '';
    setEditingModel(null);
    setEditorError(null);
    setShowMoreSettings(false);
    setForm({
      ...createModelFormState(),
      provider: nextProvider,
      baseUrl: editBaseUrl || getDefaultBaseUrl(nextProvider),
      groupName: nextGroupName,
      pricingCurrency: 'USD',
      streamOutput: true,
    });
    resetDiscoveryState();
    setEditorOpen(true);
  }

  function handleOpenEdit(model: ModelConfigRecord) {
    setEditorError(null); setEditingModel(model); setForm(createModelFormState(model)); resetDiscoveryState(); setShowMoreSettings(false); setEditorOpen(true);
  }

  function handleCloseEditor() {
    setEditorOpen(false); setEditingModel(null); setEditorError(null); setForm(createModelFormState()); resetDiscoveryState();
  }

  function handleSubmitModel() {
    if (!form.modelName.trim()) return;
    if (backendOffline) {
      setEditorError('当前无法保存模型配置，请先恢复模型服务连接。');
      return;
    }
    setEditorError(null);
    saveModel.mutate({ modelId: editingModel?.modelId, payload: buildModelPayload(form, models.data ?? [], editingModel?.modelId) });
  }

  function handleOpenTest(model: ModelConfigRecord) {
    setTestingModel(model); setTestMode('connect'); setTestPrompt(DEFAULT_MODEL_TEST_PROMPT); setTestResult(null);
  }

  function handleCloseTest() {
    setTestingModel(null); setTestMode('connect'); setTestPrompt(DEFAULT_MODEL_TEST_PROMPT); setTestResult(null);
  }

  function handleRunTest() {
    if (!testingModel) return;
    runModelTest.mutate({ modelId: testingModel.modelId, prompt: testMode === 'connect' ? undefined : testPrompt, mode: testMode });
  }

  function toggleDiscoveredModel(modelId: string) {
    setSelectedDiscoveredModelIds((prev) => prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]);
  }

  function handleBulkCreateDiscoveredModels() {
    if (!selectedDiscoveredModelIds.length) return;
    bulkCreateModels.mutate(selectedDiscoveredModelIds);
  }

  async function handleQuickAdd() {
    if (!quickAddModelId.trim() || !selectedGroup) return;
    if (backendOffline) {
      setQuickAddError('当前无法添加模型，请先恢复模型服务连接。');
      return;
    }
    setQuickAdding(true);
    setQuickAddError(null);
    try {
      const quickForm: ModelFormState = {
        ...createModelFormState(),
        provider: selectedGroup.provider,
        modelName: quickAddModelId.trim(),
        displayName: quickAddModelId.trim(),
        groupName: selectedGroup.models[0] ? getModelGroupName(selectedGroup.models[0]) : getModelNamespace(quickAddModelId.trim()),
        baseUrl: editBaseUrl || selectedGroup.baseUrl || '',
        apiKey: editApiKey || '',
        apiKeyMasked: selectedGroup.apiKeyMasked || '',
        enabled: true,
        isDefault: false,
      };
      await createModel(buildModelPayload(quickForm, models.data ?? []));
      qc.invalidateQueries({ queryKey: ['models'] });
      setQuickAddOpen(false);
      setQuickAddModelId('');
    } catch (error) {
      setQuickAddError(readModelRequestError(error, '添加模型失败'));
    } finally {
      setQuickAdding(false);
    }
  }

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Main: provider list (left) + provider detail (right) ── */}
      <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-card min-h-[400px] lg:h-[calc(100vh-160px)] lg:flex-row">

        {/* Left: provider list */}
        <aside className="flex max-h-64 w-full shrink-0 flex-col border-b border-border-subtle lg:max-h-none lg:w-52 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">服务提供商</span>
            <button
              onClick={handleOpenCreate}
              title="新建模型配置"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface hover:text-accent"
            >
              <IconPlus size={13} />
            </button>
          </div>

          <ScrollArea className="flex-1">
            <div className="py-1">
              {groups.map((g) => {
                const isSelected = g.key === selectedGroup?.key;
                const enabledCount = g.models.filter((m) => m.enabled).length;
                const displayName = groupDisplayName(g, groups);
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setSelectedGroupKey(g.key)}
                    className={clsx(
                      'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
                      isSelected ? 'bg-surface-soft' : 'hover:bg-surface'
                    )}
                  >
                    <div className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', getProviderDotClass(g.provider))}>
                      {displayName[0]?.toUpperCase() ?? 'M'}
                    </div>
                    <span className="flex-1 min-w-0 truncate text-sm text-text">{displayName}</span>
                    {enabledCount > 0 && (
                      <span className="shrink-0 rounded-full bg-success px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">ON</span>
                    )}
                  </button>
                );
              })}
              {groups.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-text-muted">暂无服务商配置</p>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t border-border-subtle px-3 py-2.5">
            <button
              onClick={handleOpenCreate}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-text-muted transition-colors hover:bg-surface hover:text-text"
            >
              <IconPlus size={12} /> 添加
            </button>
          </div>
        </aside>

        {/* Right: provider detail + model list */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {models.isLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <IconLoader2 size={22} className="animate-spin text-accent" />
              <p className="text-sm text-text-muted">正在连接模型服务…</p>
            </div>
          ) : backendOffline ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-danger/20 bg-danger/10 text-danger">
                <IconCircleX size={22} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text">模型服务未连接</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">{modelsErrorMessage}</p>
              </div>
              <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3 text-left">
                <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">开发环境</p>
                <p className="mt-1 font-mono text-[11px] text-text">pnpm dev:server</p>
              </div>
              <button
                type="button"
                onClick={() => { void qc.invalidateQueries({ queryKey: ['models'] }); }}
                className={btnPrimaryCls}
              >
                <IconActivity size={13} /> 重试连接
              </button>
            </div>
          ) : selectedGroup ? (
            <>
              {/* Provider header */}
              <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', providerDotCls)}>
                    {providerLabel[0]?.toUpperCase() ?? 'M'}
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-text">{providerLabel}</span>
                    <p className="mt-1 text-[11px] leading-5 text-text-muted">{selectedGroup.models.length} 个模型，协议 {getProviderMeta(selectedGroup.provider).protocol}</p>
                  </div>
                  <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                    {getProviderMeta(selectedGroup.provider).protocol}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => selectedGroup.models[0] && handleOpenTest(selectedGroup.models[0])}
                    disabled={!selectedGroup.models.length}
                    title="测试连接"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-40"
                  >
                    <IconActivity size={13} />
                    测试连接
                  </button>
                  <button
                    onClick={handleOpenCreate}
                    title="添加模型"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/30 hover:text-accent"
                  >
                    <IconPlus size={13} />
                    添加模型
                  </button>
                  <Switch
                    checked={allGroupsEnabled}
                    onCheckedChange={(checked) => {
                      Promise.all(selectedGroup.models.map((m) =>
                        updateModel(m.modelId, { ...buildModelPayload(createModelFormState(m)), enabled: checked })
                      )).then(() => qc.invalidateQueries({ queryKey: ['models'] }));
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-3">
                <label htmlFor="provider-alias" className="w-[72px] shrink-0 text-xs font-medium text-text">服务商别名</label>
                <input
                  id="provider-alias"
                  value={editProviderAlias}
                  onChange={(e) => setEditProviderAlias(e.target.value)}
                  placeholder={getProviderMeta(selectedGroup.provider).label}
                  className="h-7 flex-1 rounded-md border border-border bg-surface-input px-2.5 text-xs text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
                <span className="shrink-0 text-[11px] text-text-muted">用于覆盖左侧和顶部的服务商显示名</span>
              </div>

              {/* API 密钥 */}
              <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-3">
                <label htmlFor="provider-api-key" className="w-[72px] shrink-0 text-xs font-medium text-text">API 密钥</label>
                <input
                  id="provider-api-key"
                  type="password"
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder={selectedGroup.apiKeyMasked ? `当前: ${selectedGroup.apiKeyMasked}` : (['mock', 'ollama'].includes(selectedGroup.provider) ? '无需 API Key' : '输入新 API Key…')}
                  disabled={['mock', 'ollama'].includes(selectedGroup.provider)}
                  className="h-7 flex-1 rounded-md border border-border bg-surface-input px-2.5 text-xs text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => selectedGroup.models[0] && handleOpenTest(selectedGroup.models[0])}
                  disabled={!selectedGroup.models.length}
                  className="shrink-0 text-xs text-accent transition-colors hover:underline disabled:opacity-40"
                >
                  检测
                </button>
                <span className="shrink-0 text-[11px] text-text-muted">多个密钥用逗号分隔</span>
              </div>

              {/* API 地址 */}
              <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-3">
                <label htmlFor="provider-base-url" className="w-[72px] shrink-0 text-xs font-medium text-text">API 地址</label>
                <input
                  id="provider-base-url"
                  value={editBaseUrl}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  placeholder={getProviderMeta(selectedGroup.provider).endpointHint}
                  disabled={selectedGroup.provider === 'mock'}
                  className="h-7 flex-1 rounded-md border border-border bg-surface-input px-2.5 text-xs text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => setEditBaseUrl(getDefaultBaseUrl(selectedGroup.provider))}
                  className="shrink-0 text-xs text-accent transition-colors hover:underline"
                >
                  重置
                </button>
                {isGroupConfigDirty && (
                  <button
                    onClick={() => saveGroupConfig.mutate()}
                    disabled={saveGroupConfig.isPending}
                    className={clsx(btnPrimaryCls, 'py-1 text-xs', saveGroupConfig.isPending && 'pointer-events-none opacity-60')}
                  >
                    {saveGroupConfig.isPending ? <IconLoader2 size={11} className="animate-spin" /> : <IconCircleCheck size={11} />}
                    保存
                  </button>
                )}
              </div>

              {/* Endpoint hint */}
              <div className="border-b border-border-subtle bg-surface/40 px-5 py-1.5">
                <p className="text-[11px] text-text-muted">
                  端点参考：{getProviderMeta(selectedGroup.provider).endpointHint}
                </p>
              </div>

              {/* Models section */}
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-5 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-medium text-text">模型</span>
                  <span className="rounded-full border border-border-subtle bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
                    {selectedGroup.models.length}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => handleFetchModels({ provider: selectedGroup.provider, baseUrl: editBaseUrl || selectedGroup.baseUrl, apiKey: editApiKey || undefined })}
                    disabled={backendOffline || fetchingModels || (!editBaseUrl.trim() && !selectedGroup.baseUrl.trim())}
                    className="flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-accent disabled:opacity-40"
                  >
                    {fetchingModels ? <IconLoader2 size={12} className="animate-spin" /> : <IconActivity size={12} />}
                    获取模型列表
                  </button>
                  <button
                    onClick={() => { setQuickAddModelId(''); setQuickAddOpen(true); }}
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-border-subtle text-text-muted transition-colors hover:border-accent/30 hover:text-accent"
                    title="添加模型"
                  >
                    <IconPlus size={12} />
                  </button>
                </div>

                {/* Discovery results */}
                {visibleDiscoveredModels.length > 0 && (
                  <div className="mb-3 rounded-xl border border-accent/20 bg-accent/5 px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-text">已发现 {visibleDiscoveredModels.length} 个模型</p>
                      {visibleDiscoveredModels.length > 1 && (
                        <button
                          onClick={handleBulkCreateDiscoveredModels}
                          disabled={bulkCreateModels.isPending || !selectedDiscoveredModelIds.length}
                          className={clsx(btnPrimaryCls, 'py-1 text-xs', (bulkCreateModels.isPending || !selectedDiscoveredModelIds.length) && 'pointer-events-none opacity-60')}
                        >
                          {bulkCreateModels.isPending ? <IconLoader2 size={11} className="animate-spin" /> : <IconPlus size={11} />}
                          批量创建 {selectedDiscoveredModelIds.length} 个
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {visibleDiscoveredModels.map((item) => {
                        const selected = selectedDiscoveredModelIds.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { setQuickAddModelId(item.id); toggleDiscoveredModel(item.id); }}
                            className={clsx(
                              'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                              selected ? 'border-accent/30 bg-accent/15 text-accent' : 'border-border-subtle bg-surface-card text-text-muted hover:border-accent/20 hover:text-text'
                            )}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    {discoveryError && <p className="mt-2 text-xs text-danger">{discoveryError}</p>}
                  </div>
                )}
                {!visibleDiscoveredModels.length && discoveryError && (
                  <p className="mb-2 text-xs text-danger">{discoveryError}</p>
                )}

                {/* Model list grouped by namespace */}
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-1">
                    {Object.entries(modelsByGroupName).map(([groupName, nsModels]) => (
                      <div key={groupName}>
                        <div className="flex items-center gap-1.5 px-1 py-1.5">
                          <IconChevronDown size={11} className="text-text-dim" />
                          <span className="text-[11px] text-text-muted">{groupName}</span>
                          <span className="ml-auto rounded bg-danger/70 px-1.5 text-[9px] font-semibold text-white">{nsModels.length}</span>
                        </div>
                        {nsModels.map((m) => (
                          <div key={m.modelId} className="flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 transition-colors hover:border-border-subtle hover:bg-surface">
                            <div className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', providerDotCls)}>
                              {getModelDisplayName(m)[0]?.toUpperCase() ?? 'M'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-medium text-text">{getModelDisplayName(m)}</span>
                                {m.isDefault && (
                                  <span className="rounded-full border border-success/30 bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success">默认</span>
                                )}
                                {!m.enabled && (
                                  <span className="rounded-full border border-danger/30 bg-danger/15 px-1.5 py-0.5 text-[9px] font-medium text-danger">禁用</span>
                                )}
                                {formatModelPricing(m) && (
                                  <span className="rounded-full border border-border-subtle bg-surface-card px-1.5 py-0.5 text-[9px] font-medium text-text-muted">{formatModelPricing(m)}</span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
                                <span className="font-mono text-[11px] text-text-dim">{m.modelName}</span>
                                {getParamSummary(m).slice(0, 2).map((summary) => (
                                  <span key={summary} className="rounded-full border border-border-subtle bg-surface-card px-1.5 py-0.5 text-[9px] text-text-muted">
                                    {summary}
                                  </span>
                                ))}
                              </div>
                              {getModelCapabilities(m).length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {getModelCapabilities(m).slice(0, 4).map((capability) => (
                                    <span key={capability} className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                                      {capability}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                onClick={() => handleOpenTest(m)}
                                title="测试"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border-subtle text-text-muted transition-colors hover:border-accent/30 hover:text-accent"
                              >
                                <IconPlayerPlay size={12} />
                              </button>
                              <button
                                onClick={() => handleOpenEdit(m)}
                                title="编辑"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border-subtle text-text-muted transition-colors hover:border-accent/30 hover:text-accent"
                              >
                                <IconAdjustments size={12} />
                              </button>
                              <button
                                onClick={() => delModel.mutate(m.modelId)}
                                title="删除"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border-subtle text-text-muted transition-colors hover:border-danger/30 hover:text-danger"
                              >
                                <IconMinus size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {selectedGroup.models.length === 0 && (
                      <div className="py-8 text-center">
                        <p className="text-sm text-text-muted">暂无模型</p>
                        <p className="mt-1 text-xs text-text-dim">点击右上角"+"添加模型</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                <IconCpu size={22} />
              </div>
              <h3 className="text-base font-semibold text-text">还没有配置任何服务商</h3>
              <p className="max-w-xs text-sm leading-6 text-text-muted">点击左侧"添加"按钮创建第一个模型配置。</p>
              <button className={clsx(btnPrimaryCls, 'mt-2')} onClick={handleOpenCreate}>
                <IconPlus size={13} /> 新建模型
              </button>
            </div>
          )}
        </main>
      </section>

      {/* Quick Add Model Dialog */}
      <Dialog open={quickAddOpen} onOpenChange={(v) => !v && setQuickAddOpen(false)}>
        <DialogContent title="添加模型" description="为当前服务商添加一个新的模型配置。">
          <div className="space-y-4">
            {quickAddError && (
              <div className="rounded-xl border border-danger/20 bg-danger/8 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <IconCircleX size={14} className="mt-0.5 shrink-0 text-danger" />
                  <p className="text-xs leading-5 text-danger">{quickAddError}</p>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-muted">* 模型 ID</label>
              <input
                value={quickAddModelId}
                onChange={(e) => setQuickAddModelId(e.target.value)}
                placeholder="qwen3-coder-plus / deepseek/deepseek-v3…"
                className={inputCls}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setQuickAddOpen(false)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-border hover:text-text">
                取消
              </button>
              <button
                onClick={handleQuickAdd}
                disabled={backendOffline || !quickAddModelId.trim() || quickAdding}
                className={clsx(btnPrimaryCls, (backendOffline || !quickAddModelId.trim() || quickAdding) && 'pointer-events-none opacity-60')}
              >
                {quickAdding ? <IconLoader2 size={13} className="animate-spin" /> : <IconCircleCheck size={13} />}
                添加模型
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={(open) => (open ? setEditorOpen(true) : handleCloseEditor())}>
        <DialogContent
          title={editingModel ? '编辑模型配置' : '新增模型配置'}
          description="配置基础信息；展开更多设置可调整能力标签、价格与生成参数。"
          className="max-w-2xl"
        >
          <div className="space-y-4">
            {backendOffline && (
              <div className="rounded-xl border border-danger/20 bg-danger/8 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <IconCircleX size={15} className="mt-0.5 shrink-0 text-danger" />
                  <div>
                    <p className="text-sm font-medium text-danger">当前无法保存模型配置</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{modelsErrorMessage}</p>
                  </div>
                </div>
              </div>
            )}
            {editorError && (
              <div className="rounded-xl border border-danger/20 bg-danger/8 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <IconCircleX size={15} className="mt-0.5 shrink-0 text-danger" />
                  <p className="text-xs leading-5 text-danger">{editorError}</p>
                </div>
              </div>
            )}
            {/* Basic fields - always shown */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs text-text-muted">Provider</label>
                <Select value={form.provider} onValueChange={(value) => setForm({ ...form, provider: value as ModelProviderId, baseUrl: getDefaultBaseUrl(value as ModelProviderId) })}>
                  {MODEL_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="model-id" className="text-xs text-text-muted">模型 ID</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="model-id"
                      list="model-suggestions"
                      value={form.modelName}
                      onChange={(event) => !editingModel && setForm({ ...form, modelName: event.target.value })}
                      placeholder="qwen3-coder-plus / gpt-4o"
                      className={clsx(inputCls, editingModel ? 'cursor-default pr-8 font-mono text-xs text-text-muted' : '')}
                      readOnly={!!editingModel}
                    />
                    {editingModel && (
                      <button
                        type="button"
                        title="复制模型 ID"
                        onClick={() => void navigator.clipboard.writeText(form.modelName)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle transition-colors hover:text-accent"
                      >
                        <IconCopy size={13} />
                      </button>
                    )}
                  </div>
                  {!editingModel && showEndpoint && (
                    <button
                      type="button"
                      title="从 BaseURL 获取模型列表"
                      onClick={() => handleFetchModels()}
                      disabled={backendOffline || fetchingModels || !form.baseUrl.trim()}
                      className={clsx(
                        'flex shrink-0 items-center gap-1 rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/30 hover:text-accent',
                        (backendOffline || fetchingModels || !form.baseUrl.trim()) && 'cursor-not-allowed opacity-50'
                      )}
                    >
                      {fetchingModels ? <IconLoader2 size={13} className="animate-spin" /> : <IconActivity size={13} />}
                      获取列表
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="model-display-name" className="text-xs text-text-muted">模型名称</label>
                <input
                  id="model-display-name"
                  value={form.displayName}
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                  placeholder="例如 Kimi K2.5"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="model-group-name" className="text-xs text-text-muted">分组名称</label>
                <input
                  id="model-group-name"
                  value={form.groupName}
                  onChange={(event) => setForm({ ...form, groupName: event.target.value })}
                  placeholder="例如 Moonshot / Coding"
                  className={inputCls}
                />
              </div>
            </div>

            {/* Discovery results */}
            {visibleDiscoveredModels.length > 0 && (
              <>
                <datalist id="model-suggestions">
                  {visibleDiscoveredModels.map((item) => <option key={item.id} value={item.id} />)}
                </datalist>
                <div className="rounded-xl border border-border-subtle bg-surface-card px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-text">已发现 {visibleDiscoveredModels.length} 个模型</p>
                    {!editingModel && visibleDiscoveredModels.length > 1 && (
                      <button
                        type="button"
                        onClick={handleBulkCreateDiscoveredModels}
                        disabled={bulkCreateModels.isPending || selectedDiscoveredModelIds.length === 0}
                        className={clsx(
                          'flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/15',
                          (bulkCreateModels.isPending || selectedDiscoveredModelIds.length === 0) && 'pointer-events-none opacity-60'
                        )}
                      >
                        {bulkCreateModels.isPending ? <IconLoader2 size={12} className="animate-spin" /> : <IconPlus size={12} />}
                        批量创建 {selectedDiscoveredModelIds.length} 个模型
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {visibleDiscoveredModels.map((item) => {
                      const selected = selectedDiscoveredModelIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({
                              ...prev,
                              modelName: item.id,
                              displayName: prev.displayName || item.label,
                              groupName: prev.groupName || getModelNamespace(item.id),
                            }));
                            if (!editingModel) toggleDiscoveredModel(item.id);
                          }}
                          className={clsx(
                            'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                            selected ? 'border-accent/30 bg-accent/15 text-accent' : 'border-border-subtle bg-surface-card text-text-muted hover:border-accent/20 hover:text-text'
                          )}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {discoveryError && <p className="text-xs text-danger">{discoveryError}</p>}

            {/* Always-visible toggles: 启用 + 设为默认 */}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
                <p className="text-xs font-medium text-text">启用模型</p>
                <Switch checked={form.enabled} onCheckedChange={(value) => setForm({ ...form, enabled: value })} />
              </div>
              <div className={clsx('flex items-center justify-between rounded-xl border border-border-subtle bg-surface px-3 py-2.5', mockDefaultGuardActive && 'opacity-50')}>
                <p className="text-xs font-medium text-text">设为默认</p>
                {mockDefaultGuardActive && (
                  <p className="text-[10px] leading-4 text-text-muted">存在可用真实模型时，Mock 仅保留为调试入口，不能作为默认模型。</p>
                )}
                <Switch
                  checked={mockDefaultGuardActive ? false : form.isDefault}
                  disabled={mockDefaultGuardActive}
                  onCheckedChange={(value) => setForm({ ...form, isDefault: value })}
                />
              </div>
            </div>

            {/* More settings toggle + action buttons */}
            <div className="flex items-center justify-between border-t border-border-subtle pt-3">
              <button
                type="button"
                onClick={() => setShowMoreSettings(!showMoreSettings)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-accent/30 hover:text-text"
              >
                {showMoreSettings ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                更多设置
              </button>
              <div className="flex items-center gap-2">
                <button onClick={handleCloseEditor} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-border hover:text-text">
                  取消
                </button>
                <button
                  onClick={handleSubmitModel}
                  disabled={backendOffline || !form.modelName.trim() || saveModel.isPending || bulkCreateModels.isPending}
                  className={clsx(btnPrimaryCls, (backendOffline || !form.modelName.trim() || saveModel.isPending || bulkCreateModels.isPending) && 'pointer-events-none opacity-60')}
                >
                  {saveModel.isPending ? <IconLoader2 size={13} className="animate-spin" /> : <IconCircleCheck size={13} />}
                  {editingModel ? '保存修改' : '创建模型'}
                </button>
              </div>
            </div>

            {/* Collapsible advanced settings */}
            {showMoreSettings && (
              <div className="space-y-4 border-t border-border-subtle pt-4">
                {/* 模型类型 - capability pills */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-text-muted">模型类型</label>
                  <div className="flex flex-wrap gap-2">
                    {CAPABILITY_OPTIONS.map((cap) => {
                      const active = hasCapabilityInString(form.capabilities, cap.id);
                      return (
                        <button
                          key={cap.id}
                          type="button"
                          onClick={() => setForm({ ...form, capabilities: toggleCapabilityInString(form.capabilities, cap.id) })}
                          className={clsx(
                            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                            active
                              ? 'border-accent/30 bg-accent/15 text-accent'
                              : 'border-border-subtle bg-surface text-text-muted hover:border-accent/20 hover:text-text'
                          )}
                        >
                          <cap.icon size={12} />
                          {cap.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Toggles — 支持增量文本输出 only; 启用/默认 moved to basic section */}
                <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
                  <p className="text-xs font-medium text-text">支持增量文本输出</p>
                  <Switch checked={form.streamOutput} onCheckedChange={(value) => setForm({ ...form, streamOutput: value })} />
                </div>

                {/* Currency + Prices */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <label htmlFor="model-pricing-currency" className="text-xs text-text-muted">计价币种</label>
                    <select
                      id="model-pricing-currency"
                      value={CURRENCY_OPTIONS.some((c) => c.value === form.pricingCurrency) ? form.pricingCurrency : ''}
                      onChange={(event) => setForm({ ...form, pricingCurrency: event.target.value || form.pricingCurrency })}
                      className="h-9 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-text focus:border-accent/50 focus:outline-none"
                    >
                      {CURRENCY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="model-input-price" className="text-xs text-text-muted">输入价格</label>
                    <div className="flex gap-1">
                      <input id="model-input-price" value={form.inputPrice} onChange={(event) => setForm({ ...form, inputPrice: event.target.value })} placeholder="0.80" className={clsx(inputCls, 'flex-1')} />
                      <span className="flex h-9 shrink-0 items-center rounded-lg border border-border-subtle bg-surface px-2 text-[11px] text-text-muted">/ 1M</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="model-output-price" className="text-xs text-text-muted">输出价格</label>
                    <div className="flex gap-1">
                      <input id="model-output-price" value={form.outputPrice} onChange={(event) => setForm({ ...form, outputPrice: event.target.value })} placeholder="2.40" className={clsx(inputCls, 'flex-1')} />
                      <span className="flex h-9 shrink-0 items-center rounded-lg border border-border-subtle bg-surface px-2 text-[11px] text-text-muted">/ 1M</span>
                    </div>
                  </div>
                </div>

                {/* Connection settings */}
                {groupManagedConnectionSettings ? (
                  <div className="rounded-xl border border-border-subtle bg-surface px-3 py-3">
                    <p className="text-xs font-medium text-text">连接设置由当前服务商统一管理</p>
                    <p className="mt-1 text-[11px] leading-5 text-text-muted">
                      请在弹窗外顶部的服务商配置中调整 API 地址、API 密钥与别名；当前模型将沿用 {providerLabel || getProviderMeta(form.provider).label} 的连接配置。
                    </p>
                  </div>
                ) : ((showEndpoint || showApiKey) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="model-base-url" className="text-xs text-text-muted">Base URL</label>
                      {showEndpoint ? (
                        <input
                          id="model-base-url"
                          value={form.baseUrl}
                          onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                          placeholder={getProviderMeta(form.provider).endpointHint}
                          className={inputCls}
                        />
                      ) : (
                        <div className="flex h-9 items-center rounded-lg border border-border-subtle bg-surface px-3 text-xs text-text-muted">当前 provider 无需 endpoint</div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="model-api-key" className="text-xs text-text-muted">API Key</label>
                      {showApiKey ? (
                        <>
                          <input
                            id="model-api-key"
                            type="password"
                            value={form.apiKey}
                            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                            placeholder={form.apiKeyMasked ? `留空保留 ${form.apiKeyMasked}` : 'sk-...'}
                            className={inputCls}
                          />
                          {form.apiKeyMasked && <p className="text-[11px] text-text-muted">当前已保存：{form.apiKeyMasked}</p>}
                        </>
                      ) : (
                        <div className="flex h-9 items-center rounded-lg border border-border-subtle bg-surface px-3 text-xs text-text-muted">当前 provider 无需 API Key</div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Generation params */}
                <div>
                  <p className="mb-2 text-xs font-medium text-text-muted">生成参数</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="model-temperature" className="text-xs text-text-muted">温度（Temperature）</label>
                      <input id="model-temperature" value={form.temperature} onChange={(event) => setForm({ ...form, temperature: event.target.value })} placeholder="0.2" className={inputCls} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="model-max-tokens" className="text-xs text-text-muted">最大 Token（Max Tokens）</label>
                      <input id="model-max-tokens" value={form.maxTokens} onChange={(event) => setForm({ ...form, maxTokens: event.target.value })} placeholder="2048" className={inputCls} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="model-top-p" className="text-xs text-text-muted">Top-P</label>
                      <input id="model-top-p" value={form.topP} onChange={(event) => setForm({ ...form, topP: event.target.value })} placeholder="0.9" className={inputCls} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="model-presence-penalty" className="text-xs text-text-muted">Presence Penalty</label>
                      <input id="model-presence-penalty" value={form.presencePenalty} onChange={(event) => setForm({ ...form, presencePenalty: event.target.value })} placeholder="0" className={inputCls} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <label htmlFor="model-frequency-penalty" className="text-xs text-text-muted">Frequency Penalty</label>
                      <input id="model-frequency-penalty" value={form.frequencyPenalty} onChange={(event) => setForm({ ...form, frequencyPenalty: event.target.value })} placeholder="0" className={inputCls} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={Boolean(testingModel)} onOpenChange={(open) => (open ? null : handleCloseTest())}>
        <DialogContent
          title={testingModel ? `测试 ${testingModel.modelName}` : '模型测试'}
          description="优先做轻量连通性探测；如需进一步排查，再执行普通调用或 SSE 流式验证。"
          className="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <label className="text-xs text-text-muted">测试模式</label>
                <Select value={testMode} onValueChange={(value) => setTestMode(value as ModelTestMode)}>
                  <SelectItem value="connect">Connect</SelectItem>
                  <SelectItem value="stream">SSE Stream</SelectItem>
                  <SelectItem value="call">Single Call</SelectItem>
                </Select>
              </div>
              <div className="rounded-xl border border-border-subtle bg-surface px-3 py-3 text-sm text-text-muted">
                {testMode === 'connect'
                  ? 'Connect 会发送 provider 级最小 ping 请求，只验证 endpoint、鉴权和模型路由是否可达。'
                  : testMode === 'stream'
                    ? 'SSE Stream 用于确认服务端流式返回和前端折叠式渲染都正常工作。'
                    : 'Single Call 会执行一次完整非流式调用，适合排查普通请求路径。'}
              </div>
            </div>

            {testMode !== 'connect' && (
              <div className="space-y-1.5">
                <label className="text-xs text-text-muted">测试提示词</label>
                <textarea
                  value={testPrompt}
                  onChange={(event) => setTestPrompt(event.target.value)}
                  rows={8}
                  aria-label="测试提示词"
                  className="w-full rounded-xl border border-border bg-surface-input px-3 py-2 text-sm leading-6 text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-text-muted">
                {testMode === 'connect'
                  ? 'Connect 返回的是轻量状态摘要，不依赖模型生成内容本身。'
                  : '测试结果会直接使用与聊天区一致的 Markdown 渲染组件进行预览。'}
              </div>
              <button
                onClick={handleRunTest}
                disabled={!testingModel || (testMode !== 'connect' && !testPrompt.trim()) || runModelTest.isPending}
                className={clsx(btnPrimaryCls, (!testingModel || (testMode !== 'connect' && !testPrompt.trim()) || runModelTest.isPending) && 'pointer-events-none opacity-60')}
              >
                {runModelTest.isPending ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlayerPlay size={13} />}
                开始测试
              </button>
            </div>

            {testResult && (
              <div className="space-y-3 rounded-2xl border border-border-subtle bg-surface px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]',
                    testResult.success ? 'border border-success/20 bg-success/10 text-success' : 'border border-danger/20 bg-danger/10 text-danger'
                  )}>
                    {testResult.success ? <IconCircleCheck size={11} /> : <IconCircleX size={11} />}
                    {testResult.success ? '测试成功' : '测试失败'}
                  </span>
                  <span className="rounded-full border border-border-subtle bg-surface-card px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-muted">
                    {testResult.mode}
                  </span>
                  <span className="rounded-full border border-border-subtle bg-surface-card px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-muted">
                    {testResult.durationMs} ms
                  </span>
                  {typeof testResult.chunkCount === 'number' && (
                    <span className="rounded-full border border-border-subtle bg-surface-card px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-muted">
                      {testResult.chunkCount} chunks
                    </span>
                  )}
                </div>

                {testResult.error ? (
                  <div className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-3 text-sm leading-6 text-danger">
                    {testResult.error}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border-subtle bg-surface-card px-4 py-4">
                    <ResponseContent content={testResult.text ?? 'Connected successfully'} />
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


// ─── Datasources Tab — delegated to DatasourcesTab component ─────────────────
// (imported from components/Settings/DataSources/DatasourcesTab)

// ─── MCP Tab — delegated to MCPManagementTab component ──────────────────────
// (imported from components/Settings/MCP/MCPManagementTab)

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab() {
  return (
    <section className="rounded-xl border border-border-subtle bg-surface-card p-5">
      <SkillsTabContent />
    </section>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const themeMode = usePreferenceStore((state) => state.themeMode);
  const setThemeMode = usePreferenceStore((state) => state.setThemeMode);
  const clearDirty = usePreferenceStore((state) => state.clearDirty);

  // 桌面环境追加 desktop tab
  const TABS = isElectron() ? [...BASE_TABS, DESKTOP_TAB] : BASE_TABS;
  const activeMeta = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  const activeDescriptionKey: Record<TabId, string> = {
    general: 'settings.descriptions.general',
    display: 'settings.descriptions.display',
    browser: 'settings.descriptions.browser',
    models: 'settings.descriptions.models',
    datasources: 'settings.descriptions.datasources',
    mcp: 'settings.descriptions.mcp',
    skills: 'settings.descriptions.skills',
    tools: 'settings.descriptions.tools',
    agents: 'settings.descriptions.agents',
    storage: 'settings.descriptions.storage',
    observability: 'settings.descriptions.observability',
    security: 'settings.descriptions.security',
    desktop: 'settings.descriptions.desktop',
    personas: 'settings.descriptions.personas',
    'user-profile': 'settings.descriptions.userProfile',
    websearch: 'settings.descriptions.webSearch',
  };
  const saveThemeMut = useMutation({
    mutationFn: (mode: ThemeMode) => putPreferences({ themeMode: mode }),
    onSuccess: () => {
      clearDirty();
      void qc.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
  const currentThemeMeta = SIDEBAR_THEME_META[themeMode];
  const nextThemeMode = getNextThemeMode(themeMode);
  const nextThemeMeta = SIDEBAR_THEME_META[nextThemeMode];
  const currentThemeLabel = t(`settings.themeNames.${themeMode}`, currentThemeMeta.label);
  const nextThemeLabel = t(`settings.themeNames.${nextThemeMode}`, nextThemeMeta.label);
  const quickThemeLabel = t('settings.quickTheme.label', '快速切换主题');
  const quickThemeTitle = t(
    'settings.quickTheme.title',
    `快速切换主题：当前 ${currentThemeLabel}，点击切到 ${nextThemeLabel}`,
    { current: currentThemeLabel, next: nextThemeLabel },
  );
  const quickThemeSummary = t(
    'settings.quickTheme.summary',
    `当前 ${currentThemeLabel}，下一个 ${nextThemeLabel}`,
    { current: currentThemeLabel, next: nextThemeLabel },
  );

  function handleQuickThemeSwitch() {
    setThemeMode(nextThemeMode);
    saveThemeMut.mutate(nextThemeMode);
  }

  return (
    <ScrollArea className="flex-1 bg-surface">
      <div className="flex min-h-full min-w-0 flex-col bg-surface lg:flex-row">
        <aside
          data-testid="settings-section-rail"
          className="flex w-full shrink-0 flex-col border-b border-border-subtle bg-surface-sidebar lg:sticky lg:top-0 lg:h-[100dvh] lg:w-[240px] lg:border-b-0 lg:border-r"
        >
          <div className="border-b border-border-subtle px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                <IconSettings size={16} />
              </div>
              <div>
                <h1 className="text-sm font-semibold text-text">{t('settings.title')}</h1>
              </div>
            </div>
          </div>
          <nav
            data-testid="settings-section-tabs"
            className="min-w-0 overflow-x-auto px-3 py-3 lg:flex-1 lg:overflow-auto lg:pb-4"
          >
            <div className="flex min-w-max gap-1 lg:block lg:min-w-0 lg:space-y-1">
              {TABS.map(({ id, labelKey, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={clsx(
                    'flex w-max shrink-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors lg:w-full',
                    activeTab === id
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-muted hover:bg-surface hover:text-text'
                  )}
                >
                  <span className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-xl border transition-colors',
                    activeTab === id
                      ? 'border-accent/20 bg-accent/10 text-accent'
                      : 'border-border-subtle bg-surface-card text-text-dim'
                  )}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(labelKey, id)}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="border-t border-border-subtle px-3 py-3">
            <button
              type="button"
              onClick={handleQuickThemeSwitch}
              aria-label={quickThemeLabel}
              title={quickThemeTitle}
              className="flex w-full items-center gap-2 rounded-2xl border border-border-subtle bg-surface-card px-3 py-2 text-left text-sm text-text-muted transition-colors hover:border-accent/40 hover:text-text"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-border-subtle bg-surface text-text-dim">
                {saveThemeMut.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <currentThemeMeta.Icon size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text">{quickThemeLabel}</span>
                <span className="block truncate text-[11px] text-text-subtle">{quickThemeSummary}</span>
              </span>
            </button>
          </div>
        </aside>

        <div data-testid="settings-content" className="min-w-0 flex-1">
          <div className="border-b border-border-subtle bg-surface px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                <activeMeta.Icon size={16} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text">{t(activeMeta.labelKey, activeMeta.id)}</h2>
                <p className="mt-1 text-sm leading-6 text-text-muted">{t(activeDescriptionKey[activeTab])}</p>
              </div>
            </div>
          </div>

          <div className="w-full p-5">
            {activeTab === 'general'        && <GeneralSettingsTab />}
            {activeTab === 'display'         && <DisplaySettingsTab />}
            {activeTab === 'browser'         && <BrowserRuntimeSettings />}
            {activeTab === 'models'         && <ModelsTab />}
            {activeTab === 'datasources'    && <DatasourcesTab />}
            {activeTab === 'mcp'            && <MCPManagementTab />}
            {activeTab === 'skills'         && <SkillsTab />}
            {activeTab === 'tools'          && <ToolsRegistryTabContent />}
            {activeTab === 'agents'         && <CustomAgentsTab />}
            {activeTab === 'websearch'      && <WebSearchSettings />}
            {activeTab === 'storage'        && <StorageSettingsPage />}
            {activeTab === 'observability'  && <ObservabilityTab />}
            {activeTab === 'security'       && <SecurityTab />}
            {activeTab === 'desktop'        && <DesktopSettingsPanel />}
            {activeTab === 'personas'       && <PersonaSection />}
            {activeTab === 'user-profile'   && <UserProfileSection />}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}



