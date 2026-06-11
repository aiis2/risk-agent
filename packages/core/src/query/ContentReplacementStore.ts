/**
 * ContentReplacementStore — 工具结果超预算时的内容替换机制
 * （参考 v3.3-evolution-delta.md §6.2）
 *
 * 当工具结果超出预算阈值时，将完整结果写入磁盘，
 * 并在消息历史中用摘要 + 文件路径替换，避免上下文膨胀。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('ContentReplacementStore');

/** 被替换的工具结果条目 */
export interface ReplacementEntry {
  toolUseId: string;
  originalSize: number;  // 原始字节数（字符数近似）
  summary: string;        // 摘要文本（前 500 字符）
  filePath: string;       // 完整结果持久化路径
}

/** 会话级内容替换状态（v3.3-evolution-delta.md §6.2） */
export interface ContentReplacementState {
  replacements: Map<string, ReplacementEntry>;
  totalBytesEstimate: number;
  budgetBytes: number;
}

/** 默认预算：工具结果总量超过 256KB 时开始替换 */
const DEFAULT_BUDGET_BYTES = 256 * 1024;

/**
 * ContentReplacementStore — 管理工具结果替换
 */
export class ContentReplacementStore {
  private readonly state: ContentReplacementState;
  private readonly persistDir: string;

  constructor(
    sessionId: string,
    dataDir: string,
    budgetBytes = DEFAULT_BUDGET_BYTES,
  ) {
    this.state = {
      replacements: new Map(),
      totalBytesEstimate: 0,
      budgetBytes,
    };
    this.persistDir = join(dataDir, 'tool-results', sessionId);
  }

  /**
   * 尝试将工具结果纳入替换管理。
   * 若结果超过单次大小阈值（50KB）或累计超预算，则替换。
   *
   * @returns 替换后的精简文本，或 null 表示无需替换
   */
  tryReplace(toolUseId: string, rawResult: string): string | null {
    const size = rawResult.length;
    const singleThreshold = 50 * 1024; // 50KB 单次阈值

    const shouldReplace =
      size > singleThreshold ||
      this.state.totalBytesEstimate + size > this.state.budgetBytes;

    if (!shouldReplace) {
      this.state.totalBytesEstimate += size;
      return null;
    }

    // 生成摘要（前 500 字符）
    const summary = rawResult.slice(0, 500).replace(/\n/g, ' ').trim();

    // 持久化完整结果到磁盘
    let filePath = '';
    try {
      mkdirSync(this.persistDir, { recursive: true });
      filePath = join(this.persistDir, `${toolUseId}.txt`);
      writeFileSync(filePath, rawResult, 'utf-8');
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      log.warn(`[ContentReplacementStore] 写入失败 toolUseId=${toolUseId}: ${err}`);
    }

    const entry: ReplacementEntry = {
      toolUseId,
      originalSize: size,
      summary,
      filePath,
    };
    this.state.replacements.set(toolUseId, entry);
    this.state.totalBytesEstimate += Math.min(size, 600); // 摘要占用很小

    log.debug(
      `[ContentReplacementStore] replaced toolUseId=${toolUseId} originalSize=${size} filePath=${filePath}`,
    );

    return [
      `[工具结果已压缩，原始大小: ${(size / 1024).toFixed(1)}KB]`,
      `摘要: ${summary}${size > 500 ? '...' : ''}`,
      filePath ? `完整结果路径: ${filePath}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** 获取所有替换记录 */
  getReplacements(): ReadonlyMap<string, ReplacementEntry> {
    return this.state.replacements;
  }

  /** 获取当前累计字节估算 */
  getTotalBytesEstimate(): number {
    return this.state.totalBytesEstimate;
  }

  /** 是否已有替换记录 */
  hasReplacements(): boolean {
    return this.state.replacements.size > 0;
  }
}
