import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconShieldCheck,
  IconPlus,
  IconUpload,
  IconSparkles,
  IconTrash,
  IconFilter,
  IconShare2,
  IconChevronDown,
  IconChevronRight,
  IconGridDots,
  IconBuildingBank,
  IconDatabase,
} from '@tabler/icons-react';
import {
  commitParsedRules,
  createRule,
  deleteRule,
  importRules,
  listRules,
  parseRulesFromText,
  type Rule,
} from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Select, SelectItem } from '../components/ui/Select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/Tabs';
import { RuleSystemsPanel } from '../components/Rules/RuleSystemsPanel';
import { CoverageMatrixPanel } from '../components/Rules/CoverageMatrixPanel';
import { RuleSourcesPanel } from '../components/Rules/RuleSourcesPanel';

const riskBadge: Record<string, string> = {
  low: 'text-success bg-success/10 border border-success/25',
  medium: 'text-warn bg-warn/10 border border-warn/25',
  high: 'text-warn bg-warn/10 border border-warn/25',
  critical: 'text-danger bg-danger/10 border border-danger/25',
};

const riskLevelLabels: Record<NonNullable<Rule['riskLevel']>, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

const bizTypeLabels: Record<string, string> = {
  payment: '支付',
  credit: '信贷',
  transfer: '转账',
  account: '账户',
  identity: '身份',
  merchant: '商户',
};

