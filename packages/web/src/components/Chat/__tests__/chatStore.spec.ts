import { describe, expect, it, beforeEach } from 'vitest';
import { useChatStore } from '../../../stores/chatStore';

// Reset store between tests using setState
function resetStore() {
  useChatStore.setState({ conversations: {} });
}

describe('chatStore — SSE event processing', () => {
  beforeEach(() => {
    resetStore();
  });

  it('startConversation initializes empty conversation', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-1', '电商支付风控');
    const conv = store.getConversation('sess-1');
    expect(conv).toBeDefined();
    expect(conv!.businessName).toBe('电商支付风控');
    // sessionState starts as idle
    expect(conv!.sessionState).toBe('idle');
  });

  it('text_delta accumulates content on assistant message', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-2', '贷款风控');
    store.appendEvent('sess-2', { type: 'text_delta', text: '正在分析' });
    store.appendEvent('sess-2', { type: 'text_delta', text: '风险数据' });

    const conv = store.getConversation('sess-2')!;
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.role).toBe('assistant');
    expect(lastMsg.content).toBe('正在分析风险数据');
  });

  it('thinking_delta accumulates thinking field', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-3', '账户安全');
    store.appendEvent('sess-3', { type: 'thinking_delta', text: '思考步骤1' });
    store.appendEvent('sess-3', { type: 'thinking_delta', text: '思考步骤2' });

    const conv = store.getConversation('sess-3')!;
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.thinking).toBe('思考步骤1思考步骤2');
  });

  it('tool_call creates a running tool record', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-4', '欺诈检测');
    store.appendEvent('sess-4', {
      type: 'tool_call',
      callId: 'tc-001',
      toolName: 'search_rules',
      params: { query: 'payment fraud', limit: 5 },
    });

    const conv = store.getConversation('sess-4')!;
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.toolCalls).toHaveLength(1);
    expect(lastMsg.toolCalls[0].toolName).toBe('search_rules');
    expect(lastMsg.toolCalls[0].status).toBe('running');
    expect(conv.sessionState).toBe('tool_running');
  });

  it('tool_result updates tool status to done with result', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-5', '风险评估');
    store.appendEvent('sess-5', {
      type: 'tool_call',
      callId: 'tc-002',
      toolName: 'query_kb',
      params: {},
    });
    store.appendEvent('sess-5', {
      type: 'tool_result',
      callId: 'tc-002',
      result: '{"rules": 3}',
      durationMs: 120,
    });

    const conv = store.getConversation('sess-5')!;
    const tool = conv.messages[conv.messages.length - 1].toolCalls[0];
    expect(tool.status).toBe('done');
    expect(tool.result).toBe('{"rules": 3}');
    expect(tool.durationMs).toBe(120);
  });

  it('stringifies object tool results for readable tool cards', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-5b', '工具结果序列化');
    store.appendEvent('sess-5b', {
      type: 'tool_start',
      callId: 'tc-002b',
      toolName: 'query_database',
      params: {},
    });
    store.appendEvent('sess-5b', {
      type: 'tool_complete',
      callId: 'tc-002b',
      result: { rowCount: 1, rows: [{ session_id: 'sess-5b' }] },
      durationMs: 10,
    });

    const conv = useChatStore.getState().getConversation('sess-5b')!;
    const tool = conv.messages[conv.messages.length - 1].toolCalls[0];
    expect(tool.result).toContain('rowCount');
    expect(tool.result).toContain('session_id');
  });

  it('tool_error updates tool status to error', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-6', '信用评分');
    store.appendEvent('sess-6', {
      type: 'tool_start',
      callId: 'tc-003',
      toolName: 'check_db',
      params: {},
    });
    store.appendEvent('sess-6', {
      type: 'tool_error',
      callId: 'tc-003',
      error: 'Connection refused',
    });

    const conv = store.getConversation('sess-6')!;
    const tool = conv.messages[conv.messages.length - 1].toolCalls[0];
    expect(tool.status).toBe('error');
    expect(tool.error).toBe('Connection refused');
  });

  it('turn_info creates a new assistant message when previous has content', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-7', '供应链风控');
    store.appendEvent('sess-7', { type: 'text_delta', text: '第一轮内容' });
    store.appendEvent('sess-7', { type: 'turn_info', current: 2, max: 10, estimatedTokens: 1000 });

    const conv = store.getConversation('sess-7')!;
    expect(conv.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('cost_update increments token counts', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-8', 'Token测试');
    store.appendEvent('sess-8', {
      type: 'cost_update',
      inputTokens: 500,
      outputTokens: 200,
      cachedTokens: 0,
      estimatedUsd: 0.001,
    });

    const conv = store.getConversation('sess-8')!;
    expect(conv.totalInputTokens).toBe(500);
    expect(conv.totalOutputTokens).toBe(200);
  });

  it('system_init sets sessionState to thinking and stores model', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-9', '系统初始化测试');
    store.appendEvent('sess-9', {
      type: 'system_init',
      model: 'qwen3-coder-plus',
      agentType: 'coordinator',
      sessionId: 'sess-9',
    });

    const conv = store.getConversation('sess-9')!;
    expect(conv.sessionState).toBe('thinking');
    expect(conv.systemModel).toBe('qwen3-coder-plus');
  });

  it('appendEvents processes batch of events correctly', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-10', '批量事件测试');
    store.appendEvents('sess-10', [
      { type: 'system_init', model: 'test-model', agentType: 'coordinator', sessionId: 'sess-10' },
      { type: 'text_delta', text: '批量' },
      { type: 'text_delta', text: '内容' },
    ]);

    const conv = store.getConversation('sess-10')!;
    const lastMsg = conv.messages[conv.messages.length - 1];
    expect(lastMsg.content).toBe('批量内容');
    expect(conv.systemModel).toBe('test-model');
  });

  it('subagent_spawned adds worker record and links to message', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-11', '子智能体测试');
    store.appendEvent('sess-11', {
      type: 'subagent_spawned',
      agentId: 'worker-001',
      description: '研究支付欺诈规则',
      workerRole: 'researcher',
    });

    const conv = store.getConversation('sess-11')!;
    expect(conv.workers['worker-001']).toBeDefined();
    expect(conv.workers['worker-001'].description).toBe('研究支付欺诈规则');
    expect(conv.workers['worker-001'].status).toBe('running');
  });

  it('resetConversation clears previous messages and sets new business name', () => {
    const store = useChatStore.getState();
    store.startConversation('sess-12', '重置测试');
    store.appendEvent('sess-12', { type: 'text_delta', text: '旧内容' });
    store.resetConversation('sess-12', '新业务名称');

    const conv = store.getConversation('sess-12')!;
    // After reset: old AI content should be gone
    const hasOldContent = conv.messages.some((m) => m.content === '旧内容');
    expect(hasOldContent).toBe(false);
    expect(conv.businessName).toBe('新业务名称');
    // Reset initializes a fresh user message with the new business name
    const hasNewMsg = conv.messages.some((m) => m.content === '新业务名称');
    expect(hasNewMsg).toBe(true);
  });
});
