import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronLeft,
  IconChevronRight,
  IconGripVertical,
} from '@tabler/icons-react';

const MIN_ASIDE_WIDTH = 220;
const DEFAULT_ASIDE_WIDTH = 340;
const SPLITTER_WIDTH = 12;

const ASIDE_WIDTH_KEY = 'risk-agent:chat-aside-width';
const ASIDE_COLLAPSED_KEY = 'risk-agent:chat-aside-collapsed';

function readStoredWidth(): number {
  try {
    const stored = localStorage.getItem(ASIDE_WIDTH_KEY);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= MIN_ASIDE_WIDTH) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_ASIDE_WIDTH;
}

function clampAsideWidth(width: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(MIN_ASIDE_WIDTH, width));
}

function readStoredCollapsed(): boolean {
  try { return localStorage.getItem(ASIDE_COLLAPSED_KEY) === 'true'; } catch { return false; }
}

interface AgentWorkspaceShellProps {
  eyebrow: string;
  title: string;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  main: ReactNode;
  composer?: ReactNode;
  aside?: ReactNode;
  asideTitle?: string;
  asideDefaultCollapsed?: boolean;
}

export function AgentWorkspaceShell({
  eyebrow,
  title,
  status,
  meta,
  actions,
  main,
  composer,
  aside,
  asideTitle,
  asideDefaultCollapsed = false,
}: AgentWorkspaceShellProps) {
  const { t } = useTranslation();
  const [asideCollapsed, setAsideCollapsed] = useState(() =>
    asideDefaultCollapsed ? true : readStoredCollapsed(),
  );
  const [asideWidth, setAsideWidth] = useState(readStoredWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const shellBodyRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const hasAside = Boolean(aside);
  const resolvedAsideTitle = asideTitle ?? t('workspaceShell.sidebar', '侧边栏');

  const getMaxAsideWidth = useCallback(() => {
    const bodyWidth = shellBodyRef.current?.getBoundingClientRect().width ?? 0;
    if (!Number.isFinite(bodyWidth) || bodyWidth <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(MIN_ASIDE_WIDTH, Math.floor(bodyWidth - SPLITTER_WIDTH));
  }, []);

  const clampToAvailableWidth = useCallback(
    (width: number) => clampAsideWidth(width, getMaxAsideWidth()),
    [getMaxAsideWidth],
  );

  // Persist width to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem(ASIDE_WIDTH_KEY, String(asideWidth)); } catch { /* ignore */ }
  }, [asideWidth]);

  // Apply aside width imperatively (avoids JSX inline style lint rule)
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    el.style.width = asideCollapsed ? '0' : `${clampToAvailableWidth(asideWidth)}px`;
  }, [asideCollapsed, asideWidth, clampToAvailableWidth]);

  useEffect(() => {
    const syncAsideWidth = () => {
      setAsideWidth((current) => {
        const next = clampToAvailableWidth(current);
        return next === current ? current : next;
      });
    };

    syncAsideWidth();
    window.addEventListener('resize', syncAsideWidth);
    return () => window.removeEventListener('resize', syncAsideWidth);
  }, [clampToAvailableWidth]);

  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (asideCollapsed) return;
      e.preventDefault();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = asideWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        // moving mouse left → expanding aside
        const delta = startXRef.current - ev.clientX;
        const newWidth = clampToAvailableWidth(startWidthRef.current + delta);
        setAsideWidth(newWidth);
      };

      const onMouseUp = () => {
        draggingRef.current = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [asideCollapsed, asideWidth, clampToAvailableWidth],
  );

  const toggleAside = useCallback(() => {
    setAsideCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(ASIDE_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-text">
      {/* Header */}
      <header className="border-b border-border/60 bg-surface/96 px-5 py-3.5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.26em] text-text-subtle">{eyebrow}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
              <h1 className="text-base font-semibold tracking-tight text-text">{title}</h1>
              {status}
            </div>
            {meta ? <div className="mt-1 text-[11px] text-text-muted">{meta}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
          </div>
        </div>
      </header>

      {/* Body — flex row */}
      <div ref={shellBodyRef} className="flex flex-1 min-h-0">
        {/* Main content */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden">{main}</div>
          {composer ? (
            <div className="relative z-10 border-t border-border/50 bg-surface/96 px-4 py-3 backdrop-blur-sm">
              {composer}
            </div>
          ) : null}
        </section>

        {/* Splitter — drag zone with collapse/expand button */}
        {hasAside && (
          <div
            className={`group relative hidden w-3 flex-shrink-0 select-none lg:flex lg:flex-col lg:items-center lg:justify-center ${asideCollapsed ? 'cursor-default' : 'cursor-col-resize'}`}
            onMouseDown={handleSplitterMouseDown}
          >
            {/* Visible track */}
            <div className="absolute inset-y-0 left-[5px] w-px bg-border/50 transition-colors group-hover:bg-accent/40" />

            {/* Grip dots */}
            {!asideCollapsed && (
              <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-5 text-text-subtle/30 group-hover:text-text-subtle/60 transition-colors">
                <IconGripVertical size={12} />
              </span>
            )}

            {/* Collapse/expand button centered on the splitter */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleAside();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={asideCollapsed
                ? t('workspaceShell.expandAside', '展开{{title}}', { title: resolvedAsideTitle })
                : t('workspaceShell.collapseAside', '收起{{title}}', { title: resolvedAsideTitle })}
              title={asideCollapsed
                ? t('workspaceShell.expandAside', '展开{{title}}', { title: resolvedAsideTitle })
                : t('workspaceShell.collapseAside', '收起{{title}}', { title: resolvedAsideTitle })}
              className={`absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/80 bg-surface shadow-sm text-text-subtle transition-all hover:border-accent/40 hover:bg-surface-card hover:text-accent ${asideCollapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {asideCollapsed ? <IconChevronLeft size={10} /> : <IconChevronRight size={10} />}
            </button>
          </div>
        )}

        {/* Aside / side panel — width managed imperatively via ref */}
        {hasAside ? (
          <aside
            ref={asideRef}
            className="hidden min-h-0 flex-shrink-0 flex-col bg-surface-card/40 overflow-hidden transition-[width] duration-200 lg:flex"
          >
            {!asideCollapsed && aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}