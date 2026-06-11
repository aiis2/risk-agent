/**
 * SessionSearchService — A4 会话/记忆 FTS5 全文搜索
 *
 * 使用 memory_facts_fts (FTS5) 对记忆事实进行全文检索。
 * 支持按 category 过滤、按时间窗限制、分页。
 */

export interface MemoryFactRow {
  fact_id: string;
  content: string;
  category: string;
  source_session: string | null;
  source_run: string | null;
  confidence: number;
  use_count: number;
  created_at: string;
}

export interface SearchMemoryFactsInput {
  query: string;
  category?: string;
  /** 限制最近 N 天（0 = 不限） */
  days?: number;
  limit?: number;
}

export interface SessionSearchDeps {
  db: {
    all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    run(sql: string, params?: unknown[]): Promise<unknown>;
  };
}

function splitSearchTerms(query: string): string[] {
  return query
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function buildFtsQuery(query: string): string {
  return splitSearchTerms(query)
    .slice(0, 5)
    .join(' OR ');
}

function buildLikeTerms(query: string): string[] {
  const terms = new Set<string>();

  splitSearchTerms(query).forEach((part) => {
    if (/[a-zA-Z0-9]/.test(part)) {
      terms.add(part.toLowerCase());
    }

    const chineseSegments = part.match(/[\u4e00-\u9fff]+/gu) ?? [];
    chineseSegments.forEach((segment) => {
      if (segment.length >= 2 && segment.length <= 6) {
        terms.add(segment);
      }
      for (const size of [2, 3]) {
        for (let index = 0; index <= segment.length - size; index += 1) {
          terms.add(segment.slice(index, index + size));
        }
      }
    });
  });

  return Array.from(terms)
    .filter((term) => term.length >= 2)
    .sort((left, right) => right.length - left.length)
    .slice(0, 8);
}

export class SessionSearchService {
  constructor(private readonly deps: SessionSearchDeps) {}

  async searchMemoryFacts(input: SearchMemoryFactsInput): Promise<MemoryFactRow[]> {
    const { query, category, days = 0, limit = 20 } = input;

    const keywords = buildFtsQuery(query);

    if (!keywords) return [];

    const params: unknown[] = [keywords];
    let timeFilter = '';
    if (days > 0) {
      timeFilter = `AND mf.created_at >= datetime('now', ?)`;
      params.push(`-${days} days`);
    }
    let catFilter = '';
    if (category) {
      catFilter = `AND mf.category = ?`;
      params.push(category);
    }
    params.push(limit);

    const ftsResults = await this.deps.db.all<MemoryFactRow>(
      `SELECT mf.fact_id, mf.content, mf.category, mf.source_session, mf.source_run,
              mf.confidence, mf.use_count, mf.created_at
       FROM memory_facts_fts fts
       JOIN memory_facts mf ON mf.rowid = fts.rowid
       WHERE memory_facts_fts MATCH ?
       ${timeFilter}
       ${catFilter}
       ORDER BY rank
       LIMIT ?`,
      params,
    );

    if (ftsResults.length > 0) {
      return ftsResults;
    }

    const likeTerms = buildLikeTerms(query);
    if (likeTerms.length === 0) {
      return [];
    }

    const likeParams: unknown[] = [...likeTerms.map((term) => `%${term}%`)];
    let likeTimeFilter = '';
    if (days > 0) {
      likeTimeFilter = `AND mf.created_at >= datetime('now', ?)`;
      likeParams.push(`-${days} days`);
    }
    let likeCategoryFilter = '';
    if (category) {
      likeCategoryFilter = `AND mf.category = ?`;
      likeParams.push(category);
    }
    likeParams.push(limit);

    return this.deps.db.all<MemoryFactRow>(
      `SELECT mf.fact_id, mf.content, mf.category, mf.source_session, mf.source_run,
              mf.confidence, mf.use_count, mf.created_at
       FROM memory_facts mf
       WHERE (${likeTerms.map(() => 'mf.content LIKE ?').join(' OR ')})
       ${likeTimeFilter}
       ${likeCategoryFilter}
       ORDER BY CASE mf.category WHEN 'user_preference' THEN 0 ELSE 1 END,
                mf.use_count DESC,
                mf.confidence DESC,
                mf.created_at DESC
       LIMIT ?`,
      likeParams,
    );
  }

  /** 更新 fact 的使用计数（检索到时调用） */
  async recordFactUsage(factIds: string[]): Promise<void> {
    if (factIds.length === 0) return;
    for (const id of factIds) {
      await this.deps.db.run(
        `UPDATE memory_facts SET use_count = use_count + 1, last_used_at = datetime('now') WHERE fact_id = ?`,
        [id],
      ).catch(() => undefined);
    }
  }
}
