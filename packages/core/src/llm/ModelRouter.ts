/**
 * ModelRouter — 多模型角色路由（参考 agent-framework.md §8）
 *
 * 支持 7 种 Provider：openai / anthropic / google / ollama /
 *   openai-compatible / anthropic-compatible / openrouter
 *
 * 角色级模型策略：
 *   coordinator   → 强推理模型（claude-sonnet / gpt-4o）
 *   worker        → 高效模型（claude-haiku / gpt-4o-mini）
 *   subagent      → 轻量快速（claude-haiku）
 *   plan          → 强推理（同 coordinator）
 *   verification  → 独立思考（同 coordinator）
 *   compact       → 快速摘要（haiku / mini）
 */

import type { LLMAdapter } from './LLMAdapter.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';

export type ModelProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'openrouter';

export type AgentRole =
  | 'coordinator'
  | 'worker'
  | 'subagent'
  | 'plan'
  | 'verification'
  | 'compact';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  locked?: boolean;
  maxContextTokens?: number;
}

export interface ModelStrategy {
  coordinator: string;
  plan: string;
  worker: string;
  subAgent: string;
  verification: string;
  compactSummary: string;
}

/** 默认模型策略（全部使用 Mock 或用户配置覆盖） */
const DEFAULT_STRATEGY: ModelStrategy = {
  coordinator: 'claude-sonnet-4-20250514',
  plan: 'claude-sonnet-4-20250514',
  worker: 'claude-haiku-4-20250514',
  subAgent: 'claude-haiku-4-20250514',
  verification: 'claude-sonnet-4-20250514',
  compactSummary: 'claude-haiku-4-20250514'
};

export interface ModelRouterOptions {
  /** 主模型配置（来自 /api/models 用户设置） */
  models: ModelConfig[];
  /** 角色 → 模型 ID 的映射（覆盖 DEFAULT_STRATEGY） */
  strategy?: Partial<ModelStrategy>;
  /** 降级：主模型失败后使用的备用模型 ID */
  fallbackModelId?: string;
}

/**
 * ModelRouter — 路由器主类
 *
 * 用法：
 *   const router = new ModelRouter({ models: [...], strategy: { coordinator: 'gpt-4o' } })
 *   const adapter = router.getAdapterForRole('coordinator')  // → LLMAdapter
 *   const modelId  = router.getModelIdForRole('worker')      // → 'claude-haiku-...'
 */
export class ModelRouter {
  private readonly strategy: ModelStrategy;
  private readonly adapterCache = new Map<string, LLMAdapter>();

  constructor(private readonly opts: ModelRouterOptions) {
    this.strategy = { ...DEFAULT_STRATEGY, ...(opts.strategy ?? {}) };
  }

  /** 获取指定角色对应的模型 ID */
  getModelIdForRole(role: AgentRole): string {
    switch (role) {
      case 'coordinator':  return this.strategy.coordinator;
      case 'plan':         return this.strategy.plan;
      case 'worker':       return this.strategy.worker;
      case 'subagent':     return this.strategy.subAgent;
      case 'verification': return this.strategy.verification;
      case 'compact':      return this.strategy.compactSummary;
      default:             return this.strategy.coordinator;
    }
  }

  /** 获取指定角色对应的 LLMAdapter（带缓存） */
  getAdapterForRole(role: AgentRole): LLMAdapter {
    const modelId = this.getModelIdForRole(role);
    return this.getAdapterForModel(modelId);
  }

  /** 根据模型 ID 获取 LLMAdapter */
  getAdapterForModel(modelId: string): LLMAdapter {
    if (this.adapterCache.has(modelId)) {
      return this.adapterCache.get(modelId)!;
    }

    // 查找匹配的模型配置
    const config = this.opts.models.find(
      (m) => m.modelId === modelId || m.id === modelId
    );

    const adapter = this.buildAdapter(config, modelId);
    this.adapterCache.set(modelId, adapter);
    return adapter;
  }

  /** 获取所有已配置的模型列表 */
  listModels(): ModelConfig[] {
    return this.opts.models;
  }

  /** 更新策略配置（运行时切换模型） */
  updateStrategy(partial: Partial<ModelStrategy>): void {
    Object.assign(this.strategy, partial);
    this.adapterCache.clear(); // 清除缓存，下次重新构建
  }

  /** 添加新模型配置 */
  addModel(config: ModelConfig): void {
    const idx = this.opts.models.findIndex((m) => m.id === config.id);
    if (idx >= 0) {
      this.opts.models[idx] = config;
    } else {
      this.opts.models.push(config);
    }
    this.adapterCache.delete(config.modelId);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private buildAdapter(config: ModelConfig | undefined, modelId: string): LLMAdapter {
    if (!config) {
      // 自动推断 provider（无配置时）
      return this.inferAdapter(modelId);
    }

    switch (config.provider) {
      case 'anthropic':
      case 'anthropic-compatible':
        return new AnthropicProvider({
          apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
          baseUrl: config.baseUrl
        });

      case 'openai':
      case 'openai-compatible':
      case 'openrouter':
        return new OpenAIProvider({
          apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? '',
          baseUrl: config.baseUrl ?? (config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined)
        });

      case 'ollama':
        return new OllamaProvider({
          baseUrl: config.baseUrl ?? 'http://127.0.0.1:11434'
        });

      case 'google':
        // Google Gemini — 使用 OpenAI-compatible 端点
        return new OpenAIProvider({
          apiKey: config.apiKey ?? process.env.GOOGLE_API_KEY ?? '',
          baseUrl: config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai'
        });

      default:
        return this.inferAdapter(modelId);
    }
  }

  /** 根据模型 ID 前缀自动推断 Provider */
  private inferAdapter(modelId: string): LLMAdapter {
    if (modelId.startsWith('claude')) {
      return new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY ?? '',
      });
    }
    if (modelId.startsWith('gpt') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
      return new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY ?? ''
      });
    }
    if (modelId.startsWith('gemini')) {
      return new OpenAIProvider({
        apiKey: process.env.GOOGLE_API_KEY ?? '',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai'
      });
    }
    // Fallback: 尝试 Ollama
    return new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
  }
}

/** 创建默认 ModelRouter（读取环境变量） */
export function createDefaultModelRouter(models: ModelConfig[] = []): ModelRouter {
  return new ModelRouter({ models });
}
