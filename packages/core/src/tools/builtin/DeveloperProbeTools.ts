import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createLocalProcessSandboxHost } from '../../sandbox/LocalProcessSandboxHost.js';
import type { LocalProcessSandboxRequest, SandboxExecutionContext, SandboxPolicy } from '../../sandbox/SandboxRuntime.js';
import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';

type WorkspaceProbeOperation = 'pwd' | 'list' | 'read' | 'stat' | 'tree' | 'search';
type PackageProbeOperation = 'summary' | 'scripts' | 'dependencies';
type PackageManagerProbeOperation = 'detect' | 'lockfile' | 'workspaces';
type PackageManagerWriteOperation = 'install' | 'add' | 'remove';
type ProcessProbeOperation = 'versions' | 'env' | 'which';
type SupportedPackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
type EntryKind = 'directory' | 'file' | 'symlink' | 'other';

interface WorkspaceProbeInput {
  operation: WorkspaceProbeOperation;
  cwd?: string;
  targetPath?: string;
  maxEntries?: number;
  maxChars?: number;
  maxDepth?: number;
  maxMatches?: number;
  query?: string;
}

interface PackageProbeInput {
  operation: PackageProbeOperation;
  cwd?: string;
  filePath?: string;
}

interface PackageManagerProbeInput {
  operation: PackageManagerProbeOperation;
  cwd?: string;
  filePath?: string;
}

interface PackageManagerWriteInput {
  operation: PackageManagerWriteOperation;
  cwd?: string;
  filePath?: string;
  packages?: string[];
  dev?: boolean;
  exact?: boolean;
}

interface ProcessProbeInput {
  operation: ProcessProbeOperation;
  cwd?: string;
  command?: string;
  keys?: string[];
}

interface ProbeExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  cancelled?: boolean;
  timedOut?: boolean;
  error?: string;
}

interface PackageManagerDetails {
  cwd: string;
  rootPath: string;
  filePath: string;
  packageManager: {
    name: string | null;
    versionRange: string | null;
    field: string | null;
    lockfile: string | null;
    lockfilePath: string | null;
    workspacesCount: number;
  };
  workspaceConfig: {
    patterns: string[];
    source: string | null;
    configPath: string | null;
  };
}

const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.next', '.turbo', 'coverage', 'dist', 'build']);
const LOCKFILE_CANDIDATES = [
  { manager: 'pnpm', file: 'pnpm-lock.yaml' },
  { manager: 'npm', file: 'package-lock.json' },
  { manager: 'yarn', file: 'yarn.lock' },
  { manager: 'bun', file: 'bun.lockb' },
  { manager: 'bun', file: 'bun.lock' },
] as const;

const DEVELOPER_PROBE_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');

const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '.next', '.turbo', 'coverage', 'dist', 'build']);
const LOCKFILE_CANDIDATES = [
  { manager: 'pnpm', file: 'pnpm-lock.yaml' },
  { manager: 'npm', file: 'package-lock.json' },
  { manager: 'yarn', file: 'yarn.lock' },
  { manager: 'bun', file: 'bun.lockb' },
  { manager: 'bun', file: 'bun.lock' },
];

function toKind(stats) {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function normalizeRelativePath(rootPath, targetPath) {
  const value = path.relative(rootPath, targetPath) || '.';
  return value.split(path.sep).join('/');
}

function shouldSkipDirectory(name) {
  return SKIPPED_DIRECTORY_NAMES.has(name);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(Number(value || minimum), maximum));
}

function resolveTarget(cwd, targetPath) {
  return path.resolve(cwd || process.cwd(), targetPath || '.');
}

