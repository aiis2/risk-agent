import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');

describe('favicon assets', () => {
  it('references the SVG favicon and ships the legacy ico fallback', () => {
    const html = readFileSync(resolve(webRoot, 'index.html'), 'utf8');

    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toContain('rel="alternate icon"');
    expect(html).toContain('href="/favicon.ico"');
    expect(existsSync(resolve(webRoot, 'public/favicon.svg'))).toBe(true);
    expect(existsSync(resolve(webRoot, 'public/favicon.ico'))).toBe(true);

    const ico = readFileSync(resolve(webRoot, 'public/favicon.ico'));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  });
});
