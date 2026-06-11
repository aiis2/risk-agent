import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { LLMAdapter } from '../../llm/LLMAdapter.js';

export interface ParsedRuleCandidate {
  ruleName: string;
  ruleCode?: string;
  bizType?: string;
  ruleType?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  coverage?: string[];
}

/**
 * heuristicParse — 当 LLM 不可用时的回退，按行/分号/编号切分，并用关键词推断字段。
 */
export function heuristicParseRules(text: string): ParsedRuleCandidate[] {
  const chunks = text
    .split(/\r?\n|(?<=[。；;])|(?:\d+[\.\)、]\s*)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  const levels: Record<string, ParsedRuleCandidate['riskLevel']> = {
    高危: 'high',
    高: 'high',
    严重: 'critical',
    critical: 'critical',
    '中危': 'medium',
    medium: 'medium',
    低危: 'low',
    low: 'low'
  };
  const bizHints: Record<string, string> = {
    支付: 'payment',
    payment: 'payment',
    转账: 'transfer',
    transfer: 'transfer',
    登录: 'login',
    login: 'login',
    注册: 'register',
    register: 'register',
    提现: 'withdraw',
    withdraw: 'withdraw'
  };
  const typeHints: Record<string, string> = {
    限额: 'limit',
    limit: 'limit',
    黑名单: 'blacklist',
    blacklist: 'blacklist',
    白名单: 'whitelist',
    whitelist: 'whitelist',
    频率: 'velocity',
    velocity: 'velocity',
    频控: 'velocity',
    验证: 'verification',
    风险评分: 'scoring',
    scoring: 'scoring'
  };
  const out: ParsedRuleCandidate[] = [];
  for (const c of chunks) {
    const lower = c.toLowerCase();
    let riskLevel: ParsedRuleCandidate['riskLevel'] | undefined;
    for (const [kw, lvl] of Object.entries(levels)) {
      if (lower.includes(kw.toLowerCase())) { riskLevel = lvl; break; }
    }
    let bizType: string | undefined;
    for (const [kw, biz] of Object.entries(bizHints)) {
      if (lower.includes(kw.toLowerCase())) { bizType = biz; break; }
    }
    let ruleType: string | undefined;
    for (const [kw, rt] of Object.entries(typeHints)) {
      if (lower.includes(kw.toLowerCase())) { ruleType = rt; break; }
    }
    out.push({
      ruleName: c.slice(0, 60).replace(/[。；;]$/g, '').trim(),
      description: c,
      bizType,
      ruleType,
      riskLevel: riskLevel ?? 'medium'
    });
  }
  return out.slice(0, 64);
}

const NL_PARSE_SYSTEM = [
  'You extract risk control rules from user text into structured JSON.',
  'Return ONLY a JSON array. Each item shape:',
  '{"ruleName":"","ruleCode":"","bizType":"","ruleType":"","riskLevel":"low|medium|high|critical","description":"","coverage":[""]}',
  'Use short Chinese or English ruleName. bizType examples: payment/transfer/login/register/withdraw.',
  'ruleType examples: limit/blacklist/whitelist/velocity/verification/scoring.',
  'If unsure about a field, omit it.'
].join('\n');

export interface RuleNlParseInput {
  text: string;
  /**
   * 若 true（默认）优先调用 LLM，失败回退 heuristic；false 时仅跑 heuristic。
   */
  useLLM?: boolean;
}

export function createRuleNlParseTool(llm?: LLMAdapter): AgentToolDefinition {
  return {
    name: 'rule_nl_parse',
    description: 'Parse free-form regulation / risk-control text into structured rule candidates.',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1 },
        useLLM: { type: 'boolean' }
      }
    },
    async execute(raw) {
      const input = raw as RuleNlParseInput;
      if (!input?.text) throw new Error('text required');
      const useLLM = input.useLLM !== false && !!llm;
      if (useLLM && llm) {
        try {
          const res = await llm.call({
            model: 'rule-parser',
            systemPrompt: NL_PARSE_SYSTEM,
            messages: [{ role: 'user', content: input.text, timestamp: Date.now() }],
            tools: [],
            maxTokens: 1024,
            temperature: 0
          });
          const parsed = tryParseJsonArray(res.text);
          if (parsed.length) return { source: 'llm', candidates: parsed };
        } catch {
          /* fall through to heuristic */
        }
      }
      return { source: 'heuristic', candidates: heuristicParseRules(input.text) };
    }
  };
}

function tryParseJsonArray(text: string): ParsedRuleCandidate[] {
  if (!text) return [];
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === 'object' && typeof x.ruleName === 'string')
      .map((x) => ({
        ruleName: String(x.ruleName).slice(0, 120),
        ruleCode: x.ruleCode ? String(x.ruleCode) : undefined,
        bizType: x.bizType ? String(x.bizType) : undefined,
        ruleType: x.ruleType ? String(x.ruleType) : undefined,
        riskLevel: normalizeLevel(x.riskLevel),
        description: x.description ? String(x.description) : undefined,
        coverage: Array.isArray(x.coverage) ? x.coverage.map(String) : undefined
      }));
  } catch {
    return [];
  }
}

function normalizeLevel(v: unknown): ParsedRuleCandidate['riskLevel'] | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase();
  if (s === 'low' || s === 'medium' || s === 'high' || s === 'critical') return s;
  return undefined;
}
