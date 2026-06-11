/**
 * ToolCallBlock — 07-streaming-chat.md §5.3
 * 可折叠的工具调用 / 结果展示块
 */
import { useEffect, useMemo, useState } from 'react';
import {
  IconTool,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconLoader2,
  IconClock,
  IconSearch,
  IconDatabase,
  IconFileText,
  IconGraph,
  IconBell,
  IconCode,
  IconBrain,
  IconKey,
  IconCopy,
  IconCheck,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { ToolCallRecord } from '../../stores/chatStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';

// ── Tool icon mapping ──────────────────────────────────────────────────────
type TablerIconComponent = typeof IconTool;

interface ToolVisualMeta {
  pattern: RegExp;
  icon: TablerIconComponent;
  label: string;
  toneClass: string;
}

const TOOL_ICON_MAP: ToolVisualMeta[] = [
  { pattern: /search|find|lookup|query_kb|semantic/i, icon: IconSearch, label: '检索', toneClass: 'border-accent/20 bg-accent/10 text-accent' },
  { pattern: /database|db|sql|query_db|query_data/i, icon: IconDatabase, label: '数据', toneClass: 'border-success/20 bg-success/10 text-success' },
  { pattern: /file|read|write|document|report/i, icon: IconFileText, label: '文档', toneClass: 'border-warn/20 bg-warn/10 text-warn' },
  { pattern: /graph|lineage|knowledge|memory/i, icon: IconGraph, label: '图谱', toneClass: 'border-accent/20 bg-accent/10 text-accent' },
  { pattern: /alert|notify|send|message/i, icon: IconBell, label: '通知', toneClass: 'border-danger/20 bg-danger/10 text-danger' },
  { pattern: /code|execute|run|script|eval/i, icon: IconCode, label: '执行', toneClass: 'border-warn/20 bg-warn/10 text-warn' },
  { pattern: /llm|ai|analyze|think|reason/i, icon: IconBrain, label: '推理', toneClass: 'border-accent/20 bg-accent/10 text-accent' },
  { pattern: /auth|token|secret|key/i, icon: IconKey, label: '安全', toneClass: 'border-border/70 bg-surface-soft text-text-muted' },
];

function getToolMeta(toolName: string): ToolVisualMeta {
  for (const meta of TOOL_ICON_MAP) {
    if (meta.pattern.test(toolName)) return meta;
  }
  return {
    pattern: /.*/,
    icon: IconTool,
    label: '工具',
    toneClass: 'border-border/70 bg-surface-soft text-text-muted',
  };
}

// ── Tool status labels ─────────────────────────────────────────────────────
const TOOL_STATUS_LABELS: Record<ToolCallRecord['status'], string> = {
  running: '执行中',
  done: '完成',
  error: '失败',
};

function StatusIcon({ status, size = 12 }: { status: ToolCallRecord['status']; size?: number }) {
  if (status === 'running') return <IconLoader2 size={size} className="animate-spin text-accent" />;
  if (status === 'done') return <IconCircleCheck size={size} className="text-success" />;
  return <IconCircleX size={size} className="text-danger" />;
}

// ── Copy button ────────────────────────────────────────────────────────────
function CopyResultButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? '已复制' : '复制内容'}
      title={copied ? '已复制' : '复制内容'}
      className={clsx(
        'flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] transition-colors',
        copied
          ? 'border-success/20 bg-success/10 text-success'
          : 'border-border/70 bg-surface-soft text-text-muted hover:border-border hover:text-text-dim'
      )}
    >
      {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
      <span>{copied ? '已复制' : '复制'}</span>
    </button>
  );
}

// ── Format result for display ──────────────────────────────────────────────
function formatResult(result: string): string {
  if (result.length > 3000) return result.slice(0, 3000) + '\n…(内容已截断)';
  return result;
}

function tryPrettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function parseStructuredValue(text: string | undefined): unknown | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatPreviewValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value.length > 48 ? `${value.slice(0, 48)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') return 'Object';
  return String(value);
}

function getStructuredCountLabel(value: unknown): string | null {
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === 'object') return `${Object.keys(value as Record<string, unknown>).length} 个字段`;
  return null;
}

function StructuredPreview({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <div className="mb-2 grid gap-2 sm:grid-cols-2">
        {value.slice(0, 4).map((item, index) => (
          <div key={index} className="rounded-xl border border-border/70 bg-surface-sidebar/80 px-3 py-2.5 text-[11px] text-text-dim">
            <p className="text-[9px] uppercase tracking-[0.14em] text-text-muted">[{index}]</p>
            <p className="mt-1 break-words">{formatPreviewValue(item)}</p>
          </div>
        ))}
      </div>
    );
  }

  if (!value || typeof value !== 'object') return null;

  return (
    <div className="mb-2 grid gap-2 sm:grid-cols-2">
      {Object.entries(value as Record<string, unknown>).slice(0, 6).map(([key, entryValue]) => (
        <div key={key} className="rounded-xl border border-border/70 bg-surface-sidebar/80 px-3 py-2.5 text-[11px] text-text-dim">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-text-muted">{key}</p>
          <p className="mt-1 break-words">{formatPreviewValue(entryValue)}</p>
        </div>
      ))}
    </div>
  );
}

interface ToolCallBlockProps {
  tool: ToolCallRecord;
}

export function ToolCallBlock({ tool }: ToolCallBlockProps) {
  const [open, setOpen] = useState(tool.status !== 'done');

  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  const toolMeta = useMemo(() => getToolMeta(tool.toolName), [tool.toolName]);
  const ToolIcon = toolMeta.icon;

  const preview = useMemo(() => {
    const source = tool.error ?? tool.result ?? '';
    const compact = source.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
  }, [tool.error, tool.result]);

  const prettyResult = useMemo(() => {
    if (!tool.result) return null;
    return tryPrettyJson(tool.result);
  }, [tool.result]);
  const parsedResult = useMemo(() => parseStructuredValue(tool.result), [tool.result]);
  const resultCountLabel = useMemo(() => getStructuredCountLabel(parsedResult), [parsedResult]);
  const paramCountLabel = useMemo(() => getStructuredCountLabel(tool.params), [tool.params]);

  useEffect(() => {
    if (tool.status === 'running' || tool.status === 'error') {
      setOpen(true);
      return;
    }
    setOpen(false);
  }, [tool.status]);

  return (
    <div className={clsx(
      'sse-tool-call-shell mt-1 overflow-hidden rounded-[22px] border shadow-[0_10px_24px_rgba(0,0,0,0.12)] transition-colors',
      isError
        ? 'border-danger/25 bg-danger/[0.05]'
        : isRunning
          ? 'border-accent/25 bg-accent/[0.04]'
          : 'border-border/60 bg-surface-input/95'
    )}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-soft/30 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {open ? (
                <IconChevronDown size={10} className="mt-1 shrink-0 text-text-muted sm:mt-0" />
              ) : (
                <IconChevronRight size={10} className="mt-1 shrink-0 text-text-muted sm:mt-0" />
              )}
              <div
                className={clsx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                  isRunning
                    ? 'border-accent/25 bg-accent/10 text-accent'
                    : isError
                      ? 'border-danger/25 bg-danger/10 text-danger'
                      : 'border-border/70 bg-surface-soft text-text-muted'
                )}
              >
                <ToolIcon size={15} className="shrink-0" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={clsx(
                      'rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em]',
                      toolMeta.toneClass
                    )}
                  >
                    {toolMeta.label}
                  </span>
                </div>
                <p className="mt-2 break-all text-sm font-semibold text-text">{tool.toolName}</p>
                {!open && preview && (
                  <div className="mt-1 text-xs leading-5 text-text-dim sm:truncate">{preview}</div>
                )}
              </div>
            </div>

            <div className="flex min-w-[110px] flex-wrap items-center gap-1.5 pl-5 sm:shrink-0 sm:justify-end sm:pl-0">
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono',
                  isRunning
                    ? 'border-accent/20 bg-accent/10 text-accent'
                    : isError
                      ? 'border-danger/20 bg-danger/10 text-danger'
                      : 'border-success/20 bg-success/10 text-success'
                )}
              >
                <StatusIcon status={tool.status} />
                {TOOL_STATUS_LABELS[tool.status]}
              </span>
              {tool.durationMs !== undefined && (
                <span className="flex items-center gap-1 rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[10px] text-text-muted">
                  <IconClock size={9} />
                  {tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-3 border-t border-border-subtle/60 px-4 pb-4 pt-3">
            {/* Parameters */}
            {tool.params && Object.keys(tool.params).length > 0 && (
              <div className="rounded-[18px] border border-border-subtle/70 bg-surface-sidebar/45 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">输入参数</p>
                  <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-mono text-text-muted">JSON</span>
                  {paramCountLabel && (
                    <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-mono text-text-muted">{paramCountLabel}</span>
                  )}
                </div>
                <StructuredPreview value={tool.params} />
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-surface-sidebar px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-dim shadow-inner">
                  {(() => { const s = JSON.stringify(tool.params, null, 2); return s.length > 3000 ? s.slice(0, 3000) + '\n\u2026 (truncated)' : s; })()}
                </pre>
              </div>
            )}

            {/* Result */}
            {tool.result && (
              <div className="rounded-[18px] border border-success/10 bg-success/[0.04] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-success">
                      {parsedResult ? '结构化结果' : '原始输出'}
                    </p>
                    <span className="rounded-full border border-success/15 bg-success/10 px-2 py-1 text-[9px] font-mono text-success">
                      {parsedResult ? 'JSON' : 'TEXT'}
                    </span>
                    {resultCountLabel && (
                      <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-mono text-text-muted">
                        {resultCountLabel}
                      </span>
                    )}
                  </div>
                  <CopyResultButton text={tool.result} />
                </div>
                {parsedResult !== null ? <StructuredPreview value={parsedResult} /> : null}
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-surface-sidebar px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-dim shadow-inner">
                  {prettyResult ?? formatResult(tool.result)}
                </pre>
              </div>
            )}

            {/* Error */}
            {tool.error && (
              <div className="rounded-[18px] border border-danger/15 bg-danger/[0.04] p-3">
                <div className="mb-1 flex items-center gap-1">
                  <IconAlertTriangle size={10} className="text-danger" />
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-danger">错误</p>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-danger/15 bg-danger/[0.06] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-danger shadow-inner">
                  {tool.error}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