function resolveCommandPath(command) {
  const pathValue = process.env.PATH || '';
  const candidates = process.platform === 'win32'
    ? Array.from(new Set((process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).flatMap((ext) => [command, command + ext.toLowerCase(), command + ext])))
    : [command];

  for (const segment of pathValue.split(path.delimiter)) {
    if (!segment) continue;
    for (const candidateName of candidates) {
      const candidate = path.join(segment, candidateName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function buildWorkspaceTree(targetPath, maxDepth, maxEntries) {
  const stats = fs.statSync(targetPath);
  if (!stats.isDirectory()) {
    return [{ name: path.basename(targetPath), kind: toKind(stats), size: stats.size }];
  }

  const walk = (currentPath, depth) => fs.readdirSync(currentPath, 'utf8')
    .filter((name) => !shouldSkipDirectory(name))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maxEntries)
    .map((name) => {
      const fullPath = path.join(currentPath, name);
      const currentStats = fs.statSync(fullPath);
      const node = {
        name,
        kind: toKind(currentStats),
        size: currentStats.size,
      };
      if (currentStats.isDirectory() && depth < maxDepth) {
        node.children = walk(fullPath, depth + 1);
      }
      return node;
    });

  return walk(targetPath, 1);
}

function readTextMatchPreview(filePath, query, maxChars) {
  const stats = fs.statSync(filePath);
  if (stats.size > 256000) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return null;
  }

  const content = buffer.toString('utf8');
  const matchIndex = content.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex < 0) {
    return null;
  }

  const start = Math.max(0, matchIndex - Math.floor(maxChars / 3));
  const end = Math.min(content.length, start + maxChars);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function searchWorkspace(cwd, targetPath, query, maxMatches, maxChars) {
  if (!query || !query.trim()) {
    throw new Error('query_required');
  }

  const queryLower = query.toLowerCase();
  const matches = [];
  const queue = [targetPath];

  while (queue.length > 0 && matches.length < maxMatches) {
    const currentPath = queue.shift();
    if (!currentPath) {
      break;
    }

    const stats = fs.statSync(currentPath);
    const workspacePath = normalizeRelativePath(cwd, currentPath);
    if (stats.isDirectory()) {
      if (workspacePath !== '.' && workspacePath.toLowerCase().includes(queryLower)) {
        matches.push({ path: workspacePath, kind: 'directory', reason: 'path' });
        if (matches.length >= maxMatches) {
          break;
        }
      }

      const children = fs.readdirSync(currentPath, 'utf8')
        .filter((name) => !shouldSkipDirectory(name))
        .sort((left, right) => left.localeCompare(right));
      for (const name of children) {
        queue.push(path.join(currentPath, name));
      }
      continue;
    }

    if (workspacePath.toLowerCase().includes(queryLower)) {
      matches.push({ path: workspacePath, kind: 'file', reason: 'path' });
      continue;
    }

    const preview = readTextMatchPreview(currentPath, query, maxChars);
    if (preview) {
      matches.push({ path: workspacePath, kind: 'file', reason: 'content', preview });
    }
  }

  return { cwd, targetPath, query, matches };
}

function parsePackageManagerField(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { name: null, versionRange: null, field: null };
  }

  const [name, ...rest] = value.trim().split('@');
  return {
    name: name || null,
    versionRange: rest.length > 0 ? rest.join('@') : null,
    field: value.trim(),
  };
}

function detectLockfile(rootPath) {
  for (const candidate of LOCKFILE_CANDIDATES) {
    const filePath = path.join(rootPath, candidate.file);
    if (fs.existsSync(filePath)) {
      return { name: candidate.manager, file: candidate.file, filePath };
    }
  }
  return null;
}

function readPnpmWorkspacePatterns(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^[-\s]+/, '').replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function resolveWorkspacePatterns(pkg, rootPath) {
  if (Array.isArray(pkg.workspaces)) {
    return {
      patterns: pkg.workspaces.filter((item) => typeof item === 'string'),
      source: 'package.json',
      configPath: path.join(rootPath, 'package.json'),
    };
  }

  if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    return {
      patterns: pkg.workspaces.packages.filter((item) => typeof item === 'string'),
      source: 'package.json',
      configPath: path.join(rootPath, 'package.json'),
    };
  }

  const pnpmWorkspacePath = path.join(rootPath, 'pnpm-workspace.yaml');
  const patterns = readPnpmWorkspacePatterns(pnpmWorkspacePath);
  if (patterns.length > 0) {
    return {
      patterns,
      source: 'pnpm-workspace.yaml',
      configPath: pnpmWorkspacePath,
    };
  }

  return {
    patterns: [],
    source: null,
    configPath: null,
  };
}

function getPackageManagerDetails(cwd, filePath) {
  const resolvedFilePath = path.resolve(cwd, filePath || 'package.json');
  const rootPath = path.dirname(resolvedFilePath);
  const pkg = JSON.parse(fs.readFileSync(resolvedFilePath, 'utf8'));
  const parsedField = parsePackageManagerField(pkg.packageManager);
  const lockfile = detectLockfile(rootPath);
  const workspaceConfig = resolveWorkspacePatterns(pkg, rootPath);
  return {
    cwd,
    rootPath,
    filePath: resolvedFilePath,
    packageManager: {
      name: parsedField.name || (lockfile ? lockfile.name : null),
      versionRange: parsedField.versionRange,
      field: parsedField.field,
      lockfile: lockfile ? lockfile.file : null,
      lockfilePath: lockfile ? normalizeRelativePath(cwd, lockfile.filePath) : null,
      workspacesCount: workspaceConfig.patterns.length,
    },
    workspaceConfig,
  };
}

