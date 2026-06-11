import JSZip from 'jszip';

export interface ImportedSkillFile {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface ImportedSkillPackage {
  rootName: string;
  files: ImportedSkillFile[];
}

export function normalizeImportedSkillPackage(rootNameHint: string, files: ImportedSkillFile[]): ImportedSkillPackage {
  if (files.length === 0) {
    throw new Error('Skill package cannot be empty');
  }

  const normalizedFiles = files.map(normalizeImportedSkillFile);
  const sharedRoot = getSharedRootFolder(normalizedFiles.map((file) => file.path));
  const relativeFiles = sharedRoot
    ? normalizedFiles.map((file) => ({
        ...file,
        path: file.path.slice(sharedRoot.length + 1),
      }))
    : normalizedFiles;

  if (!relativeFiles.some((file) => isSkillEntrypoint(file.path))) {
    throw new Error('Skill package must include SKILL.md, index.ts, or index.js');
  }

  return {
    rootName: sharedRoot ? sanitizeSkillName(sharedRoot) : sanitizeSkillName(rootNameHint),
    files: relativeFiles,
  };
}

export async function readSkillPackageFromZip(file: File): Promise<ImportedSkillPackage> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const importedFiles: ImportedSkillFile[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const bytes = await entry.async('uint8array');
    importedFiles.push(buildImportedSkillFile(entry.name, bytes));
  }

  return normalizeImportedSkillPackage(stripExtension(file.name), importedFiles);
}

export async function readSkillPackageFromFolder(files: FileList | File[]): Promise<ImportedSkillPackage> {
  const inputFiles = Array.from(files);
  const importedFiles = await Promise.all(inputFiles.map(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const relativePath = getBrowserRelativePath(file);
    return buildImportedSkillFile(relativePath, bytes);
  }));

  const rootHint = getSharedRootFolder(importedFiles.map((file) => file.path)) ?? stripExtension(inputFiles[0]?.name ?? 'imported-skill');
  return normalizeImportedSkillPackage(rootHint, importedFiles);
}

function normalizeImportedSkillFile(file: ImportedSkillFile): ImportedSkillFile {
  const path = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = path.split('/');
  if (!path || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid imported skill path: ${file.path}`);
  }

  return {
    ...file,
    path: parts.join('/'),
  };
}

function getSharedRootFolder(paths: string[]): string | null {
  if (paths.length === 0) return null;

  const firstParts = paths[0].split('/');
  if (firstParts.length < 2) return null;

  const candidate = firstParts[0];
  const hasSharedRoot = paths.every((path) => path.startsWith(`${candidate}/`));
  return hasSharedRoot ? candidate : null;
}

function sanitizeSkillName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new Error(`Invalid skill name: ${value}`);
  }

  return normalized;
}

function isSkillEntrypoint(path: string): boolean {
  return path === 'SKILL.md' || path === 'index.ts' || path === 'index.js';
}

function getBrowserRelativePath(file: File): string {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relativePath && relativePath.trim() ? relativePath : file.name;
}

function buildImportedSkillFile(path: string, bytes: Uint8Array): ImportedSkillFile {
  if (isLikelyTextFile(path, bytes)) {
    return {
      path,
      content: new TextDecoder('utf-8').decode(bytes),
    };
  }

  return {
    path,
    content: uint8ArrayToBase64(bytes),
    encoding: 'base64',
  };
}

function isLikelyTextFile(path: string, bytes: Uint8Array): boolean {
  const lowerPath = path.toLowerCase();
  if (TEXT_FILE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    return true;
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 256));
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '') || value;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

const TEXT_FILE_EXTENSIONS = [
  '.md',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.toml',
  '.ini',
  '.env',
  '.svg',
];