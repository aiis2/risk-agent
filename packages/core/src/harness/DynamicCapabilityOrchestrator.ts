import type { Message } from '../agents/base/types.js';
import type { LLMAdapter } from '../llm/LLMAdapter.js';
import { createLogger } from '../logger.js';
import type { HarnessRuntimeOrchestratedPackResult, HarnessRuntimeOrchestrator, HarnessRuntimeOrchestratorContext } from './HarnessRuntime.js';
import type {
  CapabilityProfile,
  ContinuationDecisionRecord,
  ContinuationStopReasonCode,
  RunArtifact,
  VerificationRecord,
} from './types.js';
import {
  CapabilityAdapterRegistry,
  type CapabilityExecutionHistoryItem,
  type GeneralResponseModeHint,
} from './CapabilityAdapter.js';

const log = createLogger('DynamicCapabilityOrchestrator');

export interface DynamicCapabilityOrchestratorDeps {
  llmAdapter: LLMAdapter;
  model: string;
  adapters: CapabilityAdapterRegistry;
  maxRounds?: number;
}

interface ContinuationDecisionModelOutput {
  decision: 'continue' | 'stop';
  nextCapabilityProfile: CapabilityProfile;
  reason: string;
  delegatedPrompt?: string;
  responseModeHint?: GeneralResponseModeHint;
  stopReasonCode?: ContinuationStopReasonCode;
  source?: ContinuationDecisionRecord['source'];
}

interface CapabilityForcedStop {
  code: ContinuationStopReasonCode;
  reason: string;
  source?: ContinuationDecisionRecord['source'];
}

export class DynamicCapabilityOrchestrator implements HarnessRuntimeOrchestrator {
  private readonly maxRounds: number | null;

  constructor(private readonly deps: DynamicCapabilityOrchestratorDeps) {
    if (deps.maxRounds == null) {
      this.maxRounds = 4;
      return;
    }

    if (deps.maxRounds <= 0) {
      this.maxRounds = null;
      return;
    }

    this.maxRounds = Math.max(1, Math.floor(deps.maxRounds));
  }

  async execute(context: HarnessRuntimeOrchestratorContext) {
    let currentCapability = context.run.currentCapabilityProfile ?? context.run.taskKind;
    const history: CapabilityExecutionHistoryItem[] = [];
    const artifacts: RunArtifact[] = [];
    const verifications: VerificationRecord[] = [];
    let stopped = false;

    for (let round = 1; this.maxRounds == null || round <= this.maxRounds; round += 1) {
      const decision = await this.decideNextStep({
        round,
        currentCapability,
        history,
        input: context.input,
      });

      await context.emit({
        type: 'continuation_decision',
        payload: decisionToPayload(round, currentCapability, decision) as unknown as Record<string, unknown>,
      });

      if (decision.decision === 'stop') {
        stopped = true;
        break;
      }

      if (decision.nextCapabilityProfile !== currentCapability) {
        await context.switchCapability(decision.nextCapabilityProfile, {
          reason: decision.reason,
          source: decision.source,
        });
        currentCapability = decision.nextCapabilityProfile;
      }

      const adapter = this.deps.adapters.get(currentCapability);
      const packInput = adapter.buildInput({
        originalInput: context.input,
        delegatedPrompt: decision.delegatedPrompt,
        responseModeHint: decision.responseModeHint,
        history,
      });
      const packResult = await context.executePack(currentCapability, packInput);

      artifacts.push(...packResult.artifacts);
      verifications.push(packResult.verification);
      history.push({
        round,
        kind: currentCapability,
        prompt: readPrimaryPrompt(packInput),
        responseModeHint: decision.responseModeHint,
        summary: summarizePackResult(packResult),
        verification: {
          decision: packResult.verification.decision,
          reasons: [...packResult.verification.reasons],
        },
      });

      const forcedStop = readForcedStop(packResult.result);
      if (forcedStop) {
        stopped = true;
        await context.emit({
          type: 'continuation_decision',
          payload: {
            round: round + 1,
            decision: 'stop',
            currentCapabilityProfile: currentCapability,
            nextCapabilityProfile: currentCapability,
            stopReasonCode: forcedStop.code,
            reason: forcedStop.reason,
            source: forcedStop.source ?? 'system',
          } as Record<string, unknown>,
        });
        break;
      }

      if (packResult.verification.decision === 'fail') {
        stopped = true;
        await context.emit({
          type: 'continuation_decision',
          payload: {
            round,
            decision: 'stop',
            currentCapabilityProfile: currentCapability,
            nextCapabilityProfile: currentCapability,
            stopReasonCode: 'verification_failed',
            reason: '当前能力执行未通过验证，停止继续编排。',
            source: 'system',
          },
        });
        break;
      }
    }

    if (!stopped && this.maxRounds != null) {
      await context.emit({
        type: 'continuation_decision',
        payload: {
          round: history.length + 1,
          decision: 'stop',
          currentCapabilityProfile: currentCapability,
          nextCapabilityProfile: currentCapability,
          stopReasonCode: 'max_rounds',
          reason: `达到最大连续编排轮次 ${this.maxRounds}，停止继续。`,
          source: 'system',
        },
      });
    }

    return {
      artifacts,
      verification: aggregateVerification(
        context.run.runId,
        verifications,
        context.run.updatedAt || context.run.createdAt,
        !stopped && this.maxRounds != null,
      ),
    };
  }

