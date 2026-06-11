/**
 * useXterm — manages xterm.js Terminal instance lifecycle.
 * Attaches to a container ref, loads FitAddon, exposes write helpers.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { resolveXtermTheme } from '../lib/cliAnsi';

export interface UseXtermOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onReady?: (terminal: Terminal) => void;
}

export interface UseXtermReturn {
  terminal: Terminal | null;
  write: (text: string) => void;
  writeln: (text: string) => void;
  clear: () => void;
  fit: () => void;
}

function readDocumentTheme(): 'midnight' | 'paper' | 'sea' {
  if (typeof document === 'undefined') {
    return 'midnight';
  }
  const theme = document.documentElement.dataset.theme;
  if (theme === 'paper' || theme === 'sea' || theme === 'midnight') {
    return theme;
  }
  return 'midnight';
}

export function useXterm({ containerRef, onReady }: UseXtermOptions): UseXtermReturn {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onReadyRef = useRef(onReady);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  onReadyRef.current = onReady;

  const normalizeOutputOnlyHelper = useCallback((container: HTMLDivElement) => {
    const helper = container.querySelector('textarea[aria-label="Terminal input"], .xterm-helper-textarea');
    if (!(helper instanceof HTMLTextAreaElement)) return;
    helper.tabIndex = -1;
    helper.setAttribute('aria-hidden', 'true');
    helper.setAttribute('data-output-only', 'true');
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: '"SFMono-Regular", "JetBrains Mono", "Cascadia Code", "Menlo", "Consolas", monospace',
      fontSize: 12.5,
      fontWeight: 500,
      fontWeightBold: 650,
      lineHeight: 1.45,
      letterSpacing: 0.15,
      cursorBlink: true,
      cursorStyle: 'block',
      disableStdin: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: resolveXtermTheme(readDocumentTheme()),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();
    if (term.options.disableStdin) {
      normalizeOutputOnlyHelper(container);
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    setTerminal(term);

    onReadyRef.current?.(term);

    // Resize observer: re-fit when container size changes
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit errors during unmount
      }
    });
    observer.observe(container);

    const themeObserver = typeof document !== 'undefined'
      ? new MutationObserver(() => {
        term.options.theme = resolveXtermTheme(readDocumentTheme());
      })
      : null;

    const helperObserver = term.options.disableStdin
      ? new MutationObserver(() => {
        normalizeOutputOnlyHelper(container);
      })
      : null;

    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    helperObserver?.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      themeObserver?.disconnect();
      helperObserver?.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setTerminal(null);
    };
    // containerRef is a ref object — intentionally not in dep array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, normalizeOutputOnlyHelper]);

  const write = useCallback((text: string) => {
    terminalRef.current?.write(text);
  }, []);

  const writeln = useCallback((text: string) => {
    terminalRef.current?.write(`${text}\r\n`);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const fit = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // ignore
    }
  }, []);

  return {
    terminal,
    write,
    writeln,
    clear,
    fit,
  };
}
