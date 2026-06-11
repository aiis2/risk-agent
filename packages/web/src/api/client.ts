import axios from 'axios';
import type { ThemeMode } from '../lib/theme';

function resolveApiBaseUrl(): string {
  const runtimeOverride =
    typeof window !== 'undefined' ? window.localStorage.getItem('risk-agent.apiBaseUrl')?.trim() : undefined;

  if (runtimeOverride) {
    return runtimeOverride;
  }

  const envOverride = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envOverride) {
    return envOverride;
  }

  return import.meta.env.DEV ? 'http://127.0.0.1:8787/api' : '/api';
}

const apiBaseUrl = resolveApiBaseUrl();

export function buildApiUrl(path: string): string {
  const normalizedBase = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (import.meta.env.DEV) {
      console.warn('[api] request failed', error);
    }
    return Promise.reject(error);
  },
);

export interface Scenario {
  scenarioId: string;
  name: string;
  description?: string;
  domain?: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  dataSources: string[];
  documents: string[];
  manualNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Rule {
  ruleId: string;
  ruleName: string;
  ruleCode?: string;
  bizType?: string;
  ruleType?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  source?: string;
  description?: string;
  coverage: string[];
  conditions?: unknown;
  actions?: unknown;
  status: string;
  systemId?: string | null;
  syncedAt: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface RuleSystem {
  systemId: string;
  systemName: string;
  systemType: 'realtime' | 'offline' | 'manual';
  syncConfig?: { apiUrl?: string; syncInterval?: number; authType?: string };
  ruleCount: number;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
  rules?: Pick<Rule, 'ruleId' | 'ruleName' | 'ruleType' | 'bizType' | 'riskLevel' | 'status'>[];
}

export interface CoverageMatrix {
  bizType: string;
  totalRules: number;
  dimensions: string[];
  byRuleType: Array<{
    ruleType: string;
    count: number;
    dimensions: string[];
    rules: Rule[];
  }>;
}

export interface ReportSummary {
  reportId: string;
  sessionId: string;
  businessName: string;
  locale: string;
  overallScore: number;
  createdAt: string;
}

export interface ReportCostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  totalApiDurationMs: number;
  totalToolDurationMs: number;
  modelUsage: Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export interface ReportCompare {
  reportA: { reportId: string; businessName: string; score: number; createdAt: string; gapCount: number; bySeverity: Record<string, number> };
  reportB: { reportId: string; businessName: string; score: number; createdAt: string; gapCount: number; bySeverity: Record<string, number> };
  scoreDelta: number;
  gapCountDelta: number;
  newScenarios: string[];
  removedScenarios: string[];
}

export interface GapHistoryPoint {
  reportId: string;
  overallScore: number;
  createdAt: string;
  gapCounts: { critical: number; high: number; medium: number; low: number };
}

export interface SessionSummary {
  sessionId: string;
  businessName: string;
  status: string;
  phase?: string;
  locale?: string;
  createdAt: string;
  completedAt?: string;
}

export interface SessionAttachment {
  attachmentId: string;
  sessionId?: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  textPreview?: string;
}

export interface SessionComposerPayload {
  content: string;
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
}

export interface StartSessionPayload {
  businessName: string;
  description?: string;
  scenarioIds?: string[];
  ruleScope?: { bizTypes?: string[]; ruleTypes?: string[] };
  locale?: string;
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
}

export const listScenarios = () => api.get<Scenario[]>('/scenarios').then((r) => r.data);
export const getScenario = (id: string) => api.get<Scenario>(`/scenarios/${id}`).then((r) => r.data);
export const createScenario = (data: Partial<Scenario>) => api.post<Scenario>('/scenarios', data).then((r) => r.data);
export const updateScenario = (id: string, data: Partial<Scenario>) => api.put<Scenario>(`/scenarios/${id}`, data).then((r) => r.data);
export const deleteScenario = (id: string) => api.delete(`/scenarios/${id}`);

export const listRules = (params?: Record<string, string>) =>
  api.get<Rule[]>('/rules', { params }).then((r) => r.data);
export const createRule = (data: Partial<Rule>) => api.post<Rule>('/rules', data).then((r) => r.data);
export const updateRule = (id: string, data: Partial<Rule>) => api.put<Rule>(`/rules/${id}`, data).then((r) => r.data);
export const deleteRule = (id: string) => api.delete(`/rules/${id}`);
export const importRules = (rules: Partial<Rule>[], source = 'manual-import') =>
  api.post('/rule-import', { source, rules }).then((r) => r.data);
export const getRulesByDimension = (dim: string) =>
  api.get<Rule[]>(`/rules/dimension/${encodeURIComponent(dim)}`).then((r) => r.data);
export const getRuleCoverageMatrix = (bizType: string) =>
  api.get<CoverageMatrix>(`/rules/coverage-matrix/${encodeURIComponent(bizType)}`).then((r) => r.data);

export const listRuleSystems = () => api.get<RuleSystem[]>('/rule-systems').then((r) => r.data);
export const getRuleSystem = (id: string) => api.get<RuleSystem & { rules: Rule[] }>(`/rule-systems/${id}`).then((r) => r.data);
export const createRuleSystem = (data: Partial<RuleSystem>) => api.post<RuleSystem>('/rule-systems', data).then((r) => r.data);
export const updateRuleSystem = (id: string, data: Partial<RuleSystem>) => api.put<RuleSystem>(`/rule-systems/${id}`, data).then((r) => r.data);
export const deleteRuleSystem = (id: string) => api.delete(`/rule-systems/${id}`);
export const syncRuleSystem = (id: string) => api.post<{ ok: boolean; message: string }>(`/rule-systems/${id}/sync`).then((r) => r.data);

export const listReports = () => api.get<ReportSummary[]>('/reports').then((r) => r.data);
export const getReport = (id: string, locale?: string) =>
  api.get<any & { costSummary?: ReportCostSummary }>(`/reports/${id}`, { params: locale ? { locale } : undefined }).then((r) => r.data);
export const exportReportMd = (id: string, locale?: string) =>
  api.get(`/reports/${id}/markdown`, { params: locale ? { locale } : undefined, responseType: 'text' })
    .then((r) => r.data as string);
export const exportReportHtml = (id: string, locale?: string) =>
  api.get(`/reports/${id}/html`, { params: locale ? { locale } : undefined, responseType: 'text' })
    .then((r) => r.data as string);
export const deleteReport = (id: string) => api.delete(`/reports/${id}`);
export const compareReports = (r1: string, r2: string) =>
  api.get<ReportCompare>('/reports/compare', { params: { r1, r2 } }).then((r) => r.data);
export const getBusinessGapHistory = (name: string) =>
  api.get<GapHistoryPoint[]>(`/businesses/${encodeURIComponent(name)}/gap-history`).then((r) => r.data);

export interface SessionDetail extends SessionSummary {
  events: Array<{ type: string; payload: Record<string, unknown>; at: string }>;
}

export interface SessionCostSummary {
  breakdown: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedUsd: number;
    snapshotCount: number;
    lastUpdated: string;
  }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalUsd: number;
}

export const listSessions = () => api.get<SessionSummary[]>('/sessions').then((r) => r.data);
export const getSession = (id: string) => api.get<SessionDetail>(`/sessions/${id}`).then((r) => r.data);
export const uploadSessionAttachment = (payload: {
  sessionId?: string;
  filename: string;
  contentType?: string;
  dataBase64: string;
}) => api.post<SessionAttachment>('/session-attachments', payload).then((r) => r.data);
export const startSession = (payload: StartSessionPayload) => api.post<{ sessionId: string }>('/sessions', payload).then((r) => r.data);
export const cancelSession = (id: string) => api.post(`/sessions/${id}/cancel`);
export const archiveSession = (id: string) => api.post(`/sessions/${id}/archive`);
export const resumeSession = (id: string, continuePrompt?: string, modelId?: string) =>
  api
    .post<{ sessionId: string; resumed: boolean }>(
      `/sessions/${id}/resume`,
      continuePrompt || modelId ? { continuePrompt, modelId } : {}
    )
    .then((r) => r.data);
export const appendSessionMessage = (id: string, payload: string | SessionComposerPayload, modelId?: string) =>
  api
    .post<{ ok: boolean; sessionId: string; resumed: boolean; interrupted: boolean }>(
      `/sessions/${id}/messages`,
      typeof payload === 'string' ? { content: payload, modelId } : payload,
    )
    .then((r) => r.data);
export const submitSessionAnswer = (id: string, requestId: string, answer: string) =>
  api.post(`/sessions/${id}/answer`, { requestId, answer }).then((r) => r.data);
export const getSessionCost = (id: string) =>
  api.get<SessionCostSummary>(`/sessions/${id}/cost`).then((r) => r.data);
/**
 * GET /api/sessions/active — 活跃会话列表（v3.3 §8.1 SessionManager）
 * 返回当前进程内存中正在运行的会话快照。
 */
export const getActiveSessions = () =>
  api.get<{ sessions: SessionSummary[]; count: number }>('/sessions/active').then((r) => r.data);
/**
 * GET /api/sessions/:id/status — 会话实时状态快照（v3.3 §8.1 SessionManager）
 */
export interface SessionStatus {
  sessionId: string;
  phase: 'idle' | 'thinking' | 'tool_executing' | 'waiting_user';
  activeWorkerCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  costUsd: number;
}
export const getSessionStatus = (id: string) =>
  api.get<SessionStatus>(`/sessions/${id}/status`).then((r) => r.data);
/**
 * DELETE /api/sessions/:id — 终止会话（v3.3 §8.1 SessionManager）
 */
export const terminateSession = (id: string) =>
  api.delete<{ ok: boolean; terminated: boolean }>(`/sessions/${id}`).then((r) => r.data);
export const renameSession = (id: string, businessName: string) =>
  api.patch<{ ok: boolean; sessionId: string }>(`/sessions/${id}`, { businessName }).then((r) => r.data);

export interface ObservabilityCostSummary {
  lookbackDays: number;
  since: string;
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedUsd: number;
    sessionCount: number;
  }>;
  topSessions: Array<{
    sessionId: string;
    businessName: string;
    estimatedUsd: number;
    totalTokens: number;
    lastActivity: string;
  }>;
}

