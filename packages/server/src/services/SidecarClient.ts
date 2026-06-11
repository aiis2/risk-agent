/**
 * SidecarClient — Python sidecar (FastAPI) HTTP 客户端
 *
 * 路径：services/sidecar-py（独立 venv，端口默认 7531）
 * 提供：
 *  - embed(texts): 批量嵌入（BGE-M3）
 *  - curate(payload): 由 LLM 生成 1-3 条记忆事实/技能改进建议
 *  - healthz(): 探活
 *
 * 全部调用都带超时 + 静默降级。Sidecar 不可用时返回 null/空数组，
 * 调用方应 fallback 到关键词匹配 / 跳过策展。
 */

import type { Logger } from 'pino';

export interface EmbedRequest {
  texts: string[];
  /** 可选：覆盖默认嵌入模型路径 */
  model?: string;
}

export interface EmbedResponse {
  vectors: number[][];
  dim: number;
  model: string;
}

export interface CurateMemoryRequest {
  kind: 'memory_curate';
  /** 本次 run 的对话摘要（user/assistant 配对） */
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 已有的相似事实，用于让 LLM 避免重复 */
  existingFacts?: string[];
  /** 限制返回的事实数 */
  maxFacts?: number;
}

export interface CurateMemoryResponse {
  facts: Array<{
    content: string;
    category: 'domain_knowledge' | 'user_preference' | 'analysis_pattern' | 'risk_template' | 'general';
    confidence: number;
  }>;
}

export interface CurateSkillRequest {
  kind: 'skill_curate';
  skillId: string;
  skillName: string;
  currentMd: string;
  recentRunSummary: string;
}

export interface CurateSkillResponse {
  improvedMd?: string;
  reason?: string;
  confidence?: number;
}

export interface SidecarClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  logger?: Logger | { warn: (msg: string, meta?: unknown) => void; debug?: (msg: string, meta?: unknown) => void };
}

export class SidecarClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: SidecarClientOptions['logger'];
  private healthState: 'unknown' | 'up' | 'down' = 'unknown';
  private lastProbeAt = 0;

  constructor(opts: SidecarClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env['RISK_AGENT_SIDECAR_URL'] ?? 'http://127.0.0.1:7531').replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.logger = opts.logger;
  }

  /** 探活；缓存 30s。 */
  async isHealthy(): Promise<boolean> {
    const now = Date.now();
    if (this.healthState !== 'unknown' && now - this.lastProbeAt < 30_000) {
      return this.healthState === 'up';
    }
    try {
      const r = await this.fetchWithTimeout('/healthz', { method: 'GET' }, 1500);
      this.healthState = r.ok ? 'up' : 'down';
    } catch {
      this.healthState = 'down';
    }
    this.lastProbeAt = now;
    return this.healthState === 'up';
  }

  async embed(req: EmbedRequest): Promise<EmbedResponse | null> {
    if (!(await this.isHealthy())) return null;
    try {
      const r = await this.fetchWithTimeout('/embed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req)
      });
      if (!r.ok) {
        this.logger?.warn?.('sidecar.embed_failed', { status: r.status });
        return null;
      }
      return (await r.json()) as EmbedResponse;
    } catch (err) {
      this.healthState = 'down';
      this.logger?.warn?.('sidecar.embed_error', { error: String((err as Error).message ?? err) });
      return null;
    }
  }

  async curate(req: CurateMemoryRequest | CurateSkillRequest): Promise<CurateMemoryResponse | CurateSkillResponse | null> {
    if (!(await this.isHealthy())) return null;
    try {
      const r = await this.fetchWithTimeout('/curate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req)
      }, 20_000);
      if (!r.ok) {
        this.logger?.warn?.('sidecar.curate_failed', { status: r.status });
        return null;
      }
      return (await r.json()) as CurateMemoryResponse | CurateSkillResponse;
    } catch (err) {
      this.healthState = 'down';
      this.logger?.warn?.('sidecar.curate_error', { error: String((err as Error).message ?? err) });
      return null;
    }
  }

  private async fetchWithTimeout(path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

let _singleton: SidecarClient | null = null;
export function getSidecarClient(): SidecarClient {
  if (!_singleton) _singleton = new SidecarClient();
  return _singleton;
}
