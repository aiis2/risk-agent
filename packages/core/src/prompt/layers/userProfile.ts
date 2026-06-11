/**
 * userProfile prompt 层（priority=8）
 *
 * 在 systemContextLayer (priority=5) 之后、domainLayer (priority=8 同列) 之前。
 * 由 SessionRunner / TaskPack 在 plan() 前从 UserProfileService 取出注入。
 */

import type { PromptLayer } from '../types.js';

export const userProfileLayer: PromptLayer = {
  name: 'user_profile',
  priority: 7,
  stable: false,
  async compile(ctx) {
    const profile = ctx.userProfile;
    if (!profile) return null;
    const lines: string[] = ['<user-profile>'];
    if (profile.displayName) lines.push(`昵称: ${profile.displayName}`);

    const traits = profile.traits ?? {};
    if (traits.industry) lines.push(`行业: ${traits.industry}`);
    if (traits.role) lines.push(`角色: ${traits.role}`);
    if (traits.languagePref) lines.push(`语言偏好: ${traits.languagePref}`);

    const prefs = profile.preferences ?? {};
    if (prefs.verbosity) lines.push(`详略偏好: ${prefs.verbosity}`);
    if (prefs.format) lines.push(`格式偏好: ${prefs.format}`);

    if (Array.isArray(profile.learnedFacts) && profile.learnedFacts.length) {
      lines.push('既有事实:');
      profile.learnedFacts.slice(0, 8).forEach((f, i) => {
        lines.push(`${i + 1}. ${f.key ? f.key + '：' : ''}${f.value}`);
      });
    }

    lines.push('</user-profile>');
    return lines.length > 2 ? lines.join('\n') : null;
  }
};
