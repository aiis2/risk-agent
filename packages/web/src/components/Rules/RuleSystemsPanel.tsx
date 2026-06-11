import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconBuildingBank,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconEdit,
  IconCheck,
  IconX,
  IconChevronDown,
  IconChevronRight,
  IconCloudCheck,
  IconCloudOff,
  IconClock,
  IconShieldCheck,
} from '@tabler/icons-react';
import {
  createRuleSystem,
  deleteRuleSystem,
  getRuleSystem,
  listRuleSystems,
  syncRuleSystem,
  updateRuleSystem,
  type Rule,
  type RuleSystem,
} from '../../api/client';
import { Dialog, DialogContent, DialogTrigger } from '../ui/Dialog';

const TYPE_COLORS: Record<string, string> = {
  realtime: 'text-success bg-success/10 border-success/25',
  offline: 'text-warn bg-warn/10 border-warn/25',
  manual: 'text-text-dim bg-text-dim/10 border-border',
};

const RISK_COLORS: Record<string, string> = {
  low: 'text-success',
  medium: 'text-warn',
  high: 'text-warn',
  critical: 'text-danger',
};

const SYSTEM_TYPE_LABELS: Record<RuleSystem['systemType'], string> = {
  realtime: '实时同步',
  offline: '离线批处理',
  manual: '手动维护',
};

const RISK_LEVEL_LABELS: Record<NonNullable<Rule['riskLevel']>, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

const RULE_STATUS_LABELS: Record<string, string> = {
  active: '启用',
  draft: '草稿',
  archived: '已归档',
  inactive: '停用',
};

const RULE_TYPE_LABELS: Record<string, string> = {
  anomaly: '异常检测',
  compliance: '合规校验',
  limit: '额度限制',
  frequency: '频次控制',
  blacklist: '黑名单',
  velocity: '速度限制',
  behavior: '行为模式',
  device: '设备风险',
  identity: '身份核验',
  geo: '地域限制',
  transaction: '交易风控',
  other: '其他',
};

function readSystemTypeLabel(type?: RuleSystem['systemType'] | string | null) {
  if (!type) return '—';
  return SYSTEM_TYPE_LABELS[type as RuleSystem['systemType']] ?? type;
}

function readRiskLevelLabel(level?: Rule['riskLevel'] | string | null) {
  if (!level) return '—';
  return RISK_LEVEL_LABELS[level as NonNullable<Rule['riskLevel']>] ?? level;
}

function readRuleStatusLabel(status?: string | null) {
  if (!status) return '未知';
  return RULE_STATUS_LABELS[status] ?? status;
}

function readRuleTypeLabel(type?: string | null) {
  if (!type) return '其他';
  return RULE_TYPE_LABELS[type] ?? type;
}

interface NewSystemFormState {
  systemName: string;
  systemType: 'realtime' | 'offline' | 'manual';
  apiUrl: string;
}

function SystemRulesDialog({ systemId }: { systemId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rule-system-detail', systemId],
    queryFn: () => getRuleSystem(systemId),
  });

  const rulesByType = data?.rules?.reduce(
    (acc, r) => {
      const k = r.ruleType ?? 'other';
      if (!acc[k]) acc[k] = [];
      acc[k].push(r);
      return acc;
    },
    {} as Record<string, Pick<Rule, 'ruleId' | 'ruleName' | 'ruleType' | 'bizType' | 'riskLevel' | 'status'>[]>
  );

  return (
    <div className="min-w-[540px] max-h-[70vh] overflow-y-auto">
      <div className="flex items-center gap-2 mb-4">
        <IconBuildingBank size={14} className="text-accent" />
        <span className="text-sm font-semibold text-text">{data?.systemName}</span>
        <span className={`px-1.5 py-0.5 rounded text-xs border ${TYPE_COLORS[data?.systemType ?? 'manual']}`}>
          {readSystemTypeLabel(data?.systemType)}
        </span>
      </div>
      {isLoading ? (
        <p className="text-sm text-text-muted">加载中…</p>
      ) : !rulesByType || Object.keys(rulesByType).length === 0 ? (
        <p className="text-sm text-text-muted">该系统暂无规则</p>
      ) : (
        <div className="space-y-3">
          {Object.entries(rulesByType).map(([type, rules]) => (
            <TypeGroup key={type} type={type} rules={rules} />
          ))}
        </div>
      )}
    </div>
  );
}

