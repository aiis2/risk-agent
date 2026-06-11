import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fileWriteTool } from '../builtin/WorkerManagementTools.js';

describe('worker management tools', () => {
  it('creates a workspace-write lease for file_write when sandbox runtime is present', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-write',
        network: 'deny',
        interaction: 'none',
      },
      result: {
        success: true,
        stdout: JSON.stringify({
          path: resolve('D:/workspace/risk-agent/tmp/output.txt'),
          bytesWritten: 5,
        }),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 12,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-file-write-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-write',
        network: 'deny',
        interaction: 'none',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const result = await fileWriteTool.execute(
      {
        path: 'tmp/output.txt',
        content: 'hello',
      },
      {
        sessionId: 'sess-file-write-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-file-write-1',
          entrypoint: 'chat',
          toolName: 'file_write',
          cwd: 'D:/workspace/risk-agent',
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-write',
          network: 'deny',
          interaction: 'none',
        },
      },
    );

    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local-process',
        command: process.execPath,
        cwd: resolve('D:/workspace/risk-agent'),
      }),
      expect.objectContaining({
        entrypoint: 'chat',
        toolName: 'file_write',
        cwd: resolve('D:/workspace/risk-agent'),
      }),
      expect.objectContaining({
        hostKind: 'local-process',
        filesystem: 'workspace-write',
      }),
    );
    expect(result).toMatchObject({
      success: true,
      path: resolve('D:/workspace/risk-agent/tmp/output.txt'),
      bytesWritten: 5,
    });
  });
});