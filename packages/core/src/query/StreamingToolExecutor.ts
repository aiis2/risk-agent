/**
 * StreamingToolExecutor — 流式工具执行器（参考 agent-framework.md §4.5 · Claude Code CLI）
 *
 * 在 LLM 流式返回消息的同时，已识别的 tool_use block 立即开始执行，
 * 而不等全部流传输完毕。并发安全的工具在流中即时并行执行；
 * 串行工具在流结束后依次执行。
 *
 * 用法：
 *   const executor = new StreamingToolExecutor(tools, config, signal)
 *   // LLM 流中每产生一个完整 tool_use block 时：
 *   executor.onToolUseBlock(block)
 *   // 流结束后，等待全部工具结果：
 *   const results = await executor.getAllResults()
 */

import type { AgentToolDefinition } from '../tools/registry/ToolRegistry.js';
import type { ToolResult, ToolCall, StreamEvent } from '../agents/base/types.js';
import { createLogger } from '../logger.js';

const log = createLogger('StreamingToolExecutor');

export interface StreamingToolConfig {
  sessionId: string;
  toolTimeoutMs?: number;
}

type ToolExecuteContext = {
  sessionId: string;
  signal: AbortSignal;
  onProgress?: (data: unknown) => void;
};

export class StreamingToolExecutor {
  /** 并发安全工具：LLM 流中立即并行启动 */
  private readonly parallelPromises: Map<string, Promise<ToolResult>> = new Map();
  /** 串行工具队列：流结束后依次执行 */
  private readonly serialQueue: Array<{ tool: AgentToolDefinition; call: ToolCall }> = [];
  /** 已收集结果（按完成顺序） */
  private readonly collectedResults: ToolResult[] = [];
  /** 推送 StreamEvent 的回调 */
  private readonly emitter?: (event: StreamEvent) => void;

  constructor(
    private readonly tools: AgentToolDefinition[],
    private readonly config: StreamingToolConfig,
    private readonly signal?: AbortSignal,
    emitter?: (event: StreamEvent) => void
  ) {
    this.emitter = emitter;
  }

  /**
   * LLM 流中每产生一个完整的 tool_use block 时调用。
   * 并发安全工具立即并行执行，串行工具入队等待。
   */
  onToolUseBlock(call: ToolCall): void {
    const tool = this.tools.find((t) => t.name === call.name);
    if (!tool) {
      log.warn({ toolName: call.name }, 'Tool not found, skipping streaming execution');
      return;
    }

    this.emitter?.({ type: 'tool_start', toolName: call.name, toolUseId: call.toolUseId, input: call.input });

    if (tool.isConcurrencySafe === true) {
      // 并发安全 → 立即启动
      this.parallelPromises.set(call.toolUseId, this.executeSafe(tool, call));
    } else {
      // 串行 → 入队
      this.serialQueue.push({ tool, call });
    }
  }

  /**
   * LLM 流结束后调用，等待所有工具结果（并行已完成 + 串行依次执行）。
   * 返回全部 ToolResult，顺序与原始 toolCalls 相同。
   */
  async getAllResults(originalCalls: ToolCall[]): Promise<ToolResult[]> {
    // 1. 收集所有并行结果（已在流中启动）
    for (const [id, promise] of this.parallelPromises) {
      try {
        const result = await promise;
        this.collectedResults.push(result);
        this.emitter?.({ type: 'tool_complete', toolUseId: id, result: result.content, durationMs: 0 });
      } catch (err) {
        this.collectedResults.push({ toolUseId: id, isError: true, content: (err as Error).message });
        this.emitter?.({ type: 'tool_error', toolUseId: id, error: (err as Error).message });
      }
    }

    // 2. 串行执行队列
    for (const { tool, call } of this.serialQueue) {
      const result = await this.executeSafe(tool, call);
      this.collectedResults.push(result);
      if (result.isError) {
        this.emitter?.({ type: 'tool_error', toolUseId: call.toolUseId, error: String(result.content) });
      } else {
        this.emitter?.({ type: 'tool_complete', toolUseId: call.toolUseId, result: result.content, durationMs: 0 });
      }
    }

    // 3. 按原始调用顺序排序
    const resultMap = new Map(this.collectedResults.map((r) => [r.toolUseId, r]));
    return originalCalls.map((tc) =>
      resultMap.get(tc.toolUseId) ?? {
        toolUseId: tc.toolUseId,
        isError: true,
        content: `工具 ${tc.name} 未执行`
      }
    );
  }

  private async executeSafe(tool: AgentToolDefinition, call: ToolCall): Promise<ToolResult> {
    const ctrl = new AbortController();
    if (this.signal) {
      this.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), this.config.toolTimeoutMs ?? 120_000);

    const ctx: ToolExecuteContext = {
      sessionId: this.config.sessionId,
      signal: ctrl.signal,
      onProgress: () => {
        /* TBD */
      }
    };

    try {
      const output = await tool.execute(call.input, ctx as any);
      const content = typeof output === 'string' ? output : JSON.stringify(output);
      return { toolUseId: call.toolUseId, isError: false, content };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      log.warn({ toolName: call.name, err }, 'Tool execution error in StreamingToolExecutor');
      return { toolUseId: call.toolUseId, isError: true, content: `工具执行错误: ${msg}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
