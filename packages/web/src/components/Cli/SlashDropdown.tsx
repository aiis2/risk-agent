/**
 * SlashDropdown — autocomplete overlay for slash commands.
 * Appears when the input starts with "/" and there are matching commands.
 */

import { IconTerminal2 } from '@tabler/icons-react';
import type { CommandDef } from '../../lib/cliCommands';
import { ScrollArea } from '../ui';

interface SlashDropdownProps {
  commands: CommandDef[];
  activeIndex: number;
  onSelect: (cmd: CommandDef) => void;
  inputValue: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  session: 'text-text-dim',
  mode: 'text-warn',
  config: 'text-accent',
  info: 'text-text-dim',
};

export function SlashDropdown({
  commands,
  activeIndex,
  onSelect,
  inputValue,
}: SlashDropdownProps) {
  if (commands.length === 0) return null;

  return (
    <div className="cli-popover absolute bottom-full left-0 right-0 z-50 mb-3 overflow-hidden rounded-[22px] border backdrop-blur">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <IconTerminal2 size={11} className="text-text-dim" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
          Commands
        </span>
        {inputValue.length > 1 && (
          <span className="ml-auto font-mono text-[10px] text-text-muted">
            {commands.length} match{commands.length !== 1 ? 'es' : ''}
          </span>
        )}
      </div>

      {/* Command list */}
      <ScrollArea className="max-h-64" viewportClassName="h-full w-full">
        <div className="space-y-1 p-2">
          {commands.map((cmd, i) => {
            const isActive = i === activeIndex;
            const catColor = CATEGORY_COLORS[cmd.category] ?? 'text-text-dim';
            const hint = cmd.argsHint ? ` ${cmd.argsHint}` : '';

            return (
              <button
                key={cmd.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur on input
                  onSelect(cmd);
                }}
                className={`flex w-full items-center gap-3 rounded-[18px] px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'border border-accent/50 bg-accent/10'
                    : 'border border-transparent bg-surface-card hover:border-border hover:bg-surface-hover'
                }`}
              >
                <span className="min-w-[120px] font-mono text-[12px] text-accent/90">
                  /{cmd.name}
                  {hint && (
                    <span className="text-text-muted">{hint}</span>
                  )}
                </span>

                <span className="flex-1 truncate font-mono text-[11px] text-text-dim">
                  {cmd.description}
                </span>

                <span className={`ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider ${catColor}`}>
                  {cmd.category}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer hint */}
      <div className="border-t px-3 py-2">
        <span className="font-mono text-[10px] text-text-muted">
          Tab/Enter to accept · Esc to dismiss · ↑↓ navigate
        </span>
      </div>
    </div>
  );
}
