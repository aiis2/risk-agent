/**
 * CoverageMatrix — 规则覆盖矩阵核心可视化组件
 * project-structure.md §components/CoverageMatrix/
 *
 * 展示每个业务场景的规则覆盖情况（百分比 + 进度条 + 缺失规则类型列表）
 */
import { clsx } from 'clsx';
import { coverageColor } from '../../lib/utils';

export interface CoverageRow {
  scenarioId: string;
  scenarioName: string;
  coveredRuleIds: string[];
  coveragePercent: number;
  missingRuleTypes?: string[];
  totalRules?: number;
}

interface CoverageMatrixProps {
  rows: CoverageRow[];
  emptyHint?: string;
  className?: string;
}

function CoverageBar({ pct }: { pct: number }) {
  const clampedPct = Math.min(Math.max(pct, 0), 100);
  const barColor =
    clampedPct >= 80 ? 'bg-success' : clampedPct >= 50 ? 'bg-warn' : 'bg-danger';
  const filledSegments = Math.round((clampedPct / 100) * 20);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex h-1.5 flex-1 gap-0.5 overflow-hidden rounded-full bg-border">
        {Array.from({ length: 20 }, (_, index) => (
          <div
            key={index}
            className={clsx(
              'h-full flex-1 rounded-full transition-colors duration-300',
              index < filledSegments ? barColor : 'bg-surface-soft'
            )}
          />
        ))}
      </div>
      <span className={clsx('text-xs font-mono w-9 text-right shrink-0', coverageColor(pct))}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export function CoverageMatrix({ rows, emptyHint = '暂无覆盖数据', className }: CoverageMatrixProps) {
  if (!rows.length) {
    return (
      <div className={clsx('px-5 py-8 text-center text-sm text-text-muted', className)}>
        {emptyHint}
      </div>
    );
  }

  return (
    <div className={clsx('divide-y divide-border-subtle', className)}>
      {/* Table header */}
      <div className="grid grid-cols-[1fr_180px_1fr] gap-4 px-5 py-2.5 text-xs uppercase tracking-wide text-text-muted">
        <span>业务场景</span>
        <span>覆盖率</span>
        <span>缺失规则类型</span>
      </div>

      {rows.map((row) => (
        <div
          key={row.scenarioId}
          className="grid grid-cols-[1fr_180px_1fr] items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-soft/50"
        >
          {/* Scenario name */}
          <div className="min-w-0">
            <p className="truncate text-sm text-text">{row.scenarioName}</p>
            {row.totalRules !== undefined && (
              <p className="mt-0.5 text-xs text-text-muted">
                {row.coveredRuleIds.length}/{row.totalRules} 条规则
              </p>
            )}
          </div>

          {/* Coverage bar */}
          <CoverageBar pct={row.coveragePercent} />

          {/* Missing rule types */}
          <div className="flex flex-wrap gap-1 min-w-0">
            {(row.missingRuleTypes ?? []).length === 0 ? (
              <span className="text-xs text-success">全部覆盖</span>
            ) : (
              (row.missingRuleTypes ?? []).slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="rounded border border-danger/20 bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger"
                >
                  {t}
                </span>
              ))
            )}
            {(row.missingRuleTypes ?? []).length > 4 && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim bg-surface-soft">
                +{(row.missingRuleTypes ?? []).length - 4}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
