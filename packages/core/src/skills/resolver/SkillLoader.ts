import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { join, normalize, dirname, sep, isAbsolute, relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import {
  type SkillDefinition,
  type SkillHookConfig,
  type McpServer,
  type McpToolInfo,
  BUNDLED_SKILL_DEFINITIONS,
  validateCodeSafety,
  buildMcpSkill
} from '../SkillDefinition.js';
import { createLogger } from '../../logger.js';

const log = createLogger('SkillLoader');

// Re-export for backwards compat
export type { SkillDefinition as Skill };

export interface SkillLoaderOptions {
  readonly bundledDir?: string;
  readonly userSkillDir?: string;
  /** 额外的项目级技能目录（如 <project>/.skills/） */
  readonly projectSkillDir?: string;
  /** 是否对 directory 技能进行安全扫描（默认 true） */
  readonly enableSecurityScan?: boolean;
}

export interface SkillImportFile {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface SkillFileTreeEntry {
  path: string;
  type: 'file' | 'directory';
}

export interface SkillFileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

/**
 * SkillLoader — 三层技能加载器（参考 tools-skills-system.md §6 · agent-framework.md §19）
 *
 * 加载优先级（低→高）：
 *   bundled → userSkillDir → projectSkillDir → dynamic → conditional
 *
 * v1.1 新增：
 *   - activateConditionalSkillsForPaths()：按文件路径激活 paths: 条件技能
 *   - discoverSkillDirsForPaths()：从文件路径向上查找 .skills/ 目录
 *   - substituteArgs()：{{arg}} 参数替换
 *   - watchDirectory()：文件变更热重载
 */
export class SkillLoader {
  private readonly securityScan: boolean;

  /** 已激活的条件技能（等待 paths 匹配） */
  private readonly conditionalSkills = new Map<string, SkillDefinition>();
  /** 动态发现的已加载目录 */
  private readonly discoveredDirs = new Set<string>();
  /** 动态加载的技能（文件操作触发发现） */
  private readonly dynamicSkills = new Map<string, SkillDefinition>();

  constructor(private readonly opts: SkillLoaderOptions = {}) {
    this.securityScan = opts.enableSecurityScan !== false;
  }

  /**
   * 加载所有技能，返回去重后的列表（高优先级覆盖低优先级同名技能）
   */
  async list(): Promise<SkillDefinition[]> {
    const all: SkillDefinition[] = [];
    const seen = new Set<string>();

    const add = (skill: SkillDefinition) => {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        all.push(skill);
      }
    };

    // 1. 内置 bundled skills（最高优先级）
    for (const s of BUNDLED_SKILL_DEFINITIONS) add(s);

    // 2. 可选额外 bundled 目录
    if (this.opts.bundledDir && existsSync(this.opts.bundledDir)) {
      for (const s of await this.readDir(this.opts.bundledDir, 'bundled')) add(s);
    }

    // 3. 用户 directory skills
    if (this.opts.userSkillDir) {
      mkdirSync(this.opts.userSkillDir, { recursive: true });
      if (existsSync(this.opts.userSkillDir)) {
        for (const s of await this.readDir(this.opts.userSkillDir, 'directory')) add(s);
      }
    }

    // 4. 项目级 skills
    if (this.opts.projectSkillDir && existsSync(this.opts.projectSkillDir)) {
      for (const s of await this.readDir(this.opts.projectSkillDir, 'directory')) add(s);
    }

    // 5. 动态发现的技能（低优先级，不覆盖已有）
    for (const s of this.dynamicSkills.values()) add(s);

    return all;
  }

  /**
   * 从 MCP Server manifest 动态构建技能列表
   * （参考 agent-framework.md §19.2 buildMcpSkill）
   */
  async listFromMcp(server: McpServer, tools: McpToolInfo[]): Promise<SkillDefinition[]> {
    return tools.map((t) => buildMcpSkill(server, t));
  }

  /**
   * 按名称查找技能
   */
  async find(name: string): Promise<SkillDefinition | undefined> {
    const all = await this.list();
    return all.find((s) => s.name === name);
  }

  // ─── 条件技能激活（§6.4）────────────────────────────────

  /**
   * 按文件路径激活 paths: 条件技能。
   * 在工具执行 PostToolUse Hook 中调用（file_read / file_write / query_db 等）。
   *
   * @returns 本次新激活的技能名列表
   */
  activateConditionalSkillsForPaths(filePaths: string[], cwd: string): string[] {
    const activated: string[] = [];

    for (const [name, skill] of this.conditionalSkills) {
      if (!skill.paths?.length) continue;

      for (const fp of filePaths) {
        const rel = isAbsolute(fp) ? relative(cwd, fp) : fp;
        // 防路径逃逸：不处理 ../ 以上的路径
        if (!rel || rel.startsWith('..')) continue;

        if (matchesGlobs(rel, skill.paths)) {
          // 从条件池移到动态池
          this.conditionalSkills.delete(name);
          this.dynamicSkills.set(name, { ...skill, source: 'dynamic' });
          activated.push(name);
          break;
        }
      }
    }

    return activated;
  }

  /**
   * 注册条件技能到等待激活池。
   * 技能从文件系统加载后若含 paths: 字段则自动放入此池。
   */
  registerConditionalSkill(skill: SkillDefinition): void {
    if (skill.paths?.length) {
      this.conditionalSkills.set(skill.name, skill);
    }
  }

  // ─── 动态技能发现（§6.5）────────────────────────────────

  /**
   * 从文件路径向上遍历，查找 .skills/ 目录（自动发现项目内技能）。
   * 参考 tools-skills-system.md §6.5
   *
   * @returns 新发现的技能目录列表（深度优先排序）
   */
  async discoverSkillDirsForPaths(filePaths: string[], cwd: string): Promise<string[]> {
    let resolvedCwd: string;
    try {
      resolvedCwd = await realpath(cwd);
    } catch {
      resolvedCwd = cwd;
    }

    const newDirs: string[] = [];

    for (const fp of filePaths) {
      let currentDir = dirname(isAbsolute(fp) ? fp : join(resolvedCwd, fp));

      // 从文件位置向上遍历到 cwd（不含 cwd 本身）
      while (
        currentDir.startsWith(resolvedCwd + sep) &&
        currentDir !== resolvedCwd
      ) {
        const skillDir = join(currentDir, '.skills');

        if (!this.discoveredDirs.has(skillDir)) {
          this.discoveredDirs.add(skillDir);
          if (existsSync(skillDir)) {
            newDirs.push(skillDir);
          }
        }

        currentDir = dirname(currentDir);
      }
    }

    // 按路径深度排序（最深优先）
    newDirs.sort((a, b) => b.split(sep).length - a.split(sep).length);

    // 加载新发现的技能目录
    for (const dir of newDirs) {
      const skills = await this.readDir(dir, 'dynamic' as any);
      for (const s of skills) {
        if (!this.dynamicSkills.has(s.name)) {
          this.dynamicSkills.set(s.name, s);
        }
      }
    }

    return newDirs;
  }

  // ─── 参数替换（§6.7）────────────────────────────────────

  /**
   * 将 {{argName}} 占位符替换为实际参数值。
   * 同时替换内置变量：${SKILL_DIR}、${SESSION_ID}、${CWD}
   *
   * @param template  含占位符的技能内容（SKILL.md body）
   * @param args      用户传入的命名参数
   * @param context   内置变量上下文
   */
  static substituteArgs(
    template: string,
    args: Record<string, unknown> = {},
    context: { skillDir?: string; sessionId?: string; cwd?: string } = {}
  ): string {
    let result = template;

    // 替换 {{argName}} 命名参数
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return key in args ? String(args[key]) : `{{${key}}}`;
    });

    // 替换内置变量
    if (context.skillDir)  result = result.replace(/\$\{SKILL_DIR\}/g,  context.skillDir);
    if (context.sessionId) result = result.replace(/\$\{SESSION_ID\}/g, context.sessionId);
    if (context.cwd)       result = result.replace(/\$\{CWD\}/g,        context.cwd);

    return result;
  }

  // ─── 热重载（§6.2 DirectorySkillLoader）─────────────────

  /**
   * 监听目录变化，SKILL.md 文件修改时自动重载对应技能。
   * @returns 停止监听的函数
   */
  watchDirectory(dir: string): () => void {
    if (!existsSync(dir)) return () => {};

    const watcher = watch(dir, { recursive: true }, (event, filename) => {
      if (filename && filename.endsWith('.md')) {
        log.info({ dir, filename, event }, 'Skill file changed, reloading');
        // 简单策略：清空动态缓存，下次 list() 时重新扫描
        this.dynamicSkills.clear();
      }
    });

    return () => { try { watcher.close(); } catch { /* ignore */ } };
  }

  // ─── 默认技能目录（帮助函数）────────────────────────────

  /**
   * 返回默认的用户级技能目录（~/.risk_agent/skills/）
   */
  static defaultUserSkillDir(): string {
    return join(homedir(), '.risk_agent', 'skills');
  }

  /**
   * 返回项目级技能目录（<cwd>/.skills/）
   */
  static defaultProjectSkillDir(cwd = process.cwd()): string {
    return join(cwd, '.skills');
  }

  // ─── 私有方法 ──────────────────────────────────────────

  private async readDir(
    dir: string,
    source: SkillDefinition['source']
  ): Promise<SkillDefinition[]> {
    const out: SkillDefinition[] = [];
    const safePath = normalize(dir);

    for (const entry of readdirSync(safePath)) {
      // 防止路径逃逸
      if (entry.includes('..') || entry.includes('/') || entry.includes('\\')) {
        log.warn({ entry }, 'Skipping suspicious skill directory entry');
        continue;
      }

      const entryPath = join(safePath, entry);
      const st = statSync(entryPath);

      if (st.isDirectory()) {
        // SKILL.md 格式技能
        const skillMd = join(entryPath, 'SKILL.md');
        if (existsSync(skillMd)) {
          const skill = this.loadFromMarkdown(entry, entryPath, skillMd, source);
          if (skill) out.push(skill);
        }
        // index.ts / index.js 格式技能
        const indexTs = join(entryPath, 'index.ts');
        const indexJs = join(entryPath, 'index.js');
        const codeFile = existsSync(indexTs) ? indexTs : existsSync(indexJs) ? indexJs : null;
        if (codeFile) {
          const skill = await this.loadFromCode(entry, entryPath, codeFile, source);
          if (skill) out.push(skill);
        }
      }
    }
    return out;
  }

  private loadFromMarkdown(
    name: string,
    dirPath: string,
    mdPath: string,
    source: SkillDefinition['source']
  ): SkillDefinition | null {
    try {
      const content = readFileSync(mdPath, 'utf-8');
      const description = extractDescription(content) ?? name;

      // 解析 paths 前端（条件技能）
      // 支持 YAML 行内数组格式: paths: ["a/**", "b/**"]
      // 及 YAML 块序列格式:
      //   paths:
      //     - "a/**"
      //     - "b/**"
      let paths: string[] | undefined;
      const inlinePaths = content.match(/^paths:\s*\[([^\]]+)\]/im);
      const blockPaths = content.match(/^paths:\s*\n((?:\s+-\s*.+\n?)+)/im);
      if (inlinePaths) {
        paths = inlinePaths[1].split(',').map((p) => p.trim().replace(/^['"]|['"]$/g, ''));
      } else if (blockPaths) {
        paths = blockPaths[1]
          .split('\n')
          .map((line) => line.replace(/^\s+-\s*/, '').trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else {
        // fallback: 单行 paths: a,b,c
        const legacyMatch = content.match(/^paths:\s*(.+)$/im);
        if (legacyMatch) paths = legacyMatch[1].split(',').map((p) => p.trim());
      }

      // 解析 arguments 参数定义（§6.7）
      const argsMatch = content.match(/^arguments:\s*(.+)$/im);
      const _argumentNames = argsMatch
        ? argsMatch[1].split(',').map((a) => a.trim())
        : undefined;

      // 解析 hooks（§6.8）：PreToolUse / PostToolUse
      const hooks = parseSkillHooks(content);

      const skill: SkillDefinition = {
        name,
        description,
        source: paths ? 'conditional' : source,
        path: dirPath,
        paths,
        contextMode: content.includes('context: fork') ? 'fork' : 'shared',
        hooks,
        async execute(args) {
          // §6.6 Shell 命令执行：替换 !`cmd` 语法
          const expanded = source === 'mcp'
            ? content
            : await executeShellInPrompt(content, dirPath);
          // §6.7 {{arg}} 参数替换
          return SkillLoader.substituteArgs(expanded, args, { skillDir: dirPath });
        }
      };
      return skill;
    } catch (err) {
      log.warn({ name, err }, 'Failed to load skill from markdown');
      return null;
    }
  }

  private async loadFromCode(
    name: string,
    dirPath: string,
    codePath: string,
    source: SkillDefinition['source']
  ): Promise<SkillDefinition | null> {
    try {
      const sourceCode = readFileSync(codePath, 'utf-8');

      // 安全扫描
      if (this.securityScan) {
        const scan = validateCodeSafety(sourceCode);
        if (!scan.safe) {
          log.warn({ name, violations: scan.violations }, 'Skill failed security scan, skipping');
          return null;
        }
      }

      // 动态导入
      const mod = await import(codePath) as { default?: Partial<SkillDefinition> };
      const def = mod.default;
      if (!def || typeof def.execute !== 'function') {
        log.warn({ name, codePath }, 'Skill module missing default export with execute()');
        return null;
      }

      return {
        name,
        description: def.description ?? name,
        source,
        path: dirPath,
        version: def.version,
        author: def.author,
        tags: def.tags,
        parameters: def.parameters,
        paths: def.paths,
        contextMode: def.contextMode,
        execute: def.execute.bind(def)
      };
    } catch (err) {
      log.warn({ name, err }, 'Failed to load skill from code file');
      return null;
    }
  }

  // ── CRUD helpers (§9.3 API) ────────────────────────────────────────────

  /**
   * 创建一个新的用户目录技能（Markdown格式）。
   * 安全扫描代码内容后写入 userSkillDir/<name>/SKILL.md
   */
  async createSkill(name: string, description: string, content: string): Promise<SkillDefinition> {
    if (!this.opts.userSkillDir) throw new Error('userSkillDir not configured');
    // Validate name (alphanumeric, dash, underscore)
    if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`Invalid skill name: ${name}`);

    if (this.securityScan) {
      const scan = validateCodeSafety(content);
      if (!scan.safe) {
        throw new Error(`Skill failed security scan: ${scan.violations.join(', ')}`);
      }
    }

    const { writeFileSync } = await import('node:fs');
    const skillDir = join(this.opts.userSkillDir, name);
    mkdirSync(skillDir, { recursive: true });

    const frontmatter = `---\ndescription: ${description}\nsource: directory\n---\n\n${content}`;
    writeFileSync(join(skillDir, 'SKILL.md'), frontmatter, 'utf-8');

    const skill: SkillDefinition = {
      name,
      description,
      source: 'directory',
      path: skillDir,
      execute: async () => content,
    };
    return skill;
  }

  /**
   * 删除一个用户目录技能（只允许删除 directory 来源）
   */
  async deleteSkill(name: string): Promise<void> {
    if (!this.opts.userSkillDir) throw new Error('userSkillDir not configured');
    const skillDir = join(this.opts.userSkillDir, name);
    const resolved = await realpath(skillDir).catch(() => null);
    const userDirResolved = await realpath(this.opts.userSkillDir).catch(() => this.opts.userSkillDir);
    if (!resolved || !resolved.startsWith(userDirResolved + sep)) {
      throw new Error(`Skill not found or not deletable: ${name}`);
    }
    const { rmSync } = await import('node:fs');
    rmSync(skillDir, { recursive: true, force: true });
  }

  /**
   * 获取单个技能详情
   */
  async getSkill(name: string): Promise<SkillDefinition | null> {
    const all = await this.list();
    return all.find((s) => s.name === name) ?? null;
  }

  /**
   * 将浏览器或桌面端上传的技能包写入 userSkillDir/<name>/...
   */
  async importSkillPackage(
    rootName: string,
    files: SkillImportFile[],
    opts: { overwrite?: boolean } = {}
  ): Promise<SkillDefinition> {
    if (!this.opts.userSkillDir) throw new Error('userSkillDir not configured');
    if (!/^[a-z0-9_-]+$/i.test(rootName)) throw new Error(`Invalid skill name: ${rootName}`);
    if (files.length === 0) throw new Error('Skill package cannot be empty');

    const skillDir = join(this.opts.userSkillDir, rootName);
    if (existsSync(skillDir)) {
      if (!opts.overwrite) throw new Error(`Skill already exists: ${rootName}`);
      rmSync(skillDir, { recursive: true, force: true });
    }

    mkdirSync(skillDir, { recursive: true });

    let hasEntrypoint = false;
    try {
      for (const file of files) {
        const safeRelativePath = normalizeSkillRelativePath(file.path);
        if (!safeRelativePath) throw new Error(`Invalid skill file path: ${file.path}`);

        const buffer = file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : Buffer.from(file.content, 'utf-8');

        if (this.securityScan && isScannableSkillFile(safeRelativePath)) {
          const source = buffer.toString('utf-8');
          const scan = validateCodeSafety(source);
          if (!scan.safe) {
            throw new Error(`Skill failed security scan: ${scan.violations.join(', ')}`);
          }
        }

        if (isSkillEntrypoint(safeRelativePath)) {
          hasEntrypoint = true;
        }

        const targetPath = join(skillDir, safeRelativePath);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, buffer);
      }

      if (!hasEntrypoint) {
        throw new Error('Skill package must include SKILL.md, index.ts, or index.js');
      }

      const imported = (await this.readDir(this.opts.userSkillDir, 'directory')).find((skill) => skill.name === rootName);
      if (!imported) {
        throw new Error(`Imported skill could not be loaded: ${rootName}`);
      }
      return imported;
    } catch (err) {
      rmSync(skillDir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * 返回技能目录的可浏览文件树。
   */
  async getSkillTree(name: string): Promise<SkillFileTreeEntry[] | null> {
    const skillRoot = await this.resolveSkillDirectory(name);
    if (!skillRoot) return null;

    const entries: SkillFileTreeEntry[] = [];
    const walk = (currentDir: string, prefix = '') => {
      const children = readdirSync(currentDir)
        .map((child) => {
          const childPath = join(currentDir, child);
          return { name: child, path: childPath, stat: statSync(childPath) };
        })
        .sort((a, b) => {
          const typeDiff = Number(a.stat.isDirectory()) - Number(b.stat.isDirectory());
          if (typeDiff !== 0) return typeDiff;
          return a.name.localeCompare(b.name);
        });

      for (const child of children) {
        const relPath = prefix ? `${prefix}/${child.name}` : child.name;
        const normalizedPath = relPath.replace(/\\/g, '/');
        if (child.stat.isDirectory()) {
          entries.push({ path: normalizedPath, type: 'directory' });
          walk(child.path, normalizedPath);
          continue;
        }
        if (child.stat.isFile()) {
          entries.push({ path: normalizedPath, type: 'file' });
        }
      }
    };

    walk(skillRoot);
    return entries;
  }

  /**
   * 读取技能目录下的单个文件内容。
   */
  async readSkillFile(name: string, relativePath: string): Promise<SkillFileContent | null> {
    const skillRoot = await this.resolveSkillDirectory(name);
    const safeRelativePath = normalizeSkillRelativePath(relativePath);
    if (!skillRoot || !safeRelativePath) return null;

    const filePath = join(skillRoot, safeRelativePath);
    const resolvedFilePath = await realpath(filePath).catch(() => null);
    if (!resolvedFilePath || !resolvedFilePath.startsWith(skillRoot + sep)) return null;

    const st = statSync(resolvedFilePath);
    if (!st.isFile()) return null;

    const buffer = readFileSync(resolvedFilePath);
    const encoding = isLikelyTextBuffer(buffer) ? 'utf-8' : 'base64';
    return {
      path: safeRelativePath,
      content: encoding === 'utf-8' ? buffer.toString('utf-8') : buffer.toString('base64'),
      encoding,
    };
  }

  /**
   * 测试执行技能（dry-run：传空参数执行，捕获错误）
   */
  async testSkill(name: string, args: Record<string, unknown> = {}): Promise<{ success: boolean; output?: string; error?: string }> {
    const skill = await this.getSkill(name);
    if (!skill) return { success: false, error: `Skill not found: ${name}` };
    try {
      const output = await skill.execute(args);
      return { success: true, output: String(output ?? '') };
    } catch (err) {
      return { success: false, error: String(err instanceof Error ? err.message : err) };
    }
  }

  private async resolveSkillDirectory(name: string): Promise<string | null> {
    if (!/^[a-z0-9_-]+$/i.test(name)) return null;

    if (this.opts.userSkillDir) {
      const userSkillPath = join(this.opts.userSkillDir, name);
      const resolvedUserSkillPath = await realpath(userSkillPath).catch(() => null);
      if (resolvedUserSkillPath && statSync(resolvedUserSkillPath).isDirectory()) {
        return resolvedUserSkillPath;
      }
    }

    const skill = await this.getSkill(name);
    if (!skill?.path) return null;
    const resolvedSkillPath = await realpath(skill.path).catch(() => null);
    if (!resolvedSkillPath || !statSync(resolvedSkillPath).isDirectory()) return null;
    return resolvedSkillPath;
  }
}

function normalizeSkillRelativePath(input: string): string | null {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return null;

  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;

  return parts.join('/');
}

function isSkillEntrypoint(path: string): boolean {
  return path === 'SKILL.md' || path === 'index.ts' || path === 'index.js';
}

function isScannableSkillFile(path: string): boolean {
  return path === 'SKILL.md' || path.endsWith('.ts') || path.endsWith('.js');
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 256));
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

function extractDescription(md: string): string | undefined {
  const m = md.match(/^description:\s*(.+)$/im) ?? md.match(/^#\s*(.+)$/m);
  return m?.[1]?.trim();
}

/**
 * 简单 glob 匹配：支持 * 和 ** 通配符（gitignore 风格）
 * 参考 tools-skills-system.md §6.4
 */
function matchesGlobs(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(filePath, pattern)) return true;
  }
  return false;
}

function matchGlob(str: string, pattern: string): boolean {
  // 将 glob 转换为正则
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '###DOUBLESTAR###')
    .replace(/\*/g, '[^/]*')
    .replace(/###DOUBLESTAR###/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(str);
  } catch {
    return str.includes(pattern.replace(/\*/g, ''));
  }
}

// ──────────────────────────────────────────────────────────
// §6.6 Shell 命令执行
// ──────────────────────────────────────────────────────────

const SHELL_CMD_PATTERN = /!`([^`]+)`/g;
const SHELL_EXEC_TIMEOUT_MS = 5_000;

/**
 * 在 SKILL.md prompt 内容中查找 !`cmd` 语法并执行，
 * 将输出替换回原始占位符。
 *
 * - 仅适用于 directory/bundled 来源技能；MCP 技能跳过（由调用方判断）
 * - 超时 5s 时返回空字符串并记录 warn
 * - 环境变量注入：SKILL_DIR、CLAUDE_SESSION_ID
 */
async function executeShellInPrompt(content: string, skillDir: string): Promise<string> {
  const matches = [...content.matchAll(SHELL_CMD_PATTERN)];
  if (matches.length === 0) return content;

  let result = content;
  for (const m of matches) {
    const cmd = m[1].trim();
    const placeholder = m[0];
    const output = await runShellCmd(cmd, skillDir);
    result = result.replace(placeholder, output);
  }
  return result;
}

function runShellCmd(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    // 使用 shell 模式（Windows cmd / Unix sh）
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/sh';
    const shellFlag = isWin ? '/c' : '-c';

    const child = execFile(
      shell,
      [shellFlag, cmd],
      {
        cwd,
        timeout: SHELL_EXEC_TIMEOUT_MS,
        env: {
          ...process.env,
          SKILL_DIR: cwd,
          CLAUDE_SESSION_ID: process.env['CLAUDE_SESSION_ID'] ?? '',
        },
        maxBuffer: 64 * 1024,
      },
      (err, stdout, _stderr) => {
        if (err) {
          log.warn({ cmd, err: err.message }, 'Skill shell command failed');
          resolve('');
        } else {
          resolve(stdout.trim());
        }
      }
    );

    // 额外超时保险
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve('');
    }, SHELL_EXEC_TIMEOUT_MS + 500);
  });
}

// ──────────────────────────────────────────────────────────
// §6.8 Skill Hooks 解析
// ──────────────────────────────────────────────────────────

/**
 * 从 SKILL.md YAML frontmatter 中解析 hooks 配置。
 *
 * 支持两种格式：
 *
 * 格式 A（YAML 块）：
 *   hooks:
 *     PreToolUse:
 *       - matcher: "database_*"
 *         command: "echo pre"
 *
 * 格式 B（内联）：
 *   hooks.PreToolUse: [{"matcher": "database_*"}]
 */
function parseSkillHooks(content: string): SkillHookConfig | undefined {
  // 尝试从 YAML frontmatter (--- ... ---) 中提取
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/m);
  if (!fmMatch) return tryInlineHooks(content);

  const fm = fmMatch[1];
  const hooksBlock = fm.match(/^hooks:\s*\n((?:[ \t]+.+\n?)+)/m);
  if (!hooksBlock) return tryInlineHooks(content);

  const hookLines = hooksBlock[1];
  const result: SkillHookConfig = {};

  for (const hookType of ['PreToolUse', 'PostToolUse'] as const) {
    const typeMatch = hookLines.match(
      new RegExp(`^[ \\t]+${hookType}:\\s*\\n((?:[ \\t]{2,}.+\\n?)*)`, 'm')
    );
    if (!typeMatch) continue;

    const entries = parseHookEntries(typeMatch[1]);
    if (entries.length) result[hookType] = entries;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function tryInlineHooks(content: string): SkillHookConfig | undefined {
  const result: SkillHookConfig = {};
  for (const hookType of ['PreToolUse', 'PostToolUse'] as const) {
    const m = content.match(new RegExp(`^hooks\\.${hookType}:\\s*(.+)$`, 'im'));
    if (m) {
      try {
        const entries = JSON.parse(m[1]);
        if (Array.isArray(entries)) result[hookType] = entries;
      } catch { /* ignore */ }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseHookEntries(block: string): Array<{ matcher: string; command?: string }> {
  const entries: Array<{ matcher: string; command?: string }> = [];
  // 每个 entry 以 "- matcher:" 开始
  const entryBlocks = block.split(/^\s{2,}-\s/m).filter(Boolean);
  for (const eb of entryBlocks) {
    const matcher = eb.match(/matcher:\s*['"]?([^'"\n]+)['"]?/i)?.[1]?.trim();
    if (!matcher) continue;
    const command = eb.match(/command:\s*['"]?([^'"\n]+)['"]?/i)?.[1]?.trim();
    entries.push({ matcher, ...(command ? { command } : {}) });
  }
  return entries;
}

