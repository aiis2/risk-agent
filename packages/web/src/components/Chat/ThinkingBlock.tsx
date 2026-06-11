/**
 * ThinkingBlock — 07-streaming-chat.md
 * 可折叠的 AI 推理/思维链展示块
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconBrain, IconChevronDown, IconChevronRight, IconLoader2 } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';

interface ThinkingBlockProps {
  text: string;
  streaming?: boolean;
}

export function ThinkingBlock({ text, streaming = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(streaming);
  const previousStreaming = useRef(streaming);
  // Track whether user manually toggled the panel
  const userOverride = useRef(false);

  const preview = useMemo(() => {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
  }, [text]);

  const lineCount = useMemo(() => text.split('\n').length, [text]);
  const charCount = useMemo(() => text.trim().length, [text]);

  useEffect(() => {
    if (streaming) {
      // Auto-open when streaming starts, but only if user hasn't overridden
      if (!userOverride.current) setOpen(true);
    } else if (previousStreaming.current) {
      // Streaming just finished — auto-collapse only if user never manually opened
      if (!userOverride.current) setOpen(false);
    }
    previousStreaming.current = streaming;
  }, [streaming]);

  function handleToggle(next: boolean) {
    userOverride.current = true;
    setOpen(next);
  }

  if (!text) return null;

  return (
    <div className="mt-1 overflow-hidden rounded-[18px] border border-accent/15 bg-surface-card/65 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
      <Collapsible open={open} onOpenChange={handleToggle}>
        <CollapsibleTrigger asChild>
          <button className="flex w-full flex-col gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-surface-soft/30 sm:flex-row sm:items-start sm:gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              {open ? (
                <IconChevronDown size={10} className="mt-1 shrink-0 text-text-muted sm:mt-0" />
              ) : (
                <IconChevronRight size={10} className="mt-1 shrink-0 text-text-muted sm:mt-0" />
              )}
              <div
                className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border',
                  streaming
                    ? 'border-accent/25 bg-accent/10 text-accent'
                    : 'border-border/70 bg-surface-soft text-text-muted'
                )}
              >
                <IconBrain size={14} className={clsx('shrink-0', streaming && 'animate-pulse')} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">
                    推理轨迹
                  </span>
                  <span className="text-[11px] text-text-muted">思考过程</span>
                  <span
                    className={clsx(
                      'rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]',
                      streaming
                        ? 'border-accent/20 bg-accent/10 text-accent'
                        : 'border-border/70 bg-surface-soft text-text-muted'
                    )}
                  >
                    {streaming ? '实时' : '完成'}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] font-semibold text-text">{streaming ? '深度思考中' : '思考过程'}</p>
                <p className="mt-0.5 break-words text-[12px] leading-5 text-text-dim">
                  {open ? '这里保留当前轮次的推理草稿。' : preview || '展开后查看完整推理轨迹。'}
                </p>
              </div>
            </div>

            <div className="flex min-w-[108px] flex-row items-center gap-1.5 pl-4.5 sm:flex-col sm:items-end sm:pl-0">
              <div className="rounded-[14px] border border-border-subtle/70 bg-surface-soft/70 px-2.5 py-1.5 text-right">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-text-muted">草稿体量</p>
                <p className="mt-0.5 text-[13px] font-semibold text-text">{lineCount} 行</p>
                <p className="text-[10px] font-mono text-text-muted">{charCount} 字</p>
              </div>
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono',
                  streaming
                    ? 'border-accent/20 bg-accent/10 text-accent'
                    : 'border-border/70 bg-surface-soft text-text-muted'
                )}
              >
                {streaming ? <IconLoader2 size={10} className="animate-spin" /> : <IconBrain size={10} />}
                {streaming ? '推理中' : '已收束'}
              </span>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-2.5 border-t border-border-subtle/60 px-3.5 pb-3.5 pt-2.5">
            <div className="rounded-[16px] border border-border-subtle/70 bg-surface-sidebar/55 p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">分析草稿</p>
                <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-mono text-text-muted">
                  {lineCount} 行
                </span>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[14px] border border-border-subtle/60 bg-surface-sidebar px-3 py-2.5 font-mono text-[11px] leading-relaxed text-text-dim shadow-inner">
                {text}
                {streaming && (
                  <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />
                )}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
