/**
 * ConversationalResponder — 通用模式上下文化回复生成（A6）
 *
 * 给 GeneralTaskPack.execute() 的 LLM 路径提供：
 * - persona + userProfile + memorySnippets + 最近 N 轮 transcript 摘要
 * - 明确禁止 canned 模板（"你好！有什么可以帮你的？\n可以直接告诉我..."）
 *
 * 当任意一个依赖缺失（无 LLM、无 persona、无 memory）时，调用方应回退到
 * 旧的 buildGreetingResponse / buildGeneralResponse 模板路径。
 */

import type { LLMAdapter, LLMCallOptions, LLMCallUsage } from '../../llm/LLMAdapter.js';
import type { Message } from '../../agents/base/types.js';
import type { Persona } from '../../persona/PersonaService.js';
import type { UserProfile } from '../../userProfile/UserProfileService.js';

export interface ConversationalContext {
  prompt: string;
  guidanceMessages: string[];
  attachmentEvidence: string[];
  persona?: Persona;
  userProfile?: UserProfile;
  memorySnippets?: string[];
  recentTranscript?: Array<{ role: 'user' | 'assistant'; content: string }>;
  locale?: string;
}

export interface ConversationalResponderOptions {
  llmAdapter: LLMAdapter;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ConversationalResponse {
  text: string;
  usage: LLMCallUsage;
}

const FORBIDDEN_OPENERS = [
  '有什么可以帮你的',
  '可以直接告诉我',
];

export class ConversationalResponder {
  constructor(private readonly opts: ConversationalResponderOptions) {}

