import { describe, expect, it } from 'vitest';
import { normalizeImportedSkillPackage } from '../skillPackage';

describe('normalizeImportedSkillPackage', () => {
  it('strips a shared top-level folder from imported files', () => {
    const result = normalizeImportedSkillPackage('fallback-name', [
      { path: 'skill-creator/SKILL.md', content: '# skill-creator' },
      { path: 'skill-creator/agents/grader.md', content: 'grader instructions' },
      { path: 'skill-creator/references/schema.json', content: '{"type":"object"}' },
    ]);

    expect(result.rootName).toBe('skill-creator');
    expect(result.files).toEqual([
      { path: 'SKILL.md', content: '# skill-creator' },
      { path: 'agents/grader.md', content: 'grader instructions' },
      { path: 'references/schema.json', content: '{"type":"object"}' },
    ]);
  });

  it('falls back to the provided root name when files have no shared folder', () => {
    const result = normalizeImportedSkillPackage('custom-skill', [
      { path: 'SKILL.md', content: '# custom-skill' },
      { path: 'agents/grader.md', content: 'grader instructions' },
    ]);

    expect(result.rootName).toBe('custom-skill');
    expect(result.files).toEqual([
      { path: 'SKILL.md', content: '# custom-skill' },
      { path: 'agents/grader.md', content: 'grader instructions' },
    ]);
  });

  it('rejects imports without a skill entrypoint', () => {
    expect(() => normalizeImportedSkillPackage('custom-skill', [
      { path: 'README.md', content: '# no entrypoint' },
    ])).toThrow(/SKILL\.md|index\.ts|index\.js/i);
  });
});