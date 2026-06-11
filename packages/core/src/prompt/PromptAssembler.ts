import type { PromptContext, PromptLayer } from './types.js';
import { coreRoleLayer } from './layers/coreRole.js';
import { coordinatorContextLayer } from './layers/coordinatorContext.js';
import { memoryLayer } from './layers/memory.js';
import { dataSourcesLayer } from './layers/dataSources.js';
import { ragLayer } from './layers/rag.js';
import { domainLayer } from './layers/domain.js';
import { systemContextLayer } from './layers/systemContext.js';
import { previousAnalysisLayer } from './layers/previousAnalysis.js';
import { personaLayer } from './layers/persona.js';
import { userProfileLayer } from './layers/userProfile.js';

export const DEFAULT_PROMPT_LAYERS: PromptLayer[] = [
  coreRoleLayer,           // priority 0 — 角色定义
  personaLayer,            // priority 2 — Hermes 风格人格档案（A1）
  coordinatorContextLayer, // priority 3 — Coordinator 模式 Worker 上下文（v3.3 §4.3）
  systemContextLayer,      // priority 5 — 时间 + 可用组件 + 预设修饰器
  userProfileLayer,        // priority 7 — 用户画像（A2）
  domainLayer,             // priority 8 — 业务场景 + 规则列表
  memoryLayer,             // priority 10 — 长期记忆摘要
  previousAnalysisLayer,   // priority 12 — 前次分析摘要
  dataSourcesLayer,        // priority 15 — 数据源
  ragLayer                 // priority 20 — RAG 检索片段
];

export class PromptAssembler {
  constructor(private readonly layers: PromptLayer[] = DEFAULT_PROMPT_LAYERS) {}

  async compile(ctx: PromptContext): Promise<string> {
    const sorted = [...this.layers].sort((a, b) => a.priority - b.priority);
    const parts: string[] = [];
    for (const layer of sorted) {
      const text = await layer.compile(ctx);
      if (text && text.trim().length) parts.push(text.trim());
    }
    if (ctx.instructions) parts.push(`## 本轮指令\n${ctx.instructions}`);
    return parts.join('\n\n');
  }
}

export type { PromptContext, PromptLayer } from './types.js';
