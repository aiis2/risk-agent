import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  IconBrain,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCpu,
  IconDatabaseImport,
  IconLayersDifference,
} from '@tabler/icons-react';
import type { CompactEventRecord, ResearchDimensionProgress } from '../../stores/chatStore';

const COMPACT_THRESHOLD_TOKENS = 80_000;
const MAX_STEP_COUNT = 30;
const SEGMENT_COUNT = 18;

function formatTokenCompact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

function resolveUsageTone(ratio: number) {
  if (ratio >= 0.95) {
    return {
      textClass: 'text-danger',
      fillClass: 'bg-danger',
      accentClass: 'border-danger/20 bg-danger/10',
    };
  }

  if (ratio >= 0.8) {
    return {
      textClass: 'text-warn',
      fillClass: 'bg-warn',
      accentClass: 'border-warn/20 bg-warn/10',
    };
  }

  if (ratio >= 0.6) {
    return {
      textClass: 'text-warn',
      fillClass: 'bg-warn',
      accentClass: 'border-warn/15 bg-warn/5',
    };
  }

  return {
    textClass: 'text-text-muted',
    fillClass: 'bg-accent',
    accentClass: 'border-border-subtle/50 bg-surface-card/30',
  };
}

function SegmentedProgress({
  ratio,
  fillClass,
  animate = false,
  segments = SEGMENT_COUNT,
}: {
  ratio: number;
  fillClass: string;
  animate?: boolean;
  segments?: number;
}) {
  const safeRatio = Math.max(0, Math.min(ratio, 1));
  const filledCount = safeRatio <= 0 ? 0 : Math.max(1, Math.round(safeRatio * segments));

  return (
    <div className="grid min-w-[108px] flex-1 grid-cols-[repeat(18,minmax(0,1fr))] gap-1">
      {Array.from({ length: segments }, (_, index) => {
        const filled = index < filledCount;
        return (
          <span
            key={index}
            className={clsx(
              'h-1.5 rounded-full transition-colors',
              filled ? fillClass : 'bg-surface-soft',
              animate && filled && index === filledCount - 1 ? 'animate-pulse' : null,
            )}
          />
        );
      })}
    </div>
  );
}

function ResearchProgressRow({ dimensions }: { dimensions: ResearchDimensionProgress[] }) {
  const { t } = useTranslation();
  const doneCount = dimensions.filter((dimension) => dimension.status === 'completed' || dimension.status === 'aggregating').length;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-[10px] text-text-muted">
        <IconBrain size={10} />
        {t('analysis.signals.researchProgress', '研究维度 {{done}}/{{total}}', { done: doneCount, total: dimensions.length })}
      </span>
      {dimensions.map((dimension) => (
        <span
          key={dimension.dimension}
          className={clsx(
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
            dimension.status === 'completed' || dimension.status === 'aggregating'
              ? 'border-success/25 bg-success/8 text-success'
              : dimension.status === 'skipped'
                ? 'border-border/40 text-text-muted'
                : 'border-accent/25 bg-accent/8 text-accent',
          )}
        >
          {dimension.status === 'completed' || dimension.status === 'aggregating' ? (
            <IconCircleCheckFilled size={7} />
          ) : dimension.status === 'skipped' ? null : (
            <IconCircleDot size={7} className="animate-pulse" />
          )}
          {dimension.dimension}
        </span>
      ))}
    </div>
  );
}

function CompactSnipBar({ snipCount, reason }: { snipCount: number; reason?: string }) {
  const { t } = useTranslation();

  return (
    <div className="mt-1 flex w-full items-center gap-2 rounded-xl border border-border-subtle/70 bg-surface-card/40 px-3 py-1.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/50 bg-surface-soft text-text-dim">
        <IconLayersDifference size={11} />
      </span>
      <p className="text-[11px] text-text-muted">
        {t('analysis.signals.compacted', '已压缩 {{count}} 次', { count: snipCount })}
        {reason ? t('analysis.signals.compactReason', '，原因：{{reason}}', { reason }) : ''}
      </p>
    </div>
  );
}

