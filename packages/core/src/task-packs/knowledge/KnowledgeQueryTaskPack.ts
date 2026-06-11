import type { TaskPack, TaskPackContext, RunEvent, RunArtifact, VerificationRecord } from '../../harness/types.js';
import type { StorageBackendRegistry } from '../../storage/registry.js';

type KnowledgeMatchSource = 'scenario' | 'rule' | 'datasource-document';

interface KnowledgeQueryPlan {
  query: string;
  limit: number;
  keywords: string[];
  sourceId?: string;
  attachmentContext?: string;
  toolIds: string[];
  allowedSources: KnowledgeMatchSource[];
}

interface KnowledgeQueryMatch {
  sourceType: KnowledgeMatchSource;
  id: string;
  title: string;
  snippet: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface KnowledgeQueryResult {
  query: string;
  keywords: string[];
  counts: Record<KnowledgeMatchSource, number>;
  matches: KnowledgeQueryMatch[];
}

export class KnowledgeQueryTaskPack implements TaskPack<Record<string, unknown>, KnowledgeQueryPlan, KnowledgeQueryResult> {
  readonly kind = 'knowledge-query' as const;
  readonly contractVersion = 'knowledge-query.phase2';
  readonly inputSchema = {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'number' },
      sourceId: { type: 'string' },
      attachmentContext: { type: 'string' },
      toolIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };

  constructor(private readonly deps: { storage: StorageBackendRegistry }) {}

