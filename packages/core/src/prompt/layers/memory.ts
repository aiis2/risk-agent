import type { PromptLayer } from '../types.js';

export const memoryLayer: PromptLayer = {
  name: 'memory',
  priority: 10,
  stable: false,
  async compile(ctx) {
    const parts: string[] = [];

    // 长期记忆（跨会话知识）
    if (ctx.memorySnippets?.length) {
      parts.push(
        '<long-term-memory>\n' +
          ctx.memorySnippets.map((s, i) => `${i + 1}. ${s}`).join('\n') +
          '\n</long-term-memory>'
      );
    }

    // 短期记忆（当前会话摘要）
    if (ctx.shortTermSummary) {
      parts.push(`<session-context>\n${ctx.shortTermSummary}\n</session-context>`);
    }

    return parts.length ? parts.join('\n\n') : null;
  }
};
