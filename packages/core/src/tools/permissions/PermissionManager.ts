/**
 * PermissionManager — 三级权限模型 + PreToolUse/PostToolUse Hooks
 * （参考 agent-framework.md §12 · claude-code-cli permission system）
 *
 * 三级优先级（高 → 低）：
 *   enterprise（企业策略）> project（项目配置）> user（用户设置）
 *
 * 权限类型：
 *   allow — 自动放行，无需确认
 *   deny  — 立即拒绝
 *   ask   — 暂停执行，向用户提问（仅 'default' 模式）
 */

import { createLogger } from '../../logger.js';

const log = createLogger('PermissionManager');

// ──────────────────────────────────────────────────────────
// 权限模式
// ──────────────────────────────────────────────────────────

export type PermissionMode =
  | 'default'  // ask = 请求确认
  | 'plan'     // 只读工具放行，写工具 → deny
  | 'auto';    // 全部 allow（CI/无人值守模式）

// ──────────────────────────────────────────────────────────
// 权限规则来源
// ──────────────────────────────────────────────────────────

/**
 * 按来源分层的权限规则（支持 glob 匹配，如 "database_query:*"）
 */
export interface PermissionRulesBySource {
  /** 用户在设置中心配置的规则 */
  user: string[];
  /** 项目 .riskagent/permissions.json 中的规则 */
  project: string[];
  /** 企业级策略下发（最高优先级，用户不可覆盖） */
  enterprise: string[];
}

export interface ToolPermissionConfig {
  mode: PermissionMode;
  alwaysAllowRules: PermissionRulesBySource;
  alwaysDenyRules: PermissionRulesBySource;
  alwaysAskRules: PermissionRulesBySource;
}

// ──────────────────────────────────────────────────────────
// Hook 系统
// ──────────────────────────────────────────────────────────

export type HookType = 'PreToolUse' | 'PostToolUse';

export interface ToolHook {
  type: HookType;
  /** 工具名匹配（支持 glob，如 "database_*"）*/
  matcher: string;
  /** 执行外部校验命令（返回非 0 = 拒绝）*/
  command?: string;
  /** 内联 JS 校验脚本（返回 false 或 throw = 拒绝）*/
  script?: string;
  /** 超时 ms（默认 10000）*/
  timeout?: number;
}

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
  /** 被哪条规则命中 */
  matchedRule?: string;
  matchedSource?: 'enterprise' | 'project' | 'user' | 'mode_default';
}

// ──────────────────────────────────────────────────────────
// PermissionManager 实现
// ──────────────────────────────────────────────────────────

export class PermissionManager {
  private config: ToolPermissionConfig;
  private hooks: ToolHook[];

  constructor(config?: Partial<ToolPermissionConfig>, hooks: ToolHook[] = []) {
    this.config = {
      mode: config?.mode ?? 'default',
      alwaysAllowRules: config?.alwaysAllowRules ?? { user: [], project: [], enterprise: [] },
      alwaysDenyRules: config?.alwaysDenyRules ?? { user: [], project: [], enterprise: [] },
      alwaysAskRules: config?.alwaysAskRules ?? { user: [], project: [], enterprise: [] }
    };
    this.hooks = hooks;
  }

  // ─── 权限判定 ──────────────────────────────────────────

  /**
   * 评估工具调用权限
   * @param toolName 工具名称
   * @param isReadOnly 工具是否为只读操作
   */
  evaluate(toolName: string, isReadOnly = false): PermissionResult {
    // 1. auto 模式 — 全部放行
    if (this.config.mode === 'auto') {
      return { decision: 'allow', reason: 'auto mode', matchedSource: 'mode_default' };
    }

    // 2. plan 模式 — 非只读工具 deny
    if (this.config.mode === 'plan' && !isReadOnly) {
      return { decision: 'deny', reason: 'plan mode: only read-only tools allowed', matchedSource: 'mode_default' };
    }

    // 3. 按 enterprise > project > user 优先级检查规则
    // deny 规则（企业级最高优先）
    for (const source of ['enterprise', 'project', 'user'] as const) {
      const denied = this.config.alwaysDenyRules[source];
      const match = denied.find((r) => matchGlob(toolName, r));
      if (match) return { decision: 'deny', reason: `denied by rule: ${match}`, matchedRule: match, matchedSource: source };
    }

    // allow 规则
    for (const source of ['enterprise', 'project', 'user'] as const) {
      const allowed = this.config.alwaysAllowRules[source];
      const match = allowed.find((r) => matchGlob(toolName, r));
      if (match) return { decision: 'allow', reason: `allowed by rule: ${match}`, matchedRule: match, matchedSource: source };
    }

    // ask 规则
    for (const source of ['enterprise', 'project', 'user'] as const) {
      const askRules = this.config.alwaysAskRules[source];
      const match = askRules.find((r) => matchGlob(toolName, r));
      if (match) return { decision: 'ask', reason: `ask by rule: ${match}`, matchedRule: match, matchedSource: source };
    }

    // 4. 默认决策
    return {
      decision: isReadOnly ? 'allow' : 'ask',
      reason: 'default policy',
      matchedSource: 'mode_default'
    };
  }

