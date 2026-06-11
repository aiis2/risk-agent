/**
 * CustomAgentLoader — .agent.md 自定义代理发现与加载
 * （system-architecture.md v3.3 §2 "Custom Agents (.agent.md 自定义代理)"）
 *
 * 发现路径（优先级依次降低）：
 *   1. project/.agents/      当前工作目录下的项目级代理
 *   2. user/agents/          用户主目录下的个人代理（~/.risk-agent/agents/）
 *   3. system/agents/        系统内置代理（dataDir/agents/）
 *
 * .agent.md 文件格式：
 * ```markdown
 * ---
 * name: risk-analyst
 * description: 专业的风险分析师 Agent
 * model: claude-sonnet
 * tools: [query_database, vector_search, graph_query]
 * temperature: 0.2
 * ---
 * 你是一名专业的风险分析师…（system prompt）
 * ```
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '../logger.js';

const log = createLogger('CustomAgentLoader');

export interface CustomAgentConfig {
  /** 代理唯一名称（通过 @name 调用） */
  name: string;
  /** 人类可读描述 */
  description?: string;
  /** 覆盖默认模型 ID（如 'claude-haiku'） */
  model?: string;
  /** 允许的工具列表（空 = 继承默认） */
  tools?: string[];
  /** LLM temperature */
  temperature?: number;
  /** 解析出的 system prompt（frontmatter 之后的正文） */
  systemPrompt: string;
  /** 来源文件绝对路径 */
  sourcePath: string;
  /** 发现层级 */
  layer: 'project' | 'user' | 'system';
}

const AGENT_FILE_EXT = '.agent.md';

/**
 * 解析 .agent.md 文件
 * 支持 YAML-style frontmatter（--- ... ---）
 */
function parseAgentFile(filePath: string): CustomAgentConfig | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    log.warn({ filePath }, 'Cannot read .agent.md file');
    return null;
  }

  // 分离 frontmatter
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let frontmatter: Record<string, unknown> = {};
  let body = raw;

  if (fmMatch) {
    body = fmMatch[2] ?? '';
    try {
      frontmatter = parseSimpleYaml(fmMatch[1] ?? '');
    } catch (err) {
      log.warn({ filePath, err }, 'Failed to parse frontmatter YAML');
    }
  }

  const name = String(frontmatter['name'] ?? '').trim();
  if (!name) {
    log.warn({ filePath }, '.agent.md missing required "name" field in frontmatter');
    return null;
  }

  // 解析 tools 字段：支持 "[a, b, c]" 和 "- a\n- b" 两种格式
  let tools: string[] | undefined;
  const rawTools = frontmatter['tools'];
  if (Array.isArray(rawTools)) {
    tools = rawTools.map(String);
  } else if (typeof rawTools === 'string') {
    // Strip brackets, split by comma
    tools = rawTools
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return {
    name,
    description: frontmatter['description'] ? String(frontmatter['description']) : undefined,
    model: frontmatter['model'] ? String(frontmatter['model']) : undefined,
    tools,
    temperature: frontmatter['temperature'] != null ? Number(frontmatter['temperature']) : undefined,
    systemPrompt: body.trim(),
    sourcePath: resolve(filePath),
    layer: 'project' // overridden by caller
  };
}

/**
 * 极简 YAML 解析（仅支持一级 key: value）
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    // Array inline: [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      result[key] = rawVal
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      // Remove optional quotes
      result[key] = rawVal.replace(/^['"]|['"]$/g, '');
    }
  }
  return result;
}

/**
 * 扫描目录中的所有 .agent.md 文件
 */
function scanDirectory(dir: string, layer: CustomAgentConfig['layer']): CustomAgentConfig[] {
  if (!existsSync(dir)) return [];
  const results: CustomAgentConfig[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isFile() && extname(entry).toLowerCase() === '.agent.md' ||
          (st.isFile() && entry.endsWith(AGENT_FILE_EXT))) {
        const config = parseAgentFile(full);
        if (config) {
          config.layer = layer;
          results.push(config);
        }
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return results;
}

/**
 * CustomAgentLoader — 加载并去重自定义代理配置
 *
 * 同名代理以 project > user > system 的优先级保留第一个。
 */
export class CustomAgentLoader {
  private readonly searchPaths: Array<{ dir: string; layer: CustomAgentConfig['layer'] }>;

  constructor(opts: {
    /** 项目工作目录（默认 process.cwd()） */
    projectDir?: string;
    /** 系统代理目录（通常为 dataDir/agents/） */
    systemAgentsDir?: string;
  } = {}) {
    const projectDir = opts.projectDir ?? process.cwd();
    const userAgentsDir = join(homedir(), '.risk-agent', 'agents');
    const systemAgentsDir = opts.systemAgentsDir ?? '';

    this.searchPaths = [
      { dir: join(projectDir, '.agents'), layer: 'project' },
      { dir: userAgentsDir, layer: 'user' },
    ];

    if (systemAgentsDir) {
      this.searchPaths.push({ dir: systemAgentsDir, layer: 'system' });
    }
  }

  /**
   * 发现并加载所有可用的自定义代理配置
   *
   * @returns 去重后的代理配置列表（按 name 去重，优先级：project > user > system）
   */
  load(): CustomAgentConfig[] {
    const seen = new Set<string>();
    const configs: CustomAgentConfig[] = [];

    for (const { dir, layer } of this.searchPaths) {
      const found = scanDirectory(dir, layer);
      for (const cfg of found) {
        if (!seen.has(cfg.name)) {
          seen.add(cfg.name);
          configs.push(cfg);
          log.debug({ name: cfg.name, layer, sourcePath: cfg.sourcePath }, 'Custom agent loaded');
        } else {
          log.debug({ name: cfg.name, layer }, 'Custom agent shadowed by higher-priority definition');
        }
      }
    }

    log.info({ count: configs.length }, 'Custom agents loaded');
    return configs;
  }

  /**
   * 按名称查找单个自定义代理
   */
  find(name: string): CustomAgentConfig | undefined {
    return this.load().find((c) => c.name === name);
  }
}
