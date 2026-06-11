/**
 * ANSI escape code helpers and run-event → ANSI text converter.
 * Maps the project palette to xterm.js theme colors.
 */

import type { RunTimelineEvent } from '../api/client';
import type { ResolvedTheme } from './theme';
import { summarizeSandboxInline } from './sandboxDisplay';

// ── Raw ANSI codes ──────────────────────────────────────────────────────────
export const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  // Standard 8 colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Bright 8 colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
} as const;

/** Wrap text with an ANSI code, reset after. */
export function ansi(code: string, text: string): string {
  return `${code}${text}${A.reset}`;
}

// ── Semantic helpers ────────────────────────────────────────────────────────
export const styled = {
  userPrompt: (t: string) => ansi(A.bold + A.brightWhite, t),
  system: (t: string) => ansi(A.cyan, t),
  agent: (t: string) => ansi(A.brightGreen, t),
  tool: (t: string) => ansi(A.magenta, t),
  toolResult: (t: string) => ansi(A.dim + A.magenta, t),
  thinking: (t: string) => ansi(A.yellow, t),
  warn: (t: string) => ansi(A.brightYellow, t),
  error: (t: string) => ansi(A.brightRed, t),
  muted: (t: string) => ansi(A.brightBlack, t),
  accent: (t: string) => ansi(A.brightBlue, t),
  success: (t: string) => ansi(A.brightGreen, t),
  prompt: (t: string) => ansi(A.bold + A.brightBlue, t),
  separator: () => ansi(A.brightBlack, '─'.repeat(44)),
  label: (t: string) => ansi(A.dim + A.brightBlack, t),
};

/**
 * Convert a minimal subset of Markdown to ANSI escape sequences for xterm rendering.
 * Handles **bold**, *italic*, `code`, and normalises \n → \r\n.
 */
