/**
 * RuleSourcesPanel — 规则来源管理（04-storage-layer.md §2.2）
 * 支持查看、新增、编辑、删除规则来源，以及查看该来源关联的规则列表
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconDatabase,
  IconPlus,
  IconPencil,
  IconTrash,
  IconX,
  IconCheck,
  IconList,
  IconArrowLeft,
} from '@tabler/icons-react';
import {
  createRuleSource,
  deleteRuleSource,
  getRuleSourceRules,
  listRuleSources,
  updateRuleSource,
  type RuleSource,
} from '../../api/client';
import { Dialog, DialogContent } from '../ui/Dialog';

// ─── type badges ────────────────────────────────────────────────────────────

const sourceTypeBadge: Record<string, string> = {
  file_import: 'border border-accent/20 bg-accent/10 text-accent',
  api_sync: 'border border-success/20 bg-success/10 text-success',
  manual_input: 'border border-warn/20 bg-warn/10 text-warn',
  model_generated: 'border border-accent/20 bg-accent/10 text-accent',
};

const systemTypeBadge: Record<string, string> = {
  realtime: 'border border-success/20 bg-success/10 text-success',
  offline: 'border border-warn/20 bg-warn/10 text-warn',
  manual: 'border border-border/20 bg-border/20 text-text-dim',
};

const sourceTypeLabel: Record<string, string> = {
  file_import: '文件导入',
  api_sync: 'API 同步',
  manual_input: '手工录入',
  model_generated: '模型生成',
};

// ─── empty form state ────────────────────────────────────────────────────────

const emptyForm = (): Partial<RuleSource> => ({
  systemName: '',
  systemType: 'manual',
  sourceType: 'file_import',
  fileName: '',
  importedBy: '',
  importNote: '',
});

// ─── EditDialog ─────────────────────────────────────────────────────────────

function EditDialog({
  source,
  open,
  onClose,
}: {
  source?: RuleSource;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!source;

  const [form, setForm] = useState<Partial<RuleSource>>(source ?? emptyForm());

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? updateRuleSource(source!.sourceId, form)
        : createRuleSource(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-sources'] });
      onClose();
    },
  });

  const inputCls =
    'w-full h-8 rounded-lg border border-border bg-surface-input px-3 text-sm text-text placeholder:text-text-muted transition-colors focus:outline-none focus:border-accent/50';
  const selectCls = inputCls + ' cursor-pointer';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-md rounded-2xl border border-border bg-surface-dialog p-6">
        <h3 className="mb-4 text-sm font-semibold text-text">
          {isEdit ? '编辑规则来源' : '新增规则来源'}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-text-muted">来源名称 *</label>
            <input
              value={form.systemName}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
              placeholder="如：反欺诈系统 v2.1"
              className={inputCls}
              aria-label="来源名称"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-text-muted">系统类型</label>
              <select
                value={form.systemType}
                onChange={(e) => setForm({ ...form, systemType: e.target.value as RuleSource['systemType'] })}
                className={selectCls}
                title="系统类型"
              >
                <option value="realtime">实时</option>
                <option value="offline">离线</option>
                <option value="manual">手工</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">来源类型</label>
              <select
                value={form.sourceType}
                onChange={(e) => setForm({ ...form, sourceType: e.target.value as RuleSource['sourceType'] })}
                className={selectCls}
                title="来源类型"
              >
                <option value="file_import">文件导入</option>
                <option value="api_sync">API 同步</option>
                <option value="manual_input">手工录入</option>
                <option value="model_generated">模型生成</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">文件名 / API 路径</label>
            <input
              value={form.fileName ?? ''}
              onChange={(e) => setForm({ ...form, fileName: e.target.value })}
              placeholder="rules_2024.xlsx"
              className={inputCls}
              aria-label="文件名"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">操作人</label>
            <input
              value={form.importedBy ?? ''}
              onChange={(e) => setForm({ ...form, importedBy: e.target.value })}
              placeholder="admin"
              className={inputCls}
              aria-label="操作人"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-muted">备注</label>
            <input
              value={form.importNote ?? ''}
              onChange={(e) => setForm({ ...form, importNote: e.target.value })}
              placeholder="可选说明"
              className={inputCls}
              aria-label="备注"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-text-dim transition-colors hover:bg-surface-soft hover:text-text"
          >
            <IconX size={12} />
            取消
          </button>
          <button
            disabled={!form.systemName || save.isPending}
            onClick={() => save.mutate()}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <IconCheck size={12} />
            {save.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── RulesForSource ─────────────────────────────────────────────────────────

function RulesForSource({ sourceId, onBack }: { sourceId: string; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rule-source-rules', sourceId],
    queryFn: () => getRuleSourceRules(sourceId),
  });

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-text-dim transition-colors hover:text-accent"
      >
        <IconArrowLeft size={12} />
        返回来源列表
      </button>
      {isLoading ? (
        <p className="text-sm text-text-muted">加载中…</p>
      ) : !data?.length ? (
        <p className="text-sm text-text-muted">暂无关联规则</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-subtle">
          <table className="w-full text-xs">
            <thead className="bg-surface">
              <tr>
                {['规则名称', '业务类型', '规则类型', '匹配置信度', '状态'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.ruleId} className="border-t border-border-subtle hover:bg-surface-soft/40">
                  <td className="px-3 py-2 font-medium text-text">{r.ruleName}</td>
                  <td className="px-3 py-2 text-text-dim">{r.bizType ?? '—'}</td>
                  <td className="px-3 py-2 text-text-dim">{r.ruleType ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[11px] text-accent">
                      {(r.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── RuleSourcesPanel ───────────────────────────────────────────────────────

export function RuleSourcesPanel() {
  const qc = useQueryClient();

  const [editTarget, setEditTarget] = useState<RuleSource | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [viewSourceId, setViewSourceId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rule-sources'],
    queryFn: () => listRuleSources(),
  });

  const del = useMutation({
    mutationFn: deleteRuleSource,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-sources'] }),
  });

  return (
    <div className="w-full p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconDatabase size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">规则来源管理</h2>
          {data && (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted bg-surface-soft">
              {data.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-lg border border-accent/25 bg-accent/15 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/25"
        >
          <IconPlus size={11} />
          新增来源
        </button>
      </div>

      {/* Detail view */}
      {viewSourceId ? (
        <RulesForSource sourceId={viewSourceId} onBack={() => setViewSourceId(null)} />
      ) : isLoading ? (
        <p className="text-sm text-text-muted">加载中…</p>
      ) : !data?.length ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-muted">
          <IconDatabase size={32} className="opacity-30" />
          <p className="text-sm">暂无规则来源记录</p>
          <p className="text-xs">通过「新增来源」添加规则导入记录</p>
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-border-subtle">
          <table className="min-w-full text-xs">
            <thead className="bg-surface">
              <tr>
                {['来源名称', '系统类型', '来源类型', '规则数', '文件/路径', '操作人', '操作'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((src) => (
                <tr key={src.sourceId} className="border-t border-border-subtle transition-colors hover:bg-surface-soft/40">
                  <td className="px-3 py-2.5 font-medium text-text">{src.systemName}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${systemTypeBadge[src.systemType] ?? systemTypeBadge.manual}`}>
                      {src.systemType}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${sourceTypeBadge[src.sourceType] ?? ''}`}>
                      {sourceTypeLabel[src.sourceType] ?? src.sourceType}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-text-dim">{src.ruleCount}</td>
                  <td className="max-w-[120px] truncate px-3 py-2.5 text-text-muted" title={src.fileName}>
                    {src.fileName ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-text-muted">{src.importedBy ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        title="查看关联规则"
                        onClick={() => setViewSourceId(src.sourceId)}
                        className="rounded p-1 text-text-muted transition-colors hover:bg-accent/15 hover:text-accent"
                      >
                        <IconList size={12} />
                      </button>
                      <button
                        title="编辑来源"
                        onClick={() => setEditTarget(src)}
                        className="rounded p-1 text-text-muted transition-colors hover:bg-accent/15 hover:text-accent"
                      >
                        <IconPencil size={12} />
                      </button>
                      <button
                        title="删除来源"
                        disabled={del.isPending}
                        onClick={() => del.mutate(src.sourceId)}
                        className="rounded p-1 text-text-muted transition-colors hover:bg-danger/15 hover:text-danger disabled:opacity-40"
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

      {/* Create dialog */}
      <EditDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      {/* Edit dialog */}
      <EditDialog
        source={editTarget ?? undefined}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}
