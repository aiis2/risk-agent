/**
 * profile.prompt.ts — 风险画像分析 LLM 提示模板。
 * packages/core/src/llm/prompts/profile.prompt.ts
 */

export interface ProfileAnalysisPromptVars {
  entityId: string;
  entityType: 'user' | 'merchant' | 'device' | 'account';
  behaviorData: string;
  contextInfo?: string;
}

export function buildProfileAnalysisPrompt(vars: ProfileAnalysisPromptVars): string {
  return `你是一名专业的风险画像分析师。请根据以下实体的行为数据，输出完整的风险画像评估报告。

## 实体信息
- 实体 ID: ${vars.entityId}
- 实体类型: ${vars.entityType}
${vars.contextInfo ? `- 背景说明: ${vars.contextInfo}` : ''}

## 行为数据
\`\`\`
${vars.behaviorData}
\`\`\`

## 输出格式（JSON）：
\`\`\`json
{
  "entityId": "${vars.entityId}",
  "entityType": "${vars.entityType}",
  "riskScore": 0,
  "riskLevel": "critical|high|medium|low",
  "tags": ["风险标签列表"],
  "summary": "画像摘要",
  "keyIndicators": [
    { "name": "指标名", "value": "指标值", "abnormal": true }
  ],
  "recommendedActions": ["建议操作"]
}
\`\`\`

只返回 JSON 对象，不要包含其他内容。`.trim();
}

export const PROFILE_SYSTEM_PROMPT =
  '你是一名专业的金融风险画像分析师，擅长从海量行为数据中识别异常模式，构建精准的实体风险画像，输出严格合规的 JSON 格式。';
