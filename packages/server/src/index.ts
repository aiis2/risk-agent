import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { DreamTaskRunner, StorageBackendRegistry } from '@risk-agent/core';
import { loadConfigFromEnv, type ServerConfig } from './config.js';
import { registerHealthRoute } from './routes/health.js';
import { registerScenarioRoutes } from './routes/scenarios.js';
import { registerRuleRoutes } from './routes/rules.js';
import { registerRuleImportRoutes } from './routes/rule-import.js';
import { registerRuleSystemRoutes } from './routes/rule-systems.js';
import { registerRuleSourceRoutes } from './routes/rule-sources.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerLineageRoutes } from './routes/lineage.js';
import { registerBusinessesRoutes } from './routes/businesses.js';
import { registerCapabilityRoutes } from './routes/capabilities.js';
import { ensureMcpStorageSchema, registerMCPRoutes } from './routes/mcp.js';
import { registerDataSourceRoutes } from './routes/datasources.js';
import { registerModelRoutes } from './routes/models.js';
import { registerSettingsStorageRoutes } from './routes/settings-storage.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { registerPersonaRoutes } from './routes/personas.js';
import { registerUserProfileRoutes } from './routes/userProfile.js';
import { registerInsightsRoutes } from './routes/insights.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerToolsRoutes } from './routes/tools.js';
import { registerSecurityRoutes } from './routes/security.js';
import { registerDreamTaskRoutes } from './routes/dream-tasks.js';
import { registerScheduledRunRoutes } from './routes/scheduled-runs.js';
import { registerCustomAgentRoutes } from './routes/custom-agents.js';
import { registerKnowledgeGraphRoutes } from './routes/knowledge-graph.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerWebSearchRoutes } from './routes/web-search.js';
import { registerBrowserRoutes } from './routes/browser.js';
import { registerWebUiRoutes } from './routes/web-ui.js';
import { registerAgentProgressWS } from './ws/AgentProgressHandler.js';
import { SessionRunner } from './agents/SessionRunner.js';
import { RunService } from './runs/RunService.js';
import { buildHarnessRuntime } from './runs/buildHarnessRuntime.js';
import { ScheduledRunService } from './schedules/ScheduledRunService.js';
import { startPlaywrightMcpSidecar, stopPlaywrightMcpSidecar } from './services/PlaywrightMcpSidecar.js';
import { BrowserWorkspaceService } from './browser/BrowserWorkspaceService.js';
import type { BrowserHostAdapter } from './browser/BrowserHostAdapter.js';

export type {
  BrowserHostAdapter,
  BrowserHostImageRecord,
  BrowserHostScreenshotOptions,
  BrowserHostScreenshotResult,
  BrowserHostSnapshotResult,
  BrowserHostTabSnapshot,
} from './browser/BrowserHostAdapter.js';

export interface BuildAppOptions extends Partial<ServerConfig> {
  browserHostAdapter?: BrowserHostAdapter | null;
}

export interface AppContext {
  config: ServerConfig;
  storage: StorageBackendRegistry;
  browserWorkspaces: BrowserWorkspaceService;
  browserHostAdapter: BrowserHostAdapter | null;
  runner: SessionRunner;
  runService: RunService;
  dreamTaskRunner: DreamTaskRunner;
  scheduledRunService: ScheduledRunService;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  startBackgroundServices(): Promise<void>;
}

const BUILTIN_PLAYWRIGHT_SERVER_ID = 'builtin-playwright';

function isElectronRuntime(): boolean {
  return typeof process.versions.electron === 'string' && process.versions.electron.length > 0;
}

