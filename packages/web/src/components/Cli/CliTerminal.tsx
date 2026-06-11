/**
 * CliTerminal — mounts xterm.js into a DOM container.
 * Accepts the container ref externally so the parent controls sizing.
 */

import { forwardRef } from 'react';

interface CliTerminalProps {
  className?: string;
}

/**
 * The xterm.js terminal is mounted into this div via useXterm hook in the parent.
 * We forward the ref so the parent can pass it to useXterm.
 */
export const CliTerminal = forwardRef<HTMLDivElement, CliTerminalProps>(
  ({ className = '' }, ref) => {
    return (
      <div
        ref={ref}
        className={`relative h-full w-full overflow-hidden ${className}`}
      />
    );
  },
);

CliTerminal.displayName = 'CliTerminal';