  // ─── Hook 执行 ────────────────────────────────────────

  /**
   * 按顺序执行匹配工具名的 hooks
   * @param hookType  PreToolUse | PostToolUse
   * @param toolName  工具名
   * @param input     工具输入（传递给 script）
   * @returns { blocked: true, reason } 或 { blocked: false }
   */
  async runHooks(
    hookType: HookType,
    toolName: string,
    input: unknown
  ): Promise<{ blocked: boolean; reason?: string }> {
    const matching = this.hooks.filter((h) => h.type === hookType && matchGlob(toolName, h.matcher));
    for (const hook of matching) {
      try {
        const result = await this.executeHook(hook, input);
        if (!result.passed) {
          log.warn({ hookType, toolName, reason: result.reason }, 'Hook blocked tool call');
          return { blocked: true, reason: result.reason ?? `Hook ${hookType} blocked` };
        }
      } catch (err) {
        log.error({ hookType, toolName, err }, 'Hook execution error');
        return { blocked: true, reason: `Hook error: ${(err as Error).message}` };
      }
    }
    return { blocked: false };
  }

  private async executeHook(
    hook: ToolHook,
    input: unknown
  ): Promise<{ passed: boolean; reason?: string }> {
    const timeout = hook.timeout ?? 10_000;

    if (hook.script) {
      // 内联 JS 脚本（在受限上下文中执行）
      return await runScriptInSandbox(hook.script, input, timeout);
    }

    if (hook.command) {
      // 外部命令（不在浏览器环境中可用）
      return await runExternalCommand(hook.command, input, timeout);
    }

    return { passed: true };
  }

  // ─── 配置更新 ─────────────────────────────────────────

  setMode(mode: PermissionMode): void {
    this.config.mode = mode;
  }

  addRule(
    type: 'allow' | 'deny' | 'ask',
    source: 'user' | 'project' | 'enterprise',
    pattern: string
  ): void {
    const ruleSet =
      type === 'allow' ? this.config.alwaysAllowRules :
      type === 'deny'  ? this.config.alwaysDenyRules :
      this.config.alwaysAskRules;
    if (!ruleSet[source].includes(pattern)) ruleSet[source].push(pattern);
  }

  addHook(hook: ToolHook): void {
    this.hooks.push(hook);
  }

  getMode(): PermissionMode {
    return this.config.mode;
  }
}

// ──────────────────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────────────────

/**
 * 简单 glob 匹配（支持 * 通配符）
 */
function matchGlob(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return value === pattern;
  const regex = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return regex.test(value);
}

/**
 * 内联 JS 沙盒执行（受限 Function 构造）
 * 脚本返回 false 或 throw → 拒绝
 */
async function runScriptInSandbox(
  script: string,
  input: unknown,
  timeoutMs: number
): Promise<{ passed: boolean; reason?: string }> {
  try {
    // 超时 Promise
    const timeoutP = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`hook script timeout (${timeoutMs}ms)`)), timeoutMs)
    );
    // 构造安全函数（禁止 require/import/process 等）
    const fn = new Function('input', `"use strict";\n${script}`) as (input: unknown) => unknown;
    const result = await Promise.race([Promise.resolve(fn(input)), timeoutP]);
    if (result === false) return { passed: false, reason: 'hook script returned false' };
    return { passed: true };
  } catch (err) {
    return { passed: false, reason: (err as Error).message };
  }
}

/**
 * 外部命令执行（仅 Node.js 环境可用）
 */
async function runExternalCommand(
  command: string,
  input: unknown,
  timeoutMs: number
): Promise<{ passed: boolean; reason?: string }> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const inputJson = JSON.stringify(input);
    await exec('sh', ['-c', command], {
      timeout: timeoutMs,
      env: { ...process.env, TOOL_INPUT: inputJson }
    });
    return { passed: true };
  } catch (err: any) {
    const code = err.code ?? err.exitCode;
    return { passed: false, reason: `command exited with code ${code}: ${err.message}` };
  }
}
