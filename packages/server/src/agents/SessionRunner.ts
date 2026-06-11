import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  OrchestratorAgent,
  type AgentToolDefinition,
  createJsSandboxHost,
  createLocalProcessSandboxHost,
  QueryEngine,
  PromptAssembler,
  SandboxRuntime,
  SecurityAuditService,
  ToolRegistry,
  CostTracker,
  TranscriptStore,
  askUserTool,
  createGraphQueryTool,
  createGetDatabaseSchemaTool,
  createQueryDatabaseTool,
  createQueryDatabaseExternalTool,
  packageProbeTool,
  packageManagerProbeTool,
  packageManagerWriteTool,
  processProbeTool,
  gitScanTool,
  jsSandboxTool,
  shellExecTool,
  createToolSearchTool,
  createVectorSearchTool,
  fileParseTool,
  fileWriteTool,
  webFetchTool,
  workspaceProbeTool,
  type Message,
  type StorageBackendRegistry,
  type BusinessScenario,
  type RiskRule,
  type StreamEvent,
  type SessionEvent,
  type SessionInfo,
  type SessionStatus,
} from '@risk-agent/core';
import { matchSessionMode } from '@risk-agent/core';
import { buildConfiguredLLMRuntime } from '../llm/factory.js';
import { loadRuntimePreferences } from '../preferences/runtimePreferences.js';
import { playwrightWebScrapeTool } from '../tools/PlaywrightWebScrapeTool.js';
import { createBrowserHostTool } from '../tools/BrowserHostTool.js';
import { createSystemResourcesTool } from '../tools/SystemResourcesTool.js';
import { createSystemSettingsTool } from '../tools/SystemSettingsTool.js';
import { createWebSearchTool } from '../tools/WebSearchTool.js';
import type { BrowserWorkspaceService } from '../browser/BrowserWorkspaceService.js';
import type { BrowserHostAdapter } from '../browser/BrowserHostAdapter.js';
import {
  DataSourceKnowledgeService,
  createDataSourceKnowledgeGraphTool,
  createDataSourceKnowledgeSearchTool,
} from '../services/DataSourceKnowledgeService.js';
import { SessionAttachmentService } from '../services/SessionAttachmentService.js';
import { MemoryCurator } from './MemoryCurator.js';

const SESSION_WORKSPACE_ROOT = process.cwd();

export interface StartSessionInput {
  sessionId?: string;
  businessName: string;
  description?: string;
  scenarioIds?: string[];
  ruleScope?: { bizTypes?: string[]; ruleTypes?: string[] };
  locale?: string;
  /** 指定使用的模型配置 ID（可选，默认使用 is_default 模型）*/
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
}

export interface AppendUserMessageInput {
  content: string;
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
}

export interface ResumeSessionInput {
  /** 已有的会话 ID */
  sessionId: string;
  /** 恢复时追加的追加提示（可选，如"请继续上次分析"）*/
  continuePrompt?: string;
  /** 恢复/续聊时指定模型（可选，默认回落到默认模型） */
  modelId?: string;
  attachmentIds?: string[];
  toolIds?: string[];
}

export interface SessionFollowUpResult {
  sessionId: string;
  resumed: boolean;
  interrupted: boolean;
}

export interface SessionHandle {
  sessionId: string;
  emitter: EventEmitter;
  done: Promise<void>;
  cancel: () => void;
  eventHistory: StreamEvent[];
  /** 会话启动时间，用于 getActiveSessions() 报告 */
  startedAt: string;
  /** 会话归属业务名称 */
  businessName: string;
}

/** 全局会话状态事件发射器，供 /api/ws/sessions WebSocket 广播 */
export const sessionEventBus = new EventEmitter();
sessionEventBus.setMaxListeners(0);

