import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildTool,
  KG_NODE_TYPES,
  KG_RELATION_TYPES,
  KnowledgeGraphService,
  SkillLoader,
  type AgentToolDefinition,
  type KGAddEdgeInput,
  type KGNeighborhoodParams,
  type KGNodeType,
  type KGRelationType,
  type KGSearchParams,
  type KGUpsertNodeInput,
  type StorageBackendRegistry,
} from '@risk-agent/core';
import { z } from 'zod';
import { ensureMcpStorageSchema, executeMcpRequestWithRetry, probeServer } from '../routes/mcp.js';
import { buildCatalogRegistry } from '../routes/tools.js';

const MODEL_PROVIDERS = [
  'openai',
  'openai-compatible',
  'openrouter',
  'anthropic',
  'anthropic-compatible',
  'ollama',
  'azure-openai',
  'google',
  'bedrock',
  'mock',
] as const;

const ResourceDomainSchema = z.enum([
  'models',
  'mcp',
  'datasources',
  'skills',
  'tools',
  'scenarios',
  'rules',
  'profiles',
  'knowledge_graph',
]);

const ModelConfigSchema = z.object({
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
}).catchall(z.unknown());

const ModelCreateSchema = z.object({
  provider: z.enum(MODEL_PROVIDERS),
  modelName: z.string().trim().min(1),
  role: z.string().trim().optional(),
  config: ModelConfigSchema.default({}),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const ModelUpdateSchema = ModelCreateSchema.partial();

const DataSourceSchema = z.object({
  name: z.string().trim().min(1),
  sourceType: z.enum(['api', 'git', 'db', 'file', 'mcp', 'web']),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().optional(),
});

const DataSourceUpdateSchema = DataSourceSchema.partial();

const McpServerCreateSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().url(),
  transport: z.enum(['http', 'sse', 'stream']).default('http'),
  description: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  auth: z.record(z.unknown()).nullable().optional(),
  retryConfig: z.record(z.unknown()).optional(),
});

const McpServerUpdateSchema = McpServerCreateSchema.partial();

const SkillCreateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  content: z.string().min(1),
});

const ScenarioSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  domain: z.string().trim().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  dataSources: z.array(z.string()).optional(),
  documents: z.array(z.string()).optional(),
  manualNotes: z.string().trim().optional(),
});

const ScenarioUpdateSchema = ScenarioSchema.partial();

const RuleSchema = z.object({
  ruleName: z.string().trim().min(1),
  ruleCode: z.string().trim().optional(),
  bizType: z.string().trim().optional(),
  ruleType: z.string().trim().optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  source: z.string().trim().optional(),
  description: z.string().trim().optional(),
  conditions: z.unknown().optional(),
  actions: z.unknown().optional(),
  coverage: z.array(z.string()).optional(),
  status: z.enum(['active', 'draft', 'retired']).optional(),
  effectiveFrom: z.string().trim().optional(),
  effectiveTo: z.string().trim().optional(),
  systemId: z.string().trim().optional(),
});

const RuleUpdateSchema = RuleSchema.partial();

const ProfileSchema = z.object({
  sessionId: z.string().trim().nullable().optional(),
  businessName: z.string().trim().min(1),
  version: z.number().int().positive().optional(),
  entities: z.array(z.record(z.unknown())).optional(),
  behaviors: z.array(z.record(z.unknown())).optional(),
  apiFeatures: z.array(z.record(z.unknown())).optional(),
  overallScore: z.number().optional(),
});

const ProfileUpdateSchema = ProfileSchema.partial();

const KnowledgeGraphNodeTypeSchema = z.enum([...KG_NODE_TYPES] as [string, ...string[]]);
const KnowledgeGraphRelationSchema = z.enum([...KG_RELATION_TYPES] as [string, ...string[]]);

const KnowledgeGraphNodeSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  nodeType: KnowledgeGraphNodeTypeSchema,
  attributes: z.record(z.unknown()).optional(),
});

const KnowledgeGraphEdgeSchema = z.object({
  from: KnowledgeGraphNodeSchema,
  to: KnowledgeGraphNodeSchema,
  relation: KnowledgeGraphRelationSchema,
  attributes: z.record(z.unknown()).optional(),
});

const KnowledgeGraphSearchSchema = z.object({
  query: z.string().trim().optional(),
  nodeTypes: z.array(KnowledgeGraphNodeTypeSchema).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const KnowledgeGraphNeighborhoodSchema = z.object({
  nodeId: z.string().trim().min(1).optional(),
  depth: z.number().int().positive().max(5).optional(),
  direction: z.enum(['upstream', 'downstream', 'both']).optional(),
  relationTypes: z.array(KnowledgeGraphRelationSchema).optional(),
});

const KnowledgeGraphListSchema = z.object({
  graph: z.enum(['business_graph', 'rule_lineage', 'all']).optional(),
});

interface SystemResourcesToolInput {
  domain: z.infer<typeof ResourceDomainSchema>;
  action: string;
  id?: string;
  query?: string;
  path?: string;
  payload?: Record<string, unknown>;
}

type StructuredStore = ReturnType<StorageBackendRegistry['getStructuredStore']>;

type StoredModelRow = {
  model_id: string;
  provider: (typeof MODEL_PROVIDERS)[number];
  model_name: string;
  role: string | null;
  config_json: string | null;
  enabled: number;
  is_default: number;
  created_at: string;
};

type StoredDataSourceRow = {
  source_id: string;
  name: string;
  source_type: string;
  config_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string | null;
};

type StoredMcpRow = {
  server_id: string;
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stream';
  description: string | null;
  timeout_ms: number | null;
  config_json: string | null;
  enabled: number;
  health_status: string | null;
  health_error: string | null;
  last_check_at: string | null;
  tool_count: number | null;
  created_at: string;
  updated_at: string | null;
};

type StoredScenarioRow = {
  scenario_id: string;
  name: string;
  description: string | null;
  domain: string | null;
  status: string | null;
  version: number | null;
  data_sources: string | null;
  documents: string | null;
  manual_notes: string | null;
  created_at: string;
  updated_at: string;
};

type StoredRuleRow = {
  rule_id: string;
  rule_name: string;
  rule_code: string | null;
  biz_type: string | null;
  rule_type: string | null;
  risk_level: string | null;
  source: string | null;
  description: string | null;
  coverage_json: string | null;
  conditions_json: string | null;
  actions_json: string | null;
  status: string | null;
  system_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  synced_at: string | null;
};

type StoredProfileRow = {
  profile_id: string;
  session_id: string | null;
  business_name: string;
  version: number | null;
  entities_json: string | null;
  behaviors_json: string | null;
  api_features: string | null;
  overall_score: number | null;
  created_at: string;
};

type McpToolCacheRow = {
  tool_name: string;
  description: string | null;
  schema_json: string | null;
  discovered_at: string;
};

const SECRET_KEY_PATTERN = /(api[-_]?key|password|token|secret|authorization|access[-_]?token)/i;

function safeParseConfig(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clonePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  return payload ? { ...payload } : {};
}

function isKnowledgeGraphNodeType(value: string): value is KGNodeType {
  return KG_NODE_TYPES.includes(value as KGNodeType);
}

function isKnowledgeGraphRelationType(value: string): value is KGRelationType {
  return KG_RELATION_TYPES.includes(value as KGRelationType);
}

function normalizeRulePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = clonePayload(payload);
  if (typeof next.ruleName !== 'string' && typeof next.name === 'string' && next.name.trim()) {
    next.ruleName = next.name.trim();
  }
  return next;
}

function normalizeProfilePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = clonePayload(payload);
  if (typeof next.businessName !== 'string' && typeof next.name === 'string' && next.name.trim()) {
    next.businessName = next.name.trim();
  }
  return next;
}

