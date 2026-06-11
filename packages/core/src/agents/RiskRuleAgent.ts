import type { RiskRule, StreamEvent } from './base/types.js';
import { BaseAgent, type AgentRunOptions } from './base/BaseAgent.js';
import type { StorageBackendRegistry } from '../storage/registry.js';

export interface RiskRuleAgentOptions {
  sessionId: string;
  storage: StorageBackendRegistry;
  scope?: { bizTypes?: string[]; ruleTypes?: string[] };
}

/**
 * RiskRuleAgent — 规则加载 Sub-Agent（03-analysis-engine.md §7）
 *
 * 从结构化存储读取活跃规则集，支持按业务类型和规则类型过滤。
 * 产出 RiskRuleSet 供 OrchestratorAgent 传递给 GapAnalysis 阶段。
 */
export class RiskRuleAgent extends BaseAgent {
  private rules: RiskRule[] = [];

  constructor(private readonly options: RiskRuleAgentOptions) {
    super(options.sessionId);
  }

  getRules(): RiskRule[] {
    return this.rules;
  }

  async *run(_opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined> {
    yield {
      type: 'subagent_spawned',
      agentId: 'riskrule',
      description: '加载风控规则库',
      taskType: 'subagent',
      workerRole: 'riskrule'
    };

    const store = this.options.storage.getStructuredStore();
    const scope = this.options.scope;
    const conds: string[] = [`status='active'`];
    const params: unknown[] = [];

    if (scope?.bizTypes?.length) {
      conds.push(`biz_type IN (${scope.bizTypes.map(() => '?').join(',')})`);
      params.push(...scope.bizTypes);
    }
    if (scope?.ruleTypes?.length) {
      conds.push(`rule_type IN (${scope.ruleTypes.map(() => '?').join(',')})`);
      params.push(...scope.ruleTypes);
    }

    const rows = await store.all<any>(
      `SELECT * FROM risk_rules WHERE ${conds.join(' AND ')} ORDER BY synced_at DESC`,
      params
    );

    this.rules = rows.map(rowToRule);

    // 按 bizType 统计规则分布
    const byBizType: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = {};
    for (const r of this.rules) {
      if (r.bizType) byBizType[r.bizType] = (byBizType[r.bizType] ?? 0) + 1;
      if (r.riskLevel) byRiskLevel[r.riskLevel] = (byRiskLevel[r.riskLevel] ?? 0) + 1;
    }

    const topBizTypes = Object.entries(byBizType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}(${v})`)
      .join(', ');

    yield {
      type: 'subagent_complete',
      agentId: 'riskrule',
      status: 'completed',
      summary: `已加载 ${this.rules.length} 条活跃规则${topBizTypes ? `，主要业务: ${topBizTypes}` : ''}`
    };
  }
}

function rowToRule(r: any): RiskRule {
  return {
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    ruleCode: r.rule_code ?? undefined,
    bizType: r.biz_type ?? undefined,
    ruleType: r.rule_type ?? undefined,
    riskLevel: r.risk_level ?? undefined,
    source: r.source ?? undefined,
    description: r.description ?? undefined,
    conditions: r.conditions_json ? safeJson(r.conditions_json, undefined) : undefined,
    actions: r.actions_json ? safeJson(r.actions_json, undefined) : undefined,
    coverage: safeJson(r.coverage_json, []),
    status: r.status ?? 'active',
    effectiveFrom: r.effective_from ?? undefined,
    effectiveTo: r.effective_to ?? undefined,
    syncedAt: r.synced_at ?? r.created_at ?? new Date().toISOString()
  };
}

function safeJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}
