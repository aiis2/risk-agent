import type { PromptLayer } from '../types.js';

export const ragLayer: PromptLayer = {
  name: 'rag',
  priority: 30,
  stable: false,
  async compile(ctx) {
    if (!ctx.ragSnippets?.length) return null;
    return ['## 检索上下文（RAG）', ...ctx.ragSnippets.map((s) => `- ${s}`)].join('\n');
  }
};
