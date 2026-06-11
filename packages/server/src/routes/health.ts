/**
 * health.ts — 健康检查端点（server-deployment.md §7）
 *
 * GET /health      — 主路径（doc 规范，Nginx + Docker HEALTHCHECK 使用）
 * GET /api/health  — 兼容路径（保持向后兼容）
 *
 * 返回格式：
 *   status:        "ok" | "degraded"
 *   version:       package.json 版本号
 *   uptime:        进程运行秒数
 *   database:      "ok" | "error"
 *   vectorStore:   "ok" | "error"
 *   graphStore:    "ok" | "error"
 *   objectStore:   "ok" | "error"
 *   storageProfile: "embedded" | "hybrid" | "full-external" | ...
 *   dataSources:   { healthy, degraded, unhealthy }
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 读取 server package.json 中的 version 字段 */
function readVersion(): string {
  try {
    const candidates = [
      join(__dirname, '..', '..', 'package.json'),
      join(__dirname, '..', 'package.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8')) as { version?: string };
        return pkg.version ?? '0.1.0';
      }
    }
  } catch { /* ignore */ }
  return '0.1.0';
}

/** 推断存储配置 profile 名称 */
function resolveStorageProfile(ctx: AppContext): string {
  // 优先使用环境变量显式声明
  if (process.env.RISK_AGENT_STORAGE_PROFILE) {
    return process.env.RISK_AGENT_STORAGE_PROFILE;
  }
  try {
    const c = ctx.storage.config;
    const embeddedBackends = new Set(['sqlite', 'lancedb', 'graphology', 'local', '']);
    const backends = [
      c.structured?.backend,
      c.vector?.backend,
      c.graph?.backend,
      c.object?.backend,
    ];
    if (backends.every(b => !b || embeddedBackends.has(b))) return 'embedded';
    if (backends.every(b => b && !embeddedBackends.has(b))) return 'full-external';
    return 'hybrid';
  } catch { /* ignore */ }
  return 'embedded';
}

const APP_VERSION = readVersion();

export function registerHealthRoute(app: FastifyInstance, ctx: AppContext): void {
  /** 构建完整健康状态 payload */
  async function buildHealthPayload() {
    const store = ctx.storage.getStructuredStore();

    // ── Database (SQLite) ─────────────────────────────────────
    let database: 'ok' | 'error' = 'ok';
    try {
      await store.get('SELECT 1 as ping');
    } catch {
      database = 'error';
    }

    // ── Vector Store (LanceDB) ────────────────────────────────
    let vectorStore: 'ok' | 'error' = 'ok';
    try {
      ctx.storage.getVectorStore(); // throws if not initialized
    } catch {
      vectorStore = 'error';
    }

    // ── Graph Store (Graphology) ──────────────────────────────
    let graphStore: 'ok' | 'error' = 'ok';
    try {
      ctx.storage.getGraphStore();
    } catch {
      graphStore = 'error';
    }

    // ── Object Store (LocalFS) ────────────────────────────────
    let objectStore: 'ok' | 'error' = 'ok';
    try {
      ctx.storage.getObjectStore();
    } catch {
      objectStore = 'error';
    }

    // ── Data Sources 计数 ─────────────────────────────────────
    let dsHealthy = 0, dsDegraded = 0, dsUnhealthy = 0;
    try {
      const rows = await store.all<{ enabled: number; status?: string }>(
        'SELECT enabled, status FROM data_sources'
      );
      for (const r of rows) {
        if (r.status === 'degraded') { dsDegraded++; continue; }
        if (r.status === 'unhealthy' || r.enabled === 0) { dsUnhealthy++; continue; }
        dsHealthy++;
      }
    } catch { /* table may not exist in minimal deployments */ }

    // ── 综合状态 ──────────────────────────────────────────────
    const allOk = [database, vectorStore, graphStore, objectStore].every(s => s === 'ok');
    const status = allOk ? 'ok' : 'degraded';

    return {
      status,
      version: APP_VERSION,
      uptime: Math.floor(process.uptime()),
      database,
      vectorStore,
      graphStore,
      objectStore,
      storageProfile: resolveStorageProfile(ctx),
      dataSources: {
        healthy: dsHealthy,
        degraded: dsDegraded,
        unhealthy: dsUnhealthy,
      },
    };
  }

  // 主路径（server-deployment.md §7，Docker HEALTHCHECK / Nginx 探针使用）
  app.get('/health', async () => buildHealthPayload());

  // 兼容路径
  app.get('/api/health', async () => buildHealthPayload());
}
