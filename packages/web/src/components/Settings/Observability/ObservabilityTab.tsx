import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconCoin,
  IconCpu,
  IconDatabase,
  IconInfoCircle,
  IconLoader2,
  IconChartBar,
  IconSearch,
  IconTimeline,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconCircleDashed,
} from '@tabler/icons-react';
import { getObservabilityCosts, listOTelTraces, getOTelTrace, getSecurityAudit, type OTelTraceListItem, type SecurityEventType } from '../../../api/client';
import { buildSandboxAuditDetailLines } from '../../../lib/sandboxDisplay';
import { TranscriptSearch } from './TranscriptSearch';

const SANDBOX_SIGNAL_TYPES: SecurityEventType[] = [
  'sandbox-lease-created',
  'sandbox-lease-complete',
  'sandbox-lease-cancelled',
  'sandbox-process-started',
  'sandbox-process-complete',
  'sandbox-process-cancelled',
  'sandbox-timeout',
  'sandbox-error',
];

const SANDBOX_SIGNAL_LABELS: Partial<Record<SecurityEventType, string>> = {
  'sandbox-lease-created': '租约创建',
  'sandbox-lease-complete': '租约完成',
  'sandbox-lease-cancelled': '租约取消',
  'sandbox-process-started': '进程启动',
  'sandbox-process-complete': '进程完成',
  'sandbox-process-cancelled': '进程取消',
  'sandbox-timeout': '执行超时',
  'sandbox-error': '执行异常',
};

// ─── Utility ────────────────────────────────────────────────────────────────

