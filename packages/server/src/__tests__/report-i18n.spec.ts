/**
 * report-i18n.spec.ts
 * i18n-ui-report.md §7.2 — 报告模板双语快照测试
 *
 * 验证切换 locale 后：
 *   1. getReportLabels() 返回正确语言标签
 *   2. renderReportMarkdown() 输出结构稳定（含正确章节标题、风险级别翻译）
 *   3. 未知 locale 自动回退到 zh-CN
 */

import { describe, it, expect } from 'vitest';
import type { GapAnalysisReport } from '@risk-agent/core';
import { getReportLabels, renderReportMarkdown } from '../reports/ReportI18n.js';

// ─── 测试夹具 ───────────────────────────────────────────────────────────────

const FIXTURE_REPORT: GapAnalysisReport = {
  reportId: 'test-report-001',
  sessionId: 'test-session-001',
  businessName: '快捷支付',
  locale: 'zh-CN',
  overallScore: 72,
  coverageMatrix: [
    {
      scenarioId: 'scenario-001',
      scenarioName: '大额交易场景',
      coveredRuleIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
      missingRuleTypes: [],
      coveragePercent: 70,
    },
  ],
  criticalGaps: [
    {
      gapId: 'gap-001',
      title: '缺少实名认证规则',
      category: 'identity',
      description: '当前规则集未覆盖实名认证场景',
      severity: 'critical',
      suggestedRuleTypes: [],
      evidence: [],
    },
  ],
  allGaps: [
    {
      gapId: 'gap-001',
      title: '缺少实名认证规则',
      category: 'identity',
      description: '当前规则集未覆盖实名认证场景',
      severity: 'critical',
      suggestedRuleTypes: [],
      evidence: [],
    },
    {
      gapId: 'gap-002',
      title: '设备指纹采集不完整',
      category: 'device',
      description: '部分渠道缺少设备指纹采集',
      severity: 'medium',
      suggestedRuleTypes: [],
      evidence: [],
    },
  ],
  suggestions: ['补充实名认证规则', '完善设备指纹采集方案'],
  narrative: '总体来看，该业务场景的风控规则覆盖率尚需提升。',
  createdAt: new Date('2026-04-14T08:00:00Z').toISOString(),
};

// ─── 标签单元测试 ───────────────────────────────────────────────────────────

describe('getReportLabels', () => {
  it('returns zh-CN labels', () => {
    const labels = getReportLabels('zh-CN');
    expect(labels.title).toBe('风控缺口分析报告');
    expect(labels.coverage).toBe('规则覆盖矩阵');
    expect(labels.criticalGaps).toBe('关键缺口');
    expect(labels.allGaps).toBe('全部缺口');
    expect(labels.suggestions).toBe('优化建议');
    expect(labels.severity.critical).toBe('严重');
    expect(labels.severity.high).toBe('高风险');
    expect(labels.severity.medium).toBe('中风险');
    expect(labels.severity.low).toBe('低风险');
    expect(labels.footer).toContain('Risk Agent');
  });

  it('returns en-US labels', () => {
    const labels = getReportLabels('en-US');
    expect(labels.title).toBe('Risk Gap Analysis Report');
    expect(labels.coverage).toBe('Rule Coverage Matrix');
    expect(labels.criticalGaps).toBe('Critical Gaps');
    expect(labels.allGaps).toBe('All Gaps');
    expect(labels.suggestions).toBe('Suggestions');
    expect(labels.severity.critical).toBe('Critical');
    expect(labels.severity.high).toBe('High');
    expect(labels.severity.medium).toBe('Medium');
    expect(labels.severity.low).toBe('Low');
    expect(labels.footer).toContain('Risk Agent');
  });

  it('falls back to zh-CN for unknown locale', () => {
    const fallback = getReportLabels('fr-FR');
    const zhCN = getReportLabels('zh-CN');
    expect(fallback.title).toBe(zhCN.title);
    expect(fallback.severity.critical).toBe(zhCN.severity.critical);
  });

  it('supports bare zh and en aliases', () => {
    expect(getReportLabels('zh').title).toBe(getReportLabels('zh-CN').title);
    expect(getReportLabels('en').title).toBe(getReportLabels('en-US').title);
  });
});

