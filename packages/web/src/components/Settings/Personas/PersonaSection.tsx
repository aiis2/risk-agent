/**
 * PersonaSection — Persona 管理 Settings 标签页
 *
 * 功能：
 * - 列出所有 personas（内置 + 自定义）
 * - 创建 / 编辑 / Fork / 删除自定义 persona
 * - 查看 scope 标签、system_prompt 预览
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBrain,
  IconCircleCheck,
  IconCircleX,
  IconCopy,
  IconEdit,
  IconLoader2,
  IconPlus,
  IconRobot,
  IconSearch,
  IconShieldCheck,
  IconTrash,
  IconUser,
} from '@tabler/icons-react';
import {
  listPersonas,
  createPersona,
  updatePersona,
  forkPersona,
  deletePersona,
  type Persona,
} from '../../../api/client';
import { Dialog, DialogContent } from '../../ui/Dialog';
import { ScrollArea } from '../../ui/ScrollArea';
import { Select, SelectItem } from '../../ui/Select';

const SCOPE_BADGE: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  general: { label: '通用', className: 'bg-accent/15 text-accent', icon: <IconUser size={10} /> },
  analysis: { label: '风控分析', className: 'bg-danger/15 text-danger', icon: <IconShieldCheck size={10} /> },
  'data-analysis': { label: '数据分析', className: 'bg-success/15 text-success', icon: <IconBrain size={10} /> },
  'knowledge-query': { label: '知识检索', className: 'bg-warn/15 text-warn', icon: <IconSearch size={10} /> },
  'skill-management': { label: '技能管理', className: 'bg-accent/15 text-accent', icon: <IconRobot size={10} /> },
};

const inputCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors';
const textareaCls =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors resize-y min-h-[80px]';
const btnPrimary =
  'flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/25 disabled:opacity-50';
const btnDanger =
  'flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/20 disabled:opacity-50';

interface PersonaFormData {
  name: string;
  scope: string;
  description: string;
  systemPrompt: string;
  traits: string; // JSON string
}

function PersonaFormDialog({
  open,
  onClose,
  onSaved,
  initial,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initial?: Partial<Persona>;
  mode: 'create' | 'edit';
}) {
  const [form, setForm] = useState<PersonaFormData>(() => ({
    name: initial?.name ?? '',
    scope: initial?.scope ?? 'general',
    description: initial?.description ?? '',
    systemPrompt: initial?.systemPrompt ?? '',
    traits: JSON.stringify(initial?.traits ?? {}, null, 2),
  }));
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      let traits: Record<string, unknown> = {};
      try { traits = JSON.parse(form.traits); } catch { /* ok */ }
      if (mode === 'create') {
        await createPersona({ name: form.name, scope: form.scope as Persona['scope'], description: form.description, systemPrompt: form.systemPrompt, traits });
      } else if (initial?.personaId) {
        await updatePersona(initial.personaId, { name: form.name, scope: form.scope as Persona['scope'], description: form.description, systemPrompt: form.systemPrompt, traits });
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-surface-card border border-border rounded-xl p-6 w-full max-w-2xl">
        <h3 className="text-base font-semibold text-text mb-4">
          {mode === 'create' ? '创建 Persona' : '编辑 Persona'}
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-dim mb-1">名称</label>
              <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. 风控专家" />
            </div>
            <div>
              <label className="block text-xs text-text-dim mb-1">应用范围</label>
              <Select
                value={form.scope}
                onValueChange={(v) => setForm((f) => ({ ...f, scope: v }))}
              >
                {Object.entries(SCOPE_BADGE).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">描述</label>
            <input className={inputCls} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="一句话描述此 persona 的用途" />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">System Prompt</label>
            <textarea className={textareaCls} rows={6} value={form.systemPrompt} onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))} placeholder="你是一名专业的..." />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">Traits (JSON)</label>
            <textarea className={textareaCls} rows={3} value={form.traits} onChange={(e) => setForm((f) => ({ ...f, traits: e.target.value }))} placeholder='{&quot;tone&quot;: &quot;professional&quot;}' />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm text-text-dim hover:text-text transition-colors">
            取消
          </button>
          <button
            type="button"
            disabled={!form.name.trim() || !form.systemPrompt.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
            className={btnPrimary}
          >
            {mutation.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconCircleCheck size={14} />}
            保存
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PersonaCard({
  persona,
  onEdit,
  onFork,
  onDelete,
}: {
  persona: Persona;
  onEdit: (p: Persona) => void;
  onFork: (p: Persona) => void;
  onDelete: (p: Persona) => void;
}) {
  const badge = SCOPE_BADGE[persona.scope] ?? SCOPE_BADGE['general'];
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface-card p-4 group hover:border-accent/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-soft text-accent">
          <IconRobot size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text">{persona.name}</span>
            <span className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
              {badge.icon}
              {badge.label}
            </span>
            {persona.isBuiltIn && (
              <span className="rounded-md bg-text-muted/20 px-1.5 py-0.5 text-[10px] text-text-muted">内置</span>
            )}
          </div>
          {persona.description && (
            <p className="mt-0.5 text-xs text-text-dim leading-relaxed">{persona.description}</p>
          )}
          {persona.systemPrompt && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[10px] text-text-muted hover:text-accent transition-colors"
            >
              {expanded ? '收起 System Prompt' : '展开 System Prompt'}
            </button>
          )}
          {expanded && persona.systemPrompt && (
            <pre className="mt-2 rounded-lg bg-surface p-3 text-[11px] text-text-dim whitespace-pre-wrap leading-relaxed font-mono overflow-auto max-h-40">
              {persona.systemPrompt}
            </pre>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            type="button"
            title="Fork"
            onClick={() => onFork(persona)}
            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-soft hover:text-accent transition-colors"
          >
            <IconCopy size={14} />
          </button>
          {!persona.isBuiltIn && (
            <>
              <button
                type="button"
                title="Edit"
                onClick={() => onEdit(persona)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-surface-soft hover:text-accent transition-colors"
              >
                <IconEdit size={14} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => onDelete(persona)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-surface-soft hover:text-danger transition-colors"
              >
                <IconTrash size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PersonaSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Persona | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Persona | null>(null);

  const { data: personas = [], isLoading } = useQuery({
    queryKey: ['personas'],
    queryFn: listPersonas,
  });

  const doFork = useMutation({
    mutationFn: (p: Persona) => forkPersona(p.personaId, { name: `${p.name} (副本)` }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['personas'] }),
  });

  const doDelete = useMutation({
    mutationFn: (id: string) => deletePersona(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personas'] });
      setDeleteTarget(null);
    },
  });

  const filtered = personas.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()),
  );

  const refetch = () => qc.invalidateQueries({ queryKey: ['personas'] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">Persona 管理</h2>
          <p className="mt-0.5 text-xs text-text-muted">管理 AI 助手的人格档案，不同场景自动匹配最适合的 persona</p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className={btnPrimary}>
          <IconPlus size={14} />
          新建
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          className={`${inputCls} pl-8`}
          placeholder="搜索 persona..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <IconLoader2 size={20} className="animate-spin text-text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center">
          <IconRobot size={32} className="mx-auto mb-2 text-border" />
          <p className="text-sm text-text-muted">
            {search ? '没有匹配的 persona' : '还没有 persona'}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[60vh] pr-1">
          <div className="space-y-2">
            {filtered.map((p) => (
              <PersonaCard
                key={p.personaId}
                persona={p}
                onEdit={setEditTarget}
                onFork={(p) => doFork.mutate(p)}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Create dialog */}
      {createOpen && (
        <PersonaFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={refetch} mode="create" />
      )}

      {/* Edit dialog */}
      {editTarget && (
        <PersonaFormDialog
          open
          onClose={() => setEditTarget(null)}
          onSaved={refetch}
          initial={editTarget}
          mode="edit"
        />
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="bg-surface-card border border-border rounded-xl p-6 max-w-sm">
          <h3 className="text-sm font-semibold text-text mb-2">删除 Persona</h3>
          <p className="text-xs text-text-dim mb-4">
            确认删除 <span className="text-text font-medium">{deleteTarget?.name}</span>？此操作不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-1.5 text-sm text-text-dim hover:text-text transition-colors">
              取消
            </button>
            <button
              type="button"
              disabled={doDelete.isPending}
              onClick={() => deleteTarget && doDelete.mutate(deleteTarget.personaId)}
              className={btnDanger}
            >
              {doDelete.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconCircleX size={14} />}
              删除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
