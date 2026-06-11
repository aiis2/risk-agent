import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconClockHour4,
  IconLoader2,
  IconPlayerPlay,
  IconRoute,
} from '@tabler/icons-react';
import {
  createScheduledRun,
  listScheduledRuns,
  triggerScheduledRun,
  updateScheduledRun,
  type RunTaskKind,
  type ScheduledRunRecord,
} from '../api/client';
import { ScrollArea } from '../components/ui';

const TASK_KIND_VALUES: RunTaskKind[] = ['general', 'analysis', 'knowledge-query', 'skill-management'];

function formatDateTime(value: string | undefined, locale: string, fallback: string): string {
  return value ? new Date(value).toLocaleString(locale) : fallback;
}

function readPrompt(input: Record<string, unknown>): string {
  return typeof input.prompt === 'string' ? input.prompt : '';
}

function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation();

  if (!status) {
    return <span className="text-xs text-text-muted">{t('scheduledRuns.status.notTriggered', '未触发')}</span>;
  }

  const meta = {
    queued: { className: 'text-warn', Icon: IconClockHour4 },
    running: { className: 'text-accent', Icon: IconPlayerPlay },
    completed: { className: 'text-success', Icon: IconCircleCheck },
    failed: { className: 'text-danger', Icon: IconAlertTriangle },
    cancelled: { className: 'text-text-muted', Icon: IconAlertTriangle },
  }[status] ?? { className: 'text-text-muted', Icon: IconClockHour4 };

  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', meta.className)}>
      <meta.Icon size={13} />
      {t(`scheduledRuns.status.${status}`, status)}
    </span>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[24px] border border-border bg-surface-card/80 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.14)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </div>
  );
}

