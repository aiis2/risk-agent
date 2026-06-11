import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = resolve(workspaceRoot, 'tmp');
const stageNamePrefix = 'npm-desktop-stage';
const stageRunId = `${Date.now()}-${process.pid}`;
const stageDir = resolve(tmpRoot, `${stageNamePrefix}-${stageRunId}`);
const latestPortableInfoPath = resolve(tmpRoot, `${stageNamePrefix}-latest.json`);

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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`required path not found: ${from}`);
  }

  await cp(from, to, { recursive: true });
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
  const pnpm = getExecutable('pnpm');
  await run(pnpm, ['--filter', '@risk-agent/core', 'build']);
  await run(pnpm, ['--filter', '@risk-agent/server', 'build']);
  await run(pnpm, ['--filter', '@risk-agent/web', 'build']);
  await run(pnpm, ['--filter', '@risk-agent/desktop', 'build']);
}

async function prepareStage() {
  const desktopPkg = await readJson(resolve(workspaceRoot, 'packages/desktop/package.json'));
  const serverPkg = await readJson(resolve(workspaceRoot, 'packages/server/package.json'));
  const corePkg = await readJson(resolve(workspaceRoot, 'packages/core/package.json'));

  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  await copyDir(resolve(workspaceRoot, 'packages/desktop/dist'), resolve(stageDir, 'dist'));
  await copyDir(resolve(workspaceRoot, 'packages/desktop/build'), resolve(stageDir, 'build'));
  await copyDir(resolve(workspaceRoot, 'packages/web/dist'), resolve(stageDir, 'web-dist'));
  await copyDir(resolve(workspaceRoot, 'packages/server/dist'), resolve(stageDir, 'vendor/server/dist'));
  await copyDir(resolve(workspaceRoot, 'packages/core/dist'), resolve(stageDir, 'vendor/core/dist'));

  await writeJson(resolve(stageDir, 'package.json'), {
    name: desktopPkg.name,
    version: desktopPkg.version,
    private: true,
    description: 'Risk Agent desktop staging package',
    author: 'aiis2',
    main: './dist/main.js',
    dependencies: {
      '@risk-agent/server': 'file:./vendor/server',
      'electron-updater': desktopPkg.dependencies['electron-updater'],
    },
  });

  await writeJson(resolve(stageDir, 'vendor/server/package.json'), {
    name: serverPkg.name,
    version: serverPkg.version,
    private: true,
    type: serverPkg.type,
    main: serverPkg.main,
    dependencies: {
      ...serverPkg.dependencies,
      '@risk-agent/core': 'file:../core',
    },
  });

  await writeJson(resolve(stageDir, 'vendor/core/package.json'), {
    name: corePkg.name,
    version: corePkg.version,
    private: true,
    type: corePkg.type,
    main: corePkg.main,
    types: corePkg.types,
    exports: corePkg.exports,
    dependencies: corePkg.dependencies,
  });

  await writeJson(resolve(stageDir, 'electron-builder.json'), {
    appId: 'ai.aiis2.risk-agent',
    productName: 'Risk Agent',
    copyright: 'Copyright © 2026 aiis2',
    electronVersion: '30.5.1',
    directories: {
      output: 'release',
      buildResources: 'build',
    },
    files: ['dist/**/*', 'node_modules/**/*', 'package.json'],
    extraResources: [{ from: 'web-dist', to: 'web-dist' }],
    asar: true,
    asarUnpack: ['**/*.node'],
    compression: 'normal',
    win: {
      target: [{ target: 'portable', arch: ['x64'] }],
      publisherName: 'aiis2',
      signingHashAlgorithms: ['sha256'],
    },
    publish: null,
  });
}

async function installStageDependencies() {
  const npm = getExecutable('npm');
  await run(npm, ['install', '--omit=dev', '--ignore-scripts'], {
    cwd: stageDir,
    env: {
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    },
  });
}

async function buildPortable() {
  const electronBuilder = findElectronBuilder();
  await run(electronBuilder, ['--projectDir', stageDir, '--win', 'portable', '--x64']);
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

  await cleanupPreviousStages();
  await buildWorkspacePackages();
  await prepareStage();
  await installStageDependencies();
  await buildPortable();

  const artifactPath = join(stageDir, 'release', 'Risk Agent 0.1.0.exe');
  if (shouldValidate) {
    await validatePortable(artifactPath);
  }

  await writeJson(latestPortableInfoPath, {
    stageDir,
    artifactPath,
    builtAt: new Date().toISOString(),
  });

  process.stdout.write(`\nPortable stage directory: ${stageDir}\nPortable executable: ${artifactPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});