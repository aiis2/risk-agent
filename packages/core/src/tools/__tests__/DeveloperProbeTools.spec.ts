import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { packageManagerProbeTool, packageManagerWriteTool, packageProbeTool, processProbeTool, workspaceProbeTool } from '../builtin/DeveloperProbeTools.js';

describe('developer probe tools', () => {
  it('creates a local-process lease for workspace_probe', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      result: {
        success: true,
        stdout: JSON.stringify({ cwd: resolve('D:/workspace/risk-agent'), entries: [{ name: 'package.json', kind: 'file' }] }),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 8,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-workspace-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const result = await workspaceProbeTool.execute(
      {
        operation: 'list',
        cwd: 'D:/workspace/risk-agent',
      },
      {
        sessionId: 'sess-workspace-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-workspace-1',
          entrypoint: 'terminal-cli',
          toolName: 'workspace_probe',
          cwd: 'D:/workspace/risk-agent',
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'tty',
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
        entrypoint: 'terminal-cli',
        toolName: 'workspace_probe',
      }),
      expect.objectContaining({
        hostKind: 'local-process',
      }),
    );
    expect(result).toMatchObject({
      operation: 'list',
      cwd: resolve('D:/workspace/risk-agent'),
      entries: [{ name: 'package.json', kind: 'file' }],
    });
  });

  it('creates a local-process lease for package_probe', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      result: {
        success: true,
        stdout: JSON.stringify({
          packageJson: {
            name: 'risk-agent',
            version: '0.1.0',
            scriptsCount: 4,
            dependencyCount: 2,
          },
        }),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 6,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-package-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const result = await packageProbeTool.execute(
      {
        operation: 'summary',
        cwd: 'D:/workspace/risk-agent',
      },
      {
        sessionId: 'sess-package-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-package-1',
          entrypoint: 'terminal-cli',
          toolName: 'package_probe',
          cwd: 'D:/workspace/risk-agent',
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'tty',
        },
      },
    );

    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local-process',
        command: process.execPath,
      }),
      expect.objectContaining({
        toolName: 'package_probe',
      }),
      expect.objectContaining({
        interaction: 'tty',
      }),
    );
    expect(result).toMatchObject({
      operation: 'summary',
      packageJson: expect.objectContaining({
        name: 'risk-agent',
        version: '0.1.0',
      }),
    });
  });

  it('creates a local-process lease for process_probe', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      result: {
        success: true,
        stdout: JSON.stringify({ command: 'git', resolvedPath: 'C:/Program Files/Git/bin/git.exe' }),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 4,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-process-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const result = await processProbeTool.execute(
      {
        operation: 'which',
        command: 'git',
        cwd: 'D:/workspace/risk-agent',
      },
      {
        sessionId: 'sess-process-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-process-1',
          entrypoint: 'terminal-cli',
          toolName: 'process_probe',
          cwd: 'D:/workspace/risk-agent',
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'tty',
        },
      },
    );

    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local-process',
        command: process.execPath,
      }),
      expect.objectContaining({
        toolName: 'process_probe',
      }),
      expect.objectContaining({
        interaction: 'tty',
      }),
    );
    expect(result).toMatchObject({
      operation: 'which',
      command: 'git',
      resolvedPath: 'C:/Program Files/Git/bin/git.exe',
    });
  });

  it('creates a local-process lease for workspace_probe tree and search operations', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        hostKind: 'local-process',
        policy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'tty',
        },
        result: {
          success: true,
          stdout: JSON.stringify({
            cwd: resolve('D:/workspace/risk-agent'),
            targetPath: resolve('D:/workspace/risk-agent'),
            tree: [{ name: 'packages', kind: 'directory', children: [{ name: 'server', kind: 'directory' }] }],
          }),
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 9,
        },
      })
      .mockResolvedValueOnce({
        hostKind: 'local-process',
        policy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'tty',
        },
        result: {
          success: true,
          stdout: JSON.stringify({
            cwd: resolve('D:/workspace/risk-agent'),
            targetPath: resolve('D:/workspace/risk-agent'),
            query: 'terminal',
            matches: [{ path: 'packages/server/src/cli/terminal.ts', kind: 'file', reason: 'path' }],
          }),
          stderr: '',
          exitCode: 0,
          signal: null,
          durationMs: 11,
        },
      });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-workspace-advanced-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const commonContext = {
      sessionId: 'sess-workspace-advanced-1',
      sandboxRuntime: { createLease } as any,
      sandboxContext: {
        sessionId: 'sess-workspace-advanced-1',
        entrypoint: 'terminal-cli' as const,
        toolName: 'workspace_probe',
        cwd: 'D:/workspace/risk-agent',
      },
      sandboxPolicy: {
        hostKind: 'local-process' as const,
        filesystem: 'workspace-read' as const,
        network: 'deny' as const,
        interaction: 'tty' as const,
      },
    };

    const treeResult = await workspaceProbeTool.execute(
      {
        operation: 'tree',
        cwd: 'D:/workspace/risk-agent',
        maxDepth: 2,
      },
      commonContext,
    );
    const searchResult = await workspaceProbeTool.execute(
      {
        operation: 'search',
        cwd: 'D:/workspace/risk-agent',
        query: 'terminal',
      },
      commonContext,
    );

    expect(treeResult).toMatchObject({
      operation: 'tree',
      tree: [{ name: 'packages', kind: 'directory' }],
    });
    expect(searchResult).toMatchObject({
      operation: 'search',
      query: 'terminal',
      matches: [{ path: 'packages/server/src/cli/terminal.ts', reason: 'path' }],
    });
  });

  it('creates a local-process lease for package_manager_probe', async () => {
    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      result: {
        success: true,
        stdout: JSON.stringify({
          cwd: resolve('D:/workspace/risk-agent'),
          packageManager: {
            name: 'pnpm',
            versionRange: '9.0.0',
            lockfile: 'pnpm-lock.yaml',
          },
        }),
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 5,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-package-manager-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-read',
        network: 'deny',
        interaction: 'tty',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const result = await packageManagerProbeTool.execute(
      {
        operation: 'detect',
        cwd: 'D:/workspace/risk-agent',
      },
      {
        sessionId: 'sess-package-manager-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-package-manager-1',
          entrypoint: 'terminal-cli',
          toolName: 'package_manager_probe',
          cwd: 'D:/workspace/risk-agent',
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-read',
          network: 'deny',
          interaction: 'tty',
        },
      },
    );

    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local-process',
        command: process.execPath,
      }),
      expect.objectContaining({
        toolName: 'package_manager_probe',
      }),
      expect.objectContaining({
        interaction: 'tty',
      }),
    );
    expect(result).toMatchObject({
      operation: 'detect',
      packageManager: expect.objectContaining({
        name: 'pnpm',
        lockfile: 'pnpm-lock.yaml',
      }),
    });
  });

  it('creates a workspace-write local-process lease for package_manager_write', async () => {
    const packageRoot = resolve('D:/npm_work/risk_agent');

    expect(packageManagerWriteTool).toMatchObject({
      name: 'package_manager_write',
      isReadOnly: false,
      sandboxHostKind: 'local-process',
      sandboxAccessTier: 'interactive-write-capable',
    });

    const execute = vi.fn().mockResolvedValue({
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-write',
        network: 'deny',
        interaction: 'tty',
      },
      result: {
        success: true,
        stdout: 'dependencies updated',
        stderr: '',
        exitCode: 0,
        signal: null,
        durationMs: 28,
      },
    });
    const createLease = vi.fn().mockReturnValue({
      leaseId: 'lease-package-manager-write-1',
      hostKind: 'local-process',
      policy: {
        hostKind: 'local-process',
        filesystem: 'workspace-write',
        network: 'deny',
        interaction: 'tty',
      },
      signal: new AbortController().signal,
      execute,
      cancel: vi.fn(),
    });

    const result = await packageManagerWriteTool.execute(
      {
        operation: 'add',
        packages: ['lodash'],
        dev: true,
        cwd: packageRoot,
      },
      {
        sessionId: 'sess-package-manager-write-1',
        sandboxRuntime: { createLease } as any,
        sandboxContext: {
          sessionId: 'sess-package-manager-write-1',
          entrypoint: 'terminal-cli',
          toolName: 'package_manager_write',
          cwd: packageRoot,
        },
        sandboxPolicy: {
          hostKind: 'local-process',
          filesystem: 'workspace-write',
          network: 'deny',
          interaction: 'tty',
        },
      },
    );

    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'local-process',
        command: 'pnpm',
        args: ['add', 'lodash', '--save-dev'],
        cwd: packageRoot,
      }),
      expect.objectContaining({
        toolName: 'package_manager_write',
      }),
      expect.objectContaining({
        filesystem: 'workspace-write',
      }),
    );
    expect(result).toMatchObject({
      operation: 'add',
      packageManager: 'pnpm',
      command: 'pnpm',
      args: ['add', 'lodash', '--save-dev'],
      success: true,
      stdout: 'dependencies updated',
    });
  });
});