  async respond(ctx: ConversationalContext, signal?: AbortSignal): Promise<ConversationalResponse> {
    const systemPrompt = buildSystemPrompt(ctx);
    const messages: Message[] = [];

    // 注入最近 transcript（最多 6 轮，截断超长内容）
    const recent = (ctx.recentTranscript ?? []).slice(-6);
    for (const turn of recent) {
      messages.push({ role: turn.role, content: truncate(turn.content, 800) });
    }

    // 若存在 guidanceMessages（steer 追问），以最后一条作为实际用户消息
    // 原始 prompt 保留在 transcript 上下文中即可；否则直接用原始 prompt
    const latestGuidance = ctx.guidanceMessages.at(-1);
    const userMessage = buildUserMessage(ctx, latestGuidance);
    messages.push({ role: 'user', content: userMessage });

    const callOpts: LLMCallOptions = {
      model: this.opts.model,
      systemPrompt,
      messages,
      temperature: this.opts.temperature ?? 0.2,
      maxTokens: this.opts.maxTokens ?? 2048,
      signal,
      // Conversational replies don't need extended chain-of-thought thinking.
      // For thinking-capable models (Qwen3, etc.), this avoids thinking tokens consuming
      // the entire max_tokens budget and returning an empty content field.
      enableThinking: false,
    };

    const result = await this.opts.llmAdapter.call(callOpts);
    let text = normalizeResponseText(result.text);

    // 简单防御：若模型仍输出禁用模板，截断 + 追加引导提示
    if (FORBIDDEN_OPENERS.every((needle) => text.includes(needle))) {
      text = `${text}\n\n（系统提示：避免使用通用模板。请告诉我您当前关注的具体业务场景或问题。）`;
    }
    return {
      text: text || '（模型未返回有效内容，请稍后再试）',
      usage: result.usage,
    };
  }
}

function buildUserMessage(ctx: ConversationalContext, latestGuidance?: string): string {
  if (!latestGuidance) {
    return ctx.prompt;
  }

  const recent = ctx.recentTranscript ?? [];
  const lastAssistant = [...recent].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const lastUser = [...recent].reverse().find((turn) => turn.role === 'user' && turn.content.trim().length > 0);

  if (!lastAssistant && !lastUser) {
    return latestGuidance;
  }

  const lines = [
    '这是同一对话里的追问。优先延续上面的对话语义，不要把它当成全新独立问题；如果本轮追问已经自包含，再直接回答。',
  ];

  if (lastUser) {
    lines.push(`上一轮用户请求：${truncate(lastUser.content, 240)}`);
  }
  if (lastAssistant) {
    lines.push(`上一轮助手结果：${truncate(lastAssistant.content, 240)}`);
  }

  lines.push(`本轮追问：${latestGuidance}`);
  return lines.join('\n');
}

function buildSystemPrompt(ctx: ConversationalContext): string {
  const parts: string[] = [];

  parts.push(
    '你是 Risk Agent 平台的通用对话助手，处于 "context-aware-conversational" 模式。',
    '禁止：',
    '- 输出空洞的固定模板（例如：「你好！有什么可以帮你的？\\n\\n可以直接告诉我：- 描述一个任务或问题，我来分析\\n- 提供业务场景，进行风险或数据分析\\n- 检索知识库中的规则、案例\\n- 输入 /help 查看可用指令」）',
    '- 复述用户问题作为开场',
    '- 列举平台所有能力当作回答',
    '- 当用户要求“只返回结果”或“只给结论”时，输出必须是最终答案本身，禁止 JSON、代码块、前后缀解释',
    '允许：',
    '- 引用记忆/画像/上下文里的信息（自然融入，不必每次声明 "根据您的偏好"）',
    '- 当意图不明时，给出 1 个最可能的方向 + 2-3 个最关键的澄清问题',
    '- 当用户只是寒暄时，简短回应并主动引出与该用户当前画像/历史相关的 1 个具体话题',
    '- 当最新用户消息依赖上一轮内容（例如“再加 1 呢”“按刚才那个改一下”），必须基于 recent transcript 延续上一轮语义，不能把它当成全新独立问题',
    '语言：跟随用户输入，默认中文。'
  );

  if (ctx.persona) {
    parts.push(`\n## 当前人格\n名称：${ctx.persona.name}（scope=${ctx.persona.scope}）\n${ctx.persona.systemPrompt}`);
  }

  if (ctx.userProfile) {
    const u = ctx.userProfile;
    const lines: string[] = ['\n## 用户画像'];
    if (u.displayName) lines.push(`昵称：${u.displayName}`);
    if (u.traits?.industry) lines.push(`行业：${u.traits.industry}`);
    if (u.traits?.role) lines.push(`角色：${u.traits.role}`);
    if (u.preferences?.verbosity) lines.push(`详略偏好：${u.preferences.verbosity}`);
    if (u.learnedFacts?.length) {
      lines.push('既有事实：');
      u.learnedFacts.slice(0, 6).forEach((f) => {
        lines.push(`- ${f.key ? f.key + '：' : ''}${f.value}`);
      });
    }
    if (lines.length > 1) parts.push(lines.join('\n'));
  }

  if (ctx.memorySnippets?.length) {
    parts.push('\n## 长期记忆（从历史交互中策展，可参考）');
    ctx.memorySnippets.slice(0, 6).forEach((s, i) => parts.push(`${i + 1}. ${s}`));
  }

  if (ctx.guidanceMessages.length) {
    // 最后一条已作为用户消息发出，只把前面的历史引导放入系统提示作为背景
    const historyGuidance = ctx.guidanceMessages.slice(0, -1);
    if (historyGuidance.length > 0) {
      parts.push(`\n## 历史引导（前轮追问，仅供参考）\n${historyGuidance.join('\n')}`);
    }
  }

  if (ctx.attachmentEvidence.length) {
    parts.push(`\n## 附件证据\n${ctx.attachmentEvidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}`);
  }

  return parts.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function normalizeResponseText(value: string): string {
  let text = value.trim();
  if (!text) {
    return text;
  }

  const fenced = text.match(/^```(?:json|text|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const normalized = unwrapStructuredText(text);
    if (!normalized || normalized === text) {
      break;
    }
    text = normalized.trim();
  }

  return text.trim();
}

function unwrapStructuredText(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (Array.isArray(parsed)) {
      const textBlocks = parsed
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return undefined;
          }
          const block = item as Record<string, unknown>;
          return block.type === 'text' && typeof block.text === 'string'
            ? block.text
            : undefined;
        })
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (textBlocks.length > 0) {
        return textBlocks.join('\n');
      }
      return undefined;
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (record.type === 'text' && typeof record.text === 'string') {
        return record.text;
      }
      const candidates = [record.response, record.answer, record.content, record.text];
      const firstText = candidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
      if (firstText) {
        return firstText;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
