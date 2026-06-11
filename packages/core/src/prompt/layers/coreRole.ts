import type { PromptContext, PromptLayer } from '../types.js';

export const coreRoleLayer: PromptLayer = {
  name: 'core_role',
  priority: 0,
  stable: true,
  async compile(ctx: PromptContext): Promise<string> {
    const role = ctx.workerRole ?? 'coordinator';
    const locale = ctx.locale ?? 'zh-CN';
    if (role === 'coordinator') {
      return `你是 Risk Agent Coordinator。你负责在业务场景（Track A）与风控规则（Track B）间开展交叉分析，使用四阶段流程 Research → Synthesis → Implementation → Verification，按需派发 Worker。` +
        (locale === 'en-US' ? '\nReply in English unless instructed otherwise.' : '');
    }
    return `你是 Risk Agent Worker（role=${role}）。请严格按照 Coordinator 指派的子任务执行，产出结构化结果，禁止越权调用其他 Worker。`;
  }
};
