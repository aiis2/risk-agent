import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconGridDots,
  IconSearch,
  IconChevronDown,
  IconChevronRight,
  IconShieldCheck,
} from '@tabler/icons-react';
import { getRuleCoverageMatrix, type Rule } from '../../api/client';

const RISK_COLORS: Record<string, string> = {
  low: 'text-success bg-success/10 border-success/25',
  medium: 'text-warn bg-warn/10 border-warn/25',
  high: 'text-warn bg-warn/10 border-warn/25',
  critical: 'text-danger bg-danger/10 border-danger/25',
};

const BIZ_TYPE_LABELS: Record<string, string> = {
  payment: '支付',
  credit: '信贷',
  transfer: '转账',
  account: '账户',
  identity: '身份',
  merchant: '商户',
};

const RULE_TYPE_LABELS: Record<string, string> = {
  anomaly: '异常检测',
  blacklist: '黑名单',
  limit: '额度限制',
  compliance: '合规校验',
  frequency: '频次控制',
  velocity: '速度限制',
  behavior: '行为模式',
  device: '设备风险',
  identity: '身份核验',
  geo: '地域限制',
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

function readBizTypeLabel(value?: string | null) {
  if (!value) return '—';
  return BIZ_TYPE_LABELS[value] ?? value;
}

function readRuleTypeLabel(value: string) {
  return RULE_TYPE_LABELS[value] ?? value;
}

function readRiskLevelLabel(value?: string | null) {
  if (!value) return '—';
  return RISK_LEVEL_LABELS[value] ?? value;
}

function RuleTypeGroup({
  ruleType,
  count,
  dimensions,
  rules,
}: {
  ruleType: string;
  count: number;
  dimensions: string[];
  rules: Rule[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-surface-card hover:bg-surface-soft text-left transition-colors"
      >
        {open ? (
          <IconChevronDown size={12} className="text-text-muted shrink-0" />
        ) : (
          <IconChevronRight size={12} className="text-text-muted shrink-0" />
        )}
        <span className="text-xs font-semibold text-text min-w-[80px]">{readRuleTypeLabel(ruleType)}</span>
        <span className="text-xs text-text-muted mr-2">{count} 条</span>
        <div className="flex flex-wrap gap-1 flex-1">
          {dimensions.map((d) => (
            <span
              key={d}
              className="px-1.5 py-0.5 rounded text-xs bg-accent/10 text-accent border border-accent/20"
            >
              {d}
            </span>
          ))}
        </div>
      </button>

      {open && rules.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {rules.map((r) => (
            <div key={r.ruleId} className="px-4 py-2 flex items-center gap-3 bg-surface/50">
              <IconShieldCheck size={11} className="text-border shrink-0" />
              <span className="text-xs text-text flex-1">{r.ruleName}</span>
              {r.bizType && (
                <span className="text-xs text-text-muted">{readBizTypeLabel(r.bizType)}</span>
              )}
              {r.riskLevel && (
                <span className={`text-xs px-1.5 py-0.5 rounded border ${RISK_COLORS[r.riskLevel] ?? ''}`}>
                  {readRiskLevelLabel(r.riskLevel)}
                </span>
              )}
              {r.coverage?.length > 0 && (
                <div className="flex gap-1">
                  {r.coverage.slice(0, 3).map((c) => (
                    <span key={c} className="text-xs text-text-muted bg-surface-soft px-1 rounded">
                      {c}
                    </span>
                  ))}
                  {r.coverage.length > 3 && (
                    <span className="text-xs text-text-muted">+{r.coverage.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CoverageMatrixPanel() {
  const { t } = useTranslation();
  const [bizType, setBizType] = useState('');
  const [query, setQuery] = useState('');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['coverage-matrix', query],
    queryFn: () => getRuleCoverageMatrix(query),
    enabled: !!query,
  });

  return (
    <div className="w-full p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <IconGridDots size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-text">
          {t('rules.tabMatrix', { defaultValue: '覆盖矩阵' })}
        </h2>
      </div>
      <p className="text-xs text-text-muted">按业务类型查询当前规则对各风控维度的覆盖情况。</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={bizType}
          onChange={(e) => setBizType(e.target.value)}
          placeholder="输入业务类型，如：支付"
          aria-label="按业务类型查询"
          className="flex-1 h-8 bg-surface border border-border rounded-lg px-3 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors"
        />
        <button
          disabled={!bizType || isFetching}
          onClick={() => setQuery(bizType)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 disabled:opacity-40 text-accent rounded-lg text-sm transition-colors"
        >
          <IconSearch size={13} />
          查询
        </button>
      </div>

      {isLoading && <p className="text-sm text-text-muted">{t('common.loading')}</p>}

      {data && (
        <div className="w-full space-y-3">
          {/* Summary */}
          <div className="flex items-center gap-4 px-4 py-3 bg-surface-card border border-border-subtle rounded-xl">
            <span className="text-xs text-text-muted">业务类型</span>
            <span className="text-sm font-semibold text-accent">{readBizTypeLabel(data.bizType)}</span>
            <span className="text-xs text-text-muted ml-4">总规则数</span>
            <span className="text-sm font-semibold text-text">{data.totalRules}</span>
            <span className="text-xs text-text-muted ml-4">覆盖维度数</span>
            <span className="text-sm font-semibold text-text">{data.dimensions.length}</span>
          </div>

          {/* Dimension tags */}
          {data.dimensions.length > 0 && (
            <div className="px-4 py-3 bg-surface-card border border-border-subtle rounded-xl">
              <p className="text-xs text-text-muted mb-2">已覆盖维度</p>
              <div className="flex flex-wrap gap-1.5">
                {data.dimensions.map((d) => (
                  <span
                    key={d}
                    className="px-2 py-0.5 rounded text-xs bg-accent/10 text-accent border border-accent/20"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* By rule type */}
          {data.totalRules === 0 ? (
            <p className="text-sm text-text-muted">该业务类型暂无活跃规则。</p>
          ) : (
            <div className="space-y-2">
              {data.byRuleType.map((grp) => (
                <RuleTypeGroup
                  key={grp.ruleType}
                  ruleType={grp.ruleType}
                  count={grp.count}
                  dimensions={grp.dimensions}
                  rules={grp.rules}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
