/**
 * persona prompt 层（priority=2，stable=true）
 *
 * 在 coreRoleLayer (priority=0) 之后、coordinatorContextLayer (priority=3) 之前注入，
 * 让人格定义优先于 Coordinator 角色叙述，避免被覆盖。
 *
 * ctx.persona 由 SessionRunner / GeneralTaskPack 在调用 PromptAssembler 前注入。
 */

import type { PromptLayer } from '../types.js';

export const personaLayer: PromptLayer = {
  name: 'persona',
  priority: 2,
  stable: true,
  async compile(ctx) {
    const persona = ctx.persona;
    if (!persona || !persona.systemPrompt) return null;
    const traitsLine = persona.traits
      ? formatTraits(persona.traits)
      : '';
    return [
      `<persona name="${escapeXmlAttr(persona.name)}" scope="${persona.scope}">`,
      persona.systemPrompt.trim(),
      traitsLine ? `\n人格特征：${traitsLine}` : '',
      '</persona>'
    ].filter(Boolean).join('\n');
  }
};

function formatTraits(traits: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof traits.tone === 'string') parts.push(`语气=${traits.tone}`);
  if (Array.isArray(traits.expertise) && traits.expertise.length) {
    parts.push(`擅长=${traits.expertise.slice(0, 5).join('、')}`);
  }
  if (typeof traits.responseStyle === 'string') parts.push(`风格=${traits.responseStyle}`);
  return parts.join('；');
}

function escapeXmlAttr(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '&' ? '&amp;'
    : c === '"' ? '&quot;'
    : '&apos;'
  );
}