  private async decideNextStep(args: {
    round: number;
    currentCapability: CapabilityProfile;
    history: CapabilityExecutionHistoryItem[];
    input: Record<string, unknown>;
  }): Promise<ContinuationDecisionModelOutput> {
    const systemPrompt = buildDecisionSystemPrompt(this.deps.adapters);
    const userMessage = buildDecisionUserMessage(args, this.deps.adapters);

    try {
      const result = await this.deps.llmAdapter.call({
        model: this.deps.model,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }] as Message[],
        temperature: 0,
        maxTokens: 400,
        enableThinking: false,
      });
      const parsed = parseDecisionOutput(result.text, this.deps.adapters, args.currentCapability);
      if (parsed) {
        return normalizeDecision(parsed, args.currentCapability, args.input, args.history.length === 0);
      }
      log.warn({ output: result.text, round: args.round }, 'Failed to parse continuation decision, using fallback');
    } catch (error) {
      log.warn({ error, round: args.round }, 'Continuation decision model call failed, using fallback');
    }

    return buildFallbackDecision(args.currentCapability, args.input, args.history.length === 0);
  }
}

function buildDecisionSystemPrompt(adapters: CapabilityAdapterRegistry): string {
  const capabilityLines = adapters.list().map((adapter) => `- ${adapter.kind}: ${adapter.description}`);
  return [
    'You are the continuation controller for a multi-capability orchestration loop.',
    'Decide whether the run should continue with another capability step or stop now.',
    'When continuing, pick the single best next capability profile and explain why.',
    'Only return JSON. No markdown. No prose outside JSON.',
    'JSON schema:',
    '{"decision":"continue|stop","nextCapabilityProfile":"analysis|general|knowledge-query|skill-management","reason":"string","delegatedPrompt":"optional string","responseModeHint":"optional answer-only|tool-assisted|attachment-grounded|restricted"}',
    'Capabilities:',
    ...capabilityLines,
    'Guidelines:',
    '- Round 1 must continue so the run executes at least one capability.',
    '- Infer the next capability from the full latest user request instead of keyword routing.',
    '- Use responseModeHint only when the next capability is general and you want to bias it toward tool use or direct response.',
    '- For simple conversational inputs (math calculations, greetings, brief questions, or anything that does not require querying data/files/web), always use responseModeHint="answer-only". NEVER use "tool-assisted" for trivial prompts.',
    '- Only use responseModeHint="tool-assisted" when the prompt explicitly requires searching, browsing, file access, querying system data, or running commands.',
    '- For follow-up turns, prioritize the latest user request in initialInput.prompt over historical business labels from earlier turns.',
    '- If the latest user request explicitly rejects a capability or data source, do not choose it unless the user changes direction.',
    '- If the latest user request asks to open a URL, inspect a page, capture screenshots, or keep using the browser, prefer the general capability with responseModeHint="tool-assisted" over knowledge-query.',
    '- Use knowledge-query only for actual internal knowledge-base retrieval across rules, scenarios, entities, or stored documents. Do not use knowledge-query as a substitute for browser or page inspection work.',
    '- Stop when the user intent is satisfied or the latest capability already produced the final deliverable.',
  ].join('\n');
}