function normalizeKnowledgeGraphAction(action: string, payload: Record<string, unknown> | undefined): string {
  if (action === 'create_node') return 'upsert_node';
  if (action === 'create_edge') return 'add_edge';
  if (action === 'get_node') return 'read';
  if (action === 'query') return 'search';
  if (action === 'create') {
    const next = clonePayload(payload);
    const looksLikeEdge = typeof next.relation === 'string'
      || typeof next.edgeType === 'string'
      || next.type === 'edge'
      || next.from !== undefined
      || next.to !== undefined
      || typeof next.fromId === 'string'
      || typeof next.toId === 'string'
      || typeof next.sourceId === 'string'
      || typeof next.targetId === 'string'
      || typeof next.source === 'string'
      || typeof next.target === 'string';
    if (looksLikeEdge) {
      return 'add_edge';
    }

    const looksLikeNode = typeof next.nodeType === 'string'
      || typeof next.type === 'string'
      || typeof next.name === 'string'
      || typeof next.label === 'string'
      || typeof next.id === 'string';
    if (looksLikeNode) {
      return 'upsert_node';
    }
  }
  return action;
}

function normalizeKnowledgeGraphNodePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = clonePayload(payload);
  const discriminatorType = typeof next.type === 'string' ? next.type.trim() : undefined;
  const labelValue = typeof next.label === 'string' ? next.label.trim() : undefined;
  const nameValue = typeof next.name === 'string' ? next.name.trim() : undefined;
  const propertyNameValue = next.properties && typeof next.properties === 'object' && !Array.isArray(next.properties)
    && typeof (next.properties as Record<string, unknown>).name === 'string'
    ? ((next.properties as Record<string, unknown>).name as string).trim()
    : undefined;

  if (typeof next.nodeType !== 'string' && discriminatorType && discriminatorType !== 'node' && discriminatorType !== 'edge' && isKnowledgeGraphNodeType(discriminatorType)) {
    next.nodeType = discriminatorType;
  }
  if (typeof next.nodeType !== 'string' && discriminatorType === 'node' && labelValue && isKnowledgeGraphNodeType(labelValue)) {
    next.nodeType = labelValue;
    if (nameValue || propertyNameValue) {
      next.label = nameValue ?? propertyNameValue;
    }
  }
  if (typeof next.nodeType !== 'string' && labelValue && isKnowledgeGraphNodeType(labelValue)) {
    next.nodeType = labelValue;
    if (nameValue || propertyNameValue) {
      next.label = nameValue ?? propertyNameValue;
    }
  }
  if (typeof next.label !== 'string' && typeof next.name === 'string' && next.name.trim()) {
    next.label = next.name.trim();
  }
  if (typeof next.label !== 'string' && propertyNameValue) {
    next.label = propertyNameValue;
  }
  if (next.attributes === undefined && next.properties && typeof next.properties === 'object' && !Array.isArray(next.properties)) {
    next.attributes = next.properties;
  }
  if (typeof next.id !== 'string' && typeof next.nodeType === 'string' && typeof next.label === 'string') {
    next.id = `${next.nodeType}:${randomUUID()}`;
  }
  return next;
}

async function lookupKnowledgeGraphNode(
  graphStore: ReturnType<StorageBackendRegistry['getGraphStore']>,
  nodeId: string,
): Promise<Record<string, unknown> | undefined> {
  const [businessNodes, lineageNodes] = await Promise.all([
    graphStore.listNodes('business_graph'),
    graphStore.listNodes('rule_lineage'),
  ]);
  const matched = businessNodes.find((node) => node.id === nodeId) ?? lineageNodes.find((node) => node.id === nodeId);
  if (!matched) {
    return undefined;
  }

  const nodeType = typeof matched.attributes?.nodeType === 'string' ? matched.attributes.nodeType : undefined;
  if (!nodeType || !isKnowledgeGraphNodeType(nodeType)) {
    return undefined;
  }

  return {
    id: matched.id,
    label: matched.label ?? matched.id,
    nodeType,
    attributes: matched.attributes ?? {},
  };
}

async function resolveKnowledgeGraphNodeReference(
  graphStore: ReturnType<StorageBackendRegistry['getGraphStore']>,
  reference: unknown,
  fallbackId?: string,
  fallbackNodeType?: string,
  fallbackLabel?: string,
): Promise<Record<string, unknown> | undefined> {
  const next: Record<string, unknown> = typeof reference === 'string'
    ? { id: reference }
    : reference && typeof reference === 'object' && !Array.isArray(reference)
      ? { ...(reference as Record<string, unknown>) }
      : {};

  const id = typeof next.id === 'string'
    ? next.id
    : typeof next.nodeId === 'string'
      ? next.nodeId
      : fallbackId;

  if (typeof next.nodeType !== 'string' && typeof next.type === 'string' && next.type.trim() && isKnowledgeGraphNodeType(next.type.trim())) {
    next.nodeType = next.type.trim();
  }
  if (typeof next.nodeType !== 'string' && fallbackNodeType?.trim() && isKnowledgeGraphNodeType(fallbackNodeType.trim())) {
    next.nodeType = fallbackNodeType.trim();
  }
  if (typeof next.label !== 'string' && typeof next.name === 'string' && next.name.trim()) {
    next.label = next.name.trim();
  }
  if (typeof next.label !== 'string' && fallbackLabel?.trim()) {
    next.label = fallbackLabel.trim();
  }

  if (id && (typeof next.nodeType !== 'string' || typeof next.label !== 'string')) {
    const resolved = await lookupKnowledgeGraphNode(graphStore, id);
    if (resolved) {
      return resolved;
    }
  }

  const normalizedNodeType = typeof next.nodeType === 'string' && isKnowledgeGraphNodeType(next.nodeType.trim())
    ? next.nodeType.trim()
    : undefined;

  if (!id || !normalizedNodeType) {
    return undefined;
  }

  return {
    id,
    label: typeof next.label === 'string' && next.label.trim() ? next.label.trim() : id,
    nodeType: normalizedNodeType,
    attributes: next.attributes as Record<string, unknown> | undefined,
  };
}

