/**
 * DingtalkChannel — 钉钉机器人告警渠道。
 * packages/core/src/alerts/channels/DingtalkChannel.ts
 *
 * 通过钉钉自定义机器人 Webhook 发送 Markdown 消息。
 */
import type { AlertChannel, AlertPayload } from './types.js';

export interface DingtalkChannelConfig {
  webhookUrl: string;
  /** 安全设置：关键词（配置了关键词校验时必须包含） */
  keyword?: string;
  timeoutMs?: number;
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '[严重]',
  high: '[高危]',
  warning: '[警告]',
  info: '[提示]',
};

export class DingtalkChannel implements AlertChannel {
  readonly name = 'dingtalk';

  constructor(private readonly config: DingtalkChannelConfig) {}

  async send(payload: AlertPayload): Promise<void> {
    const tag = SEVERITY_EMOJI[payload.severity] ?? `[${payload.severity}]`;
    const title = `${tag} ${payload.title}`;
    const keyword = this.config.keyword ? `\n> 关键词: ${this.config.keyword}` : '';

    const markdown = [
      `### ${title}`,
      keyword,
      '',
      `**严重级别**: ${payload.severity.toUpperCase()}`,
      `**时间**: ${payload.timestamp}`,
      payload.sessionId ? `**会话**: ${payload.sessionId}` : '',
      '',
      payload.message,
    ]
      .filter((l) => l !== undefined)
      .join('\n');

    const body = {
      msgtype: 'markdown',
      markdown: { title, text: markdown },
    };

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 8_000,
    );
    try {
      const res = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json: any = await res.json();
      if (json.errcode !== 0) {
        throw new Error(`DingTalk error ${json.errcode}: ${json.errmsg}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
