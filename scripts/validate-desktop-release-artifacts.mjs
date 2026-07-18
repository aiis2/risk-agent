#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopReleaseRoot = resolve(workspaceRoot, 'packages', 'desktop', 'release');
const temporaryRoot = resolve(workspaceRoot, 'tmp');

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

async function findMacApplications() {
  const applications = [];
  const entries = await readDirectory(desktopReleaseRoot);

  for (const entry of entries) {
    const entryPath = join(desktopReleaseRoot, entry.name);
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

  return applications;
}

async function findWindowsPackages() {
  const packageRoots = [];
  const releaseRoots = [];
  const entries = await readDirectory(temporaryRoot);

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('npm-desktop-stage-')) {
      continue;
    }

    const releaseRoot = join(temporaryRoot, entry.name, 'release');
    const releaseEntries = await readDirectory(releaseRoot);
    releaseRoots.push(releaseRoot);

    for (const releaseEntry of releaseEntries) {
      if (releaseEntry.isDirectory() && /^win(?:-[^-]+)?-unpacked$/i.test(releaseEntry.name)) {
        packageRoots.push(join(releaseRoot, releaseEntry.name));
      }
    }
  }

  return { packageRoots, releaseRoots };
}

async function findLinuxPackages() {
  const entries = await readDirectory(desktopReleaseRoot);
  return entries
    .filter((entry) => entry.isDirectory() && /^linux(?:-[^-]+)?-unpacked$/i.test(entry.name))
    .map((entry) => join(desktopReleaseRoot, entry.name));
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
}

async function main() {
  let packageRoots;
  let releaseRoots;
  let requiredExtensions;

  if (process.platform === 'win32') {
    ({ packageRoots, releaseRoots } = await findWindowsPackages());
    requiredExtensions = ['.exe'];
  } else if (process.platform === 'darwin') {
    packageRoots = await findMacApplications();
    releaseRoots = [desktopReleaseRoot];
    requiredExtensions = ['.dmg', '.zip'];
  } else if (process.platform === 'linux') {
    packageRoots = await findLinuxPackages();
    releaseRoots = [desktopReleaseRoot];
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