export function ScheduledRuns() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const [taskKind, setTaskKind] = useState<RunTaskKind>('general');
  const [prompt, setPrompt] = useState('');
  const [preferredModel, setPreferredModel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const taskKindOptions = TASK_KIND_VALUES.map((value) => ({
    value,
    label: t(`scheduledRuns.taskKinds.${value}.label`, value),
    detail: t(`scheduledRuns.taskKinds.${value}.detail`, value),
  }));
  const readTaskKindLabel = (taskKind?: RunTaskKind): string => {
    if (!taskKind) {
      return t('scheduledRuns.taskKinds.auto', '自动');
    }

    return taskKindOptions.find((option) => option.value === taskKind)?.label ?? taskKind;
  };
  const formatDisplayDateTime = (value?: string) => formatDateTime(value, i18n.language, t('scheduledRuns.notScheduled', '未计划'));

  const { data: schedules = [], isLoading } = useQuery<ScheduledRunRecord[]>({
    queryKey: ['scheduled-runs'],
    queryFn: listScheduledRuns,
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createScheduledRun>[0]) => createScheduledRun(payload),
    onSuccess: async () => {
      setName('');
      setCron('');
      setTaskKind('general');
      setPrompt('');
      setPreferredModel('');
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ['scheduled-runs'] });
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'scheduled_run_create_failed');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ scheduleId, enabled }: { scheduleId: string; enabled: boolean }) => updateScheduledRun(scheduleId, { enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-runs'] });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: (scheduleId: string) => triggerScheduledRun(scheduleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['scheduled-runs'] });
    },
  });

  const scheduleStats = useMemo(() => ({
    total: schedules.length,
    enabled: schedules.filter((item) => item.enabled).length,
    active: schedules.filter((item) => item.lastStatus === 'queued' || item.lastStatus === 'running').length,
  }), [schedules]);

  const canCreate = name.trim() && cron.trim() && prompt.trim();

  const handleCreate = () => {
    if (!canCreate) {
      setFormError(t('scheduledRuns.validation.required', '调度名称、Cron 表达式和提示词必填。'));
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      cron: cron.trim(),
      taskKind,
      input: { prompt: prompt.trim() },
      preferredModel: preferredModel.trim() || undefined,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-text">
      <header className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-accent">
              <IconClockHour4 size={12} />
              {t('scheduledRuns.eyebrow', '定时运行')}
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-text">{t('scheduledRuns.title', '让常规风控巡检自己跑起来')}</h1>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              {t('scheduledRuns.description', '这里管理第一版 cron 调度。优先覆盖固定巡检、晨检汇总、知识库刷新和技能维护，不做过度自动化。')}
            </p>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0 px-6 py-5">
        <div className="space-y-5 pb-6">
          <section className="grid gap-3 md:grid-cols-3">
            <SummaryCard label={t('scheduledRuns.summary.total', '总数')} value={String(scheduleStats.total)} hint={t('scheduledRuns.summary.totalHint', '已登记的调度定义')} />
            <SummaryCard label={t('scheduledRuns.summary.enabled', '启用中')} value={String(scheduleStats.enabled)} hint={t('scheduledRuns.summary.enabledHint', '当前会继续被 cron 轮询')} />
            <SummaryCard label={t('scheduledRuns.summary.active', '活跃任务')} value={String(scheduleStats.active)} hint={t('scheduledRuns.summary.activeHint', '后台执行队列仍在排队或执行')} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
            <div className="rounded-[28px] border border-border bg-surface-card/80 p-5 shadow-[0_20px_46px_rgba(0,0,0,0.18)]">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-text">{t('scheduledRuns.create.title', '创建定时运行')}</h2>
                <p className="mt-1 text-sm text-text-muted">{t('scheduledRuns.create.description', '先定义周期、任务类型与提示词，之后可立即触发验证输出质量。')}</p>
              </div>

              <div className="space-y-4">
                <label className="block text-xs font-medium text-text-muted">
                  <span className="mb-1.5 block">{t('scheduledRuns.fields.name', '调度名称')}</span>
                  <input
                    aria-label={t('scheduledRuns.fields.name', '调度名称')}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-accent/50"
                    placeholder={t('scheduledRuns.placeholders.name', '例如：每小时支付风险摘要')}
                  />
                </label>

                <label className="block text-xs font-medium text-text-muted">
                  <span className="mb-1.5 block">{t('scheduledRuns.fields.cron', 'Cron 表达式')}</span>
                  <input
                    aria-label={t('scheduledRuns.fields.cron', 'Cron 表达式')}
                    value={cron}
                    onChange={(event) => setCron(event.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-accent/50"
                    placeholder="0 * * * *"
                  />
                </label>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-text-muted">{t('scheduledRuns.fields.taskType', '任务类型')}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {taskKindOptions.map((option) => {
                      const selected = option.value === taskKind;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-label={t('scheduledRuns.taskTypeAria', '{{label}} 任务类型', { label: option.label })}
                          onClick={() => setTaskKind(option.value)}
                          className={clsx(
                            'rounded-2xl border px-3 py-3 text-left transition',
                            selected
                              ? 'border-accent/45 bg-accent/12 text-text'
                              : 'border-border bg-surface text-text-muted hover:border-accent/25 hover:text-text'
                          )}
                        >
                          <div className="text-sm font-medium">{option.label}</div>
                          <div className="mt-1 text-xs leading-5 text-text-muted">{option.detail}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="block text-xs font-medium text-text-muted">
                  <span className="mb-1.5 block">{t('scheduledRuns.fields.prompt', '运行提示词')}</span>
                  <textarea
                    aria-label={t('scheduledRuns.fields.prompt', '运行提示词')}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    rows={6}
                    className="w-full rounded-[18px] border border-border bg-surface px-3 py-2 text-sm leading-6 text-text outline-none transition focus:border-accent/50"
                    placeholder={t('scheduledRuns.placeholders.prompt', '例如：分析最近五分钟的异常登录风险')}
                  />
                </label>

                <label className="block text-xs font-medium text-text-muted">
                  <span className="mb-1.5 block">{t('scheduledRuns.fields.preferredModel', '首选模型')}</span>
                  <input
                    aria-label={t('scheduledRuns.fields.preferredModel', '首选模型')}
                    value={preferredModel}
                    onChange={(event) => setPreferredModel(event.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-accent/50"
                    placeholder={t('scheduledRuns.placeholders.preferredModel', '可选，例如 qwen3-coder-plus')}
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-text-muted">
                    {formError ? <p className="text-danger">{formError}</p> : <p>{t('scheduledRuns.create.queueHint', '调度创建后会进入共享后台执行队列，由服务端每 15 秒轮询一次。')}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!canCreate || createMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {createMutation.isPending ? <IconLoader2 size={15} className="animate-spin" /> : <IconPlayerPlay size={15} />}
                    {t('scheduledRuns.create.action', '创建定时运行')}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-border bg-surface-card/70 p-5 shadow-[0_20px_46px_rgba(0,0,0,0.14)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-text">{t('scheduledRuns.list.title', '已登记调度')}</h2>
                  <p className="mt-1 text-sm text-text-muted">{t('scheduledRuns.list.description', '优先展示下一次触发时间、最近结果和手动干预入口。')}</p>
                </div>
                <span className="rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-xs text-text-muted">
                  {t('scheduledRuns.list.totalCount', '{{count}} 个调度', { count: scheduleStats.total })}
                </span>
              </div>

              <div className="space-y-3">
                {isLoading ? (
                  <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-8 text-sm text-text-muted">
                    <IconLoader2 size={18} className="mr-2 animate-spin" />
                    {t('scheduledRuns.loading', '正在加载调度...')}
                  </div>
                ) : schedules.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-text-muted">
                    {t('scheduledRuns.empty', '还没有定时运行。先创建一个固定巡检，验证 Cron 表达式与提示词是否稳定。')}
                  </div>
                ) : (
                  schedules.map((schedule) => (
                    <article
                      key={schedule.scheduleId}
                      className="rounded-[24px] border border-border bg-surface p-4 transition hover:border-accent/20"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-text">{schedule.name}</h3>
                            <span className="rounded-full border border-border-subtle bg-surface-card px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-text-muted">
                              {readTaskKindLabel(schedule.taskKind)}
                            </span>
                            <StatusBadge status={schedule.lastStatus} />
                          </div>
                          <p className="mt-2 text-xs leading-6 text-text-muted">{readPrompt(schedule.input) || '未设置提示词'}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-label={t('scheduledRuns.toggleAction', '{{action}} {{name}}', {
                              action: schedule.enabled ? t('scheduledRuns.actions.disable', '停用') : t('scheduledRuns.actions.enable', '启用'),
                              name: schedule.name,
                            })}
                            onClick={() => toggleMutation.mutate({ scheduleId: schedule.scheduleId, enabled: !schedule.enabled })}
                            className={clsx(
                              'rounded-xl border px-3 py-1.5 text-xs font-medium transition',
                              schedule.enabled
                                ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
                                : 'border-border bg-surface-card text-text-muted hover:text-text'
                            )}
                          >
                            {schedule.enabled ? t('scheduledRuns.actions.disable', '停用') : t('scheduledRuns.actions.enable', '启用')}
                          </button>
                          <button
                            type="button"
                            aria-label={t('scheduledRuns.actions.triggerNowAria', '立即触发 {{name}}', { name: schedule.name })}
                            onClick={() => triggerMutation.mutate(schedule.scheduleId)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90"
                          >
                            <IconPlayerPlay size={13} />
                            {t('scheduledRuns.actions.triggerNow', '立即触发')}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 text-xs text-text-muted md:grid-cols-3">
                        <div className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-2.5">
                          <div className="font-medium text-text">{t('scheduledRuns.fields.cron', 'Cron 表达式')}</div>
                          <div className="mt-1 font-mono">{schedule.cron}</div>
                        </div>
                        <div className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-2.5">
                          <div className="font-medium text-text">{t('scheduledRuns.nextRun', '下次执行')}</div>
                          <div className="mt-1">{formatDisplayDateTime(schedule.nextRunAt)}</div>
                        </div>
                        <div className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-2.5">
                          <div className="font-medium text-text">{t('scheduledRuns.lastTriggered', '最近触发')}</div>
                          <div className="mt-1">{formatDisplayDateTime(schedule.lastTriggeredAt)}</div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
                        <div className="flex flex-wrap items-center gap-3">
                          <span>{t('scheduledRuns.createdAt', '创建于 {{date}}', { date: formatDisplayDateTime(schedule.createdAt) })}</span>
                          {schedule.lastError ? <span className="text-danger">{t('scheduledRuns.lastError', '错误：{{error}}', { error: schedule.lastError })}</span> : null}
                        </div>

                        {schedule.lastRunId ? (
                          <Link
                            to={`/runs/${schedule.lastRunId}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1.5 text-xs text-text transition hover:border-accent/25 hover:text-accent"
                          >
                            <IconRoute size={13} />
                            {t('scheduledRuns.viewLatestRun', '查看最近运行')}
                          </Link>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}