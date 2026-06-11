/**
 * PromptBar — inline waiting_user prompt rendered above the composer.
 * Handles free-text and choice-based prompts.
 */

import { useRef, useState } from 'react';
import { IconSend, IconX } from '@tabler/icons-react';
import type { WaitingUserPayload } from '../../hooks/useCliSession';

interface PromptBarProps {
  prompt: WaitingUserPayload;
  onSubmit: (value: string) => void;
  onDismiss?: () => void;
}

export function PromptBar({ prompt, onSubmit, onDismiss }: PromptBarProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasChoices = prompt.choices && prompt.choices.length > 0;
  const isApprovalPrompt = prompt.promptKind === 'approval';
  const checkpointSummary = buildCheckpointSummary(prompt.checkpoint);
  const approveLabel = prompt.approval?.approveLabel;
  const denyLabel = prompt.approval?.denyLabel;

  function handleSubmit(value: string) {
    if (!value.trim()) return;
    onSubmit(value.trim());
    setInputValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(inputValue);
    }
    if (e.key === 'Escape') {
      onDismiss?.();
    }
    // Number key shortcuts for choices (1-9)
    if (prompt.choices && prompt.choices.length > 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const idx = parseInt(e.key, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < prompt.choices.length && inputValue === '') {
        e.preventDefault();
        handleSubmit(prompt.choices[idx]);
      }
    }
  }

  return (
    <div className="cli-prompt-shell border-b px-4 py-3 sm:px-5">
      <div className="cli-prompt-surface rounded-[24px] border px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-accent/15 font-mono text-[11px] font-bold uppercase tracking-widest text-accent/90">
            ?
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                waiting_user
              </span>
              {isApprovalPrompt && (
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
                  approval required
                </span>
              )}
              {hasChoices && (
                <span className="rounded-full border border-border-subtle bg-surface-card px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                  {prompt.choices!.length} options
                </span>
              )}
            </div>
            <div className="mt-1 font-mono text-[13px] leading-6 text-text">{prompt.question}</div>
            {checkpointSummary && (
              <div className="mt-2 font-mono text-[11px] leading-5 text-text-dim">{checkpointSummary}</div>
            )}
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 text-text-muted transition-colors hover:text-text"
              aria-label="Dismiss prompt"
            >
              <IconX size={14} />
            </button>
          )}
        </div>

        {hasChoices && (
          <div className="mt-4 flex flex-wrap gap-2 pl-10">
            {prompt.choices!.map((choice, i) => (
              <button
                key={choice}
                type="button"
                onClick={() => handleSubmit(choice)}
                className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[12px] transition-colors ${resolveChoiceTone(choice, approveLabel, denyLabel)}`}
              >
                {i < 9 && (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-border-subtle text-[9px] font-bold text-text-muted group-hover:bg-accent/20 group-hover:text-accent">
                    {i + 1}
                  </span>
                )}
                {choice}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 pl-10">
          <div className="cli-command-input-row flex items-center gap-2 rounded-[20px] border px-3 py-2.5">
            <input
              ref={inputRef}
              type={prompt.promptKind === 'secret' ? 'password' : 'text'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response..."
              autoFocus
              className="cli-command-textarea flex-1 bg-transparent font-mono text-[13px] text-text placeholder-text-muted outline-none"
              aria-label="Prompt response input"
            />
            <button
              type="button"
              onClick={() => handleSubmit(inputValue)}
              disabled={!inputValue.trim()}
              className="cli-command-action cli-command-action--primary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-accent/50 bg-accent/15 text-accent/90 transition-colors hover:border-accent/70 hover:bg-accent/25 hover:text-accent disabled:border-border-subtle disabled:bg-surface-card disabled:text-text-muted"
              aria-label="Submit response"
            >
              <IconSend size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildCheckpointSummary(checkpoint: Record<string, unknown> | undefined): string | null {
  if (!checkpoint) {
    return null;
  }

  const parts = [
    typeof checkpoint.action === 'string' ? `action ${checkpoint.action}` : null,
    typeof checkpoint.targetSkill === 'string' ? `target ${checkpoint.targetSkill}` : null,
    typeof checkpoint.changeType === 'string' ? `change ${checkpoint.changeType}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(' · ') : null;
}

function resolveChoiceTone(
  choice: string,
  approveLabel: string | undefined,
  denyLabel: string | undefined,
): string {
  if (approveLabel && choice === approveLabel) {
    return 'border-success/30 bg-success/10 text-success hover:border-success/50 hover:bg-success/15 hover:text-success';
  }
  if (denyLabel && choice === denyLabel) {
    return 'border-danger/30 bg-danger/10 text-danger hover:border-danger/50 hover:bg-danger/15 hover:text-danger';
  }
  return 'border-border-subtle bg-surface-card text-text hover:border-accent/50 hover:bg-accent/15 hover:text-accent';
}
