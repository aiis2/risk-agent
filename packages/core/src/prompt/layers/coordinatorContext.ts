/**
 * coordinatorContext layer — 注入 Coordinator 模式下的 Worker 工具与 Scratchpad 上下文
 * （参考 v3.3-evolution-delta.md §4.3）
 * priority: 3（在 coreRole 之后，systemContext 之前）
 */
import type { PromptLayer } from '../types.js';

export const coordinatorContextLayer: PromptLayer = {
  name: 'coordinator_context',
  priority: 3,
  stable: true,
  async compile(ctx) {
    if (!ctx.coordinatorMode) return null;

    const parts: string[] = [
      '## 协调者模式（Coordinator Mode）',
    ];

    if (ctx.coordinatorWorkerContext) {
      parts.push(ctx.coordinatorWorkerContext);
    }

    return parts.join('\n\n');
  }
};
