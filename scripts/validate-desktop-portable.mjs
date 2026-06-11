#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmpRoot = resolve(workspaceRoot, 'tmp');
const stageNamePrefix = 'npm-desktop-stage';
const legacyStageDir = resolve(tmpRoot, stageNamePrefix);
const legacyReleaseDir = resolve(legacyStageDir, 'release');
const latestPortableInfoPath = resolve(tmpRoot, `${stageNamePrefix}-latest.json`);
const require = createRequire(import.meta.url);

const STARTUP_TIMEOUT_MS = Number(process.env.RISK_AGENT_PORTABLE_STARTUP_TIMEOUT_MS ?? 60000);
const POLL_INTERVAL_MS = Number(process.env.RISK_AGENT_PORTABLE_STARTUP_POLL_MS ?? 1000);
const HTTP_TIMEOUT_MS = Number(process.env.RISK_AGENT_PORTABLE_HTTP_TIMEOUT_MS ?? 3000);

function log(tag, message) {
  process.stdout.write(`[portable-smoke:${tag}] ${message}\n`);
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, `''`)}'`;
}

function sleep(timeoutMs) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, timeoutMs);
  });
}

function normalizeJsonArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

async function runPowerShell(command) {
  const { stdout } = await execFile(
    'powershell.exe',
    ['-NoProfile', '-Command', command],
    {
      cwd: workspaceRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    },
  );
  return stdout.trim();
}

