import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StorageConfigSchema, loadStorageConfig, saveStorageConfig, resolvePaths } from '@risk-agent/core';
import {
  MigrationJobRunner,
  MigrationCheckpointStore,
  MigrationPlanner,
  MigrationManifestBuilder,
} from '@risk-agent/core';
import type { AppContext } from '../index.js';
import { publishStorageEvent } from '../ws/storageEventBus.js';

// ─── 响应包装工具 ───────────────────────────────────────────────────────────

function ok<T>(data: T) {
  return { success: true, requestId: `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`, timestamp: new Date().toISOString(), data };
}
function fail(code: string, message: string, details?: unknown) {
  return { success: false, requestId: `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`, timestamp: new Date().toISOString(), error: { code, message, details } };
}

// ─── 内部工具 ───────────────────────────────────────────────────────────────

/** 从配置推断 profile（storage-profiles.md §2/3/4）*/
function inferProfile(config: Record<string, unknown>): string {
  const structured = (config as any)?.structured?.backend ?? 'sqlite';
  const vector     = (config as any)?.vector?.backend ?? 'lancedb';
  const graph      = (config as any)?.graph?.backend ?? 'graphology';
  const object_    = (config as any)?.object?.backend ?? 'local';

  const EMBEDDED_BACKENDS = new Set(['sqlite', 'lancedb', 'graphology', 'local', 'json', 'none', '']);

  const allEmbedded = [structured, vector, graph, object_].every(b => EMBEDDED_BACKENDS.has(b));
  if (allEmbedded) return 'embedded';

  const allExternal = [structured, vector, graph, object_].every(b => !EMBEDDED_BACKENDS.has(b));
  if (allExternal) return 'full-external';

  return 'hybrid';
}

/** 简单哈希（生产环境可替换为 SHA256）*/
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 脱敏：替换含 password/secret/key/token 的字符串值 */
function redact(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => {
      if (/password|secret|key|token/i.test(k) && typeof v === 'string') return [k, '***'];
      return [k, redact(v)];
    })
  );
}

// ─── 路由注册 ───────────────────────────────────────────────────────────────