interface SessionMcpServerRow {
  server_id: string;
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stream';
  timeout_ms: number | null;
  config_json: string | null;
  mcp_session_id?: string | null;
  mcp_initialized?: boolean;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_CLIENT_INFO = { name: 'risk-agent', version: '0.1.0' };
const PLAYWRIGHT_SESSION_RESET_RETRY_SAFE_TOOLS = new Set(['browser_navigate']);
const BUILTIN_PLAYWRIGHT_SERVER_ID = 'builtin-playwright';

interface SessionMcpToolRow {
  server_id: string;
  tool_name: string;
  description: string | null;
  schema_json: string | null;
}

export interface SessionToolRegistryOptions {
  browserWorkspaces?: BrowserWorkspaceService;
  browserHostAdapter?: BrowserHostAdapter | null;
}

export async function buildSessionToolRegistry(
  storage: StorageBackendRegistry,
  options: SessionToolRegistryOptions = {},
): Promise<{ registry: ToolRegistry; mcpServers: string[] }> {
  const registry = new ToolRegistry();
  const knowledgeService = new DataSourceKnowledgeService(storage);
  const resolveExternalDatasourceConfig = async (datasourceId: string) => {
    const row = await storage.getStructuredStore().get<{ source_type: string; config_json: string | null }>(
      `SELECT source_type, config_json FROM data_sources WHERE source_id=?`,
      [datasourceId],
    );
    if (!row || row.source_type !== 'db') return null;
    if (!row.config_json) return {};
    try {
      return JSON.parse(row.config_json) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  registry.register(askUserTool);
  registry.register(createQueryDatabaseTool(storage.getStructuredStore()));
  registry.register(createGetDatabaseSchemaTool(resolveExternalDatasourceConfig));
  registry.register(createQueryDatabaseExternalTool(resolveExternalDatasourceConfig));
  registry.register(createGraphQueryTool(storage.getGraphStore()));
  registry.register(createVectorSearchTool(storage.getVectorStore()));
  registry.register(createDataSourceKnowledgeSearchTool(knowledgeService));
  registry.register(createDataSourceKnowledgeGraphTool(knowledgeService));
  registry.register(fileParseTool);
  registry.register(fileWriteTool);
  registry.register(createSystemSettingsTool(storage.getStructuredStore()));
  registry.register(createSystemResourcesTool(storage));
  registry.register(webFetchTool);
  registry.register(createWebSearchTool(storage.getStructuredStore()));
  registry.register(gitScanTool);
  registry.register(workspaceProbeTool);
  registry.register(packageProbeTool);
  registry.register(packageManagerProbeTool);
  registry.register(packageManagerWriteTool);
  registry.register(processProbeTool);
  registry.register(jsSandboxTool);
  registry.register(shellExecTool);
  registry.register(playwrightWebScrapeTool);
  if (options.browserWorkspaces) {
    registry.register(createBrowserHostTool({
      store: storage.getStructuredStore(),
      browserWorkspaces: options.browserWorkspaces,
      browserHostAdapter: options.browserHostAdapter ?? null,
    }));
  }
  const mcpServers = await registerEnabledMcpTools(storage, registry);
  registry.register(createToolSearchTool(registry));

  return { registry, mcpServers };
}

async function registerEnabledMcpTools(storage: StorageBackendRegistry, registry: ToolRegistry): Promise<string[]> {
  const store = storage.getStructuredStore();
  const servers = await store.all<SessionMcpServerRow>(
    `SELECT server_id, name, url, transport, timeout_ms, config_json FROM mcp_servers WHERE enabled=1 ORDER BY created_at ASC`
  ).catch(() => []);

  if (servers.length === 0) {
    return [];
  }

  const cachedTools = await store.all<SessionMcpToolRow>(
    `SELECT server_id, tool_name, description, schema_json FROM mcp_tool_cache ORDER BY discovered_at ASC`
  ).catch(() => []);
  const cachedByServer = new Map<string, SessionMcpToolRow[]>();
  for (const tool of cachedTools) {
    const bucket = cachedByServer.get(tool.server_id) ?? [];
    bucket.push(tool);
    cachedByServer.set(tool.server_id, bucket);
  }

  const connectedServers: string[] = [];
  for (const server of servers) {
    let tools = cachedByServer.get(server.server_id) ?? [];
    if (tools.length === 0) {
      tools = await discoverAndCacheMcpTools(store, server);
    }
    if (tools.length === 0) {
      continue;
    }

    const toolNamespace = toMcpToolNamespace(server.name, server.server_id);
    for (const tool of tools) {
      registry.register(createSessionMcpTool(server, tool, toolNamespace));
    }
    connectedServers.push(server.name);
  }

  return connectedServers;
}

async function discoverAndCacheMcpTools(
  store: ReturnType<StorageBackendRegistry['getStructuredStore']>,
  server: SessionMcpServerRow,
): Promise<SessionMcpToolRow[]> {
  const tools = await listMcpTools(server).catch(() => []);
  if (tools.length === 0) {
    return [];
  }

  const discoveredAt = new Date().toISOString();
  await store.run(`DELETE FROM mcp_tool_cache WHERE server_id=?`, [server.server_id]).catch(() => undefined);
  for (const tool of tools) {
    await store.run(
      `INSERT OR REPLACE INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json, discovered_at)
       VALUES(?,?,?,?,?,?)`,
      [
        randomUUID(),
        server.server_id,
        tool.tool_name,
        tool.description ?? '',
        tool.schema_json ?? JSON.stringify({ type: 'object', properties: {} }),
        discoveredAt,
      ],
    ).catch(() => undefined);
  }
  await store.run(`UPDATE mcp_servers SET tool_count=?, updated_at=? WHERE server_id=?`, [tools.length, discoveredAt, server.server_id]).catch(() => undefined);
  return tools;
}

function createSessionMcpTool(
  server: SessionMcpServerRow,
  tool: SessionMcpToolRow,
  toolNamespace: string,
): AgentToolDefinition<Record<string, unknown>, unknown> {
  return {
    name: `mcp.${toolNamespace}.${tool.tool_name}`,
    description: tool.description ?? `MCP tool ${tool.tool_name} from ${server.name}`,
    inputSchema: safeParseMcpSchema(tool.schema_json),
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    deferred: true,
    isMcp: true,
    searchHint: `mcp ${server.name}`,
    async execute(input, ctx) {
      return callMcpTool(server, tool.tool_name, input, ctx.signal, ctx.sessionId);
    },
  };
}

async function listMcpTools(server: SessionMcpServerRow): Promise<SessionMcpToolRow[]> {
  const response = await postMcpJsonRpc(server, 'tools/list', {});
  const tools: unknown[] = Array.isArray(response?.tools) ? response.tools : [];
  return tools
    .map((item): SessionMcpToolRow | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const toolName = typeof record.name === 'string' ? record.name.trim() : '';
      if (!toolName) return null;
      return {
        server_id: server.server_id,
        tool_name: toolName,
        description: typeof record.description === 'string' ? record.description : null,
        schema_json: JSON.stringify(record.inputSchema ?? { type: 'object', properties: {} }),
      };
    })
    .filter((tool): tool is SessionMcpToolRow => tool !== null);
}

async function callMcpTool(
  server: SessionMcpServerRow,
  toolName: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<unknown> {
  const result = await postMcpJsonRpc(
    server,
    'tools/call',
    {
      name: toolName,
      arguments: server.server_id === BUILTIN_PLAYWRIGHT_SERVER_ID && sessionId
        ? { ...(input ?? {}), __sessionId: sessionId }
        : (input ?? {}),
    },
    signal,
  );
  return result ?? null;
}

interface McpRpcEnvelope {
  result?: unknown;
  error?: { message?: string };
  sessionId?: string | null;
}

async function postMcpJsonRpc(
  server: SessionMcpServerRow,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  await ensureMcpSession(server, signal);

  try {
    return await executeMcpJsonRpc(server, method, params, signal);
  } catch (error) {
    if (!isMcpSessionNotFoundError(error)) {
      throw error;
    }

    resetMcpSession(server);
    if (!shouldRetryMcpRequestAfterSessionReset(server, method, params)) {
      throw new Error(buildMcpSessionResetError(server, params));
    }

    await ensureMcpSession(server, signal);
    return executeMcpJsonRpc(server, method, params, signal);
  }
}

function shouldRetryMcpRequestAfterSessionReset(
  server: SessionMcpServerRow,
  method: string,
  params: Record<string, unknown>,
): boolean {
  if (method !== 'tools/call') {
    return true;
  }

  const toolName = typeof params.name === 'string' ? params.name : '';
  if (!isPlaywrightMcpServer(server) || !toolName) {
    return true;
  }

  return PLAYWRIGHT_SESSION_RESET_RETRY_SAFE_TOOLS.has(toolName);
}

function buildMcpSessionResetError(
  server: SessionMcpServerRow,
  params: Record<string, unknown>,
): string {
  const toolName = typeof params.name === 'string' ? params.name : 'unknown_tool';
  return `MCP session expired while calling ${toolName} on ${server.name}; browser state was lost, so restart navigation before retrying.`;
}

function isPlaywrightMcpServer(server: SessionMcpServerRow): boolean {
  return server.name.trim().toLowerCase() === 'playwright';
}

async function ensureMcpSession(server: SessionMcpServerRow, signal?: AbortSignal): Promise<void> {
  if (server.mcp_initialized) {
    return;
  }

  const initialize = await sendMcpJsonRpcRequest(
    server,
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO,
    },
    signal,
    false,
  );
  if (initialize.sessionId) {
    server.mcp_session_id = initialize.sessionId;
  }

  await sendMcpNotification(server, 'notifications/initialized', {}, signal);
  server.mcp_initialized = true;
}

async function executeMcpJsonRpc(
  server: SessionMcpServerRow,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const envelope = await sendMcpJsonRpcRequest(server, method, params, signal, true);
  if (envelope.sessionId) {
    server.mcp_session_id = envelope.sessionId;
  }
  if (envelope.error) {
    throw new Error(envelope.error.message ?? `MCP ${method} failed`);
  }
  return envelope.result;
}

function resetMcpSession(server: SessionMcpServerRow): void {
  server.mcp_session_id = null;
  server.mcp_initialized = false;
}

function isMcpSessionNotFoundError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  return /session not found/i.test(message);
}

async function sendMcpNotification(
  server: SessionMcpServerRow,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const controller = !signal ? new AbortController() : null;
  const timer = setTimeout(() => {
    controller?.abort();
  }, Math.min(server.timeout_ms ?? 30_000, 30_000));

  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: buildMcpHeaders(server.config_json, server.mcp_session_id ?? undefined),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: signal ?? controller?.signal,
    });

    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      throw new Error(`MCP ${method} failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function sendMcpJsonRpcRequest(
  server: SessionMcpServerRow,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  includeSession: boolean,
): Promise<McpRpcEnvelope> {
  const controller = !signal ? new AbortController() : null;
  const timer = setTimeout(() => {
    controller?.abort();
  }, Math.min(server.timeout_ms ?? 30_000, 30_000));

  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: buildMcpHeaders(server.config_json, includeSession ? server.mcp_session_id ?? undefined : undefined),
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
      signal: signal ?? controller?.signal,
    });

    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      throw new Error(`MCP ${method} failed with status ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    return parseMcpJsonRpcEnvelope(response);
  } finally {
    clearTimeout(timer);
  }
}