export const getObservabilityCosts = (days = 30) =>
  api.get<ObservabilityCostSummary>('/observability/costs', { params: { days } }).then((r) => r.data);

// ── OTel Span Traces (v3.3-evolution-delta.md §9.1) ────────────────────────

export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer';
  attributes?: Record<string, string | number | boolean>;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error' | 'unset';
  errorMessage?: string;
}

export interface OTelTraceListItem {
  traceId: string;
  name: string;
  startTime: number;
  spanCount: number;
}

export const listOTelTraces = (limit = 20) =>
  api
    .get<{ success: boolean; data: { traces: OTelTraceListItem[] } }>('/observability/traces', {
      params: { limit }
    })
    .then((r) => r.data.data.traces);

export const getOTelTrace = (traceId: string) =>
  api
    .get<{ success: boolean; data: { traceId: string; spans: OTelSpan[] } }>(
      `/observability/traces/${traceId}`
    )
    .then((r) => r.data.data);

// ── Transcript FTS5 Search (system-architecture.md v3.3 §6.3) ────────────

export interface TranscriptSearchResult {
  convId: string;
  sessionId: string;
  uuid?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  subtype?: string;
  content: string;
  /** FTS5 snippet with <mark> tags */
  snippet: string;
  createdAt: string;
}

export interface TranscriptSearchResponse {
  query: string;
  sessionId?: string;
  results: TranscriptSearchResult[];
}

/** 在指定会话内全文搜索消息 */
export const searchSessionTranscript = (
  sessionId: string,
  q: string,
  opts?: { role?: string; limit?: number }
) =>
  api
    .get<{ success: boolean; data: TranscriptSearchResponse }>(
      `/sessions/${sessionId}/transcript/search`,
      { params: { q, ...opts } }
    )
    .then((r) => r.data.data);

/** 跨会话全文搜索消息 */
export const searchTranscript = (
  q: string,
  opts?: { session_id?: string; role?: string; limit?: number }
) =>
  api
    .get<{ success: boolean; data: TranscriptSearchResponse }>('/transcript/search', {
      params: { q, ...opts }
    })
    .then((r) => r.data.data);

// ─── Tools API (tools-skills-system.md §7) ───────────────────────────────────

export interface ToolSummary {
  name: string;
  description: string;
  aliases: string[];
  searchHint?: string;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isDestructive: boolean;
  alwaysLoad: boolean;
  deferred: boolean;
  strict: boolean;
  isOpenWorld: boolean;
  sandboxProfile?: string;
  sandboxHostKind?: string;
  sandboxAccessTier?: string;
  maxResultSizeChars?: number;
  inputSchema: Record<string, unknown>;
}

export interface ToolsListResponse {
  total: number;
  tools: ToolSummary[];
}

export type WebSearchCompressionMethod = 'none' | 'summary' | 'extract';

export interface WebSearchConfig {
  defaultProvider: string;
  includeDate: boolean;
  resultCount: number;
  compressionMethod: WebSearchCompressionMethod;
  blacklist: string;
  providerEnabled: Record<string, boolean>;
  providerApiKey: Record<string, string>;
  providerEndpoint: Record<string, string>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
}

export interface WebSearchTestResponse {
  provider: string;
  query: string;
  answer?: string;
  elapsedMs: number;
  results: WebSearchResult[];
}

