/**
 * UserProfileService — 用户画像（参考 Hermes USER.md / Honcho dialectic user modeling）
 *
 * 单 owner_key 设计，预留多用户。所有读写均通过 SQLite。
 * 由 prompt/layers/userProfile.ts 注入到 PromptAssembler。
 */

import { randomUUID } from 'node:crypto';

export interface UserProfileTraits {
  industry?: string;
  role?: string;
  languagePref?: string;
  [k: string]: unknown;
}

export interface UserProfilePreferences {
  verbosity?: 'concise' | 'detailed';
  format?: 'markdown' | 'plain';
  [k: string]: unknown;
}

export interface LearnedFact {
  key?: string;
  value: string;
  learnedAt?: string;
  source?: string;
}

export interface UserProfile {
  profileId: string;
  ownerKey: string;
  displayName?: string;
  traits: UserProfileTraits;
  preferences: UserProfilePreferences;
  learnedFacts: LearnedFact[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserProfileInput {
  displayName?: string;
  traits?: UserProfileTraits;
  preferences?: UserProfilePreferences;
}

interface DbAdapter {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface ProfileRow {
  profile_id: string;
  owner_key: string;
  display_name: string | null;
  traits_json: string | null;
  preferences_json: string | null;
  learned_facts_json: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_OWNER_KEY = 'local-default';
const MAX_LEARNED_FACTS = 30;

export class UserProfileService {
  constructor(private readonly db: DbAdapter) {}

  async getOrCreate(ownerKey = DEFAULT_OWNER_KEY): Promise<UserProfile> {
    const rows = await this.db.all<ProfileRow>(
      `SELECT * FROM user_profiles WHERE owner_key=? LIMIT 1`,
      [ownerKey]
    );
    if (rows[0]) return rowToProfile(rows[0]);

    const id = `profile_${randomUUID().slice(0, 8)}`;
    await this.db.run(
      `INSERT INTO user_profiles (profile_id, owner_key, traits_json, preferences_json, learned_facts_json, version)
       VALUES (?, ?, '{}', '{}', '[]', 1)`,
      [id, ownerKey]
    );
    const created = await this.db.all<ProfileRow>(
      `SELECT * FROM user_profiles WHERE profile_id=? LIMIT 1`,
      [id]
    );
    return rowToProfile(created[0]);
  }

  async update(ownerKey: string, input: UpdateUserProfileInput): Promise<UserProfile> {
    const current = await this.getOrCreate(ownerKey);
    const next = {
      displayName: input.displayName ?? current.displayName ?? null,
      traits: { ...current.traits, ...(input.traits ?? {}) },
      preferences: { ...current.preferences, ...(input.preferences ?? {}) }
    };
    await this.db.run(
      `UPDATE user_profiles SET display_name=?, traits_json=?, preferences_json=?, version=version+1, updated_at=datetime('now')
       WHERE owner_key=?`,
      [
        next.displayName,
        JSON.stringify(next.traits),
        JSON.stringify(next.preferences),
        ownerKey
      ]
    );
    return this.getOrCreate(ownerKey);
  }

  /** 合并新 learned facts，去重（key+value 完全一致跳过），保留最近 N 条。 */
  async mergeFacts(ownerKey: string, facts: LearnedFact[]): Promise<UserProfile> {
    if (!facts.length) return this.getOrCreate(ownerKey);
    const current = await this.getOrCreate(ownerKey);

    const dedupKey = (f: LearnedFact) => `${f.key ?? ''}::${f.value}`;
    const seen = new Set(current.learnedFacts.map(dedupKey));
    const additions = facts.filter((f) => f.value && !seen.has(dedupKey(f)));
    if (!additions.length) return current;

    const merged = [...current.learnedFacts, ...additions.map((f) => ({
      ...f,
      learnedAt: f.learnedAt ?? new Date().toISOString()
    }))].slice(-MAX_LEARNED_FACTS);

    await this.db.run(
      `UPDATE user_profiles SET learned_facts_json=?, version=version+1, updated_at=datetime('now')
       WHERE owner_key=?`,
      [JSON.stringify(merged), ownerKey]
    );
    return this.getOrCreate(ownerKey);
  }

  async reset(ownerKey: string): Promise<UserProfile> {
    await this.db.run(
      `UPDATE user_profiles SET display_name=NULL, traits_json='{}', preferences_json='{}', learned_facts_json='[]', version=version+1, updated_at=datetime('now')
       WHERE owner_key=?`,
      [ownerKey]
    );
    return this.getOrCreate(ownerKey);
  }
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    profileId: row.profile_id,
    ownerKey: row.owner_key,
    displayName: row.display_name ?? undefined,
    traits: safeParse(row.traits_json, {}),
    preferences: safeParse(row.preferences_json, {}),
    learnedFacts: safeParse<LearnedFact[]>(row.learned_facts_json, []),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
