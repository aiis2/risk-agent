import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DebugLogger — 按会话写入 JSONL 格式的调试日志。
 *
 * 每个 session 拥有独立的日志文件：<dataDir>/logs/<sessionId>.jsonl
 * 每行一个 JSON 对象，包含时间戳、事件类型和可选数据。
 *
 * (system-architecture.md v3.3 §6.2)
 */
export interface DebugLogEntry {
  ts: string;
  session: string;
  type: string;
  data?: Record<string, unknown>;
}

export class DebugLogger {
  private readonly logsDir: string;
  private readonly sessionId: string;
  private readonly logFile: string;
  private readonly enabled: boolean;

  constructor(dataDir: string, sessionId: string, opts?: { enabled?: boolean }) {
    this.logsDir = join(dataDir, 'logs');
    this.sessionId = sessionId;
    this.logFile = join(this.logsDir, `${sessionId}.jsonl`);
    this.enabled = opts?.enabled ?? true;

    if (this.enabled && !existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /** 写入一条 JSONL 日志（同步追加，失败静默忽略）*/
  log(type: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const entry: DebugLogEntry = {
      ts: new Date().toISOString(),
      session: this.sessionId,
      type,
      ...(data ? { data } : {}),
    };
    try {
      appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch { /* non-fatal */ }
  }

  /** 返回日志文件路径 */
  get filePath(): string {
    return this.logFile;
  }

  /** 创建一个绑定了子域名的 logger（便于区分 Worker 日志）*/
  child(subtype: string): ChildDebugLogger {
    return new ChildDebugLogger(this, subtype);
  }
}

export class ChildDebugLogger {
  constructor(
    private readonly parent: DebugLogger,
    private readonly prefix: string
  ) {}

  log(type: string, data?: Record<string, unknown>): void {
    this.parent.log(`${this.prefix}:${type}`, data);
  }
}
