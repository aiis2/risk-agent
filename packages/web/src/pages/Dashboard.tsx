import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  IconLayoutDashboard, IconBook, IconShieldCheck, IconMessage, IconFileText,
  IconTrendingUp, IconChartBar, IconArrowRight, IconBolt, IconClock,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { listReports, listRules, listScenarios, listSessions } from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';

type StatAccent = 'accent' | 'success' | 'warn' | 'danger';

function StatCard({
  label, value, icon, accent,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: StatAccent;
}) {
  const iconBg = clsx(
    'flex items-center justify-center w-9 h-9 rounded-xl',
    accent === 'accent' && 'bg-accent/15 text-accent',
    accent === 'success' && 'bg-success/15 text-success',
    accent === 'warn' && 'bg-warn/15 text-warn',
    accent === 'danger' && 'bg-danger/15 text-danger',
  );
  return (
    <div className="bg-surface-card border border-border-subtle rounded-xl p-4 hover:border-border transition-colors group">
      <div className="flex items-start justify-between">
        <div className={iconBg}>{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-bold text-text tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: listScenarios });
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => listRules() });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions });
  const reports = useQuery({ queryKey: ['reports'], queryFn: listReports });
  const latest = reports.data?.[0];
  const recentSessions = (sessions.data ?? []).slice(0, 5);

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-success' : score >= 60 ? 'text-warn' : 'text-danger';
  const scoreBg = (score: number) =>
    score >= 80 ? 'bg-success/15 border-success/25' : score >= 60 ? 'bg-warn/15 border-warn/25' : 'bg-danger/15 border-danger/25';

  return (
    <ScrollArea className="flex-1 bg-surface">
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-subtle bg-surface-sidebar shrink-0">
          <IconLayoutDashboard size={14} className="text-accent" />
          <h1 className="text-sm font-semibold text-text">{t('dashboard.title')}</h1>
          <span className="ml-auto text-[10px] text-text-muted">
            {new Date().toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>

        <div className="w-full flex-1 p-5 space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label={t('dashboard.scenarios')}
              value={scenarios.data?.length ?? '—'}
              icon={<IconBook size={18} />}
              accent="accent"
            />
            <StatCard
              label={t('dashboard.rules')}
              value={rules.data?.length ?? '—'}
              icon={<IconShieldCheck size={18} />}
              accent="success"
            />
            <StatCard
              label={t('dashboard.sessions')}
              value={sessions.data?.length ?? '—'}
              icon={<IconMessage size={18} />}
              accent="warn"
            />
            <StatCard
              label={t('dashboard.reports', '已生成报告')}
              value={reports.data?.length ?? '—'}
              icon={<IconFileText size={18} />}
              accent="accent"
            />
          </div>

          {/* Two-column: Latest Report + Quick Actions */}
          <div className="grid grid-cols-[1fr_200px] gap-4">
            {/* Latest Report */}
            <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <IconTrendingUp size={14} className="text-accent" />
                  <h2 className="text-sm font-semibold text-text">{t('dashboard.latestReport')}</h2>
                </div>
                <Link to="/reports" className="text-[10px] text-text-muted hover:text-accent flex items-center gap-0.5 transition-colors">
                  {t('dashboard.allReports', '全部报告')} <IconArrowRight size={10} />
                </Link>
              </div>
              {latest ? (
                <div className="flex items-center gap-4">
                  <div className={clsx('w-14 h-14 rounded-xl flex flex-col items-center justify-center border shrink-0', scoreBg(latest.overallScore))}>
                    <span className={clsx('text-xl font-bold tabular-nums', scoreColor(latest.overallScore))}>{latest.overallScore.toFixed(1)}</span>
                    <span className="text-[8px] text-text-muted mt-0.5">{t('dashboard.overallScore', '综合分')}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text truncate">{latest.businessName}</p>
                    <p className="text-[11px] text-text-muted mt-0.5 flex items-center gap-1">
                      <IconClock size={10} /> {latest.createdAt}
                    </p>
                    <Link
                      to={`/reports/${latest.reportId}`}
                      className="inline-flex items-center gap-1 mt-2 text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      {t('dashboard.viewReport', '查看报告')} <IconArrowRight size={11} />
                    </Link>
                  </div>
                  {/* Score breakdown from coverage metrics */}
                  <div className="flex flex-col gap-1.5 text-right shrink-0">
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      <IconChartBar size={11} className="text-accent/60" />
                      <span>{t('dashboard.reportReady', '报告已就绪')}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <IconFileText size={28} className="text-text-muted/40 mb-2" />
                  <p className="text-sm text-text-muted">{t('dashboard.noReport')}</p>
                  <Link to="/workbench" className="mt-2 text-xs text-accent hover:underline">
                    {t('dashboard.startAnalysis', '开始分析')} →
                  </Link>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-surface-card border border-border-subtle rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-1">
                <IconBolt size={14} className="text-warn" />
                <h2 className="text-sm font-semibold text-text">{t('dashboard.quickActions', '快捷操作')}</h2>
              </div>
              <Link
                to="/workbench"
                className="flex items-center justify-between rounded-lg bg-accent/10 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                <span>{t('dashboard.newRun', '新建运行')}</span>
                <IconArrowRight size={12} />
              </Link>
              <Link
                to="/scenarios"
                className="flex items-center justify-between rounded-lg bg-surface-soft px-3 py-2 text-xs text-text hover:bg-surface-hover transition-colors"
              >
                <span>{t('dashboard.manageScenarios', '管理场景')}</span>
                <IconArrowRight size={12} />
              </Link>
              <Link
                to="/reports"
                className="flex items-center justify-between rounded-lg bg-surface-soft px-3 py-2 text-xs text-text hover:bg-surface-hover transition-colors"
              >
                <span>{t('dashboard.viewReports', '查看报告')}</span>
                <IconArrowRight size={12} />
              </Link>
              <Link
                to="/chat"
                className="flex items-center justify-between rounded-lg bg-surface-soft px-3 py-2 text-xs text-text hover:bg-surface-hover transition-colors"
              >
                <span>{t('dashboard.smartChat', '智能对话')}</span>
                <IconArrowRight size={12} />
              </Link>
            </div>
          </div>

          {/* Recent Sessions */}
          <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <IconMessage size={14} className="text-warn" />
                <h2 className="text-sm font-semibold text-text">{t('nav.recentSessions', '历史会话')}</h2>
              </div>
              <Link to="/chat" className="text-[10px] text-text-muted hover:text-accent flex items-center gap-0.5 transition-colors">
                {t('dashboard.viewAllSessions', '全部')} <IconArrowRight size={10} />
              </Link>
            </div>
            {recentSessions.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-text-muted">{t('common.empty', '暂无记录')}</div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {recentSessions.map((s) => (
                  <div key={s.sessionId} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-hover transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text truncate">{s.businessName}</p>
                      <p className="text-[11px] text-text-muted mt-0.5 flex items-center gap-1">
                        <IconClock size={9} /> {s.createdAt}
                      </p>
                    </div>
                    <span className={clsx(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      s.status === 'completed' ? 'bg-success/10 border-success/25 text-success'
                        : s.status === 'running' ? 'bg-warn/10 border-warn/25 text-warn'
                        : 'bg-border/30 border-border text-text-muted'
                    )}>
                      {t(`sessions.status.${s.status}`, s.status)}
                    </span>
                    <Link to={`/analyze?session=${s.sessionId}&resume=1`} className="text-[10px] text-accent hover:text-accent-hover flex items-center gap-0.5 transition-colors">
                      {t('dashboard.viewSession', '查看')} <IconArrowRight size={9} />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
