/**
 * CliComposer — input dock for the CLI surface.
 *
 * Features:
 * - Single / multiline text input
 * - Slash command detection → shows SlashDropdown
 * - Inline ghost text suggestion for slash completion
 * - Up/down arrow for command history
 * - Busy-mode badge (idle / queue / steer / interrupt)
 * - Send on Enter, Alt+Enter / Ctrl+J for newline
 * - Ctrl+C → interrupt running session
 * - Ctrl+L → clear terminal
 * - Live elapsed timer in meta bar while running
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  IconArrowUp,
  IconBolt,
  IconLoader2,
  IconPlayerStop,
} from '@tabler/icons-react';
import { autocompleteCommands, type CommandDef } from '../../lib/cliCommands';
import type { BusyMode } from '../../lib/cliCommands';
import { SlashDropdown } from './SlashDropdown';

interface CliComposerProps {
  busyMode: BusyMode;
  isSending: boolean;
  onSend: (content: string) => void;
  onInterrupt: () => void;
  onClear?: () => void;
  isRunning: boolean;
  toolCount: number;
  currentRunId?: string;
  placeholder?: string;
  runStartedAt?: number;
  runMetrics?: {
    turnCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedUsd?: number;
    elapsedMs?: number;
  };
}

const MODE_CONFIG: Record<BusyMode, { label: string; color: string }> = {
  idle: { label: 'idle', color: 'text-text-muted' },
  queue: { label: 'queue', color: 'text-text-dim' },
  steer: { label: 'steer', color: 'text-accent' },
  interrupt: { label: 'interrupt', color: 'text-warn' },
};

const MAX_HISTORY = 50;

export function CliComposer({
  busyMode,
  isSending,
  onSend,
  onInterrupt,
  onClear,
  isRunning,
  toolCount,
  currentRunId,
  placeholder = 'Describe a task or use /command...',
  runStartedAt,
  runMetrics,
}: CliComposerProps) {
  const [inputValue, setInputValue] = useState('');
  const [slashCmds, setSlashCmds] = useState<CommandDef[]>([]);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyPos, setHistoryPos] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Update slash suggestions when input changes
  useEffect(() => {
    if (inputValue.startsWith('/')) {
      const matches = autocompleteCommands(inputValue);
      setSlashCmds(matches);
      setDropdownIndex(0);
    } else {
      setSlashCmds([]);
    }
  }, [inputValue]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputValue]);

  // Live elapsed timer while running
  useEffect(() => {
    if (!isRunning) {
      setElapsedSec(0);
      return;
    }
    const start = runStartedAt ?? Date.now();
    setElapsedSec(Math.floor((Date.now() - start) / 1000));
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, runStartedAt]);

  const handleSend = useCallback(() => {
    const value = inputValue.trim();
    if (!value) return;
    // Add to history (skip duplicates at top)
    setCmdHistory((prev) => {
      const deduped = prev.filter((item) => item !== value);
      return [value, ...deduped].slice(0, MAX_HISTORY);
    });
    setHistoryPos(-1);
    setSavedDraft('');
    setInputValue('');
    onSend(value);
  }, [inputValue, onSend]);

  const handleSelectSlash = useCallback((cmd: CommandDef) => {
    const fullCmd = `/${cmd.name}${cmd.argsHint ? ' ' : ''}`;
    setInputValue(fullCmd);
    setSlashCmds([]);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+C → interrupt running session
      if (e.ctrlKey && e.key === 'c' && !e.shiftKey && !e.altKey) {
        if (isRunning) {
          e.preventDefault();
          onInterrupt();
          return;
        }
      }

      // Ctrl+L → clear terminal
      if (e.ctrlKey && e.key === 'l' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onClear?.();
        return;
      }

      // Slash dropdown navigation
      if (slashCmds.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setDropdownIndex((i) => Math.min(i + 1, slashCmds.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setDropdownIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const selected = slashCmds[dropdownIndex];
          if (selected) {
            handleSelectSlash(selected);
          }
          return;
        }
        if (e.key === 'Escape') {
          setSlashCmds([]);
          return;
        }
      }

      // Command history navigation (up/down when no slash dropdown)
      if (e.key === 'ArrowUp' && slashCmds.length === 0) {
        e.preventDefault();
        if (cmdHistory.length === 0) return;
        if (historyPos === -1) setSavedDraft(inputValue);
        const nextPos = Math.min(historyPos + 1, cmdHistory.length - 1);
        setHistoryPos(nextPos);
        setInputValue(cmdHistory[nextPos]);
        return;
      }
      if (e.key === 'ArrowDown' && slashCmds.length === 0 && historyPos >= 0) {
        e.preventDefault();
        const nextPos = historyPos - 1;
        if (nextPos < 0) {
          setHistoryPos(-1);
          setInputValue(savedDraft);
        } else {
          setHistoryPos(nextPos);
          setInputValue(cmdHistory[nextPos]);
        }
        return;
      }

      // Send: Enter (no Shift, no Alt, no Meta)
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Alt+Enter or Ctrl+J: insert newline (multiline input)
      if ((e.key === 'Enter' && e.altKey) || (e.key === 'j' && e.ctrlKey)) {
        e.preventDefault();
        const el = textareaRef.current;
        if (el) {
          const start = el.selectionStart ?? inputValue.length;
          const end = el.selectionEnd ?? inputValue.length;
          setInputValue(inputValue.slice(0, start) + '\n' + inputValue.slice(end));
          // Move cursor after inserted newline on next tick
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = start + 1;
              textareaRef.current.selectionEnd = start + 1;
            }
          });
        }
        return;
      }
    },
    [slashCmds, dropdownIndex, cmdHistory, historyPos, savedDraft, inputValue, handleSelectSlash, handleSend, isRunning, onInterrupt, onClear],
  );

  const modeConfig = isRunning
    ? { label: 'running', color: 'text-success animate-pulse' }
    : MODE_CONFIG[busyMode];

  return (
    <div className="cli-composer-shell relative px-0 pb-0 pt-0">
      {/* Slash dropdown (rendered above the composer) */}
      {slashCmds.length > 0 && (
        <SlashDropdown
          commands={slashCmds}
          activeIndex={dropdownIndex}
          onSelect={handleSelectSlash}
          inputValue={inputValue}
        />
      )}

      <div className="cli-composer-surface">
        {/* Status bar — compact monospace context line, no model (shown in header) */}
        <div className="cli-composer-meta flex items-center gap-2 overflow-x-auto px-5 pt-2 pb-1 scrollbar-none">
          {/* Mode badge */}
          <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] ${modeConfig.color}`}>{modeConfig.label}</span>

          {/* Elapsed timer — only while running */}
          {isRunning && elapsedSec > 0 && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">│</span>
              <span className="shrink-0 font-mono text-[10px] text-success">
                {elapsedSec >= 60
                  ? `${Math.floor(elapsedSec / 60)}m${String(elapsedSec % 60).padStart(2, '0')}s`
                  : `${elapsedSec}s`}
              </span>
            </>
          )}

          {/* Token count */}
          {runMetrics && (runMetrics.inputTokens ?? 0) > 0 && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">│</span>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">
                {((runMetrics.inputTokens ?? 0) + (runMetrics.outputTokens ?? 0)).toLocaleString()} tok
              </span>
            </>
          )}

          {/* Cost */}
          {runMetrics && (runMetrics.estimatedUsd ?? 0) > 0 && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">│</span>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">
                ${(runMetrics.estimatedUsd ?? 0).toFixed(4)}
              </span>
            </>
          )}

          {/* Turn count */}
          {runMetrics && (runMetrics.turnCount ?? 0) > 0 && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">│</span>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">
                {runMetrics.turnCount} turns
              </span>
            </>
          )}

          {/* Tools */}
          {toolCount > 0 && (
            <>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">│</span>
              <span className="shrink-0 font-mono text-[10px] text-text-muted">{toolCount} tools</span>
            </>
          )}

          {/* Run ID */}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted/40">
            {currentRunId ? currentRunId.slice(-8) : 'new run'}
          </span>
        </div>

        {/* Flat input row — no nested box, just prompt glyph + textarea + actions */}
        <div className="flex items-end gap-3 px-5 py-2">
          <span className={`mb-0.5 shrink-0 select-none font-mono text-[18px] leading-none ${isRunning ? 'text-success animate-pulse' : 'text-accent'}`}>❯</span>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            aria-label="CLI input"
            className="cli-command-textarea flex-1 resize-none bg-transparent font-mono text-[13px] leading-7 text-text placeholder-text-muted outline-none"
          />
          <div className="mb-0.5 flex shrink-0 items-center gap-2 self-center">
            {isRunning && (
              <button
                type="button"
                onClick={onInterrupt}
                title="Interrupt run (Ctrl+C)"
                className="cli-command-action cli-command-action--warn inline-flex h-9 w-9 items-center justify-center rounded-[18px] border border-warn/30 bg-warn/10 text-warn transition-colors hover:border-warn/50 hover:text-warn"
                aria-label="Interrupt running job"
              >
                <IconPlayerStop size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || !inputValue.trim()}
              title="Send (Enter)"
              aria-label="Send message"
              className="cli-command-action cli-command-action--primary inline-flex h-9 w-9 items-center justify-center rounded-[18px] border border-accent/50 bg-accent/15 text-accent/90 transition-all hover:border-accent/70 hover:bg-accent/25 hover:text-accent disabled:border-border-subtle disabled:bg-surface-card disabled:text-text-muted"
            >
              {isSending ? (
                <IconLoader2 size={15} className="animate-spin" />
              ) : busyMode === 'idle' ? (
                <IconArrowUp size={15} />
              ) : (
                <IconBolt size={15} />
              )}
            </button>
          </div>
        </div>

        <div className="cli-composer-footer flex flex-wrap items-center justify-between gap-2 border-t px-5 py-2 pb-2.5">
          <span className="font-mono text-[10px] text-text-muted">
            Enter send · Alt+Enter newline · /help · ↑↓ history · Ctrl+C interrupt · Ctrl+L clear
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            /command ready
          </span>
        </div>
      </div>
    </div>
  );
}
