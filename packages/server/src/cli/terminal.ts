import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { RunEvent, RunSnapshot } from '@risk-agent/core';
import { TerminalOwnershipStore } from './terminalOwnership.js';
import { TerminalRunClient, resolveOwnedRunTarget } from './terminalClient.js';

type CliMode = 'create' | 'resume' | 'append' | 'interrupt' | 'status' | 'help' | 'repl';

interface ParsedArgs {
  readonly mode: CliMode;
  readonly baseUrl: string;
  readonly workspaceRoot: string;
  readonly statePath: string;
  readonly explicitRunId?: string;
  readonly modelId?: string;
  readonly toolIds: string[];
  readonly prompt?: string;
  readonly message?: string;
}

interface StreamSummary {
  sawTextOutput: boolean;
  finalStatus?: string;
  waitingUserPrompt?: WaitingUserPrompt;
}

interface WaitingUserPrompt {
  runId: string;
  question: string;
  options: string[];
  promptKind?: string;
  checkpoint?: Record<string, unknown>;
  approval?: {
    approveLabel?: string;
    denyLabel?: string;
  };
}

interface ReplState {
  currentRunId?: string;
  waitingUserPrompt?: WaitingUserPrompt;
  skipEventIdsByRunId: Map<string, Set<string>>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') {
    printUsage();
    return;
  }

  const ownershipStore = new TerminalOwnershipStore(args.statePath);
  const client = new TerminalRunClient({
    baseUrl: args.baseUrl,
    workspaceRoot: args.workspaceRoot,
    ownershipStore,
  });

  const ownedRunId = resolveOwnedRunTarget({
    baseUrl: args.baseUrl,
    workspaceRoot: args.workspaceRoot,
    ownershipStore,
    explicitRunId: args.explicitRunId,
  });

  if (args.mode === 'repl') {
    await startRepl(args, client, ownedRunId);
    return;
  }

  if (args.mode === 'interrupt') {
    if (!ownedRunId) {
      throw new Error('No owned run found. Use --run <id> or create a terminal-cli run first.');
    }
    await client.cancelRun(ownedRunId);
    process.stderr.write(`[interrupt] requested for ${ownedRunId}\n`);
    return;
  }

  if (args.mode === 'status') {
    if (!ownedRunId) {
      throw new Error('No owned run found. Use --run <id> or create a terminal-cli run first.');
    }
    const snapshot = await client.getRun(ownedRunId);
    process.stdout.write(JSON.stringify({
      runId: snapshot.runId,
      status: snapshot.status,
      taskKind: snapshot.taskKind,
      updatedAt: snapshot.updatedAt,
    }, null, 2));
    process.stdout.write('\n');
    return;
  }

  let runId: string | undefined;
  let skipEventIds = new Set<string>();

  if (args.mode === 'append') {
    if (!ownedRunId) {
      throw new Error('No owned run found. Use --run <id> or create a terminal-cli run first.');
    }
    const existingRun = await hydrateRunState(client, ownedRunId, skipEventIds);
    const content = args.message ?? args.prompt ?? '';
    if (existingRun.snapshot.status === 'waiting_user') {
      await client.submitInput(ownedRunId, { input: content });
    } else {
      await client.appendMessage(ownedRunId, {
        content,
        modelId: args.modelId,
        toolIds: args.toolIds,
        mode: 'stop-and-send',
      });
    }
    runId = ownedRunId;
  }

  if (args.mode === 'create') {
    const created = await client.createRun({
      prompt: args.prompt ?? '',
      modelId: args.modelId,
      toolIds: args.toolIds,
    });
    runId = created.runId;
  }

  if (args.mode === 'resume') {
    if (!ownedRunId) {
      throw new Error('No owned run found. Use --run <id> or create a terminal-cli run first.');
    }
    client.markOwnership(ownedRunId);
    runId = ownedRunId;
  }

  if (!runId) {
    throw new Error('No run selected. Use --help to inspect the supported terminal-cli commands.');
  }

  const summary = await streamRunToStdout(client, runId, skipEventIds, { stopOnWaitingUser: true });
  if (!summary.sawTextOutput && summary.finalStatus === 'completed') {
    const fallbackResponse = await readStructuredAnswerFallback(client, runId);
    if (fallbackResponse) {
      process.stdout.write(`${fallbackResponse.trim()}\n`);
    }
  }
  if (summary.waitingUserPrompt) {
    process.stderr.write('[resume] run is waiting for input. Answer in the REPL or rerun with --resume "your input".\n');
  }
}

