import { createContext, useContext, useEffect, useId, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconQuote,
  IconTable,
  IconCopy,
  IconCheck,
  IconExternalLink,
  IconMinus,
  IconLoader2,
  IconRoute,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';

const AUTO_COLLAPSE_CODE_LINE_COUNT = 12;
const AUTO_COLLAPSE_CODE_CHAR_COUNT = 420;
const MarkdownBlockCodeContext = createContext(false);
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

// ── Language display name map ──────────────────────────────────────────────
const LANG_DISPLAY: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  py: 'Python', python: 'Python', rs: 'Rust', go: 'Go',
  java: 'Java', kt: 'Kotlin', swift: 'Swift', rb: 'Ruby',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  xml: 'XML', html: 'HTML', css: 'CSS', scss: 'SCSS',
  sql: 'SQL', md: 'Markdown', txt: 'Text', text: 'Text',
};

function extractLanguage(className?: string): string {
  const match = className?.match(/language-([\w-]+)/);
  return match?.[1]?.toLowerCase() ?? 'text';
}

function normalizeCode(children: React.ReactNode): string {
  return String(children ?? '').replace(/\n$/, '');
}

function shouldAutoCollapseCode(code: string): boolean {
  return code.split('\n').length > AUTO_COLLAPSE_CODE_LINE_COUNT || code.length > AUTO_COLLAPSE_CODE_CHAR_COUNT;
}

async function loadMermaidModule() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
        },
      });
      return module;
    });
  }

  return mermaidModulePromise;
}

function cleanupBodyLevelMermaidScratch() {
  if (typeof document === 'undefined' || !document.body) {
    return;
  }

  Array.from(document.body.children).forEach((element) => {
    if (
      element.id.startsWith('drisk-agent-mermaid-') ||
      element.id.startsWith('risk-agent-mermaid-')
    ) {
      element.remove();
    }
  });
}

export function cleanupMermaidScratch(renderId?: string) {
  if (typeof document === 'undefined') {
    return;
  }

  if (renderId) {
    document.getElementById(`d${renderId}`)?.remove();
    document.getElementById(renderId)?.remove();
  }

  cleanupBodyLevelMermaidScratch();
}

async function renderMermaid(renderId: string, chart: string) {
  const module = await loadMermaidModule();
  try {
    return await module.default.render(renderId, chart);
  } finally {
    cleanupMermaidScratch(renderId);
  }
}

function readRenderedMermaidSvg(rendered: Awaited<ReturnType<typeof renderMermaid>>, chart: string) {
  if (typeof rendered === 'string') {
    return rendered;
  }

  return rendered.svg || `<pre>${chart}</pre>`;
}

