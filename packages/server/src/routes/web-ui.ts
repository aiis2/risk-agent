import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { extname, join, resolve } from 'node:path';

type PathSemantics = {
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
  sep: string;
};

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function registerWebUiRoutes(app: FastifyInstance, webDistDir?: string): void {
  const resolvedWebDistDir = resolveWebDistDir(webDistDir);
  if (!resolvedWebDistDir) {
    return;
  }

  app.get('/*', async (req, reply) => {
    const pathname = new URL(req.raw.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/') || pathname === '/api' || pathname === '/health') {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
    }

    const assetPath = resolveAssetPath(resolvedWebDistDir, pathname);
    const targetPath = assetPath ?? join(resolvedWebDistDir, 'index.html');
    if (!existsSync(targetPath)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
    }

    reply.header(
      'cache-control',
      assetPath ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate'
    );
    reply.type(MIME_TYPES[extname(targetPath).toLowerCase()] ?? 'application/octet-stream');
    return reply.send(createReadStream(targetPath));
  });
}

function resolveWebDistDir(override?: string): string | undefined {
  const candidates = [override, process.env.RISK_AGENT_WEB_DIST_DIR].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const indexPath = join(candidate, 'index.html');
    if (existsSync(indexPath)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveAssetPath(webDistDir: string, pathname: string): string | undefined {
  if (pathname === '/') {
    return join(webDistDir, 'index.html');
  }

  const candidate = resolve(webDistDir, `.${pathname}`);
  if (!isPathInside(webDistDir, candidate)) {
    return undefined;
  }

  if (!existsSync(candidate)) {
    return undefined;
  }

  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function isPathInside(rootPath: string, candidatePath: string, pathSemantics: PathSemantics = nodePath): boolean {
  const relativePath = pathSemantics.relative(
    pathSemantics.resolve(rootPath),
    pathSemantics.resolve(candidatePath),
  );

  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith(`..${pathSemantics.sep}`)
    && !pathSemantics.isAbsolute(relativePath);
}
