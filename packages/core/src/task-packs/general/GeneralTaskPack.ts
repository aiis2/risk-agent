import type {
  ContinuationStopReasonCode,
  TaskPack,
  TaskPackContext,
  RunEvent,
  RunArtifact,
  VerificationRecord,
} from '../../harness/types.js';
import { buildSkillProposal } from '../skills/SkillProposal.js';
import { ConversationalResponder, type ConversationalContext, type ConversationalResponse } from './ConversationalResponder.js';
import type { LLMAdapter } from '../../llm/LLMAdapter.js';
import type { Persona } from '../../persona/PersonaService.js';
import type { UserProfile } from '../../userProfile/UserProfileService.js';
import type { QueryEngine } from '../../query/QueryEngine.js';
import { createLogger } from '../../logger.js';

const log = createLogger('GeneralTaskPack');
// Triggers tool-assisted ReAct path when the prompt clearly requires real-time data,
// web search, browser automation, URL analysis, or tool invocation. Covers:
//   • Explicit search keywords ("联网搜索", "web search", …)
//   • Settings read/write (for configuring the web-search API key, etc.)
//   • Search + information-type pairs: "搜索/查/帮我搜 + 新闻/天气/价格/热点/…"
//   • Real-time / today + information-type pairs: "今天/实时/最新 + 天气/新闻/行情/…"
//   • Browser/playwright automation (playwright, puppeteer, 打开/访问/分析网页, etc.)
//   • Any URL in the prompt (https?://) — likely expects the agent to fetch/analyse it
const TOOL_ASSISTED_PROMPT_PATTERN = /联网搜索|web search|search the web|search web|online search|测试搜索可用性|验证搜索|(?:读取|查看|检查|配置|设置|修改|read|get|show|update|set).{0,24}(?:settings|设置|配置|api key|apikey|密钥|tavily|web search)|(?:搜索|查一下|帮我搜|search).{0,40}(?:新闻|天气|资讯|最新|热点|动态|价格|股价|汇率|行情)|(?:今天|今日|当前|实时|最新).{0,20}(?:天气|新闻|资讯|热点|行情|动态)|playwright|puppeteer|(?:分析|抓取|提取|爬取|截图|访问|打开|浏览|读取).{0,20}(?:网页|页面|链接|url)|https?:\/\/[^\s]+/i;
// CLI 命令执行模式：触发 tool-assisted ReAct 路径并使用 shell_exec 工具
const CLI_COMMAND_PATTERN = /(?:^|\s)(?:npx|npm|pnpm|yarn|node|python|pip|git|curl|wget|bash|sh|cmd)\s/i;
const SKILLS_INSTALL_PATTERN = /skills?\s+add\b|--skill\b/i;

/**
 * GeneralTaskPack 的可选运行期依赖（A6，2026-04-29）。
 *
 * 当注入了 llmAdapter + 任一上下文 provider（persona/userProfile/memory/transcript）时，
 * execute() 走 ConversationalResponder 路径生成上下文化回复。否则退化到旧模板，
 * 保证既有测试 / 单纯回归路径不受影响。
 *
 * 当注入了 createQueryEngine 且 toolIds.length > 0 时，execute() 走 tool-assisted ReAct 路径，
 * 使 GeneralTaskPack 具备完整的 MCP/工具调用能力（例如 Playwright 浏览器截图）。
 */
export interface GeneralTaskPackDeps {
  llmAdapter?: LLMAdapter;
  model?: string;
  resolvePersona?: (ctx: TaskPackContext) => Promise<Persona | undefined> | Persona | undefined;
  resolveUserProfile?: (ctx: TaskPackContext) => Promise<UserProfile | undefined> | UserProfile | undefined;
  resolveMemorySnippets?: (ctx: TaskPackContext, prompt: string) => Promise<string[]> | string[];
  resolveRecentTranscript?: (
    ctx: TaskPackContext,
  ) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>> | Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * 工厂：为 tool-assisted 模式创建新 QueryEngine 实例（每次 run 独立实例）。
   * 注入后当 toolIds.length > 0 时，execute() 会切换到 ReAct 工具调用路径。
   */
  createQueryEngine?: (opts: { runId: string; toolIds: string[] }) => QueryEngine;
}

