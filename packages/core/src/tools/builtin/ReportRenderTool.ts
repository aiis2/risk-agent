import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { GapAnalysisReport } from '../../agents/base/types.js';

/**
 * report_render — 将 GapAnalysisReport 渲染为 Markdown（按 locale 使用报告模板）。
 */
export const reportRenderTool: AgentToolDefinition = {
  name: 'report_render',
  description: '根据缺口分析报告结构生成结构化 Markdown（支持 zh-CN / en-US 模板）。',
  isConcurrencySafe: true,
  isDestructive: false,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['report'],
    properties: { report: { type: 'object' }, locale: { type: 'string' } }
  },
  async execute(input) {
    const { report, locale = (input as any)?.report?.locale ?? 'zh-CN' } = input as {
      report: GapAnalysisReport;
      locale?: string;
    };
    return { markdown: render(report, locale), locale };
  }
};

function render(r: GapAnalysisReport, locale: string): string {
  const isEn = locale === 'en-US';
  const t = isEn
    ? {
        title: 'Risk Gap Report',
        business: 'Business',
        score: 'Overall Score',
        coverage: 'Coverage Matrix',
        critical: 'Critical Gaps',
        all: 'All Gaps',
        suggestions: 'Suggestions',
        none: '(none)'
      }
    : {
        title: '风控缺口分析报告',
        business: '业务对象',
        score: '总体得分',
        coverage: '覆盖矩阵',
        critical: '关键缺口',
        all: '全部缺口',
        suggestions: '优化建议',
        none: '（无）'
      };
  const lines: string[] = [];
  lines.push(`# ${t.title}`);
  lines.push(`- ${t.business}: ${r.businessName}`);
  lines.push(`- ${t.score}: ${r.overallScore}`);
  lines.push('');
  lines.push(`## ${t.coverage}`);
  for (const row of r.coverageMatrix) {
    lines.push(`- ${row.scenarioName}: ${row.coveragePercent}% (covered=${row.coveredRuleIds.length})`);
  }
  lines.push('');
  lines.push(`## ${t.critical}`);
  if (!r.criticalGaps.length) lines.push(t.none);
  for (const g of r.criticalGaps) lines.push(`- **[${g.severity}]** ${g.title} — ${g.description}`);
  lines.push('');
  lines.push(`## ${t.all}`);
  for (const g of r.allGaps) lines.push(`- [${g.severity}] ${g.title}`);
  lines.push('');
  lines.push(`## ${t.suggestions}`);
  for (const s of r.suggestions) lines.push(`- ${s}`);
  if (r.narrative) {
    lines.push('');
    lines.push(r.narrative);
  }
  return lines.join('\n');
}
