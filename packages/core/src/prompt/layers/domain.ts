import type { PromptLayer } from '../types.js';

export const domainLayer: PromptLayer = {
  name: 'domain',
  priority: 5,
  stable: true,
  async compile(ctx) {
    const lines: string[] = ['## 领域上下文'];
    if (ctx.businessName) lines.push(`- 业务名：${ctx.businessName}`);
    if (ctx.domain) lines.push(`- 业务域：${ctx.domain}`);
    if (ctx.scenarios?.length) {
      lines.push('- 涉及业务场景：');
      for (const s of ctx.scenarios) lines.push(`  * ${s.name}${s.description ? ' — ' + s.description : ''}`);
    }
    if (ctx.rules?.length) {
      lines.push('- 涉及规则：');
      for (const r of ctx.rules) lines.push(`  * ${r.name}${r.ruleType ? ` [${r.ruleType}]` : ''}`);
    }
    return lines.length > 1 ? lines.join('\n') : null;
  }
};
