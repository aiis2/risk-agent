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

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const serverManifestPath = join(workspaceRoot, 'packages', 'server', 'package.json');

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

function resolvePackageChain(packageNames: string[]): ResolvedPackage {
  let anchorPath = serverManifestPath;
  let resolvedPackage: ResolvedPackage | undefined;

  for (const packageName of packageNames) {
    resolvedPackage = resolvePackage(anchorPath, packageName);
    anchorPath = resolvedPackage.manifestPath;
  }

  if (!resolvedPackage) throw new Error('Expected a non-empty package chain');
  return resolvedPackage;
}

function parseStableVersion(version: string): StableVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
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

function parseStableCaretRange(range: string): StableVersion {
  const match = /^\^(\d+\.\d+\.\d+)$/.exec(range);
  if (!match) throw new Error(`Expected a stable caret range, received ${range}`);
  return parseStableVersion(match[1]);
}

const directRuntimePackages = [
  {
    packageName: 'fastify',
    requiredMajor: 5,
    floor: [5, 8, 3] as StableVersion,
    ceiling: [6, 0, 0] as StableVersion
  },
  {
    packageName: '@fastify/cors',
    requiredMajor: 11,
    floor: [11, 0, 0] as StableVersion,
    ceiling: [12, 0, 0] as StableVersion
  },
  {
    packageName: '@fastify/websocket',
    requiredMajor: 11,
    floor: [11, 0, 0] as StableVersion,
    ceiling: [12, 0, 0] as StableVersion
  }
];

const fastUriChains = [
  ['@modelcontextprotocol/sdk', 'ajv', 'fast-uri'],
  ['@modelcontextprotocol/sdk', 'ajv-formats', 'ajv', 'fast-uri'],
  ['fastify', '@fastify/ajv-compiler', 'fast-uri'],
  ['fastify', '@fastify/ajv-compiler', 'ajv', 'fast-uri'],
  ['fastify', '@fastify/ajv-compiler', 'ajv-formats', 'ajv', 'fast-uri'],
  ['fastify', '@fastify/fast-json-stringify-compiler', 'fast-json-stringify', 'fast-uri'],
  ['fastify', '@fastify/fast-json-stringify-compiler', 'fast-json-stringify', 'ajv', 'fast-uri'],
  [
    'fastify',
    '@fastify/fast-json-stringify-compiler',
    'fast-json-stringify',
    'ajv-formats',
    'ajv',
    'fast-uri'
  ],
  ['fastify', 'fast-json-stringify', 'fast-uri'],
  ['fastify', 'fast-json-stringify', 'ajv', 'fast-uri'],
  ['fastify', 'fast-json-stringify', 'ajv-formats', 'ajv', 'fast-uri']
].map((packageNames) => ({
  chain: packageNames.join(' -> '),
  packageNames
}));

describe('direct runtime dependency contracts', () => {
  it.each(directRuntimePackages)(
    '$packageName declares a stable caret range on major $requiredMajor',
    ({ packageName, requiredMajor }) => {
      const serverManifest = readPackageJson(serverManifestPath);
      const declaredRange = serverManifest.dependencies?.[packageName];
      if (!declaredRange) throw new Error(`${packageName} is not declared by the server`);

      const [declaredMajor] = parseStableCaretRange(declaredRange);
      expect(
        declaredMajor,
        `${packageName} declares ${declaredRange} instead of a ${requiredMajor}.x caret range`
      ).toBe(requiredMajor);
    }
  );

  it.each(directRuntimePackages)(
    '$packageName stays on its patched installed major line',
    ({ packageName, floor, ceiling }) => {
      const installedManifest = resolvePackage(serverManifestPath, packageName).manifest;
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

      const parentPackageMetadata = resolvePackage(serverManifestPath, parentPackage);
      const installedManifest = resolvePackage(parentPackageMetadata.manifestPath, packageName).manifest;
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

describe('fast-uri dependency security floor', () => {
  it.each(fastUriChains)('$chain resolves a patched stable version', ({ chain, packageNames }) => {
    const installedManifest = resolvePackageChain(packageNames).manifest;
    if (!installedManifest.version) {
      throw new Error(`fast-uri package metadata does not declare a version through ${chain}`);
    }
    const installedVersion = parseStableVersion(installedManifest.version);
    const floor: StableVersion = [3, 1, 2];

    expect(
      compareVersion(installedVersion, floor),
      `${chain} resolves fast-uri@${installedManifest.version}, below ${floor.join('.')}`
    ).toBeGreaterThanOrEqual(0);
  });
});
