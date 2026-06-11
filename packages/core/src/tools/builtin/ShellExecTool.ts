import { createLocalProcessSandboxHost } from '../../sandbox/LocalProcessSandboxHost.js';
import type { LocalProcessSandboxRequest, SandboxExecutionContext, SandboxPolicy } from '../../sandbox/SandboxRuntime.js';
import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';

interface ShellExecInput {
  /** Shell command to run. Will be passed to sh -c (Unix) or cmd /c (Windows). */
  command: string;
  /** Working directory for the command. Defaults to project root. */
  cwd?: string;
  /** Optional text to pipe into stdin before closing it. */
  stdinText?: string;
  /** Extra environment variables merged with the current process env. */
  env?: Record<string, string>;
  /** Maximum duration in milliseconds. Defaults to 120 000. */
  timeoutMs?: number;
}

interface ShellExecOutput {
  command: string;
  cwd: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  cancelled?: boolean;
  error?: string;
}

function buildShellRequest(input: ShellExecInput, resolvedCwd: string): LocalProcessSandboxRequest {
  const isWindows = process.platform === 'win32';

  // On Windows use cmd /c; on POSIX use sh -c so the full shell pipeline is available.
  const [command, args] = isWindows
    ? ['cmd.exe', ['/c', input.command]]
    : ['sh', ['-c', input.command]];

  return {
    kind: 'local-process',
    command,
    args,
    cwd: resolvedCwd,
    stdinText: input.stdinText,
    env: input.env,
    description: `shell_exec: ${input.command.slice(0, 120)}`,
  };
}

export const shellExecTool: AgentToolDefinition<ShellExecInput, ShellExecOutput> = {
  name: 'shell_exec',
  description: [
    'Execute an arbitrary shell command in the local environment and return its stdout/stderr.',
    '',
    'Guidelines:',
    '- For interactive CLI tools (e.g. `npx skills add`) always pass `--yes` / `--non-interactive` flags',
    '  and set env `CI=true` so prompts are auto-accepted.',
    '- Avoid destructive commands (rm -rf, git reset --hard, etc.) unless explicitly requested.',
    '- Prefer explicit cwd instead of relying on the default working directory.',
    '- Large stdout is automatically truncated; use flags like `--quiet` if output verbosity is a concern.',
  ].join('\n'),

  inputSchema: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory path. Defaults to the project root.',
      },
      stdinText: {
        type: 'string',
        description: 'Text written to stdin before the pipe is closed.',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Extra environment variables to merge with the current process environment.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds (default 120 000).',
      },
    },
  },

  isConcurrencySafe: false,
  isDestructive: true,
  isReadOnly: false,
  alwaysLoad: false,
  deferred: true,
  searchHint: 'run shell command, execute terminal command, run bash, run script, run npx, execute CLI',

  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  sandboxAccessTier: 'interactive-write-capable',

  getActivityDescription(input: ShellExecInput): string {
    return `执行命令：${input.command.slice(0, 80)}${input.command.length > 80 ? '…' : ''}`;
  },

  async execute(input: ShellExecInput, ctx: ToolExecContext): Promise<ShellExecOutput> {
    const cwd = input.cwd ?? ctx.sandboxContext?.cwd ?? ctx.sandboxContext?.workspaceRoots?.[0] ?? process.cwd();
    const request = buildShellRequest(input, cwd);

    ctx.onProgress?.({ phase: 'running', message: `运行：${input.command.slice(0, 60)}`, percent: 10 });

    const host = createLocalProcessSandboxHost();
    const context: SandboxExecutionContext = {
      sessionId: ctx.sessionId,
      entrypoint: ctx.sandboxContext?.entrypoint ?? 'tool',
      runId: ctx.sandboxContext?.runId,
      taskId: ctx.sandboxContext?.taskId,
      signal: ctx.signal,
      workspaceRoots: ctx.sandboxContext?.workspaceRoots,
      trustLevel: ctx.sandboxContext?.trustLevel ?? 'builtin',
      cwd,
      toolName: 'shell_exec',
      sandboxProfile: 'local-process',
      auditLogger: ctx.sandboxContext?.auditLogger,
    };
    const policy: SandboxPolicy = {
      hostKind: 'local-process',
      filesystem: ctx.sandboxPolicy?.filesystem ?? 'workspace-write',
      network: ctx.sandboxPolicy?.network ?? 'allow',
      interaction: ctx.sandboxPolicy?.interaction ?? 'none',
      maxDurationMs: input.timeoutMs ?? ctx.sandboxPolicy?.maxDurationMs ?? 120_000,
      maxOutputChars: ctx.sandboxPolicy?.maxOutputChars ?? 200_000,
    };

    const result = await host.execute(request, context, policy) as {
      success: boolean;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      durationMs: number;
      timedOut?: boolean;
      cancelled?: boolean;
      signal?: NodeJS.Signals | null;
      error?: string;
    };

    ctx.onProgress?.({ phase: 'done', message: result.success ? '命令完成' : '命令失败', percent: 100 });

    return {
      command: input.command,
      cwd,
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      error: result.error,
    };
  },
};