function buildDecisionUserMessage(
  args: {
    round: number;
    currentCapability: CapabilityProfile;
    history: CapabilityExecutionHistoryItem[];
    input: Record<string, unknown>;
  },
  adapters: CapabilityAdapterRegistry,
): string {
  const payload = {
    round: args.round,
    currentCapabilityProfile: args.currentCapability,
    initialInput: summarizeInput(args.input),
    completedSteps: args.history.map((entry) => ({
      round: entry.round,
      capability: entry.kind,
      prompt: entry.prompt,
      responseModeHint: entry.responseModeHint,
      summary: entry.summary,
      verification: entry.verification,
    })),
    availableCapabilities: adapters.list().map((adapter) => ({
      kind: adapter.kind,
      description: adapter.description,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

function summarizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const turnEnvelope = asRecord(input.turnEnvelope);
  if (turnEnvelope) {
    const toolIds = Array.isArray(turnEnvelope.toolIds)
      ? normalizeStringArray(turnEnvelope.toolIds)
      : normalizeStringArray(input.toolIds);
    const attachmentIds = Array.isArray(turnEnvelope.attachmentIds)
      ? turnEnvelope.attachmentIds
      : input.attachmentIds;

    return {
      prompt: normalizeString(turnEnvelope.userMessage) || readPrimaryPrompt(input),
      toolIds,
      attachmentCount: Array.isArray(attachmentIds) ? attachmentIds.length : 0,
      approvalMode: normalizeString(turnEnvelope.approvalMode) || normalizeString(input.approvalMode),
      priorTaskKind: normalizeString(turnEnvelope.priorTaskKind),
      priorCapabilityProfile: normalizeString(turnEnvelope.priorCapabilityProfile),
    };
  }

  return {
    prompt: readPrimaryPrompt(input),
    query: normalizeString(input.query),
    businessName: normalizeString(input.businessName),
    toolIds: normalizeStringArray(input.toolIds),
    attachmentCount: Array.isArray(input.attachmentIds) ? input.attachmentIds.length : 0,
    approvalMode: normalizeString(input.approvalMode),
  };
}

function parseDecisionOutput(
  text: string,
  adapters: CapabilityAdapterRegistry,
  currentCapability: CapabilityProfile,
): Partial<ContinuationDecisionModelOutput> | undefined {
  const object = parseJsonObject(text);
  if (!object) return undefined;

  const nextCapabilityProfile = normalizeCapabilityProfile(object.nextCapabilityProfile, adapters, currentCapability);
  const reason = normalizeString(object.reason);
  const decision = normalizeDecisionLabel(object.decision);
  if (!decision || !reason) return undefined;

  return {
    decision,
    nextCapabilityProfile,
    reason,
    delegatedPrompt: normalizeOptionalString(object.delegatedPrompt),
    responseModeHint: normalizeResponseModeHint(object.responseModeHint),
    stopReasonCode: normalizeStopReasonCode(object.stopReasonCode),
    source: 'model',
  };
}

function normalizeDecision(
  decision: Partial<ContinuationDecisionModelOutput>,
  currentCapability: CapabilityProfile,
  input: Record<string, unknown>,
  isFirstRound: boolean,
): ContinuationDecisionModelOutput {
  const normalized: ContinuationDecisionModelOutput = {
    decision: decision.decision === 'stop' ? 'stop' : 'continue',
    nextCapabilityProfile: decision.nextCapabilityProfile ?? currentCapability,
    reason: decision.reason ?? '继续当前能力执行。',
    delegatedPrompt: normalizeOptionalString(decision.delegatedPrompt),
    responseModeHint: normalizeResponseModeHint(decision.responseModeHint),
    stopReasonCode: normalizeStopReasonCode(decision.stopReasonCode),
    source: decision.source ?? 'model',
  };

  if (isFirstRound && normalized.decision === 'stop') {
    return {
      decision: 'continue',
      nextCapabilityProfile: currentCapability,
      reason: '首轮至少需要执行一个能力步骤，因此继续当前决策。',
      delegatedPrompt: normalized.delegatedPrompt ?? readPrimaryPrompt(input),
      responseModeHint: normalized.responseModeHint,
      source: 'system',
    };
  }

  if (normalized.decision === 'continue' && !normalized.delegatedPrompt) {
    normalized.delegatedPrompt = readPrimaryPrompt(input);
  }

  if (normalized.decision === 'stop' && !normalized.stopReasonCode) {
    normalized.stopReasonCode = normalized.source === 'model' ? 'model_complete' : 'system_fallback';
  }

  return normalized;
}

function buildFallbackDecision(
  currentCapability: CapabilityProfile,
  input: Record<string, unknown>,
  isFirstRound: boolean,
): ContinuationDecisionModelOutput {
  if (isFirstRound) {
    return {
      decision: 'continue',
      nextCapabilityProfile: currentCapability,
      reason: '决策模型未返回有效结构化结果，先继续当前能力执行一轮。',
      delegatedPrompt: readPrimaryPrompt(input),
      source: 'system',
    };
  }

  return {
    decision: 'stop',
    nextCapabilityProfile: currentCapability,
    stopReasonCode: 'system_fallback',
    reason: '决策模型未返回有效结构化结果，已基于现有结果停止继续。',
    source: 'system',
  };
}

function decisionToPayload(
  round: number,
  currentCapability: CapabilityProfile,
  decision: ContinuationDecisionModelOutput,
): ContinuationDecisionRecord {
  return {
    round,
    decision: decision.decision,
    currentCapabilityProfile: currentCapability,
    nextCapabilityProfile: decision.nextCapabilityProfile,
    stopReasonCode: decision.stopReasonCode,
    reason: decision.reason,
    delegatedPrompt: decision.delegatedPrompt,
    responseModeHint: decision.responseModeHint,
    source: decision.source,
  };
}

function readForcedStop(result: unknown): CapabilityForcedStop | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const continuationStop = (result as { continuationStop?: unknown }).continuationStop;
  if (!continuationStop || typeof continuationStop !== 'object') {
    return undefined;
  }

  const code = normalizeStopReasonCode((continuationStop as { code?: unknown }).code);
  const reason = normalizeString((continuationStop as { reason?: unknown }).reason);
  const source = normalizeDecisionSource((continuationStop as { source?: unknown }).source);
  if (!code || !reason) {
    return undefined;
  }

  return { code, reason, source };
}

function summarizePackResult(result: HarnessRuntimeOrchestratedPackResult): string {
  for (const artifact of result.artifacts) {
    const preview = summarizeArtifact(artifact);
    if (preview) return preview;
  }

  if (result.verification.reasons.length > 0) {
    return result.verification.reasons.join(' · ');
  }

  return `${result.kind} completed`;
}

function summarizeArtifact(artifact: RunArtifact): string | undefined {
  if (artifact.contentText) {
    return truncate(artifact.contentText, 220);
  }

  if (!artifact.contentJson) {
    return undefined;
  }

  const preferredKeys = ['response', 'summary', 'message', 'title'] as const;
  for (const key of preferredKeys) {
    const value = artifact.contentJson[key];
    if (typeof value === 'string' && value.trim()) {
      return truncate(value, 220);
    }
  }

  try {
    return truncate(JSON.stringify(artifact.contentJson), 220);
  } catch {
    return undefined;
  }
}

function aggregateVerification(
  runId: string,
  verifications: VerificationRecord[],
  createdAt: string,
  maxRoundsReached: boolean,
): VerificationRecord {
  if (verifications.length === 0) {
    return {
      verificationId: `ver_${runId}_dynamic_orchestrator`,
      runId,
      verifierType: 'contract',
      contractVersion: 'dynamic-orchestrator.phase1',
      decision: 'fail',
      reasons: ['no_capability_executed'],
      followUpAction: 'fail_run',
      createdAt,
    };
  }

  const decision = verifications.some((entry) => entry.decision === 'fail')
    ? 'fail'
    : verifications.some((entry) => entry.decision === 'warn')
      ? 'warn'
      : 'pass';
  const reasons = verifications.flatMap((entry) => entry.reasons);
  if (maxRoundsReached) {
    reasons.push('orchestrator_max_rounds_reached');
  }

  return {
    verificationId: `ver_${runId}_dynamic_orchestrator`,
    runId,
    verifierType: 'contract',
    contractVersion: 'dynamic-orchestrator.phase1',
    decision,
    reasons: dedupe(reasons),
    followUpAction: decision === 'fail' ? 'fail_run' : 'none',
    createdAt,
  };
}

function normalizeCapabilityProfile(
  value: unknown,
  adapters: CapabilityAdapterRegistry,
  fallback: CapabilityProfile,
): CapabilityProfile {
  if (value === 'analysis' || value === 'general' || value === 'knowledge-query' || value === 'skill-management') {
    return adapters.has(value) ? value : fallback;
  }
  return fallback;
}

function normalizeDecisionLabel(value: unknown): ContinuationDecisionModelOutput['decision'] | undefined {
  return value === 'continue' || value === 'stop' ? value : undefined;
}

function normalizeResponseModeHint(value: unknown): GeneralResponseModeHint | undefined {
  return value === 'answer-only' || value === 'tool-assisted' || value === 'attachment-grounded' || value === 'restricted'
    ? value
    : undefined;
}

function normalizeStopReasonCode(value: unknown): ContinuationStopReasonCode | undefined {
  return value === 'model_complete'
    || value === 'budget'
    || value === 'approval'
    || value === 'system_fallback'
    || value === 'verification_failed'
    || value === 'max_rounds'
    ? value
    : undefined;
}

function normalizeDecisionSource(value: unknown): ContinuationDecisionRecord['source'] | undefined {
  return value === 'model' || value === 'system' || value === 'user' ? value : undefined;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeString(entry)).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readPrimaryPrompt(input: Record<string, unknown>): string {
  return normalizeString(input.prompt) || normalizeString(input.query) || normalizeString(input.businessName);
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.replace(/^```json\s*/iu, '').replace(/^```\s*/iu, '').replace(/```$/u, '').trim();
  const direct = tryParseJson(normalized);
  if (direct) return direct;

  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  return tryParseJson(normalized.slice(start, end + 1));
}

function tryParseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function dedupe(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`;
}