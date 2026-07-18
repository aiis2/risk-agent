import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(__dirname, '../../../../.github/workflows/release-desktop.yml');

describe('desktop release workflow', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  it('uses the reviewed dependency graph and builds every workspace package', () => {
    expect(workflow).toMatch(/^\s*run: pnpm install --frozen-lockfile\s*$/m);
    expect(workflow).not.toContain('--frozen-lockfile=false');
    expect(workflow).toContain('pnpm --filter @risk-agent/core build');
    expect(workflow).toContain('pnpm --filter @risk-agent/server build');
    expect(workflow).toContain('pnpm --filter @risk-agent/web build');
    expect(workflow).toContain('pnpm --filter @risk-agent/desktop build');
  });

  it('runs a native packaging command for every matrix platform', () => {
    expect(workflow).toContain('node scripts/build-desktop-portable.mjs --skip-build');
    expect(workflow).toContain('pnpm build:mac');
    expect(workflow).toContain('pnpm build:linux');
  });

  it('uploads both release roots and fails when no installer exists', () => {
    expect(workflow).toContain('tmp/npm-desktop-stage-*/release/*.exe');
    expect(workflow).toContain('packages/desktop/release/*.dmg');
    expect(workflow).toContain('packages/desktop/release/*.AppImage');
    expect(workflow).toContain('if-no-files-found: error');
  });
});