async function parseMcpJsonRpcEnvelope(response: Response): Promise<McpRpcEnvelope> {
  const contentType = response.headers.get('content-type') ?? '';
  const sessionId = response.headers.get('mcp-session-id');
  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    const body = parseMcpEventStreamEnvelope(text);
    return { ...body, sessionId };
  }

  const text = await response.text();
  if (!text.trim()) {
    return { sessionId };
  }

  const body = JSON.parse(text) as { error?: { message?: string }; result?: unknown };
  return { result: body.result, error: body.error, sessionId };
}

function parseMcpEventStreamEnvelope(text: string): McpRpcEnvelope {
  const chunks = text.split(/\r?\n\r?\n/).map((chunk) => chunk.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const dataLines = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) {
      continue;
    }

    try {
      const body = JSON.parse(dataLines.join('\n')) as { error?: { message?: string }; result?: unknown };
      return { result: body.result, error: body.error };
    } catch {
      continue;
    }
  }

  return {};
}

function buildMcpHeaders(configJson: string | null, sessionId?: string): Record<string, string> {
  const config = safeParseMcpConfig(configJson);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(isStringRecord(config.headers) ? config.headers : {}),
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const auth = config.auth;
  if (!auth || typeof auth !== 'object') {
    return headers;
  }

  const authRecord = auth as Record<string, unknown>;
  if (authRecord.type === 'bearer' && typeof authRecord.token === 'string' && authRecord.token.trim()) {
    headers.Authorization = `Bearer ${authRecord.token.trim()}`;
  }
  if (authRecord.type === 'apikey' && typeof authRecord.header === 'string' && typeof authRecord.key === 'string' && authRecord.header.trim()) {
    headers[authRecord.header.trim()] = authRecord.key;
  }
  if (authRecord.type === 'basic' && typeof authRecord.username === 'string' && typeof authRecord.password === 'string') {
    headers.Authorization = `Basic ${Buffer.from(`${authRecord.username}:${authRecord.password}`).toString('base64')}`;
  }
  return headers;
}

