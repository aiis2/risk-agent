/**
 * types.ts — 告警渠道公共接口
 * packages/core/src/alerts/channels/types.ts
 */

export interface AlertPayload {
  title: string;
  message: string;
  severity: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface AlertChannel {
  /** 渠道标识名 */
  name: string;
  /** 发送告警（失败可抛出，由 AlertService 捕获并降级） */
  send(payload: AlertPayload): Promise<void>;
}
