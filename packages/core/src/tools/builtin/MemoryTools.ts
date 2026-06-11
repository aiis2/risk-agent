/**
 * MemoryReadTool / MemoryWriteTool — Coordinator 记忆系统工具
 *
 * 参考 agent-framework.md §2.1 COORDINATOR_TOOLS:
 *   'MemoryRead'  — 读取长期/短期记忆
 *   'MemoryWrite' — 写入长期记忆
 */

import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';
import type { MemoryService, MemoryCategory } from '../../memory/MemoryService.js';

// ─── MemoryRead ──────────────────────────────────────────────────────────────

export function createMemoryReadTool(memoryService: MemoryService): AgentToolDefinition {
  return {
    name: 'memory_read',
    description: '从记忆系统检索相关长期记忆，并获取当前会话的短期记忆摘要。返回与查询最相关的历史知识片段。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    deferred: false,
    searchHint: 'memory recall retrieve knowledge history',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: '检索关键词或自然语言描述，用于匹配相关历史记忆'
        },
        topK: {
          type: 'number',
          description: '返回最相关的条目数量（默认 5）',
          default: 5
        },
        includeShortTerm: {
          type: 'boolean',
          description: '是否同时返回当前会话短期记忆（默认 true）',
          default: true
        }
      }
    },
    async execute(input: { query: string; topK?: number; includeShortTerm?: boolean }, ctx: ToolExecContext) {
      const topK = input.topK ?? 5;
      const includeShortTerm = input.includeShortTerm !== false;

      const longTermResults = await memoryService.searchLongTermMemory(input.query, topK);

      // 异步更新访问计数
      for (const r of longTermResults) {
        memoryService.touchMemory(r.id).catch(() => undefined);
      }

      const result: Record<string, unknown> = {
        long_term: longTermResults.map((r) => ({
          id: r.id,
          content: r.content,
          category: r.category,
          score: Math.round(r.score * 100) / 100,
          accessCount: r.accessCount,
          businessName: r.businessName
        }))
      };

      if (includeShortTerm) {
        const summary = memoryService.getShortTermSummary(ctx.sessionId);
        result.short_term_summary = summary || '（当前会话暂无短期记忆）';
      }

      return result;
    }
  };
}

// ─── MemoryWrite ─────────────────────────────────────────────────────────────

export function createMemoryWriteTool(memoryService: MemoryService): AgentToolDefinition {
  return {
    name: 'memory_write',
    description: '将重要发现或知识片段写入长期记忆，供未来会话检索复用。仅写入高价值、通用性强的知识。',
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: false,
    deferred: false,
    searchHint: 'memory save store knowledge persist',
    inputSchema: {
      type: 'object',
      required: ['content', 'category'],
      properties: {
        content: {
          type: 'string',
          description: '要写入记忆的内容（不超过 2000 字符）'
        },
        category: {
          type: 'string',
          enum: ['domain_knowledge', 'user_preference', 'analysis_pattern', 'risk_template'],
          description: '记忆类别'
        },
        businessName: {
          type: 'string',
          description: '关联的业务名称（可选，有助于后续检索）'
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '关键词列表（可选，提高检索精度）'
        }
      }
    },
    async execute(
      input: { content: string; category: MemoryCategory; businessName?: string; keywords?: string[] },
      ctx: ToolExecContext
    ) {
      if (!input.content?.trim()) {
        return { success: false, error: '内容不能为空' };
      }
      const truncated = input.content.slice(0, 2000);
      const id = await memoryService.saveLongTermMemory({
        content: truncated,
        category: input.category,
        sessionId: ctx.sessionId,
        businessName: input.businessName,
        keywords: input.keywords
      });
      return { success: true, id, message: `已写入长期记忆 (id: ${id.slice(0, 8)}...)` };
    }
  };
}

// ─── ShortTermWrite (内部调用，不暴露给 LLM) ─────────────────────────────────

export function createShortTermWriteTool(memoryService: MemoryService): AgentToolDefinition {
  return {
    name: 'memory_write_short_term',
    description: '（内部）写入当前会话短期记忆条目，供 Coordinator 追踪 Worker 进度摘要。',
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: false,
    deferred: true,
    inputSchema: {
      type: 'object',
      required: ['round', 'summary'],
      properties: {
        round: { type: 'number' },
        summary: { type: 'string' },
        keyFindings: { type: 'array', items: { type: 'string' } }
      }
    },
    async execute(input: { round: number; summary: string; keyFindings?: string[] }, ctx: ToolExecContext) {
      memoryService.addShortTermEntry(ctx.sessionId, {
        round: input.round,
        summary: input.summary,
        keyFindings: input.keyFindings ?? []
      });
      return { success: true };
    }
  };
}
