/**
 * EmailChannel — SMTP 邮件告警渠道。
 * packages/core/src/alerts/channels/EmailChannel.ts
 *
 * 依赖 `nodemailer`（按需安装：pnpm add -w nodemailer @types/nodemailer）。
 */
import type { AlertChannel, AlertPayload } from './types.js';

export interface EmailChannelConfig {
  smtp: {
    host: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
  };
  from: string;
  to: string | string[];
  subjectPrefix?: string;
}

export class EmailChannel implements AlertChannel {
  readonly name = 'email';

  constructor(private readonly config: EmailChannelConfig) {}

  async send(payload: AlertPayload): Promise<void> {
    let nodemailer: any;
    try {
      // @ts-ignore — optional peer dep, install when using email channel
      nodemailer = await import('nodemailer');
    } catch {
      throw new Error(
        'EmailChannel: `nodemailer` not installed. Run: pnpm add -w nodemailer @types/nodemailer',
      );
    }
    const transport = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port ?? 587,
      secure: this.config.smtp.secure ?? false,
      auth: this.config.smtp.user
        ? { user: this.config.smtp.user, pass: this.config.smtp.pass ?? '' }
        : undefined,
    });

    const prefix = this.config.subjectPrefix ?? '[Risk Agent Alert]';
    const subject = `${prefix} [${payload.severity.toUpperCase()}] ${payload.title}`;
    const html = `
      <h2>${payload.title}</h2>
      <p><strong>Severity:</strong> ${payload.severity}</p>
      <p><strong>Time:</strong> ${payload.timestamp}</p>
      ${payload.sessionId ? `<p><strong>Session:</strong> ${payload.sessionId}</p>` : ''}
      <pre>${payload.message}</pre>
      ${payload.metadata ? `<pre>${JSON.stringify(payload.metadata, null, 2)}</pre>` : ''}
    `.trim();

    await transport.sendMail({
      from: this.config.from,
      to: Array.isArray(this.config.to) ? this.config.to.join(', ') : this.config.to,
      subject,
      html,
    });
  }
}
