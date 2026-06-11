/**
 * DataSourceNormalizer — 数据源调用结果标准化处理器。
 * packages/core/src/normalizers/DataSourceNormalizer.ts
 *
 * 负责将各类数据源（HTTP API / Git / MySQL 等）返回的原始数据
 * 标准化为统一的 DataRecord 格式，供后续 Research 聚合消费。
 */

export interface DataRecord {
  /** 数据来源标识（数据源 name） */
  sourceId: string;
  /** 数据类型：api / git / db / file / web */
  type: string;
  /** 主体内容（文本摘要或 JSON 字符串） */
  content: string;
  /** 原始对象（供调试） */
  raw?: unknown;
  /** 数据采集时间 */
  collectedAt: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface NormalizerOptions {
  /** 单条记录最大字符数（超出截断）默认 8000 */
  maxContentLength?: number;
}

export class DataSourceNormalizer {
  private readonly maxLen: number;

  constructor(opts: NormalizerOptions = {}) {
    this.maxLen = opts.maxContentLength ?? 8_000;
  }

  /**
   * 将原始 HTTP API 响应标准化。
   */
  normalizeApiResponse(sourceId: string, raw: unknown): DataRecord {
    const content = this._stringify(raw);
    return {
      sourceId,
      type: 'api',
      content: this._truncate(content),
      raw,
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * 将 Git 文件列表/差异摘要标准化。
   */
  normalizeGitResult(
    sourceId: string,
    files: Array<{ path: string; content?: string; diff?: string }>,
  ): DataRecord[] {
    return files.map((f) => ({
      sourceId,
      type: 'git',
      content: this._truncate(f.content ?? f.diff ?? f.path),
      raw: f,
      collectedAt: new Date().toISOString(),
      metadata: { path: f.path },
    }));
  }

  /**
   * 将数据库查询结果行列表标准化。
   */
  normalizeDbRows(sourceId: string, rows: Record<string, unknown>[]): DataRecord {
    return {
      sourceId,
      type: 'db',
      content: this._truncate(JSON.stringify(rows, null, 2)),
      raw: rows,
      collectedAt: new Date().toISOString(),
      metadata: { rowCount: rows.length },
    };
  }

  private _stringify(v: unknown): string {
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  private _truncate(s: string): string {
    if (s.length <= this.maxLen) return s;
    return s.slice(0, this.maxLen) + '\n… (截断)';
  }
}
