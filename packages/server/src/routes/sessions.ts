import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../index.js';
import { TranscriptStore, OTelStore, type StreamEvent } from '@risk-agent/core';
import { SessionAttachmentService } from '../services/SessionAttachmentService.js';

const StartSchema = z.object({
  businessName: z.string().min(1),
  description: z.string().optional(),
  scenarioIds: z.array(z.string()).optional(),
  ruleScope: z
    .object({
      bizTypes: z.array(z.string()).optional(),
      ruleTypes: z.array(z.string()).optional()
    })
    .optional(),
  locale: z.string().optional(),
  modelId: z.string().optional(),
  attachmentIds: z.array(z.string().trim().min(1)).optional(),
  toolIds: z.array(z.string().trim().min(1)).optional(),
});

const AttachmentUploadSchema = z.object({
  sessionId: z.string().trim().optional(),
  filename: z.string().trim().min(1),
  contentType: z.string().trim().optional(),
  dataBase64: z.string().min(1),
});

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();
  const transcriptStore = new TranscriptStore(store);
  const otelStore = new OTelStore(store);
  const attachmentService = new SessionAttachmentService(ctx.storage);

  app.post('/api/session-attachments', async (req, reply) => {
    const parsed = AttachmentUploadSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    try {
      const attachment = await attachmentService.upload(parsed.data);
      return reply.code(201).send({
        attachmentId: attachment.attachmentId,
        sessionId: attachment.sessionId,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        textPreview: attachment.textPreview,
      });
    } catch (err: any) {
      const message = err?.message ?? 'attachment_upload_failed';
      if (message === 'attachment_filename_required' || message === 'attachment_data_required') {
        return reply.code(400).send({ error: message });
      }
      if (message === 'attachment_too_large') {
        return reply.code(413).send({ error: message });
      }
      return reply.code(500).send({ error: 'attachment_upload_failed', detail: message });
    }
  });

  app.get('/api/sessions', async () => {
    const rows = await store.all<any>(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 100`);
    return rows.map(serialize);
  });

  /**
   * GET /api/sessions/active — 获取当前进程内存中所有活跃会话（v3.3 §8.1 SessionManager）。
   * 返回 SessionRunner.getActiveSessions() 的实时快照，不查询数据库。
   */
  app.get('/api/sessions/active', async () => {
    return {
      sessions: ctx.runner.getActiveSessions(),
      count: ctx.runner.getActiveSessions().length,
    };
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM sessions WHERE session_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const events = await store.all<any>(
      `SELECT event_type, payload, created_at FROM stream_events WHERE session_id=? ORDER BY event_id ASC`,
      [id]
    );
    return {
      ...serialize(row),
      events: events.map((e: any) => ({ type: e.event_type, payload: safeJson(e.payload, {}), at: e.created_at }))
    };
  });

  app.get('/api/sessions/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { history } = req.query as { history?: string };
    const row = await store.get<any>(`SELECT session_id, status FROM sessions WHERE session_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const shouldReplay = history !== '0';
    reply.hijack();
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (origin) {
      reply.raw.setHeader('access-control-allow-origin', origin);
      reply.raw.setHeader('vary', 'origin');
    }
    reply.raw.setHeader('access-control-allow-credentials', 'true');
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');

    const writeEvent = (event: StreamEvent) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    reply.raw.write(': connected\n\n');

    if (shouldReplay) {
      const handle = ctx.runner.getHandle(id);
      if (handle) {
        for (const event of handle.eventHistory) {
          writeEvent(event);
        }
      } else {
        const events = await store.all<any>(
          `SELECT payload FROM stream_events WHERE session_id=? ORDER BY event_id ASC`,
          [id]
        );
        for (const event of events) {
          writeEvent(safeJson(event.payload, {}) as StreamEvent);
        }
      }
    }

    if (row.status !== 'running') {
      reply.raw.end();
      return;
    }

    const handle = ctx.runner.getHandle(id);
    if (!handle) {
      reply.raw.end();
      return;
    }

    const onEvent = (event: StreamEvent) => {
      writeEvent(event);
    };
    const cleanup = () => {
      handle.emitter.off('event', onEvent);
      reply.raw.off('close', cleanup);
    };

    handle.emitter.on('event', onEvent);
    handle.done.finally(() => {
      cleanup();
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
    reply.raw.on('close', cleanup);
  });

  app.post('/api/sessions', async (req, reply) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    const handle = await ctx.runner.start(parsed.data);
    reply.code(201).send({ sessionId: handle.sessionId });
  });

  app.post('/api/sessions/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    // terminateSession 负责：广播 query_stopped 事件、cancel abort、更新 DB、清除内存
    ctx.runner.terminateSession(id);
    return reply.code(200).send({ ok: true });
  });

  /**
   * GET /api/sessions/:id/status — 获取指定会话实时状态快照（v3.3 §8.1 SessionManager）。
   * 返回当前推理/工具执行阶段、活跃 Worker 数、Token 消耗和费用。
   */
  app.get('/api/sessions/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    // 先检查 DB 中是否存在
    const row = await store.get<any>(`SELECT session_id FROM sessions WHERE session_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const status = ctx.runner.getSessionStatus(id);
    return { sessionId: id, ...status };
  });

  /**
   * PATCH /api/sessions/:id — 重命名会话 (更新 business_name)。
   */
  app.patch('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { businessName?: string };
    if (!body.businessName?.trim()) {
      return reply.code(400).send({ error: 'businessName_required' });
    }
    const row = await store.get<any>(`SELECT session_id FROM sessions WHERE session_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await store.run(`UPDATE sessions SET business_name=? WHERE session_id=?`, [body.businessName.trim(), id]);
    return { ok: true, sessionId: id };
  });

  /**
   * DELETE /api/sessions/:id — 终止会话（取消 + 内存清除 + DB 状态更新）（v3.3 §8.1）。
   */
  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    ctx.runner.terminateSession(id);
    // 同时将 DB 状态设为 archived，使其从默认列表中隐藏
    await store.run(
      `UPDATE sessions SET status='archived' WHERE session_id=? AND status != 'archived'`,
      [id]
    ).catch(() => { /* ignore */ });
    return reply.code(200).send({ ok: true, terminated: true });
  });

  const FollowUpSchema = z.object({
    content: z.string().trim().min(1),
    modelId: z.string().trim().optional(),
    attachmentIds: z.array(z.string().trim().min(1)).optional(),
    toolIds: z.array(z.string().trim().min(1)).optional(),
  });

  app.post('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = FollowUpSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }

    try {
      const result = await ctx.runner.appendUserMessage(id, parsed.data);
      return reply.code(201).send({ ok: true, ...result });
    } catch (err: any) {
      const msg = err?.message ?? 'append_user_message_failed';
      if (msg.includes('not found')) return reply.code(404).send({ error: 'not_found' });
      if (msg === 'content_required') return reply.code(400).send({ error: 'validation_failed' });
      return reply.code(500).send({ error: 'append_user_message_failed', detail: msg });
    }
  });

  app.post('/api/sessions/:id/answer', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { requestId?: string; answer?: string };
    if (!body.requestId || typeof body.answer !== 'string') {
      return reply.code(400).send({ error: 'validation_failed' });
    }
    const ok = ctx.runner.submitAnswer(id, body.requestId, body.answer);
    if (!ok) return reply.code(404).send({ error: 'no_pending_request' });
    return { ok: true };
  });

  app.post('/api/sessions/:id/archive', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT session_id, status FROM sessions WHERE session_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    // Only archive terminal sessions
    const terminal = ['completed', 'cancelled', 'error'];
    if (!terminal.includes(row.status)) {
      return reply.code(400).send({ error: 'session_not_terminal', status: row.status });
    }
    await store.run(`UPDATE sessions SET status='archived', completed_at=CURRENT_TIMESTAMP WHERE session_id=?`, [id]);
    return { ok: true, sessionId: id };
  });

  // session-lifecycle.md §4.3 — 恢复已中断的会话
  const ResumeSchema = z.object({
    continuePrompt: z.string().optional(),
    modelId: z.string().trim().optional(),
  });

  app.post('/api/sessions/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ResumeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    // 如果会话仍在内存中运行，直接返回（允许前端重连 WS）
    const existing = ctx.runner.getHandle(id);
    if (existing) {
      return reply.code(200).send({ sessionId: id, resumed: false, note: 'session_already_running' });
    }

    try {
      const handle = await ctx.runner.resumeSession({
        sessionId: id,
        continuePrompt: parsed.data.continuePrompt,
        modelId: parsed.data.modelId,
      });
      return reply.code(201).send({ sessionId: handle.sessionId, resumed: true });
    } catch (err: any) {
      const msg = err?.message ?? 'resume_failed';
      if (msg.includes('not found')) return reply.code(404).send({ error: 'not_found' });
      return reply.code(500).send({ error: 'resume_failed', detail: msg });
    }
  });

  app.get('/api/sessions/:id/cost', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await store.all<any>(
      `SELECT model,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_tokens) AS cached_tokens,
              SUM(estimated_usd) AS estimated_usd,
              COUNT(*) AS snapshot_count,
              MAX(created_at) AS last_updated
       FROM cost_snapshots WHERE session_id=? GROUP BY model`,
      [id]
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found' });
    const totals = rows.reduce(
      (acc: any, r: any) => ({
        inputTokens: acc.inputTokens + Number(r.input_tokens ?? 0),
        outputTokens: acc.outputTokens + Number(r.output_tokens ?? 0),
        cachedTokens: acc.cachedTokens + Number(r.cached_tokens ?? 0),
        estimatedUsd: acc.estimatedUsd + Number(r.estimated_usd ?? 0)
      }),
      { inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedUsd: 0 }
    );
    return {
      sessionId: id,
      breakdown: rows.map((r: any) => ({
        model: r.model,
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        cachedTokens: Number(r.cached_tokens ?? 0),
        estimatedUsd: Number(r.estimated_usd ?? 0),
        snapshotCount: Number(r.snapshot_count ?? 0),
        lastUpdated: r.last_updated
      })),
      totalInputTokens: totals.inputTokens,
      totalOutputTokens: totals.outputTokens,
      totalCachedTokens: totals.cachedTokens,
      totalUsd: totals.estimatedUsd
    };
  });

  // ── GET /api/observability/costs — 全局费用汇总（Observability 仪表板）─────
  app.get('/api/observability/costs', async (req) => {
    const { days } = req.query as { days?: string };
    const lookbackDays = Math.min(Number(days ?? 30), 365);
    const since = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString();

    const byModel = await store.all<any>(
      `SELECT model,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cached_tokens) AS cached_tokens,
              SUM(estimated_usd) AS estimated_usd,
              COUNT(DISTINCT session_id) AS session_count
       FROM cost_snapshots WHERE created_at >= ? GROUP BY model ORDER BY estimated_usd DESC`,
      [since]
    ).catch(() => [] as any[]);

    const bySession = await store.all<any>(
      `SELECT cs.session_id,
              s.business_name,
              SUM(cs.estimated_usd) AS estimated_usd,
              SUM(cs.input_tokens + cs.output_tokens) AS total_tokens,
              MAX(cs.created_at) AS last_activity
       FROM cost_snapshots cs
       LEFT JOIN sessions s ON s.session_id = cs.session_id
       WHERE cs.created_at >= ?
       GROUP BY cs.session_id
       ORDER BY estimated_usd DESC LIMIT 10`,
      [since]
    ).catch(() => [] as any[]);

    const totals = byModel.reduce(
      (acc: any, r: any) => ({
        totalUsd: acc.totalUsd + Number(r.estimated_usd ?? 0),
        totalInputTokens: acc.totalInputTokens + Number(r.input_tokens ?? 0),
        totalOutputTokens: acc.totalOutputTokens + Number(r.output_tokens ?? 0),
        totalCachedTokens: acc.totalCachedTokens + Number(r.cached_tokens ?? 0),
      }),
      { totalUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0 }
    );

    return {
      lookbackDays,
      since,
      ...totals,
      byModel: byModel.map((r: any) => ({
        model: r.model,
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        cachedTokens: Number(r.cached_tokens ?? 0),
        estimatedUsd: Number(r.estimated_usd ?? 0),
        sessionCount: Number(r.session_count ?? 0),
      })),
      topSessions: bySession.map((r: any) => ({
        sessionId: r.session_id,
        businessName: r.business_name ?? '未命名',
        estimatedUsd: Number(r.estimated_usd ?? 0),
        totalTokens: Number(r.total_tokens ?? 0),
        lastActivity: r.last_activity,
      })),
    };
  });

  // ── GET /api/sessions/:id/transcript/search — 会话内 FTS5 搜索 ───────────
  // system-architecture.md v3.3 §6.3 Transcript 搜索索引
  app.get('/api/sessions/:id/transcript/search', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { q, role, limit } = req.query as { q?: string; role?: string; limit?: string };

    if (!q?.trim()) return reply.code(400).send({ error: 'query_required' });

    const results = await transcriptStore.search(q, {
      sessionId: id,
      role: role,
      limit: Math.min(Number(limit ?? 20), 100)
    });
    return { success: true, data: { query: q, sessionId: id, results } };
  });

  // ── GET /api/transcript/search — 跨会话 FTS5 搜索 ───────────────────────
  app.get('/api/transcript/search', async (req, reply) => {
    const { q, role, limit, session_id } = req.query as {
      q?: string;
      role?: string;
      limit?: string;
      session_id?: string;
    };

    if (!q?.trim()) return reply.code(400).send({ error: 'query_required' });

    const results = await transcriptStore.search(q, {
      sessionId: session_id,
      role: role,
      limit: Math.min(Number(limit ?? 20), 100)
    });
    return { success: true, data: { query: q, results } };
  });

  // ── GET /api/observability/traces — OTel Span 列表（v3.3 §9.1）───────────
  app.get('/api/observability/traces', async (req) => {
    const { session_id, limit } = req.query as { session_id?: string; limit?: string };
    const maxRows = Math.min(Number(limit ?? 20), 100);

    if (session_id) {
      const spans = await otelStore.queryByTrace(session_id);
      return { success: true, data: { traceId: session_id, spans } };
    }
    const traces = await otelStore.listTraces(maxRows);
    return { success: true, data: { traces } };
  });

  // ── GET /api/observability/traces/:traceId — 单条 trace 的全部 Span ───────
  app.get('/api/observability/traces/:traceId', async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    const spans = await otelStore.queryByTrace(traceId);
    if (!spans.length) return reply.code(404).send({ error: 'not_found' });
    return { success: true, data: { traceId, spans } };
  });
}

function serialize(r: any) {
  if (!r) return null;
  return {
    sessionId: r.session_id,
    scenarioId: r.scenario_id,
    businessName: r.business_name,
    description: r.description,
    status: r.status,
    phase: r.phase,
    locale: r.locale,
    ruleScope: safeJson(r.rule_scope, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at
  };
}

function safeJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
