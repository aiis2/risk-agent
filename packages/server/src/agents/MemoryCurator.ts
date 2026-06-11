/**
 * MemoryCurator — A3 记忆策展代理（2026-04-29）
 *
 * 职责：
 * 1. 在每次 run/session 完成后，提取对话中的关键事实并写入 `memory_facts` 表
 * 2. 通过 Python sidecar `/curate` 端点做 LLM 策展（若 sidecar 不可用，走简单规则提取）
 * 3. 去重：基于 content 哈希跳过重复事实
 * 4. 完全异步，失败只记日志，不影响主流程
 */

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { DEFAULT_OWNER_KEY, UserProfileService, type LearnedFact } from '@risk-agent/core';
import { getSidecarClient, type CurateMemoryResponse } from '../services/SidecarClient.js';

export interface MemoryCuratorDeps {
  db: {
    run(sql: string, params?: unknown[]): Promise<unknown>;
    all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  };
  logger?: { info(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void };
}

export interface CuratedFact {
  content: string;
  category: 'domain_knowledge' | 'user_preference' | 'analysis_pattern' | 'risk_template' | 'general';
  confidence: number;
}

/**
 * 将原始文本 transcript 解析成 [{role,content}] 数组，用于 sidecar curate
 * 格式假设每行以 "[user]" / "[assistant]" 或 "user:" / "assistant:" 开头
 */
function parseTranscriptMessages(
  raw: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const lines = raw.split('\n');
  let cur: { role: 'user' | 'assistant'; lines: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^\s*(\[?(?:user|assistant|human|ai)\]?)\s*[:：]?\s*/i);
    if (m) {
      if (cur && cur.lines.length) msgs.push({ role: cur.role, content: cur.lines.join(' ').trim() });
      const roleLower = m[1].replace(/[\[\]]/g, '').toLowerCase();
      cur = { role: roleLower === 'user' || roleLower === 'human' ? 'user' : 'assistant', lines: [] };
      const rest = line.slice(m[0].length).trim();
      if (rest) cur.lines.push(rest);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur && cur.lines.length) msgs.push({ role: cur.role, content: cur.lines.join(' ').trim() });
  // fallback：若解析出 0 条就当成 user 消息
  if (msgs.length === 0 && raw.trim()) {
    msgs.push({ role: 'user', content: raw.slice(-2000) });
  }
  return msgs.slice(-20); // 最多传最近 20 轮
}

function stripSpeakerPrefix(line: string): string {
  return line.replace(/^\s*(\[?(?:user|assistant|human|ai)\]?)\s*[:：]?\s*/i, '').trim();
}

/**
 * 简单规则提取（sidecar 不可用时的 fallback）
 * 识别含风控/业务关键词的短句作为候选事实
 */
function extractByRules(transcript: string): CuratedFact[] {
  const facts: CuratedFact[] = [];
  const lines = transcript
    .split('\n')
    .map(stripSpeakerPrefix)
    .filter((line) => line.length > 10 && line.length < 300);

  const domainKeywords = /风控|欺诈|支付|合规|规则|登录|设备|风险|黑产|异常|监管|KYC|反洗钱/;
  const prefKeywords = /偏好|习惯|风格|格式|简洁|详细|报告|模式/;
  const patternKeywords = /通常|一般|经验|总结|规律|模式|方案|思路/;

  for (const line of lines) {
    if (prefKeywords.test(line)) {
      facts.push({ content: line.trim(), category: 'user_preference', confidence: 0.55 });
    } else if (domainKeywords.test(line)) {
      facts.push({ content: line.trim(), category: 'domain_knowledge', confidence: 0.6 });
    } else if (patternKeywords.test(line)) {
      facts.push({ content: line.trim(), category: 'analysis_pattern', confidence: 0.5 });
    }
  }

  return facts.slice(0, 8);
}

/** 基于 SHA256 hash 快速去重 */
function hashContent(content: string): string {
  return createHash('sha256').update(content.trim().toLowerCase()).digest('hex').slice(0, 16);
}

export class MemoryCurator {
  constructor(private readonly deps: MemoryCuratorDeps) {}

  /**
   * 策展入口：在 run/session 完成后异步调用。
   * @param sessionId - 源会话 ID
   * @param runId - 源 run ID（可选）
   * @param transcript - 本轮完整对话文本
   */
  async curate(params: {
    sessionId?: string;
    runId?: string;
    transcript: string;
  }): Promise<void> {
    const { sessionId, runId, transcript } = params;
    if (!transcript || transcript.length < 30) return;

    const { logger } = this.deps;
    logger?.info('MemoryCurator.curate start', { sessionId, runId, transcriptLen: transcript.length });

    let facts: CuratedFact[] = [];

    try {
      const sidecar = getSidecarClient();
      const healthy = await sidecar.isHealthy();

      if (healthy) {
        const msgs = parseTranscriptMessages(transcript);
        const result = await sidecar.curate({
          kind: 'memory_curate',
          transcript: msgs,
          maxFacts: 8,
        });
        const memResult = result as CurateMemoryResponse | null;
        if (memResult?.facts && Array.isArray(memResult.facts)) {
          facts = memResult.facts as CuratedFact[];
          logger?.info('MemoryCurator: sidecar curated', { count: facts.length });
        }
      }
    } catch {
      // sidecar 失败时静默降级
    }

    // fallback：规则提取
    if (facts.length === 0) {
      facts = extractByRules(transcript);
      logger?.info('MemoryCurator: fallback rule extraction', { count: facts.length });
    }

    if (facts.length === 0) return;

    // 写入 DB（跳过已有 content_hash 的记录）
    for (const fact of facts) {
      const contentHash = hashContent(fact.content);
      try {
        const existing = await this.deps.db.all<{ fact_id: string }>(
          `SELECT fact_id FROM memory_facts WHERE content_hash = ? LIMIT 1`,
          [contentHash],
        );
        if (existing.length > 0) continue; // 重复跳过

        await this.deps.db.run(
          `INSERT INTO memory_facts(fact_id, content, content_hash, category, source_session, source_run, confidence, embedding_status, use_count, last_used_at, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, datetime('now'))`,
          [
            randomUUID(),
            fact.content,
            contentHash,
            fact.category,
            sessionId ?? null,
            runId ?? null,
            fact.confidence ?? 0.5,
          ],
        );
      } catch (err) {
        logger?.error('MemoryCurator: failed to write fact', { err });
      }
    }

    const userProfileFacts: LearnedFact[] = facts
      .filter((fact) => fact.category === 'user_preference')
      .map((fact) => ({
        value: fact.content,
        source: runId ? `run:${runId}` : sessionId ? `session:${sessionId}` : 'memory_curator',
      }));

    if (userProfileFacts.length > 0) {
      try {
        const userProfileService = new UserProfileService({
          run: async (sql: string, params?: unknown[]) => {
            await this.deps.db.run(sql, params);
          },
          all: async <T = unknown>(sql: string, params?: unknown[]) => this.deps.db.all<T>(sql, params),
        });
        await userProfileService.mergeFacts(DEFAULT_OWNER_KEY, userProfileFacts);
        logger?.info('MemoryCurator: merged user preference facts', { count: userProfileFacts.length });
      } catch (err) {
        logger?.error('MemoryCurator: failed to merge user profile facts', { err });
      }
    }

    logger?.info('MemoryCurator.curate done', { written: facts.length, sessionId, runId });
  }
}

let _instance: MemoryCurator | null = null;
export function getMemoryCurator(deps: MemoryCuratorDeps): MemoryCurator {
  if (!_instance) _instance = new MemoryCurator(deps);
  return _instance;
}
