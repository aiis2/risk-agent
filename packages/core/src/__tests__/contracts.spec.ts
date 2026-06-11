import { describe, it, expect } from 'vitest';
import {
  BusinessScenarioSchema,
  RiskRuleSchema,
  GapAnalysisReportSchema,
  RuleGapMapSchema,
  StorageConfigSchema,
  TaskTypeSchema
} from '../agents/base/types.js';

describe('contracts', () => {
  it('StorageConfig parses defaults', () => {
    const cfg = StorageConfigSchema.parse({});
    expect(cfg.backend).toBe('embedded');
    expect(cfg.structured.backend).toBe('sqlite');
    expect(cfg.vector.backend).toBe('lancedb');
    expect(cfg.graph.backend).toBe('graphology');
    expect(cfg.object.backend).toBe('local');
  });

  it('TaskType enum locked', () => {
    expect(TaskTypeSchema.parse('local_agent')).toBe('local_agent');
    expect(TaskTypeSchema.parse('local_workflow')).toBe('local_workflow');
  });

  it('BusinessScenario round-trips defaults', () => {
    const s = BusinessScenarioSchema.parse({
      scenarioId: 's1',
      name: '快捷支付',
      createdAt: '2026-04-17T00:00:00Z',
      updatedAt: '2026-04-17T00:00:00Z'
    });
    expect(s.status).toBe('draft');
    expect(s.version).toBe(1);
  });

  it('RiskRule defaults', () => {
    const r = RiskRuleSchema.parse({
      ruleId: 'r1',
      ruleName: 'limit_single_transaction',
      syncedAt: '2026-04-17T00:00:00Z'
    });
    expect(r.status).toBe('active');
  });

  it('RuleGapMap + GapAnalysisReport shapes', () => {
    const map = RuleGapMapSchema.parse({ aggregatedAt: '2026-04-17T00:00:00Z' });
    expect(map.allGaps).toEqual([]);
    const rep = GapAnalysisReportSchema.parse({
      reportId: 'r1',
      sessionId: 's1',
      businessName: 'pay',
      createdAt: '2026-04-17T00:00:00Z'
    });
    expect(rep.locale).toBe('zh-CN');
    expect(rep.overallScore).toBe(0);
  });
});