function workspaceProbe(input) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const targetPath = resolveTarget(cwd, input.targetPath);

  switch (input.operation) {
    case 'pwd':
      return { cwd };
    case 'list': {
      const maxEntries = clamp(input.maxEntries, 1, 200);
      const entries = fs.readdirSync(targetPath, 'utf8')
        .slice(0, maxEntries)
        .map((name) => {
          const fullPath = path.join(targetPath, name);
          const stats = fs.statSync(fullPath);
          return { name, kind: toKind(stats), size: stats.size };
        });
      return { cwd, targetPath, entries };
    }
    case 'read': {
      const maxChars = clamp(input.maxChars, 200, 40000);
      const content = fs.readFileSync(targetPath, 'utf8');
      return {
        cwd,
        targetPath,
        content: content.slice(0, maxChars),
        truncated: content.length > maxChars,
      };
    }
    case 'stat': {
      const stats = fs.statSync(targetPath);
      return {
        cwd,
        targetPath,
        stat: {
          kind: toKind(stats),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        },
      };
    }
    case 'tree': {
      const maxDepth = clamp(input.maxDepth, 1, 6);
      const maxEntries = clamp(input.maxEntries, 1, 60);
      return {
        cwd,
        targetPath,
        tree: buildWorkspaceTree(targetPath, maxDepth, maxEntries),
      };
    }
    case 'search': {
      const maxMatches = clamp(input.maxMatches, 1, 100);
      const maxChars = clamp(input.maxChars, 80, 400);
      return searchWorkspace(cwd, targetPath, input.query, maxMatches, maxChars);
    }
    default:
      throw new Error('unknown_workspace_probe_operation');
  }
}

function packageProbe(input) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const filePath = path.resolve(cwd, input.filePath || 'package.json');
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const dependencyCount = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]
    .filter(Boolean)
    .reduce((sum, bucket) => sum + Object.keys(bucket).length, 0);

  switch (input.operation) {
    case 'summary':
      return {
        cwd,
        filePath,
        packageJson: {
          name: pkg.name || null,
          version: pkg.version || null,
          packageManager: pkg.packageManager || null,
          scriptsCount: Object.keys(pkg.scripts || {}).length,
          dependencyCount,
          workspaces: Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces && Array.isArray(pkg.workspaces.packages) ? pkg.workspaces.packages : null),
        },
      };
    case 'scripts':
      return {
        cwd,
        filePath,
        packageJson: {
          name: pkg.name || null,
          scripts: pkg.scripts || {},
        },
      };
    case 'dependencies':
      return {
        cwd,
        filePath,
        packageJson: {
          name: pkg.name || null,
          dependencies: pkg.dependencies || {},
          devDependencies: pkg.devDependencies || {},
          peerDependencies: pkg.peerDependencies || {},
          optionalDependencies: pkg.optionalDependencies || {},
        },
      };
    default:
      throw new Error('unknown_package_probe_operation');
  }
}

function packageManagerProbe(input) {
  const cwd = path.resolve(input.cwd || process.cwd());
  const details = getPackageManagerDetails(cwd, input.filePath);

  switch (input.operation) {
    case 'detect':
      return {
        cwd,
        rootPath: details.rootPath,
        filePath: details.filePath,
        packageManager: details.packageManager,
      };
    case 'lockfile':
      return {
        cwd,
        rootPath: details.rootPath,
        lockfile: {
          name: details.packageManager.lockfile,
          path: details.packageManager.lockfilePath,
          manager: details.packageManager.name,
        },
      };
    case 'workspaces':
      return {
        cwd,
        rootPath: details.rootPath,
        workspaces: {
          source: details.workspaceConfig.source,
          configPath: details.workspaceConfig.configPath ? normalizeRelativePath(cwd, details.workspaceConfig.configPath) : null,
          patterns: details.workspaceConfig.patterns,
        },
      };
    default:
      throw new Error('unknown_package_manager_probe_operation');
  }
}

function processProbe(input) {
  const cwd = path.resolve(input.cwd || process.cwd());
  switch (input.operation) {
    case 'versions':
      return {
        cwd,
        processInfo: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
        },
      };
    case 'env': {
      const keys = Array.isArray(input.keys) && input.keys.length > 0 ? input.keys : ['PATH', 'NODE_ENV', 'HOME', 'USERPROFILE'];
      const environment = {};
      for (const key of keys) {
        environment[key] = process.env[key] || null;
      }
      return { cwd, environment };
    }
    case 'which':
      if (!input.command || !input.command.trim()) {
        throw new Error('command_required');
      }
      return {
        cwd,
        command: input.command,
        resolvedPath: resolveCommandPath(input.command),
      };
    default:
      throw new Error('unknown_process_probe_operation');
  }
}

