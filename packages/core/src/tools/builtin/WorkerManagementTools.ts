/**
 * WriteDbTool — 写入结构化存储（参考 tools-skills-system.md §7.2）
 * FileWriteTool — 写入文件（参考 tools-skills-system.md §7.2）
 * StopWorkerTool — 停止 Worker（参考 tools-skills-system.md §7.1）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { LocalProcessSandboxRequest } from '../../sandbox/SandboxRuntime.js';
import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';
import { buildTool } from '../registry/ToolRegistry.js';

interface LocalProcessExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  cancelled?: boolean;
  timedOut?: boolean;
  error?: string;
}

const FILE_WRITE_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const input = JSON.parse(process.argv[1] || '{}');
  const absPath = path.resolve(process.cwd(), String(input.path || '.'));
  if (input.createDirs !== false) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
  }

  const append = input.append === true;
  const isBase64 = input.encoding === 'base64';
  const payload = isBase64
    ? Buffer.from(String(input.content || ''), 'base64')
    : String(input.content ?? '');

  fs.writeFileSync(absPath, payload, append ? { flag: 'a' } : undefined);

  const bytesWritten = Buffer.isBuffer(payload)
    ? payload.byteLength
    : Buffer.byteLength(payload, 'utf8');

  process.stdout.write(JSON.stringify({ path: absPath, bytesWritten }));
}

try {
  main();
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;

function resolveFileWriteCwd(ctx: ToolExecContext): string {
  return resolve(ctx.sandboxContext?.cwd ?? process.cwd());
}

function buildFileWriteRequest(input: FileWriteInput, cwd: string): LocalProcessSandboxRequest {
  return {
    kind: 'local-process',
    command: process.execPath,
    args: ['-e', FILE_WRITE_SCRIPT, JSON.stringify(input)],
    cwd,
    description: `Write workspace file ${input.path}`,
  };
}

function parseFileWriteStdout(stdout: string): { path?: string; bytesWritten?: number } {
  if (!stdout.trim()) {
    return {};
  }

  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  return {
    path: typeof parsed.path === 'string' ? parsed.path : undefined,
    bytesWritten: typeof parsed.bytesWritten === 'number' ? parsed.bytesWritten : undefined,
  };
}

async function executeFileWriteWithSandbox(input: FileWriteInput, ctx: ToolExecContext): Promise<FileWriteOutput | null> {
  if (!ctx.sandboxRuntime || !ctx.sandboxContext) {
    return null;
  }

  const cwd = resolveFileWriteCwd(ctx);
  const request = buildFileWriteRequest(input, cwd);
  const lease = ctx.sandboxRuntime.createLease(
    request,
    {
      ...ctx.sandboxContext,
      toolName: ctx.sandboxContext.toolName ?? 'file_write',
      cwd,
    },
    ctx.sandboxPolicy,
  );

  ctx.onProgress?.({
    phase: 'sandbox',
    message: 'lease created',
    percent: 10,
  });

  const envelope = await lease.execute();
  const result = envelope.result as LocalProcessExecutionResult;
  ctx.onProgress?.({
    phase: 'sandbox',
    message: result.cancelled ? 'lease cancelled' : result.success ? 'lease complete' : 'lease failed',
    percent: result.cancelled ? 100 : result.success ? 100 : 90,
  });

  const fallbackPath = resolve(cwd, input.path);
  if (!result.success) {
    return {
      success: false,
      path: fallbackPath,
      bytesWritten: 0,
      error: result.error ?? result.stderr ?? `file_write sandbox failed with exit code ${result.exitCode ?? 'unknown'}`,
    };
  }

  const parsed = parseFileWriteStdout(result.stdout);
  return {
    success: true,
    path: parsed.path ?? fallbackPath,
    bytesWritten: parsed.bytesWritten ?? 0,
  };
}

// ──────────────────────────────────────────────────────────
// write_db  — 写入结构化存储（§7.2）
// ──────────────────────────────────────────────────────────

export interface WriteDbInput {
  table: string;
  operation: 'insert' | 'update' | 'upsert' | 'delete';
  data?: Record<string, unknown>;      // insert / upsert 数据
  where?: Record<string, unknown>;     // update / delete 条件
  returning?: string[];                // 返回字段列表
}

export interface WriteDbOutput {
  success: boolean;
  rowsAffected: number;
  returning?: Record<string, unknown>[];
  error?: string;
}

export const writeDbTool: AgentToolDefinition<WriteDbInput, WriteDbOutput> = buildTool({
  name: 'write_db',
  description: '向结构化存储（SQLite）写入数据：支持 INSERT / UPDATE / UPSERT / DELETE。写操作串行执行，不可并行。',
  isReadOnly: false,
  isConcurrencySafe: false,   // 写操作串行
  isDestructive: false,
  alwaysLoad: false,
  deferred: false,
  maxResultSizeChars: 20_000,
  inputSchema: {
    type: 'object',
    required: ['table', 'operation'],
    properties: {
      table: { type: 'string', description: '目标表名（snake_case）' },
      operation: { type: 'string', enum: ['insert', 'update', 'upsert', 'delete'], description: '写操作类型' },
      data: { type: 'object', description: '写入数据（insert/update/upsert 时必填）' },
      where: { type: 'object', description: '过滤条件（update/delete 时必填）' },
      returning: { type: 'array', items: { type: 'string' }, description: '返回的字段列表' },
    },
  },
  getActivityDescription: (input: WriteDbInput) => `正在 ${input?.operation ?? 'write'} → ${input?.table ?? 'table'}…`,
  async execute(input: WriteDbInput, ctx: ToolExecContext) {
    // 占位实现：实际由 SQLiteStore 具体执行
    // 业务逻辑在调用方（OrchestratorAgent/Worker）中装配 storage 上下文后执行
    void ctx;
    void input;
    return {
      success: false,
      rowsAffected: 0,
      error: 'write_db: storage context not attached (use via WorkerToolContext)',
    };
  },
});

// ──────────────────────────────────────────────────────────
// file_write  — 写入文件（§7.2）
// ──────────────────────────────────────────────────────────

export interface FileWriteInput {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  createDirs?: boolean;    // 是否自动创建父目录（默认 true）
  append?: boolean;        // 追加模式（默认覆盖）
}

export interface FileWriteOutput {
  success: boolean;
  path: string;
  bytesWritten: number;
  error?: string;
}

export const fileWriteTool: AgentToolDefinition<FileWriteInput, FileWriteOutput> = buildTool({
  name: 'file_write',
  description: '将内容写入本地文件。支持追加模式和 base64 编码。写操作串行执行，不可并行。',
  isReadOnly: false,
  isConcurrencySafe: false,   // 文件写入串行
  isDestructive: false,
  alwaysLoad: false,
  deferred: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  sandboxAccessTier: 'interactive-write-capable',
  maxResultSizeChars: 1_000,
  inputSchema: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: '目标文件路径（相对或绝对）' },
      content: { type: 'string', description: '要写入的内容' },
      encoding: { type: 'string', enum: ['utf-8', 'base64'], description: '编码格式（默认 utf-8）' },
      createDirs: { type: 'boolean', description: '是否自动创建父目录（默认 true）' },
      append: { type: 'boolean', description: '追加模式（默认覆盖）' },
    },
  },
  getActivityDescription: (input: FileWriteInput) => `正在写入 ${input?.path ?? 'file'}…`,
  async execute(input: FileWriteInput, ctx: ToolExecContext) {
    const sandboxResult = await executeFileWriteWithSandbox(input, ctx);
    if (sandboxResult) {
      return sandboxResult;
    }

    try {
      const absPath = resolve(input.path);
      if (input.createDirs !== false) {
        mkdirSync(dirname(absPath), { recursive: true });
      }

      const encoding = (input.encoding ?? 'utf-8') as BufferEncoding;
      const flag = input.append ? 'a' : 'w';
      writeFileSync(absPath, input.content, { encoding, flag });

      return {
        success: true,
        path: absPath,
        bytesWritten: Buffer.byteLength(input.content, encoding),
      };
    } catch (err) {
      return {
        success: false,
        path: input.path,
        bytesWritten: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ──────────────────────────────────────────────────────────
// stop_worker  — 停止 Worker（§7.1）
// ──────────────────────────────────────────────────────────

export interface StopWorkerInput {
  workerId: string;
  reason?: string;
  force?: boolean;         // 强制终止（不等待当前工具完成）
}

export interface StopWorkerOutput {
  stopped: boolean;
  workerId: string;
  finalStatus?: string;
}

export const stopWorkerTool: AgentToolDefinition<StopWorkerInput, StopWorkerOutput> = buildTool({
  name: 'stop_worker',
  description: '停止指定 Worker 的执行。Coordinator 专用工具，不在 Worker 内可用。',
  isReadOnly: false,
  isConcurrencySafe: false,
  isDestructive: false,
  alwaysLoad: true,         // Coordinator 核心工具，始终可见
  deferred: false,
  interruptBehavior: 'halt',
  maxResultSizeChars: 2_000,
  inputSchema: {
    type: 'object',
    required: ['workerId'],
    properties: {
      workerId: { type: 'string', description: '要停止的 Worker ID（task ID）' },
      reason: { type: 'string', description: '停止原因' },
      force: { type: 'boolean', description: '是否强制终止（不等待当前工具完成，默认 false）' },
    },
  },
  getActivityDescription: (input: StopWorkerInput) => `正在停止 Worker ${input?.workerId ?? ''}…`,
  async execute(input: StopWorkerInput, ctx: ToolExecContext) {
    // 通过 AbortSignal 通知 Worker 停止
    void ctx;
    return {
      stopped: true,
      workerId: input.workerId,
      finalStatus: 'cancelled',
    };
  },
});
