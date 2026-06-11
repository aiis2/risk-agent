/**
 * PersonaService — 人格档案管理（参考 Hermes SOUL.md）
 *
 * 设计要点：
 * - built-in 人格不可改，仅可 fork
 * - resolveForRun() 根据 sessionPersona > taskKind 推荐 > default 三层降级
 * - 人格 system_prompt 通过 personaLayer 注入到 PromptAssembler
 *
 * 参考：docs/plans/2026-04-29-hermes-persona-memory-and-xterm-cli.md §A1
 */

import { randomUUID } from 'node:crypto';
import { BUILTIN_PERSONAS } from './builtin/personas.js';

export type PersonaScope =
  | 'general'
  | 'analysis'
  | 'knowledge-query'
  | 'skill-management'
  | 'data-analysis';

export interface PersonaTraits {
  tone?: string;
  expertise?: string[];
  style?: string;
  responseStyle?: 'concise' | 'detailed' | 'context-aware-conversational';
}

export interface Persona {
  personaId: string;
  name: string;
  description: string;
  systemPrompt: string;
  traits: PersonaTraits;
  scope: PersonaScope;
  source: 'builtin' | 'user' | 'fork';
  isBuiltIn: boolean;
  parentId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaUpsertInput {
  name: string;
  description?: string;
  systemPrompt: string;
  traits?: PersonaTraits;
  scope?: PersonaScope;
  parentId?: string;
}

export type TaskKindLike = 'analysis' | 'general' | 'knowledge-query' | 'skill-management';

export interface ResolveContext {
  sessionId?: string;
  taskKind?: TaskKindLike;
  routerHintScope?: PersonaScope;
}

interface DbAdapter {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface PersonaRow {
  persona_id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  traits_json: string | null;
  scope: string;
  source: string;
  is_built_in: number;
  parent_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

const TASK_KIND_TO_SCOPE: Record<TaskKindLike, PersonaScope> = {
  analysis: 'analysis',
  'knowledge-query': 'knowledge-query',
  'skill-management': 'skill-management',
  general: 'general'
};

export class PersonaService {
  private seeded = false;

  constructor(private readonly db: DbAdapter) {}

  /** 启动时调用：把内置人格写入 DB（幂等）。 */
  async ensureBuiltins(): Promise<void> {
    if (this.seeded) return;
    for (const builtin of BUILTIN_PERSONAS) {
      await this.db.run(
        `INSERT INTO personas
           (persona_id, name, description, system_prompt, traits_json, scope, source, is_built_in, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 'builtin', 1, 1)
         ON CONFLICT(name) DO UPDATE SET
           description=excluded.description,
           system_prompt=excluded.system_prompt,
           traits_json=excluded.traits_json,
           scope=excluded.scope,
           updated_at=datetime('now')`,
        [
          builtin.personaId,
          builtin.name,
          builtin.description,
          builtin.systemPrompt,
          JSON.stringify(builtin.traits ?? {}),
          builtin.scope
        ]
      );
    }
    this.seeded = true;
  }

  async list(): Promise<Persona[]> {
    const rows = await this.db.all<PersonaRow>(
      `SELECT * FROM personas WHERE enabled=1 ORDER BY is_built_in DESC, name ASC`
    );
    return rows.map(rowToPersona);
  }

  async get(personaId: string): Promise<Persona | null> {
    const rows = await this.db.all<PersonaRow>(
      `SELECT * FROM personas WHERE persona_id=? LIMIT 1`,
      [personaId]
    );
    return rows[0] ? rowToPersona(rows[0]) : null;
  }

  async getByName(name: string): Promise<Persona | null> {
    const rows = await this.db.all<PersonaRow>(
      `SELECT * FROM personas WHERE name=? LIMIT 1`,
      [name]
    );
    return rows[0] ? rowToPersona(rows[0]) : null;
  }

  /** 创建用户人格。built-in 名称冲突时抛错。 */
  async create(input: PersonaUpsertInput): Promise<Persona> {
    const id = `persona_${randomUUID().slice(0, 8)}`;
    await this.db.run(
      `INSERT INTO personas (persona_id, name, description, system_prompt, traits_json, scope, source, is_built_in, enabled, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, 'user', 0, 1, ?)`,
      [
        id,
        input.name,
        input.description ?? '',
        input.systemPrompt,
        JSON.stringify(input.traits ?? {}),
        input.scope ?? 'general',
        input.parentId ?? null
      ]
    );
    const persona = await this.get(id);
    if (!persona) throw new Error('persona_create_failed');
    return persona;
  }

  /** 更新非 built-in 人格。built-in 抛错。 */
  async update(personaId: string, input: Partial<PersonaUpsertInput> & { enabled?: boolean }): Promise<Persona> {
    const existing = await this.get(personaId);
    if (!existing) throw new Error('persona_not_found');
    if (existing.isBuiltIn) throw new Error('persona_builtin_immutable');

    const next = {
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      systemPrompt: input.systemPrompt ?? existing.systemPrompt,
      traits: input.traits ?? existing.traits,
      scope: input.scope ?? existing.scope,
      enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled)
    };

