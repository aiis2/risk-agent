/**
 * MemoryService — 双层记忆系统（参考 agent-framework.md §7）
 *
 * - Long-Term Memory: SQLite `memories` 表持久化，支持向量检索 (LanceDB) 或关键词模糊检索 fallback
 * - Short-Term Memory: 内存 Map，按会话维护最近 N 条摘要，不跨进程持久
 */

export type MemoryCategory =
  | 'domain_knowledge'
  | 'user_preference'
  | 'analysis_pattern'
  | 'risk_template';

export interface LongTermMemoryEntry {
  id: string;
  content: string;
  category: MemoryCategory;
  sessionId?: string;
  businessName?: string;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  keywords?: string[];
}

export interface ShortTermEntry {
  round: number;
  summary: string;
  keyFindings: string[];
  timestamp: number;
}

export interface MemorySearchResult extends LongTermMemoryEntry {
  score: number;
}

/** 粗略的关键词提取（LLM 不可用时的 fallback） */
function extractKeywords(text: string): string[] {
  return text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 20);
}

/** BM25-like 简单得分：匹配关键词数 / 总关键词数 */
function simpleRelevanceScore(entry: LongTermMemoryEntry, queryKeywords: string[]): number {
  const entryText = (entry.content + ' ' + (entry.keywords ?? []).join(' ')).toLowerCase();
  const matches = queryKeywords.filter((kw) => entryText.includes(kw.toLowerCase())).length;
  return queryKeywords.length ? matches / queryKeywords.length : 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// MemoryService
// ──────────────────────────────────────────────────────────────────────────────

export class MemoryService {
  /** 每个会话最多保留多少条短期记忆 */
  private readonly SHORT_TERM_MAX_ROUNDS: number;
  /** shortTermStore 中最多保存多少个不同 sessionId 的条目，防止长期运行内存无界增长 */
  private readonly SHORT_TERM_MAX_SESSIONS = 200;
  /** 短期记忆: sessionId → ShortTermEntry[] */
  private readonly shortTermStore = new Map<string, ShortTermEntry[]>();

  /**
   * @param db  SQLite run/all 接口（来自 StorageBackendRegistry.getStructuredStore()）
   * @param shortTermMaxRounds 默认 5 轮
   */
  constructor(
    private readonly db: {
      run(sql: string, params?: unknown[]): Promise<void>;
      all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    },
    shortTermMaxRounds = 5
  ) {
    this.SHORT_TERM_MAX_ROUNDS = shortTermMaxRounds;
  }

  // ─── Long-Term Memory ────────────────────────────────────────────────────────

  /** 写入一条长期记忆。相同 content 已存在时跳过（幂等）。 */
  async saveLongTermMemory(entry: Omit<LongTermMemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'accessCount'>): Promise<string> {
    const { randomUUID } = await import('node:crypto');
    const id = randomUUID();
    const now = new Date().toISOString();
    const keywords = entry.keywords ?? extractKeywords(entry.content);

    await this.db.run(
      `INSERT OR IGNORE INTO memories
         (memory_id, memory_type, key, value, metadata)
       VALUES (?, 'long_term', ?, ?, ?)`,
      [
        id,
        entry.content.slice(0, 200), // key = 内容前200字
        entry.content,
        JSON.stringify({
          category: entry.category,
          sessionId: entry.sessionId,
          businessName: entry.businessName,
          keywords,
          createdAt: now,
          lastAccessedAt: now,
          accessCount: 1
        })
      ]
    );
    return id;
  }

  /** 搜索长期记忆（关键词匹配 + 热度排序，topK 默认 5） */
  async searchLongTermMemory(query: string, topK = 5): Promise<MemorySearchResult[]> {
    const rows = await this.db.all<{
      memory_id: string;
      key: string;
      value: string;
      metadata: string;
    }>(`SELECT memory_id, key, value, metadata FROM memories WHERE memory_type='long_term' LIMIT 200`);

    const queryKeywords = extractKeywords(query);

    const scored = rows.map((row) => {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(row.metadata); } catch { /* ignore */ }

      const entry: LongTermMemoryEntry = {
        id: row.memory_id,
        content: row.value,
        category: (meta.category as MemoryCategory) ?? 'domain_knowledge',
        sessionId: meta.sessionId as string | undefined,
        businessName: meta.businessName as string | undefined,
        createdAt: new Date((meta.createdAt as string) ?? 0),
        lastAccessedAt: new Date((meta.lastAccessedAt as string) ?? 0),
        accessCount: (meta.accessCount as number) ?? 0,
        keywords: meta.keywords as string[] | undefined
      };

      const score = simpleRelevanceScore(entry, queryKeywords) * 0.7
        + (entry.accessCount / 100) * 0.3; // 热度加权

      return { ...entry, score };
    });

    return scored
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** 更新长期记忆访问计数（懒更新，不阻塞主流程） */
  async touchMemory(id: string): Promise<void> {
    await this.db.run(
      `UPDATE memories
         SET metadata = json_patch(metadata, json_object(
           'lastAccessedAt', datetime('now'),
           'accessCount',    json_extract(metadata,'$.accessCount') + 1
         ))
       WHERE memory_id = ?`,
      [id]
    ).catch(() => undefined);
  }

  // ─── Short-Term Memory ───────────────────────────────────────────────────────

  /** 添加一条短期记忆（超过 MAX_ROUNDS 时滚动丢弃最早的） */
  addShortTermEntry(sessionId: string, entry: Omit<ShortTermEntry, 'timestamp'>): void {
    const arr = this.shortTermStore.get(sessionId) ?? [];
    arr.push({ ...entry, timestamp: Date.now() });
    if (arr.length > this.SHORT_TERM_MAX_ROUNDS) arr.shift();
    this.shortTermStore.set(sessionId, arr);

    // Evict the oldest session entry when the session count exceeds the cap.
    // This prevents the Map from growing without bound on long-lived servers.
    if (this.shortTermStore.size > this.SHORT_TERM_MAX_SESSIONS) {
      const oldestKey = this.shortTermStore.keys().next().value;
      if (oldestKey !== undefined) this.shortTermStore.delete(oldestKey);
    }
  }

  /** 获取会话短期记忆摘要（将所有 keyFindings 拼接） */
  getShortTermSummary(sessionId: string): string {
    const arr = this.shortTermStore.get(sessionId);
    if (!arr?.length) return '';
    return arr
      .map(
        (e) =>
          `[轮次 ${e.round}] ${e.summary}` +
          (e.keyFindings.length ? `\n  关键发现: ${e.keyFindings.join('；')}` : '')
      )
      .join('\n');
  }

  /** 清空会话短期记忆（会话结束时调用） */
  clearShortTerm(sessionId: string): void {
    this.shortTermStore.delete(sessionId);
  }

  /** 获取短期记忆条目（原始） */
  getShortTermEntries(sessionId: string): ShortTermEntry[] {
    return this.shortTermStore.get(sessionId) ?? [];
  }

  // ─── System RAG ─────────────────────────────────────────────────────────────

  /**
   * 检索可用技能/组件（从 skills 表或内置列表）。
   * 供 PromptAssembler 注入 <available-components> 层。
   */
  async retrieveComponents(query: string, topK = 3): Promise<Array<{ name: string; description: string }>> {
    try {
      const rows = await this.db.all<{ skill_name: string; description: string }>(
        `SELECT skill_name, description FROM skills LIMIT 50`
      );
      if (!rows.length) return [];
      const queryKw = extractKeywords(query);
      const scored = rows.map((r) => {
        const text = (r.skill_name + ' ' + (r.description ?? '')).toLowerCase();
        const matches = queryKw.filter((kw) => text.includes(kw.toLowerCase())).length;
        return { name: r.skill_name, description: r.description ?? '', score: matches };
      });
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(({ name, description }) => ({ name, description }));
    } catch {
      return [];
    }
  }
}