async function normalizeKnowledgeGraphEdgePayload(
  graphStore: ReturnType<StorageBackendRegistry['getGraphStore']>,
  payload: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const next = clonePayload(payload);
  if (next.attributes === undefined && next.properties && typeof next.properties === 'object' && !Array.isArray(next.properties)) {
    next.attributes = next.properties;
  }
  if (typeof next.relation !== 'string' && typeof next.edgeType === 'string' && next.edgeType.trim()) {
    next.relation = next.edgeType.trim();
  }
  if (typeof next.relation !== 'string' && typeof next.type === 'string' && next.type.trim() && next.type !== 'edge' && isKnowledgeGraphRelationType(next.type.trim())) {
    next.relation = next.type.trim();
  }
  if (typeof next.relation !== 'string' && typeof next.label === 'string' && next.label.trim()) {
    next.relation = next.label.trim();
  }

  if (!next.from) {
    next.from = await resolveKnowledgeGraphNodeReference(
      graphStore,
      undefined,
      typeof next.fromId === 'string'
        ? next.fromId
        : typeof next.sourceId === 'string'
          ? next.sourceId
          : typeof next.source === 'string'
            ? next.source
            : undefined,
      typeof next.fromNodeType === 'string'
        ? next.fromNodeType
        : typeof next.sourceNodeType === 'string'
          ? next.sourceNodeType
          : undefined,
      typeof next.fromLabel === 'string'
        ? next.fromLabel
        : typeof next.sourceLabel === 'string'
          ? next.sourceLabel
          : undefined,
    );
  } else {
    next.from = await resolveKnowledgeGraphNodeReference(graphStore, next.from);
  }

  if (!next.to) {
    next.to = await resolveKnowledgeGraphNodeReference(
      graphStore,
      undefined,
      typeof next.toId === 'string'
        ? next.toId
        : typeof next.targetId === 'string'
          ? next.targetId
          : typeof next.target === 'string'
            ? next.target
            : undefined,
      typeof next.toNodeType === 'string'
        ? next.toNodeType
        : typeof next.targetNodeType === 'string'
          ? next.targetNodeType
          : undefined,
      typeof next.toLabel === 'string'
        ? next.toLabel
        : typeof next.targetLabel === 'string'
          ? next.targetLabel
          : undefined,
    );
  } else {
    next.to = await resolveKnowledgeGraphNodeReference(graphStore, next.to);
  }

  return next;
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= 8) return '••••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function redactSensitiveValue(key: string, value: unknown): unknown {
  if (typeof value === 'string' && SECRET_KEY_PATTERN.test(key) && value.trim()) {
    return maskSecret(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [nestedKey, redactSensitiveValue(nestedKey, nestedValue)]),
  );
}

function redactModelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  if (typeof next.apiKey === 'string' && next.apiKey.trim()) {
    next.apiKeyMasked = maskSecret(next.apiKey);
    delete next.apiKey;
  }
  return next;
}

function mergeModelConfig(previous: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const next = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (key === 'apiKey') {
      if (typeof value === 'string' && value.trim()) {
        next.apiKey = value.trim();
      }
      continue;
    }
    next[key] = value;
  }
  return next;
}

function serializeModel(row: StoredModelRow) {
  return {
    modelId: row.model_id,
    provider: row.provider,
    modelName: row.model_name,
    role: row.role,
    config: redactModelConfig(safeParseConfig(row.config_json)),
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
  };
}

