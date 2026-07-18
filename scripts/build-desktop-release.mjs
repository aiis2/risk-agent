import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = resolve(workspaceRoot, 'tmp');
const stageNamePrefix = 'npm-desktop-stage';
const stageRunId = `${Date.now()}-${process.pid}`;
const stageDir = resolve(tmpRoot, `${stageNamePrefix}-${stageRunId}`);
const latestPortableInfoPath = resolve(tmpRoot, `${stageNamePrefix}-latest.json`);
const platformArgument = process.argv.find((argument) => argument.startsWith('--platform='));
const platformName = platformArgument?.slice('--platform='.length) ?? 'windows';

if (!['windows', 'macos', 'linux'].includes(platformName)) {
  throw new Error(`unsupported desktop release platform: ${platformName}`);
}

function getExecutable(name) {
  if (process.platform === 'win32') {
    return `${name}.CMD`;
  }

  return name;
}

function findElectronBuilder() {
  const binaryName = process.platform === 'win32' ? 'electron-builder.CMD' : 'electron-builder';
  const candidates = [
    resolve(workspaceRoot, 'node_modules/.pnpm/node_modules/.bin', binaryName),
    resolve(workspaceRoot, 'node_modules/.bin', binaryName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('electron-builder executable not found in workspace node_modules');
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
      env: {
        ...process.env,
        ...options.env,
      },
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`required path not found: ${from}`);
  }

  await cp(from, to, { recursive: true });
}

async function copyFileTo(from, to) {
  if (!existsSync(from)) {
    throw new Error(`required path not found: ${from}`);
  }

  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function cleanupPreviousStages() {
  const entries = await readdir(tmpRoot, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  });

  const staleStageDirs = entries.filter((entry) => {
    if (!entry.isDirectory()) {
      return false;
    }

    return entry.name === stageNamePrefix || entry.name.startsWith(`${stageNamePrefix}-`);
  });

  await Promise.allSettled(
    staleStageDirs.map(async (entry) => {
      await rm(resolve(tmpRoot, entry.name), { recursive: true, force: true });
    }),
  );
}

async function buildWorkspacePackages() {
  const corepack = getExecutable('corepack');
  await run(corepack, ['pnpm', '--filter', '@risk-agent/core', 'build']);
  await run(corepack, ['pnpm', '--filter', '@risk-agent/server', 'build']);
  await run(corepack, ['pnpm', '--filter', '@risk-agent/web', 'build']);
  await run(corepack, ['pnpm', '--filter', '@risk-agent/desktop', 'build']);
}

async function prepareStageWorkspace() {
  await rm(stageDir, { recursive: true, force: true });
  await copyFileTo(resolve(workspaceRoot, 'package.json'), resolve(stageDir, 'package.json'));
  await copyFileTo(resolve(workspaceRoot, 'pnpm-lock.yaml'), resolve(stageDir, 'pnpm-lock.yaml'));
  await copyFileTo(resolve(workspaceRoot, 'pnpm-workspace.yaml'), resolve(stageDir, 'pnpm-workspace.yaml'));

  for (const packageName of ['core', 'server', 'web', 'desktop']) {
    const sourcePackageDir = resolve(workspaceRoot, 'packages', packageName);
    const stagePackageDir = resolve(stageDir, 'packages', packageName);
    await copyFileTo(resolve(sourcePackageDir, 'package.json'), resolve(stagePackageDir, 'package.json'));
    await copyDir(resolve(sourcePackageDir, 'dist'), resolve(stagePackageDir, 'dist'));
  }
  await copyDir(resolve(workspaceRoot, 'packages/desktop/build'), resolve(stageDir, 'packages/desktop/build'));
}

