import { randomUUID } from 'node:crypto';
import type { BusinessProfile, BusinessScenario, RiskRule, StreamEvent } from './base/types.js';
import { BaseAgent, type AgentRunOptions } from './base/BaseAgent.js';
import type { StorageBackendRegistry } from '../storage/registry.js';

// 实体类型（03-analysis-engine.md §2.2）
const ENTITY_TYPE_KEYWORDS: Record<string, string[]> = {
  user:     ['用户', '注册', '登录', '账户', '会员', 'user', 'account'],
  merchant: ['商户', '商家', '收款方', 'merchant', 'seller'],
  device:   ['设备', '终端', 'IP', '指纹', 'device', 'fingerprint'],
  order:    ['订单', '交易', '支付', '转账', 'order', 'payment', 'transaction'],
  amount:   ['金额', '限额', '额度', '资金', 'amount', 'limit', 'fund'],
  geo:      ['地区', '位置', '地域', '境外', 'geo', 'region', 'country']
};

// 行为风险关键词（03-analysis-engine.md §2.3）
const BEHAVIOR_RISK_KEYWORDS: Record<string, string[]> = {
  high:   ['欺诈', '盗刷', '洗钱', '伪造', '欺骗', '绕过', 'fraud', 'money laundering'],
  medium: ['异常', '可疑', '高频', '超限', '越权', 'anomaly', 'suspicious', 'exceed'],
  low:    ['普通', '常规', '正常', 'normal', 'regular']
};

// 风控维度权重（03-analysis-engine.md §3.2）
const COVERAGE_DIMENSIONS = ['limit', 'frequency', 'blacklist', 'anomaly', 'compliance'] as const;
type CoverageDimension = typeof COVERAGE_DIMENSIONS[number];

const DIMENSION_RULE_TYPE_MAP: Record<CoverageDimension, string[]> = {
  limit:      ['limit', 'amount', 'quota'],
  frequency:  ['frequency', 'rate', 'velocity'],
  blacklist:  ['blacklist', 'whitelist', 'list'],
  anomaly:    ['anomaly', 'ml', 'model'],
  compliance: ['compliance', 'aml', 'kyc']
};

export interface ProfileAgentOptions {
  sessionId: string;
  businessName: string;
  scenarios: BusinessScenario[];
  rules: RiskRule[];
  storage: StorageBackendRegistry;
}

export interface ProfileEntity {
  entityType: string;
  name: string;
  count: number;
  attributes: Record<string, unknown>;
}

export interface BehaviorStep {
  action: string;
  scenarioId: string;
  scenarioName: string;
  riskKeyword?: string;
}

export interface RiskAttribute {
  dimension: CoverageDimension;
  coveredCount: number;
  totalExpected: number;
  coverageRatio: number;
  coveredRuleIds: string[];
}

/**
 * ProfileAgent — 业务画像构建 Sub-Agent（03-analysis-engine.md §2）
 *
 * 从业务场景和规则集中提取：
 * - 实体类型（用户/商户/设备/订单/金额/地理位置）
 * - 行为链（BehaviorChain）
 * - 风险属性（RiskAttribute）
 * 生成 BusinessProfile 并持久化到 business_profiles 表。
 */
export class ProfileAgent extends BaseAgent {
  private profile: BusinessProfile | null = null;

  constructor(private readonly options: ProfileAgentOptions) {
    super(options.sessionId);
  }

  getProfile(): BusinessProfile | null {
    return this.profile;
  }

