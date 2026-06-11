/**
 * GitScanTool — Git 仓库扫描工具
 * （tech-stack.md §2.6 "simple-git — 克隆、拉取、日志"）
 *
 * 允许 Agent 查看 Git 仓库状态、历史日志、文件变更等信息。
 * 所有操作均为只读（不执行 push/commit/checkout 等破坏性命令）。
 */

import { simpleGit } from 'simple-git';
import type { AgentToolDefinition, ToolExecContext } from '../registry/ToolRegistry.js';
import type { LocalProcessSandboxRequest } from '../../sandbox/SandboxRuntime.js';

type GitOperation =
  | 'log'       // 提交历史
  | 'status'    // 工作区状态
  | 'diff'      // 文件差异
  | 'show'      // 查看某次提交
  | 'branches'  // 分支列表
  | 'tags'      // 标签列表
  | 'remote';   // 远程信息

interface GitScanInput {
  operation: GitOperation;
  repoPath: string;
  maxCount?: number;
  branch?: string;
  fromRef?: string;
  toRef?: string;
  filePath?: string;
  commitHash?: string;
}

function buildGitSandboxRequest(input: GitScanInput): LocalProcessSandboxRequest | { error: string } {
  const { operation, repoPath, maxCount = 20, branch, fromRef, toRef = 'HEAD', filePath, commitHash } = input;

  switch (operation) {
    case 'log':
      return {
        kind: 'local-process',
        command: 'git',
        args: [
          'log',
          `--max-count=${Math.min(Number(maxCount), 100)}`,
          '--pretty=format:%H%x1f%h%x1f%an%x1f%ai%x1f%s',
          ...(branch ? [branch] : []),
        ],
        cwd: repoPath,
        description: 'Inspect git commit history',
      };
    case 'status':
      return {
        kind: 'local-process',
        command: 'git',
        args: ['status', '--short', '--branch'],
        cwd: repoPath,
        description: 'Inspect git repository status',
      };
    case 'diff':
      return {
        kind: 'local-process',
        command: 'git',
        args: [
          'diff',
          ...(fromRef && toRef ? [`${fromRef}..${toRef}`] : fromRef ? [fromRef] : []),
          ...(filePath ? ['--', filePath] : []),
        ],
        cwd: repoPath,
        description: 'Inspect git diff output',
      };
    case 'show':
      if (!commitHash) {
        return { error: 'commitHash_required' };
      }
      return {
        kind: 'local-process',
        command: 'git',
        args: ['show', commitHash, '--stat', '--format=%H%n%an%n%ai%n%B'],
        cwd: repoPath,
        description: 'Inspect a git commit',
      };
    case 'branches':
      return {
        kind: 'local-process',
        command: 'git',
        args: ['branch', '-a', '-v', '--no-abbrev'],
        cwd: repoPath,
        description: 'Inspect git branches',
      };
    case 'tags':
      return {
        kind: 'local-process',
        command: 'git',
        args: ['tag', '--list'],
        cwd: repoPath,
        description: 'Inspect git tags',
      };
    case 'remote':
      return {
        kind: 'local-process',
        command: 'git',
        args: ['remote', '-v'],
        cwd: repoPath,
        description: 'Inspect git remotes',
      };
    default:
      return { error: 'unknown_operation' };
  }
}

async function executeWithSandbox(input: GitScanInput, ctx: ToolExecContext) {
  if (!ctx.sandboxRuntime || !ctx.sandboxContext) {
    return null;
  }

  const request = buildGitSandboxRequest(input);
  if ('error' in request) {
    return { error: request.error, operation: input.operation };
  }

  const lease = ctx.sandboxRuntime.createLease(
    request,
    {
      ...ctx.sandboxContext,
      toolName: ctx.sandboxContext.toolName ?? 'git_scan',
    },
    ctx.sandboxPolicy,
  );
  ctx.onProgress?.({
    phase: 'sandbox',
    message: 'lease created',
    sandbox: {
      leaseId: lease.leaseId,
      state: 'lease-created',
    },
  });

  const envelope = await lease.execute();
  const result = envelope.result;
  ctx.onProgress?.({
    phase: 'sandbox',
    message: result.cancelled ? 'lease cancelled' : result.success ? 'lease complete' : 'lease failed',
    sandbox: {
      leaseId: lease.leaseId,
      state: result.cancelled ? 'cancelled' : result.success ? 'completed' : 'failed',
      cancelled: result.cancelled,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      error: result.error,
    },
  });

  return {
    operation: input.operation,
    repoPath: input.repoPath,
    success: result.success,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    cancelled: result.cancelled,
    timedOut: result.timedOut,
    ...(result.error ? { error: result.error } : {}),
  };
}

