/**
 * RuleNormalizer — 风控规则数据标准化处理器。
 * packages/core/src/normalizers/RuleNormalizer.ts
 *
 * 将来自不同来源（LLM 解析 / 文件导入 / API 同步）的规则数据
 * 标准化为统一的 NormalizedRule 格式。
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface NormalizedRule {
  ruleName: string;
  ruleCode?: string;
  bizType?: string;
  ruleType?: string;
  riskLevel: RiskLevel;
  description?: string;
  coverage: string[];
  source: string;
  status: 'draft' | 'active' | 'deprecated';
}

export class RuleNormalizer {
  /**
   * 将 LLM 解析返回的原始规则对象标准化。
   */
  normalizeLlmParsed(raw: Record<string, unknown>, source = 'llm-parse'): NormalizedRule {
    return {
      ruleName: String(raw.ruleName ?? raw.rule_name ?? raw.name ?? 'unnamed_rule'),
      ruleCode: raw.ruleCode != null ? String(raw.ruleCode) : undefined,
      bizType: raw.bizType != null ? String(raw.bizType) : undefined,
      ruleType: raw.ruleType != null ? String(raw.ruleType) : undefined,
      riskLevel: this._normalizeRiskLevel(raw.riskLevel ?? raw.risk_level ?? raw.severity),
      description: raw.description != null ? String(raw.description) : undefined,
      coverage: Array.isArray(raw.coverage)
        ? (raw.coverage as unknown[]).map(String)
        : [],
      source,
      status: 'draft',
    };
  }

  /**
   * 将批量导入（JSON 数组）的记录标准化。
   */
  normalizeBulkImport(rows: Record<string, unknown>[], source = 'bulk-import'): NormalizedRule[] {
    return rows.map((r) => this.normalizeLlmParsed(r, source));
  }

  /**
   * 推断风险等级，容忍各种拼写变体。
   */
  private _normalizeRiskLevel(raw: unknown): RiskLevel {
    const s = String(raw ?? '').toLowerCase().trim();
    if (s.includes('critical') || s === 'p0') return 'critical';
    if (s.includes('high') || s === 'p1') return 'high';
    if (s.includes('low') || s === 'p3') return 'low';
    return 'medium'; // default
  }
}
