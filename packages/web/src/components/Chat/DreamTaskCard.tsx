/**
 * DreamTaskCard — v3.3 agent-framework.md §30
 * 显示 Dream Task（后台异步任务）的运行状态和进度
 */
import { useState } from 'react';
import {
  IconMoonStars,
  IconCircleCheck,
  IconLoader2,
  IconAlertCircle,
  IconBan,
  IconChevronDown,
  IconClockHour4,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { DreamTaskRecord, DreamTaskStatus } from '../../stores/chatStore';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui';

interface DreamTaskCardProps {
  task: DreamTaskRecord;
}

function statusColor(status: DreamTaskStatus) {
  switch (status) {
    case 'completed': return 'text-success';
    case 'running': return 'text-accent';
    case 'queued': return 'text-warn';
    case 'failed': return 'text-danger';
    case 'cancelled': return 'text-text-muted';
  }
}

function statusBorder(status: DreamTaskStatus) {
  switch (status) {
    case 'completed': return 'border-success/20 bg-success/10';
    case 'running': return 'border-accent/20 bg-accent/10';
    case 'queued': return 'border-warn/20 bg-warn/10';
    case 'failed': return 'border-danger/20 bg-danger/10';
    case 'cancelled': return 'border-border/60 bg-surface-card';
  }
}

function StatusIcon({ status }: { status: DreamTaskStatus }) {
  switch (status) {
    case 'completed': return <IconCircleCheck size={12} className="text-success" />;
    case 'running': return <IconLoader2 size={12} className="animate-spin text-accent" />;
    case 'queued': return <IconClockHour4 size={12} className="text-warn" />;
    case 'failed': return <IconAlertCircle size={12} className="text-danger" />;
    case 'cancelled': return <IconBan size={12} className="text-text-muted" />;
  }
}

const STATUS_LABELS: Record<DreamTaskStatus, string> = {
  queued: '排队中',
  running: '后台运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function DreamTaskCard({ task }: DreamTaskCardProps) {
  const [open, setOpen] = useState(task.status === 'running');
  const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={clsx(
        'mt-1 overflow-hidden rounded-[18px] border shadow-[0_8px_20px_rgba(0,0,0,0.08)]',
        statusBorder(task.status)
      )}
    >
      {/* Header */}
      <CollapsibleTrigger asChild>
        <button
          className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-soft/40"
        >
          <IconChevronDown
            size={11}
            className={clsx('mt-0.5 shrink-0 text-text-muted transition-transform', open ? 'rotate-0' : '-rotate-90')}
          />
          <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-[12px] border', statusBorder(task.status), statusColor(task.status))}>
            <IconMoonStars size={12} className={clsx('shrink-0', statusColor(task.status))} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-border/60 bg-surface-soft/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                后台任务
              </span>
              <span className="text-[10px] font-mono text-text-muted">{task.taskId}</span>
            </div>
            <p className="mt-1.5 truncate text-[13px] font-semibold text-text">
              {task.description || task.taskId}
            </p>
            {task.status === 'running' && task.progress.length > 0 && !open && (
              <p className="mt-0.5 text-[12px] leading-5 text-accent/80">{task.progress[task.progress.length - 1]}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            <StatusIcon status={task.status} />
            <span className={clsx('rounded-full border px-2 py-1 text-[10px] font-mono', statusBorder(task.status), statusColor(task.status))}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>
        </button>
      </CollapsibleTrigger>

      {/* Expanded body */}
      <CollapsibleContent>
        <div className="space-y-2.5 border-t border-border-subtle/60 px-3 pb-3 pt-2.5">
          {/* Summary / result */}
          {task.summary && (
            <div className="rounded-[14px] border border-border-subtle/60 bg-surface-card/55 px-2.5 py-2">
              <p className={clsx(
                'mb-1 text-[10px] uppercase tracking-wide',
                task.status === 'completed' ? 'text-success' : 'text-text-dim'
              )}>
                {task.status === 'completed' ? '结果' : '摘要'}
              </p>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-dim">
                {task.summary}
              </p>
            </div>
          )}

          {/* Progress log */}
          {task.progress.length > 0 && (
            <div className="rounded-[14px] border border-border-subtle/60 bg-surface-card/55 px-2.5 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">进度日志</p>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {task.progress.map((msg, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-[12px] border border-border-subtle/50 bg-surface-sidebar/45 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-muted">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/70 bg-surface-soft text-[10px] text-text-dim">
                      {i + 1}
                    </span>
                    <span className="break-words">{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Terminal badge */}
          {isTerminal && (
            <div className={clsx(
              'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px]',
              task.status === 'completed'
                ? 'border-success/20 bg-success/10 text-success'
                : task.status === 'failed'
                ? 'border-danger/20 bg-danger/10 text-danger'
                : 'border-border/60 bg-border/20 text-text-muted'
            )}>
              <StatusIcon status={task.status} />
              {STATUS_LABELS[task.status]}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