  async *run(_opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined> {
    yield {
      type: 'subagent_spawned',
      agentId: 'profile',
      description: '构建业务画像',
      taskType: 'subagent',
      workerRole: 'profile'
    };

    const { businessName, scenarios, rules, storage, sessionId } = this.options;

    // Step 1: 实体提取
    yield { type: 'agent_status', message: '提取业务实体类型...' };
    const entities = this.extractEntities(scenarios);

    // Step 2: 行为链构建
    yield { type: 'agent_status', message: '构建行为风险链...' };
    const behaviors = this.buildBehaviorChain(scenarios);

    // Step 3: 风险属性标注
    yield { type: 'agent_status', message: '计算风控维度覆盖度...' };
    const riskAttributes = this.computeRiskAttributes(scenarios, rules);

    // Step 4: 计算整体风险评分
    const overallScore = this.computeOverallScore(riskAttributes);

    // Step 5: 获取历史画像版本
    const store = storage.getStructuredStore();
    const prevVersion = await store.get<{ version: number }>(
      `SELECT MAX(version) as version FROM business_profiles WHERE business_name=? AND session_id!=?`,
      [businessName, sessionId]
    ).catch(() => null);
    const version = (prevVersion?.version ?? 0) + 1;

    const profileId = randomUUID();
    const profile: BusinessProfile = {
      profileId,
      sessionId,
      businessName,
      version,
      entities,
      behaviors,
      apiFeatures: riskAttributes,
      overallScore,
      createdAt: new Date().toISOString()
    };

    // 持久化到 business_profiles 表
    await store.run(
      `INSERT INTO business_profiles(profile_id, session_id, business_name, version, entities_json, behaviors_json, api_features, overall_score, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        profileId,
        sessionId,
        businessName,
        version,
        JSON.stringify(entities),
        JSON.stringify(behaviors),
        JSON.stringify(riskAttributes),
        overallScore
      ]
    ).catch(() => undefined);

    this.profile = profile;

    // 向量化画像摘要（03-analysis-engine.md §10 + 04-storage-layer.md §3）
    try {
      const vectorStore = storage.getVectorStore();
      const summaryText = [
        businessName,
        entities.map((e) => e.entityType).join(' '),
        behaviors.map((b) => b.action).join(' '),
        riskAttributes.map((a) => `${a.dimension}:${a.coverageRatio.toFixed(2)}`).join(' ')
      ].join(' | ');
      const vector = buildProfileVector(summaryText);
      await vectorStore.upsert('profiles', [{
        id: profileId,
        vector,
        text: summaryText,
        metadata: { businessName, version, sessionId, overallScore }
      }]);
    } catch {
      // 向量化失败不阻断流程
    }

    // 更新业务图谱（04-storage-layer.md §4.1）
    try {
      const graphStore = storage.getGraphStore();
      const bizNodeId = `Business:${businessName}`;
      await graphStore.upsertNode('business_graph', {
        id: bizNodeId,
        label: businessName,
        attributes: { type: 'Business', profileId, overallScore, version }
      });
      for (const entity of entities) {
        const entNodeId = `Entity:${entity.entityType}`;
        await graphStore.upsertNode('business_graph', {
          id: entNodeId,
          label: entity.entityType,
          attributes: { type: 'Entity', entityType: entity.entityType, count: entity.count }
        });
        await graphStore.upsertEdge('business_graph', {
          source: bizNodeId,
          target: entNodeId,
          attributes: { type: 'HAS_ENTITY' }
        });
      }
    } catch {
      // 图更新失败不阻断流程
    }

    yield {
      type: 'subagent_complete',
      agentId: 'profile',
      status: 'completed',
      summary: `画像 v${version}: ${entities.length} 个实体类型, ${behaviors.length} 个行为步骤, 风险评分 ${overallScore.toFixed(1)}`
    };
  }

  /** 从场景名称/描述中提取实体类型 */
  private extractEntities(scenarios: BusinessScenario[]): ProfileEntity[] {
    const counts: Map<string, { count: number; scenarios: string[] }> = new Map();

    for (const s of scenarios) {
      const text = `${s.name} ${s.description ?? ''} ${s.domain ?? ''}`.toLowerCase();
      for (const [entityType, keywords] of Object.entries(ENTITY_TYPE_KEYWORDS)) {
        if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
          const entry = counts.get(entityType) ?? { count: 0, scenarios: [] };
          entry.count++;
          entry.scenarios.push(s.scenarioId);
          counts.set(entityType, entry);
        }
      }
    }

    return Array.from(counts.entries()).map(([entityType, info]) => ({
      entityType,
      name: entityType,
      count: info.count,
      attributes: { scenarioIds: info.scenarios }
    }));
  }

  /** 构建行为风险链 */
  private buildBehaviorChain(scenarios: BusinessScenario[]): BehaviorStep[] {
    const steps: BehaviorStep[] = [];
    for (const s of scenarios) {
      const text = `${s.name} ${s.description ?? ''}`.toLowerCase();
      let riskKeyword: string | undefined;
      outer: for (const [, keywords] of Object.entries(BEHAVIOR_RISK_KEYWORDS)) {
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) {
            riskKeyword = kw;
            break outer;
          }
        }
      }
      steps.push({
        action: s.name,
        scenarioId: s.scenarioId,
        scenarioName: s.name,
        riskKeyword
      });
    }
    return steps;
  }

  /** 计算每个风控维度的覆盖度 */
  private computeRiskAttributes(scenarios: BusinessScenario[], rules: RiskRule[]): RiskAttribute[] {
    return COVERAGE_DIMENSIONS.map((dim) => {
      const relatedTypes = DIMENSION_RULE_TYPE_MAP[dim];
      const coveredRules = rules.filter((r) =>
        r.ruleType && relatedTypes.some((t) => r.ruleType!.toLowerCase().includes(t))
      );
      const totalExpected = Math.max(scenarios.length, 1);
      const coveredCount = Math.min(coveredRules.length, totalExpected);
      return {
        dimension: dim,
        coveredCount,
        totalExpected,
        coverageRatio: coveredCount / totalExpected,
        coveredRuleIds: coveredRules.map((r) => r.ruleId)
      };
    });
  }

  /** 基于维度覆盖度计算整体评分（0-100）*/
  private computeOverallScore(attrs: RiskAttribute[]): number {
    if (!attrs.length) return 0;
    const avgRatio = attrs.reduce((s, a) => s + a.coverageRatio, 0) / attrs.length;
    return Math.round(Math.min(100, avgRatio * 100));
  }
}

/**
 * 128维 TF-IDF hash 向量（与 rule-import.ts 保持一致）
 * 04-storage-layer.md §3 profile_vectors
 */
function buildProfileVector(text: string): number[] {
  const dim = 128;
  const vec = new Float32Array(dim);
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (!word) continue;
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return Array.from(vec).map((v) => v / norm);
}
