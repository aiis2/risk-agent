/**
 * previousAnalysis layer — 注入前次分析摘要（跨会话连续性）
 * priority: 12
 */
import type { PromptLayer } from '../types.js';

export const previousAnalysisLayer: PromptLayer = {
  name: 'previous_analysis',
  priority: 12,
  stable: false,
  async compile(ctx) {
    if (!ctx.previousAnalysisSummary) return null;
    return `<previous-analysis>\n${ctx.previousAnalysisSummary}\n</previous-analysis>`;
  }
};
