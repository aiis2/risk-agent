/**
 * WorkerProgressCard — 07-streaming-chat.md §4.2
 * 显示子智能体（Worker）的运行状态、进度和结果摘要
 */
import { useMemo, useState } from 'react';
import {
  IconUsers,
  IconCircleCheck,
  IconLoader2,
  IconChevronDown,
  IconChevronRight,
  IconCurrencyDollar,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { WorkerRecord } from '../../stores/chatStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, ScrollArea } from '../ui';

interface WorkerProgressCardProps {
  worker: WorkerRecord;
}

export function WorkerProgressCard({ worker }: WorkerProgressCardProps) {
  const [open, setOpen] = useState(worker.status !== 'done');
  const isDone = worker.status === 'done';
  const latestProgress = worker.progress[worker.progress.length - 1];
  const progressCount = worker.progress.length;
  const preview = useMemo(() => {
    const source = (isDone ? worker.summary : latestProgress) ?? worker.summary ?? latestProgress ?? '';
    const compact = source.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
  }, [isDone, latestProgress, worker.summary]);

  return (
    <div className={clsx(
      'mt-1 overflow-hidden rounded-[18px] border shadow-[0_10px_24px_rgba(0,0,0,0.1)]',
      isDone ? 'border-success/20 bg-success/[0.05]' : 'border-accent/20 bg-accent/[0.05]'
    )}>
      <Collapsible open={open} onOpenChange={setOpen}>
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
                  isDone
                    ? 'border-success/25 bg-success/10 text-success'
                    : 'border-accent/25 bg-accent/10 text-accent'
                )}
              >
                <IconUsers size={14} className="shrink-0" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={clsx(
                      'rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em]',
                      isDone
                        ? 'border-success/20 bg-success/10 text-success'
                        : 'border-accent/20 bg-accent/10 text-accent'
                    )}
                  >
                    子智能体
                  </span>
                    <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                      执行轨迹
                    </span>
                  {worker.phase && (
                    <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                      {worker.phase}
                    </span>
                  )}
                  {worker.role && (
                    <span className="font-mono text-[10px] text-text-dim">{worker.role}</span>
                  )}
                    {progressCount > 0 && (
                      <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-mono text-text-muted">
                        {progressCount} 条日志
                      </span>
                    )}
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-text">
                  {worker.description || worker.role || worker.agentId}
                </p>
                {!open && preview && (
                  <div className="mt-0.5 text-[12px] leading-5 text-text-dim sm:truncate">{preview}</div>
                )}
              </div>
            </div>

            <div className="flex min-w-[88px] flex-wrap items-center justify-end gap-1.5 pl-5 sm:pl-0">
              <span
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono',
                  isDone
                    ? 'border-success/20 bg-success/10 text-success'
                    : 'border-accent/20 bg-accent/10 text-accent'
                )}
              >
                {isDone ? (
                  <IconCircleCheck size={10} className="text-success" />
                ) : (
                  <IconLoader2 size={10} className="animate-spin text-accent" />
                )}
                {isDone ? '完成' : '运行中'}
              </span>
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-2.5 border-t border-border-subtle/60 px-3.5 pb-3.5 pt-2.5">
            {worker.summary && (
              <div className="rounded-[14px] border border-success/10 bg-success/[0.04] p-2.5">
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-success">摘要</p>
                <p className="text-[12px] leading-relaxed text-text-dim">{worker.summary}</p>
              </div>
            )}

            {worker.tokenUsage && (
              <div className="rounded-[14px] border border-border-subtle/70 bg-surface-sidebar/50 p-2.5">
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <IconCurrencyDollar size={11} className="text-warn" />
                  <span>
                    输入: <span className="font-mono text-accent">{worker.tokenUsage.input.toLocaleString()}</span>
                  </span>
                  <span>
                    输出: <span className="font-mono text-success">{worker.tokenUsage.output.toLocaleString()}</span>
                  </span>
                </div>
              </div>
            )}

            {worker.progress.length > 0 && (
              <div className="rounded-[14px] border border-border-subtle/70 bg-surface-sidebar/50 p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">执行轨迹</p>
                  <span className="rounded-full border border-border/70 bg-surface-soft px-2 py-1 text-[9px] font-mono text-text-muted">
                    {progressCount} 条日志
                  </span>
                </div>
                <ScrollArea className="max-h-32">
                  <div className="space-y-1.5 pr-2">
                    {worker.progress.map((p, i) => (
                      <div key={i} className="relative rounded-[14px] border border-border-subtle/60 bg-surface-card/55 px-2.5 py-2 text-[11px] leading-relaxed text-text-muted">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/70 bg-surface-soft font-mono text-[10px] text-text-dim">
                            {i + 1}
                          </span>
                          <span className="break-words">{p}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
