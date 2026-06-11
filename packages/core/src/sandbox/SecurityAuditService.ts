/**
 * SecurityAuditService — 安全事件审计日志服务（模块10 §7）
 *
 * 所有安全相关事件（沙盒拦截、SQL 拒绝、权限拒绝）记录到 SQLite security_audit_events 表。
 * 支持按事件类型、时间范围查询，可配置告警阈值。
 */

import { createLogger } from '../logger.js';

const log = createLogger('SecurityAuditService');

// ─── 审计事件类型 ─────────────────────────────────────────────────────────────

export type SecurityEventType =
  | 'sandbox-code-blocked'         // 静态扫描拒绝
  | 'sandbox-timeout'              // 执行超时
  | 'sandbox-error'                // 执行异常
  | 'sandbox-lease-created'        // sandbox lease created
  | 'sandbox-lease-complete'       // sandbox lease finished
  | 'sandbox-lease-cancelled'      // sandbox lease cancelled
  | 'sandbox-process-started'      // local process started
  | 'sandbox-process-complete'     // local process finished
  | 'sandbox-process-cancelled'    // local process cancelled
  | 'sql-blocked'                  // SQL 白名单拒绝
  | 'permission-denied'            // 工具权限拒绝
  | 'subagent-capability-blocked'  // Sub-Agent 能力拒绝
  | 'parameter-injection';         // 参数注入检测

/**
 * 安全审计事件接口（10-sandbox-security.md §7）
 */
export interface SecurityAuditEvent {
  eventId?: string;
  timestamp: number;
  eventType: SecurityEventType;
  agentId: string;
  details: Record<string, unknown>;
}

// ─── 简单 DB 接口（避免硬绑 better-sqlite3） ─────────────────────────────────

export interface AuditDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params: unknown[]): Promise<unknown>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

// ─── SecurityAuditService ─────────────────────────────────────────────────────

export class SecurityAuditService {
  private ready: Promise<void>;

  constructor(private db: AuditDb) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_audit_events (
        event_id       TEXT PRIMARY KEY,
        timestamp      INTEGER NOT NULL,
        event_type     TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        details        TEXT NOT NULL
      )
    `);
    await this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sae_type_ts ON security_audit_events(event_type, timestamp)`
    );
    log.debug('security_audit_events table ensured');
  }

  /**
   * 记录安全事件
   */
  async log(event: Omit<SecurityAuditEvent, 'eventId'>): Promise<void> {
    await this.ready;
    const eventId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await this.db.run(
        `INSERT INTO security_audit_events(event_id, timestamp, event_type, agent_id, details)
         VALUES(?, ?, ?, ?, ?)`,
        [
          eventId,
          event.timestamp,
          event.eventType,
          event.agentId,
          JSON.stringify(event.details),
        ]
      );
    } catch (err) {
      // 审计写入失败不应阻断业务流程
      log.warn({ err }, 'security audit log write failed (non-fatal)');
    }
  }

  /**
   * 查询最近 N 条安全事件（可按类型过滤）
   */
  async query(opts: {
    eventType?: SecurityEventType;
    limit?: number;
    since?: number; // unix ms
  } = {}): Promise<SecurityAuditEvent[]> {
    await this.ready;
    const { eventType, limit = 100, since } = opts;

    let sql = `SELECT * FROM security_audit_events WHERE 1=1`;
    const params: unknown[] = [];

    if (eventType) {
      sql += ` AND event_type = ?`;
      params.push(eventType);
    }
    if (since != null) {
      sql += ` AND timestamp >= ?`;
      params.push(since);
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all<{
      event_id: string;
      timestamp: number;
      event_type: SecurityEventType;
      agent_id: string;
      details: string;
    }>(sql, params);

    return rows.map((r) => ({
      eventId: r.event_id,
      timestamp: r.timestamp,
      eventType: r.event_type,
      agentId: r.agent_id,
      details: JSON.parse(r.details) as Record<string, unknown>,
    }));
  }

  /**
   * 检查某事件类型在 windowMs 窗口内出现次数（用于告警阈值）
   */
  async countInWindow(eventType: SecurityEventType, windowMs: number): Promise<number> {
    await this.ready;
    const since = Date.now() - windowMs;
    const rows = await this.db.all<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM security_audit_events WHERE event_type=? AND timestamp>=?`,
      [eventType, since]
    );
    return rows[0]?.cnt ?? 0;
  }
}