  async intake(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      query: normalizeString(input.query ?? input.prompt),
      limit: clampLimit(input.limit),
      sourceId: normalizeOptionalString(input.sourceId),
      attachmentContext: normalizeOptionalString(input.attachmentContext),
      toolIds: normalizeStringArray(input.toolIds),
    };
  }

  async plan(input: Record<string, unknown>): Promise<KnowledgeQueryPlan> {
    const query = normalizeString(input.query);
    const attachmentContext = normalizeOptionalString(input.attachmentContext);
    const toolIds = normalizeStringArray(input.toolIds);
    return {
      query,
      limit: clampLimit(input.limit),
      sourceId: normalizeOptionalString(input.sourceId),
      attachmentContext,
      toolIds,
      keywords: buildKeywords(query, attachmentContext),
      allowedSources: resolveAllowedSources(toolIds),
    };
  }

  async *execute(plan: KnowledgeQueryPlan, ctx: TaskPackContext): AsyncGenerator<RunEvent, KnowledgeQueryResult> {
    if (!plan.query) {
      throw new Error('knowledge query is required');
    }

    await ctx.emit({
      type: 'knowledge_query_started',
      payload: {
        query: plan.query,
        keywords: plan.keywords,
        allowedSources: plan.allowedSources,
        syntheticMetrics: {
          turnCount: 1,
          toolCallCount: plan.allowedSources.length,
        },
      },
    });

    const [scenarioMatches, ruleMatches, datasourceMatches] = await Promise.all([
      plan.allowedSources.includes('scenario') ? this.searchScenarios(plan) : Promise.resolve([]),
      plan.allowedSources.includes('rule') ? this.searchRules(plan) : Promise.resolve([]),
      plan.allowedSources.includes('datasource-document') ? this.searchDataSourceDocuments(plan) : Promise.resolve([]),
    ]);

    const matches = [...scenarioMatches, ...ruleMatches, ...datasourceMatches]
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-CN'))
      .slice(0, plan.limit);

    const result: KnowledgeQueryResult = {
      query: plan.query,
      keywords: plan.keywords,
      counts: {
        scenario: scenarioMatches.length,
        rule: ruleMatches.length,
        'datasource-document': datasourceMatches.length,
      },
      matches,
    };

    await ctx.createSemanticCheckpoint('knowledge-search-complete', {
      query: plan.query,
      totalMatches: matches.length,
      counts: result.counts,
      allowedSources: plan.allowedSources,
    });

    await ctx.emit({
      type: 'knowledge_query_completed',
      payload: {
        query: plan.query,
        totalMatches: matches.length,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  async verify(result: KnowledgeQueryResult, ctx: TaskPackContext): Promise<VerificationRecord> {
    const hasQuery = result.query.trim().length > 0;
    const decision = !hasQuery ? 'fail' : result.matches.length > 0 ? 'pass' : 'warn';
    const reasons = !hasQuery
      ? ['missing_query']
      : result.matches.length > 0
        ? [`matches_found:${result.matches.length}`]
        : ['no_matches_found'];

    return {
      verificationId: `ver_${ctx.run.runId}`,
      runId: ctx.run.runId,
      verifierType: 'contract',
      contractVersion: this.contractVersion,
      decision,
      reasons,
      followUpAction: decision === 'fail' ? 'fail_run' : 'none',
      createdAt: ctx.now(),
    };
  }

  async projectResult(result: KnowledgeQueryResult, ctx: TaskPackContext): Promise<RunArtifact[]> {
    return [
      await ctx.publishArtifact({
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: result as unknown as Record<string, unknown>,
      }),
    ];
  }

  private async searchScenarios(plan: KnowledgeQueryPlan): Promise<KnowledgeQueryMatch[]> {
    const store = this.deps.storage.getStructuredStore();
    const query = buildKeywordQuery(['name', 'description', 'manual_notes'], plan.keywords);
    const rows = await store.all<{
      scenario_id: string;
      name: string;
      description: string | null;
      domain: string | null;
      status: string | null;
      manual_notes: string | null;
    }>(
      `SELECT scenario_id, name, description, domain, status, manual_notes
       FROM business_scenarios
       WHERE ${query.clause}
       ORDER BY updated_at DESC
       LIMIT ?`,
      [...query.params, Math.max(plan.limit * 4, 12)],
    );

    return rows
      .map((row) => {
        const searchableText = [row.name, row.description ?? '', row.manual_notes ?? ''].join('\n');
        return {
          sourceType: 'scenario' as const,
          id: row.scenario_id,
          title: row.name,
          snippet: createSnippet(searchableText, plan.keywords),
          score: scoreText(searchableText, plan.keywords),
          metadata: {
            domain: row.domain ?? '',
            status: row.status ?? '',
          },
        };
      })
      .filter((match) => match.score > 0);
  }

  private async searchRules(plan: KnowledgeQueryPlan): Promise<KnowledgeQueryMatch[]> {
    const store = this.deps.storage.getStructuredStore();
    const query = buildKeywordQuery(['rule_name', 'description', 'biz_type', 'rule_type', 'coverage_json'], plan.keywords);
    const rows = await store.all<{
      rule_id: string;
      rule_name: string;
      biz_type: string | null;
      rule_type: string | null;
      risk_level: string | null;
      description: string | null;
      coverage_json: string | null;
    }>(
      `SELECT rule_id, rule_name, biz_type, rule_type, risk_level, description, coverage_json
       FROM risk_rules
       WHERE (${query.clause}) AND status='active'
       ORDER BY synced_at DESC
       LIMIT ?`,
      [...query.params, Math.max(plan.limit * 4, 12)],
    );

    return rows
      .map((row) => {
        const coverage = safeParseArray(row.coverage_json);
        const searchableText = [
          row.rule_name,
          row.description ?? '',
          row.biz_type ?? '',
          row.rule_type ?? '',
          coverage.join(' '),
        ].join('\n');

        return {
          sourceType: 'rule' as const,
          id: row.rule_id,
          title: row.rule_name,
          snippet: createSnippet(searchableText, plan.keywords),
          score: scoreText(searchableText, plan.keywords),
          metadata: {
            bizType: row.biz_type ?? '',
            ruleType: row.rule_type ?? '',
            riskLevel: row.risk_level ?? '',
            coverage,
          },
        };
      })
      .filter((match) => match.score > 0);
  }

  private async searchDataSourceDocuments(plan: KnowledgeQueryPlan): Promise<KnowledgeQueryMatch[]> {
    const store = this.deps.storage.getStructuredStore();
    const query = buildKeywordQuery(['title', 'content'], plan.keywords);
    const sourceClause = plan.sourceId ? 'source_id=? AND ' : '';
    const params = plan.sourceId ? [plan.sourceId, ...query.params] : query.params;

    try {
      const rows = await store.all<{
        document_id: string;
        title: string;
        document_type: string;
        content: string;
        metadata_json: string | null;
      }>(
        `SELECT document_id, title, document_type, content, metadata_json
         FROM datasource_knowledge_documents
         WHERE ${sourceClause}${query.clause}
         ORDER BY created_at DESC
         LIMIT ?`,
        [...params, Math.max(plan.limit * 4, 12)],
      );

      return rows
        .map((row) => ({
          sourceType: 'datasource-document' as const,
          id: row.document_id,
          title: row.title,
          snippet: createSnippet(row.content, plan.keywords),
          score: scoreText([row.title, row.content].join('\n'), plan.keywords),
          metadata: {
            documentType: row.document_type,
            ...safeParseObject(row.metadata_json),
          },
        }))
        .filter((match) => match.score > 0);
    } catch {
      return [];
    }
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function clampLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 6);
  if (!Number.isFinite(numeric)) return 6;
  return Math.max(1, Math.min(Math.trunc(numeric), 12));
}

function buildKeywords(query: string, attachmentContext?: string): string[] {
  const pieces = [query, ...extractAttachmentKeywords(attachmentContext)]
    .flatMap((entry) => tokenizeKeywordSource(entry))
    .filter(Boolean);

  return [...new Set([query, ...pieces].filter((part) => part.length > 0))].slice(0, 12);
}

function extractAttachmentKeywords(attachmentContext?: string): string[] {
  if (!attachmentContext) return [];

  return attachmentContext
    .split('\n')
    .map((line) => line.replace(/^附件上下文：/u, '').replace(/^[-•]\s*/u, '').replace(/^摘要:\s*/u, '').trim())
    .filter(Boolean)
    .flatMap((line) => tokenizeKeywordSource(line));
}

function tokenizeKeywordSource(value: string): string[] {
  return value
    .split(/[\s,，。；;、|/()]+/u)
    .flatMap((part) => part.split(/(?:涉及|包括|关注|需要|以及|同时|相关|附件|工单|本次|摘要|与|和|并|伴随)/u))
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function resolveAllowedSources(toolIds: string[]): KnowledgeMatchSource[] {
  if (toolIds.length === 0) {
    return ['scenario', 'rule', 'datasource-document'];
  }

  const enabled = new Set(toolIds);
  const allowed: KnowledgeMatchSource[] = [];
  if (enabled.has('query_database') || enabled.has('query_database_external') || enabled.has('get_database_schema')) {
    allowed.push('scenario', 'rule');
  }
  if (enabled.has('datasource_knowledge_search') || enabled.has('vector_search') || enabled.has('file_parse')) {
    allowed.push('datasource-document');
  }
  return [...new Set(allowed)];
}

function buildKeywordQuery(fields: string[], keywords: string[]): { clause: string; params: string[] } {
  const tokens = keywords.length > 0 ? keywords : [''];
  const params: string[] = [];
  const groups = tokens.map((keyword) => {
    const comparisons = fields.map((field) => {
      params.push(`%${keyword}%`);
      return `${field} LIKE ?`;
    });
    return `(${comparisons.join(' OR ')})`;
  });

  return {
    clause: groups.join(' OR '),
    params,
  };
}

function scoreText(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0;

  const haystack = text.toLowerCase();
  let score = 0;
  keywords.forEach((keyword, index) => {
    const needle = keyword.toLowerCase();
    if (!needle) return;
    if (haystack.includes(needle)) {
      score += index === 0 ? 1.5 : 1;
    }
  });

  return Number((score / (keywords.length + 0.5)).toFixed(3));
}

function createSnippet(text: string, keywords: string[]): string {
  const source = text.trim();
  if (!source) return '';

  const lower = source.toLowerCase();
  const keyword = keywords.find((item) => lower.includes(item.toLowerCase()));
  if (!keyword) {
    return source.slice(0, 160);
  }

  const start = Math.max(0, lower.indexOf(keyword.toLowerCase()) - 36);
  const end = Math.min(source.length, start + 160);
  return source.slice(start, end).trim();
}

function safeParseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function safeParseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
