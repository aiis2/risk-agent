import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  IconFileText, IconDownload, IconChevronLeft, IconChartBar, IconAlertTriangle,
  IconMap, IconCoins, IconChevronDown, IconChevronRight, IconTrash,
  IconFileExport, IconCpu, IconClock, IconTrendingUp, IconShare2,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { exportReportMd, exportReportHtml, getReport, deleteReport, getBusinessGapHistory } from '../api/client';
import type { GapHistoryPoint } from '../api/client';
import { LineageGraph } from '../components/LineageGraph';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Select, SelectItem } from '../components/ui/Select';
import { Dialog, DialogContent } from '../components/ui';

const severityBadge: Record<string, string> = {
  critical: 'text-danger bg-danger/10 border border-danger/25',
  high:     'text-warn bg-warn/10 border border-warn/25',
  medium:   'text-warn bg-warn/10 border border-warn/25',
  low:      'text-success bg-success/10 border border-success/25',
};

const severityLabel: Record<string, string> = {
  critical: 'P0', high: 'P1', medium: 'P2', low: 'P3',
};

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ─── Gap History SVG Chart (06-output-reporting.md §3) ───────────────────────

function GapHistoryChart({ data, currentReportId }: { data: GapHistoryPoint[]; currentReportId?: string }) {
  if (data.length < 2) return null;

  const W = 520; const H = 140; const PAD = { t: 16, r: 16, b: 32, l: 44 };
  const inner = { w: W - PAD.l - PAD.r, h: H - PAD.t - PAD.b };

  const scores = data.map((d) => d.overallScore);
  const minS = Math.min(...scores) - 5;
  const maxS = Math.max(...scores) + 5;

  const x = (i: number) => PAD.l + (i / (data.length - 1)) * inner.w;
  const y = (v: number) => PAD.t + inner.h - ((v - minS) / (maxS - minS)) * inner.h;

  const polyline = data.map((d, i) => `${x(i)},${y(d.overallScore)}`).join(' ');
  // fill area under line
  const area = `M${x(0)},${y(data[0].overallScore)} ` + data.map((d, i) => `L${x(i)},${y(d.overallScore)}`).join(' ') + ` L${x(data.length - 1)},${PAD.t + inner.h} L${x(0)},${PAD.t + inner.h} Z`;

  const yTicks = [minS, (minS + maxS) / 2, maxS].map(Math.round);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" aria-label="风险评分趋势图">
      <defs>
        <linearGradient id="gapGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b8afe" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6b8afe" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} y1={y(v)} x2={PAD.l + inner.w} y2={y(v)} stroke="#2a3054" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fill="#5d6380" fontSize="9" fontFamily="monospace">{v}</text>
        </g>
      ))}

      {/* Area fill */}
      <path d={area} fill="url(#gapGradient)" />

      {/* Line */}
      <polyline points={polyline} fill="none" stroke="#6b8afe" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* Points */}
      {data.map((d, i) => {
        const isCurrent = d.reportId === currentReportId;
        const cx = x(i); const cy = y(d.overallScore);
        return (
          <g key={d.reportId}>
            <circle cx={cx} cy={cy} r={isCurrent ? 5 : 3.5} fill={isCurrent ? '#6b8afe' : '#0f1220'} stroke="#6b8afe" strokeWidth={isCurrent ? 2 : 1.5} />
            {isCurrent && <circle cx={cx} cy={cy} r={8} fill="none" stroke="#6b8afe" strokeWidth="1" strokeOpacity="0.4" />}
            {/* score label */}
            <text x={cx} y={cy - 8} textAnchor="middle" fill="#e6e8f2" fontSize="9" fontWeight={isCurrent ? 'bold' : 'normal'} fontFamily="monospace">{d.overallScore.toFixed(1)}</text>
          </g>
        );
      })}

      {/* X-axis date labels (show first, last, and maybe middle) */}
      {[0, Math.floor(data.length / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => {
        const d = data[i];
        const label = new Date(d.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
        return (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fill="#5d6380" fontSize="9" fontFamily="monospace">{label}</text>
        );
      })}
    </svg>
  );
}

