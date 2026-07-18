/**
 * backend.ts — 内嵌 Fastify 服务器启动与数据目录初始化
 *
 * 职责（desktop-app.md §2.1、§4、§7）：
 *  - 启动 Fastify HTTP 服务（随机端口，绑定 127.0.0.1）
 *  - 初始化本地数据目录（data/config/logs/exports 子目录 + 默认 storage.json）
 *  - 生成 safeStorage 加密后的 API Key 存储支持（§6）
 */
import { app as electronApp } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserHostAdapter } from '@risk-agent/core/browser-host';

type EmbeddedBuildAppOptions = {
  dataDir?: string;
  host?: string;
  port?: number;
  browserHostAdapter?: BrowserHostAdapter | null;
};

type BuildAppModule = {
  buildApp: (options?: EmbeddedBuildAppOptions) => Promise<{
    app: {
      listen(options: { host: string; port: number }): Promise<unknown>;
      close(): Promise<unknown>;
      server: {
        address(): { port?: number } | string | null;
      };
    };
    startBackgroundServices(): Promise<void>;
  }>;
};
type ServerModuleLoader = () => Promise<BuildAppModule>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appInstance: any = null;
let _dataDir: string = '';

const nativeServerModuleLoader = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<BuildAppModule>;

let serverModuleLoader: ServerModuleLoader = () => nativeServerModuleLoader('@risk-agent/server');

export function __setServerModuleLoaderForTests(loader?: ServerModuleLoader): void {
  serverModuleLoader = loader ?? (() => nativeServerModuleLoader('@risk-agent/server'));
}

function importServerModule(): Promise<BuildAppModule> {
  return serverModuleLoader();
}

function resolveWebDistDir(): string | undefined {
  const candidates = [
    process.env.RISK_AGENT_WEB_DIST_DIR,
    typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? join(process.resourcesPath, 'web-dist')
      : undefined,
    resolve(__dirname, '../../web-dist'),
    resolve(__dirname, '../../web/dist'),
    resolve(process.cwd(), 'packages/web/dist'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * 启动内嵌 Fastify 服务器。
 * @returns 已监听的端口号和数据目录路径
 */
export async function startEmbeddedServer(options?: { browserHostAdapter?: BrowserHostAdapter | null }): Promise<{ port: number; dataDir: string }> {
  _dataDir = process.env.RISK_AGENT_DATA_DIR ?? join(electronApp.getPath('userData'), 'risk_agent_data');
  const webDistDir = resolveWebDistDir();
  if (webDistDir) {
    process.env.RISK_AGENT_WEB_DIST_DIR = webDistDir;
  }

  // Point Playwright to a writable directory so users can install browser binaries
  // via `npx playwright install chromium` even in the packaged desktop app.
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(_dataDir, 'playwright-browsers');
  }

  const { buildApp } = await importServerModule();
  const { app, startBackgroundServices } = await buildApp({
    dataDir: _dataDir,
    host: '127.0.0.1',
    port: 0,
    browserHostAdapter: options?.browserHostAdapter ?? null,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  await startBackgroundServices();
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr && typeof addr.port === 'number' ? addr.port : 4100;
  appInstance = app;
  return { port, dataDir: _dataDir };
}

export async function shutdownEmbeddedServer(): Promise<void> {
  if (appInstance) {
    await appInstance.close();
    appInstance = null;
  }
}

/**
 * initDataDirectory — 初始化数据目录结构（desktop-app.md §4）。
 *
 * 创建以下子目录（已存在则跳过）：
 *   data/          主数据存储（SQLite、LanceDB、Graphology 等）
 *   data/objects/reports/   报告文件（Markdown/HTML/PDF/JSON）
 *   data/objects/uploads/   导入文件缓存
 *   data/objects/snapshots/ 快照归档
 *   config/        应用配置（app.json / storage.json / mcp-servers.json 等）
 *   logs/          日志文件
 *   exports/       导出目录
 *   exports/reports/ 导出报告
 *
 * 同时写入默认 storage.json（若不存在，§7.1）。
 */
export async function initDataDirectory(dataDir: string): Promise<void> {
  const dirs = [
    join(dataDir, 'data'),
    join(dataDir, 'data', 'lance'),
    join(dataDir, 'data', 'graph'),
    join(dataDir, 'data', 'objects', 'reports'),
    join(dataDir, 'data', 'objects', 'uploads'),
    join(dataDir, 'data', 'objects', 'snapshots'),
    join(dataDir, 'config'),
    join(dataDir, 'logs'),
    join(dataDir, 'exports', 'reports'),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // 写入默认 storage.json（§7.1）
  const storageConfigPath = join(dataDir, 'config', 'storage.json');
  const storageExists = await access(storageConfigPath).then(() => true).catch(() => false);
  if (!storageExists) {
    const defaultStorage = {
      structured: { backend: 'sqlite' },
      vector: { backend: 'lancedb' },
      graph: { backend: 'graphology' },
      object: { backend: 'local' }
    };
    await writeFile(storageConfigPath, JSON.stringify(defaultStorage, null, 2), 'utf8');
  }

  // 写入默认 app.json（若不存在）
  const appConfigPath = join(dataDir, 'config', 'app.json');
  const appConfigExists = await access(appConfigPath).then(() => true).catch(() => false);
  if (!appConfigExists) {
    const { version } = await getPackageVersion();
    const defaultAppConfig = {
      version,
      locale: 'zh-CN',
      reportLocale: 'zh-CN',
      theme: 'dark',
      createdAt: new Date().toISOString(),
    };
    await writeFile(appConfigPath, JSON.stringify(defaultAppConfig, null, 2), 'utf8');
  }
}

/**
 * 读取 desktop package.json 的 version 字段。
 * 用于写入 app.json 版本号（避免硬编码）。
 */
async function getPackageVersion(): Promise<{ version: string }> {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return { version: pkg.version ?? '0.1.0' };
  } catch {
    return { version: '0.1.0' };
  }
}