function getBuiltinPlaywrightMcpUrl(): string {
  const parsedPort = parseInt(process.env.PLAYWRIGHT_MCP_PORT ?? '8931', 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 8931;
  return `http://127.0.0.1:${port}/mcp`;
}

async function ensureBuiltinPlaywrightMcpServer(storage: StorageBackendRegistry): Promise<void> {
  if (!isElectronRuntime()) {
    return;
  }

  const store = storage.getStructuredStore();
  const url = getBuiltinPlaywrightMcpUrl();
  const existing = await store.get<{ server_id: string }>(
    `SELECT server_id FROM mcp_servers WHERE lower(name)=lower(?) OR url=? LIMIT 1`,
    ['playwright', url],
  );
  if (existing) {
    return;
  }

  const now = new Date().toISOString();
  await store.run(
    `INSERT INTO mcp_servers(server_id, name, url, transport, description, timeout_ms, config_json, enabled, health_status, tool_count, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      BUILTIN_PLAYWRIGHT_SERVER_ID,
      'playwright',
      url,
      'http',
      'Built-in Playwright MCP',
      30000,
      JSON.stringify({ headers: {} }),
      1,
      'unknown',
      0,
      now,
      now,
    ],
  );
}

export async function buildApp(cfg?: BuildAppOptions): Promise<BuiltApp> {
  const config = { ...loadConfigFromEnv(), ...cfg } as ServerConfig;
  const app = Fastify({
    logger: { level: config.logLevel }
  });
  const storage = await StorageBackendRegistry.bootstrap(config.dataDir);
  const browserWorkspaces = new BrowserWorkspaceService(storage.getStructuredStore());
  const runner = new SessionRunner(storage, {
    browserWorkspaces,
    browserHostAdapter: cfg?.browserHostAdapter ?? null,
  });
  const dreamTaskRunner = new DreamTaskRunner();
  const runService = new RunService(
    storage,
    async (modelId?: string, surface?: string) => buildHarnessRuntime(storage, modelId, surface, {
      browserWorkspaces,
      browserHostAdapter: cfg?.browserHostAdapter ?? null,
    }),
  );
  const scheduledRunService = new ScheduledRunService(
    storage.getStructuredStore(),
    dreamTaskRunner,
    runService,
  );
  await scheduledRunService.initialize();
  await ensureMcpStorageSchema(storage.getStructuredStore());
  await browserWorkspaces.ensureSchema();
  await ensureBuiltinPlaywrightMcpServer(storage);

  const ctx: AppContext = {
    config,
    storage,
    browserWorkspaces,
    browserHostAdapter: cfg?.browserHostAdapter ?? null,
    runner,
    runService,
    dreamTaskRunner,
    scheduledRunService,
  };

  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  registerHealthRoute(app, ctx);
  registerScenarioRoutes(app, ctx);
  registerRuleRoutes(app, ctx);
  registerRuleImportRoutes(app, ctx);
  registerRuleSystemRoutes(app, ctx);
  registerRuleSourceRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerLineageRoutes(app, ctx);
  registerBusinessesRoutes(app, ctx);
  registerMCPRoutes(app, ctx);
  registerDataSourceRoutes(app, ctx);
  registerModelRoutes(app, ctx);
  registerSettingsStorageRoutes(app, ctx);
  registerPreferencesRoutes(app, ctx);
  registerBrowserRoutes(app, ctx);
  registerPersonaRoutes(app, ctx);
  registerUserProfileRoutes(app, ctx);
  registerInsightsRoutes(app, ctx.storage);
  registerSkillsRoutes(app, ctx);
  registerToolsRoutes(app, ctx);
  registerSecurityRoutes(app, ctx);
  registerDreamTaskRoutes(app, ctx);
  registerScheduledRunRoutes(app, ctx);
  registerCustomAgentRoutes(app, ctx);
  registerKnowledgeGraphRoutes(app, ctx);
  registerCapabilityRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerWebSearchRoutes(app, ctx);
  registerAgentProgressWS(app, ctx);
  registerWebUiRoutes(app, process.env.RISK_AGENT_WEB_DIST_DIR);

  let scheduledRunPoller: ReturnType<typeof setInterval> | null = null;
  let backgroundServicesPromise: Promise<void> | null = null;

  const startBackgroundServices = async (): Promise<void> => {
    if (!backgroundServicesPromise) {
      backgroundServicesPromise = (async () => {
        if (!scheduledRunPoller) {
          scheduledRunPoller = setInterval(() => {
            void scheduledRunService.dispatchDueSchedules().catch((error) => {
              app.log.error({ error }, 'scheduled run dispatch failed');
            });
          }, 15_000);
        }

        await startPlaywrightMcpSidecar({
          embeddedController: isElectronRuntime()
            ? {
                browserWorkspaces,
                browserHostAdapter: ctx.browserHostAdapter,
                preferenceStore: storage.getStructuredStore(),
              }
            : null,
        }).catch((err: unknown) => {
          app.log.warn({ err }, 'playwright mcp sidecar failed to start');
        });
      })();
    }

    await backgroundServicesPromise;
  };

  app.addHook('onClose', async () => {
    if (scheduledRunPoller) {
      clearInterval(scheduledRunPoller);
      scheduledRunPoller = null;
    }
    await backgroundServicesPromise?.catch(() => undefined);
    await stopPlaywrightMcpSidecar();
    await runService.drainBackgroundWork();
    await storage.close();
  });

  return { app, ctx, startBackgroundServices };
}

export async function startServer(): Promise<void> {
  const { app, ctx, startBackgroundServices } = await buildApp();

  // Guard against uncaught exceptions / unhandled rejections that would otherwise
  // crash the process silently with exit code 1.
  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'uncaughtException: server kept alive');
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'unhandledRejection: server kept alive');
  });

  try {
    await app.listen({ host: ctx.config.host, port: ctx.config.port });
    await startBackgroundServices();
    app.log.info({ host: ctx.config.host, port: ctx.config.port }, 'risk-agent server listening');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Normalize Windows paths before comparing entrypoint URLs.
// Embedded runtimes can leave process.argv[1] empty during module import.
// pathToFileURL keeps Linux absolute paths from becoming file:////app/... URLs.
import { pathToFileURL } from 'node:url';
const _mainArg = process.argv[1]?.replace(/\\/g, '/');
const _mainUrl = _mainArg ? pathToFileURL(_mainArg).href : undefined;
const _selfUrl = new URL(import.meta.url).href;
if (_mainUrl === _selfUrl || _mainArg?.endsWith('/packages/server/src/index.ts')) {
  startServer();
}


