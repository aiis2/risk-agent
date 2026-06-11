/**
 * gapanalysis.prompt.ts — 覆盖缺口分析 LLM 提示模板。
 * packages/core/src/llm/prompts/gapanalysis.prompt.ts
 */

export interface GapAnalysisPromptVars {
  scenarios: string;
  rules: string;
  coverageMatrix?: string;
}

export function buildGapAnalysisPrompt(vars: GapAnalysisPromptVars): string {
  const matrixSection = vars.coverageMatrix
    ? `\n## 当前覆盖矩阵\n\`\`\`\n${vars.coverageMatrix}\n\`\`\`\n`
    : '';
  return `你是一名资深风控覆盖度分析专家。请分析以下风控场景与规则之间的覆盖情况，识别覆盖缺口，并给出补充建议。

## 风控场景列表
\`\`\`json
${vars.scenarios}
\`\`\`

## 现有规则列表
\`\`\`json
${vars.rules}
\`\`\`
${matrixSection}
## 输出格式（JSON）：
\`\`\`json
{
  "overallCoverage": 0.0,
  "criticalGaps": [
    {
      "scenarioId": "场景 ID",
      "scenarioName": "场景名称",
      "missingRuleTypes": ["缺失的规则类型"],
      "priority": "urgent|high|medium",
      "suggestion": "补充规则建议"
    }
  ],
  "redundantRules": ["冗余规则 ID 列表"],
  "coverageMatrix": [
    {
      "scenarioId": "场景 ID",
      "coveredRules": ["已覆盖规则"],
      "coverage": 0.0
    }
  ],
  "summary": "整体缺口分析摘要"
}
\`\`\`

只返回 JSON 对象，不要包含其他内容。`.trim();
}

export const GAP_ANALYSIS_SYSTEM_PROMPT =
  '你是一名专业的风控覆盖度分析专家，擅长评估风控规则对业务场景的覆盖情况，识别关键缺口并给出优先级排序和改进建议，输出严格合规的 JSON 格式。';