function formatUsd(usd: number): string {
  if (usd === 0) return '$0.000';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortModel(model: string): string {
  return model.replace(/^.+\//, '').replace(/-\d{8}$/, '');
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-border-subtle rounded-xl px-4 py-3 flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-lg font-semibold text-text">{value}</span>
      {sub && <span className="text-xs text-text-dim">{sub}</span>}
    </div>
  );
}

// ─── OTel Span status icon ───────────────────────────────────────────────────

function SpanStatusIcon({ status }: { status: 'ok' | 'error' | 'unset' }) {
  if (status === 'ok') return <IconCircleCheck size={10} className="text-success" />;
  if (status === 'error') return <IconCircleX size={10} className="text-danger" />;
  return <IconCircleDashed size={10} className="text-text-muted" />;
}

// ─── OTel trace row (expandable spans) ──────────────────────────────────────

function OTelTraceRow({ trace }: { trace: OTelTraceListItem }) {
  const [open, setOpen] = useState(false);
  const spans = useQuery({
    queryKey: ['otel-trace', trace.traceId],
    queryFn: () => getOTelTrace(trace.traceId),
    enabled: open,
    staleTime: 30_000,
  });

  const startDt = new Date(trace.startTime).toLocaleString('zh-CN', { hour12: false });

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-soft transition-colors text-left"
        onClick={() => setOpen((p) => !p)}
      >
        {open ? (
          <IconChevronDown size={11} className="text-text-muted shrink-0" />
        ) : (
          <IconChevronRight size={11} className="text-text-muted shrink-0" />
        )}
        <span className="text-xs font-medium text-text truncate flex-1">{trace.name}</span>
        <span className="text-xs text-text-muted shrink-0">{trace.spanCount} spans</span>
        <span className="text-xs text-text-muted shrink-0 ml-2">{startDt}</span>
      </button>

      {open && (
        <div className="bg-surface border-t border-border-subtle px-3 py-2 space-y-1">
          {spans.isLoading && (
            <div className="flex items-center gap-2 py-1 text-xs text-text-muted">
              <IconLoader2 size={11} className="animate-spin" /> 加载 Span…
            </div>
          )}
          {spans.data?.spans.map((span) => {
            const duration = span.endTime ? span.endTime - span.startTime : null;
            const indent = span.parentSpanId ? 'pl-4' : '';
            return (
              <div
                key={span.spanId}
                className={`flex items-start gap-2 text-xs py-0.5 ${indent}`}
              >
                <SpanStatusIcon status={span.status} />
                <span className="text-text-dim font-mono text-[10px] shrink-0 w-12">
                  {span.kind}
                </span>
                <span className="text-text flex-1 truncate">{span.name}</span>
                {duration !== null && (
                  <span className="text-text-muted shrink-0">{duration}ms</span>
                )}
                {span.errorMessage && (
                  <span className="text-danger ml-1 truncate max-w-[120px]">{span.errorMessage}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Performance alert rules (observability-debugging.md §7.2) ──────────────

type AlertSeverity = 'error' | 'warning' | 'info';

interface AlertItem {
  name: string;
  severity: AlertSeverity;
  message: string;
  detail?: string;
}

function evaluateAlerts(data: { totalUsd: number; topSessions: { businessName: string; estimatedUsd: number; totalTokens: number }[] }): AlertItem[] {
  const alerts: AlertItem[] = [];

  // 高费用会话：单会话超 $5
  for (const s of data.topSessions) {
    if (s.estimatedUsd > 5.0) {
      alerts.push({
        name: 'high_cost_session',
        severity: 'warning',
        message: '会话费用超过 $5.00，建议检查是否存在无限循环',
        detail: `${s.businessName} — $${s.estimatedUsd.toFixed(3)}`,
      });
      break; // 只报第一条
    }
  }

  // 总费用警告：30天超 $50
  if (data.totalUsd > 50) {
    alerts.push({
      name: 'high_total_cost',
      severity: 'warning',
      message: `近 30 天总费用超过 $50.00（当前 $${data.totalUsd.toFixed(2)}），建议审查高频分析任务`,
    });
  }

  return alerts;
}

function AlertBadge({ severity }: { severity: AlertSeverity }) {
  if (severity === 'error') {
    return <IconCircleX size={13} className="text-danger shrink-0" />;
  }
  if (severity === 'warning') {
    return <IconAlertTriangle size={13} className="text-warn shrink-0" />;
  }
  return <IconInfoCircle size={13} className="text-accent shrink-0" />;
}

function PerformanceAlertsSection({ data }: { data: { totalUsd: number; topSessions: { businessName: string; estimatedUsd: number; totalTokens: number }[] } }) {
  const alerts = evaluateAlerts(data);

  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <IconBolt size={14} className="text-warn" />
        <h2 className="text-sm font-semibold text-text">性能告警</h2>
        <span className="text-xs text-text-muted bg-surface-soft px-1.5 py-0.5 rounded ml-1">§7.2</span>
        {alerts.length > 0 && (
          <span className="ml-auto text-xs font-medium text-warn">{alerts.length} 条告警</span>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 py-1 text-xs text-text-muted">
          <IconCircleCheck size={12} className="text-success" />
          <span>当前无告警，运行状态良好</span>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="flex items-start gap-2.5 px-3 py-2 bg-surface rounded-lg"
            >
              <AlertBadge severity={a.severity} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text">{a.message}</p>
                {a.detail && <p className="text-xs text-text-muted mt-0.5">{a.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-muted mt-3">
        告警规则参考：
        <code className="mx-1 px-1 py-0.5 bg-surface rounded text-accent">observability-debugging.md §7.2</code>
      </p>
    </section>
  );
}

function SandboxSignalsSection() {
  const signals = useQuery({
    queryKey: ['observability-sandbox-signals'],
    queryFn: () => getSecurityAudit({ limit: 40 }),
    staleTime: 30_000,
  });

  const sandboxEvents = (signals.data ?? [])
    .filter((event) => SANDBOX_SIGNAL_TYPES.includes(event.eventType))
    .slice(0, 12);

  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <IconBolt size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text">Sandbox 信号</h2>
        <span className="text-xs text-text-muted bg-surface-soft px-1.5 py-0.5 rounded ml-1">lease / process</span>
        <span className="ml-auto text-xs text-text-muted">最近 12 条</span>
      </div>

      {signals.isLoading && (
        <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
          <IconLoader2 size={11} className="animate-spin" /> 加载 sandbox 信号…
        </div>
      )}

      {!signals.isLoading && sandboxEvents.length === 0 && (
        <div className="flex items-center gap-2 py-1 text-xs text-text-muted">
          <IconAlertTriangle size={12} className="text-text-muted" />
          <span>暂无 sandbox 运行信号</span>
        </div>
      )}

      {sandboxEvents.length > 0 && (
        <div className="space-y-2">
          {sandboxEvents.map((event) => {
            const detailLines = buildSandboxAuditDetailLines(event.details).slice(0, 4);
            return (
              <div key={`${event.eventType}-${event.timestamp}-${event.eventId ?? event.agentId}`} className="rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-text">{SANDBOX_SIGNAL_LABELS[event.eventType] ?? event.eventType}</span>
                  <span className="text-text-muted truncate">{event.agentId}</span>
                  <span className="ml-auto text-text-muted">{new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                </div>
                {detailLines.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {detailLines.map((line) => (
                      <div key={line} className="font-mono text-[11px] leading-[1.45] text-text-dim break-all">
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── OTel traces section ─────────────────────────────────────────────────────

function OTelTracesSection() {
  const traces = useQuery({
    queryKey: ['otel-traces'],
    queryFn: () => listOTelTraces(20),
    staleTime: 60_000,
  });

  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <IconTimeline size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text">OTel 追踪记录</h2>
        <span className="text-xs text-text-muted bg-surface-soft px-1.5 py-0.5 rounded ml-1">§9.1</span>
        <span className="ml-auto text-xs text-text-muted">最近 20 条 trace</span>
      </div>

      {traces.isLoading && (
        <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
          <IconLoader2 size={11} className="animate-spin" /> 加载追踪数据…
        </div>
      )}

      {traces.isError && (
        <p className="text-xs text-text-muted">暂无 OTel 追踪数据（Agent 运行后自动记录）</p>
      )}

      {traces.data?.length === 0 && (
        <p className="text-xs text-text-muted">暂无 OTel 追踪数据（Agent 运行后自动记录）</p>
      )}

      {traces.data && traces.data.length > 0 && (
        <div className="space-y-2">
          {traces.data.map((t) => (
            <OTelTraceRow key={t.traceId} trace={t} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── ObservabilityTab ────────────────────────────────────────────────────────

export function ObservabilityTab() {
  const costs = useQuery({
    queryKey: ['observability-costs', 30],
    queryFn: () => getObservabilityCosts(30),
    staleTime: 60_000,
  });

  if (costs.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted">
        <IconLoader2 size={16} className="animate-spin mr-2" />
        <span className="text-sm">加载可观测性数据…</span>
      </div>
    );
  }

  if (costs.isError) {
    return (
      <div className="flex items-center justify-center py-12 text-text-dim text-sm">
        暂无费用数据（可能尚未运行过分析任务）
      </div>
    );
  }

  const data = costs.data!;
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return (
    <div className="space-y-5">
      {/* Section: Summary */}
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconActivity size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">费用概览</h2>
          <span className="ml-auto text-xs text-text-muted">近 {data.lookbackDays} 天</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="总费用"
            value={formatUsd(data.totalUsd)}
          />
          <StatCard
            label="总 Token"
            value={formatTokens(totalTokens)}
            sub={`输入 ${formatTokens(data.totalInputTokens)} · 输出 ${formatTokens(data.totalOutputTokens)}`}
          />
          <StatCard
            label="缓存命中 Token"
            value={formatTokens(data.totalCachedTokens)}
            sub={totalTokens > 0 ? `节省率 ${((data.totalCachedTokens / totalTokens) * 100).toFixed(1)}%` : undefined}
          />
          <StatCard
            label="模型数"
            value={String(data.byModel.length)}
            sub={data.byModel.length > 0 ? data.byModel[0].model.split('/').pop()?.replace(/-\d{8}$/, '') : undefined}
          />
        </div>
      </section>

      {/* Section: Per-model breakdown */}
      {data.byModel.length > 0 && (
        <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <IconCpu size={14} className="text-accent" />
            <h2 className="text-sm font-semibold text-text">按模型分布</h2>
          </div>
          <div className="space-y-1.5">
            {data.byModel.map((m) => {
              const pct = data.totalUsd > 0 ? (m.estimatedUsd / data.totalUsd) * 100 : 0;
              return (
                <div
                  key={m.model}
                  className="flex items-center gap-3 px-3 py-2 bg-surface rounded-lg text-xs"
                >
                  <IconChartBar size={11} className="text-accent shrink-0" />
                  <span className="text-text font-medium flex-1 truncate">{shortModel(m.model)}</span>
                  <span className="text-text-muted shrink-0">
                    {formatTokens(m.inputTokens + m.outputTokens)} tok
                  </span>
                  <span className="text-text-muted shrink-0">{m.sessionCount} 会话</span>
                  <span className="text-text-dim font-medium shrink-0">{formatUsd(m.estimatedUsd)}</span>
                  <span className="text-text-muted w-10 text-right shrink-0">{Math.round(pct)}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section: Top sessions by cost */}
      {data.topSessions.length > 0 && (
        <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <IconCoin size={14} className="text-warn" />
            <h2 className="text-sm font-semibold text-text">费用最高会话（Top 10）</h2>
          </div>
          <div className="space-y-1.5">
            {data.topSessions.map((s, i) => (
              <div
                key={s.sessionId}
                className="flex items-center justify-between px-3 py-2 bg-surface rounded-lg"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-text-muted w-4 shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text truncate">{s.businessName}</div>
                    <div className="text-xs text-text-muted">
                      {formatTokens(s.totalTokens)} tok · {s.sessionId.slice(0, 8)}…
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-warn shrink-0 ml-3">
                  {formatUsd(s.estimatedUsd)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <SandboxSignalsSection />

      {/* Section: Storage audit log hint */}
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <IconDatabase size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">存储审计日志</h2>
        </div>
        <p className="text-xs text-text-dim">
          存储配置的所有 apply / rollback 操作均记录在
          <code className="mx-1 px-1 py-0.5 bg-surface rounded text-accent">storage_audit_logs</code>
          表中。可通过
          <code className="mx-1 px-1 py-0.5 bg-surface rounded text-accent">GET /api/settings/storage/audit</code>
          查询历史操作记录。
        </p>
      </section>

      {/* Section: Performance Alerts (observability-debugging.md §7.2) */}
      <PerformanceAlertsSection data={data} />

      {/* Section: OTel Trace Viewer (v3.3 §9.1) */}
      <OTelTracesSection />

      {/* Section: Transcript FTS5 Search */}
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconSearch size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">对话记录全文检索</h2>
          <span className="text-xs text-text-muted bg-surface-soft px-1.5 py-0.5 rounded ml-1">FTS5</span>
        </div>
        <TranscriptSearch />
      </section>
    </div>
  );
}
