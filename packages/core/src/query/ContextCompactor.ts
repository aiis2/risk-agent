/**
 * ContextCompactor — 上下文压缩（参考 agent-framework.md §13.2/13.3）
 *
 * 四级策略：
 *   L1 Snip       — 裁剪旧 tool_result，保留最近 3 轮完整
 *   L2 Micro-Compact — 合并重复的 tool_result（相同 toolName）
 *   L3 Auto-Compact — 超阈值时 LLM 摘要中间区域（80K token 触发）
 *   L4 Reactive   — API 413/prompt-too-long 应急截断到 60%
 */

import type { Message } from '../agents/base/types.js';
import type { LLMAdapter } from '../llm/LLMAdapter.js';
import { createLogger } from '../logger.js';

const log = createLogger('ContextCompactor');

export type CompactReason = 'token_budget' | 'max_turns' | 'api_error' | 'manual';

export interface CompactResult {
  messages: Message[];
  tokensBefore: number;
  tokensAfter: number;
  reason: CompactReason;
  strategy: 'snip' | 'micro' | 'auto' | 'reactive';
}

/** 粗略 token 计数（字符数 / 3.5 近似） */
export function estimateTokens(messages: Message[]): number {
  return Math.ceil(
    messages.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0) / 3.5
  );
}

/**
 * 中文感知精细 token 估算（09-context-management.md §8）
 *
 * 规则：
 *   - 中文字符（\u4e00-\u9fff）：约 1.5 token/字
 *   - 其他字符：约 0.25 token/字符（英文单词平均约 4 字符 = 1 token）
 */
export function tokenCountWithEstimation(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs block (covers most Chinese/Japanese/Korean characters)
    if (code >= 0x4e00 && code <= 0x9fff) {
      count += 1.5;
    } else {
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

/** Messages 的精细 token 估算 */
export function estimateTokensPrecise(messages: Message[]): number {
  return messages.reduce((acc, m) => {
    if (typeof m.content !== 'string') return acc;
    return acc + tokenCountWithEstimation(m.content);
  }, 0);
}

export class ContextCompactor {
  constructor(
    private readonly llm: LLMAdapter | null,
    private readonly compactModel: string = ''
  ) {}

  /**
   * L1: Snip — 裁剪最早的 tool_result 消息，保留最近 3 轮。
   * 适用于：历史消息 > N 条时快速裁剪。
   */
  snip(messages: Message[], keepRecent = 6): Message[] {
    if (messages.length <= keepRecent + 2) return messages;
    const system = messages[0];
    const firstUser = messages[1];
    const recent = messages.slice(-keepRecent);
    // 从中间区域仅保留非 tool_result 消息（保留 assistant text）
    const middle = messages
      .slice(2, -keepRecent)
      .filter((m) => m.role !== 'tool')
      .slice(-4);
    return [system, firstUser, ...middle, ...recent];
  }

  /**
   * L2: Micro-Compact — 合并重复工具调用结果（截断过大的 tool_result）。
   */
  microCompact(messages: Message[], maxToolResultChars = 2000): Message[] {
    return messages.map((m) => {
      if (m.role !== 'tool' || !m.toolResults) return m;
      const truncated = m.toolResults.map((r) => ({
        ...r,
        content:
          typeof r.content === 'string' && r.content.length > maxToolResultChars
            ? r.content.slice(0, maxToolResultChars) + '\n...[已截断]'
            : r.content
      }));
      return { ...m, toolResults: truncated, content: JSON.stringify(truncated) };
    });
  }

  /**
   * L3: Auto-Compact — LLM 摘要中间区域（参考 auto_report compactMessages）。
   * 保留：system + firstUser + LLM摘要 + 最近6条
   */
  async autoCompact(
    messages: Message[],
    signal?: AbortSignal
  ): Promise<Message[]> {
    if (!this.llm || !this.compactModel || messages.length <= 8) {
      return this.snip(messages, 6);
    }

    const system = messages[0];
    const firstUser = messages[1];
    const recent = messages.slice(-6);
    const middle = messages.slice(2, -6);

    if (!middle.length) return messages;

    try {
      const summaryPrompt = [
        '请将以下对话历史压缩成简洁摘要（不超过500字），保留关键发现、决策和工具结果：',
        '',
        middle.map((m) => `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 500) : ''}`).join('\n')
      ].join('\n');

      const result = await this.llm.call({
        model: this.compactModel,
        systemPrompt: '你是对话历史压缩助手。提取关键信息，去除冗余。',
        messages: [{ role: 'user', content: summaryPrompt, timestamp: Date.now() }],
        maxTokens: 600,
        temperature: 0.1,
        signal
      });

      const summaryMsg: Message = {
        role: 'assistant',
        content: `[上下文摘要]\n${result.text}`,
        timestamp: Date.now()
      };

      return [system, firstUser, summaryMsg, ...recent];
    } catch (err) {
      log.warn({ err }, 'Auto-compact LLM call failed, falling back to snip');
      return this.snip(messages, 6);
    }
  }

  /**
   * L4: Reactive-Compact — API 返回 413/prompt-too-long 时应急截断到 60%。
   */
  reactiveCompact(messages: Message[]): Message[] {
    const targetLen = Math.ceil(messages.length * 0.6);
    if (messages.length <= targetLen) return messages;
    const system = messages[0];
    const recent = messages.slice(-Math.max(4, targetLen - 1));
    return [system, ...recent];
  }

  /**
   * 自动选择压缩策略：
   *   - currentTokens > threshold → Auto-Compact（L3）
   *   - currentTokens > threshold * 0.7 → Snip（L1）
   *   - reason === 'api_error' → Reactive（L4）
   */
  async compact(
    messages: Message[],
    currentTokens: number,
    threshold: number,
    reason: CompactReason = 'token_budget',
    signal?: AbortSignal
  ): Promise<CompactResult> {
    const before = currentTokens;

    let result: Message[];
    let strategy: CompactResult['strategy'];

    if (reason === 'api_error') {
      result = this.reactiveCompact(messages);
      strategy = 'reactive';
    } else if (currentTokens > threshold) {
      result = await this.autoCompact(messages, signal);
      strategy = 'auto';
    } else if (currentTokens > threshold * 0.7) {
      result = this.microCompact(this.snip(messages, 6));
      strategy = 'micro';
    } else {
      result = this.snip(messages, 6);
      strategy = 'snip';
    }

    return {
      messages: result,
      tokensBefore: before,
      tokensAfter: estimateTokens(result),
      reason,
      strategy
    };
  }
}
