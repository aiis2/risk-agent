import { runJsSandbox } from './JsSandbox.js';
import type {
  SandboxExecutionContext,
  SandboxHost,
  SandboxPolicy,
  SandboxRequest,
  SandboxResultByKind,
} from './SandboxRuntime.js';

class JsSandboxHost implements SandboxHost {
  readonly kind = 'js-vm' as const;

  supports(request: SandboxRequest, _context: SandboxExecutionContext, policy: SandboxPolicy): boolean {
    return request.kind === 'javascript' && policy.hostKind === this.kind;
  }

  async execute(
    request: SandboxRequest,
    _context: SandboxExecutionContext,
    _policy: SandboxPolicy,
  ): Promise<SandboxResultByKind['javascript']> {
    if (request.kind !== 'javascript') {
      throw new Error(`JsSandboxHost cannot execute request kind "${request.kind}"`);
    }
    return runJsSandbox(request.code, request.inputData);
  }
}

export function createJsSandboxHost(): SandboxHost {
  return new JsSandboxHost();
}