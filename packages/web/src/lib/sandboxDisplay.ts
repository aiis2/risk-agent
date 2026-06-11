type SandboxRecord = Record<string, unknown>;

export interface SandboxSummaryOptions {
  includeLease?: boolean;
  includeState?: boolean;
  includeHost?: boolean;
  includeInteraction?: boolean;
  includePolicy?: boolean;
  includeOutcome?: boolean;
}

const SANDBOX_KEYS = new Set([
  'leaseId',
  'state',
  'cancelled',
  'hostKind',
  'entrypoint',
  'accessTier',
  'profile',
  'interaction',
  'filesystem',
  'network',
  'exitCode',
  'signal',
  'timedOut',
  'error',
]);

const AUDIT_DETAIL_KEYS = new Set([
  ...SANDBOX_KEYS,
  'sessionId',
  'runId',
  'taskId',
  'toolName',
  'requestKind',
  'command',
  'args',
  'cwd',
  'description',
  'durationMs',
  'reason',
  'success',
]);

function asRecord(value: unknown): SandboxRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SandboxRecord
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readMode(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  const record = asRecord(value);
  return record ? readString(record.mode) : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function summarizeModeWithHosts(label: string, mode: unknown, hostsValue: unknown): string | undefined {
  const resolvedMode = readMode(mode);
  if (!resolvedMode) {
    return undefined;
  }

  const hosts = readStringArray(asRecord(mode)?.allowHosts ?? hostsValue);
  if (hosts.length === 0) {
    return `${label} ${resolvedMode}`;
  }

  return `${label} ${resolvedMode} (${hosts.slice(0, 3).join(', ')})`;
}

export function readSandboxDescriptor(value: unknown): SandboxRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const nested = asRecord(record.sandbox);
  if (nested) {
    return readSandboxDescriptor(nested);
  }

  const hasSandboxShape = Object.keys(record).some((key) => SANDBOX_KEYS.has(key));
  return hasSandboxShape ? record : null;
}

export function mergeSandboxDescriptor(
  previous: SandboxRecord | null,
  incoming: unknown,
  overrides?: SandboxRecord,
): SandboxRecord | null {
  const next = readSandboxDescriptor(incoming);
  if (!previous && !next && !overrides) {
    return null;
  }

  const merged = {
    ...(previous ?? {}),
    ...(next ?? {}),
    ...(overrides ?? {}),
  };

  return readSandboxDescriptor(merged);
}

