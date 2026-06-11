/**
 * riskrule.prompt.ts — 风控规则解析/生成 LLM 提示模板。
 * packages/core/src/llm/prompts/riskrule.prompt.ts
 */

export interface RiskRuleParsePromptVars {
  rawText: string;
  bizType?: string;
}

export interface RiskRuleGenPromptVars {
  riskDescription: string;
  existingRules?: string[];
  bizType?: string;
}

export function buildRiskRuleParsePrompt(vars: RiskRuleParsePromptVars): string {
  return `请将以下风控规则描述解析为结构化的 JSON 对象。
${vars.bizType ? `\n业务类型: ${vars.bizType}\n` : ''}
## 原始描述
${vars.rawText}

## 输出格式（JSON）：
\`\`\`json
{
  "ruleName": "规则名称",
  "ruleCode": "规则编号（可选）",
  "bizType": "业务类型",
  "ruleType": "规则类型（阈值/频率/关联/模型等）",
  "riskLevel": "critical|high|medium|low",
  "description": "规则简述",
  "coverage": ["覆盖的场景 ID 列表"]
}
\`\`\`

只返回 JSON 对象，不要包含其他内容。`.trim();
}

export function buildRiskRuleGenPrompt(vars: RiskRuleGenPromptVars): string {
  const existing = vars.existingRules?.length
    ? `\n## 已有规则（避免重复）\n${vars.existingRules.join('\n')}\n`
    : '';
  return `你是一名资深风控规则专家。根据以下风险描述，生成合适的风控规则列表。
${vars.bizType ? `\n业务类型: ${vars.bizType}\n` : ''}
## 风险描述
${vars.riskDescription}
${existing}
## 输出格式（JSON 数组）：
\`\`\`json
[
  {
    "ruleName": "规则名称",
    "ruleType": "规则类型",
    "riskLevel": "critical|high|medium|low",
    "description": "规则详细描述",
    "logic": "规则判断逻辑"
  }
]
\`\`\`

只返回 JSON 数组，不要包含其他内容。`.trim();
}

export const RISK_RULE_SYSTEM_PROMPT =
  '你是一名金融风控专家，熟悉反欺诈、信用风险、操作风险等领域，能准确解析和生成风控规则，输出严格合规的 JSON 格式。';
