/**
 * Mock Data Seed Script
 * 为整个 Agent 全流程测试生成模拟数据
 *
 * 用法: node scripts/seed-mock-data.mjs
 *      node scripts/seed-mock-data.mjs --reset  (先清空再重建)
 */

const BASE = 'http://localhost:8787/api';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

function log(label, data) {
  const id = data?.scenarioId || data?.systemId || data?.ruleId || data?.id || '';
  console.log(`  ✓ ${label}${id ? ` [${id.slice(0, 8)}]` : ''}`);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. 业务场景 (Business Scenarios)
// ──────────────────────────────────────────────────────────────────────────

async function seedScenarios() {
  console.log('\n[1] 业务场景...');

  const existing = await get('/scenarios');
  const existingNames = new Set(existing.map((s) => s.name));

  const scenarios = [
    {
      name: '电商支付风控',
      description: '覆盖电商平台的支付欺诈识别、账户安全、异常交易检测',
      domain: 'payment',
      status: 'active',
    },
    {
      name: '贷款信用风控',
      description: '覆盖消费贷、个人贷款的信用评估、反欺诈、贷后管理',
      domain: 'credit',
      status: 'active',
    },
    {
      name: '保险欺诈检测',
      description: '覆盖人寿险、财险、健康险的理赔欺诈识别与中介欺诈',
      domain: 'insurance',
      status: 'active',
    },
    {
      name: '反洗钱合规监控',
      description: '覆盖可疑交易上报、大额现金管理、客户尽职调查',
      domain: 'aml',
      status: 'draft',
    },
  ];

  const result = [];
  for (const s of scenarios) {
    if (existingNames.has(s.name)) {
      const existing_ = existing.find((e) => e.name === s.name);
      log(`跳过(已存在) ${s.name}`, existing_);
      result.push(existing_);
    } else {
      const created = await post('/scenarios', s);
      log(s.name, created);
      result.push(created);
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// 2. 规则系统 (Rule Systems)
// ──────────────────────────────────────────────────────────────────────────

async function seedRuleSystems() {
  console.log('\n[2] 规则系统...');

  const existing = await get('/rule-systems');
  const existingNames = new Set(existing.map((s) => s.systemName));

  const systems = [
    {
      systemName: '实时规则引擎',
      systemType: 'realtime',
      syncConfig: { apiUrl: 'https://rule-engine.internal/api/sync', authType: 'api_key', syncInterval: 300 },
    },
    {
      systemName: '批量风控引擎',
      systemType: 'offline',
      syncConfig: { apiUrl: 'https://batch-risk.internal/api/sync', authType: 'oauth2', syncInterval: 3600 },
    },
    {
      systemName: '人工审核系统',
      systemType: 'manual',
    },
    {
      systemName: '监管合规规则库',
      systemType: 'manual',
      syncConfig: { apiUrl: 'https://compliance.internal/api/rules', authType: 'none', syncInterval: 86400 },
    },
  ];

  const result = [];
  for (const s of systems) {
    if (existingNames.has(s.systemName)) {
      const existing_ = existing.find((e) => e.systemName === s.systemName);
      log(`跳过(已存在) ${s.systemName}`, existing_);
      result.push(existing_);
    } else {
      const created = await post('/rule-systems', s);
      log(s.systemName, created);
      result.push(created);
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. 风控规则 (Risk Rules)
// ──────────────────────────────────────────────────────────────────────────

async function seedRules(systems) {
  console.log('\n[3] 风控规则...');

  const existing = await get('/rules');
  const existingNames = new Set(existing.map((r) => r.ruleName));

  const [realtime, batch, manual, compliance] = systems;

  const rules = [
    // ─── 电商支付风控 ───
    {
      ruleName: '高频支付限额规则',
      ruleCode: 'PAY-FREQ-001',
      bizType: 'payment',
      ruleType: 'frequency',
      riskLevel: 'high',
      description: '同一账户24小时内支付次数超过50次时触发人工审核',
      coverage: ['payment', 'frequency'],
      status: 'active',
      systemId: realtime?.systemId,
      conditions: { threshold: 50, window: '24h', metric: 'payment_count' },
      actions: { action: 'manual_review', notify: ['risk_team'] },
    },
    {
      ruleName: '异地登录支付检测',
      ruleCode: 'PAY-GEO-001',
      bizType: 'payment',
      ruleType: 'anomaly',
      riskLevel: 'critical',
      description: '异地登录后30分钟内发起支付时执行二次验证',
      coverage: ['payment', 'anomaly'],
      status: 'active',
      systemId: realtime?.systemId,
      conditions: { geoChangeMinutes: 30, minAmount: 0 },
      actions: { action: 'step_up_auth', type: 'sms_otp' },
    },
    {
      ruleName: '黑名单账户拦截',
      ruleCode: 'PAY-BL-001',
      bizType: 'payment',
      ruleType: 'blacklist',
      riskLevel: 'critical',
      description: '命中内部或外部黑名单的账户直接拦截所有交易',
      coverage: ['payment', 'blacklist'],
      status: 'active',
      systemId: realtime?.systemId,
      conditions: { lists: ['internal_blacklist', 'pbc_blacklist', 'interpol_list'] },
      actions: { action: 'block', escalate: true },
    },
    {
      ruleName: '单笔支付金额阈值',
      ruleCode: 'PAY-LMT-001',
      bizType: 'payment',
      ruleType: 'limit',
      riskLevel: 'medium',
      description: '单笔支付金额超过5万元须短信验证，超过10万元须人工审核',
      coverage: ['payment', 'limit'],
      status: 'active',
      systemId: batch?.systemId,
      conditions: { smsVerifyThreshold: 50000, manualReviewThreshold: 100000, currency: 'CNY' },
      actions: { action: 'threshold_control', steps: ['sms', 'manual_review'] },
    },
    {
      ruleName: '支付合规审计记录',
      ruleCode: 'PAY-COMP-001',
      bizType: 'payment',
      ruleType: 'compliance',
      riskLevel: 'low',
      description: '所有支付交易须完整记录以满足支付宝/银联合规要求',
      coverage: ['payment', 'compliance'],
      status: 'active',
      systemId: compliance?.systemId,
      conditions: { auditFields: ['amount', 'merchant', 'timestamp', 'ip', 'device_id'] },
      actions: { action: 'audit_log', retention: '7years' },
    },

    // ─── 贷款信用风控 ───
    {
      ruleName: '征信评分最低门槛',
      ruleCode: 'LOAN-CR-001',
      bizType: 'credit',
      ruleType: 'limit',
      riskLevel: 'high',
      description: '申请人征信评分低于580分时自动拒绝贷款申请',
      coverage: ['credit', 'limit'],
      status: 'active',
      systemId: batch?.systemId,
      conditions: { minScore: 580, scoreModel: 'FICO', dataSource: '人行征信' },
      actions: { action: 'auto_reject', reason: 'low_credit_score' },
    },
    {
      ruleName: '债务收入比控制',
      ruleCode: 'LOAN-DTI-001',
      bizType: 'credit',
      ruleType: 'limit',
      riskLevel: 'high',
      description: '月还款额超过月收入50%时拒绝贷款',
      coverage: ['credit', 'limit'],
      status: 'active',
      systemId: batch?.systemId,
      conditions: { maxDTI: 0.5, incomeVerification: 'required' },
      actions: { action: 'auto_reject', reason: 'dti_exceeded' },
    },
    {
      ruleName: '多头借贷检测',
      ruleCode: 'LOAN-MULTI-001',
      bizType: 'credit',
      ruleType: 'blacklist',
      riskLevel: 'critical',
      description: '30天内在3家以上机构查询征信记录触发人工审核',
      coverage: ['credit', 'blacklist', 'anomaly'],
      status: 'active',
      systemId: realtime?.systemId,
      conditions: { queryThreshold: 3, queryWindow: '30d', requireManualReview: true },
      actions: { action: 'manual_review', priority: 'high' },
    },
    {
      ruleName: '逾期还款黑名单',
      ruleCode: 'LOAN-OVERDUE-001',
      bizType: 'credit',
      ruleType: 'blacklist',
      riskLevel: 'critical',
      description: '有90天以上逾期记录的申请人直接拒绝',
      coverage: ['credit', 'blacklist'],
      status: 'active',
      systemId: realtime?.systemId,
      conditions: { overdueThresholdDays: 90, lookbackYears: 5 },
      actions: { action: 'auto_reject', reason: 'serious_overdue' },
    },
    {
      ruleName: '贷款合规资质核验',
      ruleCode: 'LOAN-COMP-001',
      bizType: 'credit',
      ruleType: 'compliance',
      riskLevel: 'medium',
      description: '按银保监会要求核验借款人身份证、工作单位、收入证明',
      coverage: ['credit', 'compliance'],
      status: 'active',
      systemId: compliance?.systemId,
      conditions: { requiredDocs: ['id_card', 'income_proof', 'employment_cert'] },
      actions: { action: 'doc_verification', failPolicy: 'reject' },
    },

    // ─── 保险欺诈检测 ───
    {
      ruleName: '理赔高频异常检测',
      ruleCode: 'INS-FREQ-001',
      bizType: 'insurance',
      ruleType: 'frequency',
      riskLevel: 'high',
      description: '同一被保人12个月内理赔超过5次触发欺诈调查',
      coverage: ['insurance', 'frequency'],
      status: 'active',
      systemId: batch?.systemId,
      conditions: { claimThreshold: 5, window: '12months' },
      actions: { action: 'fraud_investigation', team: 'SIU' },
    },
    {
      ruleName: '新保短期理赔预警',
      ruleCode: 'INS-NEW-001',
      bizType: 'insurance',
      ruleType: 'anomaly',
      riskLevel: 'critical',
      description: '投保后90天内大额理赔须额外调查',
      coverage: ['insurance', 'anomaly'],
      status: 'active',
      systemId: realtime?.systemId,
      conditions: { daysAfterPolicy: 90, minClaimAmount: 100000 },
      actions: { action: 'enhanced_review', requireApproval: true },
    },
    {
      ruleName: '中介欺诈识别规则',
      ruleCode: 'INS-BROKER-001',
      bizType: 'insurance',
      ruleType: 'anomaly',
      riskLevel: 'critical',
      description: '同一中介代理的理赔率超过行业均值300%时暂停业务',
      coverage: ['insurance', 'anomaly', 'blacklist'],
      status: 'active',
      systemId: manual?.systemId,
      conditions: { brokerClaimRatioMultiplier: 3.0, industryBenchmark: 'auto_calculate' },
      actions: { action: 'suspend_broker', notify: ['compliance', 'legal'] },
    },

    // ─── 反洗钱 ───
    {
      ruleName: '大额交易上报规则',
      ruleCode: 'AML-LARGE-001',
      bizType: 'aml',
      ruleType: 'compliance',
      riskLevel: 'high',
      description: '单笔或当日累计交易超过50万须向人行上报大额交易报告',
      coverage: ['aml', 'compliance'],
      status: 'active',
      systemId: compliance?.systemId,
      conditions: { singleThreshold: 500000, dailyThreshold: 500000, currency: 'CNY' },
      actions: { action: 'regulatory_report', form: 'CTR', deadline: '5business_days' },
    },
    {
      ruleName: '可疑交易行为识别',
      ruleCode: 'AML-STR-001',
      bizType: 'aml',
      ruleType: 'anomaly',
      riskLevel: 'critical',
      description: '识别化整为零、异常资金归集等典型洗钱行为',
      coverage: ['aml', 'anomaly', 'frequency'],
      status: 'draft',
      systemId: realtime?.systemId,
      conditions: {
        patterns: ['structuring', 'smurfing', 'layering'],
        mlModel: 'aml_bert_v2',
      },
      actions: { action: 'file_STR', deadline: 'immediate' },
    },
  ];

  const result = [];
  for (const r of rules) {
    if (existingNames.has(r.ruleName)) {
      const existing_ = existing.find((e) => e.ruleName === r.ruleName);
      log(`跳过(已存在) ${r.ruleName}`, existing_);
      result.push(existing_);
    } else {
      const created = await post('/rules', r);
      log(r.ruleName, created);
      result.push(created);
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// 4. 知识图谱节点 (Knowledge Graph Nodes)
// ──────────────────────────────────────────────────────────────────────────

async function seedKnowledgeGraph(scenarios, systems, rules) {
  console.log('\n[4] 知识图谱节点与关系...');

  const [paymentScenario, creditScenario, insuranceScenario, amlScenario] = scenarios;
  const [realtime, batch, manual, compliance_sys] = systems;

  // ─── 4.1 先建图谱节点 (业务场景、规则来源、规则系统) ───
  const kgNodes = [
    // 规则来源节点
    { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source', attributes: { org: '中国人民银行', docType: '监管规定' } },
    { id: 'src-cbirc', label: '银保监会保险监管指引', nodeType: 'rule_source', attributes: { org: '银保监会', docType: '监管指引' } },
    { id: 'src-internal-policy', label: '内部风控政策V3.2', nodeType: 'rule_source', attributes: { org: '风控部', docType: '内部政策', version: 'V3.2' } },
    { id: 'src-ml-model', label: '欺诈检测ML模型库', nodeType: 'rule_source', attributes: { org: '算法团队', docType: 'ML模型', modelVersion: 'v2.1' } },

    // 规则系统节点
    { id: realtime?.systemId ?? 'sys-realtime', label: '实时规则引擎', nodeType: 'rule_system', attributes: { type: 'realtime', latency: '<100ms' } },
    { id: batch?.systemId ?? 'sys-batch', label: '批量风控引擎', nodeType: 'rule_system', attributes: { type: 'offline', schedule: 'daily' } },
    { id: manual?.systemId ?? 'sys-manual', label: '人工审核系统', nodeType: 'rule_system', attributes: { type: 'manual', team: '风控审核组' } },
    { id: compliance_sys?.systemId ?? 'sys-compliance', label: '监管合规规则库', nodeType: 'rule_system', attributes: { type: 'compliance', authority: '银保监会' } },

    // 业务场景节点
    { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario', attributes: { domain: 'payment', status: 'active' } },
    { id: creditScenario?.scenarioId ?? 'scene-credit', label: '贷款信用风控', nodeType: 'scenario', attributes: { domain: 'credit', status: 'active' } },
    { id: insuranceScenario?.scenarioId ?? 'scene-insurance', label: '保险欺诈检测', nodeType: 'scenario', attributes: { domain: 'insurance', status: 'active' } },
    { id: amlScenario?.scenarioId ?? 'scene-aml', label: '反洗钱合规监控', nodeType: 'scenario', attributes: { domain: 'aml', status: 'draft' } },

    // 企业/业务实体
    { id: 'biz-fintech', label: '某互联网金融公司', nodeType: 'business', attributes: { industry: 'fintech', size: 'large' } },
    { id: 'biz-insurer', label: '某大型保险集团', nodeType: 'business', attributes: { industry: 'insurance', size: 'large' } },

    // 合规缺口节点
    { id: 'gap-aml-kyc', label: 'KYC合规缺口', nodeType: 'gap', attributes: { severity: 'high', regulation: 'AML Law 2021' } },
    { id: 'gap-insurance-siu', label: '保险SIU能力缺口', nodeType: 'gap', attributes: { severity: 'medium', area: 'fraud_investigation' } },
    { id: 'gap-payment-3ds', label: '支付3DS认证缺口', nodeType: 'gap', attributes: { severity: 'high', standard: 'PCI DSS' } },
  ];

  // 规则节点 (从已创建的规则中取)
  const ruleMap = {};
  for (const rule of rules) {
    if (rule?.ruleId) {
      kgNodes.push({
        id: rule.ruleId,
        label: rule.ruleName,
        nodeType: 'rule',
        attributes: {
          bizType: rule.bizType,
          ruleType: rule.ruleType,
          riskLevel: rule.riskLevel,
          status: rule.status,
          ruleCode: rule.ruleCode,
        },
      });
      ruleMap[rule.ruleCode] = rule.ruleId;
    }
  }

  console.log('  创建节点...');
  let nodeCount = 0;
  for (const node of kgNodes) {
    try {
      await post('/knowledge-graph/nodes', node);
      nodeCount++;
    } catch (e) {
      console.log(`  ! 节点 ${node.label}: ${e.message}`);
    }
  }
  console.log(`  ✓ 创建 ${nodeCount} 个节点`);

  // ─── 4.2 建立关系边 ───
  console.log('  创建关系边...');

  const ruleIds = Object.fromEntries(rules.filter((r) => r?.ruleId).map((r) => [r.ruleCode, r.ruleId]));

  const edges = [
    // 规则来源 → 规则 (derived_from)
    { from: { id: ruleIds['PAY-FREQ-001'], label: '高频支付限额规则', nodeType: 'rule' }, to: { id: 'src-internal-policy', label: '内部风控政策V3.2', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['PAY-GEO-001'], label: '异地登录支付检测', nodeType: 'rule' }, to: { id: 'src-ml-model', label: '欺诈检测ML模型库', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['PAY-BL-001'], label: '黑名单账户拦截', nodeType: 'rule' }, to: { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['PAY-LMT-001'], label: '单笔支付金额阈值', nodeType: 'rule' }, to: { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['PAY-COMP-001'], label: '支付合规审计记录', nodeType: 'rule' }, to: { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['LOAN-CR-001'], label: '征信评分最低门槛', nodeType: 'rule' }, to: { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['LOAN-DTI-001'], label: '债务收入比控制', nodeType: 'rule' }, to: { id: 'src-internal-policy', label: '内部风控政策V3.2', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['LOAN-MULTI-001'], label: '多头借贷检测', nodeType: 'rule' }, to: { id: 'src-ml-model', label: '欺诈检测ML模型库', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['LOAN-OVERDUE-001'], label: '逾期还款黑名单', nodeType: 'rule' }, to: { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['INS-FREQ-001'], label: '理赔高频异常检测', nodeType: 'rule' }, to: { id: 'src-cbirc', label: '银保监会保险监管指引', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['INS-NEW-001'], label: '新保短期理赔预警', nodeType: 'rule' }, to: { id: 'src-cbirc', label: '银保监会保险监管指引', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['INS-BROKER-001'], label: '中介欺诈识别规则', nodeType: 'rule' }, to: { id: 'src-ml-model', label: '欺诈检测ML模型库', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['AML-LARGE-001'], label: '大额交易上报规则', nodeType: 'rule' }, to: { id: 'src-pbc', label: '中国人民银行监管规定', nodeType: 'rule_source' }, relation: 'derived_from' },
    { from: { id: ruleIds['AML-STR-001'], label: '可疑交易行为识别', nodeType: 'rule' }, to: { id: 'src-ml-model', label: '欺诈检测ML模型库', nodeType: 'rule_source' }, relation: 'derived_from' },

    // 规则 → 规则系统 (belongs_to)
    { from: { id: ruleIds['PAY-FREQ-001'], label: '高频支付限额规则', nodeType: 'rule' }, to: { id: realtime?.systemId ?? 'sys-realtime', label: '实时规则引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['PAY-GEO-001'], label: '异地登录支付检测', nodeType: 'rule' }, to: { id: realtime?.systemId ?? 'sys-realtime', label: '实时规则引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['PAY-BL-001'], label: '黑名单账户拦截', nodeType: 'rule' }, to: { id: realtime?.systemId ?? 'sys-realtime', label: '实时规则引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['PAY-LMT-001'], label: '单笔支付金额阈值', nodeType: 'rule' }, to: { id: batch?.systemId ?? 'sys-batch', label: '批量风控引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['LOAN-CR-001'], label: '征信评分最低门槛', nodeType: 'rule' }, to: { id: batch?.systemId ?? 'sys-batch', label: '批量风控引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['LOAN-MULTI-001'], label: '多头借贷检测', nodeType: 'rule' }, to: { id: realtime?.systemId ?? 'sys-realtime', label: '实时规则引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['INS-FREQ-001'], label: '理赔高频异常检测', nodeType: 'rule' }, to: { id: batch?.systemId ?? 'sys-batch', label: '批量风控引擎', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['INS-BROKER-001'], label: '中介欺诈识别规则', nodeType: 'rule' }, to: { id: manual?.systemId ?? 'sys-manual', label: '人工审核系统', nodeType: 'rule_system' }, relation: 'belongs_to' },
    { from: { id: ruleIds['AML-LARGE-001'], label: '大额交易上报规则', nodeType: 'rule' }, to: { id: compliance_sys?.systemId ?? 'sys-compliance', label: '监管合规规则库', nodeType: 'rule_system' }, relation: 'belongs_to' },

    // 规则 → 业务场景 (covers)
    { from: { id: ruleIds['PAY-FREQ-001'], label: '高频支付限额规则', nodeType: 'rule' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['PAY-GEO-001'], label: '异地登录支付检测', nodeType: 'rule' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['PAY-BL-001'], label: '黑名单账户拦截', nodeType: 'rule' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['PAY-LMT-001'], label: '单笔支付金额阈值', nodeType: 'rule' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['PAY-COMP-001'], label: '支付合规审计记录', nodeType: 'rule' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['LOAN-CR-001'], label: '征信评分最低门槛', nodeType: 'rule' }, to: { id: creditScenario?.scenarioId ?? 'scene-credit', label: '贷款信用风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['LOAN-DTI-001'], label: '债务收入比控制', nodeType: 'rule' }, to: { id: creditScenario?.scenarioId ?? 'scene-credit', label: '贷款信用风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['LOAN-MULTI-001'], label: '多头借贷检测', nodeType: 'rule' }, to: { id: creditScenario?.scenarioId ?? 'scene-credit', label: '贷款信用风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['LOAN-OVERDUE-001'], label: '逾期还款黑名单', nodeType: 'rule' }, to: { id: creditScenario?.scenarioId ?? 'scene-credit', label: '贷款信用风控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['INS-FREQ-001'], label: '理赔高频异常检测', nodeType: 'rule' }, to: { id: insuranceScenario?.scenarioId ?? 'scene-insurance', label: '保险欺诈检测', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['INS-NEW-001'], label: '新保短期理赔预警', nodeType: 'rule' }, to: { id: insuranceScenario?.scenarioId ?? 'scene-insurance', label: '保险欺诈检测', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['INS-BROKER-001'], label: '中介欺诈识别规则', nodeType: 'rule' }, to: { id: insuranceScenario?.scenarioId ?? 'scene-insurance', label: '保险欺诈检测', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['AML-LARGE-001'], label: '大额交易上报规则', nodeType: 'rule' }, to: { id: amlScenario?.scenarioId ?? 'scene-aml', label: '反洗钱合规监控', nodeType: 'scenario' }, relation: 'covers' },
    { from: { id: ruleIds['AML-STR-001'], label: '可疑交易行为识别', nodeType: 'rule' }, to: { id: amlScenario?.scenarioId ?? 'scene-aml', label: '反洗钱合规监控', nodeType: 'scenario' }, relation: 'covers' },
    // AML 规则也覆盖支付场景
    { from: { id: ruleIds['AML-LARGE-001'], label: '大额交易上报规则', nodeType: 'rule' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'covers' },

    // 业务场景 → 企业 (has_profile)
    { from: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, to: { id: 'biz-fintech', label: '某互联网金融公司', nodeType: 'business' }, relation: 'has_profile' },
    { from: { id: creditScenario?.scenarioId ?? 'scene-credit', label: '贷款信用风控', nodeType: 'scenario' }, to: { id: 'biz-fintech', label: '某互联网金融公司', nodeType: 'business' }, relation: 'has_profile' },
    { from: { id: insuranceScenario?.scenarioId ?? 'scene-insurance', label: '保险欺诈检测', nodeType: 'scenario' }, to: { id: 'biz-insurer', label: '某大型保险集团', nodeType: 'business' }, relation: 'has_profile' },

    // 缺口 → 规则/场景 (exposes_gap)
    { from: { id: 'gap-aml-kyc', label: 'KYC合规缺口', nodeType: 'gap' }, to: { id: amlScenario?.scenarioId ?? 'scene-aml', label: '反洗钱合规监控', nodeType: 'scenario' }, relation: 'exposes_gap' },
    { from: { id: 'gap-insurance-siu', label: '保险SIU能力缺口', nodeType: 'gap' }, to: { id: insuranceScenario?.scenarioId ?? 'scene-insurance', label: '保险欺诈检测', nodeType: 'scenario' }, relation: 'exposes_gap' },
    { from: { id: 'gap-payment-3ds', label: '支付3DS认证缺口', nodeType: 'gap' }, to: { id: paymentScenario?.scenarioId ?? 'scene-payment', label: '电商支付风控', nodeType: 'scenario' }, relation: 'exposes_gap' },

    // 规则冲突 (conflicts_with) — 黑名单拦截 vs 高频限额在某些情况下可能策略冲突
    { from: { id: ruleIds['PAY-BL-001'], label: '黑名单账户拦截', nodeType: 'rule' }, to: { id: ruleIds['PAY-FREQ-001'], label: '高频支付限额规则', nodeType: 'rule' }, relation: 'conflicts_with', attributes: { reason: '黑名单拦截直接阻断，高频规则无法触发' } },
    // 多头借贷 vs 逾期黑名单 — 部分条件重叠
    { from: { id: ruleIds['LOAN-MULTI-001'], label: '多头借贷检测', nodeType: 'rule' }, to: { id: ruleIds['LOAN-OVERDUE-001'], label: '逾期还款黑名单', nodeType: 'rule' }, relation: 'conflicts_with', attributes: { reason: '对同一申请人可能同时触发两个拒绝规则' } },

    // 规则替换 (replaces)
    { from: { id: ruleIds['LOAN-MULTI-001'], label: '多头借贷检测', nodeType: 'rule' }, to: { id: ruleIds['LOAN-CR-001'], label: '征信评分最低门槛', nodeType: 'rule' }, relation: 'replaces', attributes: { since: '2025-01-01', reason: '升级版规则' } },
  ];

  let edgeCount = 0;
  for (const edge of edges) {
    // skip edges where the rule ID doesn't exist
    if (!edge.from.id || !edge.to.id) {
      console.log(`  ! 跳过边: from=${edge.from.label} 或 to=${edge.to.label} ID缺失`);
      continue;
    }
    try {
      await post('/knowledge-graph/edges', edge);
      edgeCount++;
    } catch (e) {
      console.log(`  ! 边 ${edge.from.label} -> ${edge.to.label}: ${e.message}`);
    }
  }
  console.log(`  ✓ 创建 ${edgeCount} 条关系边`);
}

// ──────────────────────────────────────────────────────────────────────────
// 5. 模拟业务画像 (Business Profiles)
// ──────────────────────────────────────────────────────────────────────────

async function seedProfiles(scenarios) {
  console.log('\n[5] 模拟业务画像（直接写入 DB via API）...');

  // Check if profiles already exist for non-payment scenarios
  const existing = await get('/businesses/profiles');
  const existingNames = new Set(existing.map((p) => p.businessName));

  // We create profiles via the internal API (simulate what the agent would do)
  // The /api/businesses/profiles endpoint only has GET, not POST for external creation
  // Profiles are normally created by the Agent — we'll skip creation here
  // and instead verify what's already there

  console.log(`  现有画像: ${existing.length} 个`);
  for (const p of existing) {
    console.log(`    - ${p.businessName} v${p.version} (score: ${p.overallScore})`);
  }
  return existing;
}

// ──────────────────────────────────────────────────────────────────────────
// 主函数
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Risk Agent 模拟数据生成 ===');
  console.log(`目标: ${BASE}\n`);

  // 检查服务器是否运行
  try {
    const health = await get('/health');
    console.log(`服务器状态: ${health.status} (v${health.version})`);
    console.log(`数据库: ${health.database} | 图谱: ${health.graphStore}`);
  } catch (e) {
    console.error('无法连接服务器，请先启动 dev server:', e.message);
    process.exit(1);
  }

  const scenarios = await seedScenarios();
  const systems = await seedRuleSystems();
  const rules = await seedRules(systems);
  await seedKnowledgeGraph(scenarios, systems, rules);
  await seedProfiles(scenarios);

  // 触发 KG 回填以同步镜像表
  console.log('\n[6] 触发知识图谱回填...');
  const backfill = await post('/knowledge-graph/backfill', {});
  console.log(`  ✓ 回填完成: nodes=${backfill.nodes}, edges=${backfill.edges}`);

  // 最终统计
  console.log('\n=== 数据概览 ===');
  const overview = await get('/knowledge-graph/overview');
  console.log(`知识图谱: ${overview.nodeCount} 节点, ${overview.edgeCount} 边`);
  console.log('节点类型分布:', JSON.stringify(overview.nodesByType, null, 2));
  console.log('关系类型分布:', JSON.stringify(overview.edgesByRelation, null, 2));

  const allRules = await get('/rules');
  const allScenarios = await get('/scenarios');
  const allSystems = await get('/rule-systems');
  const allProfiles = await get('/businesses/profiles');
  const allReports = await get('/reports');
  console.log(`\n业务场景: ${allScenarios.length}`);
  console.log(`规则系统: ${allSystems.length}`);
  console.log(`风控规则: ${allRules.length}`);
  console.log(`业务画像: ${allProfiles.length}`);
  console.log(`分析报告: ${allReports.length}`);
  console.log('\n模拟数据生成完成！');
}

main().catch((e) => {
  console.error('错误:', e.message);
  process.exit(1);
});