export function summarizeSandboxInline(
  value: unknown,
  options: SandboxSummaryOptions = {},
): string | undefined {
  const sandbox = readSandboxDescriptor(value);
  if (!sandbox) {
    return undefined;
  }

  const {
    includeLease = true,
    includeState = true,
    includeHost = true,
    includeInteraction = true,
    includePolicy = true,
    includeOutcome = true,
  } = options;

  const parts: string[] = [];
  const leaseId = readString(sandbox.leaseId);
  const state = readString(sandbox.state);
  const hostKind = readString(sandbox.hostKind);
  const interaction = readString(sandbox.interaction);
  const entrypoint = readString(sandbox.entrypoint);
  const accessTier = readString(sandbox.accessTier);
  const filesystem = summarizeModeWithHosts('fs', sandbox.filesystem, undefined);
  const network = summarizeModeWithHosts('net', sandbox.network, asRecord(sandbox.network)?.allowHosts);
  const exitCode = readNumber(sandbox.exitCode);
  const signal = readString(sandbox.signal);
  const timedOut = readBoolean(sandbox.timedOut);
  const cancelled = readBoolean(sandbox.cancelled);
  const error = readString(sandbox.error);

  if (includeLease && leaseId) parts.push(`lease ${leaseId}`);
  if (includeState && state) parts.push(state);
  if (includeHost && hostKind) parts.push(hostKind);
  if (includeHost && entrypoint) parts.push(entrypoint);
  if (includePolicy && accessTier) parts.push(`tier ${accessTier}`);
  if (includeInteraction && interaction) parts.push(interaction);
  if (includePolicy && filesystem) parts.push(filesystem);
  if (includePolicy && network) parts.push(network);
  if (includeOutcome && cancelled) parts.push('cancelled');
  if (includeOutcome && exitCode !== undefined) parts.push(`exit ${exitCode}`);
  if (includeOutcome && signal) parts.push(`signal ${signal}`);
  if (includeOutcome && timedOut) parts.push('timeout');
  if (includeOutcome && error) parts.push(error.length > 80 ? `${error.slice(0, 79)}…` : error);

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function summarizeSandboxCompact(value: unknown): string | undefined {
  return summarizeSandboxInline(value, {
    includeLease: true,
    includeState: true,
    includeHost: false,
    includeInteraction: true,
    includePolicy: false,
    includeOutcome: false,
  });
}

export function buildSandboxDetailLines(value: unknown): string[] {
  const sandbox = readSandboxDescriptor(value);
  if (!sandbox) {
    return [];
  }

  const filesystemMode = readMode(sandbox.filesystem);
  const networkMode = readMode(sandbox.network);
  const allowHosts = readStringArray(asRecord(sandbox.network)?.allowHosts);
  const lines = [
    readString(sandbox.leaseId) ? `租约：${readString(sandbox.leaseId)}` : undefined,
    readString(sandbox.state) ? `状态：${readString(sandbox.state)}` : undefined,
    readString(sandbox.hostKind) ? `主机：${readString(sandbox.hostKind)}` : undefined,
    readString(sandbox.entrypoint) ? `入口：${readString(sandbox.entrypoint)}` : undefined,
    readString(sandbox.accessTier) ? `能力层：${readString(sandbox.accessTier)}` : undefined,
    readString(sandbox.profile) ? `档位：${readString(sandbox.profile)}` : undefined,
    readString(sandbox.interaction) ? `交互：${readString(sandbox.interaction)}` : undefined,
    filesystemMode ? `文件系统：${filesystemMode}` : undefined,
    networkMode ? `网络：${allowHosts.length > 0 ? `${networkMode} (${allowHosts.slice(0, 3).join(', ')})` : networkMode}` : undefined,
    readBoolean(sandbox.cancelled) !== undefined ? `已取消：${readBoolean(sandbox.cancelled) ? '是' : '否'}` : undefined,
    readNumber(sandbox.exitCode) !== undefined ? `退出码：${readNumber(sandbox.exitCode)}` : undefined,
    readString(sandbox.signal) ? `信号：${readString(sandbox.signal)}` : undefined,
    readBoolean(sandbox.timedOut) ? '超时：是' : undefined,
    readString(sandbox.error) ? `错误：${readString(sandbox.error)}` : undefined,
  ];

  return lines.filter((line): line is string => Boolean(line));
}

export function buildSandboxAuditDetailLines(details: Record<string, unknown>): string[] {
  const knownLines = [
    ...buildSandboxDetailLines(details),
    readString(details.sessionId) ? `会话：${readString(details.sessionId)}` : undefined,
    readString(details.runId) ? `运行：${readString(details.runId)}` : undefined,
    readString(details.taskId) ? `任务：${readString(details.taskId)}` : undefined,
    readString(details.toolName) ? `工具：${readString(details.toolName)}` : undefined,
    readString(details.requestKind) ? `请求：${readString(details.requestKind)}` : undefined,
    readString(details.command)
      ? `命令：${[readString(details.command), ...readStringArray(details.args)].filter(Boolean).join(' ')}`
      : undefined,
    readString(details.cwd) ? `目录：${readString(details.cwd)}` : undefined,
    readString(details.description) ? `说明：${readString(details.description)}` : undefined,
    readNumber(details.durationMs) !== undefined ? `耗时：${readNumber(details.durationMs)} ms` : undefined,
    readString(details.reason) ? `原因：${readString(details.reason)}` : undefined,
    readBoolean(details.success) !== undefined ? `成功：${readBoolean(details.success) ? '是' : '否'}` : undefined,
  ];

  const extraLines = Object.entries(details)
    .filter(([key]) => !AUDIT_DETAIL_KEYS.has(key))
    .map(([key, value]) => {
      if (typeof value === 'string' && value.trim()) {
        return `${key}：${value.trim()}`;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return `${key}：${String(value)}`;
      }
      if (Array.isArray(value)) {
        const rendered = value
          .map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : 'item'))
          .slice(0, 4)
          .join(', ');
        return rendered ? `${key}：${rendered}` : undefined;
      }
      if (value && typeof value === 'object') {
        return `${key}：structured`;
      }
      return undefined;
    });

  return [...knownLines, ...extraLines].filter((line, index, array): line is string => Boolean(line) && array.indexOf(line) === index);
}