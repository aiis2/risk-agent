/**
 * JsSandboxTool — run_js_sandbox 内置工具（模块10 §2 + 08-tools-skills.md §4）
 *
 * 在隔离沙盒中执行 AI 生成的 JavaScript 代码（通常是 DuckDB-WASM SQL 或数据处理逻辑）。
 * 先经过静态安全扫描（FORBIDDEN_CODE_PATTERNS），再通过 Node.js vm 模块沙盒执行。
 */

import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import { validateSandboxCode, type SandboxResult } from '../../sandbox/JsSandbox.js';
import {
  SandboxRuntime,
  type JavascriptSandboxRequest,
  type SandboxExecutionContext,
  type SandboxExecutionEnvelope,
  type SandboxPolicy,
} from '../../sandbox/SandboxRuntime.js';
import { createJsSandboxHost } from '../../sandbox/JsSandboxHost.js';

export interface JsSandboxInput {
  code: string;
  inputData?: unknown;
  description?: string;
}

export interface JsSandboxRuntimeLike {
  execute(
    request: JavascriptSandboxRequest,
    context: SandboxExecutionContext,
    policy?: Partial<SandboxPolicy>,
  ): Promise<SandboxExecutionEnvelope<'javascript'>>;
}

const defaultJsSandboxRuntime = new SandboxRuntime([createJsSandboxHost()]);

/**
 * 创建 run_js_sandbox 工具
 */
export function createJsSandboxTool(runtime: JsSandboxRuntimeLike = defaultJsSandboxRuntime): AgentToolDefinition<JsSandboxInput, SandboxResult> {
  return {
    name: 'run_js_sandbox',
    description: [
      '在安全隔离沙盒中执行 JavaScript 代码（支持数据处理和计算逻辑）。',
      '代码在独立 V8 上下文中运行，无法访问文件系统、网络、子进程等危险资源。',
      '超时 10 秒，输出自动截断至 100K 字符。',
      '典型用途：对上传的 CSV/Excel 数据执行聚合计算、统计分析。',
    ].join(' '),
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: false,
    deferred: true,
    searchHint: 'execute javascript code sandbox data analysis calculation',
    sandboxProfile: 'shared-js-runtime',
    sandboxHostKind: 'js-vm',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: {
        code: {
          type: 'string',
          description: '要执行的 JavaScript 代码。可使用 console.log 输出结果，return 返回数据。inputData 变量包含传入数据。',
        },
        inputData: {
          description: '传入沙盒的输入数据（通常为解析后的 CSV/JSON 数组）',
        },
        description: {
          type: 'string',
          description: '代码功能描述（用于审计日志）',
        },
      },
    },
    validateInput(input: unknown) {
      const i = input as Partial<JsSandboxInput>;
      if (!i.code || typeof i.code !== 'string') {
        return Promise.resolve({ valid: false, error: 'code 字段为必填字符串' });
      }
      if (i.code.trim().length === 0) {
        return Promise.resolve({ valid: false, error: 'code 不能为空字符串' });
      }
      if (i.code.length > 50_000) {
        return Promise.resolve({ valid: false, error: `代码长度 ${i.code.length} 超过最大限制 50,000 字符` });
      }
      // 提前暴露扫描结果，让 LLM 看到具体违规
      const scan = validateSandboxCode(i.code);
      if (!scan.safe) {
        return Promise.resolve({ valid: false, error: `安全扫描不通过: ${scan.violations.join('; ')}` });
      }
      return Promise.resolve({ valid: true });
    },
    async execute(input: unknown, ctx): Promise<SandboxResult> {
      const { code, inputData } = input as JsSandboxInput;
      const activeRuntime = ctx.sandboxRuntime ?? runtime;
      const envelope = await activeRuntime.execute(
        {
          kind: 'javascript',
          code,
          inputData,
          description: (input as JsSandboxInput).description,
        },
        ctx.sandboxContext ?? {
          sessionId: ctx.sessionId,
          entrypoint: 'tool',
          signal: ctx.signal,
          trustLevel: 'builtin',
        },
        ctx.sandboxPolicy,
      );

      return envelope.result;
    },
  };
}

/** 单例（供 ToolRegistry 直接注册） */
export const jsSandboxTool = createJsSandboxTool();
