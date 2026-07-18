#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopReleaseRoot = resolve(workspaceRoot, 'packages', 'desktop', 'release');
const temporaryRoot = resolve(workspaceRoot, 'tmp');
const sqliteProbePath = resolve(workspaceRoot, 'scripts', 'probe-packaged-sqlite.cjs');

function log(message) {
  process.stdout.write(`[desktop-release:validate] ${message}\n`);
}

async function readDirectory(directoryPath) {
  return readdir(directoryPath, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  });
}

async function findFiles(rootPath, predicate) {
  const matches = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const directoryPath = pending.pop();
    const entries = await readDirectory(directoryPath);

    for (const entry of entries) {
      const entryPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && predicate(entry.name)) {
        matches.push(entryPath);
      }
    }
  }

  return matches;
}

async function findStageReleaseRoots() {
  const releaseRoots = [];
  const entries = await readDirectory(temporaryRoot);

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('npm-desktop-stage-')) {
      continue;
    }

    releaseRoots.push(join(temporaryRoot, entry.name, 'release'));
  }

  return releaseRoots;
}

async function findMacApplications(releaseRoots) {
  const applications = [];

  for (const releaseRoot of releaseRoots) {
    const entries = await readDirectory(releaseRoot);
    for (const entry of entries) {
      const entryPath = join(releaseRoot, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        applications.push(entryPath);
        continue;
      }

      if (!entry.isDirectory() || !entry.name.startsWith('mac')) {
        continue;
      }

      const nestedEntries = await readDirectory(entryPath);
      for (const nestedEntry of nestedEntries) {
        if (nestedEntry.isDirectory() && nestedEntry.name.endsWith('.app')) {
          applications.push(join(entryPath, nestedEntry.name));
        }
      }
    }
  }

  return applications;
}

async function findWindowsPackages() {
  const packageRoots = [];
  const releaseRoots = await findStageReleaseRoots();

  for (const releaseRoot of releaseRoots) {
    const releaseEntries = await readDirectory(releaseRoot);

    for (const releaseEntry of releaseEntries) {
      if (releaseEntry.isDirectory() && /^win(?:-[^-]+)?-unpacked$/i.test(releaseEntry.name)) {
        packageRoots.push(join(releaseRoot, releaseEntry.name));
      }
    }
  }

  return { packageRoots, releaseRoots };
}

async function findLinuxPackages(releaseRoots) {
  const packageRoots = [];

  for (const releaseRoot of releaseRoots) {
    const entries = await readDirectory(releaseRoot);
    packageRoots.push(...entries
      .filter((entry) => entry.isDirectory() && /^linux(?:-[^-]+)?-unpacked$/i.test(entry.name))
      .map((entry) => join(releaseRoot, entry.name)));
  }

  return packageRoots;
}

async function requireInstallers(releaseRoots, requiredExtensions) {
  const installers = [];

  for (const releaseRoot of releaseRoots) {
    const entries = await readDirectory(releaseRoot);
    for (const entry of entries) {
      if (entry.isFile() && requiredExtensions.some((extension) => entry.name.endsWith(extension))) {
        installers.push(join(releaseRoot, entry.name));
      }
    }
  }

  for (const extension of requiredExtensions) {
    if (!installers.some((installerPath) => installerPath.endsWith(extension))) {
      throw new Error(`missing ${extension} installer under: ${releaseRoots.join(', ')}`);
    }
  }

  for (const installerPath of installers) {
    const installerStat = await stat(installerPath);
    if (installerStat.size === 0) {
      throw new Error(`installer is empty: ${installerPath}`);
    }

    log(`installer ${installerPath} (${installerStat.size} bytes)`);
  }
}

function resolvePackageArchitecture(packageRoot) {
  const outputDirectoryName = process.platform === 'darwin'
    ? basename(dirname(packageRoot))
    : basename(packageRoot);

  if (outputDirectoryName.includes('arm64')) {
    return 'arm64';
  }
  if (outputDirectoryName.includes('arm')) {
    return 'arm';
  }
  if (outputDirectoryName.includes('ia32')) {
    return 'ia32';
  }

  return 'x64';
}

function resolvePackagedExecutable(packageRoot) {
  if (process.platform === 'win32') {
    return join(packageRoot, 'Risk Agent.exe');
  }
  if (process.platform === 'darwin') {
    return join(packageRoot, 'Contents', 'MacOS', 'Risk Agent');
  }

  return join(packageRoot, 'risk-agent');
}

