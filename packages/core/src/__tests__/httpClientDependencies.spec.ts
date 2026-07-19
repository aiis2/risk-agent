import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  dependencies?: Record<string, string>;
  version?: string;
}

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

function parseStableVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version, received ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('HTTP client dependency security floors', () => {
  it.each([
    {
      packageName: 'axios',
      owner: 'web',
      expectedRange: '^1.16.0',
      floor: [1, 16, 0] as [number, number, number],
      ceiling: [2, 0, 0] as [number, number, number],
    },
    {
      packageName: 'undici',
      owner: 'core',
      expectedRange: '^6.27.0',
      floor: [6, 27, 0] as [number, number, number],
      ceiling: [7, 0, 0] as [number, number, number],
    },
  ])(
    '$packageName stays on its patched major line',
    ({ packageName, owner, expectedRange, floor, ceiling }) => {
      const ownerManifestPath = join(workspaceRoot, 'packages', owner, 'package.json');
      const ownerManifest = readPackageJson(ownerManifestPath);
      expect(ownerManifest.dependencies?.[packageName]).toBe(expectedRange);

      const ownerRequire = createRequire(ownerManifestPath);
      const installedManifest = readPackageJson(ownerRequire.resolve(`${packageName}/package.json`));
      if (!installedManifest.version) {
        throw new Error(`${packageName} package metadata does not declare a version`);
      }
      const installedVersion = parseStableVersion(installedManifest.version);

      expect(
        compareVersion(installedVersion, floor),
        `${packageName}@${installedManifest.version} is below ${floor.join('.')}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        compareVersion(installedVersion, ceiling),
        `${packageName}@${installedManifest.version} crossed into ${ceiling[0]}.x`,
      ).toBeLessThan(0);
    },
  );
});
