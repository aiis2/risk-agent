/**
 * WebhookChannel — 通用 Webhook 告警渠道。
 * packages/core/src/alerts/channels/WebhookChannel.ts
 *
 * 向配置的 URL 发送 HTTP POST（JSON body），兼容大多数告警平台。
 */
import type { AlertChannel, AlertPayload } from './types.js';

export interface WebhookChannelConfig {
  url: string;
  /** 自定义请求头（如 Authorization） */
  headers?: Record<string, string>;
  /** 超时毫秒数，默认 8000 */
  timeoutMs?: number;
}

export class WebhookChannel implements AlertChannel {
  readonly name = 'webhook';

  constructor(private readonly config: WebhookChannelConfig) {}

  async send(payload: AlertPayload): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 8_000,
    );
    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Webhook responded with ${res.status}: ${await res.text()}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