async function runPowerShellJson(command) {
  const stdout = await runPowerShell(command);
  if (!stdout) {
    return [];
  }

  return normalizeJsonArray(JSON.parse(stdout));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function loadPortableProbeHelpers() {
  const helperPath = resolve(workspaceRoot, 'packages/desktop/dist/portable/PortableStartupProbe.js');
  if (!existsSync(helperPath)) {
    throw new Error('portable probe helper is missing. Run `pnpm --filter @risk-agent/desktop build` or `pnpm package:desktop:portable` first.');
  }

  return require(helperPath);
}

async function findPortableExecutableInReleaseDir(directoryPath) {
  if (!existsSync(directoryPath)) {
    return null;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const portableFile = entries.find((entry) => entry.isFile() && /^Risk Agent .*\.exe$/i.test(entry.name));

  if (!portableFile) {
    return null;
  }

  return join(directoryPath, portableFile.name);
}

async function resolvePortableExecutableFromLatestManifest() {
  if (!existsSync(latestPortableInfoPath)) {
    return null;
  }

  try {
    const latestPortableInfo = await readJson(latestPortableInfoPath);
    if (!latestPortableInfo?.artifactPath) {
      return null;
    }

    const artifactPath = resolve(latestPortableInfo.artifactPath);
    return existsSync(artifactPath) ? artifactPath : null;
  } catch {
    return null;
  }
}

async function resolveNewestPortableExecutableFromStageDirs() {
  const entries = await readdir(tmpRoot, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  });

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (!(entry.name === stageNamePrefix || entry.name.startsWith(`${stageNamePrefix}-`))) {
      continue;
    }

    const artifactPath = await findPortableExecutableInReleaseDir(join(tmpRoot, entry.name, 'release'));
    if (!artifactPath) {
      continue;
    }

    const artifactStat = await stat(artifactPath);
    candidates.push({
      artifactPath,
      mtimeMs: artifactStat.mtimeMs,
    });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.artifactPath ?? null;
}

async function resolvePortableExecutablePath() {
  if (process.env.RISK_AGENT_PORTABLE_EXE) {
    const portablePath = resolve(process.env.RISK_AGENT_PORTABLE_EXE);
    if (!existsSync(portablePath)) {
      throw new Error(`portable executable not found: ${portablePath}`);
    }
    return portablePath;
  }

  const portableFromManifest = await resolvePortableExecutableFromLatestManifest();
  if (portableFromManifest) {
    return portableFromManifest;
  }

  const legacyPortable = await findPortableExecutableInReleaseDir(legacyReleaseDir);
  if (legacyPortable) {
    return legacyPortable;
  }

  const newestPortable = await resolveNewestPortableExecutableFromStageDirs();
  if (newestPortable) {
    return newestPortable;
  }

  throw new Error(`portable executable not found under: ${tmpRoot}`);
}

async function listSystemProcesses() {
  return runPowerShellJson(`
    $items = Get-CimInstance Win32_Process |
      Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine
    if ($items) {
      $items | ConvertTo-Json -Compress
    }
  `);
}

async function cleanupPortableValidationProcesses(portableExecutablePath) {
  const portableDirectoryPattern = `*${dirname(portableExecutablePath)}*`;

  await runPowerShell(`
    $targets = Get-CimInstance Win32_Process |
      Where-Object {
        $_.ExecutablePath -like ${quotePowerShell(portableDirectoryPattern)} -or
        $_.CommandLine -like ${quotePowerShell(portableDirectoryPattern)} -or
        ($_.Name -eq 'Risk Agent.exe' -and $_.CommandLine -like '*\\Temp\\*')
      }
    foreach ($target in $targets) {
      Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
    }
  `).catch(() => {
    // Best-effort only. Validation can still succeed without pre-cleanup.
  });
}

async function launchPortableExecutable(portableExecutablePath) {
  const stdout = await runPowerShell(`
    $process = Start-Process -FilePath ${quotePowerShell(portableExecutablePath)} -WorkingDirectory ${quotePowerShell(dirname(portableExecutablePath))} -PassThru
    $process.Id
  `);

  const launcherProcessId = Number(stdout.trim());
  if (!Number.isFinite(launcherProcessId) || launcherProcessId <= 0) {
    throw new Error(`portable launcher did not return a valid process id: ${stdout}`);
  }

  return launcherProcessId;
}

async function listListenersForProcessTree(processIds) {
  if (processIds.length === 0) {
    return [];
  }

  const processIdExpression = processIds.join(',');
  return runPowerShellJson(`
    $ids = @(${processIdExpression})
    $items = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.OwningProcess -in $ids } |
      Select-Object LocalAddress, LocalPort, OwningProcess
    if ($items) {
      $items | ConvertTo-Json -Compress
    }
  `);
}

async function probeHttpPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return {
      port,
      statusCode: response.status,
      body: await response.text(),
    };
  } catch (error) {
    return {
      port,
      statusCode: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

async function stopPortableProcessTree(launcherProcessId, collectDescendantProcessIds) {
  const { normalizePortableProcesses } = loadPortableProbeHelpers();
  const processes = normalizePortableProcesses(await listSystemProcesses());
  const processIds = collectDescendantProcessIds(launcherProcessId, processes);
  if (processIds.length === 0) {
    return;
  }

  await runPowerShell(`
    $ids = @(${processIds.join(',')}) | Sort-Object -Descending
    foreach ($id in $ids) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
  `);
}

async function waitForPortableUiEndpoint(
  launcherProcessId,
  selectPortableUiEndpoint,
  collectDescendantProcessIds,
  normalizePortableProcesses,
  normalizePortableListeners,
) {
  const startedAt = Date.now();
  let lastSnapshot = {
    processIds: [],
    listeners: [],
    probes: [],
  };

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    const processes = normalizePortableProcesses(await listSystemProcesses());
    const processIds = collectDescendantProcessIds(launcherProcessId, processes);
    const listeners = normalizePortableListeners(await listListenersForProcessTree(processIds));
    const probes = await Promise.all(
      listeners.map((listener) => probeHttpPort(listener.localPort)),
    );

    lastSnapshot = {
      processIds,
      listeners,
      probes: probes.map((probe) => ({
        port: probe.port,
        statusCode: probe.statusCode,
      })),
    };

    const endpoint = selectPortableUiEndpoint({
      launcherProcessId,
      processes,
      listeners,
      probes,
    });

    if (endpoint) {
      return {
        elapsedMs: Date.now() - startedAt,
        endpoint,
        lastSnapshot,
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return {
    elapsedMs: Date.now() - startedAt,
    endpoint: null,
    lastSnapshot,
  };
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('portable smoke validation only supports Windows hosts.');
  }

  const {
    collectDescendantProcessIds,
    normalizePortableListeners,
    normalizePortableProcesses,
    selectPortableUiEndpoint,
  } = loadPortableProbeHelpers();
  const portableExecutablePath = await resolvePortableExecutablePath();
  await cleanupPortableValidationProcesses(portableExecutablePath);

  log('start', `launching ${portableExecutablePath}`);
  const launcherProcessId = await launchPortableExecutable(portableExecutablePath);

  try {
    const result = await waitForPortableUiEndpoint(
      launcherProcessId,
      selectPortableUiEndpoint,
      collectDescendantProcessIds,
      normalizePortableProcesses,
      normalizePortableListeners,
    );

    if (!result.endpoint) {
      throw new Error(
        `portable UI endpoint was not detected within ${STARTUP_TIMEOUT_MS}ms; `
          + `launcherPid=${launcherProcessId}; `
          + `lastSnapshot=${JSON.stringify(result.lastSnapshot)}`,
      );
    }

    log('pass', `detected UI on http://127.0.0.1:${result.endpoint.port}/ (pid=${result.endpoint.owningProcess}, elapsedMs=${result.elapsedMs})`);
  } finally {
    await stopPortableProcessTree(launcherProcessId, collectDescendantProcessIds).catch((error) => {
      log('warn', `failed to stop portable process tree: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});