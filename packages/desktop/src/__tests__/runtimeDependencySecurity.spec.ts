import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  dependencies?: Record<string, string>;
  name?: string;
  version?: string;
}

interface ResolvedPackage {
  manifest: PackageJson;
  manifestPath: string;
}

type StableVersion = [number, number, number];

const desktopManifestPath = resolve(__dirname, '../../package.json');

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function findPackageManifest(resolvedPath: string, packageName: string): ResolvedPackage {
  let directory = dirname(resolvedPath);

  while (true) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = readPackageJson(manifestPath);
      if (manifest.name === packageName) return { manifest, manifestPath };
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Unable to locate package metadata for ${packageName}`);
    }
    directory = parent;
  }
}

function resolvePackage(anchorPath: string, packageName: string): ResolvedPackage {
  const anchorRequire = createRequire(anchorPath);
  let resolvedPath: string;

  try {
    resolvedPath = anchorRequire.resolve(`${packageName}/package.json`);
  } catch {
    resolvedPath = anchorRequire.resolve(packageName);
  }

  return findPackageManifest(resolvedPath, packageName);
}

function parseStableVersion(version: string): StableVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) {
    throw new Error(`Expected a stable semantic version, received ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('desktop updater dependency security floor', () => {
  it('resolves a patched js-yaml release through electron-updater', () => {
    const desktopManifest = readPackageJson(desktopManifestPath);
    expect(desktopManifest.dependencies?.['electron-updater']).toBeDefined();

    const updaterPackage = resolvePackage(desktopManifestPath, 'electron-updater');
    expect(updaterPackage.manifest.dependencies?.['js-yaml']).toBeDefined();

    const jsYamlManifest = resolvePackage(updaterPackage.manifestPath, 'js-yaml').manifest;
    if (!jsYamlManifest.version) {
      throw new Error('js-yaml package metadata does not declare a version');
    }

    const installedVersion = parseStableVersion(jsYamlManifest.version);
    const floor: StableVersion = [4, 3, 0];
    const ceiling: StableVersion = [5, 0, 0];

    expect(
      compareVersion(installedVersion, floor),
      `electron-updater -> js-yaml resolves js-yaml@${jsYamlManifest.version}, below ${floor.join('.')}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      compareVersion(installedVersion, ceiling),
      `electron-updater -> js-yaml crossed into ${ceiling[0]}.x at ${jsYamlManifest.version}`
    ).toBeLessThan(0);
  });
});