// ── Copy Button ────────────────────────────────────────────────────────────
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? '已复制' : '复制代码'}
      className={clsx(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all',
        copied
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border-subtle bg-surface-card text-text-muted hover:border-accent/30 hover:bg-accent/10 hover:text-accent',
        className
      )}
    >
      {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const diagramId = useId().replace(/:/g, '');
  const normalizedChart = chart.trim();

  useEffect(() => {
    let disposed = false;
    setSvg(null);
    setError(null);
    const renderId = `risk-agent-mermaid-${diagramId}`;

    if (!normalizedChart) {
      return () => {
        disposed = true;
      };
    }

    void renderMermaid(renderId, normalizedChart)
      .then((rendered) => {
        const nextSvg = readRenderedMermaidSvg(rendered, normalizedChart);
        if (!disposed) {
          setSvg(nextSvg);
        }
      })
      .catch((renderError) => {
        cleanupMermaidScratch(renderId);
        if (!disposed) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      });

    return () => {
      disposed = true;
      cleanupMermaidScratch(renderId);
    };
  }, [diagramId, normalizedChart]);

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle/70 bg-surface-sidebar px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
          <IconRoute size={11} className="text-accent/80" />
          <span className="text-text-dim">Mermaid 流程图</span>
        </div>
        <CopyButton text={normalizedChart} />
      </div>

      {svg ? (
        <div
          className="overflow-x-auto bg-[linear-gradient(180deg,rgba(248,250,255,0.98),rgba(240,244,255,0.9))] px-3 py-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : error ? (
        <div className="space-y-3 px-4 py-3.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-danger/20 bg-danger/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-danger">
            <IconAlertTriangle size={11} />
            Mermaid 渲染失败
          </div>
          <p className="text-[12px] leading-6 text-text-muted">{error}</p>
          <pre className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card px-3 py-3 text-[12px] leading-[1.75] text-text-dim">
            <code>{normalizedChart}</code>
          </pre>
        </div>
      ) : (
        <div className="space-y-2 px-4 py-3.5">
          <p className="text-[11px] uppercase tracking-[0.16em] text-text-subtle">Mermaid 流程图</p>
          <pre className="overflow-x-auto rounded-xl border border-border-subtle bg-surface-card px-3 py-3 text-[12px] leading-[1.75] text-text-dim">
            <code>{normalizedChart}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Code Block ─────────────────────────────────────────────────────────────
function MarkdownCodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const language = extractLanguage(className);
  const langLabel = LANG_DISPLAY[language] ?? language.toUpperCase();
  const code = normalizeCode(children);

  if (language === 'mermaid') {
    return <MermaidDiagram chart={code} />;
  }

  const collapsible = shouldAutoCollapseCode(code);
  const [open, setOpen] = useState(!collapsible);
  const lineCount = useMemo(() => code.split('\n').length, [code]);

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle/70 bg-surface-sidebar px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
        <IconCode size={11} className="text-accent/80" />
        <span className="text-text-dim">{langLabel}</span>
        {collapsible && (
          <span className="rounded border border-border bg-surface-card px-1.5 py-0.5 text-[9px] text-text-muted">
            {lineCount} 行
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <CopyButton text={code} />
        {collapsible && (
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface-card px-2 py-0.5 text-[10px] text-text-muted transition-colors hover:border-accent/30 hover:text-accent">
              {open ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
              {open ? '收起' : '展开'}
            </button>
          </CollapsibleTrigger>
        )}
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <div className="my-2 overflow-hidden rounded-xl border border-border-subtle bg-surface">
        {header}
        <pre className="overflow-x-auto px-4 py-3.5 text-[12px] leading-[1.75] text-text-dim">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2 overflow-hidden rounded-xl border border-border-subtle bg-surface">
      {header}
      <CollapsibleContent className="data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
        <pre className="overflow-x-auto px-4 py-3.5 text-[12px] leading-[1.75] text-text-dim">
          <code>{code}</code>
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MarkdownPreBlock({ children }: { children?: React.ReactNode }) {
  return <MarkdownBlockCodeContext.Provider value={true}>{children}</MarkdownBlockCodeContext.Provider>;
}

function MarkdownCodeRenderer({ className, children }: { className?: string; children?: React.ReactNode }) {
  const isBlockCode = useContext(MarkdownBlockCodeContext);

  if (!isBlockCode) {
    return (
      <code className={clsx('rounded-md border border-border-subtle bg-surface-sidebar px-1.5 py-0.5 font-mono text-[0.88em] text-accent/70', className)}>
        {children}
      </code>
    );
  }

  return <MarkdownCodeBlock className={className}>{children}</MarkdownCodeBlock>;
}

// ── Main ResponseContent ───────────────────────────────────────────────────
export function ResponseContent({ content, streaming = false, className }: { content: string; streaming?: boolean; className?: string }) {
  const trimmedContent = content.trim();

  if (streaming && !trimmedContent) {
    return (
      <div className="overflow-hidden rounded-[18px] border border-accent/20 bg-accent/[0.05] p-3.5 shadow-[0_8px_20px_rgba(0,0,0,0.1)]">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          <IconLoader2 size={10} className="animate-spin" />
          实时草稿
        </div>
        <p className="mt-2.5 text-[13px] font-semibold text-text">正在生成回答</p>
        <p className="mt-0.5 text-[12px] leading-5 text-text-dim">正文会随着 SSE 流持续追加。</p>
        <div className="mt-3 space-y-1.5" aria-hidden="true">
          <div className="h-2.5 w-11/12 animate-pulse rounded-full bg-surface-soft" />
          <div className="h-2.5 w-9/12 animate-pulse rounded-full bg-surface-soft" />
          <div className="h-2.5 w-10/12 animate-pulse rounded-full bg-surface-soft" />
        </div>
      </div>
    );
  }

  return (
    <div className={clsx('sse-streaming-prose space-y-2.5 text-[13px] leading-6 text-text/90', className)}>
      {streaming && trimmedContent && (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          <IconLoader2 size={10} className="animate-spin" />
          实时草稿
        </div>
      )}

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ── Headings ─────────────────────────────────────────────────────
          h1: ({ children }) => (
            <h1 className="mb-1.5 mt-3 flex items-center gap-2 text-[1.05rem] font-semibold tracking-tight text-text first:mt-0">
              <span className="h-[1.1em] w-1 shrink-0 rounded-full bg-accent" />
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1 mt-2.5 flex items-center gap-2 text-[0.96rem] font-semibold text-text first:mt-0">
              <span className="h-[1em] w-0.5 shrink-0 rounded-full bg-accent/60" />
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-[0.9rem] font-semibold text-text-dim first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-1.5 text-[0.875rem] font-semibold text-text-muted first:mt-0">{children}</h4>
          ),
          // ── Paragraph ─────────────────────────────────────────────────
          p: ({ children }) => (
            <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.75] text-text/90">{children}</p>
          ),
          // ── Lists ────────────────────────────────────────────────────
          ul: ({ children }) => (
            <ul className="space-y-0.5 pl-5 text-[13px] leading-[1.72] text-text/90 [&>li]:relative [&>li]:before:absolute [&>li]:before:-left-3.5 [&>li]:before:top-[0.68em] [&>li]:before:h-1.5 [&>li]:before:w-1.5 [&>li]:before:rounded-full [&>li]:before:bg-accent/50 [&>li]:list-none">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-0.5 pl-5 text-[13px] leading-[1.72] text-text/90 marker:text-accent/50">
              {children}
            </ol>
          ),
          // ── Blockquote ────────────────────────────────────────────────
          blockquote: ({ children }) => (
            <blockquote className="relative overflow-hidden rounded-[16px] border border-accent/15 bg-accent/[0.06] px-3.5 py-3 text-[13px] leading-[1.72] text-text/80">
              <IconQuote size={28} className="absolute right-3 top-2 text-accent/10" />
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                <IconQuote size={10} />
                重点提示
              </div>
              <div className="space-y-1">{children}</div>
            </blockquote>
          ),
          // ── HR ────────────────────────────────────────────────────────
          hr: () => (
            <div className="my-4 flex items-center gap-2">
              <div className="h-px flex-1 bg-border-subtle" />
              <IconMinus size={10} className="text-text-muted" />
              <div className="h-px flex-1 bg-border-subtle" />
            </div>
          ),
          // ── Table ────────────────────────────────────────────────────
          table: ({ children }) => (
            <div className="my-1.5 overflow-hidden rounded-[16px] border border-border-subtle bg-surface-sidebar">
              <div className="flex items-center gap-1.5 border-b border-border-subtle/70 bg-surface px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
                <IconTable size={11} className="text-accent/70" />
                <span>数据表格</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm text-text/90">{children}</table>
              </div>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-surface-card/80">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-border-subtle/50">{children}</tbody>,
          tr: ({ children }) => <tr className="transition-colors hover:bg-surface-soft/30">{children}</tr>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim">{children}</th>
          ),
          td: ({ children }) => <td className="px-3 py-2 align-top text-sm text-text/90">{children}</td>,
          // ── Links ─────────────────────────────────────────────────────
          a: ({ children, href }) => {
            // Block non-http(s) protocols (e.g. javascript:) to prevent XSS.
            const safeHref = href && /^https?:\/\//i.test(href) ? href : undefined;
            return (
              <a
                href={safeHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent/80 hover:decoration-accent/60"
              >
                {children}
                <IconExternalLink size={11} className="mb-0.5 shrink-0 opacity-60" />
              </a>
            );
          },
          // ── Inline elements ────────────────────────────────────────────
          strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
          em: ({ children }) => <em className="italic text-text/80">{children}</em>,
          del: ({ children }) => <del className="line-through text-text-muted">{children}</del>,
          // ── Code ──────────────────────────────────────────────────────
          pre: ({ children }) => <MarkdownPreBlock>{children}</MarkdownPreBlock>,
          code: MarkdownCodeRenderer,
        }}
      >
        {content}
      </ReactMarkdown>

      {streaming && (
        <span
          className="inline-block h-4 w-[2px] animate-pulse rounded-sm bg-accent align-middle"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