const ruleTypeLabels: Record<string, string> = {
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

function readRiskLevelLabel(level?: Rule['riskLevel'] | string | null) {
  if (!level) return '—';
  return riskLevelLabels[level as NonNullable<Rule['riskLevel']>] ?? level;
}

function readBizTypeLabel(value?: string | null) {
  if (!value) return '—';
  return bizTypeLabels[value] ?? value;
}

function readRuleTypeLabel(value?: string | null) {
  if (!value) return '—';
  return ruleTypeLabels[value] ?? value;
}

function readNlSourceLabel(source: string | null) {
  switch (source) {
    case 'llm':
      return '大模型解析';
    case 'heuristic':
      return '启发式回退';
    default:
      return source ?? '未知';
  }
}

function ConditionsViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-text-dim hover:text-accent transition-colors"
      >
        {open ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        条件
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-surface rounded text-xs text-text-dim overflow-x-auto max-w-xs max-h-28 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function RuleListTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ bizType: '', ruleType: '', riskLevel: '' });
  const [showFilters, setShowFilters] = useState(false);

  const queryParams: Record<string, string> = {};
  if (filters.bizType) queryParams.bizType = filters.bizType;
  if (filters.ruleType) queryParams.ruleType = filters.ruleType;
  if (filters.riskLevel) queryParams.riskLevel = filters.riskLevel;

  const { data, isLoading } = useQuery({
    queryKey: ['rules', queryParams],
    queryFn: () => listRules(Object.keys(queryParams).length ? queryParams : undefined),
  });

  const del = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const inputCls =
    'h-7 bg-surface border border-border rounded px-2 text-xs text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors';

  return (
    <div className="w-full p-5 space-y-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconShieldCheck size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">规则列表</h2>
          {data && (
            <span className="text-xs text-text-muted bg-surface-soft px-2 py-0.5 rounded-full border border-border">
              {data.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${showFilters ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-dim hover:bg-surface-soft'}`}
        >
          <IconFilter size={11} />
          筛选
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 px-4 py-3 bg-surface-card border border-border-subtle rounded-xl">
          <input
            value={filters.bizType}
            onChange={(e) => setFilters({ ...filters, bizType: e.target.value })}
            placeholder="业务类型"
            aria-label="按业务类型筛选"
            className={inputCls}
          />
          <input
            value={filters.ruleType}
            onChange={(e) => setFilters({ ...filters, ruleType: e.target.value })}
            placeholder="规则类型"
            aria-label="按规则类型筛选"
            className={inputCls}
          />
          <select
            value={filters.riskLevel}
            onChange={(e) => setFilters({ ...filters, riskLevel: e.target.value })}
            title="按风险等级筛选"
            className={inputCls}
          >
            <option value="">全部等级</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="critical">严重</option>
          </select>
          <button
            onClick={() => setFilters({ bizType: '', ruleType: '', riskLevel: '' })}
            className="text-xs text-text-muted hover:text-text-dim px-2 transition-colors"
          >
            清除
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-text-muted">{t('common.loading')}</p>
      ) : !data?.length ? (
        <p className="text-sm text-text-muted">{t('common.empty')}</p>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-border-subtle">
          <table className="min-w-full text-xs">
            <thead className="bg-surface">
              <tr>
                {[
                  t('rules.ruleName'),
                  t('rules.bizType'),
                  t('rules.ruleType'),
                  t('rules.riskLevel'),
                  t('rules.source'),
                  t('rules.conditions'),
                  t('common.actions'),
                ].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-text-muted font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.ruleId} className="border-t border-border-subtle hover:bg-surface-soft/40 transition-colors">
                  <td className="px-3 py-2 text-text font-medium max-w-[140px]">
                    <div className="truncate" title={r.ruleName}>{r.ruleName}</div>
                    {r.ruleCode && <div className="text-text-muted truncate">{r.ruleCode}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-dim">{readBizTypeLabel(r.bizType)}</td>
                  <td className="px-3 py-2 text-text-dim">{readRuleTypeLabel(r.ruleType)}</td>
                  <td className="px-3 py-2">
                    {r.riskLevel ? (
                      <span className={`px-1.5 py-0.5 rounded text-xs ${riskBadge[r.riskLevel] ?? riskBadge.medium}`}>
                        {readRiskLevelLabel(r.riskLevel)}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-muted max-w-[80px] truncate">{r.source ?? '—'}</td>
                  <td className="px-3 py-2">
                    <ConditionsViewer data={r.conditions} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/knowledge-graph?nodeId=${r.ruleId}`}
                        title="在知识图谱中查看"
                        className="p-1 rounded hover:bg-accent/15 text-text-muted hover:text-accent transition-colors"
                      >
                        <IconShare2 size={12} />
                      </Link>
                      <button
                        title="删除规则"
                        disabled={del.isPending}
                        onClick={() => del.mutate(r.ruleId)}
                        className="p-1 rounded hover:bg-danger/15 text-text-muted hover:text-danger transition-colors disabled:opacity-40"
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImportTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: createRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
  const imp = useMutation({
    mutationFn: (payload: any[]) => importRules(payload, 'bulk-ui'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const [form, setForm] = useState({
    ruleName: '',
    bizType: '',
    ruleType: '',
    riskLevel: 'medium' as Rule['riskLevel'],
    description: '',
  });
  const [bulkText, setBulkText] = useState('');
  const [nlText, setNlText] = useState('');
  const [nlSource, setNlSource] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Partial<Rule>[]>([]);

  const parseNl = useMutation({
    mutationFn: (text: string) => parseRulesFromText(text, true),
    onSuccess: (res) => {
      setCandidates(res.candidates ?? []);
      setNlSource(res.source);
    },
  });
  const commitNl = useMutation({
    mutationFn: (list: Partial<Rule>[]) => commitParsedRules(list),
    onSuccess: () => {
      setCandidates([]);
      setNlText('');
      setNlSource(null);
      qc.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const inputCls =
    'w-full h-8 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors';
  const textareaCls =
    'w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 resize-y transition-colors';

  return (
    <div className="w-full p-5 space-y-5">
      {/* Create single rule */}
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <IconPlus size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">{t('rules.createRule')}</h2>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">{t('rules.ruleName')}</label>
            <input
              value={form.ruleName}
              onChange={(e) => setForm({ ...form, ruleName: e.target.value })}
              placeholder="如：单笔支付限额"
              aria-label={t('rules.ruleName')}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">{t('rules.bizType')}</label>
            <input
              value={form.bizType}
              onChange={(e) => setForm({ ...form, bizType: e.target.value })}
              placeholder="如：支付"
              aria-label={t('rules.bizType')}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">{t('rules.ruleType')}</label>
            <input
              value={form.ruleType}
              onChange={(e) => setForm({ ...form, ruleType: e.target.value })}
              placeholder="如：额度限制"
              aria-label={t('rules.ruleType')}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">{t('rules.riskLevel')}</label>
            <Select
              value={form.riskLevel}
              onValueChange={(v) => setForm({ ...form, riskLevel: v as Rule['riskLevel'] })}
            >
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="critical">严重</SelectItem>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
            <label className="text-xs text-text-muted">{t('rules.description')}</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="规则描述"
              aria-label={t('rules.description')}
              className={inputCls}
            />
          </div>
        </div>
        <button
          disabled={!form.ruleName || create.isPending}
          onClick={() =>
            create.mutate(form, {
              onSuccess: () =>
                setForm({ ruleName: '', bizType: '', ruleType: '', riskLevel: 'medium', description: '' }),
            })
          }
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed text-accent rounded-lg text-sm transition-colors"
        >
          <IconPlus size={13} /> {t('common.create')}
        </button>
      </section>

      {/* Bulk JSON import */}
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <IconUpload size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">{t('rules.import')}</h2>
        </div>
        <p className="text-xs text-text-muted mb-3">
          粘贴 JSON 数组，每项需包含规则名、业务类型、规则类型、风险等级字段（ruleName、bizType、ruleType、riskLevel，其中 riskLevel 使用 low/medium/high/critical 枚举）。
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          aria-label={t('rules.import')}
          placeholder='[{"ruleName":"单笔支付限额","bizType":"支付","ruleType":"额度限制","riskLevel":"high"}]'
          className={`${textareaCls} min-h-[120px] font-mono text-xs`}
        />
        <button
          disabled={!bulkText || imp.isPending}
          onClick={() => {
            try {
              const arr = JSON.parse(bulkText);
              if (Array.isArray(arr)) imp.mutate(arr, { onSuccess: () => setBulkText('') });
            } catch {
              alert('JSON 解析失败');
            }
          }}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed text-accent rounded-lg text-sm transition-colors"
        >
          <IconUpload size={13} /> {t('common.submit')}
        </button>
      </section>

      {/* NL import */}
      <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <IconSparkles size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">
            {t('rules.nlImport', { defaultValue: '从自然语言文本解析' })}
          </h2>
        </div>
        <p className="text-xs text-text-muted mb-3">
          粘贴任何规则描述（条款、常见问答、管理文档等），系统会优先调用大模型解析为结构化规则草稿，解析失败将回退到关键字启发式。
        </p>
        <textarea
          value={nlText}
          onChange={(e) => setNlText(e.target.value)}
          aria-label="自然语言规则文本"
          placeholder="示例：单日支付限额 5 万元；黑名单账户禁止转账；高频登录 30 分钟超 5 次触发验证。"
          className={`${textareaCls} min-h-[120px]`}
        />
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            disabled={!nlText || parseNl.isPending}
            onClick={() => parseNl.mutate(nlText)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed text-accent rounded-lg text-sm transition-colors"
          >
            <IconSparkles size={13} />
            {parseNl.isPending ? '解析中…' : t('rules.nlParse', { defaultValue: '解析' })}
          </button>
          {nlSource && (
            <span className="px-2 py-0.5 rounded text-xs bg-surface-soft text-text-dim border border-border">
              解析来源：{readNlSourceLabel(nlSource)}
            </span>
          )}
          {candidates.length > 0 && (
            <>
              <span className="px-2 py-0.5 rounded text-xs bg-accent/10 text-accent border border-accent/20">
                候选 {candidates.length}
              </span>
              <button
                disabled={commitNl.isPending}
                onClick={() => commitNl.mutate(candidates)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-success/15 hover:bg-success/25 disabled:opacity-40 text-success rounded-lg text-sm transition-colors"
              >
                {t('rules.nlCommit', { defaultValue: '全部入库为草稿' })}
              </button>
              <button
                onClick={() => setCandidates([])}
                className="px-3 py-1.5 hover:bg-surface-soft text-text-dim rounded-lg text-sm transition-colors"
              >
                {t('common.cancel', { defaultValue: '取消' })}
              </button>
            </>
          )}
        </div>
        {candidates.length > 0 && (
          <div className="mt-4 w-full overflow-x-auto rounded-lg border border-border-subtle">
            <table className="min-w-full text-xs">
              <thead className="bg-surface">
                <tr>
                  {[
                    { key: 'ruleName', label: t('rules.ruleName') },
                    { key: 'bizType', label: t('rules.bizType') },
                    { key: 'ruleType', label: t('rules.ruleType') },
                    { key: 'riskLevel', label: t('rules.riskLevel') },
                    { key: 'description', label: t('rules.description') },
                  ].map(({ key, label }) => (
                    <th key={key} className="text-left px-3 py-2 text-text-muted font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="px-3 py-2 text-text">{c.ruleName}</td>
                    <td className="px-3 py-2 text-text-dim">{readBizTypeLabel(c.bizType)}</td>
                    <td className="px-3 py-2 text-text-dim">{readRuleTypeLabel(c.ruleType)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs border ${riskBadge[c.riskLevel ?? 'medium'] ?? riskBadge.medium}`}>
                        {readRiskLevelLabel(c.riskLevel)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-dim max-w-[200px] truncate">
                      {c.description ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function Rules() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col flex-1 bg-surface min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-subtle bg-surface-sidebar shrink-0">
        <IconShieldCheck size={14} className="text-accent" />
        <h1 className="text-sm font-semibold text-text">{t('rules.title')}</h1>
      </div>

      <Tabs defaultValue="list" className="flex flex-col flex-1 min-h-0">
        <TabsList className="px-5 bg-surface-sidebar shrink-0">
          <TabsTrigger value="list">
            <IconShieldCheck size={11} className="mr-1.5 inline" />
            {t('rules.tabList', { defaultValue: '规则列表' })}
          </TabsTrigger>
          <TabsTrigger value="import">
            <IconPlus size={11} className="mr-1.5 inline" />
            {t('rules.tabImport', { defaultValue: '导入规则' })}
          </TabsTrigger>
          <TabsTrigger value="systems">
            <IconBuildingBank size={11} className="mr-1.5 inline" />
            {t('rules.tabSystems', { defaultValue: '系统管理' })}
          </TabsTrigger>
          <TabsTrigger value="matrix">
            <IconGridDots size={11} className="mr-1.5 inline" />
            {t('rules.tabMatrix', { defaultValue: '覆盖矩阵' })}
          </TabsTrigger>
          <TabsTrigger value="sources">
            <IconDatabase size={11} className="mr-1.5 inline" />
            {t('rules.tabSources', { defaultValue: '来源管理' })}
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="list" className="w-full">
            <RuleListTab />
          </TabsContent>
          <TabsContent value="import" className="w-full">
            <ImportTab />
          </TabsContent>
          <TabsContent value="systems" className="w-full">
            <RuleSystemsPanel />
          </TabsContent>
          <TabsContent value="matrix" className="w-full">
            <CoverageMatrixPanel />
          </TabsContent>
          <TabsContent value="sources" className="w-full">
            <RuleSourcesPanel />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}


