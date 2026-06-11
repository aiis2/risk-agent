import { describe, it, expect } from 'vitest';
import { PromptAssembler } from '../PromptAssembler.js';

describe('PromptAssembler', () => {
  it('compiles core role + domain + rag', async () => {
    const pa = new PromptAssembler();
    const text = await pa.compile({
      sessionId: 's',
      workerRole: 'coordinator',
      businessName: '快捷支付',
      domain: 'payment',
      scenarios: [{ name: '单笔限额' }],
      rules: [{ name: 'limit_single', ruleType: 'limit' }],
      memorySnippets: ['用户昨日做过类似分析'],
      ragSnippets: ['规则 SPEC-001 覆盖单笔限额']
    });
    expect(text).toContain('Coordinator');
    expect(text).toContain('快捷支付');
    expect(text).toContain('limit_single');
    expect(text).toContain('RAG');
  });
});
