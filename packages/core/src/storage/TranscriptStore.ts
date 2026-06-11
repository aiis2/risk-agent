/**
 * TranscriptStore — 会话消息持久化（Transcript）
 * （参考 evolution-overview.md v3.3 · agent-framework.md §14 状态持久化与中断恢复）
 *
 * 将对话消息持久化到 SQLite conversations 表，支持：
 * - 会话中断后恢复（load → submitMessage with initialMessages）
 * - 跨进程/重启的断点续传
 * - 多会话并行（sessionId 隔离）
 *
 * 数据模型（conversations 表）：
 *   conv_id    TEXT PRIMARY KEY
 *   session_id TEXT NOT NULL
 *   role       TEXT NOT NULL ('system'|'user'|'assistant'|'tool')
 *   content    TEXT NOT NULL
 *   metadata   TEXT          -- JSON: toolCalls, toolResults, attachmentRefs, timestamp
 */

import { createLogger } from '../logger.js';
import type { IStructuredStore } from './interfaces/IStructuredStore.js';
import type { Message } from '../agents/base/types.js';
import { randomBytes } from 'node:crypto';

const log = createLogger('TranscriptStore');

interface ConversationRow {
  conv_id: string;
  session_id: string;
  /** 消息稳定 UUID（session-lifecycle.md §3.2） */
  uuid: string | null;
  role: string;
  /** 消息子类型，如 'compact_boundary'（session-lifecycle.md §4.1） */
  subtype: string | null;
  content: string;
  metadata: string | null;
  created_at: string;
}

/**
 * TranscriptStore — 会话 transcript 的读写服务
 */
export class TranscriptStore {
  constructor(private readonly store: IStructuredStore) {}

  // ─── 写入 ──────────────────────────────────────────────

