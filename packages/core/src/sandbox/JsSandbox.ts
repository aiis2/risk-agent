/**
 * JsSandbox — JavaScript 代码沙盒执行引擎（模块10 §2）
 *
 * 安全策略：
 * 1. 静态代码扫描（FORBIDDEN_CODE_PATTERNS）
 * 2. Node.js vm 模块隔离执行（独立 V8 上下文）
 * 3. 超时竞速保护（默认 10 秒）
 * 4. 危险全局变量遮蔽
 * 5. SQL 只读白名单校验
 */

import vm from 'node:vm';

// ─── 常量 ────────────────────────────────────────────────────────────────────

export const SANDBOX_TIMEOUT_MS = 10_000;
export const MAX_RESULT_SIZE = 100_000; // 100K 字符

// ─── 禁止代码模式（静态扫描）────────────────────────────────────────────────

/**
 * 沙盒代码禁止模式 — 比 SkillDefinition.ts 更严格（适用于运行时代码执行）
 * 参考：10-sandbox-security.md §3
 */
export const SANDBOX_FORBIDDEN_CODE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brequire\s*\(/, description: 'Node.js require 禁止使用' },
  { pattern: /\bimport\s+/, description: 'ES import 禁止使用' },
  { pattern: /\bimport\s*\(/, description: '动态 import() 禁止使用' },
  { pattern: /\bprocess\.env/, description: '环境变量访问禁止' },
  { pattern: /\bprocess\.exit/, description: 'process.exit 禁止' },
  { pattern: /\bchild_process/, description: '子进程模块禁止' },
  { pattern: /\beval\s*\(/, description: 'eval() 禁止使用' },
  { pattern: /\bnew\s+Function\s*\(/, description: 'Function 构造器禁止' },
  { pattern: /\bfs\s*\./, description: '文件系统操作禁止' },
  { pattern: /\bnet\s*\./, description: '网络模块禁止' },
  { pattern: /\bhttp(s)?\s*\./, description: 'HTTP 模块禁止' },
  { pattern: /\bglobalThis\b/, description: 'globalThis 禁止使用' },
  { pattern: /\b__dirname\b/, description: '__dirname 禁止使用' },
  { pattern: /\b__filename\b/, description: '__filename 禁止使用' },
  { pattern: /\bfetch\s*\(/, description: 'fetch 网络请求禁止' },
  { pattern: /\bXMLHttpRequest\b/, description: 'XMLHttpRequest 禁止' },
  { pattern: /\bWebSocket\b/, description: 'WebSocket 禁止' },
  { pattern: /\bexec\s*\(/, description: 'exec() 命令执行禁止' },
  { pattern: /\bspawn\s*\(/, description: 'spawn() 命令执行禁止' },
  { pattern: /\bexecSync\s*\(/, description: 'execSync() 禁止' },
  { pattern: /\.\.\//, description: '路径遍历禁止' },
  { pattern: /\bDeno\b/, description: 'Deno 运行时禁止' },
  { pattern: /\bBun\b/, description: 'Bun 运行时禁止' },
];

// ─── SQL 只读白名单 ──────────────────────────────────────────────────────────

const SQL_ALLOWED_FIRST_KEYWORDS = new Set(['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN']);

/**
 * 校验 SQL 是否为只读查询（10-sandbox-security.md §4）
 */
export function validateSql(sql: string): { allowed: boolean; reason?: string } {
  const trimmed = sql.trim();
  const first = trimmed.match(/^\s*(\w+)/)?.[1]?.toUpperCase() ?? '';

  if (!SQL_ALLOWED_FIRST_KEYWORDS.has(first)) {
    return { allowed: false, reason: `禁止使用 ${first} 语句，仅允许只读查询 (SELECT/WITH/SHOW/DESCRIBE/EXPLAIN)` };
  }
  if (/\bINTO\b/i.test(sql)) {
    return { allowed: false, reason: '禁止 SELECT ... INTO 写出' };
  }
  if (/\bCOPY\b/i.test(sql)) {
    return { allowed: false, reason: '禁止 COPY 命令' };
  }
  return { allowed: true };
}

// ─── 静态代码安全扫描 ────────────────────────────────────────────────────────

export interface SandboxScanResult {
  safe: boolean;
  violations: string[];
}

/**
 * 静态代码安全扫描（10-sandbox-security.md §3）
 * 沙盒专用版本（比 SkillDefinition.ts 中 validateCodeSafety 更严格）
 */
export function validateSandboxCode(code: string): SandboxScanResult {
  const violations: string[] = [];
  for (const { pattern, description } of SANDBOX_FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(description);
    }
  }
  return { safe: violations.length === 0, violations };
}

// ─── 沙盒执行 ───────────────────────────────────────────────────────────────

export interface SandboxResult {
  success: boolean;
  output: string;        // console 输出缓冲
  returnValue: unknown;  // 代码返回值
  error?: string;
  durationMs: number;
}

/**
 * 安全工具白名单 — 沙盒内唯一可用的全局（10-sandbox-security.md §2.1）
 */
function buildSafeContext(inputData: unknown, outputBuffer: string[]): vm.Context {
  return vm.createContext({
    // 基础类型
    Math,
    JSON,
    Array,
    Object,
    Date,
    RegExp,
    String,
    Number,
    Boolean,
    Symbol,
    BigInt,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Proxy,
    Reflect,
    Error,
    TypeError,
    RangeError,
    SyntaxError,

    // 数据处理工具函数
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,

    // 受控 console 输出
    console: {
      log: (...args: unknown[]) => outputBuffer.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => outputBuffer.push(`[WARN] ${args.map(String).join(' ')}`),
      error: (...args: unknown[]) => outputBuffer.push(`[ERROR] ${args.map(String).join(' ')}`),
    },

    // 用户传入数据（只读引用）
    inputData,

    // 禁用定时器
    setTimeout: undefined,
    setInterval: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,

    // 禁用危险全局
    process: undefined,
    global: undefined,
    globalThis: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    fetch: undefined,
    eval: undefined,
  });
}

/**
 * 在隔离沙盒中执行 JavaScript 代码（10-sandbox-security.md §2.3）
 *
 * 执行流程：
 * 1. 静态安全扫描（FORBIDDEN_CODE_PATTERNS）
 * 2. 构造 vm 沙盒作用域
 * 3. 超时竞速执行
 * 4. 结果截断 & 返回
 */
export async function runJsSandbox(
  code: string,
  inputData?: unknown
): Promise<SandboxResult> {
  const startTime = Date.now();
  const outputBuffer: string[] = [];

  // 1. 静态安全扫描
  const scanResult = validateSandboxCode(code);
  if (!scanResult.safe) {
    return {
      success: false,
      output: '',
      returnValue: null,
      error: `安全扫描不通过: ${scanResult.violations.join('; ')}`,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. 构造 vm 沙盒
  const sandboxCtx = buildSafeContext(inputData, outputBuffer);

  // 规范化行尾：Windows CRLF (\r\n) 以及孤立 CR (\r) 统一转为 LF，避免 Node.js VM
  // 在 Windows 环境下解析 CRLF 代码时抛出 SyntaxError（[eval]:1\r\n"const\r\n^^^^^^"）
  const normalizedCode = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const wrappedCode = `
(async function sandboxEntry() {
  ${normalizedCode}
})();
`;

  try {
    // 3. 超时竞速执行 — vm.Script + runInContext
    const script = new vm.Script(wrappedCode, { filename: 'sandbox.js' });
    const resultPromise = script.runInContext(sandboxCtx, {
      timeout: SANDBOX_TIMEOUT_MS,
      breakOnSigint: true,
    }) as Promise<unknown>;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`代码执行超时 (${SANDBOX_TIMEOUT_MS}ms)`)), SANDBOX_TIMEOUT_MS)
    );

    const returnValue = await Promise.race([resultPromise, timeoutPromise]);

    // 4. 结果截断
    const outputStr = outputBuffer.join('\n');
    const truncatedOutput =
      outputStr.length > MAX_RESULT_SIZE
        ? outputStr.slice(0, MAX_RESULT_SIZE) + `\n[输出已截断，原始长度 ${outputStr.length} 字符]`
        : outputStr;

    return {
      success: true,
      output: truncatedOutput,
      returnValue,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      output: outputBuffer.join('\n'),
      returnValue: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
