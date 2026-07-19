import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const buildScriptPath = fileURLToPath(new URL('../../../../scripts/build.mjs', import.meta.url));

describe('workspace build orchestrator', () => {
  it('reuses the active package-manager CLI without a shell', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'risk-agent-build-runner-'));
    const packageManagerPath = join(fixtureDir, 'fake package manager.mjs');
    const pathPnpmPath = join(fixtureDir, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
    const invocationLogPath = join(fixtureDir, 'invocations.jsonl');
    writeFileSync(
      packageManagerPath,
      [
        "import { appendFileSync } from 'node:fs';",
        "const logPath = process.env.RISK_AGENT_BUILD_RUNNER_LOG;",
        "if (!logPath) throw new Error('missing build runner log path');",
        "appendFileSync(logPath, `${JSON.stringify(process.argv.slice(2))}\\n`, 'utf8');",
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      pathPnpmPath,
      process.platform === 'win32'
        ? '@echo PATH pnpm trap invoked 1>&2\r\n@exit /b 97\r\n'
        : '#!/bin/sh\nprintf "PATH pnpm trap invoked\\n" >&2\nexit 97\n',
      'utf8',
    );
    if (process.platform !== 'win32') chmodSync(pathPnpmPath, 0o755);

    const isolatedEnv: NodeJS.ProcessEnv = {};
    let inheritedPath = '';
    for (const [name, value] of Object.entries(process.env)) {
      const normalizedName = name.toLowerCase();
      if (normalizedName === 'path') {
        inheritedPath ||= value ?? '';
      } else if (normalizedName !== 'npm_execpath' && value !== undefined) {
        isolatedEnv[name] = value;
      }
    }
    isolatedEnv.PATH = inheritedPath
      ? `${fixtureDir}${delimiter}${inheritedPath}`
      : fixtureDir;
    isolatedEnv.npm_execpath = packageManagerPath;
    isolatedEnv.RISK_AGENT_BUILD_RUNNER_LOG = invocationLogPath;

    try {
      const result = spawnSync(process.execPath, [buildScriptPath], {
        encoding: 'utf8',
        env: isolatedEnv,
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      const invocations = readFileSync(invocationLogPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      expect(invocations).toEqual([
        ['--filter', '@risk-agent/core', 'build'],
        ['--filter', '@risk-agent/server', 'build'],
        ['--filter', '@risk-agent/web', 'build'],
      ]);
      expect(result.stderr).not.toContain('DEP0190');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