function safeParseMcpConfig(configJson: string | null): Record<string, unknown> {
  if (!configJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeParseMcpSchema(schemaJson: string | null): Record<string, unknown> {
  if (!schemaJson) {
    return { type: 'object', properties: {} };
  }
  try {
    const parsed = JSON.parse(schemaJson) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : { type: 'object', properties: {} };
  } catch {
    return { type: 'object', properties: {} };
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}

function toMcpToolNamespace(name: string, fallback: string): string {
  const candidate = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (candidate) {
    return candidate;
  }
  return fallback.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300).trim();
  } catch {
    return '';
  }
}

export class SessionRunner {
  private readonly sessions = new Map<string, SessionHandle>();
  /** sessionId → (requestId → resolver) */
  private readonly pendingAskUser = new Map<string, Map<string, (answer: string) => void>>();
  private readonly attachmentService: SessionAttachmentService;
  private readonly sandboxRuntime: SandboxRuntime;
  private readonly securityAudit: SecurityAuditService;

  constructor(
    private readonly storage: StorageBackendRegistry,
    private readonly toolRegistryOptions: SessionToolRegistryOptions = {},
  ) {
    this.attachmentService = new SessionAttachmentService(storage);
    const store = storage.getStructuredStore();
    this.sandboxRuntime = new SandboxRuntime([createJsSandboxHost(), createLocalProcessSandboxHost()]);
    this.securityAudit = new SecurityAuditService({
      exec: (sql: string) => store.exec(sql),
      run: (sql: string, params: unknown[]) => store.run(sql, params),
      all: <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params ?? []),
    });
  }

  getHandle(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有活跃（内存中正在运行的）会话列表（v3.3 §8.1）。
   * 仅反映当前进程中的内存状态，不查询数据库。
   */
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((handle) => ({
      sessionId: handle.sessionId,
      businessName: handle.businessName,
      status: 'running' as const,
      phase: 'analysis',
      createdAt: handle.startedAt,
      updatedAt: new Date().toISOString(),
    }));
  }

  /**
   * 获取指定会话的实时状态快照（v3.3 §8.1）。
   * 返回当前推理/工具执行阶段信息。
   */
  getSessionStatus(sessionId: string): SessionStatus {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      return {
        phase: 'idle',
        activeWorkerCount: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        costUsd: 0,
      };
    }
    // 通过 eventHistory 快速估算最新 token 消耗
    const lastCostEvent = [...handle.eventHistory]
      .reverse()
      .find((e) => e.type === 'cost_update') as any;
    return {
      phase: 'thinking',
      activeWorkerCount: 1,
      tokenUsage: {
        inputTokens: lastCostEvent?.inputTokens ?? 0,
        outputTokens: lastCostEvent?.outputTokens ?? 0,
        cachedTokens: lastCostEvent?.cachedTokens ?? 0,
      },
      costUsd: lastCostEvent?.estimatedUsd ?? 0,
    };
  }

  /**
   * 终止会话（取消运行中任务并从内存中清除）（v3.3 §8.1）。
   * 同时更新数据库状态为 'cancelled'，并向 SSE 客户端发送 query_stopped 事件使其正确关闭连接。
   */
  terminateSession(sessionId: string): void {
    const handle = this.sessions.get(sessionId);
    if (handle) {
      // 先向 SSE 客户端广播 query_stopped，确保前端收到终止信号后关闭 EventSource
      const stopEvent: StreamEvent = { type: 'query_stopped', reason: 'user_cancelled' as any };
      handle.eventHistory.push(stopEvent);
      void this.storage.getStructuredStore().run(
        `INSERT INTO stream_events(session_id, event_type, payload) VALUES(?, ?, ?)`,
        [sessionId, stopEvent.type, JSON.stringify(stopEvent)]
      ).catch(() => undefined);
      handle.emitter.emit('event', stopEvent);

      handle.cancel();
      this.sessions.delete(sessionId);
    }
    // 无论是否有活跃句柄，都更新 DB 状态（处理服务器重启后遗留的僵尸会话）
    void this.storage.getStructuredStore().run(
      `UPDATE sessions SET status='cancelled', updated_at=datetime('now') WHERE session_id=? AND status NOT IN ('completed','archived','cancelled')`,
      [sessionId]
    );
    sessionEventBus.emit('session_event', {
      type: 'session_updated',
      sessionId,
      changes: { status: 'cancelled' },
    } satisfies SessionEvent);
  }

  /** 由 REST 路由调用，回传用户对 ask_user 的回答。 */
  submitAnswer(sessionId: string, requestId: string, answer: string): boolean {
    const bucket = this.pendingAskUser.get(sessionId);
    const resolve = bucket?.get(requestId);
    if (!resolve) return false;
    bucket?.delete(requestId);
    resolve(answer);
    return true;
  }

  async appendUserMessage(
    sessionId: string,
    input: string | AppendUserMessageInput,
    legacyModelId?: string,
  ): Promise<SessionFollowUpResult> {
    const payload = normalizeAppendInput(input, legacyModelId);
    const trimmed = payload.content.trim();
    if (!trimmed) throw new Error('content_required');

    const store = this.storage.getStructuredStore();
    const transcriptStore = new TranscriptStore(store);
    const existing = await store.get<{ session_id: string }>(`SELECT session_id FROM sessions WHERE session_id=?`, [sessionId]);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);
    await this.attachmentService.assignToSession(sessionId, payload.attachmentIds);
    const attachments = await this.attachmentService.getByIds(payload.attachmentIds);

    const userMessageEvent = {
      type: 'user_message',
      content: trimmed,
      attachments: this.attachmentService.toMessageRefs(attachments),
      createdAt: new Date().toISOString(),
    } satisfies StreamEvent;

    await transcriptStore.appendOne(sessionId, {
      role: 'user',
      content: trimmed,
      attachmentRefs: this.attachmentService.toMessageRefs(attachments),
      timestamp: Date.now(),
    });
    await store.run(`INSERT INTO stream_events(session_id, event_type, payload) VALUES(?, ?, ?)`, [
      sessionId,
      userMessageEvent.type,
      JSON.stringify(userMessageEvent),
    ]);

    const activeHandle = this.sessions.get(sessionId);
    if (activeHandle) {
      activeHandle.cancel();
      await activeHandle.done.catch(() => undefined);
    }

    await this.resumeSession({
      sessionId,
      continuePrompt: trimmed,
      modelId: payload.modelId,
      attachmentIds: payload.attachmentIds,
      toolIds: payload.toolIds,
    });
    return {
      sessionId,
      resumed: true,
      interrupted: Boolean(activeHandle),
    };
  }

  async start(input: StartSessionInput): Promise<SessionHandle> {
    const sessionId = input.sessionId ?? randomUUID();
    const store = this.storage.getStructuredStore();
    await store.run(
      `INSERT INTO sessions(session_id, business_name, description, locale, rule_scope, status, phase)
       VALUES(?, ?, ?, ?, ?, 'running', 'analysis')`,
      [
        sessionId,
        input.businessName,
        input.description ?? null,
        input.locale ?? 'zh-CN',
        input.ruleScope ? JSON.stringify(input.ruleScope) : null
      ]
    );
    await this.attachmentService.assignToSession(sessionId, input.attachmentIds);

    // 广播 session_created 事件
    sessionEventBus.emit('session_event', {
      type: 'session_created',
      session: {
        sessionId,
        businessName: input.businessName,
        description: input.description,
        status: 'running',
        phase: 'analysis',
        locale: input.locale ?? 'zh-CN',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    } satisfies SessionEvent);

    return this._buildHandle({
      sessionId,
      input,
      isResume: false,
      initialMessages: [],
      guidanceMessages: collectGuidanceMessages([], [input.description]),
    });
  }

  /**
   * 恢复已有会话（session-lifecycle.md §4.3）
   * 从 TranscriptStore 加载 compact_boundary 之后的消息，创建新 QueryEngine 实例继续运行。
   */
  async resumeSession(input: ResumeSessionInput): Promise<SessionHandle> {
    const { sessionId, continuePrompt, modelId } = input;
    const store = this.storage.getStructuredStore();

    // 检查会话是否存在（同时读取 mode 列用于 matchSessionMode）
    const row = await store.get<{
      business_name: string; description: string | null; locale: string | null;
      rule_scope: string | null; status: string; mode: string | null;
    }>(`SELECT business_name, description, locale, rule_scope, status, mode FROM sessions WHERE session_id=?`, [sessionId]);

    if (!row) throw new Error(`Session not found: ${sessionId}`);

    // 匹配 Coordinator 模式（v3.3-evolution-delta.md §3.4）
    const modeMsg = matchSessionMode(row.mode as 'coordinator' | 'normal' | null);
    if (modeMsg) {
      process.stdout.write(`[SessionRunner] matchSessionMode: ${modeMsg}\n`);
    }

    // 从 TranscriptStore 加载 compact_boundary 之后的消息
    const transcriptStore = new TranscriptStore(store);
    const initialMessages = await transcriptStore.loadSinceLastBoundary(sessionId);
    const hydratedMessages = initialMessages.map((message) => hydrateMessageWithAttachmentContext(message));

    // 重置会话状态
    await store.run(
      `UPDATE sessions SET status='running', phase='analysis', updated_at=datetime('now'), paused_at=NULL WHERE session_id=?`,
      [sessionId]
    );

    sessionEventBus.emit('session_event', {
      type: 'session_updated',
      sessionId,
      changes: { status: 'running', phase: 'analysis' }
    } satisfies SessionEvent);

    // 检测孤立权限请求（v3.3 §3.3）
    // 若最后一条助手消息包含 tool_use 但无后续 tool_result，补插合成结果避免 LLM 困惑
    const orphanedPermission = detectAndRepairOrphanedToolCalls(initialMessages);

    return this._buildHandle({
      sessionId,
      input: {
        sessionId,
        businessName: row.business_name,
        description: row.description ?? undefined,
        locale: row.locale ?? 'zh-CN',
        ruleScope: row.rule_scope ? JSON.parse(row.rule_scope) : undefined,
        modelId,
        attachmentIds: input.attachmentIds,
        toolIds: input.toolIds,
      },
      isResume: true,
      initialMessages: hydratedMessages,
      guidanceMessages: collectGuidanceMessages(hydratedMessages, [continuePrompt]),
      continuePrompt,
      orphanedPermission
    });
  }

  private async _buildHandle(opts: {
    sessionId: string;
    input: StartSessionInput;
    isResume: boolean;
    initialMessages: Message[];
    guidanceMessages?: string[];
    continuePrompt?: string;
    /** 孤立权限请求（恢复时检测到工具调用未完成，v3.3 §3.3）*/
    orphanedPermission?: { toolUseId: string; toolName: string; requestedAt: string };
  }): Promise<SessionHandle> {
    const { sessionId, input, initialMessages, guidanceMessages, continuePrompt, orphanedPermission } = opts;
    const store = this.storage.getStructuredStore();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    const history: StreamEvent[] = [];
    const abort = new AbortController();
    const attachments = await this.attachmentService.getByIds(input.attachmentIds);
    const attachmentContext = this.attachmentService.buildPromptContext(attachments);
    const prompt = appendAttachmentContext(continuePrompt ?? input.businessName, attachmentContext);

    const scenarios = await this.loadScenarios(input.scenarioIds);
    const rules = await this.loadRules(input.ruleScope);

    const llmRuntime = await buildConfiguredLLMRuntime(store, input.modelId);
    const runtimePreferences = await loadRuntimePreferences(store);
    const costTracker = new CostTracker();
    // 将 CostTracker 每次累计快照写入 cost_snapshots，供 /api/sessions/:id/cost 查询
    costTracker.onSnapshot((rec) => {
      void store.run(
        `INSERT INTO cost_snapshots(snapshot_id, session_id, model, input_tokens, output_tokens, cached_tokens, estimated_usd, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          randomUUID(),
          rec.sessionId,
          rec.model,
          rec.inputTokens,
          rec.outputTokens,
          rec.cachedTokens + rec.cacheCreationTokens,
          rec.estimatedUsd
        ]
      );
    });
    const { registry: toolRegistry, mcpServers } = await buildSessionToolRegistry(this.storage, this.toolRegistryOptions);
    const engine = new QueryEngine(llmRuntime.adapter, new PromptAssembler(), toolRegistry, costTracker, {
      sessionId,
      model: llmRuntime.model,
      maxSteps: runtimePreferences.maxTurns,
      mcpServers,
      temperature: llmRuntime.settings.temperature,
      maxTokens: llmRuntime.settings.maxTokens,
      topP: llmRuntime.settings.topP,
      presencePenalty: llmRuntime.settings.presencePenalty,
      frequencyPenalty: llmRuntime.settings.frequencyPenalty,
      compactThresholdTokens: runtimePreferences.compactThresholdTokens,
      allowedToolNames: input.toolIds,
      sandboxRuntime: this.sandboxRuntime,
      sandboxEntrypoint: 'chat',
      sandboxWorkspaceRoots: [SESSION_WORKSPACE_ROOT],
      sandboxAuditLogger: this.securityAudit,
      cwd: SESSION_WORKSPACE_ROOT,
    });

    const agent = new OrchestratorAgent({
      sessionId,
      businessName: input.businessName,
      guidanceMessages: guidanceMessages ?? collectGuidanceMessages(initialMessages, [input.description, prompt]),
      locale: input.locale,
      scenarios,
      rules,
      storage: this.storage,
      queryEngine: engine,
      ruleScope: input.ruleScope,
      // AG2U 交互为可选能力：开启 RISK_AGENT_AG2U=1 后 Orchestrator 才会暂停等待用户选择
      askUser:
        process.env.RISK_AGENT_AG2U === '1'
          ? (req) =>
              new Promise<string>((resolve) => {
                let bucket = this.pendingAskUser.get(sessionId);
                if (!bucket) {
                  bucket = new Map();
                  this.pendingAskUser.set(sessionId, bucket);
                }
                bucket.set(req.requestId, resolve);
                // 30 分钟兜底，避免永久挂起
                setTimeout(() => {
                  const b = this.pendingAskUser.get(sessionId);
                  if (b?.has(req.requestId)) {
                    b.delete(req.requestId);
                    resolve('report_only');
                  }
                }, 30 * 60 * 1000).unref?.();
              })
          : undefined
    });

    // 解析所有 askUser 待定请求的辅助函数（当 abort 触发时调用）
    const resolveAllPendingAskUser = () => {
      const bucket = this.pendingAskUser.get(sessionId);
      if (bucket) {
        for (const resolve of bucket.values()) {
          resolve('report_only');
        }
        this.pendingAskUser.delete(sessionId);
      }
    };
    // 当 abort 触发时，立即解析所有挂起的 askUser Promise，避免永久阻塞
    abort.signal.addEventListener('abort', resolveAllPendingAskUser, { once: true });

    const done = (async () => {
      try {
        // 孤立权限警告（v3.3 §3.3）：恢复时检测到上次中断的工具调用，提示前端
        if (orphanedPermission) {
          const warnEvent: StreamEvent = {
            type: 'tool_error',
            toolUseId: orphanedPermission.toolUseId,
            error: `会话恢复：上次中断时工具 "${orphanedPermission.toolName}" 调用未完成（${orphanedPermission.requestedAt}），已跳过。`,
          };
          history.push(warnEvent);
          emitter.emit('event', warnEvent);
        }

        for await (const event of agent.run({ prompt, signal: abort.signal })) {
          history.push(event);
          await store.run(`INSERT INTO stream_events(session_id, event_type, payload) VALUES(?, ?, ?)`, [
            sessionId,
            event.type,
            JSON.stringify(event)
          ]);
          emitter.emit('event', event);

          // 广播阶段变更（session-lifecycle.md §5.2）
          if (event.type === 'subagent_spawned' && event.phase) {
            sessionEventBus.emit('session_event', {
              type: 'session_phase_changed',
              sessionId,
              phase: event.phase
            } satisfies SessionEvent);
          }
        }

        // 04-storage-layer.md §10: 会话完成时，聚合 cost_snapshots 写入 session_costs
        await (async () => {
          try {
            const snaps = await store.all<any>(
              `SELECT model, SUM(input_tokens) AS inp, SUM(output_tokens) AS out,
                      SUM(cached_tokens) AS cached, SUM(estimated_usd) AS usd
               FROM cost_snapshots WHERE session_id=? GROUP BY model`,
              [sessionId]
            );
            if (snaps.length > 0) {
              const totalUsd = snaps.reduce((s: number, r: any) => s + (r.usd ?? 0), 0);
              const totalIn  = snaps.reduce((s: number, r: any) => s + (r.inp ?? 0), 0);
              const totalOut = snaps.reduce((s: number, r: any) => s + (r.out ?? 0), 0);
              const totalCached = snaps.reduce((s: number, r: any) => s + (r.cached ?? 0), 0);
              const modelUsage = snaps.map((r: any) => ({
                model: r.model,
                inputTokens: r.inp ?? 0,
                outputTokens: r.out ?? 0,
                cacheTokens: r.cached ?? 0,
                costUsd: r.usd ?? 0,
              }));
              await store.run(
                `INSERT OR REPLACE INTO session_costs
                  (cost_id, session_id, total_cost_usd, total_input_tokens, total_output_tokens,
                   cache_read_tokens, model_usage_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [
                  randomUUID(), sessionId,
                  totalUsd, totalIn, totalOut, totalCached,
                  JSON.stringify(modelUsage),
                ]
              );
            }
          } catch {
            // non-critical — do not fail the session
          }
        })();

        emitter.emit('end');
        // 仅当会话未被取消时才更新为 completed（避免覆盖已取消状态）
        await store.run(
          `UPDATE sessions SET status='completed' WHERE session_id=? AND status NOT IN ('cancelled','archived')`,
          [sessionId]
        ).catch(() => undefined);
        sessionEventBus.emit('session_event', {
          type: 'session_updated',
          sessionId,
          changes: { status: 'completed' }
        } satisfies SessionEvent);

        // A3: 异步记忆策展（不阻塞主流程）
        void (async () => {
          try {
            const recentEvents = await store.all<{ event_type: string; payload: string }>(
              `SELECT event_type, payload FROM stream_events WHERE session_id=? ORDER BY rowid DESC LIMIT 60`,
              [sessionId],
            );
            const lines: string[] = [];
            for (const ev of recentEvents.reverse()) {
              try {
                const p = JSON.parse(ev.payload);
                if (ev.event_type === 'text_chunk' && p.text) lines.push(`assistant: ${p.text}`);
                else if (ev.event_type === 'user_message' && p.content) lines.push(`user: ${p.content}`);
              } catch { /* skip */ }
            }
            if (lines.length > 0) {
              const transcript = lines.join('\n');
              const dbAdapter = {
                run: (sql: string, params?: unknown[]) => store.run(sql, params as any[]).then(() => undefined),
                all: <T>(sql: string, params?: unknown[]) => store.all<T>(sql, params as any[]),
              };
              const curator = new MemoryCurator({ db: dbAdapter });
              await curator.curate({ sessionId, transcript });
            }
          } catch {
            // non-critical
          }
        })();
      } catch (err: any) {
        const errorEvent = { type: 'tool_error', toolUseId: 'runner', error: err?.message ?? 'error' } satisfies StreamEvent;
        history.push(errorEvent);
        await store.run(`INSERT INTO stream_events(session_id, event_type, payload) VALUES(?, ?, ?)`, [
          sessionId,
          errorEvent.type,
          JSON.stringify(errorEvent)
        ]).catch(() => undefined);
        // 不向已经关闭的 SSE 流发送错误事件（terminateSession 已经发送了 query_stopped）
        if (!abort.signal.aborted) {
          emitter.emit('event', errorEvent);
        }
        emitter.emit('end');
        // 仅当会话未被取消时才更新为 error
        await store.run(`UPDATE sessions SET status='error' WHERE session_id=? AND status NOT IN ('cancelled','archived')`, [sessionId]);
        sessionEventBus.emit('session_event', {
          type: 'session_updated',
          sessionId,
          changes: { status: 'error' }
        } satisfies SessionEvent);
      }
    })();

    const handle: SessionHandle = {
      sessionId,
      emitter,
      done,
      cancel: () => abort.abort(),
      eventHistory: history,
      startedAt: new Date().toISOString(),
      businessName: input.businessName,
    };
    this.sessions.set(sessionId, handle);
    void done.finally(() => {
      const current = this.sessions.get(sessionId);
      if (current?.done === done) {
        this.sessions.delete(sessionId);
      }
      this.pendingAskUser.delete(sessionId);
    });
    return handle;
  }

  private async loadScenarios(ids?: string[]): Promise<BusinessScenario[]> {
    const store = this.storage.getStructuredStore();
    const rows = ids?.length
      ? await store.all<any>(
          `SELECT * FROM business_scenarios WHERE scenario_id IN (${ids.map(() => '?').join(',')})`,
          ids
        )
      : await store.all<any>(`SELECT * FROM business_scenarios WHERE status != 'archived'`);
    return rows.map(rowToScenario);
  }

  private async loadRules(scope?: { bizTypes?: string[]; ruleTypes?: string[] }): Promise<RiskRule[]> {
    const store = this.storage.getStructuredStore();
    const conds: string[] = [`status='active'`];
    const params: unknown[] = [];
    if (scope?.bizTypes?.length) {
      conds.push(`biz_type IN (${scope.bizTypes.map(() => '?').join(',')})`);
      params.push(...scope.bizTypes);
    }
    if (scope?.ruleTypes?.length) {
      conds.push(`rule_type IN (${scope.ruleTypes.map(() => '?').join(',')})`);
      params.push(...scope.ruleTypes);
    }
    const rows = await store.all<any>(
      `SELECT * FROM risk_rules WHERE ${conds.join(' AND ')}`,
      params
    );
    return rows.map(rowToRule);
  }
}

