import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { IconBook, IconChevronRight, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { createScenario, deleteScenario, listScenarios } from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Select, SelectItem } from '../components/ui/Select';
import { Dialog, DialogContent } from '../components/ui';

const statusBadge: Record<string, string> = {
  active: 'border border-success/25 bg-success/10 text-success',
  draft: 'border border-warn/25 bg-warn/10 text-warn',
  archived: 'border border-border/30 bg-border/20 text-text-dim',
};

export function Scenarios() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['scenarios'], queryFn: listScenarios });
  const create = useMutation({
    mutationFn: createScenario,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios'] }),
  });
  const del = useMutation({
    mutationFn: deleteScenario,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenarios'] }),
  });
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    domain: '',
    description: '',
    status: 'active' as 'draft' | 'active',
  });

  const resetForm = () => setForm({ name: '', domain: '', description: '', status: 'active' });

  return (
    <>
    <ScrollArea className="flex-1 bg-surface">
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border-subtle bg-surface-sidebar px-5 py-3 shrink-0">
          <IconBook size={14} className="text-accent" />
          <h1 className="text-sm font-semibold text-text">{t('scenarios.title')}</h1>
          <button
            onClick={() => setIsCreating(true)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
          >
            <IconPlus size={13} />
            {t('scenarios.create', '新建场景')}
          </button>
        </div>

        <div className="w-full flex-1 p-5">
          {/* Scenarios list */}
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card">
            <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3.5">
              <span className="ml-auto text-xs text-text-muted">
                {data?.length ?? 0} {t('scenarios.total', '条')}
              </span>
            </div>
            {isLoading ? (
              <div className="px-5 py-8 text-center text-sm text-text-muted">{t('common.loading')}</div>
            ) : !data?.length ? (
              <div className="px-5 py-8 text-center text-sm text-text-muted">{t('common.empty')}</div>
            ) : (
              <div className="divide-y divide-border-subtle">
                <div className="grid grid-cols-[1fr_120px_80px_140px_60px] gap-4 px-5 py-2.5 text-xs uppercase tracking-wide text-text-muted">
                  <span>{t('scenarios.name')}</span>
                  <span>{t('scenarios.domain')}</span>
                  <span>{t('scenarios.status')}</span>
                  <span>{t('scenarios.updated')}</span>
                  <span className="text-right">{t('common.actions')}</span>
                </div>
                {data.map((s) => (
                  <div
                    key={s.scenarioId}
                    className="grid grid-cols-[1fr_120px_80px_140px_60px] items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-soft/50"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/scenarios/${s.scenarioId}`}
                        className="flex items-center gap-1 group"
                      >
                        <p className="truncate text-sm font-medium text-text transition-colors group-hover:text-accent">{s.name}</p>
                        <IconChevronRight size={11} className="shrink-0 text-text-muted transition-colors group-hover:text-accent" />
                      </Link>
                      {s.description && (
                        <p className="mt-0.5 truncate text-xs text-text-muted">{s.description}</p>
                      )}
                    </div>
                    <span className="truncate text-sm text-text-dim">{s.domain ?? '—'}</span>
                    <span
                      className={clsx(
                        'inline-flex items-center text-xs px-2 py-0.5 rounded-full w-fit',
                        statusBadge[s.status] ?? statusBadge.draft
                      )}
                    >
                      {t(`scenarios.status${s.status.charAt(0).toUpperCase() + s.status.slice(1)}`, s.status)}
                    </span>
                    <span className="font-mono text-xs text-text-muted">{s.updatedAt}</span>
                    <div className="flex justify-end">
                      <button
                        title={t('common.delete')}
                        onClick={() => del.mutate(s.scenarioId)}
                        className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <IconTrash size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>

    {/* Create Scenario Dialog */}
    <Dialog open={isCreating} onOpenChange={(open) => { if (!open) { setIsCreating(false); resetForm(); } }}>
      <DialogContent className="bg-surface-dialog border border-border rounded-xl p-6 max-w-lg w-full">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <IconPlus size={15} className="text-accent" />
            <h2 className="text-sm font-semibold text-text">{t('scenarios.create', '新建场景')}</h2>
          </div>
          <button
            onClick={() => { setIsCreating(false); resetForm(); }}
            aria-label="关闭"
            title="关闭"
            className="rounded-lg p-1 text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
          >
            <IconX size={14} />
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-text-muted">{t('scenarios.name')} *</label>
              <input
                className="w-full h-8 rounded-lg border border-border bg-surface-input px-3 py-1.5 text-sm text-text placeholder:text-text-muted transition-colors focus:outline-none focus:border-accent/50"
                placeholder={t('scenarios.namePlaceholder', '如：电商支付风控')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-text-muted">{t('scenarios.domain')}</label>
              <input
                className="w-full h-8 rounded-lg border border-border bg-surface-input px-3 py-1.5 text-sm text-text placeholder:text-text-muted transition-colors focus:outline-none focus:border-accent/50"
                placeholder={t('scenarios.domainPlaceholder', '如：payment')}
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-text-muted">{t('scenarios.description')}</label>
            <textarea
              className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors focus:outline-none focus:border-accent/50"
              rows={3}
              placeholder={t('scenarios.descriptionPlaceholder', '业务场景的详细描述（可选）')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="w-36">
            <label className="mb-1.5 block text-xs text-text-muted">{t('scenarios.status')}</label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as 'draft' | 'active' })}
            >
              <SelectItem value="active">{t('scenarios.statusActive', '启用')}</SelectItem>
              <SelectItem value="draft">{t('scenarios.statusDraft', '草稿')}</SelectItem>
            </Select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => { setIsCreating(false); resetForm(); }}
            className="px-4 py-1.5 rounded-lg text-xs text-text-dim border border-border hover:bg-surface-hover transition-colors"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            className={clsx(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors',
              !form.name || create.isPending
                ? 'cursor-not-allowed bg-accent/30 text-accent/60'
                : 'bg-accent text-white hover:bg-accent-hover'
            )}
            disabled={!form.name || create.isPending}
            onClick={() =>
              create.mutate(form, {
                onSuccess: () => {
                  resetForm();
                  setIsCreating(false);
                },
              })
            }
          >
            <IconPlus size={13} />
            {create.isPending ? t('common.loading', '创建中…') : t('common.create', '创建')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
