import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

export const askUserTool: AgentToolDefinition = {
  name: 'ask_user',
  description: '向用户发起澄清问题，等待用户答复后再继续（阻塞式）。',
  isConcurrencySafe: false,
  isDestructive: false,
  interruptBehavior: 'halt',
  alwaysLoad: true,
  inputSchema: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } }
    }
  },
  async execute(input) {
    // 真正的交互由 QueryEngine 在看到该 tool call 时转为 `ask_user` StreamEvent 处理。
    // 该 execute 仅作为占位返回，防止被直接调用。
    return { pending: true, requested: input };
  }
};