  /**
   * 将一批消息追加到会话 transcript
   */
  async append(sessionId: string, messages: Message[], opts?: { uuid?: string; subtype?: string }): Promise<void> {
    if (messages.length === 0) return;
    try {
      await this.store.transaction(async (tx) => {
        for (const msg of messages) {
          const convId = `conv_${randomBytes(8).toString('hex')}`;
          const msgUuid = opts?.uuid ?? `msg_${randomBytes(8).toString('hex')}`;
          const metadata = JSON.stringify({
            toolCalls: msg.toolCalls,
            toolResults: msg.toolResults,
            attachmentRefs: msg.attachmentRefs,
            timestamp: msg.timestamp ?? Date.now()
          });
          await tx.run(
            `INSERT INTO conversations (conv_id, session_id, uuid, role, subtype, content, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [convId, sessionId, msgUuid, msg.role, opts?.subtype ?? null, msg.content, metadata]
          );
        }
      });
      log.debug({ sessionId, count: messages.length }, 'Transcript appended');
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to append transcript');
      // 持久化失败不影响主流程
    }
  }

  /**
   * 记录压缩边界标记（session-lifecycle.md §4.1 CompactBoundaryMessage）
   */
  async appendCompactBoundary(
    sessionId: string,
    boundary: { uuid: string; tokensBefore: number; tokensAfter: number; strategy: string }
  ): Promise<void> {
    const convId = `conv_${randomBytes(8).toString('hex')}`;
    try {
      await this.store.run(
        `INSERT INTO conversations (conv_id, session_id, uuid, role, subtype, content, metadata)
         VALUES (?, ?, ?, 'system', 'compact_boundary', '', ?)`,
        [
          convId, sessionId, boundary.uuid,
          JSON.stringify({ tokensBefore: boundary.tokensBefore, tokensAfter: boundary.tokensAfter, strategy: boundary.strategy })
        ]
      );
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to record compact_boundary');
    }
  }

  /**
   * 追加单条消息
   */
  async appendOne(sessionId: string, message: Message, opts?: { uuid?: string; subtype?: string }): Promise<void> {
    return this.append(sessionId, [message], opts);
  }

  // ─── 读取 ──────────────────────────────────────────────

  /**
   * 加载会话 transcript（按时间升序）
   * 用于会话恢复：将返回的 messages 作为 initialMessages 传入 QueryEngine.submitMessage()
   */
  async load(sessionId: string): Promise<Message[]> {
    try {
      const rows = await this.store.all<ConversationRow>(
        `SELECT conv_id, session_id, uuid, role, subtype, content, metadata, created_at
         FROM conversations
         WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC`,
        [sessionId]
      );
      return rows.map((r) => parseRow(r));
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to load transcript');
      return [];
    }
  }

  /**
   * 加载最后一个 compact_boundary 之后的消息（session-lifecycle.md §4 Snip 重放）
   * 用于会话恢复：只加载 boundary 之后的消息，节省内存。
   * 若没有 compact_boundary，则返回全量消息。
   */
  async loadSinceLastBoundary(sessionId: string): Promise<Message[]> {
    try {
      const boundaryRow = await this.store.get<{ rowid: number }>(
        `SELECT rowid FROM conversations
         WHERE session_id = ? AND subtype = 'compact_boundary'
         ORDER BY rowid DESC LIMIT 1`,
        [sessionId]
      );

      if (!boundaryRow) {
        return this.load(sessionId);
      }

      const rows = await this.store.all<ConversationRow>(
        `SELECT conv_id, session_id, uuid, role, subtype, content, metadata, created_at
         FROM conversations
         WHERE session_id = ? AND rowid >= ?
         ORDER BY rowid ASC`,
        [sessionId, boundaryRow.rowid]
      );
      // 过滤掉 compact_boundary 标记本身，不作为 Message 传给 LLM
      return rows.filter((r) => r.subtype !== 'compact_boundary').map((r) => parseRow(r));
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to load since last boundary, falling back to full load');
      return this.load(sessionId);
    }
  }

  /**
   * 加载最近 N 条消息（用于轻量恢复）
   */
  async loadRecent(sessionId: string, limit: number): Promise<Message[]> {
    try {
      const rows = await this.store.all<ConversationRow>(
        `SELECT conv_id, session_id, uuid, role, subtype, content, metadata, created_at
         FROM (
           SELECT * FROM conversations
           WHERE session_id = ?
           ORDER BY rowid DESC
           LIMIT ?
         ) sub
         ORDER BY rowid ASC`,
        [sessionId, limit]
      );
      return rows.map((r) => parseRow(r));
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to load recent transcript');
      return [];
    }
  }

  // ─── 删除 ──────────────────────────────────────────────

  /**
   * 清除会话的全部 transcript（会话终止/归档时调用）
   */
  async clear(sessionId: string): Promise<void> {
    try {
      await this.store.run(`DELETE FROM conversations WHERE session_id = ?`, [sessionId]);
      log.info({ sessionId }, 'Transcript cleared');
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to clear transcript');
    }
  }

  /**
   * 统计会话消息数量
   */
  async count(sessionId: string): Promise<number> {
    const row = await this.store.get<{ n: number }>(
      `SELECT COUNT(*) as n FROM conversations WHERE session_id = ?`,
      [sessionId]
    );
    return row?.n ?? 0;
  }

  // ─── FTS5 全文检索 ──────────────────────────────────────

  /**
   * 全文搜索会话消息（FTS5）
   * system-architecture.md v3.3 §6.3 Transcript 搜索索引
   *
   * @param query  FTS5 查询字符串（支持短语、前缀、布尔运算）
   * @param opts   可选过滤参数
   */
  async search(
    query: string,
    opts: { sessionId?: string; role?: string; limit?: number } = {}
  ): Promise<TranscriptSearchResult[]> {
    if (!query.trim()) return [];
    const { sessionId, role, limit = 20 } = opts;

    try {
      const conditions: string[] = ['conversations_fts MATCH ?'];
      const params: unknown[] = [query];

      if (sessionId) {
        conditions.push('c.session_id = ?');
        params.push(sessionId);
      }
      if (role) {
        conditions.push('c.role = ?');
        params.push(role);
      }

      const sql = `
        SELECT
          c.conv_id,
          c.session_id,
          c.uuid,
          c.role,
          c.subtype,
          c.content,
          c.created_at,
          snippet(conversations_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
        FROM conversations_fts
        JOIN conversations c ON conversations_fts.rowid = c.rowid
        WHERE ${conditions.join(' AND ')}
        ORDER BY rank
        LIMIT ?
      `;
      params.push(limit);

      const rows = await this.store.all<{
        conv_id: string;
        session_id: string;
        uuid: string | null;
        role: string;
        subtype: string | null;
        content: string;
        created_at: string;
        snippet: string;
      }>(sql, params);

      return rows.map((r) => ({
        convId: r.conv_id,
        sessionId: r.session_id,
        uuid: r.uuid ?? undefined,
        role: r.role as TranscriptSearchResult['role'],
        subtype: r.subtype ?? undefined,
        content: r.content,
        snippet: r.snippet,
        createdAt: r.created_at
      }));
    } catch (err) {
      log.warn({ query, err }, 'FTS5 search failed');
      return [];
    }
  }
}

// ──────────────────────────────────────────────────────────
// 类型
// ──────────────────────────────────────────────────────────

export interface TranscriptSearchResult {
  convId: string;
  sessionId: string;
  uuid?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  subtype?: string;
  content: string;
  /** FTS5 snippet with <mark> tags */
  snippet: string;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────

function parseRow(r: ConversationRow): Message {
  let toolCalls: Message['toolCalls'];
  let toolResults: Message['toolResults'];
  let attachmentRefs: Message['attachmentRefs'];
  let timestamp: number | undefined;

  if (r.metadata) {
    try {
      const meta = JSON.parse(r.metadata) as {
        toolCalls?: Message['toolCalls'];
        toolResults?: Message['toolResults'];
        attachmentRefs?: Message['attachmentRefs'];
        timestamp?: number;
      };
      toolCalls = meta.toolCalls;
      toolResults = meta.toolResults;
      attachmentRefs = meta.attachmentRefs;
      timestamp = meta.timestamp;
    } catch {
      // ignore parse errors
    }
  }

  return {
    role: r.role as Message['role'],
    content: r.content,
    toolCalls,
    toolResults,
    attachmentRefs,
    timestamp
  };
}
