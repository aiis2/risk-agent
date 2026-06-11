import { describe, expect, it } from 'vitest';
import { RunRouter } from '../RunRouter.js';

describe('RunRouter', () => {
  it('keeps web chat surfaces in hermes mode and lets the orchestrator choose the first capability semantically', () => {
    const decision = new RunRouter().route({
      input: {
        prompt: '分析电商支付的风险链路并给我一份排查报告',
        surface: 'web',
      },
    });

    expect(decision).toMatchObject({
      agentMode: 'hermes',
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });

  it('keeps lightweight greetings in general mode without regex capability classification', () => {
    const decision = new RunRouter().route({
      input: { prompt: '你好' },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it('keeps analysis-like prompts in general so the orchestrator can decide semantically', () => {
    const decision = new RunRouter().route({
      input: { prompt: '分析电商支付的风险链路并给我一份排查报告' },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });

  it('keeps knowledge-style lookup phrasing in general so browser or other tools remain available', () => {
    const decision = new RunRouter().route({
      input: { prompt: '查询设备指纹相关规则' },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });

  it('keeps MCP capability requests in general so the orchestrator can pick skill-management semantically', () => {
    const decision = new RunRouter().route({
      input: { prompt: '帮我调试 docs-mcp MCP 服务' },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });

  it('keeps connector template requests in general so the orchestrator can pick skill-management semantically', () => {
    const decision = new RunRouter().route({
      input: { prompt: '帮我生成一个 Discord bot 骨架包' },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });

  it('keeps external skills CLI help prompts in general mode', () => {
    const decision = new RunRouter().route({
      input: { prompt: '帮我通过npx skills add https://github.com/anthropics/skills --skill frontend-design 方式安装这个skill' },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      reason: 'phase2_auto_external_skills_cli',
    });
  });

  it('keeps attachment summarization requests in general mode', () => {
    const decision = new RunRouter().route({
      input: { prompt: '先帮我提炼附件重点并整理问题列表', attachmentIds: ['att-1'] },
    });

    expect(decision).toMatchObject({
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });

  it('does not lock browser follow-ups into knowledge-query when the user explicitly rejects KB retrieval', () => {
    const decision = new RunRouter().route({
      input: {
        prompt: '不要检索知识库，继续用内置浏览器访问 https://docs.stripe.com/radar 并总结页面内容',
        surface: 'web',
      },
    });

    expect(decision).toMatchObject({
      agentMode: 'hermes',
      acceptedTaskKind: 'general',
      initialCapabilityProfile: 'general',
      reason: 'semantic_capability_entry',
    });
  });
});