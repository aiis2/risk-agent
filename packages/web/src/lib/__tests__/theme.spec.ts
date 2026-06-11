import { describe, expect, it } from 'vitest';
import { resolveThemeMode } from '../theme';

describe('resolveThemeMode', () => {
  it('follows system dark preference by default', () => {
    expect(resolveThemeMode('system', true)).toBe('midnight');
  });

  it('follows system light preference by default', () => {
    expect(resolveThemeMode('system', false)).toBe('paper');
  });

  it('keeps explicit theme selections unchanged', () => {
    expect(resolveThemeMode('sea', true)).toBe('sea');
    expect(resolveThemeMode('paper', true)).toBe('paper');
  });
});