function TokenBudgetBar({
  totalInputTokens,
  totalOutputTokens,
  compactEvents,
}: {
  totalInputTokens: number;
  totalOutputTokens: number;
  compactEvents: CompactEventRecord[];
}) {
  const { t } = useTranslation();
  const totalTokens = totalInputTokens + totalOutputTokens;
  const ratio = Math.min(totalTokens / COMPACT_THRESHOLD_TOKENS, 1);
  const tone = resolveUsageTone(ratio);

  return (
    <div className={clsx('mt-1 flex w-full items-center gap-2 rounded-xl border px-3 py-1.5', tone.accentClass)}>
      <IconCpu size={11} className={clsx('shrink-0', tone.textClass)} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className={clsx('font-mono text-[11px]', tone.textClass)}>
          {formatTokenCompact(totalTokens)} / {formatTokenCompact(COMPACT_THRESHOLD_TOKENS)}
        </span>
        <SegmentedProgress ratio={ratio} fillClass={tone.fillClass} />
        {compactEvents.length > 0 ? <span className="text-[10px] text-text-muted">{t('analysis.signals.compactSummary', '压缩×{{count}}', { count: compactEvents.length })}</span> : null}
        {ratio >= 0.8 ? <span className={clsx('text-[10px]', tone.textClass)}>{t('analysis.signals.nearThreshold', '接近阈值')}</span> : null}
      </div>
    </div>
  );
}

function MemoryWriteBanner({ count }: { count: number }) {
  const { t } = useTranslation();

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/10 px-3 py-2">
      <IconDatabaseImport size={14} className="shrink-0 text-accent" />
      <span className="text-xs text-text-dim">
        {t('analysis.signals.memoryWritten', '已写入知识库：')}<span className="text-text">{t('analysis.signals.itemCount', '{{count}} 项', { count })}</span>
      </span>
    </div>
  );
}

function CompletionBanner({ reportId }: { reportId?: string }) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-success/25 bg-success/10 p-3.5">
      <IconCircleCheck size={16} className="shrink-0 text-success" />
      <div className="flex-1">
        <p className="text-sm font-medium text-text">{t('analysis.signals.done', '分析完成')}</p>
        {reportId ? (
          <Link to={`/reports/${reportId}`} className="mt-0.5 inline-block text-xs text-accent hover:underline">
            {t('analysis.signals.viewFullReport', '查看完整报告')} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function AnalysisStepCounter({
  turnNumber,
  totalTokens,
  isStreaming,
}: {
  turnNumber?: number;
  totalTokens: number;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();

  if (!isStreaming && totalTokens === 0) {
    return null;
  }

  const ratio = turnNumber ? Math.min(turnNumber / MAX_STEP_COUNT, 1) : 0.03;

  return (
    <div className="sse-step-counter inline-flex min-w-[240px] max-w-[380px] flex-col gap-2 rounded-2xl rounded-tl-sm border border-accent/20 bg-accent/[0.06] px-3.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-accent">
          {turnNumber !== undefined
            ? t('analysis.signals.stepCounter', '步骤 {{current}} / {{total}}', { current: turnNumber, total: MAX_STEP_COUNT })
            : t('analysis.signals.liveProgress', '实时进度')}
        </span>
        {totalTokens > 0 ? (
          <span className="font-mono text-[11px] text-text-muted">~{formatTokenCompact(totalTokens)} {t('analysis.signals.tokens', 'tokens')}</span>
        ) : null}
      </div>
      <SegmentedProgress ratio={ratio} fillClass="bg-accent" animate={isStreaming} />
    </div>
  );
}

export function AnalysisSignalStack({
  researchProgress,
  snipCount,
  lastSnipReason,
  totalInputTokens,
  totalOutputTokens,
  compactEvents,
  memoryWrittenCount,
  done,
  reportId,
}: {
  researchProgress: ResearchDimensionProgress[];
  snipCount: number;
  lastSnipReason?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  compactEvents: CompactEventRecord[];
  memoryWrittenCount: number;
  done: boolean;
  reportId?: string;
}) {
  const totalTokens = totalInputTokens + totalOutputTokens;
  const hasSignals =
    researchProgress.length > 0 ||
    snipCount > 0 ||
    totalTokens > 0 ||
    memoryWrittenCount > 0 ||
    done;

  if (!hasSignals) {
    return null;
  }

  return (
    <div className="space-y-2">
      {researchProgress.length > 0 ? <ResearchProgressRow dimensions={researchProgress} /> : null}
      {snipCount > 0 ? <CompactSnipBar snipCount={snipCount} reason={lastSnipReason} /> : null}
      {totalTokens > 0 ? (
        <TokenBudgetBar
          totalInputTokens={totalInputTokens}
          totalOutputTokens={totalOutputTokens}
          compactEvents={compactEvents}
        />
      ) : null}
      {memoryWrittenCount > 0 ? <MemoryWriteBanner count={memoryWrittenCount} /> : null}
      {done ? <CompletionBanner reportId={reportId} /> : null}
    </div>
  );
}