export type BrowserRuntimeDefaultProvider = 'embedded-first' | 'external-preferred' | 'external-only';
export type BrowserWorkspaceMode = 'exclusive' | 'global-shared';
export type BrowserExternalMode = 'system-default' | 'configured';
export type BrowserWorkspaceVisibility = 'exclusive' | 'shared';
export type BrowserProviderKind = 'embedded' | 'system-default' | 'external-configured';
export type BrowserSharePolicy = 'manual' | 'global-default';
export type BrowserBindingRole = 'owner' | 'observer';
export type BrowserBindingSource = 'default' | 'manual-attach';

export interface BrowserRuntimePreferences {
  defaultProvider: BrowserRuntimeDefaultProvider;
  defaultWorkspaceMode: BrowserWorkspaceMode;
  allowManualAttach: boolean;
  allowSharedContribution: boolean;
  externalBrowserMode: BrowserExternalMode;
  externalBrowserExecutable: string;
}

export interface BrowserWorkspaceRecord {
  workspaceId: string;
  ownerSessionId: string | null;
  ownerType: string;
  visibility: BrowserWorkspaceVisibility;
  providerKind: BrowserProviderKind;
  sharePolicy: BrowserSharePolicy;
  controllerSessionId: string | null;
  lastActiveTabId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserBindingRecord {
  bindingId: string;
  sessionId: string;
  workspaceId: string;
  role: BrowserBindingRole;
  source: BrowserBindingSource;
  canControl: boolean;
  attachedAt: string;
  detachedAt: string | null;
}

export interface BrowserTabRecord {
  tabId: string;
  workspaceId: string;
  title: string | null;
  currentUrl: string | null;
  status: string;
  providerTabRef: string | null;
  contributedBySessionId: string | null;
  isPinned: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserStateResponse {
  hostAvailable: boolean;
  workspaces: BrowserWorkspaceRecord[];
  tabs: BrowserTabRecord[];
  bindings: BrowserBindingRecord[];
}

export interface Preferences {
  uiLocale: string;
  reportLocale: string;
  themeMode: ThemeMode;
  defaultModel?: string;
  maxTurns: number;
  compactThresholdTokens: number;
  webSearch: WebSearchConfig;
  browserRuntime: BrowserRuntimePreferences;
}

export const listTools = (params?: {
  q?: string;
  deferred?: boolean;
  readonly?: boolean;
  destructive?: boolean;
}) =>
  api
    .get<{ success: boolean; data: ToolsListResponse }>('/tools', {
      params: params
        ? Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
          )
        : undefined,
    })
    .then((r) => r.data.data);

export const getTool = (name: string) =>
  api
    .get<{ success: boolean; data: ToolSummary }>(`/tools/${encodeURIComponent(name)}`)
    .then((r) => r.data.data);

export const parseRulesFromText = (text: string, useLLM?: boolean) =>
  api.post<{ source: string; candidates: Partial<Rule>[] }>('/rule-import/parse-text', { text, useLLM }).then((r) => r.data);
export const commitParsedRules = (candidates: Partial<Rule>[]) =>
  api.post<{ imported: number; ruleIds: string[] }>('/rule-import/commit', { candidates }).then((r) => r.data);

export const getPreferences = () => api.get<Preferences>('/preferences').then((r) => r.data);
export const putPreferences = (data: Partial<Preferences>) => api.put('/preferences', data).then((r) => r.data);
export const getBrowserState = () => api.get<BrowserStateResponse>('/browser/state').then((r) => r.data);
export const ensureSessionBrowserWorkspace = (sessionId: string) =>
  api.post<{ ok: true; workspace: BrowserWorkspaceRecord }>('/browser/workspaces/session', { sessionId }).then((r) => r.data);
export const ensureStandaloneBrowserWorkspace = () =>
  api.post<{ ok: true; workspace: BrowserWorkspaceRecord }>('/browser/workspaces/standalone').then((r) => r.data);
export const shareBrowserWorkspace = (workspaceId: string, payload: { sessionId: string; sharePolicy?: BrowserSharePolicy }) =>
  api.post<{ ok: true; workspace: BrowserWorkspaceRecord }>(`/browser/workspaces/${encodeURIComponent(workspaceId)}/share`, payload).then((r) => r.data);
export const attachBrowserWorkspace = (workspaceId: string, sessionId: string) =>
  api.post<{ ok: true; binding: BrowserBindingRecord }>(`/browser/workspaces/${encodeURIComponent(workspaceId)}/attach`, { sessionId }).then((r) => r.data);
export const detachBrowserWorkspace = (workspaceId: string, sessionId: string) =>
  api.post<{ ok: true; workspaceId: string; sessionId: string }>(`/browser/workspaces/${encodeURIComponent(workspaceId)}/detach`, { sessionId }).then((r) => r.data);
export const deleteBrowserWorkspace = (workspaceId: string, payload?: { sessionId?: string | null }) =>
  api.delete<{ ok: true; workspaceId: string }>(`/browser/workspaces/${encodeURIComponent(workspaceId)}`, { data: payload ?? {} }).then((r) => r.data);
export const createBrowserTab = (payload: {
  workspaceId: string;
  title?: string | null;
  currentUrl?: string | null;
  status?: string;
  providerTabRef?: string | null;
  contributedBySessionId?: string | null;
}) => api.post<{ ok: true; tab: BrowserTabRecord }>('/browser/tabs', payload).then((r) => r.data);
export const saveBrowserTabLayout = (workspaceId: string, tabs: Array<{ tabId: string; isPinned: boolean }>) =>
  api.post<{ ok: true; tabs: BrowserTabRecord[] }>(`/browser/workspaces/${encodeURIComponent(workspaceId)}/tabs/layout`, { tabs }).then((r) => r.data);
export const activateBrowserTab = (tabId: string, workspaceId: string) =>
  api.post<{ ok: true; workspace: BrowserWorkspaceRecord }>(`/browser/tabs/${encodeURIComponent(tabId)}/activate`, { workspaceId }).then((r) => r.data);
export const navigateBrowserTab = (tabId: string, workspaceId: string, url: string) =>
  api.post<{ ok: true; tab: BrowserTabRecord }>(`/browser/tabs/${encodeURIComponent(tabId)}/navigate`, { workspaceId, url }).then((r) => r.data);
export const goBackBrowserTab = (tabId: string, workspaceId: string) =>
  api.post<{ ok: true; tab: BrowserTabRecord }>(`/browser/tabs/${encodeURIComponent(tabId)}/back`, { workspaceId }).then((r) => r.data);
export const goForwardBrowserTab = (tabId: string, workspaceId: string) =>
  api.post<{ ok: true; tab: BrowserTabRecord }>(`/browser/tabs/${encodeURIComponent(tabId)}/forward`, { workspaceId }).then((r) => r.data);
export const reloadBrowserTab = (tabId: string, workspaceId: string) =>
  api.post<{ ok: true; tab: BrowserTabRecord }>(`/browser/tabs/${encodeURIComponent(tabId)}/reload`, { workspaceId }).then((r) => r.data);
export const closeBrowserTab = (tabId: string, workspaceId: string) =>
  api.delete<{ ok: true; workspaceId: string; closedTabId: string; nextActiveTabId: string | null }>(`/browser/tabs/${encodeURIComponent(tabId)}`, { data: { workspaceId } }).then((r) => r.data);
export const testWebSearch = (payload: { query: string; provider?: string; limit?: number }) =>
  api.post<{ ok: boolean; data: WebSearchTestResponse }>('/web-search/test', payload).then((r) => r.data.data);

export const getStorageConfig = () => api.get('/settings/storage').then((r) => r.data);
export const saveStorageConfig = (cfg: unknown) => api.post('/settings/storage', cfg).then((r) => r.data);

export interface CapabilityTemplateDescriptor {
  templateId: 'feishu-bot' | 'dingtalk-bot' | 'discord-bot' | 'generic-webhook' | 'mcp-server';
  capabilityKind: 'connector' | 'mcp-server';
  title: string;
  description: string;
  accent: string;
}

export interface CapabilityTemplateFile {
  path: string;
  purpose: 'manifest' | 'env' | 'program' | 'docs';
  content: string;
}

export interface CapabilityTemplateBundle {
  templateId: CapabilityTemplateDescriptor['templateId'];
  capabilityKind: CapabilityTemplateDescriptor['capabilityKind'];
  capabilityName: string;
  description: string;
  files: CapabilityTemplateFile[];
  nextSteps: string[];
}

export const listCapabilityTemplates = () =>
  api.get<{ templates: CapabilityTemplateDescriptor[] }>('/capabilities/templates').then((r) => r.data);

export const generateCapabilityTemplate = (payload: {
  templateId: CapabilityTemplateDescriptor['templateId'];
  capabilityName: string;
}) => api.post<{ bundle: CapabilityTemplateBundle }>('/capabilities/templates/generate', payload).then((r) => r.data);

export const listMCPServers = () => api.get<MCPServer[]>('/mcp').then((r) => r.data);
export const createMCPServer = (cfg: Partial<MCPServer>) => api.post<{ serverId: string }>('/mcp', cfg).then((r) => r.data);
export const deleteMCPServer = (id: string) => api.delete(`/mcp/${id}`);

// ─── MCP types + extended API ─────────────────────────────────────────────
export interface MCPServer {
  serverId:     string;
  name:         string;
  url:          string;
  transport:    'http' | 'sse' | 'stream';
  description:  string;
  timeoutMs:    number;
  enabled:      boolean;
  headers:      Record<string, string>;
  auth:         Record<string, unknown> | null;
  retryConfig:  Record<string, unknown> | null;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  healthError:  string | null;
  lastCheckAt:  string | null;
  toolCount:    number;
  createdAt:    string;
  updatedAt:    string;
}

export interface MCPTool {
  name:         string;
  description:  string;
  schema:       unknown;
  discoveredAt: string;
}

export const getMCPServer    = (id: string) =>
  api.get<MCPServer>(`/mcp/${id}`).then((r) => r.data);
export const updateMCPServer = (id: string, data: Partial<MCPServer>) =>
  api.put<{ ok: boolean }>(`/mcp/${id}`, data).then((r) => r.data);
export const toggleMCPServer = (id: string) =>
  api.patch<{ enabled: boolean }>(`/mcp/${id}/toggle`).then((r) => r.data);
export const getMCPTools     = (id: string) =>
  api.get<MCPTool[]>(`/mcp/${id}/tools`).then((r) => r.data);
export const refreshMCPTools = (id: string) =>
  api.post<{ discovered: number; error: string | null; tools: Pick<MCPTool, 'name' | 'description'>[] }>(`/mcp/${id}/refresh`, {}).then((r) => r.data);
export const checkMCPHealth  = (id: string) =>
  api.post<{ status: string; latencyMs: number | null; error: string | null; checkedAt: string }>(`/mcp/${id}/health`, {}).then((r) => r.data);
export const callMCPTool     = (serverId: string, toolName: string, params: Record<string, unknown>) =>
  api.post<{ ok: boolean; result: unknown }>('/mcp/call', { serverId, toolName, params }).then((r) => r.data);

// ─── DataSource API ────────────────────────────────────────────────────────
export interface DataSource {
  sourceId: string;
  name: string;
  sourceType: 'api' | 'git' | 'db' | 'file' | 'mcp' | 'web';
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DataSourceHealth {
  sourceId: string;
  name: string;
  sourceType: string;
  healthy: boolean;
  latencyMs: number;
  message?: string;
}

export interface DbSchemaTable {
  name: string;
  comment?: string;
  columns: Array<{ name: string; type: string; nullable: boolean; comment?: string }>;
}

export interface DataSourceKnowledgeSummary {
  snapshotId: string;
  sourceId: string;
  sourceType: DataSource['sourceType'];
  graphName: string;
  vectorCollection: string;
  nodeCount: number;
  edgeCount: number;
  documentCount: number;
  builtAt: string;
  metadata: Record<string, unknown>;
}

export interface DataSourceKnowledgeSearchHit {
  documentId: string;
  title: string;
  documentType: string;
  score: number;
  excerpt: string;
  metadata?: Record<string, unknown>;
}

export interface DataSourceKnowledgeSearchResult {
  sourceId: string;
  graphName: string;
  vectorCollection: string;
  hits: DataSourceKnowledgeSearchHit[];
}

export type ModelProviderId =
  | 'openai'
  | 'openai-compatible'
  | 'openrouter'
  | 'anthropic'
  | 'anthropic-compatible'
  | 'ollama'
  | 'azure-openai'
  | 'google'
  | 'bedrock'
  | 'mock';

export interface ModelConfigPayload {
  provider: ModelProviderId;
  modelName: string;
  role?: string;
  config?: {
    baseUrl?: string;
    apiKey?: string;
    apiKeyMasked?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    [key: string]: unknown;
  };
  enabled?: boolean;
  isDefault?: boolean;
}

export interface ModelConfigRecord extends ModelConfigPayload {
  modelId: string;
  config: Record<string, unknown>;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
}

export interface DiscoveredModelCatalogItem {
  id: string;
  label: string;
}

export interface ModelTestResponse {
  success: boolean;
  mode: 'connect' | 'call' | 'stream';
  provider: string;
  modelName: string;
  text?: string;
  stopReason?: string;
  chunkCount?: number;
  durationMs: number;
  statusCode?: number;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheCreationTokens?: number;
    estimatedUsd: number;
  };
}

export const listDataSources = () => api.get<DataSource[]>('/datasources').then((r) => r.data);
export const createDataSource = (cfg: Partial<DataSource>) => api.post<{ sourceId: string }>('/datasources', cfg).then((r) => r.data);
export const updateDataSource = (id: string, cfg: Partial<DataSource>) => api.put<DataSource>(`/datasources/${id}`, cfg).then((r) => r.data);
export const deleteDataSource = (id: string) => api.delete(`/datasources/${id}`);
export const testDataSource = (id: string) => api.post<{ healthy: boolean; latencyMs: number; message?: string }>(`/datasources/${id}/test`).then((r) => r.data);
export const getDataSourceSchema = (id: string) => api.get<{ sourceId: string; tables: DbSchemaTable[] }>(`/datasources/${id}/schema`).then((r) => r.data);
export const getDataSourcesHealth = () => api.get<DataSourceHealth[]>('/datasources/health').then((r) => r.data);
export const rebuildDataSourceKnowledge = (id: string) => api.post<DataSourceKnowledgeSummary>(`/datasources/${id}/knowledge/rebuild`).then((r) => r.data);
export const getDataSourceKnowledge = (id: string) => api.get<DataSourceKnowledgeSummary>(`/datasources/${id}/knowledge`).then((r) => r.data);
export const searchDataSourceKnowledge = (id: string, query: string, limit = 5) =>
  api.get<DataSourceKnowledgeSearchResult>(`/datasources/${id}/knowledge/search`, { params: { query, limit } }).then((r) => r.data);

export const listModels = () => api.get<ModelConfigRecord[]>('/models').then((r) => r.data);
export const discoverModels = (payload: { provider: ModelProviderId; baseUrl: string; apiKey?: string; modelId?: string }) =>
  api.post<{ models: DiscoveredModelCatalogItem[] }>('/models/discover', payload).then((r) => r.data);
export const createModel = (cfg: ModelConfigPayload) => api.post<{ modelId: string }>('/models', cfg).then((r) => r.data);
export const updateModel = (id: string, cfg: ModelConfigPayload) => api.put<ModelConfigRecord>(`/models/${id}`, cfg).then((r) => r.data);
export const testModel = (id: string, payload?: { prompt?: string; systemPrompt?: string; mode?: 'connect' | 'call' | 'stream' }) =>
  api.post<ModelTestResponse>(`/models/${id}/test`, payload ?? {}).then((r) => r.data);
export const deleteModel = (id: string) => api.delete(`/models/${id}`);

export interface SkillSummary {
  name: string;
  description: string;
  source: 'bundled' | 'directory' | 'mcp' | 'ai-generated' | 'dynamic' | 'conditional';
  tags?: string[];
  path?: string;
  paths?: string[];
  contextMode?: 'shared' | 'fork';
  version?: string;
  author?: string;
}

export interface SkillImportFilePayload {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface SkillImportPayload {
  rootName: string;
  overwrite?: boolean;
  files: SkillImportFilePayload[];
}

export interface SkillFileTreeEntry {
  path: string;
  type: 'file' | 'directory';
}

export interface SkillFileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

export const listSkills = (params?: { q?: string }) =>
  api.get<{ success: boolean; data: SkillSummary[] }>('/skills', { params }).then((r) => r.data);
export const getSkill = (name: string) =>
  api.get<{ success: boolean; data: SkillSummary }>(`/skills/${name}`).then((r) => r.data);
export const createSkill = (body: { name: string; description: string; content: string }) =>
  api.post('/skills', body).then((r) => r.data);
export const deleteSkill = (name: string) => api.delete(`/skills/${name}`).then((r) => r.data);
export const testSkill = (name: string) => api.get(`/skills/${name}/test`).then((r) => r.data);
export const importSkillPackage = (payload: SkillImportPayload) =>
  api.post<{ success: boolean; data: SkillSummary }>('/skills/import', payload).then((r) => r.data);
export const getSkillTree = (name: string) =>
  api.get<{ success: boolean; data: { entries: SkillFileTreeEntry[] } }>(`/skills/${encodeURIComponent(name)}/tree`).then((r) => r.data.data.entries);
export const getSkillFile = (name: string, path: string) =>
  api.get<{ success: boolean; data: SkillFileContent }>(`/skills/${encodeURIComponent(name)}/file`, { params: { path } }).then((r) => r.data.data);
export const installSkillFromUrl = (url: string, name?: string, overwrite?: boolean) =>
  api.post<{ success: boolean; data: SkillSummary }>('/skills/install-url', { url, name, overwrite }).then((r) => r.data);

// ─── BusinessProfile API (03-analysis-engine.md §2) ──────────────────────
export interface ProfileEntity {
  entityType: string;
  name: string;
  count: number;
  attributes: Record<string, unknown>;
}

export interface BehaviorStep {
  action: string;
  scenarioId: string;
  scenarioName: string;
  riskKeyword?: string;
}

export interface RiskAttribute {
  dimension: string;
  coveredCount: number;
  totalExpected: number;
  coverageRatio: number;
  coveredRuleIds: string[];
}

export interface BusinessProfileSummary {
  profileId: string;
  sessionId: string;
  businessName: string;
  version: number;
  overallScore: number;
  createdAt: string;
}

export interface BusinessProfileDetail extends BusinessProfileSummary {
  entities: ProfileEntity[];
  behaviors: BehaviorStep[];
  apiFeatures: RiskAttribute[];
}

export const listBusinessProfiles = () =>
  api.get<BusinessProfileSummary[]>('/businesses/profiles').then((r) => r.data);

export const getBusinessProfile = (id: string) =>
  api.get<BusinessProfileDetail>(`/businesses/profiles/${id}`).then((r) => r.data);

export const getBusinessProfilesByName = (name: string) =>
  api.get<BusinessProfileSummary[]>('/businesses/profiles', { params: { name } }).then((r) => r.data);

// ─── Rule Semantic Search (02-risk-knowledge-base.md §7.2) ────────────────
export interface SimilarRule extends Rule {
  similarityScore: number;
}

export const getSimilarRules = (params: { q?: string; ruleId?: string; topK?: number }) =>
  api.get<SimilarRule[]>('/rules/similar', { params }).then((r) => r.data);

// ─── Rule Sources (04-storage-layer.md §2.2) ─────────────────────────────

export interface RuleSource {
  sourceId: string;
  systemName: string;
  systemType: 'realtime' | 'offline' | 'manual';
  sourceType: 'file_import' | 'api_sync' | 'manual_input' | 'model_generated';
  fileName?: string;
  ruleCount: number;
  importedBy?: string;
  importNote?: string;
  createdAt: string;
}

export interface RuleSourceDetail extends RuleSource {
  mappings: Array<{ ruleId: string; confidence: number; parseNotes?: string }>;
}

export const listRuleSources = (params?: { sourceType?: string }) =>
  api.get<RuleSource[]>('/rule-sources', { params }).then((r) => r.data);

export const getRuleSource = (id: string) =>
  api.get<RuleSourceDetail>(`/rule-sources/${id}`).then((r) => r.data);

export const createRuleSource = (data: Partial<RuleSource>) =>
  api.post<RuleSource>('/rule-sources', data).then((r) => r.data);

export const updateRuleSource = (id: string, data: Partial<RuleSource>) =>
  api.put<RuleSource>(`/rule-sources/${id}`, data).then((r) => r.data);

export const deleteRuleSource = (id: string) =>
  api.delete(`/rule-sources/${id}`);

export const addRuleSourceMappings = (mappings: Array<{ ruleId: string; sourceId: string; confidence?: number; parseNotes?: string }>) =>
  api.post<{ mapped: number; ruleIds: string[] }>('/rule-sources/mappings', { mappings }).then((r) => r.data);

export const getRuleSourceRules = (id: string) =>
  api.get<Array<Pick<Rule, 'ruleId' | 'ruleName' | 'bizType' | 'ruleType' | 'riskLevel' | 'status'> & { confidence: number; parseNotes?: string }>>(`/rule-sources/${id}/rules`).then((r) => r.data);

// ─── Profile Diff (03-analysis-engine.md §4) ─────────────────────────────

export interface DimensionChange {
  dimension: string;
  ratioA: number;
  ratioB: number;
  delta: number;
}

export interface ProfileDiff {
  profileIdA: string;
  profileIdB: string;
  businessName: string;
  versionA: number;
  versionB: number;
  scoreDelta: number;
  scoreA: number;
  scoreB: number;
  addedEntities: ProfileEntity[];
  removedEntities: ProfileEntity[];
  dimensionChanges: DimensionChange[];
  behaviorCountA: number;
  behaviorCountB: number;
}

export const diffProfiles = (id1: string, id2: string) =>
  api.get<ProfileDiff>('/businesses/profiles/diff', { params: { id1, id2 } }).then((r) => r.data);

// ─── Lineage Display (04-storage-layer.md §5) ────────────────────────────

export interface LineageDisplayNode {
  id: string;
  label: string;
  type: string;
  attrs: Record<string, unknown>;
}

export interface LineageDisplayEdge {
  source: string;
  target: string;
  label: string;
  type: string;
}

export interface LineageDisplayData {
  nodes: LineageDisplayNode[];
  edges: LineageDisplayEdge[];
}

export const getLineageDisplay = (params?: { center?: string; depth?: number }) =>
  api.get<LineageDisplayData>('/lineage/display', { params }).then((r) => r.data);

export const getLineageChain = (id: string, direction?: 'upstream' | 'downstream' | 'both') =>
  api.get(`/lineage/${id}/chain`, { params: { direction } }).then((r) => r.data);

// ─── Security API (10-sandbox-security.md §7) ────────────────────────────

export type SecurityEventType =
  | 'sandbox-code-blocked'
  | 'sandbox-timeout'
  | 'sandbox-error'
  | 'sandbox-lease-created'
  | 'sandbox-lease-complete'
  | 'sandbox-lease-cancelled'
  | 'sandbox-process-started'
  | 'sandbox-process-complete'
  | 'sandbox-process-cancelled'
  | 'sql-blocked'
  | 'permission-denied'
  | 'subagent-capability-blocked'
  | 'parameter-injection';

export interface SecurityAuditEvent {
  eventId?: string;
  timestamp: number;
  eventType: SecurityEventType;
  agentId: string;
  details: Record<string, unknown>;
}

export interface SecurityConfig {
  sandbox: {
    timeoutMs: number;
    maxResultSizeChars: number;
    forbiddenPatternCount: number;
    forbiddenPatterns: Array<{ pattern: string; description: string }>;
    runtime: {
      hostKind: 'js-vm';
      filesystem: 'none';
      network: 'deny';
      httpRequests: boolean;
      dynamicEval: boolean;
      dynamicImports: boolean;
      userOverridesSupported: boolean;
    };
    localProcess: {
      hostKind: 'local-process';
      available: boolean;
      defaultNetwork: 'deny';
      filesystemScopeSource: 'tool-binding';
      workingDirectorySource: 'tool-request';
      timeoutSource: 'tool-policy';
      commandAllowlistSupported: boolean;
      confirmationSupported: boolean;
      userOverridesSupported: boolean;
    };
  };
  subAgent: {
    maxSteps: number;
    compactThresholdTokens: number;
    toolExecutionTimeoutMs: number;
    totalTimeoutMs: number;
    forbiddenCapabilities: string[];
    allowedToolNames: string[];
  };
}

export const getSecurityAudit = (params?: {
  eventType?: SecurityEventType;
  limit?: number;
  since?: number;
}) =>
  api
    .get<{ success: boolean; data: SecurityAuditEvent[] }>('/security/audit', { params })
    .then((r) => r.data.data);

export const getSecurityConfig = () =>
  api
    .get<{ success: boolean; data: SecurityConfig }>('/security/config')
    .then((r) => r.data.data);

export interface SubAgentConfigUpdate {
  maxSteps?: number;
  compactThresholdTokens?: number;
  toolExecutionTimeoutMs?: number;
  totalTimeoutMs?: number;
  forbiddenCapabilities?: string[];
  allowedToolNames?: string[];
}

export const putSubAgentConfig = (data: SubAgentConfigUpdate) =>
  api.put<{ ok: boolean }>('/security/subagent', data).then((r) => r.data);

// ─── Knowledge Graph API (knowledge-graph routes) ─────────────────────────

export type KGNodeType =
  | 'rule' | 'rule_source' | 'rule_system' | 'scenario'
  | 'business' | 'profile' | 'dimension' | 'gap' | 'report' | 'document';

export type KGRelationType =
  | 'derived_from' | 'belongs_to' | 'covers' | 'references'
  | 'conflicts_with' | 'replaces' | 'has_profile' | 'has_entity' | 'exposes_gap';

export interface KGNode {
  id: string;
  label: string;
  nodeType: KGNodeType;
  graph?: string;
  attributes?: Record<string, unknown>;
}

export interface KGEdge {
  source: string;
  target: string;
  relation: KGRelationType;
  attributes?: Record<string, unknown>;
}

export interface KGDisplayGraph {
  nodes: KGNode[];
  edges: KGEdge[];
}

export interface KGOverviewStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByRelation: Record<string, number>;
}

export interface KGImpactResult {
  directImpact: KGNode[];
  indirectImpact: KGNode[];
  affectedRelations: KGEdge[];
}

export interface KGImpactSummary {
  nodeId: string;
  direct: KGNode[];
  indirect: KGNode[];
  byType: Partial<Record<KGNodeType, KGNode[]>>;
  affectedEdges: KGEdge[];
  totalCount: number;
}

export interface KGConflictPair {
  nodeA: KGNode;
  nodeB: KGNode;
  source: 'explicit' | 'inferred';
  reason?: string;
}

/** GET /api/knowledge-graph/overview */
export const getKGOverview = () =>
  api.get<KGOverviewStats>('/knowledge-graph/overview').then((r) => r.data);

/** GET /api/knowledge-graph/search?q=&types=&limit= */
export const searchKG = (q?: string, types?: KGNodeType[], limit = 50) =>
  api.get<KGNode[]>('/knowledge-graph/search', {
    params: { q, types: types?.join(','), limit }
  }).then((r) => r.data);

/** GET /api/knowledge-graph/neighborhood/:nodeId */
export const getKGNeighborhood = (
  nodeId: string,
  opts?: { depth?: number; direction?: 'upstream' | 'downstream' | 'both'; relations?: KGRelationType[] }
) =>
  api.get<KGDisplayGraph>(`/knowledge-graph/neighborhood/${encodeURIComponent(nodeId)}`, {
    params: { depth: opts?.depth, direction: opts?.direction, relations: opts?.relations?.join(',') }
  }).then((r) => r.data);

/** GET /api/knowledge-graph/chain/:nodeId */
export const getKGChain = (nodeId: string, direction?: 'upstream' | 'downstream' | 'both') =>
  api.get<KGDisplayGraph>(`/knowledge-graph/chain/${encodeURIComponent(nodeId)}`, {
    params: { direction }
  }).then((r) => r.data);

/** GET /api/knowledge-graph/impact/:nodeId */
export const getKGImpact = (nodeId: string) =>
  api.get<KGImpactResult>(`/knowledge-graph/impact/${encodeURIComponent(nodeId)}`).then((r) => r.data);

/** GET /api/knowledge-graph/impact/:nodeId/detail — 分类分组影响分析 */
export const getKGImpactDetail = (nodeId: string, depth?: number) =>
  api.get<KGImpactSummary>(`/knowledge-graph/impact/${encodeURIComponent(nodeId)}/detail`, {
    params: { depth }
  }).then((r) => r.data);

/** GET /api/knowledge-graph/conflicts — 全图冲突检测 */
export const getKGConflicts = () =>
  api.get<KGConflictPair[]>('/knowledge-graph/conflicts').then((r) => r.data);

/** GET /api/knowledge-graph/conflicts/:nodeId — 节点冲突 */
export const getKGConflictsForNode = (nodeId: string) =>
  api.get<KGConflictPair[]>(`/knowledge-graph/conflicts/${encodeURIComponent(nodeId)}`).then((r) => r.data);

/** POST /api/knowledge-graph/nodes */
export const createKGNode = (node: { id: string; label: string; nodeType: KGNodeType; attributes?: Record<string, unknown> }) =>
  api.post<{ ok: boolean }>('/knowledge-graph/nodes', node).then((r) => r.data);

/** PATCH /api/knowledge-graph/nodes/:id */
export const updateKGNode = (id: string, patch: { label?: string; attributes?: Record<string, unknown> }) =>
  api.patch<{ ok: boolean }>(`/knowledge-graph/nodes/${encodeURIComponent(id)}`, patch).then((r) => r.data);

/** DELETE /api/knowledge-graph/nodes/:id */
export const deleteKGNode = (id: string) =>
  api.delete<{ ok: boolean }>(`/knowledge-graph/nodes/${encodeURIComponent(id)}`).then((r) => r.data);

/** POST /api/knowledge-graph/edges */
export const createKGEdge = (edge: {
  from: { id: string; label: string; nodeType: KGNodeType };
  to: { id: string; label: string; nodeType: KGNodeType };
  relation: KGRelationType;
  attributes?: Record<string, unknown>;
}) =>
  api.post<{ ok: boolean }>('/knowledge-graph/edges', edge).then((r) => r.data);

/** POST /api/knowledge-graph/backfill */
export const runKGBackfill = () =>
  api.post<{ ok: boolean; nodesRestored: number; edgesRestored: number }>('/knowledge-graph/backfill').then((r) => r.data);

// ─── Run API (harness-kernel-phase1) ─────────────────────────────────────

export type RunTaskKind = 'analysis' | 'general' | 'knowledge-query' | 'skill-management';
export type RunAgentMode = 'task-pack' | 'hermes';
export type RunStatusValue =
  | 'created' | 'routing' | 'planning' | 'running'
  | 'waiting_user' | 'verifying' | 'completed' | 'failed' | 'cancelled';

export interface RunCapabilitySwitch {
  from: RunTaskKind;
  to: RunTaskKind;
  reason: string;
  source?: 'router' | 'model' | 'system' | 'user';
}

export interface RunSummary {
  runId: string;
  taskKind: RunTaskKind;
  status: RunStatusValue;
  terminationReason?: string;
  input: Record<string, unknown>;
  routing: {
    acceptedTaskKind: RunTaskKind;
    initialCapabilityProfile?: RunTaskKind;
    agentMode?: RunAgentMode;
    confidence: number;
    reason: string;
    routeParams: Record<string, unknown>;
  };
  currentCapabilityProfile?: RunTaskKind;
  capabilitySwitches?: RunCapabilitySwitch[];
  metrics: {
    turnCount: number;
    toolCallCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedUsd: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface RunTimelineEvent {
  eventId: string;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RunArtifactRecord {
  artifactId: string;
  runId: string;
  kind: 'markdown' | 'json' | 'structured-answer' | 'report';
  mimeType: string;
  contentJson?: unknown;
  contentText?: string;
  version: number;
  createdAt: string;
}

export type RunApprovalMode = 'default' | 'bypass' | 'autopilot';

export interface RunComposerPayload {
  content: string;
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
  mode?: 'stop-and-send' | 'queue' | 'steer';
  approvalMode?: RunApprovalMode;
}

export type ScheduledRunTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledRunRecord {
  scheduleId: string;
  name: string;
  cron: string;
  timezone?: string;
  taskKind?: RunTaskKind;
  input: Record<string, unknown>;
  preferredModel?: string;
  enabled: boolean;
  nextRunAt?: string;
  lastTriggeredAt?: string;
  lastRunId?: string;
  lastTaskId?: string;
  lastStatus?: ScheduledRunTaskStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledRunPayload {
  name: string;
  cron: string;
  timezone?: string;
  taskKind?: RunTaskKind;
  input: Record<string, unknown>;
  preferredModel?: string;
  enabled?: boolean;
}

export interface UpdateScheduledRunPayload {
  name?: string;
  cron?: string;
  timezone?: string;
  taskKind?: RunTaskKind;
  input?: Record<string, unknown>;
  preferredModel?: string;
  enabled?: boolean;
}

export interface CreateRunResponse {
  runId: string;
  status: string;
  taskKind: RunTaskKind;
  acceptedTaskKind: RunTaskKind;
  agentMode?: RunAgentMode;
  initialCapabilityProfile?: RunTaskKind;
  initialCheckpoint: unknown;
}

export function resolveRunInitialCapability(run: Pick<RunSummary, 'taskKind' | 'routing'> | undefined | null): RunTaskKind | undefined {
  if (!run) {
    return undefined;
  }

  return run.routing.initialCapabilityProfile ?? run.routing.acceptedTaskKind ?? run.taskKind;
}

export function resolveRunCurrentCapability(
  run: Pick<RunSummary, 'taskKind' | 'routing' | 'currentCapabilityProfile'> | undefined | null,
): RunTaskKind | undefined {
  if (!run) {
    return undefined;
  }

  return run.currentCapabilityProfile ?? resolveRunInitialCapability(run);
}

export function resolveRunDisplayTaskKind(
  run: Pick<RunSummary, 'taskKind' | 'routing' | 'currentCapabilityProfile'> | undefined | null,
): RunTaskKind | undefined {
  if (!run) {
    return undefined;
  }

  const currentCapability = resolveRunCurrentCapability(run);
  if (run.routing.agentMode === 'hermes') {
    return currentCapability;
  }

  return run.taskKind ?? currentCapability;
}

export const listRuns = () => api.get<RunSummary[]>('/runs').then((r) => r.data);
export const getRun = (id: string) => api.get<RunSummary>(`/runs/${id}`).then((r) => r.data);
export const createRun = (payload: {
  taskKind?: RunTaskKind;
  input: Record<string, unknown>;
  preferredModel?: string;
  surface?: string;
  approvalMode?: RunApprovalMode;
}) =>
  api.post<CreateRunResponse>('/runs', payload).then((r) => r.data);
export const getRunEvents = (id: string) => api.get<RunTimelineEvent[]>(`/runs/${id}/events`).then((r) => r.data);
export const getRunArtifacts = (id: string) => api.get<RunArtifactRecord[]>(`/runs/${id}/artifacts`).then((r) => r.data);
export const submitRunInput = (id: string, body: Record<string, unknown>) =>
  api.post<{ ok: true; runId: string; accepted: boolean }>(`/runs/${id}/input`, body).then((r) => r.data);
export const appendRunMessage = (id: string, payload: RunComposerPayload) =>
  api.post<{ ok: boolean; runId: string; resumed: boolean; interrupted: boolean }>(`/runs/${id}/messages`, payload).then((r) => r.data);
export const cancelRun = (id: string) => api.post<{ ok: boolean }>(`/runs/${id}/cancel`).then((r) => r.data);

export const listScheduledRuns = () => api.get<ScheduledRunRecord[]>('/scheduled-runs').then((r) => r.data);
export const getScheduledRun = (id: string) => api.get<ScheduledRunRecord>(`/scheduled-runs/${id}`).then((r) => r.data);
export const createScheduledRun = (payload: CreateScheduledRunPayload) =>
  api.post<ScheduledRunRecord>('/scheduled-runs', payload).then((r) => r.data);
export const updateScheduledRun = (id: string, payload: UpdateScheduledRunPayload) =>
  api.patch<ScheduledRunRecord>(`/scheduled-runs/${id}`, payload).then((r) => r.data);
export const deleteScheduledRun = (id: string) => api.delete(`/scheduled-runs/${id}`).then((r) => r.data);
export const triggerScheduledRun = (id: string) => api.post<ScheduledRunRecord>(`/scheduled-runs/${id}/trigger`).then((r) => r.data);

export function buildRunStreamUrl(runId: string): string {
  const runtimeOverride =
    typeof window !== 'undefined' ? window.localStorage.getItem('risk-agent.apiBaseUrl')?.trim() : undefined;
  const envOverride = import.meta.env.VITE_API_BASE_URL?.trim();

  // In the default dev flow, EventSource must stay same-origin so Vite can proxy
  // the stream request to the server without hitting browser CORS restrictions.
  if (import.meta.env.DEV && !runtimeOverride && !envOverride) {
    return `/api/runs/${runId}/stream`;
  }

  return buildApiUrl(`/runs/${runId}/stream`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Personas (A1) & User Profile (A2)
// ─────────────────────────────────────────────────────────────────────────────

export type PersonaScope = 'general' | 'analysis' | 'knowledge-query' | 'skill-management' | 'data-analysis';

export interface Persona {
  personaId: string;
  name: string;
  description?: string;
  systemPrompt: string;
  scope: PersonaScope;
  source: 'builtin' | 'user' | 'auto-generated';
  isBuiltIn: boolean;
  parentId?: string;
  enabled: boolean;
  traits?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  profileId: string;
  ownerKey: string;
  displayName?: string;
  traits: Record<string, unknown>;
  preferences: Record<string, unknown>;
  learnedFacts: Array<{ key?: string; value: string; learnedAt?: string; source?: string }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const listPersonas = () => api.get<{ items: Persona[] }>('/personas').then((r) => r.data.items);
export const getPersona = (id: string) => api.get<Persona>(`/personas/${id}`).then((r) => r.data);
export const createPersona = (payload: Partial<Persona> & { name: string; systemPrompt: string }) =>
  api.post<Persona>('/personas', payload).then((r) => r.data);
export const updatePersona = (id: string, payload: Partial<Persona>) =>
  api.patch<Persona>(`/personas/${id}`, payload).then((r) => r.data);
export const forkPersona = (id: string, overrides: Partial<Persona> = {}) =>
  api.post<Persona>(`/personas/${id}/fork`, overrides).then((r) => r.data);
export const deletePersona = (id: string) => api.delete(`/personas/${id}`).then((r) => r.data);
export const applyPersonaToSession = (sessionId: string, personaId: string, source: 'user' | 'auto' | 'fallback' = 'user') =>
  api.post<{ ok: boolean; persona: Persona }>(`/sessions/${sessionId}/persona`, { personaId, source }).then((r) => r.data);
export const getSessionPersona = (sessionId: string) =>
  api.get<Persona | ''>(`/sessions/${sessionId}/persona`).then((r) => (r.status === 204 ? null : (r.data as Persona)));

export const getUserProfile = () => api.get<UserProfile>('/user-profile').then((r) => r.data);
export const updateUserProfile = (payload: Partial<Pick<UserProfile, 'displayName' | 'traits' | 'preferences'>>) =>
  api.patch<UserProfile>('/user-profile', payload).then((r) => r.data);
export const mergeUserProfileFacts = (facts: Array<{ key?: string; value: string; confidence?: number }>) =>
  api.post<UserProfile>('/user-profile/facts', { facts }).then((r) => r.data);
export const resetUserProfile = () => api.post<UserProfile>('/user-profile/reset').then((r) => r.data);

// ─────────────────────────────────────────────────────────────────────────────
// Insights + Memory Search (A4)
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryFactItem {
  fact_id: string;
  content: string;
  category: string;
  source_session: string | null;
  source_run: string | null;
  confidence: number;
  use_count: number;
  created_at: string;
}

export interface InsightGroup {
  category: string;
  label: string;
  facts: MemoryFactItem[];
}

export interface InsightsSummary {
  totalFacts: number;
  generatedAt: string;
  days: number;
  groups: InsightGroup[];
}

export const getInsights = (days = 30) =>
  api.get<InsightsSummary>(`/insights?days=${days}`).then((r) => r.data);

export const searchMemoryFacts = (q: string, opts?: { days?: number; category?: string; limit?: number }) => {
  const params = new URLSearchParams({ q });
  if (opts?.days != null) params.set('days', String(opts.days));
  if (opts?.category) params.set('category', opts.category);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  return api.get<{ query: string; total: number; results: MemoryFactItem[] }>(`/sessions/search?${params}`).then((r) => r.data);
};
