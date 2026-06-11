import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ScratchpadStore — 跨 Worker 会话共享草稿目录。
 *
 * 每个 session 拥有独立的 scratchpad 目录，Worker 可在此读写 JSON 文件，
 * 以实现跨轮知识持久化。
 *
 * 目录结构：<dataDir>/scratch/<sessionId>/
 *
 * (system-architecture.md v3.3 §4.3)
 */
export class ScratchpadStore {
  private readonly dir: string;

  constructor(dataDir: string, sessionId: string) {
    this.dir = join(dataDir, 'scratch', sessionId);
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** 写入 key → value（序列化为 JSON 文件） */
  set(key: string, value: unknown): void {
    const safeName = key.replace(/[^a-zA-Z0-9_\-]/g, '_');
    writeFileSync(join(this.dir, `${safeName}.json`), JSON.stringify(value, null, 2), 'utf8');
  }

  /** 读取 key（若不存在返回 null） */
  get<T = unknown>(key: string): T | null {
    const safeName = key.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filePath = join(this.dir, `${safeName}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /** 删除 key */
  delete(key: string): void {
    const safeName = key.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filePath = join(this.dir, `${safeName}.json`);
    if (existsSync(filePath)) {
      try { unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  /** 列出所有 key */
  keys(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  /** 返回 scratchpad 目录路径（供工具接口使用）*/
  get path(): string {
    return this.dir;
  }
}