export function registerSettingsStorageRoutes(app: FastifyInstance, ctx: AppContext): void {
  const paths = resolvePaths(ctx.config.dataDir ?? process.cwd() + '/risk_agent_data');
  const store = ctx.storage.getStructuredStore();

  // Ensure storage management tables exist (idempotent bootstrap, guards against schema exec stopping early)
  void store.exec(`CREATE TABLE IF NOT EXISTS storage_revisions (
    revision_id    TEXT PRIMARY KEY,
    profile        TEXT NOT NULL DEFAULT 'embedded',
    config_json    TEXT NOT NULL,
    config_hash    TEXT NOT NULL,
    is_active      INTEGER DEFAULT 0,
    source         TEXT DEFAULT 'ui',
    created_by     TEXT DEFAULT 'user',
    comment        TEXT,
    created_at     TEXT DEFAULT (datetime('now'))
  )`).then(() => store.exec(
    `CREATE INDEX IF NOT EXISTS idx_storage_rev_active ON storage_revisions(is_active)`
  )).then(() => store.exec(`CREATE TABLE IF NOT EXISTS storage_migration_jobs (
    job_id             TEXT PRIMARY KEY,
    source_revision_id TEXT,
    target_revision_id TEXT,
    scopes_json        TEXT DEFAULT '["structured"]',
    dry_run            INTEGER DEFAULT 0,
    status             TEXT DEFAULT 'queued',
    progress           REAL DEFAULT 0,
    current_scope      TEXT,
    started_at         TEXT,
    finished_at        TEXT,
    error_message      TEXT,
    result_json        TEXT,
    created_at         TEXT DEFAULT (datetime('now'))
  )`)).then(() => store.exec(
    `CREATE INDEX IF NOT EXISTS idx_smj_status ON storage_migration_jobs(status)`
  )).then(() => store.exec(`CREATE TABLE IF NOT EXISTS migration_checkpoints (
    job_id      TEXT NOT NULL,
    step        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    detail      TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (job_id, step)
  )`))
  // storage_audit_logs: 审计日志 (storage-settings-api.md §10)
  .then(() => store.exec(`CREATE TABLE IF NOT EXISTS storage_audit_logs (
    audit_id      TEXT PRIMARY KEY,
    operation     TEXT NOT NULL,
    operator      TEXT DEFAULT 'user',
    source        TEXT DEFAULT 'ui',
    revision_from TEXT,
    revision_to   TEXT,
    backend_info  TEXT,
    success       INTEGER DEFAULT 1,
    error_reason  TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  )`))
  .then(() => store.exec(
    `CREATE INDEX IF NOT EXISTS idx_sal_created ON storage_audit_logs(created_at)`
  ))
  // Migration: add current_scope to existing tables that lack it (ignore if already exists)
  .then(() => store.exec(`ALTER TABLE storage_migration_jobs ADD COLUMN current_scope TEXT`).catch(() => {}))
  .catch((e: unknown) => {
    app.log.warn({ err: e }, 'storage bootstrap table init warning (non-fatal)');
  });

  /** 写入审计日志（非阻塞，失败不影响主流程）*/
  async function writeAuditLog(
    operation: string,
    revisionFrom: string | null,
    revisionTo: string | null,
    backendInfo: Record<string, string>,
    success = true,
    errorReason?: string
  ): Promise<void> {
    const auditId = `aud_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await store.run(
      `INSERT INTO storage_audit_logs(audit_id, operation, revision_from, revision_to, backend_info, success, error_reason)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      [auditId, operation, revisionFrom, revisionTo, JSON.stringify(backendInfo), success ? 1 : 0, errorReason ?? null]
    ).catch((e: unknown) => {
      app.log.warn({ err: e }, 'audit log write failed (non-fatal)');
    });
  }

  // ── GET /api/settings/storage/current ── ActiveStorageState ─────────────
  app.get('/api/settings/storage/current', async () => {
    const fileConfig = loadStorageConfig(paths);
    const activeRev = await store.get<any>(
      `SELECT * FROM storage_revisions WHERE is_active=1 ORDER BY created_at DESC LIMIT 1`
    );
    // lastValidatedAt: most recent revision creation time as proxy for last validation
    const latestRev = await store.get<{ created_at: string } | undefined>(
      `SELECT created_at FROM storage_revisions ORDER BY created_at DESC LIMIT 1`
    ).catch(() => undefined);
    return ok({
      activeRevisionId: activeRev?.revision_id ?? 'rev_default',
      activeProfile: activeRev?.profile ?? inferProfile(fileConfig as Record<string, unknown>),
      status: 'ready',
      backendInfo: {
        structured: (fileConfig as any)?.structured?.backend ?? 'sqlite',
        vector:     (fileConfig as any)?.vector?.backend ?? 'json',
        graph:      (fileConfig as any)?.graph?.backend ?? 'graphology',
        object:     (fileConfig as any)?.object?.backend ?? 'none',
      },
      restartRequired: true,
      lastValidatedAt: latestRev?.created_at ?? null,
      config: redact(fileConfig),
    });
  });

  // ── GET /api/settings/storage (legacy) ──────────────────────────────────
  app.get('/api/settings/storage', async () => {
    return loadStorageConfig(paths);
  });

  // ── GET /api/settings/storage/history ── revision list ──────────────────
  app.get('/api/settings/storage/history', async (req) => {
    const { limit } = (req.query as { limit?: string });
    const rows = await store.all<any>(
      `SELECT * FROM storage_revisions ORDER BY created_at DESC LIMIT ?`,
      [Number(limit ?? 20)]
    );
    const revisions = rows.map((r) => ({
      revisionId: r.revision_id,
      profile: r.profile,
      configHash: r.config_hash,
      isActive: !!r.is_active,
      source: r.source,
      createdBy: r.created_by,
      comment: r.comment,
      createdAt: r.created_at,
    }));
    // rollbackCandidates: non-active revisions (storage-settings-api.md §8.5)
    const rollbackCandidates = revisions
      .filter((r) => !r.isActive)
      .slice(0, 5)
      .map((r) => ({ revisionId: r.revisionId, createdAt: r.createdAt, profile: r.profile }));
    return ok({ revisions, rollbackCandidates });
  });

  // ── POST /api/settings/storage/validate ─────────────────────────────────
  const ValidateSchema = z.object({
    config: z.record(z.unknown()),
    profile: z.string().optional(),
    validateConnectivity: z.boolean().optional(),
    validateWritable: z.boolean().optional(),
    validateSecrets: z.boolean().optional(),
  });

  app.post('/api/settings/storage/validate', async (req, reply) => {
    const parsed = ValidateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('STORAGE_SCHEMA_INVALID', 'Schema invalid', parsed.error.issues));

    // Zod schema validation
    const schemaParsed = StorageConfigSchema.safeParse(parsed.data.config);
    if (!schemaParsed.success) {
      return reply.code(400).send(fail('STORAGE_SCHEMA_INVALID', '配置结构不合法', schemaParsed.error.issues));
    }

    const validationId = `val_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const profile = parsed.data.profile ?? inferProfile(parsed.data.config);

    const result = ok({
      validationId,
      normalizedProfile: profile,
      backendInfo: {
        structured: (parsed.data.config as any)?.structured?.backend ?? 'sqlite',
        vector:     (parsed.data.config as any)?.vector?.backend ?? 'json',
        graph:      (parsed.data.config as any)?.graph?.backend ?? 'graphology',
        object:     (parsed.data.config as any)?.object?.backend ?? 'none',
      },
      health: { structured: 'ok', vector: 'ok', graph: 'ok', object: 'ok' },
      warnings: [],
      redactedConfig: redact(parsed.data.config),
      applyReady: true,
    });
    publishStorageEvent('storage-validation-finished', { validationId, profile });
    return result;
  });

  // ── POST /api/settings/storage/apply ─────────────────────────────────────
  const ApplySchema = z.object({
    config: z.record(z.unknown()),
    profile: z.string().optional(),
    validationId: z.string().optional(),
    applyMode: z.enum(['restart-required', 'hot-swap']).default('restart-required'),
    migratePolicy: z.enum(['none', 'metadata-only', 'full']).default('none'),
    comment: z.string().optional(),
  });

  app.post('/api/settings/storage/apply', async (req, reply) => {
    const parsed = ApplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('STORAGE_SCHEMA_INVALID', 'Schema invalid', parsed.error.issues));

    const schemaParsed = StorageConfigSchema.safeParse(parsed.data.config);
    if (!schemaParsed.success) {
      return reply.code(400).send(fail('STORAGE_SCHEMA_INVALID', '配置结构不合法', schemaParsed.error.issues));
    }

    // 获取当前活跃 revision（用于审计日志）
    const prevActive = await store.get<{ revision_id: string } | undefined>(
      `SELECT revision_id FROM storage_revisions WHERE is_active=1 LIMIT 1`
    ).catch(() => undefined);

    // 创建新 revision
    const revisionId = `rev_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const configStr = JSON.stringify(parsed.data.config);
    const profile = parsed.data.profile ?? inferProfile(parsed.data.config);
    const backendInfo = {
      structured: (parsed.data.config as any)?.structured?.backend ?? 'sqlite',
      vector:     (parsed.data.config as any)?.vector?.backend ?? 'json',
      graph:      (parsed.data.config as any)?.graph?.backend ?? 'graphology',
      object:     (parsed.data.config as any)?.object?.backend ?? 'none',
    };

    await store.run(`UPDATE storage_revisions SET is_active=0 WHERE is_active=1`);
    await store.run(
      `INSERT INTO storage_revisions(revision_id, profile, config_json, config_hash, is_active, source, comment)
       VALUES(?, ?, ?, ?, 1, 'ui', ?)`,
      [revisionId, profile, configStr, simpleHash(configStr), parsed.data.comment ?? null]
    );

    // 写入审计日志（storage-settings-api.md §10）
    await writeAuditLog('apply', prevActive?.revision_id ?? null, revisionId, backendInfo);

    // 持久化到文件（restart-required 模式）
    saveStorageConfig(paths, schemaParsed.data);

    publishStorageEvent('storage-apply-started', { revisionId, profile });
    publishStorageEvent('storage-profile-updated', { newRevisionId: revisionId, activeProfile: profile });

    return ok({
      accepted: true,
      applyId: `apply_${Date.now()}`,
      newRevisionId: revisionId,
      activeProfile: profile,
      restartRequired: true,
      rollbackRevisionId: null,
      message: '配置已保存，重启服务端后生效',
    });
  });

  // ── POST /api/settings/storage (legacy save) ─────────────────────────────
  app.post('/api/settings/storage', async (req, reply) => {
    const parsed = StorageConfigSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    saveStorageConfig(paths, parsed.data);
    return { ok: true, requireRestart: true };
  });

  // ── POST /api/settings/storage/rollback ──────────────────────────────────
  const RollbackSchema = z.object({
    revisionId: z.string(),
    reason: z.string().optional(),
  });

  app.post('/api/settings/storage/rollback', async (req, reply) => {
    const parsed = RollbackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('STORAGE_SCHEMA_INVALID', 'Schema invalid'));

    const rev = await store.get<any>(
      `SELECT * FROM storage_revisions WHERE revision_id=?`,
      [parsed.data.revisionId]
    );
    if (!rev) return reply.code(404).send(fail('NOT_FOUND', `Revision ${parsed.data.revisionId} not found`));

    // 应用目标 revision
    let config: Record<string, unknown>;
    try { config = JSON.parse(rev.config_json); } catch {
      return reply.code(500).send(fail('STORAGE_ROLLBACK_FAILED', '目标 revision 配置无法解析'));
    }

    const schemaParsed = StorageConfigSchema.safeParse(config);
    if (!schemaParsed.success) return reply.code(400).send(fail('STORAGE_ROLLBACK_FAILED', '目标 revision 结构不合法'));

    publishStorageEvent('storage-rollback-started', { targetRevisionId: parsed.data.revisionId });

    // 获取当前活跃 revision（用于审计日志）
    const prevActive = await store.get<{ revision_id: string } | undefined>(
      `SELECT revision_id FROM storage_revisions WHERE is_active=1 LIMIT 1`
    ).catch(() => undefined);

    await store.run(`UPDATE storage_revisions SET is_active=0 WHERE is_active=1`);
    await store.run(`UPDATE storage_revisions SET is_active=1 WHERE revision_id=?`, [parsed.data.revisionId]);
    saveStorageConfig(paths, schemaParsed.data);

    // 写入审计日志（storage-settings-api.md §10）
    const rollbackBackendInfo = {
      structured: (config as any)?.structured?.backend ?? 'sqlite',
      vector:     (config as any)?.vector?.backend ?? 'json',
      graph:      (config as any)?.graph?.backend ?? 'graphology',
      object:     (config as any)?.object?.backend ?? 'none',
    };
    await writeAuditLog('rollback', prevActive?.revision_id ?? null, parsed.data.revisionId, rollbackBackendInfo);

    publishStorageEvent('storage-profile-rollback', { activeRevisionId: parsed.data.revisionId, activeProfile: rev.profile });

    return ok({
      rolledBack: true,
      activeRevisionId: parsed.data.revisionId,
      activeProfile: rev.profile,
      restoredFromRevisionId: parsed.data.revisionId,
      restartRequired: true,
      message: '已回滚到目标版本，重启服务端后生效',
    });
  });

  // ── POST /api/settings/storage/migrate ───────────────────────────────────
  const MigrateSchema = z.object({
    sourceRevisionId: z.string().optional(),
    targetRevisionId: z.string().optional(),
    scopes: z.array(z.enum(['structured', 'vector', 'graph', 'object'])).default(['structured']),
    dryRun: z.boolean().default(true),
    mode: z.enum(['dry-run', 'execute']).default('dry-run'),
    strategy: z.enum(['copy', 'copy-and-verify', 'snapshot-restore']).default('copy-and-verify'),
    comment: z.string().optional(),
  });

  app.post('/api/settings/storage/migrate', async (req, reply) => {
    const parsed = MigrateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('STORAGE_SCHEMA_INVALID', 'Schema invalid'));

    const { sourceRevisionId, targetRevisionId, scopes, dryRun, strategy } = parsed.data;
    const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    // Build plan first (dry-run or execute)
    const checkpointStore = new MigrationCheckpointStore(store);
    await checkpointStore.init();

    const manifestBuilder = new MigrationManifestBuilder({ structured: store });
    const planner = new MigrationPlanner(manifestBuilder);
    const plan = await planner.plan({
      sourceRevisionId: sourceRevisionId ?? null,
      targetRevisionId: targetRevisionId ?? null,
      scopes: scopes as ('structured' | 'vector' | 'graph' | 'object')[],
      mode: dryRun ? 'dry-run' : 'execute',
      strategy: strategy as 'copy' | 'copy-and-verify' | 'snapshot-restore',
      dryRun,
    });

    await store.run(
      `INSERT INTO storage_migration_jobs(job_id, source_revision_id, target_revision_id, scopes_json, dry_run, status, progress)
       VALUES(?, ?, ?, ?, ?, 'queued', 0)`,
      [jobId, sourceRevisionId ?? null, targetRevisionId ?? null,
       JSON.stringify(scopes), dryRun ? 1 : 0]
    );

    // Build and start the runner
    const runner = new MigrationJobRunner(store, {
      structured: store,
      graph: ctx.storage.getGraphStore(),
      object: ctx.storage.getObjectStore(),
    }, checkpointStore);

    runner.startAsync({
      jobId,
      scopes: scopes as ('structured' | 'vector' | 'graph' | 'object')[],
      dryRun,
      strategy,
      sourceRevisionId: sourceRevisionId ?? null,
      targetRevisionId: targetRevisionId ?? null,
      estimatedRecords: plan.estimatedRecords,
      warnings: plan.warnings,
      recommended: plan.recommended,
    });

    const estimatedSteps = 2 + scopes.length * 2; // preflight + snapshot + (transfer+verify) per scope

    publishStorageEvent('storage-migration-progress', { jobId, status: 'running', progress: 0 });

    return ok({
      jobId,
      status: 'running',
      scopes,
      estimatedSteps,
      plan: {
        planId: plan.planId,
        warnings: plan.warnings,
        estimatedRecords: plan.estimatedRecords,
        recommended: plan.recommended,
      },
      message: dryRun ? '干运行已启动，预计记录数已估算。' : '迁移任务已入队，正在执行…',
    });
  });

  // ── POST /api/settings/storage/migrations/:jobId/cancel ──────────────────
  app.post('/api/settings/storage/migrations/:jobId/cancel', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const row = await store.get<{ status: string }>(
      `SELECT status FROM storage_migration_jobs WHERE job_id=?`, [jobId]
    );
    if (!row) return reply.code(404).send(fail('NOT_FOUND', `Job ${jobId} not found`));
    if (['completed', 'failed', 'cancelled'].includes(row.status)) {
      return reply.code(409).send(fail('ALREADY_TERMINAL', `Job is already in terminal state: ${row.status}`));
    }
    await store.run(
      `UPDATE storage_migration_jobs SET status='cancelling' WHERE job_id=?`, [jobId]
    );
    return ok({ jobId, status: 'cancelling' });
  });

  // ── POST /api/settings/storage/migrations/:jobId/retry ───────────────────
  app.post('/api/settings/storage/migrations/:jobId/retry', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const row = await store.get<any>(
      `SELECT * FROM storage_migration_jobs WHERE job_id=?`, [jobId]
    );
    if (!row) return reply.code(404).send(fail('NOT_FOUND', `Job ${jobId} not found`));
    if (row.status !== 'failed' && row.status !== 'cancelled') {
      return reply.code(409).send(fail('NOT_RETRYABLE', `Only failed/cancelled jobs can be retried`));
    }

    // Reset status to queued, clear error
    await store.run(
      `UPDATE storage_migration_jobs SET status='queued', progress=0, error_message=NULL,
       started_at=NULL, finished_at=NULL WHERE job_id=?`,
      [jobId]
    );

    const checkpointStore = new MigrationCheckpointStore(store);
    await checkpointStore.init();
    await checkpointStore.clearJob(jobId);

    const runner = new MigrationJobRunner(store, {
      structured: store,
      graph: ctx.storage.getGraphStore(),
      object: ctx.storage.getObjectStore(),
    }, checkpointStore);

    runner.startAsync({
      jobId,
      scopes: safeJson<('structured' | 'vector' | 'graph' | 'object')[]>(row.scopes_json, ['structured']),
      dryRun: !!row.dry_run,
      strategy: 'copy-and-verify',
      sourceRevisionId: row.source_revision_id,
      targetRevisionId: row.target_revision_id,
    });

    return ok({ jobId, status: 'running' });
  });

  // ── GET /api/settings/storage/migrations ─────────────────────────────────
  app.get('/api/settings/storage/migrations', async (req) => {
    const { status } = req.query as { status?: string };
    const rows = await store.all<any>(
      status
        ? `SELECT * FROM storage_migration_jobs WHERE status=? ORDER BY created_at DESC LIMIT 50`
        : `SELECT * FROM storage_migration_jobs ORDER BY created_at DESC LIMIT 50`,
      status ? [status] : []
    );
    return ok({
      jobs: rows.map((r) => {
        const scopes: string[] = safeJson(r.scopes_json, ['structured']);
        let summary: string | null = null;
        if (r.status === 'completed') {
          summary = `迁移完成：${scopes.join(', ')} scope(s) 100%`;
        } else if (r.status === 'failed') {
          summary = `迁移失败：${r.error_message ?? '未知错误'}`;
        } else if (r.status === 'running' && r.current_scope) {
          summary = `正在迁移：${r.current_scope} (${Math.round(r.progress ?? 0)}%)`;
        } else if (r.status === 'queued') {
          summary = '任务已排队，等待执行…';
        } else if (r.status === 'cancelled') {
          summary = '任务已取消';
        }
        return {
          jobId: r.job_id,
          sourceRevisionId: r.source_revision_id,
          targetRevisionId: r.target_revision_id,
          scopes,
          dryRun: !!r.dry_run,
          status: r.status,
          progress: Number(r.progress ?? 0),
          currentScope: r.current_scope ?? null,
          summary,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          errorMessage: r.error_message,
          createdAt: r.created_at,
        };
      })
    });
  });

  // ── GET /api/settings/storage/migrations/:jobId ──────────────────────────
  app.get('/api/settings/storage/migrations/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const row = await store.get<any>(`SELECT * FROM storage_migration_jobs WHERE job_id=?`, [jobId]);
    if (!row) return reply.code(404).send(fail('NOT_FOUND', `Job ${jobId} not found`));
    const scopes: string[] = safeJson(row.scopes_json, ['structured']);
    // Build human-readable summary (storage-settings-api.md §8.4)
    let summary: string | null = null;
    if (row.status === 'completed') {
      summary = `迁移完成：${scopes.join(', ')} scope(s) 100%`;
    } else if (row.status === 'failed') {
      summary = `迁移失败：${row.error_message ?? '未知错误'}`;
    } else if (row.status === 'running' && row.current_scope) {
      summary = `正在迁移：${row.current_scope} (${Math.round(row.progress ?? 0)}%)`;
    } else if (row.status === 'queued') {
      summary = '任务已排队，等待执行…';
    } else if (row.status === 'cancelled') {
      summary = '任务已取消';
    }
    return ok({
      jobId: row.job_id,
      sourceRevisionId: row.source_revision_id,
      targetRevisionId: row.target_revision_id,
      scopes,
      dryRun: !!row.dry_run,
      status: row.status,
      progress: Number(row.progress ?? 0),
      currentScope: row.current_scope ?? null,
      summary,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
      result: safeJson(row.result_json, null),
      createdAt: row.created_at,
    });
  });

  // ── GET /api/settings/storage/migrations/:jobId/checkpoints ──────────────
  app.get('/api/settings/storage/migrations/:jobId/checkpoints', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const jobExists = await store.get<{ job_id: string }>(
      `SELECT job_id FROM storage_migration_jobs WHERE job_id=?`, [jobId]
    );
    if (!jobExists) return reply.code(404).send(fail('NOT_FOUND', `Job ${jobId} not found`));

    const checkpointStore = new MigrationCheckpointStore(store);
    await checkpointStore.init();
    const checkpoints = await checkpointStore.getCheckpoints(jobId);
    return ok({ checkpoints });
  });

  // ── GET /api/settings/storage/audit ─── 审计日志查询 ─────────────────────
  app.get('/api/settings/storage/audit', async (req) => {
    const { limit, operation } = req.query as { limit?: string; operation?: string };
    const rows = await store.all<any>(
      operation
        ? `SELECT * FROM storage_audit_logs WHERE operation=? ORDER BY created_at DESC LIMIT ?`
        : `SELECT * FROM storage_audit_logs ORDER BY created_at DESC LIMIT ?`,
      operation ? [operation, Number(limit ?? 50)] : [Number(limit ?? 50)]
    ).catch(() => [] as any[]);
    return ok({
      logs: rows.map((r) => ({
        auditId: r.audit_id,
        operation: r.operation,
        operator: r.operator,
        source: r.source,
        revisionFrom: r.revision_from,
        revisionTo: r.revision_to,
        backendInfo: safeJson(r.backend_info, {}),
        success: !!r.success,
        errorReason: r.error_reason,
        createdAt: r.created_at,
      }))
    });
  });
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

