/**
 * Security API Routes — 安全审计日志 + 沙盒配置查询（模块10 §7）
 *
 * GET /api/security/audit         — 查询安全审计事件
 * GET /api/security/config        — 查询沙盒与 Sub-Agent 安全配置
 * PUT /api/security/subagent      — 更新 Sub-Agent 安全配置（持久化到 preferences 表）
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SecurityAuditService, type SecurityEventType } from '@risk-agent/core';
import type { AppContext } from '../index.js';
import { SANDBOX_TIMEOUT_MS, MAX_RESULT_SIZE, SANDBOX_FORBIDDEN_CODE_PATTERNS } from '@risk-agent/core';
import { SUB_AGENT_SECURITY } from '@risk-agent/core';

/** 按需初始化审计服务（单例，挂载到 app 实例） */
function getAuditService(ctx: AppContext): SecurityAuditService {
  const store = ctx.storage.getStructuredStore();
  // 包装成 AuditDb 接口
  const db = {
    exec: (sql: string) => store.exec(sql),
    run: (sql: string, params: unknown[]) => store.run(sql, params),
    all: <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params ?? []),
  };
  return new SecurityAuditService(db);
}

const SubAgentConfigSchema = z.object({
  maxSteps: z.number().int().min(1).max(50).optional(),
  compactThresholdTokens: z.number().int().min(1_000).max(200_000).optional(),
  toolExecutionTimeoutMs: z.number().int().min(5_000).max(600_000).optional(),
  totalTimeoutMs: z.number().int().min(10_000).max(1_800_000).optional(),
  forbiddenCapabilities: z.array(z.string()).optional(),
  allowedToolNames: z.array(z.string()).optional(),
});

const SUBAGENT_PREF_KEY = 'subAgentSecurityOverride';

export function registerSecurityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();
  let auditSvc: SecurityAuditService | null = null;

  function svc() {
    if (!auditSvc) auditSvc = getAuditService(ctx);
    return auditSvc;
  }

  async function loadSubAgentOverride(): Promise<Partial<typeof SUB_AGENT_SECURITY>> {
    const rows = await store.all<{ pref_value: string }>(
      `SELECT pref_value FROM preferences WHERE pref_key = ?`,
      [SUBAGENT_PREF_KEY]
    );
    if (!rows.length) return {};
    try { return JSON.parse(rows[0].pref_value) as Partial<typeof SUB_AGENT_SECURITY>; }
    catch { return {}; }
  }

  // ── GET /api/security/audit ─── 查询安全审计事件 ──────────────────────────
  app.get<{
    Querystring: { eventType?: string; limit?: string; since?: string }
  }>('/api/security/audit', async (req) => {
    const { eventType, limit, since } = req.query;
    const events = await svc().query({
      eventType: eventType as SecurityEventType | undefined,
      limit: limit ? Number(limit) : 100,
      since: since ? Number(since) : undefined,
    });
    return { success: true, data: events };
  });

  // ── GET /api/security/config ─── 查询沙盒与安全配置 ──────────────────────
  app.get('/api/security/config', async () => {
    const override = await loadSubAgentOverride();
    return {
      success: true,
      data: {
        sandbox: {
          timeoutMs: SANDBOX_TIMEOUT_MS,
          maxResultSizeChars: MAX_RESULT_SIZE,
          forbiddenPatternCount: SANDBOX_FORBIDDEN_CODE_PATTERNS.length,
          forbiddenPatterns: SANDBOX_FORBIDDEN_CODE_PATTERNS.map((p) => ({
            pattern: p.pattern.source,
            description: p.description,
          })),
          runtime: {
            hostKind: 'js-vm',
            filesystem: 'none',
            network: 'deny',
            httpRequests: false,
            dynamicEval: false,
            dynamicImports: false,
            userOverridesSupported: false,
          },
          localProcess: {
            hostKind: 'local-process',
            available: true,
            defaultNetwork: 'deny',
            filesystemScopeSource: 'tool-binding',
            workingDirectorySource: 'tool-request',
            timeoutSource: 'tool-policy',
            commandAllowlistSupported: false,
            confirmationSupported: false,
            userOverridesSupported: false,
          },
        },
        subAgent: {
          maxSteps: override.maxSteps ?? SUB_AGENT_SECURITY.maxSteps,
          compactThresholdTokens: override.compactThresholdTokens ?? SUB_AGENT_SECURITY.compactThresholdTokens,
          toolExecutionTimeoutMs: override.toolExecutionTimeoutMs ?? SUB_AGENT_SECURITY.toolExecutionTimeoutMs,
          totalTimeoutMs: override.totalTimeoutMs ?? SUB_AGENT_SECURITY.totalTimeoutMs,
          forbiddenCapabilities: override.forbiddenCapabilities ?? [...SUB_AGENT_SECURITY.forbiddenCapabilities],
          allowedToolNames: override.allowedToolNames ?? [...SUB_AGENT_SECURITY.allowedToolNames],
        },
      },
    };
  });

  // ── PUT /api/security/subagent ─── 更新 Sub-Agent 安全配置 ────────────────
  app.put('/api/security/subagent', async (req, reply) => {
    const parsed = SubAgentConfigSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    await store.run(
      `INSERT INTO preferences(pref_key, pref_value, updated_at) VALUES(?, ?, datetime('now'))
       ON CONFLICT(pref_key) DO UPDATE SET pref_value=excluded.pref_value, updated_at=datetime('now')`,
      [SUBAGENT_PREF_KEY, JSON.stringify(parsed.data)]
    );
    return { ok: true };
  });
}
