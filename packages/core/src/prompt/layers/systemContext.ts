/**
 * systemContext layer — 注入时间 + 可用组件 + 预设修饰器（参考 agent-framework.md §17）
 * priority: 5（在 coreRole 之后，domain 之前）
 */
import type { PromptLayer } from '../types.js';

export const systemContextLayer: PromptLayer = {
  name: 'system_context',
  priority: 5,
  stable: false,
  async compile(ctx) {
    const parts: string[] = [];

    // 当前时间
    const time = ctx.currentTime ?? new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    parts.push(`当前时间：${time}`);

    // 可用组件（System RAG）
    if (ctx.availableComponents?.length) {
      parts.push(
        '<available-components>\n' +
          ctx.availableComponents.map((c) => `- ${c.name}: ${c.description}`).join('\n') +
          '\n</available-components>'
      );
    }

    // 预设分析修饰器
    if (ctx.presetPromptModifier) {
      parts.push(`<analysis-focus>\n${ctx.presetPromptModifier}\n</analysis-focus>`);
    }

    // 用户自定义提示片段
    if (ctx.userPrompts?.length) {
      parts.push(`<user-instructions>\n${ctx.userPrompts.join('\n')}\n</user-instructions>`);
    }

    return parts.length ? parts.join('\n\n') : null;
  }
};