function serializeDatasource(row: StoredDataSourceRow) {
  const config = safeParseConfig(row.config_json);
  return {
    sourceId: row.source_id,
    name: row.name,
    sourceType: row.source_type,
    config: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, redactSensitiveValue(key, value)])),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMcp(row: StoredMcpRow) {
  const config = safeParseConfig(row.config_json);
  return {
    serverId: row.server_id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    description: row.description ?? '',
    timeoutMs: row.timeout_ms ?? 30_000,
    enabled: Boolean(row.enabled),
    headers: redactSensitiveValue('headers', config.headers ?? {}),
    auth: redactSensitiveValue('auth', config.auth ?? null),
    retryConfig: config.retryConfig ?? null,
    healthStatus: row.health_status ?? 'unknown',
    healthError: row.health_error ?? null,
    lastCheckAt: row.last_check_at ?? null,
    toolCount: row.tool_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeScenario(row: StoredScenarioRow) {
  return {
    scenarioId: row.scenario_id,
    name: row.name,
    description: row.description,
    domain: row.domain,
    status: row.status,
    version: row.version ?? 1,
    dataSources: safeParseJson(row.data_sources, [] as string[]),
    documents: safeParseJson(row.documents, [] as string[]),
    manualNotes: row.manual_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRule(row: StoredRuleRow) {
  return {
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    ruleCode: row.rule_code,
    bizType: row.biz_type,
    ruleType: row.rule_type,
    riskLevel: row.risk_level,
    source: row.source,
    description: row.description,
    coverage: safeParseJson(row.coverage_json, [] as string[]),
    conditions: safeParseJson(row.conditions_json, null),
    actions: safeParseJson(row.actions_json, null),
    status: row.status,
    systemId: row.system_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    syncedAt: row.synced_at,
  };
}

function serializeProfileSummary(row: StoredProfileRow) {
  return {
    profileId: row.profile_id,
    sessionId: row.session_id,
    businessName: row.business_name,
    version: row.version ?? 1,
    overallScore: row.overall_score ?? 0,
    createdAt: row.created_at,
  };
}

function serializeProfile(row: StoredProfileRow) {
  return {
    ...serializeProfileSummary(row),
    entities: safeParseJson(row.entities_json, [] as Array<Record<string, unknown>>),
    behaviors: safeParseJson(row.behaviors_json, [] as Array<Record<string, unknown>>),
    apiFeatures: safeParseJson(row.api_features, [] as Array<Record<string, unknown>>),
  };
}

function serializeGraphNode(node: { id: string; label?: string; attributes?: Record<string, unknown> }, graph: string) {
  return {
    id: node.id,
    label: node.label ?? node.id,
    nodeType: String(node.attributes?.nodeType ?? 'unknown'),
    graph,
    attributes: node.attributes ?? {},
  };
}

function serializeGraphEdge(edge: { source: string; target: string; label?: string; attributes?: Record<string, unknown> }, graph: string) {
  return {
    source: edge.source,
    target: edge.target,
    relation: String(edge.attributes?.relation ?? edge.label ?? 'unknown'),
    graph,
    attributes: edge.attributes ?? {},
  };
}

function serializeCatalogTool(tool: ReturnType<ReturnType<typeof buildCatalogRegistry>['list']>[number]) {
  return {
    name: tool.name,
    description: tool.description,
    aliases: tool.aliases ?? [],
    searchHint: tool.searchHint,
    isReadOnly: tool.isReadOnly ?? false,
    isConcurrencySafe: tool.isConcurrencySafe,
    isDestructive: tool.isDestructive,
    alwaysLoad: tool.alwaysLoad,
    deferred: tool.deferred ?? false,
    strict: tool.strict ?? false,
    isOpenWorld: tool.isOpenWorld ?? false,
    sandboxProfile: tool.sandboxProfile,
    sandboxHostKind: tool.sandboxHostKind,
    sandboxAccessTier: tool.sandboxAccessTier,
    maxResultSizeChars: tool.maxResultSizeChars,
    inputSchema: tool.inputSchema,
  };
}

function createSkillLoader(storage: StorageBackendRegistry): SkillLoader {
  const dataRoot = storage.paths?.dataRoot ?? process.cwd();
  const projectAgentsSkillDir = join(process.cwd(), '..', '..', '.agents', 'skills');
  const homeAgentsSkillDir = join(homedir(), '.agents', 'skills');
  const projectSkillDir = existsSync(projectAgentsSkillDir)
    ? projectAgentsSkillDir
    : existsSync(homeAgentsSkillDir)
      ? homeAgentsSkillDir
      : undefined;

  return new SkillLoader({
    userSkillDir: join(dataRoot, 'skills'),
    projectSkillDir,
  });
}

async function handleModelAction(store: StructuredStore, action: string, id: string | undefined, payload: Record<string, unknown> | undefined) {
  if (action === 'list') {
    const rows = await store.all<StoredModelRow>(`SELECT * FROM model_configs ORDER BY is_default DESC, created_at DESC`);
    return { ok: true, items: rows.map(serializeModel) };
  }

  if (action === 'get') {
    if (!id) throw new Error('models:get requires id');
    const row = await store.get<StoredModelRow>(`SELECT * FROM model_configs WHERE model_id=?`, [id]);
    if (!row) throw new Error(`model ${id} not found`);
    return { ok: true, item: serializeModel(row) };
  }

  if (action === 'create') {
    const parsed = ModelCreateSchema.parse(payload ?? {});
    const modelId = randomUUID();
    if (parsed.isDefault) {
      await store.run(`UPDATE model_configs SET is_default=0`);
    }
    await store.run(
      `INSERT INTO model_configs(model_id, provider, model_name, role, config_json, enabled, is_default) VALUES(?,?,?,?,?,?,?)`,
      [
        modelId,
        parsed.provider,
        parsed.modelName,
        parsed.role ?? null,
        JSON.stringify(parsed.config),
        parsed.enabled !== false ? 1 : 0,
        parsed.isDefault ? 1 : 0,
      ],
    );
    const row = await store.get<StoredModelRow>(`SELECT * FROM model_configs WHERE model_id=?`, [modelId]);
    return { ok: true, item: row ? serializeModel(row) : { modelId } };
  }

  if (action === 'update') {
    if (!id) throw new Error('models:update requires id');
    const parsed = ModelUpdateSchema.parse(payload ?? {});
    const existing = await store.get<StoredModelRow>(`SELECT * FROM model_configs WHERE model_id=?`, [id]);
    if (!existing) throw new Error(`model ${id} not found`);
    if (parsed.isDefault) {
      await store.run(`UPDATE model_configs SET is_default=0`);
    }
    const mergedConfig = parsed.config
      ? mergeModelConfig(safeParseConfig(existing.config_json), parsed.config)
      : safeParseConfig(existing.config_json);

    await store.run(
      `UPDATE model_configs SET provider=?, model_name=?, role=?, config_json=?, enabled=?, is_default=? WHERE model_id=?`,
      [
        parsed.provider ?? existing.provider,
        parsed.modelName ?? existing.model_name,
        parsed.role ?? existing.role,
        JSON.stringify(mergedConfig),
        parsed.enabled === undefined ? existing.enabled : (parsed.enabled ? 1 : 0),
        parsed.isDefault === undefined ? existing.is_default : (parsed.isDefault ? 1 : 0),
        id,
      ],
    );
    const updated = await store.get<StoredModelRow>(`SELECT * FROM model_configs WHERE model_id=?`, [id]);
    return { ok: true, item: updated ? serializeModel(updated) : { modelId: id } };
  }

  if (action === 'delete') {
    if (!id) throw new Error('models:delete requires id');
    await store.run(`DELETE FROM model_configs WHERE model_id=?`, [id]);
    return { ok: true, deletedId: id };
  }

  throw new Error(`unsupported models action: ${action}`);
}

async function handleDatasourceAction(store: StructuredStore, action: string, id: string | undefined, payload: Record<string, unknown> | undefined) {
  if (action === 'list') {
    const rows = await store.all<StoredDataSourceRow>(`SELECT * FROM data_sources ORDER BY created_at DESC`);
    return { ok: true, items: rows.map(serializeDatasource) };
  }

  if (action === 'get') {
    if (!id) throw new Error('datasources:get requires id');
    const row = await store.get<StoredDataSourceRow>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    if (!row) throw new Error(`datasource ${id} not found`);
    return { ok: true, item: serializeDatasource(row) };
  }

  if (action === 'create') {
    const parsed = DataSourceSchema.parse(payload ?? {});
    const sourceId = randomUUID();
    await store.run(
      `INSERT INTO data_sources(source_id, name, source_type, config_json, enabled) VALUES(?,?,?,?,?)`,
      [sourceId, parsed.name, parsed.sourceType, JSON.stringify(parsed.config), parsed.enabled !== false ? 1 : 0],
    );
    const row = await store.get<StoredDataSourceRow>(`SELECT * FROM data_sources WHERE source_id=?`, [sourceId]);
    return { ok: true, item: row ? serializeDatasource(row) : { sourceId } };
  }

  if (action === 'update') {
    if (!id) throw new Error('datasources:update requires id');
    const parsed = DataSourceUpdateSchema.parse(payload ?? {});
    const existing = await store.get<StoredDataSourceRow>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    if (!existing) throw new Error(`datasource ${id} not found`);
    const existingConfig = safeParseConfig(existing.config_json);
    const nextConfig = parsed.config ? { ...existingConfig, ...parsed.config } : existingConfig;
    await store.run(
      `UPDATE data_sources SET name=?, source_type=?, config_json=?, enabled=?, updated_at=datetime('now') WHERE source_id=?`,
      [
        parsed.name ?? existing.name,
        parsed.sourceType ?? existing.source_type,
        JSON.stringify(nextConfig),
        parsed.enabled === undefined ? existing.enabled : (parsed.enabled ? 1 : 0),
        id,
      ],
    );
    const updated = await store.get<StoredDataSourceRow>(`SELECT * FROM data_sources WHERE source_id=?`, [id]);
    return { ok: true, item: updated ? serializeDatasource(updated) : { sourceId: id } };
  }

  if (action === 'delete') {
    if (!id) throw new Error('datasources:delete requires id');
    await store.run(`DELETE FROM data_sources WHERE source_id=?`, [id]);
    return { ok: true, deletedId: id };
  }

  throw new Error(`unsupported datasources action: ${action}`);
}

async function listMcpCachedTools(store: StructuredStore, serverId: string) {
  const rows = await store.all<McpToolCacheRow>(`SELECT tool_name, description, schema_json, discovered_at FROM mcp_tool_cache WHERE server_id=? ORDER BY tool_name`, [serverId]);
  return rows.map((tool) => ({
    name: tool.tool_name,
    description: tool.description ?? '',
    schema: safeParseConfig(tool.schema_json),
    discoveredAt: tool.discovered_at,
  }));
}

async function handleMcpAction(store: StructuredStore, action: string, id: string | undefined, payload: Record<string, unknown> | undefined) {
  await ensureMcpStorageSchema(store);

  if (action === 'list') {
    const rows = await store.all<StoredMcpRow>(`SELECT * FROM mcp_servers ORDER BY created_at DESC`);
    return { ok: true, items: rows.map(serializeMcp) };
  }

  if (action === 'get') {
    if (!id) throw new Error('mcp:get requires id');
    const row = await store.get<StoredMcpRow>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) throw new Error(`mcp server ${id} not found`);
    return { ok: true, item: serializeMcp(row), tools: await listMcpCachedTools(store, id) };
  }

  if (action === 'create') {
    const parsed = McpServerCreateSchema.parse(payload ?? {});
    const serverId = randomUUID();
    const now = new Date().toISOString();
    await store.run(
      `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        serverId,
        parsed.name,
        parsed.url,
        parsed.transport,
        parsed.description ?? '',
        parsed.timeoutMs ?? 30_000,
        JSON.stringify({ headers: parsed.headers ?? {}, auth: parsed.auth ?? null, retryConfig: parsed.retryConfig ?? null }),
        parsed.enabled !== false ? 1 : 0,
        'unknown',
        now,
        now,
      ],
    );
    const row = await store.get<StoredMcpRow>(`SELECT * FROM mcp_servers WHERE server_id=?`, [serverId]);
    return { ok: true, item: row ? serializeMcp(row) : { serverId } };
  }

  if (action === 'update') {
    if (!id) throw new Error('mcp:update requires id');
    const parsed = McpServerUpdateSchema.parse(payload ?? {});
    const existing = await store.get<StoredMcpRow>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!existing) throw new Error(`mcp server ${id} not found`);
    const currentConfig = safeParseConfig(existing.config_json);
    const nextConfig = {
      headers: parsed.headers ?? currentConfig.headers ?? {},
      auth: parsed.auth === undefined ? (currentConfig.auth ?? null) : parsed.auth,
      retryConfig: parsed.retryConfig ?? currentConfig.retryConfig ?? null,
    };
    await store.run(
      `UPDATE mcp_servers SET name=?, url=?, transport=?, description=?, timeout_ms=?, config_json=?, enabled=?, updated_at=? WHERE server_id=?`,
      [
        parsed.name ?? existing.name,
        parsed.url ?? existing.url,
        parsed.transport ?? existing.transport,
        parsed.description ?? existing.description ?? '',
        parsed.timeoutMs ?? existing.timeout_ms ?? 30_000,
        JSON.stringify(nextConfig),
        parsed.enabled === undefined ? existing.enabled : (parsed.enabled ? 1 : 0),
        new Date().toISOString(),
        id,
      ],
    );
    const updated = await store.get<StoredMcpRow>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    return { ok: true, item: updated ? serializeMcp(updated) : { serverId: id } };
  }

  if (action === 'delete') {
    if (!id) throw new Error('mcp:delete requires id');
    await store.run(`DELETE FROM mcp_servers WHERE server_id=?`, [id]);
    return { ok: true, deletedId: id };
  }

  if (action === 'toggle') {
    if (!id) throw new Error('mcp:toggle requires id');
    const row = await store.get<{ enabled: number }>(`SELECT enabled FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) throw new Error(`mcp server ${id} not found`);
    const nextEnabled = row.enabled ? 0 : 1;
    await store.run(`UPDATE mcp_servers SET enabled=?, updated_at=? WHERE server_id=?`, [nextEnabled, new Date().toISOString(), id]);
    return { ok: true, enabled: Boolean(nextEnabled) };
  }

  if (action === 'health') {
    if (!id) throw new Error('mcp:health requires id');
    const row = await store.get<StoredMcpRow>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) throw new Error(`mcp server ${id} not found`);
    const { ok, latencyMs, error } = await probeServer(row.url, Math.min(row.timeout_ms ?? 30_000, 8_000));
    const status = ok ? 'healthy' : 'unhealthy';
    const now = new Date().toISOString();
    await store.run(
      `UPDATE mcp_servers SET health_status=?, health_error=?, last_check_at=?, updated_at=? WHERE server_id=?`,
      [status, error ?? null, now, now, id],
    );
    return { ok: true, status, latencyMs: latencyMs ?? null, error: error ?? null, checkedAt: now };
  }

  if (action === 'tools') {
    if (!id) throw new Error('mcp:tools requires id');
    const exists = await store.get<{ server_id: string }>(`SELECT server_id FROM mcp_servers WHERE server_id=?`, [id]);
    if (!exists) throw new Error(`mcp server ${id} not found`);
    return { ok: true, items: await listMcpCachedTools(store, id) };
  }

  if (action === 'refresh') {
    if (!id) throw new Error('mcp:refresh requires id');
    const row = await store.get<StoredMcpRow>(`SELECT * FROM mcp_servers WHERE server_id=?`, [id]);
    if (!row) throw new Error(`mcp server ${id} not found`);

    let discovered: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];
    let discoveryError: string | null = null;
    try {
      const body = await executeMcpRequestWithRetry(row, 'tools/list', {}, Math.min(row.timeout_ms ?? 30_000, 10_000));
      if (Array.isArray((body.result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } | undefined)?.tools)) {
        discovered = (body.result as { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }).tools;
      } else if (body.error?.message) {
        discoveryError = body.error.message;
      } else {
        discoveryError = 'unexpected response shape';
      }
    } catch (error) {
      discoveryError = error instanceof Error ? error.message : 'unreachable';
    }

    const now = new Date().toISOString();
    await store.run(`DELETE FROM mcp_tool_cache WHERE server_id=?`, [id]);
    for (const tool of discovered) {
      await store.run(
        `INSERT OR REPLACE INTO mcp_tool_cache(cache_id, server_id, tool_name, description, schema_json, discovered_at) VALUES(?,?,?,?,?,?)`,
        [randomUUID(), id, tool.name, tool.description ?? '', JSON.stringify(tool.inputSchema ?? null), now],
      );
    }
    await store.run(`UPDATE mcp_servers SET tool_count=?, updated_at=? WHERE server_id=?`, [discovered.length, now, id]);

    return {
      ok: true,
      discovered: discovered.length,
      error: discoveryError,
      items: discovered.map((tool) => ({ name: tool.name, description: tool.description ?? '' })),
    };
  }

  throw new Error(`unsupported mcp action: ${action}`);
}

