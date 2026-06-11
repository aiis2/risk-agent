import type { PromptLayer } from '../types.js';

export const dataSourcesLayer: PromptLayer = {
  name: 'data_sources',
  priority: 20,
  stable: false,
  async compile(ctx) {
    if (!ctx.dataSourceSummaries?.length) return null;
    return ['## 已接入数据源摘要', ...ctx.dataSourceSummaries].join('\n');
  }
};