function collectGuidanceMessages(messages: Message[], extras: Array<string | undefined>): string[] {
  const collected = messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .map((message) => message.content.trim())
    .filter(Boolean);

  for (const extra of extras) {
    const trimmed = extra?.trim();
    if (trimmed) {
      collected.push(trimmed);
    }
  }

  return Array.from(new Set(collected));
}

function normalizeAppendInput(input: string | AppendUserMessageInput, modelId?: string): AppendUserMessageInput {
  if (typeof input === 'string') {
    return { content: input, modelId };
  }
  return input;
}

function appendAttachmentContext(prompt: string, attachmentContext: string): string {
  const trimmedPrompt = prompt.trim();
  if (!attachmentContext) {
    return trimmedPrompt;
  }
  return `${trimmedPrompt}\n\n${attachmentContext}`.trim();
}

function hydrateMessageWithAttachmentContext(message: Message): Message {
  if (message.role !== 'user' || !message.attachmentRefs?.length) {
    return message;
  }

  const lines = message.attachmentRefs.flatMap((attachment) => {
    const header = `- ${attachment.filename} (${attachment.contentType}, ${attachment.sizeBytes} bytes)`;
    if (!attachment.textPreview) {
      return [header, '  摘要: 二进制附件已上传，当前仅提供元数据。'];
    }
    return [header, `  摘要: ${attachment.textPreview}`];
  });

  return {
    ...message,
    content: `${message.content.trim()}\n\n附件上下文：\n${lines.join('\n')}`.trim(),
  };
}

