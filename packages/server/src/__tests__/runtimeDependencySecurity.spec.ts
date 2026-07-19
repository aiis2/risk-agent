import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  dependencies?: Record<string, string>;
  name?: string;
  version?: string;
}

type StableVersion = [number, number, number];

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const serverManifestPath = join(workspaceRoot, 'packages', 'server', 'package.json');

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function findPackageManifest(entryPoint: string, packageName: string): PackageJson {
  let directory = dirname(entryPoint);

  while (true) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = readPackageJson(manifestPath);
      if (manifest.name === packageName) return manifest;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Unable to locate package metadata for ${packageName}`);
    }
    directory = parent;
  }
}

function parseStableVersion(version: string): StableVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version, received ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: StableVersion, right: StableVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('runtime transport dependency security floors', () => {
  it.each([
    {
      packageName: 'hono',
      parentPackage: '@modelcontextprotocol/sdk',
      floor: [4, 12, 25] as StableVersion,
      ceiling: [5, 0, 0] as StableVersion
    },
    {
      packageName: 'ws',
      parentPackage: '@fastify/websocket',
      floor: [8, 21, 0] as StableVersion,
      ceiling: [9, 0, 0] as StableVersion
    }
  ])(
    '$packageName stays on its patched major line through $parentPackage',
    ({ packageName, parentPackage, floor, ceiling }) => {
      const serverManifest = readPackageJson(serverManifestPath);
      expect(serverManifest.dependencies?.[parentPackage]).toBeDefined();

      const serverRequire = createRequire(serverManifestPath);
      const parentManifestPath = serverRequire.resolve(`${parentPackage}/package.json`);
      const parentRequire = createRequire(parentManifestPath);
      const installedManifest = findPackageManifest(parentRequire.resolve(packageName), packageName);
      if (!installedManifest.version) {
        throw new Error(`${packageName} package metadata does not declare a version`);
      }
      const installedVersion = parseStableVersion(installedManifest.version);

      expect(
        compareVersion(installedVersion, floor),
        `${packageName}@${installedManifest.version} is below ${floor.join('.')}`
      ).toBeGreaterThanOrEqual(0);
      expect(
        compareVersion(installedVersion, ceiling),
        `${packageName}@${installedManifest.version} crossed into ${ceiling[0]}.x`
      ).toBeLessThan(0);
    }
  );
});