async function finalizeStagePackage() {
  const desktopPackage = await readJson(resolve(stageDir, 'packages/desktop/package.json'));
  const electronUpdaterPackage = await readJson(resolve(stageDir, 'node_modules/electron-updater/package.json'));

  await copyDir(resolve(stageDir, 'packages/desktop/dist'), resolve(stageDir, 'dist'));
  await copyDir(resolve(stageDir, 'packages/desktop/build'), resolve(stageDir, 'build'));
  await copyDir(resolve(stageDir, 'packages/web/dist'), resolve(stageDir, 'web-dist'));
  await copyFileTo(
    resolve(stageDir, 'packages/core/dist/storage/embedded/sqlite/schema.sql'),
    resolve(stageDir, 'schema.sql'),
  );

  await writeJson(resolve(stageDir, 'package.json'), {
    name: 'risk-agent-desktop-stage',
    version: desktopPackage.version,
    private: true,
    description: desktopPackage.description,
    author: desktopPackage.author,
    homepage: desktopPackage.homepage,
    main: './dist/main.js',
    dependencies: {
      '@risk-agent/server': desktopPackage.version,
      'electron-updater': electronUpdaterPackage.version,
    },
  });

  const builderConfig = {
    appId: 'ai.aiis2.risk-agent',
    productName: 'Risk Agent',
    copyright: 'Copyright © 2026 aiis2',
    electronVersion: '42.7.0',
    directories: {
      output: 'release',
      buildResources: 'build',
    },
    files: ['dist/**/*', 'node_modules/**/*', 'package.json'],
    extraResources: [
      { from: 'schema.sql', to: 'schema.sql' },
      { from: 'web-dist', to: 'web-dist' },
      {
        from: 'node_modules/@playwright/mcp',
        to: 'playwright-mcp',
        filter: ['**', '!**/__tests__/**', '!**/test/**', '!**/.git/**'],
      },
      {
        from: 'node_modules/playwright-core',
        to: 'playwright-mcp/node_modules/playwright-core',
        filter: ['**', '!**/__tests__/**', '!**/test/**', '!**/.git/**'],
      },
    ],
    asar: true,
    asarUnpack: ['**/*.node'],
    compression: 'normal',
    publish: null,
  };

  if (platformName === 'windows') {
    builderConfig.win = {
      target: [{ target: 'portable', arch: ['x64'] }],
      publisherName: 'aiis2',
      signingHashAlgorithms: ['sha256'],
    };
  } else if (platformName === 'macos') {
    builderConfig.mac = {
      target: [
        { target: 'dmg', arch: ['x64', 'arm64'] },
        { target: 'zip', arch: ['x64', 'arm64'] },
      ],
      icon: 'build/icon.icns',
      category: 'public.app-category.developer-tools',
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      notarize: false,
    };
  } else if (platformName === 'linux') {
    builderConfig.linux = {
      artifactName: 'Risk-Agent-${version}-${arch}.${ext}',
      executableName: 'risk-agent',
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      icon: 'build/icon.png',
      category: 'Development',
      maintainer: 'aiis2 <risk-agent@aiis2.local>',
    };
  }

  await writeJson(resolve(stageDir, 'electron-builder.json'), builderConfig);
}

async function installStageDependencies() {
  const corepack = getExecutable('corepack');
  await run(corepack, ['pnpm', '--filter', '@risk-agent/desktop...', 'install', '--prod', '--frozen-lockfile', '--config.node-linker=hoisted', '--ignore-scripts'], {
    cwd: stageDir,
    env: {
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    },
  });
}

async function buildRelease() {
  const electronBuilder = findElectronBuilder();
  const platformArguments = platformName === 'windows'
    ? ['--win', 'portable', '--x64']
    : platformName === 'macos'
      ? ['--mac']
      : ['--linux'];
  await run(electronBuilder, ['--projectDir', stageDir, ...platformArguments]);
}

async function validatePortable(artifactPath) {
  await run(process.execPath, [resolve(workspaceRoot, 'scripts', 'validate-desktop-portable.mjs')], {
    env: {
      RISK_AGENT_PORTABLE_EXE: artifactPath,
    },
  });
}

async function main() {
  const shouldValidate = process.argv.includes('--validate');
  const shouldBuildWorkspace = !process.argv.includes('--skip-build');

  await cleanupPreviousStages();
  if (shouldBuildWorkspace) {
    await buildWorkspacePackages();
  }
  await prepareStageWorkspace();
  await installStageDependencies();
  await finalizeStagePackage();
  await buildRelease();

  if (shouldValidate) {
    if (platformName !== 'windows') {
      throw new Error('--validate only supports the Windows portable release');
    }

    const artifactPath = join(stageDir, 'release', 'Risk Agent 0.1.0.exe');
    await validatePortable(artifactPath);
    await writeJson(latestPortableInfoPath, {
      stageDir,
      artifactPath,
      builtAt: new Date().toISOString(),
    });
  } else if (platformName === 'windows') {
    const artifactPath = join(stageDir, 'release', 'Risk Agent 0.1.0.exe');
    await writeJson(latestPortableInfoPath, {
      stageDir,
      artifactPath,
      builtAt: new Date().toISOString(),
    });
  }

  process.stdout.write(`\nDesktop ${platformName} stage directory: ${stageDir}\nRelease directory: ${join(stageDir, 'release')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