function resolveArchivedSqlitePackage(resourcesRoot, nativeModulePath) {
  const unpackedRoot = join(resourcesRoot, 'app.asar.unpacked');
  const nativePackageRoot = resolve(nativeModulePath, '..', '..', '..');
  const packageRelativePath = relative(unpackedRoot, nativePackageRoot);

  if (packageRelativePath === '..' || packageRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`native module is outside app.asar.unpacked: ${nativeModulePath}`);
  }

  return join(resourcesRoot, 'app.asar', packageRelativePath);
}

async function validateMacNativeArchitecture(nativeModulePaths, packageArchitecture) {
  for (const nativeModulePath of nativeModulePaths) {
    const { stdout } = await execFile('lipo', ['-archs', nativeModulePath], {
      timeout: 30000,
    });
    const architectures = stdout.trim().split(/\s+/);
    const expectedArchitecture = packageArchitecture === 'x64' ? 'x86_64' : packageArchitecture;
    if (!architectures.includes(expectedArchitecture)) {
      throw new Error(
        `native module architecture mismatch: expected ${expectedArchitecture}, got ${architectures.join(', ')} in ${nativeModulePath}`,
      );
    }

    log(`native architecture ${expectedArchitecture} ${nativeModulePath}`);
  }
}

async function probePackagedSqlite(packageRoot, resourcesRoot, nativeModulePaths) {
  const packageArchitecture = resolvePackageArchitecture(packageRoot);
  if (process.platform === 'darwin') {
    await validateMacNativeArchitecture(nativeModulePaths, packageArchitecture);
  }

  if (packageArchitecture !== process.arch) {
    log(`runtime probe skipped for ${packageArchitecture} package on ${process.arch} host: ${packageRoot}`);
    return;
  }

  const executablePath = resolvePackagedExecutable(packageRoot);
  const executableStat = await stat(executablePath).catch(() => null);
  if (!executableStat?.isFile()) {
    throw new Error(`packaged Electron executable is missing: ${executablePath}`);
  }

  const sqlitePackagePath = resolveArchivedSqlitePackage(resourcesRoot, nativeModulePaths[0]);
  const { stdout } = await execFile(executablePath, [sqliteProbePath, sqlitePackagePath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    timeout: 30000,
    windowsHide: true,
  });

  log(stdout.trim());
}

async function validatePackageRoot(packageRoot, resourcesRoot) {
  const webIndexPath = join(resourcesRoot, 'web-dist', 'index.html');
  const webIndexStat = await stat(webIndexPath).catch(() => null);
  if (!webIndexStat?.isFile() || webIndexStat.size === 0) {
    throw new Error(`packaged web entrypoint is missing or empty: ${webIndexPath}`);
  }

  const sqliteNativeModules = await findFiles(
    resourcesRoot,
    (fileName) => fileName === 'better_sqlite3.node',
  );
  if (sqliteNativeModules.length === 0) {
    throw new Error(`packaged better-sqlite3 native module is missing under: ${resourcesRoot}`);
  }

  log(`package ${packageRoot}`);
  log(`web entrypoint ${webIndexPath}`);
  for (const nativeModulePath of sqliteNativeModules) {
    log(`native module ${nativeModulePath}`);
  }

  await probePackagedSqlite(packageRoot, resourcesRoot, sqliteNativeModules);
}

async function main() {
  let packageRoots;
  let releaseRoots;
  let requiredExtensions;

  if (process.platform === 'win32') {
    ({ packageRoots, releaseRoots } = await findWindowsPackages());
    requiredExtensions = ['.exe'];
  } else if (process.platform === 'darwin') {
    releaseRoots = [desktopReleaseRoot, ...await findStageReleaseRoots()];
    packageRoots = await findMacApplications(releaseRoots);
    requiredExtensions = ['.dmg', '.zip'];
  } else if (process.platform === 'linux') {
    releaseRoots = [desktopReleaseRoot, ...await findStageReleaseRoots()];
    packageRoots = await findLinuxPackages(releaseRoots);
    requiredExtensions = ['.AppImage', '.deb'];
  } else {
    throw new Error(`unsupported release platform: ${process.platform}`);
  }

  if (packageRoots.length === 0) {
    throw new Error(`no unpacked desktop package found for ${process.platform}`);
  }

  await requireInstallers(releaseRoots, requiredExtensions);

  for (const packageRoot of packageRoots) {
    const resourcesRoot = process.platform === 'darwin'
      ? join(packageRoot, 'Contents', 'Resources')
      : join(packageRoot, 'resources');
    await validatePackageRoot(packageRoot, resourcesRoot);
  }

  log(`validated ${packageRoots.length} unpacked package(s)`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
