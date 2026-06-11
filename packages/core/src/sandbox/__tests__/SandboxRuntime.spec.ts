import { describe, expect, it, vi } from 'vitest';
import { SandboxRuntime } from '../SandboxRuntime.js';
import { createJsSandboxHost } from '../JsSandboxHost.js';
import { createJsSandboxTool } from '../../tools/builtin/JsSandboxTool.js';

describe('SandboxRuntime', () => {
  it('routes javascript requests to the js-vm host', async () => {
    const runtime = new SandboxRuntime([createJsSandboxHost()]);

    const envelope = await runtime.execute(
      {
        kind: 'javascript',
        code: 'console.log("hello"); return 7;',
      },
      {
        sessionId: 'sess-1',
        entrypoint: 'tool',
      },
    );

    expect(envelope.hostKind).toBe('js-vm');
    expect(envelope.result.success).toBe(true);
    expect(envelope.result.output).toContain('hello');
    expect(envelope.result.returnValue).toBe(7);
  });

  it('rejects requests when no host supports them', async () => {
    const runtime = new SandboxRuntime([]);

    await expect(
      runtime.execute(
        { kind: 'javascript', code: 'return 1;' },
        { sessionId: 'sess-2', entrypoint: 'tool' },
      ),
    ).rejects.toThrow('No sandbox host available');
  });

  it('executes the built-in js sandbox tool through SandboxRuntime', async () => {
    const tool = createJsSandboxTool();

    const result = await tool.execute(
      { code: 'return 42;' },
      { sessionId: 'sess-3' },
    );

    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(42);
  });

  it('allows the js sandbox tool to delegate through an injected sandbox runtime', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'js-vm',
      policy: {
        hostKind: 'js-vm',
        filesystem: 'none',
        network: 'deny',
        interaction: 'none',
      },
      result: {
        success: true,
        output: '',
        returnValue: 99,
        durationMs: 1,
      },
    });

    const tool = createJsSandboxTool({ execute });
    const result = await tool.execute(
      { code: 'return 99;', description: 'delegated' },
      { sessionId: 'sess-4' },
    );

    expect(execute).toHaveBeenCalledWith(
      {
        kind: 'javascript',
        code: 'return 99;',
        inputData: undefined,
        description: 'delegated',
      },
      {
        sessionId: 'sess-4',
        entrypoint: 'tool',
        signal: undefined,
        trustLevel: 'builtin',
      },
      undefined,
    );
    expect(result.returnValue).toBe(99);
  });
});