async function startRepl(
  args: ParsedArgs,
  client: TerminalRunClient,
  ownedRunId?: string,
): Promise<void> {
  const state: ReplState = {
    currentRunId: ownedRunId,
    skipEventIdsByRunId: new Map(),
  };
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
    historySize: 200,
  });

  readline.on('SIGINT', () => {
    process.stderr.write('\n[repl] use /interrupt to cancel the active run or /exit to leave the REPL.\n');
  });

  process.stderr.write('risk-agent terminal cli repl\n');
  process.stderr.write('type /help for commands\n');

  try {
    if (ownedRunId) {
      const existingRun = await attachRunToRepl(client, state, ownedRunId);
      process.stderr.write(`[repl] attached ${ownedRunId} (${existingRun.snapshot.status})\n`);
      if (existingRun.waitingUserPrompt) {
        renderWaitingUserPrompt(existingRun.waitingUserPrompt);
      }
    }

    if (args.prompt?.trim()) {
      await handleReplLine(args.prompt.trim(), args, client, state);
    }

    while (true) {
      const line = await askQuestion(readline, buildReplPrompt(state));
      if (isInterfaceClosed(readline) && !line.trim()) {
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const shouldExit = await handleReplLine(trimmed, args, client, state);
      if (shouldExit) {
        return;
      }
    }
  } finally {
    readline.close();
  }
}

async function handleReplLine(
  line: string,
  args: ParsedArgs,
  client: TerminalRunClient,
  state: ReplState,
): Promise<boolean> {
  if (line.startsWith('/')) {
    return handleReplCommand(line, client, state);
  }

  let runId = state.currentRunId;
  if (state.waitingUserPrompt && runId) {
    state.waitingUserPrompt = undefined;
    await client.submitInput(runId, { input: line });
    await followRunUntilYield(client, state, runId);
    return false;
  }

  if (!runId) {
    const created = await client.createRun({
      prompt: line,
      modelId: args.modelId,
      toolIds: args.toolIds,
    });
    runId = created.runId;
    state.currentRunId = runId;
  } else {
    await client.appendMessage(runId, {
      content: line,
      modelId: args.modelId,
      toolIds: args.toolIds,
      mode: 'stop-and-send',
    });
  }

  await followRunUntilYield(client, state, runId);
  return false;
}

async function handleReplCommand(
  line: string,
  client: TerminalRunClient,
  state: ReplState,
): Promise<boolean> {
  const [command, ...rest] = line.split(/\s+/);
  const argument = rest.join(' ').trim();

  switch (command) {
    case '/help':
      printReplUsage();
      return false;
    case '/exit':
    case '/quit':
      return true;
    case '/new':
      state.currentRunId = undefined;
      state.waitingUserPrompt = undefined;
      process.stderr.write('[repl] cleared the active run. The next prompt will create a new run.\n');
      return false;
    case '/status': {
      const runId = argument || state.currentRunId;
      if (!runId) {
        process.stderr.write('[repl] no active run.\n');
        return false;
      }
      const snapshot = await client.getRun(runId);
      process.stdout.write(JSON.stringify({
        runId: snapshot.runId,
        status: snapshot.status,
        taskKind: snapshot.taskKind,
        updatedAt: snapshot.updatedAt,
      }, null, 2));
      process.stdout.write('\n');
      return false;
    }
    case '/interrupt': {
      const runId = argument || state.currentRunId;
      if (!runId) {
        process.stderr.write('[repl] no active run to interrupt.\n');
        return false;
      }
      await client.cancelRun(runId);
      state.waitingUserPrompt = undefined;
      process.stderr.write(`[interrupt] requested for ${runId}\n`);
      return false;
    }
    case '/resume':
    case '/run': {
      const runId = argument || state.currentRunId;
      if (!runId) {
        process.stderr.write('[repl] no run id available to resume.\n');
        return false;
      }
      const existingRun = await attachRunToRepl(client, state, runId);
      process.stderr.write(`[repl] attached ${runId} (${existingRun.snapshot.status})\n`);
      if (existingRun.waitingUserPrompt) {
        renderWaitingUserPrompt(existingRun.waitingUserPrompt);
        return false;
      }
      if (isStreamingStatus(existingRun.snapshot.status)) {
        await followRunUntilYield(client, state, runId);
      }
      return false;
    }
    default:
      process.stderr.write(`[repl] unknown command ${command}. Type /help.\n`);
      return false;
  }
}

async function attachRunToRepl(
  client: TerminalRunClient,
  state: ReplState,
  runId: string,
): Promise<{ snapshot: RunSnapshot; waitingUserPrompt?: WaitingUserPrompt }> {
  state.currentRunId = runId;
  const skipEventIds = getSkipEventIds(state, runId);
  const hydrated = await hydrateRunState(client, runId, skipEventIds);
  state.waitingUserPrompt = hydrated.waitingUserPrompt;
  return hydrated;
}