async function handleScenarioAction(store: StructuredStore, action: string, id: string | undefined, query: string | undefined, payload: Record<string, unknown> | undefined) {
  if (action === 'list') {
    const needle = query?.trim();
    const rows = needle
      ? await store.all<StoredScenarioRow>(
          `SELECT * FROM business_scenarios
           WHERE name LIKE ? OR description LIKE ? OR domain LIKE ?
           ORDER BY updated_at DESC`,
          [`%${needle}%`, `%${needle}%`, `%${needle}%`],
        )
      : await store.all<StoredScenarioRow>(`SELECT * FROM business_scenarios ORDER BY updated_at DESC`);
    return { ok: true, items: rows.map(serializeScenario) };
  }

  if (action === 'get' || action === 'read') {
    if (!id) throw new Error('scenarios:get requires id');
    const row = await store.get<StoredScenarioRow>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    if (!row) throw new Error(`scenario ${id} not found`);
    return { ok: true, item: serializeScenario(row) };
  }

  if (action === 'create') {
    const parsed = ScenarioSchema.parse(payload ?? {});
    const scenarioId = randomUUID();
    await store.run(
      `INSERT INTO business_scenarios(scenario_id, name, description, domain, status, data_sources, documents, manual_notes)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scenarioId,
        parsed.name,
        parsed.description ?? null,
        parsed.domain ?? null,
        parsed.status ?? 'draft',
        JSON.stringify(parsed.dataSources ?? []),
        JSON.stringify(parsed.documents ?? []),
        parsed.manualNotes ?? null,
      ],
    );
    const row = await store.get<StoredScenarioRow>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [scenarioId]);
    return { ok: true, item: row ? serializeScenario(row) : { scenarioId } };
  }

  if (action === 'update') {
    if (!id) throw new Error('scenarios:update requires id');
    const parsed = ScenarioUpdateSchema.parse(payload ?? {});
    const existing = await store.get<StoredScenarioRow>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    if (!existing) throw new Error(`scenario ${id} not found`);
    await store.run(
      `UPDATE business_scenarios SET
        name=COALESCE(?, name),
        description=COALESCE(?, description),
        domain=COALESCE(?, domain),
        status=COALESCE(?, status),
        data_sources=COALESCE(?, data_sources),
        documents=COALESCE(?, documents),
        manual_notes=COALESCE(?, manual_notes),
        updated_at=datetime('now')
       WHERE scenario_id=?`,
      [
        parsed.name ?? null,
        parsed.description ?? null,
        parsed.domain ?? null,
        parsed.status ?? null,
        parsed.dataSources ? JSON.stringify(parsed.dataSources) : null,
        parsed.documents ? JSON.stringify(parsed.documents) : null,
        parsed.manualNotes ?? null,
        id,
      ],
    );
    const updated = await store.get<StoredScenarioRow>(`SELECT * FROM business_scenarios WHERE scenario_id=?`, [id]);
    return { ok: true, item: updated ? serializeScenario(updated) : { scenarioId: id } };
  }

  if (action === 'delete') {
    if (!id) throw new Error('scenarios:delete requires id');
    await store.run(`DELETE FROM business_scenarios WHERE scenario_id=?`, [id]);
    return { ok: true, deletedId: id };
  }

  throw new Error(`unsupported scenarios action: ${action}`);
}

async function handleRuleAction(store: StructuredStore, action: string, id: string | undefined, query: string | undefined, payload: Record<string, unknown> | undefined) {
  if (action === 'list') {
    const filters = payload ?? {};
    const conds: string[] = ['1=1'];
    const params: unknown[] = [];
    if (typeof filters.bizType === 'string' && filters.bizType.trim()) {
      conds.push('biz_type=?');
      params.push(filters.bizType.trim());
    }
    if (typeof filters.ruleType === 'string' && filters.ruleType.trim()) {
      conds.push('rule_type=?');
      params.push(filters.ruleType.trim());
    }
    if (typeof filters.status === 'string' && filters.status.trim()) {
      conds.push('status=?');
      params.push(filters.status.trim());
    }
    if (query?.trim()) {
      conds.push('(rule_name LIKE ? OR description LIKE ?)');
      params.push(`%${query.trim()}%`, `%${query.trim()}%`);
    }
    const rows = await store.all<StoredRuleRow>(`SELECT * FROM risk_rules WHERE ${conds.join(' AND ')} ORDER BY synced_at DESC`, params);
    return { ok: true, items: rows.map(serializeRule) };
  }

  if (action === 'get' || action === 'read') {
    if (!id) throw new Error('rules:get requires id');
    const row = await store.get<StoredRuleRow>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    if (!row) throw new Error(`rule ${id} not found`);
    return { ok: true, item: serializeRule(row) };
  }

  if (action === 'create') {
    const parsed = RuleSchema.parse(normalizeRulePayload(payload));
    const ruleId = randomUUID();
    await store.run(
      `INSERT INTO risk_rules(rule_id, rule_name, rule_code, biz_type, rule_type, conditions_json, actions_json, coverage_json, risk_level, source, description, status, effective_from, effective_to, system_id)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ruleId,
        parsed.ruleName,
        parsed.ruleCode ?? null,
        parsed.bizType ?? null,
        parsed.ruleType ?? null,
        parsed.conditions != null ? JSON.stringify(parsed.conditions) : null,
        parsed.actions != null ? JSON.stringify(parsed.actions) : null,
        JSON.stringify(parsed.coverage ?? []),
        parsed.riskLevel ?? null,
        parsed.source ?? null,
        parsed.description ?? null,
        parsed.status ?? 'active',
        parsed.effectiveFrom ?? null,
        parsed.effectiveTo ?? null,
        parsed.systemId ?? null,
      ],
    );
    const row = await store.get<StoredRuleRow>(`SELECT * FROM risk_rules WHERE rule_id=?`, [ruleId]);
    return { ok: true, item: row ? serializeRule(row) : { ruleId } };
  }

  if (action === 'update') {
    if (!id) throw new Error('rules:update requires id');
    const parsed = RuleUpdateSchema.parse(normalizeRulePayload(payload));
    const existing = await store.get<StoredRuleRow>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    if (!existing) throw new Error(`rule ${id} not found`);
    await store.run(
      `UPDATE risk_rules SET
        rule_name=COALESCE(?, rule_name),
        rule_code=COALESCE(?, rule_code),
        biz_type=COALESCE(?, biz_type),
        rule_type=COALESCE(?, rule_type),
        risk_level=COALESCE(?, risk_level),
        source=COALESCE(?, source),
        description=COALESCE(?, description),
        conditions_json=COALESCE(?, conditions_json),
        actions_json=COALESCE(?, actions_json),
        coverage_json=COALESCE(?, coverage_json),
        status=COALESCE(?, status),
        effective_from=COALESCE(?, effective_from),
        effective_to=COALESCE(?, effective_to),
        system_id=COALESCE(?, system_id),
        synced_at=datetime('now')
       WHERE rule_id=?`,
      [
        parsed.ruleName ?? null,
        parsed.ruleCode ?? null,
        parsed.bizType ?? null,
        parsed.ruleType ?? null,
        parsed.riskLevel ?? null,
        parsed.source ?? null,
        parsed.description ?? null,
        parsed.conditions != null ? JSON.stringify(parsed.conditions) : null,
        parsed.actions != null ? JSON.stringify(parsed.actions) : null,
        parsed.coverage ? JSON.stringify(parsed.coverage) : null,
        parsed.status ?? null,
        parsed.effectiveFrom ?? null,
        parsed.effectiveTo ?? null,
        parsed.systemId ?? null,
        id,
      ],
    );
    const updated = await store.get<StoredRuleRow>(`SELECT * FROM risk_rules WHERE rule_id=?`, [id]);
    return { ok: true, item: updated ? serializeRule(updated) : { ruleId: id } };
  }

  if (action === 'delete') {
    if (!id) throw new Error('rules:delete requires id');
    await store.run(`DELETE FROM risk_rules WHERE rule_id=?`, [id]);
    return { ok: true, deletedId: id };
  }

  throw new Error(`unsupported rules action: ${action}`);
}