const payload = JSON.parse(process.argv[1]);
let result;
if (payload.kind === 'workspace') result = workspaceProbe(payload.input || {});
else if (payload.kind === 'package') result = packageProbe(payload.input || {});
else if (payload.kind === 'packageManager') result = packageManagerProbe(payload.input || {});
else if (payload.kind === 'process') result = processProbe(payload.input || {});
else throw new Error('unknown_probe_kind');
process.stdout.write(JSON.stringify(result));
`;

function resolveProbeCwd(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

function toEntryKind(stats: Stats): EntryKind {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function normalizeWorkspacePath(cwd: string, targetPath: string): string {
  return (relative(cwd, targetPath) || '.').split('\\').join('/');
}

function shouldSkipDirectory(name: string): boolean {
  return SKIPPED_DIRECTORY_NAMES.has(name);
}

function clampNumber(value: number | undefined, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value ?? minimum, maximum));
}

function resolveWorkspaceTarget(cwd: string, targetPath?: string): string {
  if (!targetPath) {
    return cwd;
  }
  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(cwd, targetPath);
}

function resolveCommandPath(command: string): string | null {
  const pathValue = process.env.PATH ?? '';
  const candidates = process.platform === 'win32'
    ? Array.from(
      new Set(
        (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
          .flatMap((ext) => [command, `${command}${ext.toLowerCase()}`, `${command}${ext}`]),
      ),
    )
    : [command];

  for (const segment of pathValue.split(delimiter)) {
    if (!segment) continue;
    for (const candidateName of candidates) {
      const candidate = join(segment, candidateName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function buildWorkspaceTree(targetPath: string, maxDepth: number, maxEntries: number): Array<Record<string, unknown>> {
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    return [{ name: basename(targetPath), kind: toEntryKind(stats), size: stats.size }];
  }

  const walk = (currentPath: string, depth: number): Array<Record<string, unknown>> => readdirSync(currentPath, 'utf8')
    .filter((name) => !shouldSkipDirectory(name))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maxEntries)
    .map((name) => {
      const fullPath = join(currentPath, name);
      const currentStats = statSync(fullPath);
      const node: Record<string, unknown> = {
        name,
        kind: toEntryKind(currentStats),
        size: currentStats.size,
      };
      if (currentStats.isDirectory() && depth < maxDepth) {
        node.children = walk(fullPath, depth + 1);
      }
      return node;
    });

  return walk(targetPath, 1);
}

function readTextMatchPreview(filePath: string, query: string, maxChars: number): string | null {
  const stats = statSync(filePath);
  if (stats.size > 256_000) {
    return null;
  }

  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) {
    return null;
  }

  const content = buffer.toString('utf8');
  const matchIndex = content.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex < 0) {
    return null;
  }

  const start = Math.max(0, matchIndex - Math.floor(maxChars / 3));
  const end = Math.min(content.length, start + maxChars);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function searchWorkspace(cwd: string, targetPath: string, query: string | undefined, maxMatches: number, maxChars: number): Record<string, unknown> {
  if (!query?.trim()) {
    throw new Error('query_required');
  }

  const queryLower = query.toLowerCase();
  const matches: Array<Record<string, unknown>> = [];
  const queue = [targetPath];

  while (queue.length > 0 && matches.length < maxMatches) {
    const currentPath = queue.shift();
    if (!currentPath) {
      break;
    }

    const stats = statSync(currentPath);
    const workspacePath = normalizeWorkspacePath(cwd, currentPath);
    if (stats.isDirectory()) {
      if (workspacePath !== '.' && workspacePath.toLowerCase().includes(queryLower)) {
        matches.push({ path: workspacePath, kind: 'directory', reason: 'path' });
        if (matches.length >= maxMatches) {
          break;
        }
      }

      const children = readdirSync(currentPath, 'utf8')
        .filter((name) => !shouldSkipDirectory(name))
        .sort((left, right) => left.localeCompare(right));
      for (const name of children) {
        queue.push(join(currentPath, name));
      }
      continue;
    }

    if (workspacePath.toLowerCase().includes(queryLower)) {
      matches.push({ path: workspacePath, kind: 'file', reason: 'path' });
      continue;
    }

    const preview = readTextMatchPreview(currentPath, query, maxChars);
    if (preview) {
      matches.push({ path: workspacePath, kind: 'file', reason: 'content', preview });
    }
  }

  return { cwd, targetPath, query, matches };
}

function parsePackageManagerField(value: string | null): { name: string | null; versionRange: string | null; field: string | null } {
  if (!value?.trim()) {
    return { name: null, versionRange: null, field: null };
  }

  const [name, ...rest] = value.trim().split('@');
  return {
    name: name || null,
    versionRange: rest.length > 0 ? rest.join('@') : null,
    field: value.trim(),
  };
}

function detectLockfile(rootPath: string): { name: string; file: string; filePath: string } | null {
  for (const candidate of LOCKFILE_CANDIDATES) {
    const filePath = join(rootPath, candidate.file);
    if (existsSync(filePath)) {
      return { name: candidate.manager, file: candidate.file, filePath };
    }
  }
  return null;
}

function readPnpmWorkspacePatterns(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^[-\s]+/, '').replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function resolveWorkspacePatterns(pkg: Record<string, unknown>, rootPath: string): PackageManagerDetails['workspaceConfig'] {
  if (Array.isArray(pkg.workspaces)) {
    return {
      patterns: pkg.workspaces.filter((item): item is string => typeof item === 'string'),
      source: 'package.json',
      configPath: join(rootPath, 'package.json'),
    };
  }

  const workspaceRecord = toRecord(pkg.workspaces);
  if (Array.isArray(workspaceRecord.packages)) {
    return {
      patterns: workspaceRecord.packages.filter((item): item is string => typeof item === 'string'),
      source: 'package.json',
      configPath: join(rootPath, 'package.json'),
    };
  }

  const pnpmWorkspacePath = join(rootPath, 'pnpm-workspace.yaml');
  const patterns = readPnpmWorkspacePatterns(pnpmWorkspacePath);
  if (patterns.length > 0) {
    return {
      patterns,
      source: 'pnpm-workspace.yaml',
      configPath: pnpmWorkspacePath,
    };
  }

  return { patterns: [], source: null, configPath: null };
}

function getPackageManagerDetails(cwd: string, filePath?: string): PackageManagerDetails {
  const resolvedFilePath = resolveWorkspaceTarget(cwd, filePath ?? 'package.json');
  const rootPath = dirname(resolvedFilePath);
  const pkg = JSON.parse(readFileSync(resolvedFilePath, 'utf8')) as Record<string, unknown>;
  const parsedField = parsePackageManagerField(typeof pkg.packageManager === 'string' ? pkg.packageManager : null);
  const lockfile = detectLockfile(rootPath);
  const workspaceConfig = resolveWorkspacePatterns(pkg, rootPath);

  return {
    cwd,
    rootPath,
    filePath: resolvedFilePath,
    packageManager: {
      name: parsedField.name ?? lockfile?.name ?? null,
      versionRange: parsedField.versionRange,
      field: parsedField.field,
      lockfile: lockfile?.file ?? null,
      lockfilePath: lockfile ? normalizeWorkspacePath(cwd, lockfile.filePath) : null,
      workspacesCount: workspaceConfig.patterns.length,
    },
    workspaceConfig,
  };
}

function normalizePackageManagerName(name: string | null): SupportedPackageManager {
  switch (name) {
    case 'pnpm':
    case 'npm':
    case 'yarn':
    case 'bun':
      return name;
    default:
      return 'npm';
  }
}

function normalizeRequestedPackages(packages: string[] | undefined): string[] {
  return (packages ?? []).map((value) => value.trim()).filter(Boolean);
}

function buildPackageManagerArgs(
  manager: SupportedPackageManager,
  input: PackageManagerWriteInput,
): string[] {
  const packages = normalizeRequestedPackages(input.packages);

  if (input.operation === 'install') {
    if (packages.length > 0) {
      throw new Error('install_packages_not_supported');
    }
    return ['install'];
  }

  if (packages.length === 0) {
    throw new Error('packages_required');
  }

  const args = manager === 'npm'
    ? [input.operation === 'add' ? 'install' : 'uninstall', ...packages]
    : [input.operation === 'add' ? 'add' : 'remove', ...packages];

  if (input.operation === 'add' && input.dev) {
    args.push(manager === 'bun' ? '--development' : manager === 'yarn' ? '--dev' : '--save-dev');
  }

  if (input.operation === 'add' && input.exact) {
    args.push(manager === 'yarn' || manager === 'bun' ? '--exact' : '--save-exact');
  }

  return args;
}

function buildPackageManagerWriteRequest(input: PackageManagerWriteInput, cwd: string): {
  details: PackageManagerDetails;
  manager: SupportedPackageManager;
  args: string[];
  request: LocalProcessSandboxRequest;
} {
  const details = getPackageManagerDetails(cwd, input.filePath);
  const manager = normalizePackageManagerName(details.packageManager.name);
  const args = buildPackageManagerArgs(manager, input);

  return {
    details,
    manager,
    args,
    request: {
      kind: 'local-process',
      command: manager,
      args,
      cwd: details.rootPath,
      description: `Execute ${manager} ${args.join(' ')} in ${normalizeWorkspacePath(cwd, details.rootPath)}`,
    },
  };
}

function runWorkspaceProbe(input: WorkspaceProbeInput): Record<string, unknown> {
  const cwd = resolveProbeCwd(input.cwd);
  const targetPath = resolveWorkspaceTarget(cwd, input.targetPath);

  switch (input.operation) {
    case 'pwd':
      return { cwd };
    case 'list': {
      const maxEntries = clampNumber(input.maxEntries, 1, 200);
      const entries = readdirSync(targetPath, 'utf8')
        .slice(0, maxEntries)
        .map((name) => {
          const fullPath = join(targetPath, name);
          const stats = statSync(fullPath);
          return {
            name,
            kind: toEntryKind(stats),
            size: stats.size,
          };
        });
      return { cwd, targetPath, entries };
    }
    case 'read': {
      const maxChars = clampNumber(input.maxChars, 200, 40_000);
      const content = readFileSync(targetPath, 'utf8');
      return {
        cwd,
        targetPath,
        content: content.slice(0, maxChars),
        truncated: content.length > maxChars,
      };
    }
    case 'stat': {
      const stats = statSync(targetPath);
      return {
        cwd,
        targetPath,
        stat: {
          kind: toEntryKind(stats),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        },
      };
    }
    case 'tree': {
      const maxDepth = clampNumber(input.maxDepth, 1, 6);
      const maxEntries = clampNumber(input.maxEntries, 1, 60);
      return {
        cwd,
        targetPath,
        tree: buildWorkspaceTree(targetPath, maxDepth, maxEntries),
      };
    }
    case 'search': {
      const maxMatches = clampNumber(input.maxMatches, 1, 100);
      const maxChars = clampNumber(input.maxChars, 80, 400);
      return searchWorkspace(cwd, targetPath, input.query, maxMatches, maxChars);
    }
    default:
      throw new Error('unknown_workspace_probe_operation');
  }
}

function runPackageProbe(input: PackageProbeInput): Record<string, unknown> {
  const cwd = resolveProbeCwd(input.cwd);
  const filePath = resolveWorkspaceTarget(cwd, input.filePath ?? 'package.json');
  const pkg = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  const dependencyCount = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]
    .filter((bucket): bucket is Record<string, unknown> => typeof bucket === 'object' && bucket !== null)
    .reduce((sum, bucket) => sum + Object.keys(bucket).length, 0);

  switch (input.operation) {
    case 'summary':
      return {
        cwd,
        filePath,
        packageJson: {
          name: typeof pkg.name === 'string' ? pkg.name : null,
          version: typeof pkg.version === 'string' ? pkg.version : null,
          packageManager: typeof pkg.packageManager === 'string' ? pkg.packageManager : null,
          scriptsCount: objectSize(pkg.scripts),
          dependencyCount,
          workspaces: Array.isArray(pkg.workspaces) ? pkg.workspaces : null,
        },
      };
    case 'scripts':
      return {
        cwd,
        filePath,
        packageJson: {
          name: typeof pkg.name === 'string' ? pkg.name : null,
          scripts: toRecord(pkg.scripts),
        },
      };
    case 'dependencies':
      return {
        cwd,
        filePath,
        packageJson: {
          name: typeof pkg.name === 'string' ? pkg.name : null,
          dependencies: toRecord(pkg.dependencies),
          devDependencies: toRecord(pkg.devDependencies),
          peerDependencies: toRecord(pkg.peerDependencies),
          optionalDependencies: toRecord(pkg.optionalDependencies),
        },
      };
    default:
      throw new Error('unknown_package_probe_operation');
  }
}

function runPackageManagerProbe(input: PackageManagerProbeInput): Record<string, unknown> {
  const cwd = resolveProbeCwd(input.cwd);
  const details = getPackageManagerDetails(cwd, input.filePath);

  switch (input.operation) {
    case 'detect':
      return {
        cwd,
        rootPath: details.rootPath,
        filePath: details.filePath,
        packageManager: details.packageManager,
      };
    case 'lockfile':
      return {
        cwd,
        rootPath: details.rootPath,
        lockfile: {
          name: details.packageManager.lockfile,
          path: details.packageManager.lockfilePath,
          manager: details.packageManager.name,
        },
      };
    case 'workspaces':
      return {
        cwd,
        rootPath: details.rootPath,
        workspaces: {
          source: details.workspaceConfig.source,
          configPath: details.workspaceConfig.configPath ? normalizeWorkspacePath(cwd, details.workspaceConfig.configPath) : null,
          patterns: details.workspaceConfig.patterns,
        },
      };
    default:
      throw new Error('unknown_package_manager_probe_operation');
  }
}

function runProcessProbe(input: ProcessProbeInput): Record<string, unknown> {
  const cwd = resolveProbeCwd(input.cwd);
  switch (input.operation) {
    case 'versions':
      return {
        cwd,
        processInfo: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
        },
      };
    case 'env': {
      const keys = input.keys?.length ? input.keys : ['PATH', 'NODE_ENV', 'HOME', 'USERPROFILE'];
      return {
        cwd,
        environment: Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null])),
      };
    }
    case 'which':
      if (!input.command?.trim()) {
        throw new Error('command_required');
      }
      return {
        cwd,
        command: input.command,
        resolvedPath: resolveCommandPath(input.command),
      };
    default:
      throw new Error('unknown_process_probe_operation');
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function objectSize(value: unknown): number {
  return typeof value === 'object' && value !== null ? Object.keys(value as Record<string, unknown>).length : 0;
}

function buildProbeRequest(kind: 'workspace' | 'package' | 'packageManager' | 'process', input: unknown, cwd: string, description: string): LocalProcessSandboxRequest {
  return {
    kind: 'local-process',
    command: process.execPath,
    args: ['-e', DEVELOPER_PROBE_SCRIPT, JSON.stringify({ kind, input })],
    cwd,
    description,
  };
}

async function executeProbeWithSandbox(
  toolName: string,
  request: LocalProcessSandboxRequest,
  ctx: ToolExecContext,
): Promise<ProbeExecutionResult | null> {
  if (!ctx.sandboxRuntime || !ctx.sandboxContext) {
    return null;
  }

  const lease = ctx.sandboxRuntime.createLease(
    request,
    {
      ...ctx.sandboxContext,
      toolName: ctx.sandboxContext.toolName ?? toolName,
      cwd: request.cwd,
    },
    ctx.sandboxPolicy,
  );

  ctx.onProgress?.({
    phase: 'sandbox',
    message: 'lease created',
    percent: 10,
  });

  const envelope = await lease.execute();
  const result = envelope.result as ProbeExecutionResult;
  ctx.onProgress?.({
    phase: 'sandbox',
    message: result.cancelled ? 'lease cancelled' : result.success ? 'lease complete' : 'lease failed',
    percent: result.cancelled ? 100 : result.success ? 100 : 90,
  });
  return result;
}

async function executeLocalProcessRequest(
  toolName: string,
  request: LocalProcessSandboxRequest,
  ctx: ToolExecContext,
  fallbackFilesystem: SandboxPolicy['filesystem'],
): Promise<ProbeExecutionResult> {
  const sandboxResult = await executeProbeWithSandbox(toolName, request, ctx);
  if (sandboxResult) {
    return sandboxResult;
  }

  const host = createLocalProcessSandboxHost();
  const context: SandboxExecutionContext = {
    sessionId: ctx.sessionId,
    entrypoint: ctx.sandboxContext?.entrypoint ?? 'tool',
    runId: ctx.sandboxContext?.runId,
    taskId: ctx.sandboxContext?.taskId,
    signal: ctx.signal,
    workspaceRoots: ctx.sandboxContext?.workspaceRoots,
    trustLevel: ctx.sandboxContext?.trustLevel ?? 'builtin',
    cwd: request.cwd ?? ctx.sandboxContext?.cwd,
    toolName,
    sandboxProfile: ctx.sandboxContext?.sandboxProfile ?? 'local-process',
    auditLogger: ctx.sandboxContext?.auditLogger,
  };
  const policy: SandboxPolicy = {
    hostKind: 'local-process',
    filesystem: ctx.sandboxPolicy?.filesystem ?? fallbackFilesystem,
    network: ctx.sandboxPolicy?.network ?? 'deny',
    interaction: ctx.sandboxPolicy?.interaction ?? 'none',
    maxDurationMs: ctx.sandboxPolicy?.maxDurationMs ?? 120_000,
    maxOutputChars: ctx.sandboxPolicy?.maxOutputChars,
  };

  return await host.execute(request, context, policy) as ProbeExecutionResult;
}

function mergeProbeResult<T extends Record<string, unknown>>(
  operation: string,
  cwd: string,
  payload: T,
  result?: ProbeExecutionResult,
): T & Record<string, unknown> {
  return {
    operation,
    cwd,
    ...payload,
    ...(result ? {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      cancelled: result.cancelled,
      timedOut: result.timedOut,
      ...(result.error ? { error: result.error } : {}),
    } : {
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 0,
    }),
  };
}

function parseProbeStdout(stdout: string): Record<string, unknown> {
  if (!stdout.trim()) {
    return {};
  }
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

export const workspaceProbeTool: AgentToolDefinition = {
  name: 'workspace_probe',
  description: '只读工作区开发探针。支持 pwd、list、read、stat、tree、search，帮助终端运行时查看目录、文件、树状结构和代码搜索结果。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  inputSchema: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: ['pwd', 'list', 'read', 'stat', 'tree', 'search'],
      },
      cwd: { type: 'string' },
      targetPath: { type: 'string' },
      maxEntries: { type: 'number' },
      maxChars: { type: 'number' },
      maxDepth: { type: 'number' },
      maxMatches: { type: 'number' },
      query: { type: 'string' },
    },
  },
  async execute(input, ctx) {
    const probeInput = input as WorkspaceProbeInput;
    const cwd = resolveProbeCwd(probeInput.cwd ?? ctx.sandboxContext?.cwd);
    const sandboxResult = await executeProbeWithSandbox(
      'workspace_probe',
      buildProbeRequest('workspace', { ...probeInput, cwd }, cwd, 'Inspect workspace paths and files'),
      ctx,
    );

    if (sandboxResult) {
      return mergeProbeResult(probeInput.operation, cwd, parseProbeStdout(sandboxResult.stdout), sandboxResult);
    }

    return mergeProbeResult(probeInput.operation, cwd, runWorkspaceProbe({ ...probeInput, cwd }));
  },
};

export const packageProbeTool: AgentToolDefinition = {
  name: 'package_probe',
  description: '只读包清单探针。支持 summary、scripts、dependencies，用于终端运行时快速理解 package.json。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  inputSchema: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: ['summary', 'scripts', 'dependencies'],
      },
      cwd: { type: 'string' },
      filePath: { type: 'string' },
    },
  },
  async execute(input, ctx) {
    const probeInput = input as PackageProbeInput;
    const cwd = resolveProbeCwd(probeInput.cwd ?? ctx.sandboxContext?.cwd);
    const sandboxResult = await executeProbeWithSandbox(
      'package_probe',
      buildProbeRequest('package', { ...probeInput, cwd }, cwd, 'Inspect package.json metadata'),
      ctx,
    );

    if (sandboxResult) {
      return mergeProbeResult(probeInput.operation, cwd, parseProbeStdout(sandboxResult.stdout), sandboxResult);
    }

    return mergeProbeResult(probeInput.operation, cwd, runPackageProbe({ ...probeInput, cwd }));
  },
};

export const packageManagerProbeTool: AgentToolDefinition = {
  name: 'package_manager_probe',
  description: '只读包管理器探针。支持 detect、lockfile、workspaces，用于识别 workspace 根目录的包管理器、锁文件与 workspace 配置。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  inputSchema: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: ['detect', 'lockfile', 'workspaces'],
      },
      cwd: { type: 'string' },
      filePath: { type: 'string' },
    },
  },
  async execute(input, ctx) {
    const probeInput = input as PackageManagerProbeInput;
    const cwd = resolveProbeCwd(probeInput.cwd ?? ctx.sandboxContext?.cwd);
    const sandboxResult = await executeProbeWithSandbox(
      'package_manager_probe',
      buildProbeRequest('packageManager', { ...probeInput, cwd }, cwd, 'Inspect package manager metadata and lockfiles'),
      ctx,
    );

    if (sandboxResult) {
      return mergeProbeResult(probeInput.operation, cwd, parseProbeStdout(sandboxResult.stdout), sandboxResult);
    }

    return mergeProbeResult(probeInput.operation, cwd, runPackageManagerProbe({ ...probeInput, cwd }));
  },
};

export const packageManagerWriteTool: AgentToolDefinition = {
  name: 'package_manager_write',
  description: '可审批的包管理器写操作工具。支持 install、add、remove，通过本地进程 sandbox 执行依赖安装与移除。',
  isConcurrencySafe: false,
  isDestructive: true,
  isReadOnly: false,
  alwaysLoad: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  sandboxAccessTier: 'interactive-write-capable',
  inputSchema: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: ['install', 'add', 'remove'],
      },
      cwd: { type: 'string' },
      filePath: { type: 'string' },
      packages: {
        type: 'array',
        items: { type: 'string' },
      },
      dev: { type: 'boolean' },
      exact: { type: 'boolean' },
    },
  },
  async execute(input, ctx) {
    const writeInput = input as PackageManagerWriteInput;
    const cwd = resolveProbeCwd(writeInput.cwd ?? ctx.sandboxContext?.cwd);
    const { details, manager, args, request } = buildPackageManagerWriteRequest(writeInput, cwd);
    const result = await executeLocalProcessRequest('package_manager_write', request, ctx, 'workspace-write');

    return {
      operation: writeInput.operation,
      cwd,
      rootPath: details.rootPath,
      filePath: details.filePath,
      packageManager: manager,
      command: request.command,
      args,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      cancelled: result.cancelled,
      timedOut: result.timedOut,
      ...(result.error ? { error: result.error } : {}),
    };
  },
};

export const processProbeTool: AgentToolDefinition = {
  name: 'process_probe',
  description: '只读进程环境探针。支持 versions、env、which，用于终端运行时确认 Node/平台/环境变量和可执行文件解析。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  inputSchema: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: ['versions', 'env', 'which'],
      },
      cwd: { type: 'string' },
      command: { type: 'string' },
      keys: { type: 'array', items: { type: 'string' } },
    },
  },
  async execute(input, ctx) {
    const probeInput = input as ProcessProbeInput;
    const cwd = resolveProbeCwd(probeInput.cwd ?? ctx.sandboxContext?.cwd);
    const sandboxResult = await executeProbeWithSandbox(
      'process_probe',
      buildProbeRequest('process', { ...probeInput, cwd }, cwd, 'Inspect process environment and executable paths'),
      ctx,
    );

    if (sandboxResult) {
      return mergeProbeResult(probeInput.operation, cwd, parseProbeStdout(sandboxResult.stdout), sandboxResult);
    }

    return mergeProbeResult(probeInput.operation, cwd, runProcessProbe({ ...probeInput, cwd }));
  },
};