async function followRunUntilYield(
  client: TerminalRunClient,
  state: ReplState,
  runId: string,
): Promise<StreamSummary> {
  const summary = await streamRunToStdout(client, runId, getSkipEventIds(state, runId), { stopOnWaitingUser: true });
  state.currentRunId = runId;
  state.waitingUserPrompt = summary.waitingUserPrompt;
  return summary;
}

function getSkipEventIds(state: ReplState, runId: string): Set<string> {
  const existing = state.skipEventIdsByRunId.get(runId);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  state.skipEventIdsByRunId.set(runId, created);
  return created;
}

function buildReplPrompt(state: ReplState): string {
  if (state.waitingUserPrompt) {
    return `input:${shortRunId(state.waitingUserPrompt.runId)}> `;
  }
  if (state.currentRunId) {
    return `run:${shortRunId(state.currentRunId)}> `;
  }
  return 'risk-agent> ';
}

function shortRunId(runId: string): string {
  return runId.length > 10 ? runId.slice(-10) : runId;
}

function askQuestion(readline: Interface, prompt: string): Promise<string> {
  return new Promise((resolveQuestion) => {
    readline.question(prompt, resolveQuestion);
  });
}

function isInterfaceClosed(readline: Interface): boolean {
  return Boolean((readline as Interface & { closed?: boolean }).closed);
}

function printReplUsage(): void {
  process.stderr.write([
    'REPL commands:',
    '  /help               show this help',
    '  /status [runId]     inspect the active run or a specific run',
    '  /resume [runId]     attach to an owned or explicit run and continue streaming',
    '  /run <runId>        shorthand for /resume <runId>',
    '  /interrupt [runId]  cancel the active run or a specific run',
    '  /new                clear the active run so the next prompt starts fresh',
    '  /exit               leave the REPL',
    '',
  ].join('\n'));
}