async function handleProfileAction(store: StructuredStore, action: string, id: string | undefined, query: string | undefined, payload: Record<string, unknown> | undefined) {
  if (action === 'list') {
    const needle = query?.trim();
    const rows = needle
      ? await store.all<StoredProfileRow>(
          `SELECT * FROM business_profiles WHERE business_name LIKE ? ORDER BY created_at DESC`,
          [`%${needle}%`],
        )
      : await store.all<StoredProfileRow>(`SELECT * FROM business_profiles ORDER BY created_at DESC LIMIT 100`);
    return { ok: true, items: rows.map(serializeProfileSummary) };
  }

  if (action === 'get' || action === 'read') {
    if (!id) throw new Error('profiles:get requires id');
    const row = await store.get<StoredProfileRow>(`SELECT * FROM business_profiles WHERE profile_id=?`, [id]);
    if (!row) throw new Error(`profile ${id} not found`);
    return { ok: true, item: serializeProfile(row) };
  }

  if (action === 'create') {
    const parsed = ProfileSchema.parse(normalizeProfilePayload(payload));
    const profileId = randomUUID();
    await store.run(
      `INSERT INTO business_profiles(profile_id, session_id, business_name, version, entities_json, behaviors_json, api_features, overall_score, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        profileId,
        parsed.sessionId ?? null,
        parsed.businessName,
        parsed.version ?? 1,
        JSON.stringify(parsed.entities ?? []),
        JSON.stringify(parsed.behaviors ?? []),
        JSON.stringify(parsed.apiFeatures ?? []),
        parsed.overallScore ?? 0,
      ],
    );
    const row = await store.get<StoredProfileRow>(`SELECT * FROM business_profiles WHERE profile_id=?`, [profileId]);
    return { ok: true, item: row ? serializeProfile(row) : { profileId } };
  }

  if (action === 'update') {
    if (!id) throw new Error('profiles:update requires id');
    const parsed = ProfileUpdateSchema.parse(normalizeProfilePayload(payload));
    const existing = await store.get<StoredProfileRow>(`SELECT * FROM business_profiles WHERE profile_id=?`, [id]);
    if (!existing) throw new Error(`profile ${id} not found`);
    await store.run(
      `UPDATE business_profiles SET session_id=?, business_name=?, version=?, entities_json=?, behaviors_json=?, api_features=?, overall_score=? WHERE profile_id=?`,
      [
        parsed.sessionId === undefined ? existing.session_id : parsed.sessionId,
        parsed.businessName ?? existing.business_name,
        parsed.version ?? existing.version ?? 1,
        JSON.stringify(parsed.entities ?? safeParseJson(existing.entities_json, [] as Array<Record<string, unknown>>)),
        JSON.stringify(parsed.behaviors ?? safeParseJson(existing.behaviors_json, [] as Array<Record<string, unknown>>)),
        JSON.stringify(parsed.apiFeatures ?? safeParseJson(existing.api_features, [] as Array<Record<string, unknown>>)),
        parsed.overallScore ?? existing.overall_score ?? 0,
        id,
      ],
    );
    const updated = await store.get<StoredProfileRow>(`SELECT * FROM business_profiles WHERE profile_id=?`, [id]);
    return { ok: true, item: updated ? serializeProfile(updated) : { profileId: id } };
  }

  if (action === 'delete') {
    if (!id) throw new Error('profiles:delete requires id');
    await store.run(`DELETE FROM business_profiles WHERE profile_id=?`, [id]);
    return { ok: true, deletedId: id };
  }

  throw new Error(`unsupported profiles action: ${action}`);
}

async function handleKnowledgeGraphAction(
  storage: StorageBackendRegistry,
  kgs: KnowledgeGraphService,
  action: string,
  id: string | undefined,
  query: string | undefined,
  payload: Record<string, unknown> | undefined,
) {
  const graphStore = storage.getGraphStore();
  const normalizedAction = normalizeKnowledgeGraphAction(action, payload);

  if (normalizedAction === 'overview') {
    return { ok: true, item: await kgs.getOverview() };
  }

  if (normalizedAction === 'list') {
    const parsed = KnowledgeGraphListSchema.parse(payload ?? {});
    const graph = parsed.graph ?? 'all';

    if (graph === 'business_graph') {
      const [nodes, edges] = await Promise.all([
        graphStore.listNodes('business_graph'),
        graphStore.listEdges('business_graph'),
      ]);
      return {
        ok: true,
        item: {
          graph,
          nodes: nodes.map((node) => serializeGraphNode(node, 'business_graph')),
          edges: edges.map((edge) => serializeGraphEdge(edge, 'business_graph')),
        },
      };
    }

    if (graph === 'rule_lineage') {
      const [nodes, edges] = await Promise.all([
        graphStore.listNodes('rule_lineage'),
        graphStore.listEdges('rule_lineage'),
      ]);
      return {
        ok: true,
        item: {
          graph,
          nodes: nodes.map((node) => serializeGraphNode(node, 'rule_lineage')),
          edges: edges.map((edge) => serializeGraphEdge(edge, 'rule_lineage')),
        },
      };
    }

    const [lineageNodes, lineageEdges, businessNodes, businessEdges] = await Promise.all([
      graphStore.listNodes('rule_lineage'),
      graphStore.listEdges('rule_lineage'),
      graphStore.listNodes('business_graph'),
      graphStore.listEdges('business_graph'),
    ]);

    return {
      ok: true,
      item: {
        graph,
        nodes: [
          ...lineageNodes.map((node) => serializeGraphNode(node, 'rule_lineage')),
          ...businessNodes.map((node) => serializeGraphNode(node, 'business_graph')),
        ],
        edges: [
          ...lineageEdges.map((edge) => serializeGraphEdge(edge, 'rule_lineage')),
          ...businessEdges.map((edge) => serializeGraphEdge(edge, 'business_graph')),
        ],
      },
    };
  }

  if (normalizedAction === 'search') {
    const parsed = KnowledgeGraphSearchSchema.parse({
      ...(payload ?? {}),
      query: typeof payload?.query === 'string' && payload.query.trim()
        ? payload.query.trim()
        : query,
    });
    const searchParams: KGSearchParams = {
      query: parsed.query,
      limit: parsed.limit,
      nodeTypes: parsed.nodeTypes?.filter(isKnowledgeGraphNodeType),
    };
    return { ok: true, items: await kgs.search(searchParams) };
  }

  if (normalizedAction === 'get' || normalizedAction === 'read') {
    const nodeId = id ?? (typeof payload?.nodeId === 'string' ? payload.nodeId : undefined);
    if (!nodeId) throw new Error('knowledge_graph:read requires id or payload.nodeId');
    const node = await lookupKnowledgeGraphNode(graphStore, nodeId);
    if (!node) throw new Error(`knowledge graph node ${nodeId} not found`);
    return { ok: true, item: node };
  }

  if (normalizedAction === 'neighborhood') {
    const parsed = KnowledgeGraphNeighborhoodSchema.parse(payload ?? {});
    const nodeId = id ?? parsed.nodeId;
    if (!nodeId) throw new Error('knowledge_graph:neighborhood requires id or payload.nodeId');
    const neighborhoodParams: KGNeighborhoodParams = {
      nodeId,
      depth: parsed.depth,
      direction: parsed.direction,
      relationTypes: parsed.relationTypes?.filter(isKnowledgeGraphRelationType),
    };
    return {
      ok: true,
      item: await kgs.getNeighborhood(neighborhoodParams),
    };
  }

  if (normalizedAction === 'chain') {
    const parsed = KnowledgeGraphNeighborhoodSchema.parse(payload ?? {});
    const nodeId = id ?? parsed.nodeId;
    if (!nodeId) throw new Error('knowledge_graph:chain requires id or payload.nodeId');
    return { ok: true, item: await kgs.getChain(nodeId, parsed.direction ?? 'both') };
  }

  if (normalizedAction === 'impact') {
    const nodeId = id ?? (typeof payload?.nodeId === 'string' ? payload.nodeId : undefined);
    if (!nodeId) throw new Error('knowledge_graph:impact requires id or payload.nodeId');
    return { ok: true, item: await kgs.getImpact(nodeId) };
  }

  if (normalizedAction === 'upsert_node') {
    const parsed = KnowledgeGraphNodeSchema.parse(normalizeKnowledgeGraphNodePayload(payload)) as KGUpsertNodeInput;
    await kgs.upsertNode(parsed);
    return { ok: true, item: parsed };
  }

  if (normalizedAction === 'add_edge') {
    const parsed = KnowledgeGraphEdgeSchema.parse(await normalizeKnowledgeGraphEdgePayload(graphStore, payload)) as KGAddEdgeInput;
    await kgs.addEdge(parsed);
    return { ok: true, item: parsed };
  }

  if (normalizedAction === 'delete_node') {
    const nodeId = id ?? (typeof payload?.nodeId === 'string' ? payload.nodeId : undefined);
    if (!nodeId) throw new Error('knowledge_graph:delete_node requires id or payload.nodeId');
    await kgs.deleteNode({ id: nodeId });
    return { ok: true, deletedId: nodeId };
  }

  throw new Error(`unsupported knowledge_graph action: ${action}`);
}

async function handleSkillsAction(loader: SkillLoader, action: string, id: string | undefined, path: string | undefined, query: string | undefined, payload: Record<string, unknown> | undefined) {
  if (action === 'list') {
    const items = await loader.list();
    const needle = query?.trim().toLowerCase();
    const filtered = !needle
      ? items
      : items.filter((skill) => [skill.name, skill.description, ...(skill.tags ?? [])].some((value) => value.toLowerCase().includes(needle)));
    return { ok: true, items: filtered };
  }

  if (action === 'get') {
    if (!id) throw new Error('skills:get requires id');
    const item = await loader.getSkill(id);
    if (!item) throw new Error(`skill ${id} not found`);
    return { ok: true, item };
  }

  if (action === 'tree') {
    if (!id) throw new Error('skills:tree requires id');
    const tree = await loader.getSkillTree(id);
    if (!tree) throw new Error(`skill ${id} not found`);
    return { ok: true, items: tree };
  }

  if (action === 'read_file') {
    if (!id || !path) throw new Error('skills:read_file requires id and path');
    const file = await loader.readSkillFile(id, path);
    if (!file) throw new Error(`skill file ${id}:${path} not found`);
    return { ok: true, item: file };
  }

  if (action === 'create') {
    const parsed = SkillCreateSchema.parse(payload ?? {});
    const item = await loader.createSkill(parsed.name, parsed.description, parsed.content);
    return { ok: true, item };
  }

  if (action === 'delete') {
    if (!id) throw new Error('skills:delete requires id');
    await loader.deleteSkill(id);
    return { ok: true, deletedId: id };
  }

  if (action === 'test') {
    if (!id) throw new Error('skills:test requires id');
    const result = await loader.testSkill(id);
    if (!result.success) {
      return { ok: false, error: result.error };
    }
    return { ok: true, output: result.output };
  }

  throw new Error(`unsupported skills action: ${action}`);
}

function handleToolsAction(action: string, id: string | undefined, query: string | undefined) {
  const registry = buildCatalogRegistry();
  if (action === 'list') {
    const needle = query?.trim().toLowerCase();
    const items = registry.list().filter((tool) => {
      if (!needle) return true;
      return tool.name.toLowerCase().includes(needle)
        || tool.description.toLowerCase().includes(needle)
        || (tool.searchHint ?? '').toLowerCase().includes(needle);
    }).map(serializeCatalogTool);
    return { ok: true, items };
  }

  if (action === 'get') {
    if (!id) throw new Error('tools:get requires id');
    const tool = registry.get(id);
    if (!tool) throw new Error(`tool ${id} not found`);
    return { ok: true, item: serializeCatalogTool(tool) };
  }

  throw new Error(`unsupported tools action: ${action}`);
}

export function createSystemResourcesTool(storage: StorageBackendRegistry): AgentToolDefinition<SystemResourcesToolInput> {
  const store = storage.getStructuredStore();
  const loader = createSkillLoader(storage);
  const knowledgeGraph = new KnowledgeGraphService(
    storage.getGraphStore(),
    storage.getLineageStore(),
    store,
  );

  return buildTool<SystemResourcesToolInput>({
    name: 'system_resources',
    description: '统一管理系统资源：模型、MCP 服务器、数据源、技能、工具注册表，以及业务场景、风控规则、业务画像、知识图谱。适合让 agent 通过单个内置工具完成设置中心和业务知识资产的大多数资源级操作。',
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: 'models mcp datasources skills tools catalog scenarios rules profiles knowledge graph 资源管理 配置 场景 规则 画像 图谱',
    inputSchema: {
      type: 'object',
      required: ['domain', 'action'],
      properties: {
        domain: {
          type: 'string',
          enum: ['models', 'mcp', 'datasources', 'skills', 'tools', 'scenarios', 'rules', 'profiles', 'knowledge_graph'],
        },
        action: { type: 'string' },
        id: { type: 'string' },
        query: { type: 'string' },
        path: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
      },
    },
    async execute(input) {
      const domain = ResourceDomainSchema.parse(input.domain);

      switch (domain) {
        case 'models':
          return handleModelAction(store, input.action, input.id, input.payload);
        case 'datasources':
          return handleDatasourceAction(store, input.action, input.id, input.payload);
        case 'mcp':
          return handleMcpAction(store, input.action, input.id, input.payload);
        case 'skills':
          return handleSkillsAction(loader, input.action, input.id, input.path, input.query, input.payload);
        case 'tools':
          return handleToolsAction(input.action, input.id, input.query);
        case 'scenarios':
          return handleScenarioAction(store, input.action, input.id, input.query, input.payload);
        case 'rules':
          return handleRuleAction(store, input.action, input.id, input.query, input.payload);
        case 'profiles':
          return handleProfileAction(store, input.action, input.id, input.query, input.payload);
        case 'knowledge_graph':
          return handleKnowledgeGraphAction(storage, knowledgeGraph, input.action, input.id, input.query, input.payload);
        default:
          throw new Error(`unsupported domain: ${domain}`);
      }
    },
  });
}