/**
 * datasource.prompt.ts — 数据源分析 LLM 提示模板。
 * packages/core/src/llm/prompts/datasource.prompt.ts
 */

export interface DataSourcePromptVars {
  sourceName: string;
  sourceType: string;
  sampleData: string;
  bizContext?: string;
}

export function buildDataSourcePrompt(vars: DataSourcePromptVars): string {
  return `你是一名专业的风险数据分析师。请对以下数据源的样本数据进行分析，识别其中的关键字段、数据质量问题和潜在风险信号。

## 数据源信息
- 名称: ${vars.sourceName}
- 类型: ${vars.sourceType}
${vars.bizContext ? `- 业务背景: ${vars.bizContext}` : ''}

## 样本数据
\`\`\`
${vars.sampleData}
\`\`\`

## 请按以下格式输出分析结果（JSON）：
\`\`\`json
{
  "keyFields": ["字段名列表"],
  "dataQualityIssues": ["问题描述"],
  "riskSignals": ["潜在风险信号"],
  "recommendedRules": [
    {
      "ruleName": "规则名称",
      "description": "规则描述",
      "riskLevel": "high|medium|low"
    }
  ]
}
\`\`\`

只返回 JSON 对象，不要包含其他内容。`.trim();
}

/** System 角色 */
export const DATA_SOURCE_SYSTEM_PROMPT =
  '你是一名专业的金融风控数据工程师，擅长识别数据中的风险特征，输出严格合规的 JSON 格式。';