function parseArgs(argv: string[]): ParsedArgs {
  const defaultBaseUrl = process.env.RISK_AGENT_SERVER_URL?.trim() || 'http://127.0.0.1:8787';
  const workspaceRoot = resolve(process.cwd());
  const statePath = process.env.RISK_AGENT_TERMINAL_STATE?.trim() || join(homedir(), '.risk-agent', 'terminal-cli-state.json');

  let explicitRunId: string | undefined;
  let modelId: string | undefined;
  let message: string | undefined;
  let baseUrl = defaultBaseUrl;
  const toolIds: string[] = [];
  let requestedResume = false;
  let requestedInterrupt = false;
  let requestedStatus = false;
  let requestedRepl = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return {
        mode: 'help',
        baseUrl,
        workspaceRoot,
        statePath,
        toolIds,
      };
    }
    if (arg === '--resume') {
      requestedResume = true;
      continue;
    }
    if (arg === '--repl') {
      requestedRepl = true;
      continue;
    }
    if (arg === '--interrupt') {
      requestedInterrupt = true;
      continue;
    }
    if (arg === '--status') {
      requestedStatus = true;
      continue;
    }
    if (arg === '--run') {
      explicitRunId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg === '--model') {
      modelId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg === '--message') {
      message = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      baseUrl = argv[index + 1]?.trim() || baseUrl;
      index += 1;
      continue;
    }
    if (arg === '--tool') {
      const raw = argv[index + 1] ?? '';
      toolIds.push(...raw.split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  const prompt = positional.join(' ').trim() || undefined;
  const normalizedMessage = message?.trim() || undefined;

  if (requestedRepl) {
    return { mode: 'repl', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds, prompt, message: normalizedMessage };
  }

  if (requestedInterrupt) {
    return { mode: 'interrupt', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds, prompt, message: normalizedMessage };
  }
  if (requestedStatus) {
    return { mode: 'status', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds, prompt, message: normalizedMessage };
  }
  if (normalizedMessage || (requestedResume && prompt) || (explicitRunId && prompt)) {
    return { mode: 'append', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds, prompt, message: normalizedMessage };
  }
  if (requestedResume || explicitRunId) {
    return { mode: 'resume', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds, prompt, message: normalizedMessage };
  }
  if (prompt) {
    return { mode: 'create', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds, prompt, message: normalizedMessage };
  }

  return { mode: 'repl', baseUrl, workspaceRoot, statePath, explicitRunId, modelId, toolIds };
}

async function streamRunToStdout(
  client: TerminalRunClient,
  runId: string,
  skipEventIds: Set<string>,
  options?: {
    stopOnWaitingUser?: boolean;
  },
): Promise<StreamSummary> {
  const abortController = new AbortController();
  let sawTextOutput = false;
  let finalStatus: string | undefined;
  let interruptRequested = false;
  let waitingUserPrompt: WaitingUserPrompt | undefined;

  const sigintHandler = () => {
    if (interruptRequested) {
      process.exitCode = 130;
      abortController.abort('user_cancelled');
      return;
    }

    interruptRequested = true;
    process.stderr.write(`\n[interrupt] cancelling ${runId}...\n`);
    void client.cancelRun(runId)
      .catch((error) => {
        process.stderr.write(`[interrupt] ${readErrorMessage(error)}\n`);
      })
      .finally(() => {
        abortController.abort('user_cancelled');
        process.exitCode = 130;
      });
  };

  process.on('SIGINT', sigintHandler);

  try {
    for await (const event of client.streamRun(runId, {
      signal: abortController.signal,
      stopWhen: (currentEvent) => options?.stopOnWaitingUser === true && currentEvent.type === 'waiting_user',
    })) {
      if (event.eventId && skipEventIds.has(event.eventId)) {
        continue;
      }
      if (event.eventId) {
        skipEventIds.add(event.eventId);
      }

      if (event.type === 'waiting_user') {
        waitingUserPrompt = toWaitingUserPrompt(runId, event);
      }

      const rendered = renderRunEvent(event);
      if (rendered.stdout) {
        process.stdout.write(rendered.stdout);
      }
      if (rendered.stderr) {
        process.stderr.write(rendered.stderr);
      }
      sawTextOutput ||= rendered.didWriteText;

      if (event.type === 'run_completed') {
        finalStatus = 'completed';
      }
      if (event.type === 'run_failed') {
        finalStatus = 'failed';
      }
      if (event.type === 'run_cancelled') {
        finalStatus = 'cancelled';
      }
      if (event.type === 'run_status') {
        const payload = asRecord(event.payload);
        if (typeof payload.status === 'string') {
          finalStatus = payload.status;
        }
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      process.stderr.write(`[stream] ${readErrorMessage(error)}\n`);
      process.stderr.write(`[stream] resume with --resume or --run ${runId}\n`);
    }
  } finally {
    process.off('SIGINT', sigintHandler);
  }

  const snapshot = await client.getRun(runId).catch(() => null);
  const resolvedStatus = snapshot?.status ?? finalStatus;
  if (resolvedStatus) {
    process.stderr.write(`[run] ${runId} ${resolvedStatus}\n`);
  }

  return {
    sawTextOutput,
    finalStatus: resolvedStatus,
    waitingUserPrompt,
  };
}

async function hydrateRunState(
  client: TerminalRunClient,
  runId: string,
  skipEventIds: Set<string>,
): Promise<{ snapshot: RunSnapshot; waitingUserPrompt?: WaitingUserPrompt }> {
  const [snapshot, events] = await Promise.all([
    client.getRun(runId),
    client.getRunEvents(runId).catch(() => [] as RunEvent[]),
  ]);

  for (const event of events) {
    if (event.eventId) {
      skipEventIds.add(event.eventId);
    }
  }

  return {
    snapshot,
    waitingUserPrompt: snapshot.status === 'waiting_user' ? extractWaitingUserPrompt(runId, events) : undefined,
  };
}

async function readStructuredAnswerFallback(client: TerminalRunClient, runId: string): Promise<string | null> {
  const artifacts = await client.getRunArtifacts(runId).catch(() => []);
  const answer = artifacts.find((artifact) => artifact.kind === 'structured-answer');
  const content = asRecord(answer?.contentJson);
  if (!content) {
    return null;
  }

  const candidates = [content.response, content.summary, content.overview, content.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function renderRunEvent(event: { type: string; payload?: unknown }): { stdout?: string; stderr?: string; didWriteText: boolean } {
  const payload = asRecord(event.payload);

  switch (event.type) {
    case 'text_delta':
    case 'thinking_delta': {
      const text = typeof payload.delta === 'string' ? payload.delta : typeof payload.text === 'string' ? payload.text : '';
      return text ? { stdout: text, didWriteText: true } : { didWriteText: false };
    }
    case 'run_completed':
      return { stderr: '\n[completed]\n', didWriteText: false };
    case 'run_failed':
      return { stderr: `\n[failed] ${stringOrFallback(payload.error, 'unknown_error')}\n`, didWriteText: false };
    case 'run_cancelled':
      return { stderr: `\n[cancelled] ${stringOrFallback(payload.reason, 'user_cancelled')}\n`, didWriteText: false };
    case 'tool_start':
      return { stderr: `[tool:start] ${stringOrFallback(payload.toolName ?? payload.name, 'unknown_tool')}\n`, didWriteText: false };
    case 'tool_complete':
      return { stderr: `[tool:done] ${stringOrFallback(payload.toolName ?? payload.name, 'unknown_tool')}\n`, didWriteText: false };
    case 'tool_error':
      return { stderr: `[tool:error] ${stringOrFallback(payload.toolName ?? payload.name, 'unknown_tool')} | ${stringOrFallback(payload.error, 'unknown_error')}\n`, didWriteText: false };
    case 'waiting_user':
      return {
        stderr: `${payload.promptKind === 'approval' ? '[approval] required\n' : ''}[input] ${stringOrFallback(payload.question ?? payload.message, 'input required')}\n`,
        didWriteText: false,
      };
    case 'agent_status':
      return { stderr: `[status] ${stringOrFallback(payload.message, 'working')}\n`, didWriteText: false };
    case 'artifact_updated':
      return { stderr: `[artifact] ${stringOrFallback(payload.kind, 'artifact')} ${stringOrFallback(payload.preview, '')}\n`, didWriteText: false };
    default:
      return { didWriteText: false };
  }
}

function renderWaitingUserPrompt(prompt: WaitingUserPrompt): void {
  if (prompt.promptKind === 'approval') {
    process.stderr.write('[approval] required\n');
  }
  process.stderr.write(`[input] ${prompt.question}\n`);
  if (prompt.options.length > 0) {
    process.stderr.write(`[input:options] ${prompt.options.join(' | ')}\n`);
  }
  const checkpointSummary = buildCheckpointSummary(prompt.checkpoint);
  if (checkpointSummary) {
    process.stderr.write(`[input:context] ${checkpointSummary}\n`);
  }
}

function extractWaitingUserPrompt(runId: string, events: RunEvent[]): WaitingUserPrompt | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'waiting_user') {
      return toWaitingUserPrompt(runId, event);
    }
  }
  return undefined;
}

function toWaitingUserPrompt(runId: string, event: { payload?: unknown }): WaitingUserPrompt {
  const payload = asRecord(event.payload);
  const checkpoint = asRecord(payload.checkpoint);
  const approval = asRecord(payload.approval);
  return {
    runId,
    question: stringOrFallback(payload.question ?? payload.message, 'input required'),
    options: toStringArray(payload.options),
    promptKind: typeof payload.promptKind === 'string' ? payload.promptKind : undefined,
    checkpoint,
    approval: approval
      ? {
          ...(typeof approval.approveLabel === 'string' ? { approveLabel: approval.approveLabel } : {}),
          ...(typeof approval.denyLabel === 'string' ? { denyLabel: approval.denyLabel } : {}),
        }
      : undefined,
  };
}

function buildCheckpointSummary(checkpoint: Record<string, unknown> | undefined): string | undefined {
  if (!checkpoint) {
    return undefined;
  }

  const parts = [
    typeof checkpoint.action === 'string' ? `action ${checkpoint.action}` : undefined,
    typeof checkpoint.targetSkill === 'string' ? `target ${checkpoint.targetSkill}` : undefined,
    typeof checkpoint.changeType === 'string' ? `change ${checkpoint.changeType}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(' | ') : undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function isStreamingStatus(status: string): boolean {
  return !['completed', 'failed', 'cancelled', 'waiting_user'].includes(status);
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}

function printUsage(): void {
  process.stdout.write([
    'risk-agent terminal cli',
    '',
    'Usage:',
    '  pnpm cli:terminal',
    '  pnpm cli:terminal -- "your prompt"',
    '  pnpm cli:terminal -- --repl "start with an initial prompt"',
    '  pnpm cli:terminal -- --resume',
    '  pnpm cli:terminal -- --resume "follow-up guidance"',
    '  pnpm cli:terminal -- --message "follow-up guidance"',
    '  pnpm cli:terminal -- --interrupt',
    '  pnpm cli:terminal -- --status',
    '',
    'Flags:',
    '  --run <id>       attach/interrupt a specific run instead of the owned run',
    '  --model <id>     override the preferred model for create/append',
    '  --tool <name>    pin a tool for create/append, repeat or comma-separate',
    '  --repl           force interactive REPL mode even when an initial prompt is provided',
    '  --base-url <url> override the server base URL, default http://127.0.0.1:8787',
    '',
  ].join('\n'));
}

void main().catch((error) => {
  process.stderr.write(`[terminal-cli] ${readErrorMessage(error)}\n`);
  process.exitCode = 1;
});