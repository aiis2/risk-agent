/**
 * Tools API Routes — 工具注册表查询接口
 * (tools-skills-system.md §7 Built-in tool catalog)
 *
 * GET /api/tools          — 列出所有已注册工具（含 deferred 信息）
 * GET /api/tools/:name    — 获取单个工具详情
 */

import type { FastifyInstance } from 'fastify';
import {
  ToolRegistry,
  writeDbTool,
  fileWriteTool,
  stopWorkerTool,
  enterPlanModeTool,
  exitPlanModeTool,
  taskStopTool,
  agentTool,
  sendMessageTool,
  importRiskRulesTool,
  modifyRiskRuleTool,
  deleteRiskRuleTool,
  exportReportTool,
  buildGapMapTool,
  callExternalApiTool,
  gitScanTool,
  packageProbeTool,
  packageManagerProbeTool,
  packageManagerWriteTool,
  processProbeTool,
  reportRenderTool,
  renderHtmlReportTool,
  jsSandboxTool,
  askUserTool,
  fileParseTool,
  httpApiTool,
  webFetchTool,
  workspaceProbeTool,
  createDataQualityTool,
  profileBuildTool,
  gapAnalysisTool,
  validateReportTool,
  alertSendTool,
  type SandboxAccessTier,
  type SandboxHostKind,
} from '@risk-agent/core';
import type { AppContext } from '../index.js';

type CatalogTool = {
  name: string;
  description: string;
  aliases?: string[];
  searchHint?: string;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isDestructive: boolean;
  alwaysLoad: boolean;
  deferred?: boolean;
  strict?: boolean;
  isOpenWorld?: boolean;
  sandboxProfile?: string;
  sandboxHostKind?: SandboxHostKind;
  sandboxAccessTier?: SandboxAccessTier;
  maxResultSizeChars?: number;
  inputSchema: Record<string, unknown>;
};

const catalogOnlyExecute = async () => ({ catalogOnly: true });

function registerCatalogTool(reg: ToolRegistry, tool: CatalogTool): void {
  reg.register({
    ...tool,
    execute: catalogOnlyExecute,
  });
}