// ─── Markdown 渲染快照测试 ──────────────────────────────────────────────────

describe('renderReportMarkdown', () => {
  it('renders zh-CN report with correct section headers', () => {
    const md = renderReportMarkdown(FIXTURE_REPORT, 'zh-CN');

    // 一级标题
    expect(md).toContain('# 风控缺口分析报告');
    // 业务名称
    expect(md).toContain('快捷支付');
    // 覆盖矩阵章节
    expect(md).toContain('## 规则覆盖矩阵');
    // 关键缺口章节
    expect(md).toContain('## 关键缺口');
    // 全部缺口章节
    expect(md).toContain('## 全部缺口');
    // 优化建议章节
    expect(md).toContain('## 优化建议');
    // 风险级别本地化（严重）
    expect(md).toContain('[严重]');
    // 中风险
    expect(md).toContain('[中风险]');
    // 具体缺口标题
    expect(md).toContain('缺少实名认证规则');
    // 建议
    expect(md).toContain('补充实名认证规则');
    // 叙述文字
    expect(md).toContain('总体来看');
    // 页脚
    expect(md).toContain('Risk Agent');
  });

  it('renders en-US report with correct section headers', () => {
    const md = renderReportMarkdown({ ...FIXTURE_REPORT, locale: 'en-US' }, 'en-US');

    // 一级标题（英文）
    expect(md).toContain('# Risk Gap Analysis Report');
    // 覆盖矩阵章节（英文）
    expect(md).toContain('## Rule Coverage Matrix');
    // 关键缺口章节（英文）
    expect(md).toContain('## Critical Gaps');
    // 全部缺口章节（英文）
    expect(md).toContain('## All Gaps');
    // 优化建议章节（英文）
    expect(md).toContain('## Suggestions');
    // 风险级别本地化（Critical）
    expect(md).toContain('[Critical]');
    // 中风险（英文）
    expect(md).toContain('[Medium]');
    // 具体缺口标题（中文内容，仅结构英文化）
    expect(md).toContain('缺少实名认证规则');
    // 页脚
    expect(md).toContain('Risk Agent');
  });

  it('renders empty gaps section with none label', () => {
    const emptyReport: GapAnalysisReport = {
      reportId: FIXTURE_REPORT.reportId,
      sessionId: FIXTURE_REPORT.sessionId,
      businessName: FIXTURE_REPORT.businessName,
      locale: FIXTURE_REPORT.locale,
      overallScore: FIXTURE_REPORT.overallScore,
      coverageMatrix: [],
      criticalGaps: [],
      allGaps: [],
      suggestions: [],
      narrative: '',
      createdAt: FIXTURE_REPORT.createdAt,
    };
    const mdZh = renderReportMarkdown(emptyReport, 'zh-CN');
    const mdEn = renderReportMarkdown(emptyReport, 'en-US');

    expect(mdZh).toContain('（无）');
    expect(mdEn).toContain('(none)');
  });

  it('zh-CN and en-US outputs differ in structure labels but share content', () => {
    const mdZh = renderReportMarkdown(FIXTURE_REPORT, 'zh-CN');
    const mdEn = renderReportMarkdown({ ...FIXTURE_REPORT, locale: 'en-US' }, 'en-US');

    // 结构标签不同
    expect(mdZh).not.toContain('# Risk Gap Analysis Report');
    expect(mdEn).not.toContain('# 风控缺口分析报告');

    // 业务内容相同（都包含原始中文内容）
    expect(mdZh).toContain('快捷支付');
    expect(mdEn).toContain('快捷支付');
  });

  it('unknown locale falls back to zh-CN rendering', () => {
    const mdFallback = renderReportMarkdown(FIXTURE_REPORT, 'fr-FR');
    const mdZh = renderReportMarkdown(FIXTURE_REPORT, 'zh-CN');
    expect(mdFallback).toBe(mdZh);
  });

  it('renders coverage matrix row with correct format', () => {
    const md = renderReportMarkdown(FIXTURE_REPORT, 'zh-CN');
    expect(md).toContain('大额交易场景');
    expect(md).toContain('70%');
    expect(md).toContain('覆盖率');
  });
});
