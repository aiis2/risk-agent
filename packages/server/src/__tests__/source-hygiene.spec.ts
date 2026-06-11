import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('server source hygiene', () => {
  it('keeps the server entrypoint free of replacement characters', () => {
    const entrypoint = fileURLToPath(new URL('../index.ts', import.meta.url));
    const source = readFileSync(entrypoint, 'utf8');
    const corruptedLines = source
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => line.includes('\uFFFD'));

    expect(corruptedLines).toEqual([]);
  });
});