/** 内部构建一个只读工具注册表（不依赖 QueryEngine 运行时），仅用于信息展示 */
export function buildCatalogRegistry(): ToolRegistry {
  const reg = new ToolRegistry();

  // ── Coordinator / Control ──────────────────────────────────
  reg.register(askUserTool);
  reg.register(enterPlanModeTool);
  reg.register(exitPlanModeTool);
  reg.register(agentTool);
  reg.register(sendMessageTool);
  registerCatalogTool(reg, {
    name: 'dispatch_subagents',
    description: '派发并跟踪多个子代理任务，汇总其执行状态与结果。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '子代理 调度 dispatch subagents workers',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: { type: 'array', items: { type: 'object' } },
        strategy: { type: 'string' },
      },
    },
  });

  // ── Worker management ──────────────────────────────────────
  reg.register(taskStopTool);
  reg.register(stopWorkerTool);
  reg.register(writeDbTool);
  reg.register(fileWriteTool);
  registerCatalogTool(reg, {
    name: 'system_settings',
    description: '读取或更新持久化系统设置，包括默认模型、运行上限、web search 配置以及 browser runtime 策略。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: true,
    searchHint: 'settings preferences tavily api key web search browser runtime 配置 默认模型 主题 语言 浏览器',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get', 'update'] },
        updates: {
          type: 'object',
          properties: {
            browserRuntime: {
              type: 'object',
              properties: {
                defaultProvider: { type: 'string', enum: ['embedded-first', 'external-preferred', 'external-only'] },
                defaultWorkspaceMode: { type: 'string', enum: ['exclusive', 'global-shared'] },
                allowManualAttach: { type: 'boolean' },
                allowSharedContribution: { type: 'boolean' },
                externalBrowserMode: { type: 'string', enum: ['system-default', 'configured'] },
                externalBrowserExecutable: { type: 'string' },
              },
            },
          },
          additionalProperties: true,
        },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'system_resources',
    description: '通过统一的资源管理入口列出、创建、更新和删除模型、MCP 服务器、数据源、技能、业务场景、风控规则、业务画像与知识图谱资源，并查询工具注册表。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
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
        action: {
          type: 'string',
          enum: ['list', 'get', 'read', 'create', 'update', 'delete', 'toggle', 'health', 'tools', 'refresh', 'tree', 'read_file', 'test', 'overview', 'search', 'query', 'neighborhood', 'chain', 'impact', 'upsert_node', 'create_node', 'get_node', 'add_edge', 'create_edge', 'delete_node'],
        },
        id: { type: 'string' },
        query: { type: 'string' },
        path: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'browser_host',
    description: '管理内置浏览器 host、工作区和标签页，并对 hosted tab 执行导航、快照、截图与交互动作。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: true,
    searchHint: 'browser host workspace tab navigate snapshot screenshot click type press 内置浏览器',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'state',
            'ensure_session_workspace',
            'ensure_standalone_workspace',
            'share_workspace',
            'attach_workspace',
            'detach_workspace',
            'delete_workspace',
            'create_tab',
            'save_layout',
            'activate_tab',
            'reload_tab',
            'navigate_tab',
            'go_back',
            'go_forward',
            'close_tab',
            'snapshot_tab',
            'screenshot_tab',
            'list_images',
            'click',
            'type',
            'press',
            'open_window',
            'focus_window',
            'open_external',
          ],
        },
        id: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
      },
    },
  });

  // ── Memory ─────────────────────────────────────────────────
  registerCatalogTool(reg, {
    name: 'memory_read',
    description: '读取长期记忆检索结果与当前会话的短期摘要。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '记忆 memory 搜索 摘要 上下文',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        topK: { type: 'number' },
        includeShortTerm: { type: 'boolean' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'memory_write',
    description: '写入长期记忆条目，供后续跨会话检索与召回。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '记忆 memory 写入 长期记忆',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'memory_write_short_term',
    description: '写入当前会话短期记忆，用于后续轮次的即时上下文补充。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '短期记忆 short term memory 会话上下文',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string' },
        category: { type: 'string' },
      },
    },
  });

  // ── Data collection ────────────────────────────────────────
  reg.register(gitScanTool);
  reg.register(workspaceProbeTool);
  reg.register(packageProbeTool);
  reg.register(packageManagerProbeTool);
  reg.register(packageManagerWriteTool);
  reg.register(processProbeTool);
  reg.register(httpApiTool);
  reg.register(webFetchTool);
  registerCatalogTool(reg, {
    name: 'web_search',
    description: '使用已配置的网络搜索服务商执行联网搜索，适合验证 Tavily 等 provider 是否可用，并获取最新网页结果。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: true,
    searchHint: 'tavily web search internet online current network 搜索 联网',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        provider: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'web_scrape',
    description:
      '使用无头 Chromium 浏览器抓取网页内容，支持 JavaScript 渲染的动态页面（SPA、新闻、公告、监管政策等）。' +
      '当 web_fetch 无法获取完整内容时使用此工具。每次调用会启动浏览器，耗时约 10-30 秒。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: true,
    searchHint: '网页抓取 浏览器 playwright 动态页面 JS渲染 SPA scrape browser 联网 公告 新闻 监管',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description: '目标网页的完整 URL（必须以 http:// 或 https:// 开头）',
        },
        waitForSelector: {
          type: 'string',
          description: '等待指定 CSS 选择器出现后再提取内容（可选，例如 ".article-body"）',
        },
        extractSelector: {
          type: 'string',
          description: '仅提取匹配 CSS 选择器的元素文本，留空则提取整个 body（可选）',
        },
        timeoutMs: {
          type: 'number',
          description: '页面加载超时毫秒数（默认 30000，最大 60000）',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: '等待页面加载状态（默认 "networkidle"，动态内容可用 "networkidle"）',
        },
      },
    },
  });
  reg.register(fileParseTool);
  registerCatalogTool(reg, {
    name: 'query_database',
    description: '对内部 SQLite 数据库执行只读 SELECT 查询。禁止 INSERT/UPDATE/DELETE/DDL。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: true,
    searchHint: '数据库 SQL 查询 select sqlite',
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: {
        sql: { type: 'string', description: '只读 SQL' },
        params: { type: 'array', items: {} },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'get_database_schema',
    description: '获取外部数据库（MySQL / PostgreSQL / SQLite）的 Schema 信息（表名、列、类型）。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '数据库 schema 表结构 外部 mysql postgres',
    inputSchema: {
      type: 'object',
      required: ['connectionString'],
      properties: {
        connectionString: { type: 'string' },
        tableFilter: { type: 'string' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'query_database_external',
    description: '对外部数据库执行只读 SQL 查询（支持 MySQL / PostgreSQL / SQLite）。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '外部数据库 SQL 查询 mysql postgres',
    inputSchema: {
      type: 'object',
      required: ['connectionString', 'sql'],
      properties: {
        connectionString: { type: 'string' },
        sql: { type: 'string' },
        params: { type: 'array', items: {} },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'datasource_knowledge_search',
    description: '在数据源知识索引中按语义检索表、字段、关系与说明信息。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '数据源 知识 检索 schema metadata search',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        datasourceId: { type: 'string' },
        topK: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'datasource_knowledge_graph',
    description: '返回数据源知识图谱中的实体关系、邻接节点与说明信息。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '数据源 知识 图谱 graph lineage',
    inputSchema: {
      type: 'object',
      required: ['entityId'],
      properties: {
        entityId: { type: 'string' },
        depth: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'rule_nl_parse',
    description: '将自然语言的风控规则描述解析为结构化规则候选项。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '规则 自然语言 解析 风控 rule parse',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        locale: { type: 'string' },
      },
    },
  });

  // ── Data quality ───────────────────────────────────────────
  reg.register(createDataQualityTool());

  // ── Analysis ───────────────────────────────────────────────
  reg.register(profileBuildTool);
  reg.register(gapAnalysisTool);
  reg.register(jsSandboxTool);
  registerCatalogTool(reg, {
    name: 'vector_search',
    description: '对向量库的指定 collection 进行语义检索，返回 topK 命中。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '向量 语义 搜索 embedding 相似度',
    inputSchema: {
      type: 'object',
      required: ['collection', 'vector'],
      properties: {
        collection: { type: 'string' },
        vector: { type: 'array', items: { type: 'number' } },
        topK: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'graph_query',
    description: '在业务关系图谱中执行 Cypher 风格查询，返回节点与边。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '图谱 graph 关系 查询 节点 边',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        params: { type: 'object' },
      },
    },
  });

  // ── Knowledge base ─────────────────────────────────────────
  registerCatalogTool(reg, {
    name: 'vector_embed',
    description: '对文本进行向量化并写入指定 collection，用于后续语义检索。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '向量 embedding 写入 知识库 向量化',
    inputSchema: {
      type: 'object',
      required: ['collection', 'text'],
      properties: {
        collection: { type: 'string' },
        text: { type: 'string' },
        metadata: { type: 'object' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'graph_write',
    description: '向业务关系图谱写入节点或边，用于构建业务实体关系网络。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '图谱 写入 节点 边 关系 graph',
    inputSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: { type: 'string', enum: ['add_node', 'add_edge', 'remove_node', 'remove_edge'] },
        node: { type: 'object' },
        edge: { type: 'object' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'kg_node_upsert',
    description: '向知识图谱中创建或更新节点属性。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '知识图谱 节点 upsert graph node',
    inputSchema: {
      type: 'object',
      required: ['nodeType', 'key'],
      properties: {
        nodeType: { type: 'string' },
        key: { type: 'string' },
        properties: { type: 'object' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'kg_edge_add',
    description: '向知识图谱中添加实体之间的关系边。',
    isConcurrencySafe: false,
    isDestructive: false,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '知识图谱 关系 边 add edge',
    inputSchema: {
      type: 'object',
      required: ['from', 'to', 'relation'],
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        relation: { type: 'string' },
        properties: { type: 'object' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'kg_node_delete',
    description: '删除知识图谱中的节点及其关联关系。',
    isConcurrencySafe: false,
    isDestructive: true,
    isReadOnly: false,
    alwaysLoad: false,
    searchHint: '知识图谱 删除 节点 delete node',
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: { type: 'string' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'kg_neighborhood',
    description: '查询知识图谱中节点的邻域、边和关联实体。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '知识图谱 邻域 neighborhood relation',
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: { type: 'string' },
        depth: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'kg_search',
    description: '在知识图谱中按实体名称、标签或属性进行搜索。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '知识图谱 搜索 entity search',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  });
  registerCatalogTool(reg, {
    name: 'kg_impact',
    description: '分析知识图谱中节点变更可能影响到的上下游实体。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    searchHint: '知识图谱 影响 分析 impact',
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: { type: 'string' },
        depth: { type: 'number' },
      },
    },
  });

  // ── Risk-specific ──────────────────────────────────────────
  reg.register(importRiskRulesTool);
  reg.register(modifyRiskRuleTool);
  reg.register(deleteRiskRuleTool);
  reg.register(buildGapMapTool);
  reg.register(callExternalApiTool);

  // ── Report ─────────────────────────────────────────────────
  reg.register(reportRenderTool);
  reg.register(exportReportTool);
  reg.register(renderHtmlReportTool);
  reg.register(validateReportTool);
  reg.register(alertSendTool);

  // ── Tool discovery ─────────────────────────────────────────
  registerCatalogTool(reg, {
    name: 'tool_search',
    description: '在工具注册表中搜索工具，支持语义关键词匹配（deferred 工具动态加载）。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: false,
    searchHint: '工具 搜索 发现 tool search',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  });

  return reg;
}

export function registerToolsRoutes(app: FastifyInstance, _ctx: AppContext): void {
  const reg = buildCatalogRegistry();

  /** GET /api/tools — 列出所有工具，支持过滤 */
  app.get<{
    Querystring: {
      deferred?: string;
      readonly?: string;
      destructive?: string;
      q?: string;
    }
  }>('/api/tools', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          deferred: { type: 'string' },
          readonly: { type: 'string' },
          destructive: { type: 'string' },
          q: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    let tools = reg.list();

    const q = req.query.q?.toLowerCase();
    if (q) {
      tools = tools.filter((tool) =>
        tool.name.toLowerCase().includes(q)
        || tool.description.toLowerCase().includes(q)
        || (tool.searchHint ?? '').toLowerCase().includes(q)
      );
    }
    if (req.query.deferred !== undefined) {
      const want = req.query.deferred === 'true';
      tools = tools.filter((tool) => (tool.deferred ?? false) === want);
    }
    if (req.query.readonly !== undefined) {
      const want = req.query.readonly === 'true';
      tools = tools.filter((tool) => (tool.isReadOnly ?? false) === want);
    }
    if (req.query.destructive !== undefined) {
      const want = req.query.destructive === 'true';
      tools = tools.filter((tool) => (tool.isDestructive ?? false) === want);
    }

    return {
      success: true,
      data: {
        total: tools.length,
        tools: tools.map((tool) => ({
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
        })),
      },
    };
  });

  /** GET /api/tools/:name — 单工具详情 */
  app.get<{ Params: { name: string } }>('/api/tools/:name', async (req, reply) => {
    const tool = reg.get(req.params.name);
    if (!tool) {
      return reply.status(404).send({ success: false, error: `Tool '${req.params.name}' not found` });
    }

    return {
      success: true,
      data: {
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
      },
    };
  });
}
