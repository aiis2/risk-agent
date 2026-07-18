import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import serverVitestConfig from '../../vitest.config.js';

type AliasEntry = {
  find: string | RegExp;
  replacement: string;
};

const expectedCoreSourceEntry = fileURLToPath(
  new URL('../../../core/src/index.ts', import.meta.url),
);

describe('server Vitest resolution boundary', () => {
  it('maps only the core package root to its source entry', () => {
    const config = serverVitestConfig as {
      resolve?: { alias?: AliasEntry[] };
    };
    const aliases = config.resolve?.alias;

    expect(aliases).toHaveLength(1);
    const alias = aliases?.[0];
    expect(alias?.replacement).toBe(expectedCoreSourceEntry);
    expect(alias?.find).toBeInstanceOf(RegExp);

    if (!(alias?.find instanceof RegExp)) {
      throw new Error('Core source alias must use an exact regular expression');
    }

    expect(alias.find.test('@risk-agent/core')).toBe(true);
    expect(alias.find.test('@risk-agent/core/browser')).toBe(false);
    expect(alias.find.test('prefix@risk-agent/core')).toBe(false);
  });
});
