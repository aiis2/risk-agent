import { randomUUID } from 'node:crypto';
import { MAX_RESULT_SIZE, SANDBOX_TIMEOUT_MS, type SandboxResult } from './JsSandbox.js';
import type { SecurityAuditEvent, SecurityEventType } from './SecurityAuditService.js';

export type SandboxHostKind = 'js-vm' | 'local-process' | 'container';
export type SandboxEntrypoint = 'tool' | 'chat' | 'web-cli' | 'terminal-cli' | 'background';
export type SandboxTrustLevel = 'builtin' | 'mcp' | 'dynamic-skill';
export type SandboxAccessTier = 'interactive-readonly' | 'interactive-write-capable' | 'background';
export type SandboxFilesystemScope = 'none' | 'workspace-read' | 'workspace-write';
export type SandboxNetworkScope = 'deny' | 'allow';
export type SandboxInteractionMode = 'none' | 'tty';

export interface SandboxAuditLogger {
  log(event: Omit<SecurityAuditEvent, 'eventId'>): Promise<void>;
}

export interface SandboxExecutionContext {
  readonly sessionId: string;
  readonly entrypoint: SandboxEntrypoint;
  readonly runId?: string;
  readonly taskId?: string;
  readonly signal?: AbortSignal;
  readonly workspaceRoots?: string[];
  readonly trustLevel?: SandboxTrustLevel;
  readonly cwd?: string;
  readonly toolName?: string;
  readonly sandboxProfile?: string;
  readonly leaseId?: string;
  readonly auditLogger?: SandboxAuditLogger;
}

export interface SandboxPolicy {
  readonly hostKind: SandboxHostKind;
  readonly filesystem: SandboxFilesystemScope;
  readonly network: SandboxNetworkScope;
  readonly interaction: SandboxInteractionMode;
  readonly maxDurationMs?: number;
  readonly maxOutputChars?: number;
}

export interface JavascriptSandboxRequest {
  readonly kind: 'javascript';
  readonly code: string;
  readonly inputData?: unknown;
  readonly description?: string;
}

export interface LocalProcessSandboxRequest {
  readonly kind: 'local-process';
  readonly command: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly stdinText?: string;
  readonly description?: string;
}

export interface LocalProcessSandboxResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly cancelled?: boolean;
  readonly timedOut?: boolean;
  readonly error?: string;
}

export type SandboxRequest = JavascriptSandboxRequest | LocalProcessSandboxRequest;

export interface SandboxResultByKind {
  javascript: SandboxResult;
  'local-process': LocalProcessSandboxResult;
}

export interface SandboxExecutionEnvelope<K extends keyof SandboxResultByKind = keyof SandboxResultByKind> {
  readonly hostKind: SandboxHostKind;
  readonly policy: SandboxPolicy;
  readonly result: SandboxResultByKind[K];
}

export interface SandboxLease<K extends keyof SandboxResultByKind = keyof SandboxResultByKind> {
  readonly leaseId: string;
  readonly hostKind: SandboxHostKind;
  readonly policy: SandboxPolicy;
  readonly signal: AbortSignal;
  execute(): Promise<SandboxExecutionEnvelope<K>>;
  cancel(reason?: string): void;
}

export interface SandboxHost {
  readonly kind: SandboxHostKind;
  supports(request: SandboxRequest, context: SandboxExecutionContext, policy: SandboxPolicy): boolean;
  execute(
    request: SandboxRequest,
    context: SandboxExecutionContext,
    policy: SandboxPolicy,
  ): Promise<SandboxResultByKind[keyof SandboxResultByKind]>;
}

const DEFAULT_SANDBOX_POLICIES: { [K in SandboxRequest['kind']]: SandboxPolicy } = {
  javascript: {
    hostKind: 'js-vm',
    filesystem: 'none',
    network: 'deny',
    interaction: 'none',
    maxDurationMs: SANDBOX_TIMEOUT_MS,
    maxOutputChars: MAX_RESULT_SIZE,
  },
  'local-process': {
    hostKind: 'local-process',
    filesystem: 'workspace-read',
    network: 'deny',
    interaction: 'none',
    maxDurationMs: 120_000,
    maxOutputChars: MAX_RESULT_SIZE,
  },
};