export const gitScanTool: AgentToolDefinition = {
  name: 'git_scan',
  description:
    '只读 Git 仓库扫描工具。支持：log（提交历史）、status（工作区状态）、' +
    'diff（文件差异）、show（查看提交详情）、branches（分支列表）、tags（标签列表）、remote（远程信息）。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  sandboxProfile: 'local-process',
  sandboxHostKind: 'local-process',
  inputSchema: {
    type: 'object',
    required: ['operation', 'repoPath'],
    properties: {
      operation: {
        type: 'string',
        enum: ['log', 'status', 'diff', 'show', 'branches', 'tags', 'remote'],
        description: '操作类型'
      },
      repoPath: {
        type: 'string',
        description: 'Git 仓库本地绝对路径'
      },
      // log 参数
      maxCount: {
        type: 'number',
        description: '返回的最大提交条数（log 操作，默认 20）',
        default: 20
      },
      branch: {
        type: 'string',
        description: '指定分支（log 操作，默认当前分支）'
      },
      // diff 参数
      fromRef: {
        type: 'string',
        description: 'diff 起始引用（commit hash、分支名等）'
      },
      toRef: {
        type: 'string',
        description: 'diff 目标引用（默认 HEAD）'
      },
      filePath: {
        type: 'string',
        description: '限制 diff 范围到指定文件'
      },
      // show 参数
      commitHash: {
        type: 'string',
        description: '要查看的提交 hash（show 操作）'
      }
    }
  },

  async execute(input, ctx) {
    const {
      operation,
      repoPath,
      maxCount = 20,
      branch,
      fromRef,
      toRef = 'HEAD',
      filePath,
      commitHash
    } = input as GitScanInput;

    const sandboxResult = await executeWithSandbox({
      operation,
      repoPath,
      maxCount,
      branch,
      fromRef,
      toRef,
      filePath,
      commitHash,
    }, ctx);
    if (sandboxResult) {
      return sandboxResult;
    }

    const git = simpleGit(repoPath, { binary: 'git' });

    // 验证是否是 git 仓库
    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
      return { error: 'not_a_git_repo', repoPath };
    }

    try {
      switch (operation) {
        case 'log': {
          const options: Record<string, unknown> = {
            maxCount: Math.min(Number(maxCount), 100),
            format: {
              hash: '%H',
              abbrevHash: '%h',
              author: '%an',
              date: '%ai',
              message: '%s'
            }
          };
          if (branch) options['--'] = [branch];

          const log = await git.log(options);
          return {
            operation,
            repoPath,
            branch: branch ?? 'current',
            count: log.all.length,
            commits: log.all
          };
        }

        case 'status': {
          const status = await git.status();
          return {
            operation,
            repoPath,
            branch: status.current,
            tracking: status.tracking,
            ahead: status.ahead,
            behind: status.behind,
            staged: status.staged,
            modified: status.modified,
            created: status.created,
            deleted: status.deleted,
            untracked: status.not_added,
            conflicted: status.conflicted,
            isClean: status.isClean()
          };
        }

        case 'diff': {
          const diffArgs: string[] = [];
          if (fromRef && toRef) {
            diffArgs.push(`${fromRef}..${toRef}`);
          } else if (fromRef) {
            diffArgs.push(fromRef);
          }
          if (filePath) diffArgs.push('--', filePath);

          const diff = await git.diff(diffArgs);
          // Truncate large diffs
          const maxLen = 10_000;
          const truncated = diff.length > maxLen;
          return {
            operation,
            repoPath,
            fromRef: fromRef ?? 'working tree',
            toRef: toRef ?? 'HEAD',
            filePath,
            truncated,
            diff: truncated ? diff.slice(0, maxLen) + '\n\n[...truncated]' : diff
          };
        }

        case 'show': {
          if (!commitHash) return { error: 'commitHash_required' };
          const show = await git.show([commitHash, '--stat', '--format=%H%n%an%n%ai%n%B']);
          const maxLen = 10_000;
          return {
            operation,
            repoPath,
            commitHash,
            output: show.length > maxLen ? show.slice(0, maxLen) + '\n[...truncated]' : show
          };
        }

        case 'branches': {
          const branchSummary = await git.branch(['-a', '-v']);
          return {
            operation,
            repoPath,
            current: branchSummary.current,
            branches: Object.values(branchSummary.branches).map((b) => ({
              name: b.name,
              commit: b.commit,
              label: b.label,
              current: b.current
            }))
          };
        }

        case 'tags': {
          const tags = await git.tags();
          return {
            operation,
            repoPath,
            count: tags.all.length,
            tags: tags.all.slice(-50) // last 50 tags
          };
        }

        case 'remote': {
          const remotes = await git.getRemotes(true);
          return {
            operation,
            repoPath,
            remotes: remotes.map((r) => ({
              name: r.name,
              fetch: r.refs.fetch,
              push: r.refs.push
            }))
          };
        }

        default:
          return { error: 'unknown_operation', operation };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: 'git_error', operation, message: msg };
    }
  }
};
