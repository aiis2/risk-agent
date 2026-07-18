import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathInside } from '../web-ui';

describe('web UI asset containment', () => {
  it('accepts nested assets with POSIX path semantics', () => {
    expect(isPathInside('/opt/risk-agent/web-dist', '/opt/risk-agent/web-dist/assets/app.js', posix)).toBe(true);
  });

  it('accepts nested assets with Windows path semantics', () => {
    expect(isPathInside('C:\\RiskAgent\\web-dist', 'C:\\RiskAgent\\web-dist\\assets\\app.js', win32)).toBe(true);
  });

  it('rejects sibling paths on every platform', () => {
    expect(isPathInside('/opt/risk-agent/web-dist', '/opt/risk-agent/secrets.txt', posix)).toBe(false);
    expect(isPathInside('C:\\RiskAgent\\web-dist', 'C:\\RiskAgent\\secrets.txt', win32)).toBe(false);
  });
});
