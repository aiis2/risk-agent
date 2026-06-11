/**
 * OTelStore — OpenTelemetry SQLite 持久化存储
 * (v3.3-evolution-delta.md §9.1)
 *
 * 将 Agent 执行过程中的 Span 数据写入 SQLite otel_spans 表。
 * 支持按 traceId（会话级）查询 span 树。
 *
 * 表结构（首次 bootstrap 时自动建表）：
 *   otel_spans (trace_id, span_id, parent_span_id, name, kind, attributes, start_time, end_time, status)
 */

import type { IStructuredStore } from '../storage/interfaces/IStructuredStore.js';
import { createLogger } from '../logger.js';

const log = createLogger('OTelStore');

// ──────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────

export type OTelSpanKind = 'internal' | 'client' | 'server' | 'producer' | 'consumer';
export type OTelSpanStatus = 'ok' | 'error' | 'unset';

export interface OTelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: OTelSpanKind;
  attributes?: Record<string, string | number | boolean>;
  startTime: number;     // Unix ms
  endTime?: number;      // Unix ms（未完成时为 undefined）
  status: OTelSpanStatus;
  errorMessage?: string;
}

export interface OTelSpanRow {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  attributes: string | null;   // JSON
  start_time: number;
  end_time: number | null;
  status: string;
  error_message: string | null;
}

// ──────────────────────────────────────────────────────────
// DDL
// ──────────────────────────────────────────────────────────

export const OTEL_SPANS_DDL = `
CREATE TABLE IF NOT EXISTS otel_spans (
  trace_id        TEXT NOT NULL,
  span_id         TEXT NOT NULL PRIMARY KEY,
  parent_span_id  TEXT,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'internal',
  attributes      TEXT,
  start_time      INTEGER NOT NULL,
  end_time        INTEGER,
  status          TEXT NOT NULL DEFAULT 'unset',
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_otel_trace ON otel_spans (trace_id, start_time);
`;

// ──────────────────────────────────────────────────────────
// OTelStore 实现
// ──────────────────────────────────────────────────────────

export class OTelStore {
  private bootstrapped = false;

  constructor(private readonly db: IStructuredStore) {}

  /** 首次使用时建表（幂等） */
  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return;
    try {
      for (const stmt of OTEL_SPANS_DDL.trim().split(';').map(s => s.trim()).filter(Boolean)) {
        await this.db.run(stmt);
      }
      this.bootstrapped = true;
    } catch (err) {
      log.warn({ err }, 'OTelStore bootstrap failed — OTel spans will not be persisted');
    }
  }

  /** 记录一个 Span（fire-and-forget 模式，不阻塞调用方） */
  logSpan(span: OTelSpan): void {
    void this.persistSpan(span);
  }

  private async persistSpan(span: OTelSpan): Promise<void> {
    try {
      await this.bootstrap();
      await this.db.run(
        `INSERT OR REPLACE INTO otel_spans
           (trace_id, span_id, parent_span_id, name, kind, attributes, start_time, end_time, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          span.traceId,
          span.spanId,
          span.parentSpanId ?? null,
          span.name,
          span.kind,
          span.attributes ? JSON.stringify(span.attributes) : null,
          span.startTime,
          span.endTime ?? null,
          span.status,
          span.errorMessage ?? null,
        ]
      );
    } catch (err) {
      log.warn({ err, spanId: span.spanId }, 'Failed to persist OTel span');
    }
  }

  /** 更新 Span 结束时间和状态（用于 finish span） */
  async finishSpan(
    spanId: string,
    status: OTelSpanStatus = 'ok',
    errorMessage?: string
  ): Promise<void> {
    await this.bootstrap();
    await this.db.run(
      `UPDATE otel_spans SET end_time=?, status=?, error_message=? WHERE span_id=?`,
      [Date.now(), status, errorMessage ?? null, spanId]
    );
  }

  /** 按 traceId 查询完整 Span 树（按 start_time 排序） */
  async queryByTrace(traceId: string): Promise<OTelSpan[]> {
    await this.bootstrap();
    const rows = await this.db.all<OTelSpanRow>(
      `SELECT * FROM otel_spans WHERE trace_id=? ORDER BY start_time ASC`,
      [traceId]
    );
    return rows.map(rowToSpan);
  }

  /** 查询最近的 traceId 列表（去重，按最新 span 时间倒序） */
  async listTraces(limit = 20): Promise<{ traceId: string; name: string; startTime: number; spanCount: number }[]> {
    await this.bootstrap();
    const rows = await this.db.all<{ trace_id: string; name: string; start_time: number; span_count: number }>(
      `SELECT trace_id, MIN(name) as name, MIN(start_time) as start_time, COUNT(*) as span_count
         FROM otel_spans
         GROUP BY trace_id
         ORDER BY start_time DESC
         LIMIT ?`,
      [limit]
    );
    return rows.map(r => ({
      traceId: r.trace_id,
      name: r.name,
      startTime: r.start_time,
      spanCount: r.span_count,
    }));
  }

  /** 查询指定会话的所有 trace（traceId 通常使用 sessionId） */
  async queryBySession(sessionId: string): Promise<OTelSpan[]> {
    return this.queryByTrace(sessionId);
  }

  /** 清理超过 N 天的旧数据 */
  async prune(keepDays = 30): Promise<number> {
    await this.bootstrap();
    const cutoff = Date.now() - keepDays * 86_400_000;
    const result = await this.db.run(
      `DELETE FROM otel_spans WHERE start_time < ?`,
      [cutoff]
    );
    return (result as any)?.changes ?? 0;
  }
}

/** 开始一个新 Span（返回 finisher 函数） */
export function startSpan(
  store: OTelStore,
  opts: {
    traceId: string;
    spanId?: string;
    parentSpanId?: string;
    name: string;
    kind?: OTelSpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): { spanId: string; finish: (status?: OTelSpanStatus, error?: string) => Promise<void> } {
  const spanId = opts.spanId ?? `${opts.traceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  store.logSpan({
    traceId: opts.traceId,
    spanId,
    parentSpanId: opts.parentSpanId,
    name: opts.name,
    kind: opts.kind ?? 'internal',
    attributes: opts.attributes,
    startTime,
    status: 'unset',
  });

  return {
    spanId,
    finish: (status: OTelSpanStatus = 'ok', error?: string) =>
      store.finishSpan(spanId, status, error),
  };
}

// ──────────────────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────────────────

function rowToSpan(row: OTelSpanRow): OTelSpan {
  return {
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id ?? undefined,
    name: row.name,
    kind: row.kind as OTelSpanKind,
    attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
    startTime: row.start_time,
    endTime: row.end_time ?? undefined,
    status: row.status as OTelSpanStatus,
    errorMessage: row.error_message ?? undefined,
  };
}
