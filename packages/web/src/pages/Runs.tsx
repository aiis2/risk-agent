import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconPlayerPlay, IconCircleCheck, IconAlertTriangle, IconClock } from '@tabler/icons-react';
import { listRuns, type RunSummary, type RunStatusValue, type RunTaskKind } from '../api/client';
import { ScrollArea } from '../components/ui';

const STATUS_ICON: Record<RunStatusValue, typeof IconPlayerPlay> = {
  created: IconClock,
  routing: IconPlayerPlay,
  planning: IconPlayerPlay,
  running: IconPlayerPlay,
  waiting_user: IconClock,
  verifying: IconPlayerPlay,
  completed: IconCircleCheck,
  failed: IconAlertTriangle,
  cancelled: IconAlertTriangle,
};

const STATUS_COLOR: Partial<Record<RunStatusValue, string>> = {
  completed: 'text-success',
  failed: 'text-danger',
  cancelled: 'text-text-muted',
  running: 'text-accent',
  waiting_user: 'text-warn',
};

function RunStatusBadge({ status }: { status: RunStatusValue }) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[status] ?? IconClock;
  const color = STATUS_COLOR[status] ?? 'text-text-muted';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon size={14} />
      {t(`runs.status.${status}`, status)}
    </span>
  );
}

function getTaskKindLabel(t: ReturnType<typeof useTranslation>['t'], taskKind?: RunTaskKind) {
  if (!taskKind) {
    return t('runs.taskKinds.default', 'Run');
  }
  return t(`runs.taskKinds.${taskKind}`, taskKind);
}

export function Runs() {
  const { t, i18n } = useTranslation();
  const { data: runs = [], isLoading } = useQuery<RunSummary[]>({
    queryKey: ['runs'],
    queryFn: listRuns,
    refetchInterval: 10000,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-text">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{t('runs.title', 'Runs')}</h1>
        <Link
          to="/workbench"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          <IconPlayerPlay size={16} />
          {t('runs.newRun', 'New Run')}
        </Link>
      </header>

      <ScrollArea className="flex-1 min-h-0 px-6 py-4">
        {isLoading && (
          <p className="py-8 text-center text-sm text-text-muted">{t('runs.loading', 'Loading...')}</p>
        )}
        {!isLoading && runs.length === 0 && (
          <p className="py-8 text-center text-sm text-text-muted">
            {t('runs.empty', 'No runs yet. Start one from the workbench.')}
          </p>
        )}
        <div className="space-y-3">
          {runs.map((run) => (
            <Link
              key={run.runId}
              to={`/runs/${run.runId}`}
              className="block rounded-2xl border border-border bg-surface-card p-4 transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium text-text">{getTaskKindLabel(t, run.taskKind)}</span>
                  <span className="text-[10px] text-text-muted font-mono truncate">{run.runId}</span>
                </div>
                <RunStatusBadge status={run.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>
                  {t('runs.createdAt', 'Created {{date}}', {
                    date: new Date(run.createdAt).toLocaleString(i18n.language),
                  })}
                </span>
                {run.metrics && (
                  <>
                    <span>{t('runs.metrics.turns', '{{count}} turns', { count: run.metrics.turnCount })}</span>
                    <span>
                      {t('runs.metrics.tokens', '{{input}} / {{output}} tokens', {
                        input: run.metrics.inputTokens,
                        output: run.metrics.outputTokens,
                      })}
                    </span>
                    <span>{t('runs.metrics.cost', '${{cost}}', { cost: run.metrics.estimatedUsd.toFixed(4) })}</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