function rowToScenario(r: any): BusinessScenario {
  return {
    scenarioId: r.scenario_id,
    name: r.name,
    description: r.description ?? undefined,
    domain: r.domain ?? undefined,
    status: (r.status as BusinessScenario['status']) ?? 'draft',
    version: Number(r.version ?? 1),
    dataSources: safeJson(r.data_sources, []),
    documents: safeJson(r.documents, []),
    manualNotes: r.manual_notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

function rowToRule(r: any): RiskRule {
  return {
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    ruleCode: r.rule_code ?? undefined,
    bizType: r.biz_type ?? undefined,
    ruleType: r.rule_type ?? undefined,
    riskLevel: r.risk_level ?? undefined,
    source: r.source ?? undefined,
    description: r.description ?? undefined,
    conditions: r.conditions_json ? safeJson(r.conditions_json, undefined) : undefined,
    actions: r.actions_json ? safeJson(r.actions_json, undefined) : undefined,
    coverage: safeJson(r.coverage_json, []),
    status: r.status ?? 'active',
    effectiveFrom: r.effective_from ?? undefined,
    effectiveTo: r.effective_to ?? undefined,
    syncedAt: r.synced_at
  };
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * detectAndRepairOrphanedToolCalls — 检测并修复孤立工具调用（v3.3 §3.3）。
 *
 * 当最后一条 assistant 消息包含 tool_use 调用，但之后没有对应的 user/tool_result 消息时，
 * 向 messages 数组追加合成的 tool_result，避免恢复时 LLM 困惑于不完整的对话历史。
 * 返回第一个孤立调用的元数据（供事件通知前端），无孤立调用时返回 undefined。
 */
function detectAndRepairOrphanedToolCalls(
  messages: Message[]
): { toolUseId: string; toolName: string; requestedAt: string } | undefined {
  if (!messages.length) return undefined;

  // 找到最后一条 assistant 消息
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as any).role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return undefined;

  const lastAssistant = messages[lastAssistantIdx] as any;
  const toolUseCalls: Array<{ id: string; name: string }> = [];

  // 提取 tool_use 内容块
  const content = lastAssistant.content ?? [];
  for (const block of (Array.isArray(content) ? content : [])) {
    if (block?.type === 'tool_use' && block.id) {
      toolUseCalls.push({ id: block.id, name: block.name ?? 'unknown_tool' });
    }
  }
  if (!toolUseCalls.length) return undefined;

  // 检查是否存在对应的 tool_result
  const hasToolResult = messages
    .slice(lastAssistantIdx + 1)
    .some((m: any) => {
      const c = Array.isArray(m.content) ? m.content : [];
      return c.some((b: any) => b?.type === 'tool_result');
    });

  if (hasToolResult) return undefined;

  // 补插合成 tool_result（避免 LLM 困惑）
  const syntheticResults = toolUseCalls.map((call) => ({
    type: 'tool_result' as const,
    tool_use_id: call.id,
    content: '[会话在此中断，工具调用结果未记录。请根据上下文继续推理。]',
  }));
  messages.push({
    role: 'user',
    content: syntheticResults,
  } as any);

  return {
    toolUseId: toolUseCalls[0].id,
    toolName: toolUseCalls[0].name,
    requestedAt: new Date().toISOString(),
  };
}
