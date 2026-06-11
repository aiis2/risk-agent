import type { FastifyInstance } from 'fastify';
import { SkillLoader, SkillGuard } from '@risk-agent/core';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { AppContext } from '../index.js';

const SkillImportFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).optional(),
});

const SkillImportSchema = z.object({
  rootName: z.string().min(1),
  overwrite: z.boolean().optional(),
  files: z.array(SkillImportFileSchema).min(1),
});

const SkillFileQuerySchema = z.object({
  path: z.string().min(1),
});

const SkillListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
});

export function registerSkillsRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Resolve the project-level .agents/skills directory so skills installed
  // via `npx skills add` (which writes to <project>/.agents/skills/) are visible.
  // The server CWD is typically packages/server, so go up two levels.
  const projectAgentsSkillDir = join(process.cwd(), '..', '..', '.agents', 'skills');
  const homeAgentsSkillDir = join(homedir(), '.agents', 'skills');
  const projectSkillDir = existsSync(projectAgentsSkillDir)
    ? projectAgentsSkillDir
    : existsSync(homeAgentsSkillDir)
      ? homeAgentsSkillDir
      : undefined;

  const loader = new SkillLoader({
    userSkillDir: join(ctx.storage.paths.dataRoot, 'skills'),
    projectSkillDir,
  });

  // GET /api/skills — list all skills
  app.get('/api/skills', async (req, reply) => {
    const parsed = SkillListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid search query', issues: parsed.error.issues });
    }

    const skills = await loader.list();
    const query = parsed.data.q?.toLowerCase();
    const filtered = !query
      ? skills
      : skills.filter((skill) => {
          const haystacks = [skill.name, skill.description, ...(skill.tags ?? [])]
            .map((value) => value.toLowerCase());
          return haystacks.some((value) => value.includes(query));
        });
    return { success: true, data: filtered };
  });

  // POST /api/skills/import — import skill directory package from UI upload
  app.post('/api/skills/import', async (req, reply) => {
    const parsed = SkillImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid import payload', issues: parsed.error.issues });
    }

    // Security scan before installation
    const scanFiles = parsed.data.files.map((f) => ({
      path: f.path,
      content: f.encoding === 'base64'
        ? Buffer.from(f.content, 'base64').toString('utf-8')
        : f.content,
    }));
    const scanResult = SkillGuard.scanFromFiles(parsed.data.rootName, 'upload', scanFiles);
    const { allowed, reason } = SkillGuard.shouldAllowInstall(scanResult);
    if (!allowed) {
      return reply.status(422).send({
        success: false,
        error: `Security scan blocked installation: ${reason}`,
        scan: scanResult,
      });
    }

    try {
      const skill = await loader.importSkillPackage(parsed.data.rootName, parsed.data.files, {
        overwrite: parsed.data.overwrite,
      });
      return reply.status(201).send({ success: true, data: skill, scan: scanResult });
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      const statusCode = /already exists/i.test(message) ? 409 : 422;
      return reply.status(statusCode).send({ success: false, error: message });
    }
  });

  // GET /api/skills/:name/tree — browse file tree for directory skills
  app.get<{ Params: { name: string } }>('/api/skills/:name/tree', async (req, reply) => {
    const tree = await loader.getSkillTree(req.params.name);
    if (!tree) return reply.status(404).send({ success: false, error: 'Skill tree not found' });
    return { success: true, data: { entries: tree } };
  });

  // GET /api/skills/:name/file?path=... — read one file from a skill package
  app.get<{ Params: { name: string }; Querystring: { path?: string } }>('/api/skills/:name/file', async (req, reply) => {
    const parsed = SkillFileQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'path is required', issues: parsed.error.issues });
    }

    const file = await loader.readSkillFile(req.params.name, parsed.data.path);
    if (!file) return reply.status(404).send({ success: false, error: 'Skill file not found' });
    return { success: true, data: file };
  });

  // GET /api/skills/:name — get single skill
  app.get<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    const skill = await loader.getSkill(req.params.name);
    if (!skill) return reply.status(404).send({ success: false, error: 'Skill not found' });
    return { success: true, data: skill };
  });

  // POST /api/skills — create skill
  // body: { name: string; description: string; content: string }
  app.post<{ Body: { name: string; description: string; content: string } }>(
    '/api/skills',
    async (req, reply) => {
      const { name, description, content } = req.body ?? {};
      if (!name || !description || !content) {
        return reply.status(400).send({ success: false, error: 'name, description and content are required' });
      }
      try {
        const skill = await loader.createSkill(name, description, content);
        return reply.status(201).send({ success: true, data: skill });
      } catch (err) {
        return reply.status(422).send({ success: false, error: String(err instanceof Error ? err.message : err) });
      }
    }
  );

  // DELETE /api/skills/:name — delete skill
  app.delete<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    try {
      await loader.deleteSkill(req.params.name);
      return { success: true };
    } catch (err) {
      return reply.status(404).send({ success: false, error: String(err instanceof Error ? err.message : err) });
    }
  });

  // GET /api/skills/:name/test — test skill (dry-run)
  app.get<{ Params: { name: string } }>('/api/skills/:name/test', async (req, reply) => {
    const result = await loader.testSkill(req.params.name);
    if (!result.success) return reply.status(422).send({ success: false, error: result.error });
    return { success: true, data: { output: result.output } };
  });

  // POST /api/skills/install-url — fetch SKILL.md from remote URL and install
  app.post<{ Body: { url: string; name?: string; overwrite?: boolean } }>(
    '/api/skills/install-url',
    async (req, reply) => {
      const { url, name: nameOverride, overwrite = false } = req.body ?? {};
      if (!url || typeof url !== 'string') {
        return reply.status(400).send({ success: false, error: 'url is required' });
      }
      // Validate URL scheme — only http/https allowed
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return reply.status(400).send({ success: false, error: 'Invalid URL' });
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return reply.status(400).send({ success: false, error: 'Only http/https URLs are allowed' });
      }

      // Fetch the content from the remote URL
      let content: string;
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'risk-agent/1.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) {
          return reply.status(422).send({ success: false, error: `Remote server returned ${resp.status}` });
        }
        content = await resp.text();
      } catch (err) {
        return reply.status(502).send({ success: false, error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` });
      }

      // Derive skill name from URL path or use override
      const pathSegments = parsed.pathname.split('/').filter(Boolean);
      const derived = nameOverride?.trim() || pathSegments.slice(-2, -1)[0] || pathSegments[pathSegments.length - 1]?.replace(/\.(md|txt)$/i, '') || 'unknown-skill';

      // Security scan before installation — gate on trust level + verdict
      const scanResult = SkillGuard.scanFromFiles(derived, `url:${parsed.hostname}`, [
        { path: 'SKILL.md', content },
      ]);
      const { allowed, reason } = SkillGuard.shouldAllowInstall(scanResult, overwrite);
      if (!allowed) {
        return reply.status(422).send({
          success: false,
          error: `Security scan blocked installation: ${reason}`,
          scan: scanResult,
          report: SkillGuard.formatReport(scanResult),
        });
      }

      try {
        const skill = await loader.importSkillPackage(derived, [{ path: 'SKILL.md', content }], { overwrite });
        return { success: true, data: skill, scan: scanResult };
      } catch (err) {
        const message = String(err instanceof Error ? err.message : err);
        const statusCode = /already exists/i.test(message) ? 409 : 422;
        return reply.status(statusCode).send({ success: false, error: message });
      }
    },
  );
}