export function markdownToAnsi(md: string): string {
  return md
    // bold+italic ***text***
    .replace(/\*\*\*(.+?)\*\*\*/g, `${A.bold}${A.italic}$1${A.reset}`)
    // bold **text**
    .replace(/\*\*(.+?)\*\*/g, `${A.bold}$1${A.reset}`)
    // italic *text*
    .replace(/\*(.+?)\*/g, `${A.italic}$1${A.reset}`)
    // inline code `text`
    .replace(/`([^`]+)`/g, `${A.cyan}$1${A.reset}`)
    // normalise newlines for xterm
    .replace(/\r?\n/g, '\r\n');
}

// ── xterm.js theme objects aligned with app themes ─────────────────────────
const XTERM_THEME_MAP: Record<ResolvedTheme, Record<string, string>> = {
  midnight: {
    background: '#0f1220',
    foreground: '#e6e8f2',
    cursor: '#6b8afe',
    cursorAccent: '#0f1220',
    selectionBackground: '#6b8afe33',
    selectionForeground: '#e6e8f2',
    black: '#0d1019',
    brightBlack: '#5d6380',
    red: '#ff5a5f',
    brightRed: '#ff7a7f',
    green: '#30d158',
    brightGreen: '#50e17a',
    yellow: '#ffba08',
    brightYellow: '#ffc830',
    blue: '#6b8afe',
    brightBlue: '#8ba0ff',
    magenta: '#c56aff',
    brightMagenta: '#d88aff',
    cyan: '#5ac8fa',
    brightCyan: '#7ad8ff',
    white: '#8d92a8',
    brightWhite: '#e6e8f2',
  },
  paper: {
    background: '#ffffff',
    foreground: '#1a2840',
    cursor: '#2b57d9',
    cursorAccent: '#f5f7fb',
    selectionBackground: '#2b57d922',
    selectionForeground: '#172033',
    black: '#e2e9f3',
    brightBlack: '#5f6d88',
    red: '#c73939',
    brightRed: '#d94c4c',
    green: '#177a4e',
    brightGreen: '#239765',
    yellow: '#b76b12',
    brightYellow: '#cc8018',
    blue: '#2b57d9',
    brightBlue: '#3f67dd',
    magenta: '#8647cf',
    brightMagenta: '#9c5ae0',
    cyan: '#117fb3',
    brightCyan: '#1c97c9',
    white: '#7f8ea8',
    brightWhite: '#172033',
  },
  sea: {
    background: '#09161f',
    foreground: '#dff0f5',
    cursor: '#4ad3c5',
    cursorAccent: '#09161f',
    selectionBackground: '#4ad3c526',
    selectionForeground: '#dff0f5',
    black: '#0a1c27',
    brightBlack: '#668d99',
    red: '#fb7185',
    brightRed: '#fd8ca0',
    green: '#34d399',
    brightGreen: '#5eead4',
    yellow: '#f59e0b',
    brightYellow: '#fbbf24',
    blue: '#4ad3c5',
    brightBlue: '#7ceadd',
    magenta: '#c084fc',
    brightMagenta: '#d8b4fe',
    cyan: '#38bdf8',
    brightCyan: '#67e8f9',
    white: '#8ab2bd',
    brightWhite: '#dff0f5',
  },
};

export const xtermTheme = XTERM_THEME_MAP.midnight;

export function resolveXtermTheme(theme: ResolvedTheme = 'midnight') {
  return XTERM_THEME_MAP[theme] ?? XTERM_THEME_MAP.midnight;
}

// ── Event type categories ───────────────────────────────────────────────────
const THINKING_TYPES = new Set(['thinking_delta', 'thinking_start', 'thinking_complete']);
const TOOL_TYPES = new Set(['tool_start', 'tool_progress', 'tool_complete', 'tool_partition_info']);
const AGENT_TYPES = new Set([
  'text_delta', 'text_start', 'message_start', 'message_delta', 'message_complete',
]);
const SUBAGENT_TYPES = new Set(['subagent_start', 'subagent_complete', 'subagent_event']);
const STATUS_TYPES = new Set(['run_status', 'status_update', 'checkpoint']);

const CHECKPOINT_LABELS: Record<string, string> = {
  routed: 'checkpoint routed',
  planned: 'checkpoint planned',
  'verify-ready': 'checkpoint verify-ready',
  completed: 'checkpoint completed',
  'waiting-user': 'checkpoint awaiting-input',
};

function treeLine(text: string, kind: 'mid' | 'end' = 'mid'): string {
  const branch = kind === 'end' ? '└─' : '├─';
  return `  ${styled.label(branch)} ${text}`;
}

function transcriptNote(text: string): string {
  return `  ${styled.label('│')} ${text}`;
}

/**
 * Convert a single run timeline event to an ANSI-formatted terminal line.
 * Returns null if the event should be suppressed from the transcript.
 */
export function eventToAnsi(event: RunTimelineEvent, opts?: { taskKind?: string }): string | null {
  const { type, payload } = event;
  const p = (payload as Record<string, unknown>) ?? {};
  const isGeneral = (opts?.taskKind ?? '') === 'general';

  // ── thinking ──
  if (THINKING_TYPES.has(type)) {
    if (type === 'thinking_delta') {
      const text = String(p.delta ?? '');
      if (!text.trim()) return null;
      return styled.thinking(text);
    }
    if (type === 'thinking_start') {
      return styled.muted('  reasoning...');
    }
    return null;
  }

  // ── tool calls ──
  if (TOOL_TYPES.has(type)) {
    if (type === 'tool_start') {
      const name = String(p.toolName ?? p.name ?? 'tool');
      const input = p.input ? ` ${styled.muted(JSON.stringify(p.input).slice(0, 80))}` : '';
      const sandbox = summarizeSandboxInline(p.sandbox);
      const suffix = sandbox ? ` ${styled.muted(`[${sandbox}]`)}` : '';
      return `  ${styled.tool(`├─ tool ${name}`)}${suffix}${input}`;
    }
    if (type === 'tool_complete') {
      const name = String(p.toolName ?? p.name ?? 'tool');
      const result = p.result ? ` ${styled.toolResult(String(p.result).slice(0, 120))}` : '';
      const sandbox = summarizeSandboxInline(p.sandbox);
      const suffix = sandbox ? ` ${styled.muted(`[${sandbox}]`)}` : '';
      return `  ${styled.label(`└─ tool ${name} complete`)}${suffix}${result}`;
    }
    if (type === 'tool_progress') {
      const msg = String(p.message ?? p.progress ?? '');
      const sandbox = summarizeSandboxInline(p.sandbox);
      const content = [msg, sandbox].filter(Boolean).join(' · ');
      if (!content) return null;
      return `  ${styled.label('│')} ${styled.muted(content)}`;
    }
    if (type === 'tool_partition_info') {
      const msg = String(p.message ?? p.partition ?? 'parallel tool step');
      return `  ${styled.label('│')} ${styled.muted(msg)}`;
    }
    return null;
  }

  // ── agent text output ──
  if (AGENT_TYPES.has(type)) {
    if (type === 'text_delta') {
      if (isGeneral) return null;
      const delta = String(p.delta ?? '');
      return delta || null;
    }
    if (type === 'message_complete') {
      return '';
    }
    return null;
  }

  // ── subagent events ──
  if (SUBAGENT_TYPES.has(type)) {
    if (type === 'subagent_start') {
      const name = String(p.agentName ?? p.name ?? 'subagent');
      return `  ${styled.accent(`agent ${name} online`)}`;
    }
    if (type === 'subagent_complete') {
      const name = String(p.agentName ?? p.name ?? 'subagent');
      return `  ${styled.muted(`agent ${name} returned`)}`;
    }
    return null;
  }

  if (type === 'agent_status') {
    const message = String(p.message ?? 'Working...');
    return `  ${styled.muted(message)}`;
  }

  if (type === 'routed') {
    if (isGeneral) return null;
    const acceptedTaskKind = String(p.acceptedTaskKind ?? p.taskKind ?? 'unknown');
    const confidence = typeof p.confidence === 'number' ? ` (${Math.round(p.confidence * 100)}%)` : '';
    return [
      '',
      styled.label('task transcript'),
      treeLine(styled.system(`route ${acceptedTaskKind}${confidence}`)),
    ].join('\r\n');
  }

  if (type === 'plan_created') {
    if (isGeneral) return null;
    const summary = String(p.summary ?? p.intent ?? p.title ?? 'Execution plan prepared');
    return treeLine(styled.system(`plan ${summary}`));
  }

  if (type === 'continuation_decision') {
    const decision = String(p.decision ?? 'continue');
    const nextCapability = String(p.nextCapabilityProfile ?? p.currentCapabilityProfile ?? 'general');
    const reason = String(p.reason ?? '').trim();
    const responseModeHint = String(p.responseModeHint ?? '').trim();
    const stopReasonCode = String(p.stopReasonCode ?? '').trim();
    const source = String(p.source ?? '').trim();

    if (decision === 'stop') {
      const tags = [source, stopReasonCode].filter(Boolean).join('/');
      const tagSuffix = tags ? ` [${tags}]` : '';
      const suffix = reason ? ` · ${reason}` : '';
      return `  ${styled.muted(`stop orchestration${tagSuffix}${suffix}`)}`;
    }

    const modeSuffix = responseModeHint ? ` [${responseModeHint}]` : '';
    const reasonSuffix = reason ? ` · ${reason}` : '';
    return `  ${styled.system(`continue -> ${nextCapability}${modeSuffix}`)}${styled.muted(reasonSuffix)}`;
  }

  if (type === 'capability_switched') {
    const nextCapability = String(p.to ?? p.nextCapabilityProfile ?? 'unknown');
    const reason = String(p.reason ?? '').trim();
    const suffix = reason ? ` · ${reason}` : '';
    return `  ${styled.accent(`switch -> ${nextCapability}`)}${styled.muted(suffix)}`;
  }

  if (type === 'general_response_started') {
    if (isGeneral) {
      // For general runs show a subtle divider so the response stands out from tool output
      return `\r\n${styled.muted('─'.repeat(36))}\r\n`;
    }
    const responseMode = String(p.responseMode ?? 'direct');
    const attachmentCount = typeof p.attachmentCount === 'number' ? p.attachmentCount : 0;
    const attachmentSuffix = attachmentCount > 0 ? ` · ${attachmentCount} attachments` : '';
    return treeLine(styled.system(`draft ${responseMode} response${attachmentSuffix}`));
  }

  if (type === 'checkpoint_created') {
    if (isGeneral) return null;
    const kind = String(p.semanticKind ?? p.kind ?? 'checkpoint');
    return treeLine(styled.system(CHECKPOINT_LABELS[kind] ?? `checkpoint ${kind}`));
  }

  if (type === 'user_input_received') {
    return treeLine(styled.system('input accepted'));
  }

  if (type === 'artifact_updated') {
    if (isGeneral) {
      // For general runs, we fetch and display the full response via the artifact API
      // on run_completed. Suppress the truncated 160-char preview here to avoid duplication.
      return null;
    }
    const kind = String(p.kind ?? 'artifact');
    const version = typeof p.version === 'number' ? ` v${p.version}` : '';
    const preview = typeof p.preview === 'string' ? p.preview.trim() : '';
    if (!preview) {
      return treeLine(styled.system(`artifact ${kind}${version}`));
    }
    return [
      treeLine(styled.system(`artifact ${kind}${version}`)),
      transcriptNote(styled.agent(preview)),
    ].join('\r\n');
  }

  if (type === 'verifier_finished') {
    if (isGeneral) return null;
    const decision = String(p.decision ?? 'unknown');
    const reasons = Array.isArray(p.reasons)
      ? p.reasons.map(String).filter(Boolean).join(' · ')
      : '';
    const suffix = reasons ? ` ${styled.label(reasons.slice(0, 96))}` : '';
    if (decision === 'pass') {
      return `${treeLine(styled.success(`verifier ${decision}`))}${suffix}`;
    }
    if (decision === 'fail') {
      return `${treeLine(styled.error(`verifier ${decision}`))}${suffix}`;
    }
    return `${treeLine(styled.warn(`verifier ${decision}`))}${suffix}`;
  }

  if (type === 'interrupt_requested') {
    const sandbox = summarizeSandboxInline(p.sandbox, {
      includePolicy: false,
      includeOutcome: false,
    });
    const label = sandbox ? `interrupt requested | ${sandbox}` : 'interrupt requested';
    return treeLine(styled.warn(label));
  }

  if (type === 'run_cancelled') {
    const reason = String(p.reason ?? p.terminationReason ?? p.status ?? 'cancelled');
    const sandbox = summarizeSandboxInline(p.sandbox, {
      includePolicy: false,
      includeOutcome: true,
    });
    const label = sandbox ? `session interrupted | ${reason} · ${sandbox}` : `session interrupted | ${reason}`;
    return treeLine(styled.warn(label), 'end');
  }

  if (type === 'run_completed' || type === 'run_failed') {
    if (isGeneral) {
      if (type === 'run_failed') {
        const reason = String(p.terminationReason ?? p.reason ?? p.status ?? p.error ?? type);
        return styled.error(`error | ${reason}`);
      }
      // Subtle completion footer for general responses
      const parts: string[] = [];
      if (typeof p.outputTokens === 'number' && p.outputTokens > 0) {
        parts.push(`${p.outputTokens} tokens`);
      }
      if (typeof p.estimatedUsd === 'number' && p.estimatedUsd > 0) {
        parts.push(`$${p.estimatedUsd.toFixed(4)}`);
      }
      const footer = parts.length > 0 ? `  ${styled.muted(parts.join(' · '))}` : '';
      return `\r\n${footer}`;
    }
    const reason = String(p.terminationReason ?? p.reason ?? p.status ?? p.error ?? type);
    return type === 'run_completed'
      ? treeLine(styled.success(`session complete | ${reason}`), 'end')
      : treeLine(styled.error(`session failed | ${reason}`), 'end');
  }

  // ── status / checkpoint ──
  if (STATUS_TYPES.has(type)) {
    const status = String(p.status ?? p.state ?? type);
    if (status === 'running') return null; // suppress noisy intermediate status
    const msg = String(p.message ?? p.label ?? status);
    if (status === 'cancelled') {
      return treeLine(styled.warn(`session interrupted | ${msg}`), 'end');
    }
    if (status === 'failed') {
      return treeLine(styled.error(`session failed | ${msg}`), 'end');
    }
    return styled.system(msg);
  }

  // ── waiting_user (prompt flow) ──
  if (type === 'waiting_user') {
    const question = String(p.question ?? p.message ?? 'Input required');
    const choiceCount = Array.isArray(p.choices)
      ? p.choices.length
      : Array.isArray(p.options)
        ? p.options.length
        : 0;
    const promptKind = String(p.promptKind ?? '');
    const headline = promptKind === 'approval' ? 'approval required' : 'awaiting input';
    return [
      '',
      treeLine(styled.warn(headline)),
      transcriptNote(styled.accent(question)),
      `  ${styled.label('└─')} ${styled.label(choiceCount > 0 ? `${choiceCount} options in prompt dock` : 'respond in the prompt dock')}`,
    ].join('\r\n');
  }

  // ── error / failure ──
  if (type === 'error' || type === 'run_error' || type === 'agent_error') {
    const msg = String(p.message ?? p.error ?? 'An error occurred');
    return styled.error(`error | ${msg}`);
  }

  return null;
}

/**
 * Format a user's command/message as a terminal input line.
 * Mirrors the PS1 prompt style.
 */
export function formatUserInput(text: string): string {
  return `\r\n${styled.accent('>')} ${styled.userPrompt(text)}\r\n`;
}

/** Print a horizontal rule separator. */
export function hr(): string {
  return `\r\n${styled.separator()}\r\n`;
}

/** Banner printed on CLI session start. */
export function welcomeBanner(version?: string): string {
  const ver = version ? ` v${version}` : '';
  return [
    '',
    `${ansi(A.bold + A.brightBlue, '❯')} ${ansi(A.bold + A.brightWhite, `Risk Agent CLI${ver}`)}`,
    `  ${ansi(A.brightBlack, '─────────────────────────────────────────')}`,
    `  ${ansi(A.cyan, 'session ready')}  ${ansi(A.brightBlack, '│')}  ${ansi(A.brightBlack, 'interactive channel attached')}`,
    `  ${ansi(A.brightBlack, 'type a task, or use')} ${ansi(A.brightBlue, '/help')} ${ansi(A.brightBlack, 'to see all commands')}`,
    `  ${ansi(A.brightBlack, 'Enter send')}  ${ansi(A.brightBlack, '│')}  ${ansi(A.brightBlack, 'Alt+Enter multi-line')}  ${ansi(A.brightBlack, '│')}  ${ansi(A.brightBlack, 'Tab complete')}`,
    `  ${ansi(A.brightBlack, 'Ctrl+C interrupt')}  ${ansi(A.brightBlack, '│')}  ${ansi(A.brightBlack, 'Ctrl+L clear')}  ${ansi(A.brightBlack, '│')}  ${ansi(A.brightBlack, '/shortcuts for all keys')}`,
    `  ${ansi(A.brightBlack, '─────────────────────────────────────────')}`,
    '',
  ].join('\r\n');
}
