import type { TaskKind, VerificationDecision } from './types.js';

export type GeneralResponseModeHint = 'answer-only' | 'tool-assisted' | 'attachment-grounded' | 'restricted';

export interface CapabilityExecutionHistoryItem {
  round: number;
  kind: TaskKind;
  prompt?: string;
  responseModeHint?: GeneralResponseModeHint;
  summary: string;
  verification: {
    decision: VerificationDecision;
    reasons: string[];
  };
}

export interface CapabilityAdapterBuildInputContext {
  originalInput: Record<string, unknown>;
  delegatedPrompt?: string;
  responseModeHint?: GeneralResponseModeHint;
  history: CapabilityExecutionHistoryItem[];
}

export interface CapabilityAdapter {
  kind: TaskKind;
  description: string;
  buildInput(context: CapabilityAdapterBuildInputContext): Record<string, unknown>;
}

export class CapabilityAdapterRegistry {
  private readonly adapters = new Map<TaskKind, CapabilityAdapter>();

  register(adapter: CapabilityAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  get(kind: TaskKind): CapabilityAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`capability adapter not registered: ${kind}`);
    }
    return adapter;
  }

  has(kind: TaskKind): boolean {
    return this.adapters.has(kind);
  }

  list(): CapabilityAdapter[] {
    return [...this.adapters.values()];
  }
}

class TaskPackCapabilityAdapter implements CapabilityAdapter {
  constructor(
    readonly kind: TaskKind,
    readonly description: string,
    private readonly buildInputFn: (context: CapabilityAdapterBuildInputContext) => Record<string, unknown>,
  ) {}

  buildInput(context: CapabilityAdapterBuildInputContext): Record<string, unknown> {
    return this.buildInputFn(context);
  }
}

export function createGeneralCapabilityAdapter(): CapabilityAdapter {
  return new TaskPackCapabilityAdapter(
    'general',
    'General conversation and synthesis, including tool-assisted browser, web, shell, or MCP work when a tool-assisted hint is provided.',
    ({ originalInput, delegatedPrompt, responseModeHint, history }) => {
      const prompt = delegatedPrompt ?? readPrimaryPrompt(originalInput);
      const guidanceMessages = mergeGuidanceMessages(
        originalInput.guidanceMessages,
        buildHistoryGuidance(history),
      );

      return {
        ...originalInput,
        prompt,
        guidanceMessages,
        ...(responseModeHint ? { responseModeHint, _orchestratorHint: true } : {}),
      };
    },
  );
}

export function createAnalysisCapabilityAdapter(): CapabilityAdapter {
  return new TaskPackCapabilityAdapter(
    'analysis',
    'Risk-analysis workflow for business scenarios, gap detection, and structured report generation.',
    ({ originalInput, delegatedPrompt }) => {
      const businessName = normalizeString(originalInput.businessName)
        || normalizeString(originalInput._rootBusinessName)
        || normalizeString(originalInput._rootPrompt)
        || readPrimaryPrompt(originalInput);
      const guidanceMessages = mergeGuidanceMessages(
        originalInput.guidanceMessages,
        delegatedPrompt && delegatedPrompt !== businessName ? [delegatedPrompt] : [],
      );

      return {
        ...originalInput,
        businessName: businessName || delegatedPrompt || '未命名业务',
        guidanceMessages,
      };
    },
  );
}

export function createKnowledgeQueryCapabilityAdapter(): CapabilityAdapter {
  return new TaskPackCapabilityAdapter(
    'knowledge-query',
    'Structured knowledge lookup across rules, scenarios, and datasource documents.',
    ({ originalInput, delegatedPrompt }) => {
      const query = delegatedPrompt
        ?? (normalizeString(originalInput.query)
          || normalizeString(originalInput._rootQuery)
          || readPrimaryPrompt(originalInput));
      return {
        ...originalInput,
        query,
        prompt: query,
      };
    },
  );
}

export function createSkillManagementCapabilityAdapter(): CapabilityAdapter {
  return new TaskPackCapabilityAdapter(
    'skill-management',
    'Skill, MCP server, and connector inspection, acquisition, and debugging workflows.',
    ({ originalInput, delegatedPrompt }) => ({
      ...originalInput,
      prompt: delegatedPrompt ?? readPrimaryPrompt(originalInput),
    }),
  );
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function readPrimaryPrompt(input: Record<string, unknown>): string {
  return normalizeString(input.prompt) || normalizeString(input.query) || normalizeString(input.businessName);
}

function mergeGuidanceMessages(...sources: unknown[]): string[] {
  const merged = sources.flatMap((source) => normalizeStringArray(source));
  return merged.filter((entry, index) => merged.indexOf(entry) === index);
}

function buildHistoryGuidance(history: CapabilityExecutionHistoryItem[]): string[] {
  return history.slice(-3).map((entry) => {
    const promptSuffix = entry.prompt ? `（任务：${truncate(entry.prompt, 80)}）` : '';
    return `上一步 ${entry.kind}${promptSuffix}：${truncate(entry.summary, 160)}`;
  });
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}