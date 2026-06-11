import { describe, expect, it, vi } from 'vitest';
import { gitScanTool } from '../builtin/GitScanTool.js';

describe('gitScanTool', () => {
  it('creates a local-process lease when a shared sandbox runtime is injected', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'none',
      },
      result: {
        success: true,
        stdout: '## main\n',
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 5,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-git-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'none',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });
    const onProgress = vi.fn();

    const result = await gitScanTool.execute(
      {
        operation: 'status',
        repoPath: 'D:/workspace/repo',
      },
      {
        sessionId: 'sess-git-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-git-1',
          entrypoint: 'chat',
          toolName: 'git_scan',
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'none',
        },
        onProgress,
      },
    );

    expect(createLease).toHaveBeenCalledWith(
      {
        kind: 'local-process',
        command: 'git',
        args: ['status', '--short', '--branch'],
        cwd: 'D:/workspace/repo',
        description: 'Inspect git repository status',
      },
      expect.objectContaining({
        sessionId: 'sess-git-1',
        entrypoint: 'chat',
        toolName: 'git_scan',
      }),
      expect.objectContaining({
        hostKind: 'local-process',
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'sandbox',
        sandbox: expect.objectContaining({
          leaseId: 'lease-git-1',
          state: 'lease-created',
        }),
      }),
    );
    expect(result).toMatchObject({
      operation: 'status',
      repoPath: 'D:/workspace/repo',
      success: true,
      exitCode: 0,
      stdout: '## main\n',
    });
  });
});