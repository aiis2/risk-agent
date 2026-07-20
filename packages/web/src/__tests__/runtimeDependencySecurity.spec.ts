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

interface ResolvedPackage {
  manifest: PackageJson;
  manifestPath: string;
}

type StableVersion = [number, number, number];

const webManifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));

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

describe('runtime sanitizer dependency security floor', () => {
  it('resolves a patched DOMPurify release through Mermaid', () => {
    const webManifest = readPackageJson(webManifestPath);
    expect(webManifest.dependencies?.mermaid).toBeDefined();

    const mermaidPackage = resolvePackage(webManifestPath, 'mermaid');
    expect(mermaidPackage.manifest.dependencies?.dompurify).toBeDefined();

    const dompurifyManifest = resolvePackage(mermaidPackage.manifestPath, 'dompurify').manifest;
    if (!dompurifyManifest.version) {
      throw new Error('dompurify package metadata does not declare a version');
    }

    const installedVersion = parseStableVersion(dompurifyManifest.version);
    const floor: StableVersion = [3, 4, 11];
    const ceiling: StableVersion = [4, 0, 0];

    expect(
      compareVersion(installedVersion, floor),
      `mermaid -> dompurify resolves dompurify@${dompurifyManifest.version}, below ${floor.join('.')}`
    ).toBeGreaterThanOrEqual(0);
    expect(
      compareVersion(installedVersion, ceiling),
      `mermaid -> dompurify crossed into ${ceiling[0]}.x at ${dompurifyManifest.version}`
    ).toBeLessThan(0);
  });
});
