import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const configPath = fileURLToPath(new URL('../../vitest.config.ts', import.meta.url));

describe('server Vitest resolution boundary', () => {
  it('maps only the core package root to its source entry', () => {
    const config = readFileSync(configPath, 'utf8');

    expect(config).toContain("import { fileURLToPath } from 'node:url'");
    expect(config).toContain("import { defineConfig } from 'vitest/config'");
    expect(config).toContain('alias: [');
    expect(config).toContain('find: /^@risk-agent\\/core$/');
    expect(config).toContain("new URL('../core/src/index.ts', import.meta.url)");
    expect(config).not.toContain("'@risk-agent/core':");
  });
});
