/**
 * AlertService — 告警服务。
 * packages/core/src/alerts/AlertService.ts
 *
 * 支持多渠道告警（Webhook / Email / 钉钉），按严重级别过滤，
 * 失败自动降级（不影响主流程）。
 */
import type { AlertChannel, AlertPayload } from './channels/types.js';

export type AlertSeverity = 'info' | 'warning' | 'high' | 'critical';

export interface AlertEvent {
  title: string;
  message: string;
  severity: AlertSeverity;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface AlertServiceConfig {
  enabled?: boolean;
  minSeverity?: AlertSeverity;
  channels?: AlertChannel[];
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};

export class AlertService {
  private readonly enabled: boolean;
  private readonly minRank: number;
  private readonly channels: AlertChannel[];

  constructor(config: AlertServiceConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.minRank = SEVERITY_RANK[config.minSeverity ?? 'high'];
    this.channels = config.channels ?? [];
  }

  /**
   * 发送告警。若服务未启用或严重级别未达阈值则静默跳过。
   * 各渠道发送失败独立降级，不抛出异常。
   */
  async alert(event: AlertEvent): Promise<void> {
    if (!this.enabled) return;
    if (SEVERITY_RANK[event.severity] < this.minRank) return;

    const payload: AlertPayload = {
      ...event,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    await Promise.allSettled(
      this.channels.map((ch) => ch.send(payload).catch((err) => {
        // Silent degradation — log to stderr, never re-throw
        console.error(`[AlertService] channel ${ch.name} failed:`, err?.message ?? err);
      })),
    );
  }

  /** 便捷方法 */
  async info(title: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.alert({ title, message, severity: 'info', metadata });
  }

  async warn(title: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.alert({ title, message, severity: 'warning', metadata });
  }

  async critical(title: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    return this.alert({ title, message, severity: 'critical', metadata: meta });
  }
}