    await this.db.run(
      `UPDATE personas SET name=?, description=?, system_prompt=?, traits_json=?, scope=?, enabled=?, updated_at=datetime('now')
       WHERE persona_id=?`,
      [
        next.name,
        next.description,
        next.systemPrompt,
        JSON.stringify(next.traits ?? {}),
        next.scope,
        next.enabled ? 1 : 0,
        personaId
      ]
    );
    const after = await this.get(personaId);
    if (!after) throw new Error('persona_update_failed');
    return after;
  }

  /** 复制 built-in 为 user persona，可后续修改。 */
  async fork(personaId: string, overrides: Partial<PersonaUpsertInput> = {}): Promise<Persona> {
    const src = await this.get(personaId);
    if (!src) throw new Error('persona_not_found');
    return this.create({
      name: overrides.name ?? `${src.name}（副本）`,
      description: overrides.description ?? src.description,
      systemPrompt: overrides.systemPrompt ?? src.systemPrompt,
      traits: overrides.traits ?? src.traits,
      scope: overrides.scope ?? src.scope,
      parentId: src.personaId
    });
  }

  async delete(personaId: string): Promise<void> {
    const existing = await this.get(personaId);
    if (!existing) return;
    if (existing.isBuiltIn) throw new Error('persona_builtin_immutable');
    await this.db.run(`DELETE FROM personas WHERE persona_id=?`, [personaId]);
  }

  /** 设置会话当前 persona。 */
  async setSessionPersona(sessionId: string, personaId: string, source: 'auto' | 'user' | 'fallback' = 'user'): Promise<void> {
    const persona = await this.get(personaId);
    if (!persona) throw new Error('persona_not_found');
    await this.db.run(
      `INSERT INTO session_persona (session_id, persona_id, source, applied_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(session_id) DO UPDATE SET persona_id=excluded.persona_id, source=excluded.source, applied_at=datetime('now')`,
      [sessionId, personaId, source]
    );
  }

  async getSessionPersona(sessionId: string): Promise<Persona | null> {
    const rows = await this.db.all<{ persona_id: string }>(
      `SELECT persona_id FROM session_persona WHERE session_id=? LIMIT 1`,
      [sessionId]
    );
    if (!rows[0]) return null;
    return this.get(rows[0].persona_id);
  }

  /**
   * 三层降级：sessionPersona > taskKind 推荐 > 默认通用助手
   */
  async resolveForRun(ctx: ResolveContext): Promise<{ persona: Persona; via: 'session' | 'task-kind' | 'default' }> {
    if (ctx.sessionId) {
      const sp = await this.getSessionPersona(ctx.sessionId);
      if (sp && sp.enabled) return { persona: sp, via: 'session' };
    }

    const targetScope = ctx.routerHintScope
      ?? (ctx.taskKind ? TASK_KIND_TO_SCOPE[ctx.taskKind] : 'general');

    const rows = await this.db.all<PersonaRow>(
      `SELECT * FROM personas WHERE scope=? AND enabled=1 ORDER BY is_built_in DESC, created_at ASC LIMIT 1`,
      [targetScope]
    );
    if (rows[0]) return { persona: rowToPersona(rows[0]), via: 'task-kind' };

    const fallback = await this.getByName('通用助手');
    if (!fallback) {
      throw new Error('persona_default_missing — call ensureBuiltins() first');
    }
    return { persona: fallback, via: 'default' };
  }

  /**
   * 推荐 persona ID（不写入 session_persona，仅返回）。
   * 由 RunRouter 调用，写入 RoutingDecision.recommendedPersonaId。
   */
  async recommendForTaskKind(taskKind: TaskKindLike): Promise<string | null> {
    const scope = TASK_KIND_TO_SCOPE[taskKind] ?? 'general';
    const rows = await this.db.all<{ persona_id: string }>(
      `SELECT persona_id FROM personas WHERE scope=? AND enabled=1 ORDER BY is_built_in DESC LIMIT 1`,
      [scope]
    );
    return rows[0]?.persona_id ?? null;
  }
}

function rowToPersona(row: PersonaRow): Persona {
  let traits: PersonaTraits = {};
  try { traits = row.traits_json ? JSON.parse(row.traits_json) : {}; } catch { /* ignore */ }
  return {
    personaId: row.persona_id,
    name: row.name,
    description: row.description ?? '',
    systemPrompt: row.system_prompt,
    traits,
    scope: row.scope as PersonaScope,
    source: row.source as Persona['source'],
    isBuiltIn: row.is_built_in === 1,
    parentId: row.parent_id ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
