/**
 * InsightsService — A4 洞察汇总服务
 *
 * 根据 memory_facts 按时间窗聚合最近记忆，分类展示。
 */

export interface InsightGroup {
  category: string;
  label: string;
  facts: Array<{
    fact_id: string;
    content: string;
    confidence: number;
    created_at: string;
    use_count: number;
  }>;
}

export interface InsightsSummary {
  totalFacts: number;
  generatedAt: string;
  days: number;
  groups: InsightGroup[];
}

const CATEGORY_LABELS: Record<string, string> = {
  domain_knowledge: '领域知识',
  user_preference: '用户偏好',
  analysis_pattern: '分析模式',
  risk_template: '风控模板',
  general: '通用记忆',
};

export interface InsightsDeps {
  db: {
    all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  };
}

export class InsightsService {
  constructor(private readonly deps: InsightsDeps) {}

  async getRecentInsights(days = 30): Promise<InsightsSummary> {
    const timeFilter = days > 0 ? `WHERE created_at >= datetime('now', '-${days} days')` : '';

    const rows = await this.deps.db.all<{
      fact_id: string;
      content: string;
      category: string;
      confidence: number;
      created_at: string;
      use_count: number;
    }>(
      `SELECT fact_id, content, category, confidence, created_at, use_count
       FROM memory_facts
       ${timeFilter}
       ORDER BY use_count DESC, confidence DESC, created_at DESC
       LIMIT 100`,
    );

    const groupMap = new Map<string, InsightGroup>();
    for (const row of rows) {
      const cat = row.category ?? 'general';
      if (!groupMap.has(cat)) {
        groupMap.set(cat, {
          category: cat,
          label: CATEGORY_LABELS[cat] ?? cat,
          facts: [],
        });
      }
      groupMap.get(cat)!.facts.push({
        fact_id: row.fact_id,
        content: row.content,
        confidence: row.confidence,
        created_at: row.created_at,
        use_count: row.use_count,
      });
    }

    return {
      totalFacts: rows.length,
      generatedAt: new Date().toISOString(),
      days,
      groups: Array.from(groupMap.values()),
    };
  }
}
