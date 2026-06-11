import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StorageBackendRegistry } from '../../storage/registry.js';
import { OrchestratorAgent, buildOrchestratorNarrativePrompt } from '../OrchestratorAgent.js';
import { MockProvider } from '../../llm/providers/MockProvider.js';
import { QueryEngine } from '../../query/QueryEngine.js';
import { PromptAssembler } from '../../prompt/PromptAssembler.js';
import { ToolRegistry } from '../../tools/registry/ToolRegistry.js';
import { CostTracker } from '../../cost/CostTracker.js';
import type { BusinessScenario, RiskRule } from '../base/types.js';

describe('OrchestratorAgent (four-phase flow)', () => {
  it('uses a unified semantic prompt that can still require browser inspection for page-analysis follow-ups', () => {
    const prompt = buildOrchestratorNarrativePrompt({
      businessName: 'Stripe Radar',
      overallScore: 100,
      coverageMatrix: [{ scenarioId: 'sc-1' }],
      criticalGaps: [{ title: '缺少限额规则', severity: 'high', category: 'coverage' }],
      suggestions: ['补充交易限额和异常检测规则'],
    } as any, 'zh-CN', [
      '忽略上一轮固定模板，使用 Playwright 打开 https://docs.stripe.com/radar 并截图分析页面内容。',
    ]);

    expect(prompt).toContain('请根据最新用户引导的完整语义决定本轮任务，不要用关键字规则给任务分流。');
    expect(prompt).toContain('如果最新引导要求访问 URL、查看页面、截图、继续用内置浏览器或 Playwright，必须先实际调用可用的浏览器工具。');
    expect(prompt).toContain('Report JSON 仅作为可选背景上下文，不是固定输出模板。');
    expect(prompt).toContain('https://docs.stripe.com/radar');
    expect(prompt).not.toContain('1. 先用一小段文字概括整体风险结论；');
  });

  it('runs research -> synthesis -> implementation -> verification and persists report', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-mvp-'));
    try {
      const reg = await StorageBackendRegistry.bootstrap(tmp);
      const sessionId = 'sess-1';
      const store = reg.getStructuredStore();
      await store.run(
        `INSERT INTO sessions(session_id, business_name) VALUES(?, ?)`,
        [sessionId, '快捷支付']
      );
      const scenarios: BusinessScenario[] = [
        {
          scenarioId: 'sc1',
          name: '单笔支付限额',
          domain: 'payment',
          status: 'active',
          version: 1,
          dataSources: [],
          documents: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      const rules: RiskRule[] = [
        {
          ruleId: 'rule-1',
          ruleName: 'limit_single',
          bizType: 'payment',
          ruleType: 'limit',
          coverage: ['sc1'],
          status: 'active',
          syncedAt: new Date().toISOString()
        }
      ];
      const engine = new QueryEngine(
        new MockProvider(),
        new PromptAssembler(),
        new ToolRegistry(),
        new CostTracker(),
        { sessionId, model: 'mock' }
      );
      const agent = new OrchestratorAgent({
        sessionId,
        businessName: '快捷支付',
        scenarios,
        rules,
        storage: reg,
        queryEngine: engine
      });
      const events: string[] = [];
      for await (const e of agent.run({ prompt: 'go' })) {
        events.push(e.type);
      }
      expect(events).toContain('research_complete');
      const row = await store.get<any>(`SELECT * FROM gap_reports WHERE session_id=?`, [sessionId]);
      expect(row).toBeDefined();
      const report = JSON.parse(row.payload_json);
      expect(report.coverageMatrix.length).toBe(1);
      expect(report.allGaps.length).toBeGreaterThan(0);
      await reg.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);

  it('injects follow-up guidance into the persisted report suggestions', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-mvp-'));
    try {
      const reg = await StorageBackendRegistry.bootstrap(tmp);
      const sessionId = 'sess-guidance';
      const store = reg.getStructuredStore();
      await store.run(
        `INSERT INTO sessions(session_id, business_name) VALUES(?, ?)`,
        [sessionId, '快捷支付']
      );

      const scenarios: BusinessScenario[] = [
        {
          scenarioId: 'sc1',
          name: '单笔支付限额',
          domain: 'payment',
          status: 'active',
          version: 1,
          dataSources: [],
          documents: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      const rules: RiskRule[] = [
        {
          ruleId: 'rule-1',
          ruleName: 'limit_single',
          bizType: 'payment',
          ruleType: 'limit',
          coverage: ['sc1'],
          status: 'active',
          syncedAt: new Date().toISOString()
        }
      ];
      const engine = new QueryEngine(
        new MockProvider(),
        new PromptAssembler(),
        new ToolRegistry(),
        new CostTracker(),
        { sessionId, model: 'mock' }
      );
      const agent = new OrchestratorAgent({
        sessionId,
        businessName: '快捷支付',
        guidanceMessages: ['请重点关注异常登录链路'],
        scenarios,
        rules,
        storage: reg,
        queryEngine: engine
      });

      for await (const _event of agent.run({ prompt: 'go' })) {
        // consume
      }

      const row = await store.get<any>(`SELECT payload_json FROM gap_reports WHERE session_id=?`, [sessionId]);
      expect(row).toBeDefined();
      const report = JSON.parse(row.payload_json);
      expect(report.suggestions[0]).toContain('请重点关注异常登录链路');

      await reg.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 20_000);

  it('keeps explicit no-knowledge-query browser follow-ups in the same unified semantic prompt', () => {
    const prompt = buildOrchestratorNarrativePrompt({
      businessName: 'Stripe Radar',
      overallScore: 92,
      coverageMatrix: [{ scenarioId: 'sc-1' }],
      criticalGaps: [{ title: '缺少设备画像', severity: 'medium', category: 'coverage' }],
      suggestions: ['补充设备画像与页面观察'],
    } as any, 'zh-CN', [
      '不要检索知识库，继续用内置浏览器访问 https://docs.stripe.com/radar 并总结页面内容。',
    ]);

    expect(prompt).toContain('如果最新引导明确要求不要检索知识库、不要沿用上一轮模板，或要求继续使用浏览器，必须服从这些约束。');
    expect(prompt).toContain('不要检索知识库，继续用内置浏览器访问 https://docs.stripe.com/radar 并总结页面内容。');
    expect(prompt).not.toContain('请先使用可用的浏览器工具访问用户追加引导中的目标页面，再基于页面可见内容作答。');
  });

  it('does not force the fixed risk-report summary template when follow-up guidance asks for another deliverable', () => {
    const prompt = buildOrchestratorNarrativePrompt({
      businessName: '跨境支付',
      overallScore: 78,
      coverageMatrix: [{ scenarioId: 'sc-1' }],
      criticalGaps: [{ title: '缺少退款欺诈识别', severity: 'high', category: 'risk-gaps' }],
      suggestions: ['补充退款链路监测'],
    } as any, 'zh-CN', [
      '请分析下面的业务文档并生成业务画像，不要输出固定的风控报告总结模板。',
    ]);

    expect(prompt).toContain('请根据最新用户引导的完整语义决定本轮任务，不要用关键字规则给任务分流。');
    expect(prompt).toContain('业务画像');
    expect(prompt).not.toContain('1. 先用一小段文字概括整体风险结论；');
  });
});
