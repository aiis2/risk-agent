import { spawn } from 'node:child_process';
import {
  emitSandboxAuditEvent,
  type SandboxExecutionContext,
  type SandboxHost,
  type SandboxPolicy,
  type SandboxRequest,
  type SandboxResultByKind,
} from './SandboxRuntime.js';

function appendChunk(current: string, chunk: string, maxChars?: number): string {
  if (maxChars == null) {
    return current + chunk;
  }
  if (current.length >= maxChars) {
    return current;
  }
  return current + chunk.slice(0, maxChars - current.length);
}

class LocalProcessSandboxHost implements SandboxHost {
  readonly kind = 'local-process' as const;

  supports(request: SandboxRequest, _context: SandboxExecutionContext, policy: SandboxPolicy): boolean {
    return request.kind === 'local-process' && policy.hostKind === this.kind;
  }

  async execute(
    request: SandboxRequest,
    context: SandboxExecutionContext,
    policy: SandboxPolicy,
  ): Promise<SandboxResultByKind['local-process']> {
    if (request.kind !== 'local-process') {
      throw new Error(`LocalProcessSandboxHost cannot execute request kind "${request.kind}"`);
    }

    const startedAt = Date.now();
    const cwd = request.cwd ?? context.cwd ?? context.workspaceRoots?.[0] ?? process.cwd();

    await emitSandboxAuditEvent(context, 'sandbox-process-started', policy, {
      command: request.command,
      args: request.args ?? [],
      cwd,
      description: request.description,
    });

    return await new Promise((resolve) => {
      const child = spawn(request.command, request.args ?? [], {
        cwd,
        env: { ...process.env, ...(request.env ?? {}) },
        stdio: 'pipe',
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const finalize = async (result: SandboxResultByKind['local-process']) => {
        if (settled) {
          return;
        }
        settled = true;
        context.signal?.removeEventListener('abort', abortHandler);
        clearTimeout(timeoutHandle);

        if (result.cancelled) {
          await emitSandboxAuditEvent(context, 'sandbox-process-cancelled', policy, {
            command: request.command,
            args: request.args ?? [],
            cwd,
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut ?? false,
          });
        } else if (result.success) {
          await emitSandboxAuditEvent(context, 'sandbox-process-complete', policy, {
            command: request.command,
            args: request.args ?? [],
            cwd,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
          });
        } else if (result.timedOut) {
          await emitSandboxAuditEvent(context, 'sandbox-timeout', policy, {
            command: request.command,
            args: request.args ?? [],
            cwd,
            durationMs: result.durationMs,
          });
        } else if (result.error) {
          await emitSandboxAuditEvent(context, 'sandbox-error', policy, {
            command: request.command,
            args: request.args ?? [],
            cwd,
            error: result.error,
          });
        }

        resolve(result);
      };

      const abortHandler = () => {
        cancelled = true;
        try {
          child.kill();
        } catch {
          // no-op when the child is already gone
        }
      };

      context.signal?.addEventListener('abort', abortHandler, { once: true });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // no-op when the child is already gone
        }
      }, policy.maxDurationMs ?? 120_000);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout = appendChunk(stdout, chunk, policy.maxOutputChars);
      });

      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr = appendChunk(stderr, chunk, policy.maxOutputChars);
      });

      child.on('error', (error) => {
        void finalize({
          success: false,
          stdout,
          stderr,
          exitCode: null,
          signal: null,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
      });

      child.on('close', (exitCode, signal) => {
        const durationMs = Date.now() - startedAt;
        const success = !timedOut && !cancelled && exitCode === 0;
        void finalize({
          success,
          stdout,
          stderr,
          exitCode,
          signal,
          durationMs,
          cancelled,
          timedOut,
          error: success
            ? undefined
            : timedOut
              ? `Process execution timed out after ${policy.maxDurationMs ?? 120_000}ms`
              : cancelled
                ? 'Process execution cancelled'
                : `Process exited with code ${exitCode ?? 'unknown'}`,
        });
      });

      if (request.stdinText != null) {
        child.stdin?.end(request.stdinText);
      } else {
        child.stdin?.end();
      }
    });
  }
}

export function createLocalProcessSandboxHost(): SandboxHost {
  return new LocalProcessSandboxHost();
}