interface GeneralCapabilities {
  fileAnalysis: boolean;
  webResearch: boolean;
  dataLookup: boolean;
  skillDiscovery: boolean;
  humanConfirmation: boolean;
}

type GeneralResponseMode = 'answer-only' | 'tool-assisted' | 'attachment-grounded' | 'restricted';
type GeneralResponseModeHintSource = 'default' | 'heuristic' | 'explicit' | 'attachment';

interface GeneralPlan {
  prompt: string;
  guidanceMessages: string[];
  attachmentIds: string[];
  attachmentContext?: string;
  toolIds: string[];
  capabilities: GeneralCapabilities;
  responseModeHint: GeneralResponseMode;
  responseModeHintSource: GeneralResponseModeHintSource;
  responseModeLocked: false;
  notes: string[];
}

interface GeneralResult extends GeneralPlan {
  responseMode: GeneralResponseMode;
  continuationStop?: GeneralContinuationStop;
  response: string;
  evidence: string[];
  suggestedNextActions: string[];
}

interface GeneralContinuationStop {
  code: ContinuationStopReasonCode;
  reason: string;
  source?: 'model' | 'system' | 'user';
}

interface ToolAssistedExecutionResult {
  responseText?: string;
  continuationStop?: GeneralContinuationStop;
}

interface ConversationalAttemptResult {
  response?: ConversationalResponse;
  failed: boolean;
}

export class GeneralTaskPack implements TaskPack<Record<string, unknown>, GeneralPlan, GeneralResult> {
  readonly kind = 'general' as const;
  readonly contractVersion = 'general.phase2';

  constructor(private readonly deps: GeneralTaskPackDeps = {}) {}