function TypeGroup({ type, rules }: { type: string; rules: Pick<Rule, 'ruleId' | 'ruleName' | 'ruleType' | 'bizType' | 'riskLevel' | 'status'>[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-soft text-left transition-colors"
      >
        {open ? (
          <IconChevronDown size={12} className="text-text-muted shrink-0" />
        ) : (
          <IconChevronRight size={12} className="text-text-muted shrink-0" />
        )}
        <span className="text-xs font-medium text-text-dim">{readRuleTypeLabel(type)}</span>
        <span className="ml-auto text-xs text-text-muted">{rules.length}</span>
      </button>
      {open && (
        <div className="divide-y divide-border-subtle">
          {rules.map((r) => (
            <div key={r.ruleId} className="px-3 py-1.5 flex items-center gap-3">
              <IconShieldCheck size={11} className="text-border shrink-0" />
              <span className="text-xs text-text flex-1 truncate">{r.ruleName}</span>
              {r.riskLevel && (
                <span className={`text-xs font-medium ${RISK_COLORS[r.riskLevel] ?? ''}`}>
                  {readRiskLevelLabel(r.riskLevel)}
                </span>
              )}
              <span
                className={`text-xs px-1.5 py-0.5 rounded border ${
                  r.status === 'active'
                    ? 'text-success bg-success/10 border-success/25'
                    : 'text-text-muted bg-surface-soft border-border'
                }`}
              >
                {readRuleStatusLabel(r.status)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemRow({ sys, onDeleted }: { sys: RuleSystem; onDeleted: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(sys.systemName);

  const syncMut = useMutation({
    mutationFn: () => syncRuleSystem(sys.systemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-systems'] }),
  });
  const delMut = useMutation({
    mutationFn: () => deleteRuleSystem(sys.systemId),
    onSuccess: onDeleted,
  });
  const editMut = useMutation({
    mutationFn: () => updateRuleSystem(sys.systemId, { systemName: editName }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['rule-systems'] });
    },
  });

  return (
    <div className="border border-border-subtle rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-card">
        <IconBuildingBank size={14} className="text-accent shrink-0" />

        {editing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            title={t('rules.systemName', { defaultValue: '系统名称' })}
            placeholder={t('rules.systemName', { defaultValue: '系统名称' })}
            className="flex-1 h-7 bg-surface border border-accent/50 rounded px-2 text-sm text-text focus:outline-none"
            autoFocus
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-text">{sys.systemName}</span>
        )}

        <span className={`text-xs px-1.5 py-0.5 rounded border ${TYPE_COLORS[sys.systemType]}`}>
          {readSystemTypeLabel(sys.systemType)}
        </span>
        <span className="text-xs text-text-muted">
          {sys.ruleCount} {t('rules.ruleCount', { defaultValue: '条规则' })}
        </span>

        {sys.lastSyncAt && (
          <span className="text-xs text-text-muted flex items-center gap-1">
            <IconClock size={10} />
            {new Date(sys.lastSyncAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {editing ? (
            <>
              <button
                title={t('common.save', { defaultValue: '保存' })}
                onClick={() => editMut.mutate()}
                disabled={editMut.isPending}
                className="p-1 rounded hover:bg-success/15 text-success transition-colors"
              >
                <IconCheck size={13} />
              </button>
              <button
                title={t('common.cancel', { defaultValue: '取消' })}
                onClick={() => { setEditing(false); setEditName(sys.systemName); }}
                className="p-1 rounded hover:bg-surface-soft text-text-muted transition-colors"
              >
                <IconX size={13} />
              </button>
            </>
          ) : (
            <>
              {/* View rules dialog */}
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    title="查看规则"
                    className="p-1 rounded hover:bg-surface-soft text-text-dim transition-colors"
                  >
                    <IconChevronDown size={13} />
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <SystemRulesDialog systemId={sys.systemId} />
                </DialogContent>
              </Dialog>

              <button
                title={t('rules.sync', { defaultValue: '同步' })}
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
                className="p-1 rounded hover:bg-accent/15 text-text-dim hover:text-accent transition-colors disabled:opacity-40"
              >
                <IconRefresh size={13} className={syncMut.isPending ? 'animate-spin' : ''} />
              </button>
              <button
                title={t('common.edit', { defaultValue: '编辑' })}
                onClick={() => setEditing(true)}
                className="p-1 rounded hover:bg-surface-soft text-text-dim transition-colors"
              >
                <IconEdit size={13} />
              </button>
              <button
                title={t('common.delete', { defaultValue: '删除' })}
                onClick={() => delMut.mutate()}
                disabled={delMut.isPending}
                className="p-1 rounded hover:bg-danger/15 text-text-dim hover:text-danger transition-colors disabled:opacity-40"
              >
                <IconTrash size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sync status indicator */}
      {syncMut.data && (
        <div className={`px-4 py-1.5 text-xs border-t border-border-subtle flex items-center gap-1.5 ${syncMut.data.ok ? 'text-success bg-success/5' : 'text-danger bg-danger/5'}`}>
          {syncMut.data.ok ? <IconCloudCheck size={11} /> : <IconCloudOff size={11} />}
          {syncMut.data.message}
        </div>
      )}
    </div>
  );
}

export function RuleSystemsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: systems = [], isLoading } = useQuery({
    queryKey: ['rule-systems'],
    queryFn: listRuleSystems,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewSystemFormState>({
    systemName: '',
    systemType: 'manual',
    apiUrl: '',
  });

  const createMut = useMutation({
    mutationFn: () =>
      createRuleSystem({
        systemName: form.systemName,
        systemType: form.systemType,
        syncConfig: form.apiUrl ? { apiUrl: form.apiUrl } : undefined,
      }),
    onSuccess: () => {
      setShowForm(false);
      setForm({ systemName: '', systemType: 'manual', apiUrl: '' });
      qc.invalidateQueries({ queryKey: ['rule-systems'] });
    },
  });

  const inputCls =
    'w-full h-8 bg-surface border border-border rounded-lg px-3 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors';

  return (
    <div className="w-full p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconBuildingBank size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">{t('rules.tabSystems', { defaultValue: '系统管理' })}</h2>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent rounded-lg text-xs transition-colors"
        >
          <IconPlus size={12} />
          {t('rules.addSystem', { defaultValue: '添加系统' })}
        </button>
      </div>

      {/* New system form */}
      {showForm && (
        <div className="bg-surface-card border border-border-subtle rounded-xl p-4 space-y-3">
          <p className="text-xs text-text-muted">新增风控规则系统</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">{t('rules.systemName', { defaultValue: '系统名称' })}</label>
              <input
                value={form.systemName}
                onChange={(e) => setForm({ ...form, systemName: e.target.value })}
                placeholder="反欺诈引擎 v2.0"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">{t('rules.systemType', { defaultValue: '系统类型' })}</label>
              <select
                value={form.systemType}
                onChange={(e) => setForm({ ...form, systemType: e.target.value as any })}
                title={t('rules.systemType', { defaultValue: '系统类型' })}
                className={inputCls}
              >
                <option value="realtime">实时同步</option>
                <option value="offline">离线批处理</option>
                <option value="manual">手动维护</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-text-muted">{t('rules.syncUrl', { defaultValue: '同步 API（可选）' })}</label>
              <input
                value={form.apiUrl}
                onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                placeholder="https://risk-engine.example.com/api/rules"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              disabled={!form.systemName || createMut.isPending}
              onClick={() => createMut.mutate()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 disabled:opacity-40 text-accent rounded-lg text-sm transition-colors"
            >
              <IconCheck size={13} />
              {t('common.create', { defaultValue: '创建' })}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-text-dim hover:bg-surface-soft rounded-lg text-sm transition-colors"
            >
              {t('common.cancel', { defaultValue: '取消' })}
            </button>
          </div>
        </div>
      )}

      {/* Systems list */}
      {isLoading ? (
        <p className="text-sm text-text-muted">{t('common.loading')}</p>
      ) : systems.length === 0 ? (
        <div className="bg-surface-card border border-border-subtle rounded-xl p-8 text-center">
          <IconBuildingBank size={24} className="text-border mx-auto mb-2" />
          <p className="text-sm text-text-muted">{t('rules.noSystem', { defaultValue: '暂无风控系统，请添加' })}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {systems.map((s) => (
            <SystemRow
              key={s.systemId}
              sys={s}
              onDeleted={() => qc.invalidateQueries({ queryKey: ['rule-systems'] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
