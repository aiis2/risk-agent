/**
 * 风控四维 Research 维度规范
 * 参考 research-workflow.md §2 — v3.2 Risk Agent Research Framework
 */

// ──────────────────────────────────────────────────────────
// Worker 规格
// ──────────────────────────────────────────────────────────

export interface WorkerSpec {
  /** Worker 角色 */
  role: 'DataSource' | 'RiskRule' | 'EventHistory' | 'ExternalKB' | 'Aggregator';
  /** 具体调查任务 */
  task: string;
  /** 并发模式 */
  concurrency: 'parallel' | 'serial';
  /** 分析目标描述（用于 buildResearchWorkerPrompt） */
  analysisGoal?: string;
}

// ──────────────────────────────────────────────────────────
// Research 维度
// ──────────────────────────────────────────────────────────

export interface ResearchDimension {
  /** 唯一 ID（用于 research_progress 事件的 dimension 字段） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 该维度下的 Worker 列表 */
  workers: WorkerSpec[];
  /** false = 可选维度（超预算 60% 时跳过） */
  required: boolean;
  /** 可选：该维度最大 Token 预算 */
  maxTokenBudget?: number;
}

// ──────────────────────────────────────────────────────────
// 风控四维常量（v3.2 规范）
// ──────────────────────────────────────────────────────────

/**
 * RISK_AGENT_RESEARCH_DIMENSIONS
 *
 * 风险 Agent 标准四维调查框架，参考 research-workflow.md §2.1：
 *   维度1 — 业务场景调查（DataSource Research）
 *   维度2 — 规则覆盖调查（RiskRule Research）
 *   维度3 — 历史风险事件调查（EventHistory Research）
 *   维度4 — 竞品/外部知识调查（ExternalKB Research，可选）
 */
export const RISK_AGENT_RESEARCH_DIMENSIONS: ResearchDimension[] = [
  {
    id: 'data_source',
    name: '业务场景调查',
    required: true,
    workers: [
      {
        role: 'DataSource',
        task: 'api_exploration',
        concurrency: 'parallel',
        analysisGoal: '探查核心业务接口（HTTP API / DB Schema）',
      },
      {
        role: 'DataSource',
        task: 'behavior_pattern',
        concurrency: 'parallel',
        analysisGoal: '分析用户行为模式（交易流水 / 操作轨迹）',
      },
      {
        role: 'DataSource',
        task: 'anomaly_detection',
        concurrency: 'parallel',
        analysisGoal: '识别异常业务场景（历史告警 / 异常标记）',
      },
    ],
  },
  {
    id: 'rule_coverage',
    name: '规则覆盖调查',
    required: true,
    workers: [
      {
        role: 'RiskRule',
        task: 'inventory',
        concurrency: 'parallel',
        analysisGoal: '全量盘点现有规则（类型分布 / 覆盖范围）',
      },
      {
        role: 'RiskRule',
        task: 'trigger_frequency',
        concurrency: 'parallel',
        analysisGoal: '分析规则触发频率（热点规则 / 低效规则）',
      },
      {
        role: 'RiskRule',
        task: 'lineage_analysis',
        concurrency: 'parallel',
        analysisGoal: '梳理规则血缘关系（依赖链 / 冲突点）',
      },
    ],
  },
  {
    id: 'event_history',
    name: '历史风险事件',
    required: true,
    workers: [
      {
        role: 'EventHistory',
        task: 'top_risk_events',
        concurrency: 'parallel',
        analysisGoal: '查询近期风险事件 TOP-N（按损失金额）',
      },
      {
        role: 'EventHistory',
        task: 'false_negative_analysis',
        concurrency: 'serial',
        analysisGoal: '分析漏报样本（规则未命中的欺诈案例）',
      },
    ],
  },
  {
    id: 'external_kb',
    name: '竞品/外部知识',
    required: false, // 可选：超预算时跳过
    maxTokenBudget: 10_000,
    workers: [
      {
        role: 'ExternalKB',
        task: 'industry_standards',
        concurrency: 'parallel',
        analysisGoal: '查询行业标准规则库及监管合规要求',
      },
    ],
  },
];

// ──────────────────────────────────────────────────────────
// 预算判断
// ──────────────────────────────────────────────────────────

/**
 * 判断是否应跳过某个可选维度。
 * 当当前已花费超过总预算 60% 时，跳过 required=false 的维度。
 */
export function shouldSkipDimension(dim: ResearchDimension, usedBudget: number, totalBudget: number): boolean {
  if (dim.required) return false;
  if (totalBudget <= 0) return false;
  return usedBudget / totalBudget > 0.6;
}