export function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState<string>('zh-CN');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['report', id, locale],
    queryFn: () => getReport(id!, locale),
    enabled: !!id,
  });

  const gapHistory = useQuery({
    queryKey: ['gap-history', data?.businessName],
    queryFn: () => getBusinessGapHistory(data!.businessName),
    enabled: !!data?.businessName,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteReport(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      navigate('/reports');
    },
  });

  const handleExportMd = async () => {
    const md = await exportReportMd(id!, locale);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data?.businessName ?? 'report'}-${locale}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportHtml = async () => {
    const html = await exportReportHtml(id!, locale);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data?.businessName ?? 'report'}-${locale}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleGap = (gapId: string) => {
    setExpandedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(gapId)) next.delete(gapId); else next.add(gapId);
      return next;
    });
  };

  return (
    <ScrollArea className="flex-1 bg-surface">
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-subtle bg-surface-sidebar shrink-0">
          <Link
            to="/reports"
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors mr-1"
          >
            <IconChevronLeft size={13} />
            {t('reports.title')}
          </Link>
          <span className="text-border">/</span>
          <IconFileText size={14} className="text-accent" />
          <h1 className="text-sm font-semibold text-text truncate">
            {isLoading ? t('common.loading') : (data?.businessName ?? id)}
          </h1>
          {data && (
            <div className="ml-auto flex items-center gap-3">
              <div className="w-28">
                <Select value={locale} onValueChange={setLocale}>
                  <SelectItem value="zh-CN">中文</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                </Select>
              </div>
              <button
                onClick={handleExportMd}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-soft hover:bg-surface-hover text-text-dim transition-colors border border-border"
                title="Export Markdown"
              >
                <IconDownload size={12} />
                .md
              </button>
              <button
                onClick={handleExportHtml}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 hover:bg-accent/25 text-accent transition-colors border border-accent/25"
                title="Export HTML"
              >
                <IconFileExport size={12} />
                .html
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-danger/10 hover:bg-danger/20 text-danger transition-colors border border-danger/25"
                title="Delete report"
              >
                <IconTrash size={12} />
              </button>
              <Link
                to={`/knowledge-graph?nodeId=${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 hover:bg-accent/20 text-accent transition-colors border border-accent/25"
                title="在知识图谱中查看"
              >
                <IconShare2 size={12} />
              </Link>
            </div>
          )}
        </div>

        {isLoading || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
            {t('common.loading')}
          </div>
        ) : (
          <div className="w-full flex-1 p-5 space-y-5">
            {/* Score banner */}
            <div className="bg-surface-card border border-border-subtle rounded-xl p-5 flex items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-surface-soft flex flex-col items-center justify-center border border-border shrink-0">
                <span className="text-2xl font-bold text-accent">
                  {Number(data.overallScore).toFixed(1)}
                </span>
                <span className="text-[9px] text-text-muted mt-0.5">{t('reports.overallScore')}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-text">{data.businessName}</h2>
                <p className="text-sm text-text-dim mt-1 leading-relaxed">
                  {data.narrative ?? (data as any).summary ?? ''}
                </p>
                {/* Gap summary pills */}
                {(() => {
                  const gaps: any[] = data.allGaps ?? data.criticalGaps ?? data.gaps ?? [];
                  const counts: Record<string, number> = {};
                  for (const g of gaps) { const s = g.severity ?? 'medium'; counts[s] = (counts[s] ?? 0) + 1; }
                  return (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {Object.entries(counts).map(([sev, cnt]) => (
                        <span key={sev} className={clsx('text-xs px-2 py-0.5 rounded-full border font-mono', severityBadge[sev] ?? severityBadge.medium)}>
                          {severityLabel[sev] ?? sev} × {cnt}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Cost Summary (06-output-reporting.md §8) */}
            {data.costSummary && (
              <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border-subtle">
                  <IconCoins size={13} className="text-warn" />
                  <h2 className="text-sm font-medium text-text">{t('reports.costSummary', '分析成本摘要')}</h2>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <div className="bg-surface-soft rounded-lg p-3">
                      <div className="text-xs text-text-muted mb-1">{t('reports.totalCost', '总费用')}</div>
                      <div className="text-base font-bold font-mono text-warn">
                        ${data.costSummary.totalCostUsd.toFixed(4)}
                      </div>
                    </div>
                    <div className="bg-surface-soft rounded-lg p-3">
                      <div className="text-xs text-text-muted mb-1">{t('reports.inputTokens', '输入 Tokens')}</div>
                      <div className="text-base font-bold font-mono text-accent">
                        {formatTokens(data.costSummary.totalInputTokens)}
                      </div>
                    </div>
                    <div className="bg-surface-soft rounded-lg p-3">
                      <div className="text-xs text-text-muted mb-1">{t('reports.outputTokens', '输出 Tokens')}</div>
                      <div className="text-base font-bold font-mono text-success">
                        {formatTokens(data.costSummary.totalOutputTokens)}
                      </div>
                    </div>
                    <div className="bg-surface-soft rounded-lg p-3">
                      <div className="flex items-center gap-1 text-xs text-text-muted mb-1">
                        <IconClock size={10} />
                        {t('reports.duration', '耗时')}
                      </div>
                      <div className="text-base font-bold font-mono text-text-dim">
                        {formatDuration(data.costSummary.totalApiDurationMs)}
                      </div>
                    </div>
                  </div>
                  {/* Per-model breakdown */}
                  {data.costSummary.modelUsage?.length > 0 && (
                    <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                      <div className="grid grid-cols-[1fr_80px_80px_80px] gap-3 px-4 py-2 text-xs text-text-muted uppercase tracking-wide">
                        <span>{t('reports.model', '模型')}</span>
                        <span className="text-right">{t('reports.inputT', '输入')}</span>
                        <span className="text-right">{t('reports.outputT', '输出')}</span>
                        <span className="text-right">{t('reports.cost', '费用')}</span>
                      </div>
                      {data.costSummary.modelUsage.map((m: any, i: number) => (
                        <div key={i} className="grid grid-cols-[1fr_80px_80px_80px] gap-3 px-4 py-2.5 items-center">
                          <div className="flex items-center gap-1.5">
                            <IconCpu size={11} className="text-text-muted shrink-0" />
                            <span className="text-xs font-mono text-text-dim truncate">{m.model ?? m.modelId}</span>
                          </div>
                          <span className="text-xs font-mono text-accent text-right">{formatTokens(m.inputTokens ?? m.promptTokens ?? 0)}</span>
                          <span className="text-xs font-mono text-success text-right">{formatTokens(m.outputTokens ?? m.completionTokens ?? 0)}</span>
                          <span className="text-xs font-mono text-warn text-right">${(m.costUsd ?? m.totalUsd ?? 0).toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Gap History Trend Chart (06-output-reporting.md §3) */}
            {(gapHistory.data?.length ?? 0) >= 2 && (
              <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border-subtle">
                  <IconTrendingUp size={13} className="text-accent" />
                  <h2 className="text-sm font-medium text-text">{t('reports.gapHistoryTrend', '历史评分趋势')}</h2>
                  <span className="ml-2 text-xs text-text-muted">{gapHistory.data!.length} 次分析</span>
                </div>
                <div className="px-5 py-4">
                  <GapHistoryChart data={gapHistory.data!} currentReportId={id} />
                </div>
              </div>
            )}

            {/* Gaps (grouped by severity) */}
            {(() => {
              const gaps = (data.allGaps ?? data.criticalGaps ?? data.gaps ?? []) as any[];
              const grouped: Record<string, any[]> = {};
              for (const g of gaps) {
                const s = g.severity ?? 'medium';
                if (!grouped[s]) grouped[s] = [];
                grouped[s].push(g);
              }
              const sevOrder = ['critical', 'high', 'medium', 'low'];
              return (
                <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border-subtle">
                    <IconAlertTriangle size={13} className="text-warn" />
                    <h2 className="text-sm font-medium text-text">{t('reports.gaps')}</h2>
                    <span className="ml-2 text-xs text-text-muted">{gaps.length} {t('reports.gapsFound', '项')}</span>
                  </div>
                  {!gaps.length ? (
                    <div className="px-5 py-6 text-sm text-text-muted text-center">{t('common.empty')}</div>
                  ) : (
                    <div className="divide-y divide-border-subtle">
                      {sevOrder.filter((s) => grouped[s]?.length).map((sev) => (
                        <div key={sev}>
                          <div className={clsx('flex items-center gap-2 px-5 py-2 text-xs font-medium', severityBadge[sev])}>
                            <span className="font-mono font-bold">{severityLabel[sev]}</span>
                            <span>{grouped[sev].length} {sev === 'critical' ? '高危' : sev === 'high' ? '中高危' : sev === 'medium' ? '中危' : '低危'}</span>
                          </div>
                          {grouped[sev].map((g: any, i: number) => {
                            const key = g.gapId ?? `${sev}-${i}`;
                            const expanded = expandedGaps.has(key);
                            return (
                              <div key={key} className="border-t border-border-subtle/50">
                                <button
                                  onClick={() => toggleGap(key)}
                                  className="w-full flex items-start gap-3 px-5 py-3 hover:bg-surface-soft transition-colors text-left"
                                >
                                  {expanded ? <IconChevronDown size={13} className="text-text-muted mt-0.5 shrink-0" /> : <IconChevronRight size={13} className="text-text-muted mt-0.5 shrink-0" />}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-medium text-text">{g.title ?? g.description ?? `Gap #${i + 1}`}</span>
                                      {g.scenarioId && (
                                        <span className="text-xs font-mono text-text-muted bg-surface-soft px-1.5 py-0.5 rounded">{g.scenarioId}</span>
                                      )}
                                      {g.dimension && (
                                        <span className="text-xs text-text-dim bg-surface-soft px-1.5 py-0.5 rounded">{g.dimension}</span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                                {expanded && (
                                  <div className="px-11 pb-4 space-y-2">
                                    {g.description && g.description !== g.title && (
                                      <p className="text-xs text-text-dim leading-relaxed">{g.description}</p>
                                    )}
                                    {g.expected && (
                                      <p className="text-xs text-text-muted"><span className="text-text-dim">预期：</span>{g.expected}</p>
                                    )}
                                    {g.suggestion && (
                                      <p className="text-xs text-accent"><span className="text-text-dim">建议：</span>{g.suggestion}</p>
                                    )}
                                    {/* Lineage (06-output-reporting.md §9) */}
                                    {g.lineage && (
                                      <div className="mt-2 p-2 rounded bg-surface-soft border border-border">
                                        <p className="text-xs text-text-muted font-medium mb-1">溯源</p>
                                        {g.lineage.dataSourceRefs?.length > 0 && (
                                          <p className="text-xs text-text-dim">数据源：{g.lineage.dataSourceRefs.join(', ')}</p>
                                        )}
                                        {g.lineage.reactIterations?.length > 0 && (
                                          <p className="text-xs text-text-dim">发现轮次：{g.lineage.reactIterations.join(', ')}</p>
                                        )}
                                        {g.lineage.confidence !== undefined && (
                                          <p className="text-xs text-text-dim">置信度：{(g.lineage.confidence * 100).toFixed(0)}%</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Coverage Matrix */}
            {(() => {
              const matrix = (data.coverageMatrix as any[]) ?? [];
              return matrix.length > 0 ? (
                <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border-subtle">
                    <IconChartBar size={13} className="text-success" />
                    <h2 className="text-sm font-medium text-text">{t('reports.coverageMatrix', '规则覆盖矩阵')}</h2>
                  </div>
                  <div className="divide-y divide-border-subtle">
                    <div className="grid grid-cols-[1fr_110px_1fr] gap-4 px-5 py-2.5 text-xs text-text-muted uppercase tracking-wide">
                      <span>{t('scenarios.name')}</span>
                      <span>{t('reports.coveragePercent', '覆盖率')}</span>
                      <span>{t('reports.missingRuleTypes', '缺失规则类型')}</span>
                    </div>
                    {matrix.map((row: any, i: number) => {
                      const pct = Number(row.coveragePercent ?? 0);
                      const barColor = pct >= 80 ? 'bg-success' : pct >= 50 ? 'bg-warn' : 'bg-danger';
                      return (
                        <div key={row.scenarioId ?? i} className="grid grid-cols-[1fr_110px_1fr] gap-4 px-5 py-3 items-center hover:bg-surface-soft transition-colors">
                          <span className="text-sm text-text truncate">{row.scenarioName ?? row.scenarioId}</span>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                              <div className={clsx('h-full rounded-full transition-all', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="text-xs font-mono text-text-dim w-9 text-right">{pct.toFixed(0)}%</span>
                          </div>
                          <span className="text-xs text-text-muted">{(row.missingRuleTypes ?? []).join(', ') || '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Lineage Graph */}
            <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border-subtle">
                <IconMap size={13} className="text-accent" />
                <h2 className="text-sm font-medium text-text">{t('reports.lineageGraph', '血缘图谱')}</h2>
              </div>
              <div className="p-4">
                <LineageGraph
                  coverageMatrix={(data.coverageMatrix as any[]) ?? []}
                  criticalGaps={(data.criticalGaps as any[]) ?? []}
                  height={380}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="bg-surface-card border border-border rounded-xl p-6 max-w-sm w-full">
          <h3 className="text-sm font-semibold text-text mb-2">{t('reports.deleteConfirm', '确认删除报告？')}</h3>
          <p className="text-xs text-text-dim mb-5">{t('reports.deleteWarning', '此操作不可撤销。')}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-4 py-1.5 rounded-lg text-xs text-text-dim border border-border hover:bg-surface-soft transition-colors"
            >
              {t('common.cancel', '取消')}
            </button>
            <button
              onClick={() => { setConfirmDelete(false); deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-danger hover:bg-danger text-white transition-colors disabled:opacity-50"
            >
              {t('common.delete', '删除')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}
