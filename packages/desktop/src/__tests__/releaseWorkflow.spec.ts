import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(__dirname, '../../../../.github/workflows/release-desktop.yml');
const desktopPackagePath = resolve(__dirname, '../../package.json');
const electronBuilderConfigPath = resolve(__dirname, '../../electron-builder.json');
const releaseBuilderPath = resolve(__dirname, '../../../../scripts/build-desktop-release.mjs');
const releaseValidatorPath = resolve(__dirname, '../../../../scripts/validate-desktop-release-artifacts.mjs');
const sqliteProbePath = resolve(__dirname, '../../../../scripts/probe-packaged-sqlite.cjs');

describe('desktop release workflow', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  it('uses the reviewed dependency graph and builds every workspace package', () => {
    const pnpmSetupBlock = workflow.match(/- name: Setup pnpm[\s\S]*?(?=\n\s+- name:)/)?.[0] ?? '';

    expect(pnpmSetupBlock).not.toContain('version:');
    expect(workflow).toMatch(/^\s*run: pnpm install --frozen-lockfile\s*$/m);
    expect(workflow).not.toContain('--frozen-lockfile=false');
    expect(workflow).toContain('pnpm --filter @risk-agent/core build');
    expect(workflow).toContain('pnpm --filter @risk-agent/server build');
    expect(workflow).toContain('pnpm --filter @risk-agent/web build');
    expect(workflow).toContain('pnpm --filter @risk-agent/desktop build');

    const serverBuildIndex = workflow.indexOf('pnpm --filter @risk-agent/server build');
    const injectionRefreshIndex = workflow.indexOf('pnpm install --offline --frozen-lockfile');
    const desktopBuildIndex = workflow.indexOf('pnpm --filter @risk-agent/desktop build');
    expect(serverBuildIndex).toBeLessThan(injectionRefreshIndex);
    expect(injectionRefreshIndex).toBeLessThan(desktopBuildIndex);
  });

  it('runs a native packaging command for every matrix platform', () => {
    expect(workflow).toContain('node scripts/build-desktop-release.mjs --skip-build --platform=windows');
    expect(workflow).toContain('node scripts/build-desktop-release.mjs --skip-build --platform=macos');
    expect(workflow).toContain('node scripts/build-desktop-release.mjs --skip-build --platform=linux');
  });

  it('installs the Windows production graph from the frozen pnpm lockfile', () => {
    const releaseBuilder = readFileSync(releaseBuilderPath, 'utf8');

    expect(releaseBuilder).toContain("getExecutable('corepack')");
    expect(releaseBuilder).toContain("'install', '--prod', '--frozen-lockfile'");
    expect(releaseBuilder).toContain("'--config.node-linker=hoisted'");
    expect(releaseBuilder).toContain("platformName === 'macos'");
    expect(releaseBuilder).toContain("platformName === 'linux'");
    expect(releaseBuilder).not.toContain("['install', '--omit=dev'");
    expect(releaseBuilder).not.toContain("from: 'node_modules/playwright-core'");
  });

  it('packages each macOS architecture in an isolated builder pass', () => {
    const releaseBuilder = readFileSync(releaseBuilderPath, 'utf8');

    expect(releaseBuilder).toContain("['--mac', '--x64']");
    expect(releaseBuilder).toContain("['--mac', '--arm64']");
    expect(releaseBuilder).not.toContain("arch: ['x64', 'arm64']");
  });

  it('keeps unsigned packaging separate from optional signing credentials', () => {
    const unsignedPackageBlock = workflow.match(/- name: Package desktop \(unsigned\)[\s\S]*?(?=\n\s+- name:)/)?.[0] ?? '';

    expect(workflow).toContain('secrets.WIN_CSC_LINK');
    expect(workflow).toContain('secrets.MAC_CSC_LINK');
    expect(workflow).not.toContain('secrets.CSC_LINK');
    expect(unsignedPackageBlock).toContain("matrix.signing_platform == 'none'");
    expect(unsignedPackageBlock).toContain('CSC_IDENTITY_AUTO_DISCOVERY: false');
  });

  it('uploads both release roots and fails when no installer exists', () => {
    const releaseValidator = readFileSync(releaseValidatorPath, 'utf8');
    const sqliteProbe = readFileSync(sqliteProbePath, 'utf8');

    expect(workflow).toContain('node scripts/validate-desktop-release-artifacts.mjs');
    expect(workflow).toContain('tmp/npm-desktop-stage-*/release/*.exe');
    expect(workflow).toContain('tmp/npm-desktop-stage-*/release/*.dmg');
    expect(workflow).toContain('tmp/npm-desktop-stage-*/release/*.AppImage');
    expect(workflow).toContain('packages/desktop/release/*.dmg');
    expect(workflow).toContain('packages/desktop/release/*.AppImage');
    expect(workflow).toContain('if-no-files-found: error');
    expect(releaseValidator).toContain('ELECTRON_RUN_AS_NODE');
    expect(sqliteProbe).toContain('SELECT 42 AS value');
  });

  it('provides the project metadata required by Linux packagers', () => {
    const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, 'utf8')) as {
      dependenciesMeta?: Record<string, { injected?: boolean }>;
      homepage?: string;
    };
    const builderConfig = JSON.parse(readFileSync(electronBuilderConfigPath, 'utf8')) as {
      extraResources?: Array<{ from?: string; to?: string }>;
      linux?: { artifactName?: string; executableName?: string };
    };

    expect(desktopPackage.homepage).toBe('https://github.com/aiis2/risk-agent');
    expect(desktopPackage.dependenciesMeta?.['@risk-agent/server']?.injected).toBe(true);
    expect(builderConfig.linux?.artifactName).toBe('Risk-Agent-${version}-${arch}.${ext}');
    expect(builderConfig.linux?.executableName).toBe('risk-agent');
    expect(builderConfig.extraResources).toContainEqual({
      from: '../web/dist',
      to: 'web-dist',
    });
  });
});