  readonly inputSchema = {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      guidanceMessages: {
        type: 'array',
        items: { type: 'string' },
      },
      attachmentIds: {
        type: 'array',
        items: { type: 'string' },
      },
      attachmentContext: { type: 'string' },
      toolIds: {
        type: 'array',
        items: { type: 'string' },
      },
      responseModeHint: { type: 'string' },
      _orchestratorHint: { type: 'boolean' },
    },
  };

  async intake(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      prompt: normalizeString(input.prompt),
      guidanceMessages: normalizeStringArray(input.guidanceMessages),
      attachmentIds: normalizeStringArray(input.attachmentIds),
      attachmentContext: normalizeOptionalString(input.attachmentContext),
      toolIds: normalizeStringArray(input.toolIds),
      responseModeHint: normalizeOptionalResponseModeHint(input.responseModeHint),
      _orchestratorHint: input._orchestratorHint === true,
    };
  }

  async plan(input: Record<string, unknown>): Promise<GeneralPlan> {
    const prompt = normalizeString(input.prompt);
    const attachmentContext = normalizeOptionalString(input.attachmentContext);
    const toolIds = normalizeStringArray(input.toolIds);
    const explicitResponseModeHint = normalizeOptionalResponseModeHint(input.responseModeHint);
    const capabilities = resolveCapabilities(toolIds);
    const notes: string[] = [];
    let responseModeHint: GeneralPlan['responseModeHint'] = 'answer-only';
    let responseModeHintSource: GeneralPlan['responseModeHintSource'] = 'default';

    if (attachmentContext && capabilities.fileAnalysis) {
      responseModeHint = 'attachment-grounded';
      responseModeHintSource = 'attachment';
    } else if (attachmentContext) {
      responseModeHint = 'restricted';
      responseModeHintSource = 'attachment';
      notes.push('已提供附件，但未启用文件解析工具，当前不会把附件摘要作为证据纳入结果。');
    } else if (toolIds.length > 0 || explicitResponseModeHint === 'tool-assisted') {
      // Safety gate: when the hint comes from the orchestrator (not a direct caller),
      // only honour `tool-assisted` if the prompt content actually warrants tool use
      // OR if specific tools were explicitly selected.
      // Without this guard the DynamicCapabilityOrchestrator can incorrectly route
      // simple conversational queries (e.g. "2+3") to the full tool-assisted ReAct path.
      const isOrchestratorHint = Boolean(input._orchestratorHint);
      const promptWarrantsTools = warrantsToolAssistedPrompt(prompt);
      if (toolIds.length > 0 || !isOrchestratorHint || promptWarrantsTools) {
        responseModeHint = 'tool-assisted';
        responseModeHintSource = 'explicit';
      }
      // else: orchestrator suggested tool-assisted but prompt is simple → fallthrough to 'answer-only'
    } else if (explicitResponseModeHint) {
      responseModeHint = explicitResponseModeHint;
      responseModeHintSource = 'explicit';
    } else if (warrantsToolAssistedPrompt(prompt)) {
      // Keep browser/web/CLI detection as an advisory hint.
      // The dynamic orchestrator may promote it into an explicit tool-assisted step.
      responseModeHint = 'tool-assisted';
      responseModeHintSource = 'heuristic';
    }

    return {
      prompt,
      guidanceMessages: normalizeStringArray(input.guidanceMessages),
      attachmentIds: normalizeStringArray(input.attachmentIds),
      attachmentContext,
      toolIds,
      capabilities,
      responseModeHint,
      responseModeHintSource,
      responseModeLocked: false,
      notes,
    };
  }

  async *execute(plan: GeneralPlan, ctx: TaskPackContext): AsyncGenerator<RunEvent, GeneralResult> {
    await ctx.emit({
      type: 'general_response_started',
      payload: {
        responseMode: plan.responseModeHint,
        responseModeHint: plan.responseModeHint,
        responseModeLocked: plan.responseModeLocked,
        toolIds: plan.toolIds,
        attachmentCount: plan.attachmentIds.length,
      },
    });

    const evidence = plan.capabilities.fileAnalysis
      ? extractAttachmentEvidence(plan.attachmentContext)
      : [];
    const guidance = plan.guidanceMessages.at(-1);
    const activePrompt = resolveActivePrompt(plan);
    const effectiveGuidance = guidance === activePrompt ? undefined : guidance;

    if (activePrompt !== plan.prompt) {
      log.debug(
        {
          runId: ctx.run.runId,
          originalPrompt: plan.prompt,
          activePrompt,
          guidanceCount: plan.guidanceMessages.length,
          responseModeHint: plan.responseModeHint,
        },
        'GeneralTaskPack using latest follow-up prompt',
      );
    }

    // Detect greeting intent → return a self-introduction
    const isGreeting = GREETING_PATTERN.test(activePrompt.trim());

    let response: string;
    let suggestedNextActions: string[];
    let responseMode = resolveFinalResponseMode(plan, false);
    let continuationStop: GeneralContinuationStop | undefined;

    // Tool-assisted ReAct path: when toolIds are provided and a factory is available,
    // delegate to a full QueryEngine loop instead of conversational response.
    // Skip for greetings — those should stay fast/conversational.
    const shouldTryToolAssisted = this.deps.createQueryEngine
      && !isGreeting
      && (
        plan.toolIds.length > 0
        || plan.responseModeHintSource === 'explicit'
        || (plan.responseModeHintSource === 'heuristic' && warrantsToolAssistedPrompt(activePrompt))
      );
    if (shouldTryToolAssisted) {
      const toolResponse = await this.runToolAssisted(activePrompt, plan, ctx);
      if (toolResponse !== undefined) {
        response = toolResponse.responseText ?? buildContinuationStopResponse(toolResponse.continuationStop);
        suggestedNextActions = [];
        responseMode = 'tool-assisted';
        continuationStop = toolResponse.continuationStop;

        const result: GeneralResult = {
          ...plan,
          prompt: activePrompt,
          responseMode,
          continuationStop,
          response,
          evidence,
          suggestedNextActions,
        };

        await ctx.createSemanticCheckpoint('general-response-ready', {
          responseMode: result.responseMode,
          evidenceCount: result.evidence.length,
          toolIds: result.toolIds,
        });

        return result;
      }
    }

    // A6：尝试用 ConversationalResponder 生成上下文化回复（注入了 llmAdapter 才生效）
    const conversationalAttempt = await this.tryConversationalRespond(activePrompt, plan, evidence, ctx);
    const llmResponse = conversationalAttempt.response;

    if (llmResponse) {
      const estimatedTokens = llmResponse.usage.inputTokens + llmResponse.usage.outputTokens;
      await ctx.emit({
        type: 'turn_info',
        payload: {
          current: 1,
          max: 1,
          estimatedTokens,
        },
      });
      await ctx.emit({
        type: 'cost_update',
        payload: {
          inputTokens: llmResponse.usage.inputTokens,
          outputTokens: llmResponse.usage.outputTokens,
          cachedTokens: llmResponse.usage.cachedTokens,
          cacheCreationTokens: llmResponse.usage.cacheCreationTokens ?? 0,
          estimatedUsd: llmResponse.usage.estimatedUsd,
        },
      });
    }

    // Detect ambiguous/unclear intent only when LLM is also unavailable
    // (if LLM responded, no need to show the clarification picker)
    const isAmbiguous = !isGreeting
      && !llmResponse
      && !conversationalAttempt.failed
      && activePrompt.trim().length > 0
      && isAmbiguousPrompt(activePrompt);

    if (isGreeting) {
      response = llmResponse?.text ?? buildGreetingResponse(activePrompt);
      suggestedNextActions = [
        '描述业务场景进行分析：告知企业名称与核心场景即可开始',
        '查询知识库：输入关键词检索规则、案例、监管政策',
        '直接提问：任何领域的问题均可',
        '查看可用指令：输入 /help',
      ];
    } else if (isAmbiguous) {
      // AG2U: ask user to clarify intent via structured options
      await ctx.emit({ type: 'agent_status', payload: { message: '意图识别中，准备向您确认需求方向...' } });

      const answer = await ctx.requestUserInput({
        question: `您的请求「${activePrompt.slice(0, 60)}${activePrompt.length > 60 ? '…' : ''}」可以用几种方式处理，请选择您希望的方向：`,
        options: [
          '风控分析 — 生成专业风险评估报告',
          '知识检索 — 在知识库中查找相关信息',
          '技能管理 — 查看或配置系统技能',
          '直接回答 — 当作通用问题回答',
        ],
      });

      const chosenOption = typeof answer.option === 'string' ? answer.option : '';
      const chosenIndex = typeof answer.index === 'number' ? answer.index : -1;

      if (chosenIndex === 0 || chosenOption.includes('风控分析')) {
        response = `收到！将为您进行风控分析。\n\n原始请求：${activePrompt}\n\n请补充以下信息以开始分析：\n- 企业/业务名称\n- 核心业务场景描述\n- 关注的主要风险维度（可选）`;
        suggestedNextActions = ['提供业务名称和场景描述后即可启动风控分析'];
      } else if (chosenIndex === 1 || chosenOption.includes('知识检索')) {
        response = `好的！将在知识库中检索相关信息。\n\n检索主题：${activePrompt}`;
        suggestedNextActions = ['知识检索已就绪，请告知具体检索主题'];
      } else if (chosenIndex === 2 || chosenOption.includes('技能管理')) {
        response = `好的！将为您展示当前系统技能。\n\n您可以通过技能管理界面查看、启用或禁用系统能力。`;
        suggestedNextActions = ['访问技能管理页面查看详细技能列表'];
      } else {
        // Default: general answer
        response = buildGeneralResponse(activePrompt, effectiveGuidance, evidence);
        suggestedNextActions = buildSuggestedNextActions(plan, evidence.length > 0);
      }
    } else {
      // Regular general response
      response = llmResponse?.text ?? buildGeneralResponse(activePrompt, effectiveGuidance, evidence);
      suggestedNextActions = buildSuggestedNextActions(plan, evidence.length > 0);
    }

    const result: GeneralResult = {
      ...plan,
      prompt: activePrompt,
      responseMode,
      continuationStop,
      response,
      evidence,
      suggestedNextActions,
    };

    await ctx.createSemanticCheckpoint('general-response-ready', {
      responseMode: result.responseMode,
      evidenceCount: result.evidence.length,
      toolIds: result.toolIds,
    });

    return result;
  }

  /**
   * Tool-assisted ReAct path: creates a fresh QueryEngine and runs a full tool-call loop.
   * Returns the accumulated LLM response text, or undefined on failure (falls back to
   * ConversationalResponder).
   */
  private async runToolAssisted(
    activePrompt: string,
    plan: GeneralPlan,
    ctx: TaskPackContext,
  ): Promise<ToolAssistedExecutionResult | undefined> {
    const factory = this.deps.createQueryEngine;
    if (!factory) return undefined;

    // Detect if this is a CLI execution request; if so, inject a guidance hint so
    // the LLM reliably picks up shell_exec and passes the right flags.
    const isCliRequest = CLI_COMMAND_PATTERN.test(activePrompt) || SKILLS_INSTALL_PATTERN.test(activePrompt);
    const systemHint = isCliRequest
      ? [
          'You have access to a `shell_exec` tool that runs arbitrary shell commands.',
          'When the user asks you to run a command or install something via CLI:',
          '1. Use the `shell_exec` tool directly — do NOT just describe the steps.',
          '2. For `npx skills add` or any interactive CLI installer, ALWAYS add:',
          '   - `--yes` flag on `npx` (e.g. `npx --yes skills add …`)',
          '   - environment variable `CI=true` in the env parameter',
          '   This ensures all interactive prompts are auto-accepted.',
          '3. Set `cwd` to the project workspace root.',
          '4. Report the command output (stdout/stderr) to the user when done.',
        ].join('\n')
      : undefined;

    try {
      const engine = factory({ runId: ctx.run.runId, toolIds: plan.toolIds });
      let responseText = '';
      let continuationStop: GeneralContinuationStop | undefined;

      // Read approvalMode from run input (set by the frontend approval mode selector).
      // Also check turnEnvelope.approvalMode so follow-up turns with a changed mode take effect.
      const turnEnvelope = (ctx.run.input as Record<string, unknown>)?.turnEnvelope as Record<string, unknown> | undefined;
      const rawApprovalMode = typeof turnEnvelope?.approvalMode === 'string'
        ? turnEnvelope.approvalMode
        : typeof (ctx.run.input as Record<string, unknown>)?.approvalMode === 'string'
          ? (ctx.run.input as Record<string, unknown>).approvalMode as string
          : 'default';
      const approvalMode = (rawApprovalMode === 'bypass' || rawApprovalMode === 'autopilot')
        ? rawApprovalMode
        : 'default' as const;

      // Session-level "approve all" flag — when user selects "当前会话都批准", all subsequent
      // tool approval prompts within this run are auto-approved without asking the user again.
      let sessionApproveAll = false;

      for await (const event of engine.submitMessage(activePrompt, {
        signal: ctx.signal,
        systemHint,
        approvalMode,
        askUserResolver: async (question, options) => {
          // If the user previously chose "approve all for this session", skip the prompt.
          if (sessionApproveAll) return '批准';

          // Extend the presented options with a session-wide approve option when the prompt
          // is a standard tool-approval request (options include '批准' and '拒绝').
          const isToolApproval = options != null && options.includes('批准') && options.includes('拒绝');
          const extendedOptions = isToolApproval
            ? ['批准', '当前会话都批准', '拒绝']
            : options;

          const answer = await ctx.requestUserInput({
            question,
            options: extendedOptions,
            checkpoint: {
              action: 'tool-approval',
              targetSkill: 'query-engine',
              changeType: 'tool-execution',
            },
          });
          const result = typeof answer.option === 'string'
            ? answer.option
            : typeof answer.input === 'string'
              ? answer.input
              : '';

          // Handle session-level approval: set flag and return '批准' for the current request.
          if (result === '当前会话都批准') {
            sessionApproveAll = true;
            return '批准';
          }

          return result;
        },
      })) {
        // Accumulate final text from delta events
        if (event.type === 'text_delta' && 'text' in event && typeof event.text === 'string') {
          responseText += event.text;
        }
        if (event.type === 'query_stopped' && 'reason' in event && typeof event.reason === 'string') {
          continuationStop = mapQueryStopToContinuationStop(event.reason);
        }
        if (event.type === 'tool_error' && 'error' in event && typeof event.error === 'string') {
          const approvalStop = mapToolErrorToContinuationStop(event.error);
          if (approvalStop) {
            continuationStop = approvalStop;
          }
        }
        // Forward key events to the run event stream for activity lane / CLI rendering
        if (
          event.type === 'tool_start' ||
          event.type === 'tool_complete' ||
          event.type === 'tool_error' ||
          event.type === 'tool_progress' ||
          event.type === 'text_delta' ||
          event.type === 'text_complete' ||
          event.type === 'turn_info' ||
          event.type === 'agent_status' ||
          event.type === 'query_stopped'
        ) {
          await ctx.emit({ type: event.type, payload: event as unknown as Record<string, unknown> }).catch(() => undefined);
        }
      }

      if (!responseText && !continuationStop) {
        return undefined;
      }

      return {
        responseText: responseText || undefined,
        continuationStop,
      };
    } catch (err) {
      // Log the error for debugging, then fall back to conversational path
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err, runId: ctx.run.runId }, `[GeneralTaskPack] runToolAssisted failed: ${msg}`);
      await ctx.emit({ type: 'agent_status', payload: { message: `工具调用失败: ${msg}` } }).catch(() => undefined);
      return undefined;
    }
  }

  /**
   * A6：尝试用 ConversationalResponder + 注入的 persona/userProfile/memory/transcript
   * 生成上下文化回复。任何依赖缺失或调用失败都返回 undefined，让上层退化到模板。
   */
  private async tryConversationalRespond(
    activePrompt: string,
    plan: GeneralPlan,
    attachmentEvidence: string[],
    ctx: TaskPackContext,
  ): Promise<ConversationalAttemptResult> {
    const adapter = this.deps.llmAdapter;
    const model = this.deps.model;
    if (!adapter || !model) {
      return { failed: false };
    }

    try {
      const [persona, userProfile, memorySnippets, recentTranscript] = await Promise.all([
        Promise.resolve(this.deps.resolvePersona?.(ctx)),
        Promise.resolve(this.deps.resolveUserProfile?.(ctx)),
        Promise.resolve(this.deps.resolveMemorySnippets?.(ctx, activePrompt)),
        Promise.resolve(this.deps.resolveRecentTranscript?.(ctx)),
      ]);

      // LLM can respond even without user-specific context:
      // the system prompt provides platform identity and role,
      // and will enrich with any available persona/memory/transcript.
      const responder = new ConversationalResponder({ llmAdapter: adapter, model });
      const conversation: ConversationalContext = {
        prompt: activePrompt,
        guidanceMessages: plan.guidanceMessages,
        attachmentEvidence,
        persona: persona ?? undefined,
        userProfile: userProfile ?? undefined,
        memorySnippets: memorySnippets ?? undefined,
        recentTranscript: recentTranscript ?? undefined,
      };

      return {
        response: await responder.respond(conversation, ctx.signal),
        failed: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err, runId: ctx.run.runId }, 'GeneralTaskPack conversational response failed, falling back');
      await ctx.emit({
        type: 'agent_status',
        payload: {
          message: `通用对话模型调用失败，已回退到基础响应。原因：${message}`,
        },
      }).catch(() => undefined);
      return { failed: true };
    }
  }

  async verify(result: GeneralResult, ctx: TaskPackContext): Promise<VerificationRecord> {
    const reasons = result.responseMode === 'restricted'
      ? ['attachment_context_present_but_file_parse_disabled']
      : result.evidence.length > 0
        ? [`attachment_evidence_used:${result.evidence.length}`]
        : ['general_response_prepared'];

    return {
      verificationId: `ver_${ctx.run.runId}`,
      runId: ctx.run.runId,
      verifierType: 'contract',
      contractVersion: this.contractVersion,
      decision: result.responseMode === 'restricted' ? 'warn' : 'pass',
      reasons,
      followUpAction: 'none',
      createdAt: ctx.now(),
    };
  }

  async projectResult(result: GeneralResult, ctx: TaskPackContext): Promise<RunArtifact[]> {
    const artifacts = [
      await ctx.publishArtifact({
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: result as unknown as Record<string, unknown>,
      }),
    ];

    const proposal = buildGeneralSkillProposal(result, ctx.run.runId);
    if (proposal) {
      artifacts.push(
        await ctx.publishArtifact({
          kind: 'json',
          mimeType: 'application/json',
          contentJson: proposal as unknown as Record<string, unknown>,
        }),
      );
    }

    return artifacts;
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function normalizeOptionalResponseModeHint(value: unknown): GeneralResponseMode | undefined {
  return value === 'answer-only' || value === 'tool-assisted' || value === 'attachment-grounded' || value === 'restricted'
    ? value
    : undefined;
}

function warrantsToolAssistedPrompt(prompt: string): boolean {
  return TOOL_ASSISTED_PROMPT_PATTERN.test(prompt)
    || CLI_COMMAND_PATTERN.test(prompt)
    || SKILLS_INSTALL_PATTERN.test(prompt);
}

function resolveActivePrompt(plan: Pick<GeneralPlan, 'prompt' | 'guidanceMessages'>): string {
  return plan.guidanceMessages.at(-1) ?? plan.prompt;
}

function resolveFinalResponseMode(plan: GeneralPlan, usedToolAssisted: boolean): GeneralResponseMode {
  if (usedToolAssisted) {
    return 'tool-assisted';
  }
  if (plan.attachmentContext && !plan.capabilities.fileAnalysis) {
    return 'restricted';
  }
  if (plan.attachmentContext && plan.capabilities.fileAnalysis) {
    return 'attachment-grounded';
  }
  return 'answer-only';
}

function mapQueryStopToContinuationStop(reason: string): GeneralContinuationStop | undefined {
  if (reason === 'budget_exceeded') {
    return {
      code: 'budget',
      reason: '工具辅助步骤触发预算上限，停止继续编排。',
      source: 'system',
    };
  }

  return undefined;
}

function mapToolErrorToContinuationStop(message: string): GeneralContinuationStop | undefined {
  if (/User rejected tool approval/i.test(message)) {
    return {
      code: 'approval',
      reason: '工具审批未通过，停止继续编排。',
      source: 'user',
    };
  }

  return undefined;
}

function buildContinuationStopResponse(stop?: GeneralContinuationStop): string {
  if (!stop) {
    return '';
  }
  if (stop.code === 'budget') {
    return '已触发本轮工具预算上限，停止继续执行。';
  }
  if (stop.code === 'approval') {
    return '审批未通过，本轮工具执行已停止。';
  }
  return stop.reason;
}

function resolveCapabilities(toolIds: string[]): GeneralCapabilities {
  const enabled = new Set(toolIds);
  const unrestricted = enabled.size === 0;
  return {
    fileAnalysis: unrestricted || enabled.has('file_parse'),
    webResearch: unrestricted || enabled.has('web_fetch'),
    dataLookup: unrestricted || enabled.has('query_database') || enabled.has('query_database_external') || enabled.has('get_database_schema'),
    skillDiscovery: unrestricted || enabled.has('tool_search'),
    humanConfirmation: unrestricted || enabled.has('ask_user'),
  };
}

function extractAttachmentEvidence(attachmentContext?: string): string[] {
  if (!attachmentContext) return [];

  return attachmentContext
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('摘要:'))
    .map((line) => line.replace(/^摘要:\s*/u, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildSuggestedNextActions(plan: GeneralPlan, hasEvidence: boolean): string[] {
  const actions: string[] = [];
  if (plan.attachmentContext && !plan.capabilities.fileAnalysis) {
    actions.push('启用 file_parse 以让附件摘要参与当前通用任务的输出。');
  }
  if (plan.capabilities.webResearch) {
    actions.push('如需补充外部资料，可继续追加需要抓取的网页线索。');
  }
  if (plan.capabilities.dataLookup) {
    actions.push('如需交叉验证内部数据，可补充数据库查询方向。');
  }
  if (!hasEvidence && plan.guidanceMessages.length > 0) {
    actions.push('可以继续通过消息追加引导，细化输出侧重点。');
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Greeting & intent helpers
// ---------------------------------------------------------------------------

/** Matches simple greetings in Chinese or English */
const GREETING_PATTERN = /^(hi|hello|hey|你好|您好|嗨|在吗|早上好|下午好|晚上好|good morning|good afternoon|good evening)[!！,.。?？\s]*$/iu;

/** Detect ambiguous/unclear user intents that should trigger AG2U clarification */
function isAmbiguousPrompt(prompt: string): boolean {
  // Short prompts that lack clear domain signals
  const hasAnalysisSignal = /分析|评估|报告|风控|风险|合规|审核|审查|尽调|画像/.test(prompt);
  const hasKnowledgeSignal = /查找|检索|查询|搜索|知识|规则|案例|历史/.test(prompt);
  const hasSkillSignal = /技能|工具|能力|功能|配置|设置|管理/.test(prompt);

  if (hasAnalysisSignal || hasKnowledgeSignal || hasSkillSignal) return false;

  // Short or vague prompts without domain signals are ambiguous
  return prompt.length < 30;
}

function buildGreetingResponse(prompt: string): string {
  const greeting = /晚上|night|evening/i.test(prompt) ? '晚上好' :
    /下午|afternoon/i.test(prompt) ? '下午好' :
    /早上|morning/i.test(prompt) ? '早上好' : '你好';

  return `${greeting}！有什么可以帮你的？

**可以直接告诉我：**
- 描述一个任务或问题，我来分析
- 提供业务场景，进行风险或数据分析
- 检索知识库中的规则、案例
- 输入 \`/help\` 查看可用指令`;
}

function buildGeneralResponse(prompt: string, guidance: string | undefined, evidence: string[]): string {
  return [
    prompt ? `已收到您的请求：${prompt}` : '已收到您的请求。',
    guidance ? `\n引导补充：${guidance}` : undefined,
    evidence[0] ? `\n附件摘要：${evidence[0]}` : undefined,
  ].filter(Boolean).join('');
}

function buildGeneralSkillProposal(result: GeneralResult, runId: string) {
  const usesWorkflowGrounding = result.responseMode === 'attachment-grounded' || result.toolIds.length > 0;
  if (!usesWorkflowGrounding || result.responseMode === 'restricted') {
    return null;
  }

  return buildSkillProposal({
    sourceRunId: runId,
    taskKind: 'general',
    title: result.prompt,
    objective: `围绕以下通用任务输出稳定结果：${result.prompt}`,
    rationale: '本次通用 run 已结合附件或工具完成结构化输出，适合沉淀为可复用技能。',
    triggerHints: [
      result.prompt,
      ...result.toolIds.map((toolId) => `Enable ${toolId} when the workflow needs the same capability.`),
    ],
    workflow: [
      'Clarify the user goal and keep the response scoped to the requested task.',
      result.attachmentContext
        ? 'Ground the answer in attachment evidence before expanding the response.'
        : 'Use the available tools to enrich the response when they are explicitly enabled.',
      'Produce a concise structured answer and call out the next recommended actions.',
    ],
    evidence: [...result.evidence, ...result.suggestedNextActions],
  });
}