function createSandboxAgentId(context: SandboxExecutionContext): string {
  return context.runId ?? context.sessionId;
}

function buildSandboxAuditDetails(
  context: SandboxExecutionContext,
  policy: SandboxPolicy,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sessionId: context.sessionId,
    runId: context.runId,
    taskId: context.taskId,
    leaseId: context.leaseId,
    toolName: context.toolName,
    sandboxProfile: context.sandboxProfile,
    entrypoint: context.entrypoint,
    trustLevel: context.trustLevel,
    workspaceRoots: context.workspaceRoots,
    cwd: context.cwd,
    hostKind: policy.hostKind,
    filesystem: policy.filesystem,
    network: policy.network,
    interaction: policy.interaction,
    ...extra,
  };
}

export async function emitSandboxAuditEvent(
  context: SandboxExecutionContext,
  eventType: SecurityEventType,
  policy: SandboxPolicy,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!context.auditLogger) {
    return;
  }

  try {
    await context.auditLogger.log({
      timestamp: Date.now(),
      eventType,
      agentId: createSandboxAgentId(context),
      details: buildSandboxAuditDetails(context, policy, extra),
    });
  } catch {
    // 审计失败不应阻断主流程。
  }
}

export class SandboxRuntime {
  constructor(private readonly hosts: readonly SandboxHost[]) {}

  createLease<K extends SandboxRequest['kind']>(
    request: Extract<SandboxRequest, { kind: K }>,
    context: SandboxExecutionContext,
    policy?: Partial<SandboxPolicy>,
  ): SandboxLease<K> {
    const resolvedPolicy = this.resolvePolicy(request, policy);
    const host = this.hosts.find((candidate) => candidate.supports(request, context, resolvedPolicy));

    if (!host) {
      throw new Error(`No sandbox host available for request kind "${request.kind}"`);
    }

    const leaseId = randomUUID();
    const leaseController = new AbortController();
    if (context.signal) {
      if (context.signal.aborted) {
        leaseController.abort(context.signal.reason);
      } else {
        context.signal.addEventListener('abort', () => leaseController.abort(context.signal?.reason), { once: true });
      }
    }

    const leaseContext: SandboxExecutionContext = {
      ...context,
      signal: leaseController.signal,
      leaseId,
    };

    void emitSandboxAuditEvent(leaseContext, 'sandbox-lease-created', resolvedPolicy, {
      requestKind: request.kind,
    });

    return {
      leaseId,
      hostKind: host.kind,
      policy: resolvedPolicy,
      signal: leaseController.signal,
      execute: async () => {
        const result = await host.execute(request, leaseContext, resolvedPolicy) as SandboxResultByKind[K];
        await emitSandboxAuditEvent(leaseContext, 'sandbox-lease-complete', resolvedPolicy, {
          requestKind: request.kind,
          success: typeof result === 'object' && result !== null && 'success' in result
            ? (result as { success?: unknown }).success
            : undefined,
        });
        return {
          hostKind: host.kind,
          policy: resolvedPolicy,
          result,
        };
      },
      cancel: (reason = 'cancelled') => {
        if (leaseController.signal.aborted) {
          return;
        }
        leaseController.abort(reason);
        void emitSandboxAuditEvent(leaseContext, 'sandbox-lease-cancelled', resolvedPolicy, {
          requestKind: request.kind,
          reason,
        });
      },
    };
  }

  async execute<K extends SandboxRequest['kind']>(
    request: Extract<SandboxRequest, { kind: K }>,
    context: SandboxExecutionContext,
    policy?: Partial<SandboxPolicy>,
  ): Promise<SandboxExecutionEnvelope<K>> {
    return this.createLease(request, context, policy).execute();
  }

  private resolvePolicy(
    request: SandboxRequest,
    policy?: Partial<SandboxPolicy>,
  ): SandboxPolicy {
    return {
      ...DEFAULT_SANDBOX_POLICIES[request.kind],
      ...policy,
    };
  }
}