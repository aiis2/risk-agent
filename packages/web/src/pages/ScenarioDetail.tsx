/**
 * ScenarioDetail — 业务场景详情页
 * 展示场景元信息、数据源、文档列表、备注，支持编辑与分析跳转
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconBook,
  IconChevronLeft,
  IconDatabase,
  IconFileText,
  IconNotes,
  IconPencil,
  IconPlayerPlay,
  IconCheck,
  IconX,
  IconLoader2,
  IconShieldSearch,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { getScenario, updateScenario } from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Separator } from '../components/ui/Separator';
import { Select, SelectItem } from '../components/ui/Select';
import { PageWrapper } from '../components/PageWrapper';

const statusBadge: Record<string, string> = {
  active: 'text-success bg-success/10 border border-success/25',
  draft: 'text-warn bg-warn/10 border border-warn/25',
  archived: 'text-text-dim bg-text-dim/10 border border-text-dim/25',
};

export function ScenarioDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    domain: string;
    status: 'draft' | 'active' | 'archived';
    manualNotes: string;
  } | null>(null);

  const { data: scenario, isLoading } = useQuery({
    queryKey: ['scenario', id],
    queryFn: () => getScenario(id!),
    enabled: !!id,
  });

  const save = useMutation({
    mutationFn: (data: typeof draft) => updateScenario(id!, data!),
    onSuccess: (updated) => {
      qc.setQueryData(['scenario', id], updated);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      setEditing(false);
      setDraft(null);
    },
  });

  const startEdit = () => {
    if (!scenario) return;
    setDraft({
      name: scenario.name,
      description: scenario.description ?? '',
      domain: scenario.domain ?? '',
      status: scenario.status,
      manualNotes: scenario.manualNotes ?? '',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
  };

  const inputCls =
    'w-full h-8 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors';
  const textareaCls =
    'w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 resize-y transition-colors';

  if (isLoading) {
    return (
      <PageWrapper>
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          <IconLoader2 size={16} className="animate-spin mr-2" />
          {t('common.loading')}
        </div>
      </PageWrapper>
    );
  }

  if (!scenario) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm text-text-muted">{t('scenarios.notFound', '未找到该场景')}</p>
          <Link to="/scenarios" className="text-xs text-accent hover:underline">
            {t('scenarios.backToList', '返回场景列表')}
          </Link>
        </div>
      </PageWrapper>
    );
  }

  return (
    <ScrollArea className="flex-1 bg-surface">
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-subtle bg-surface-sidebar shrink-0">
          <Link
            to="/scenarios"
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-dim transition-colors"
          >
            <IconChevronLeft size={13} />
            {t('scenarios.title', '业务场景')}
          </Link>
          <span className="text-border">/</span>
          <IconBook size={13} className="text-accent" />
          <h1 className="text-sm font-semibold text-text truncate">{scenario.name}</h1>
          <span
            className={clsx(
              'ml-1 text-xs px-2 py-0.5 rounded-full',
              statusBadge[scenario.status] ?? statusBadge.draft
            )}
          >
            {t(`scenarios.status${scenario.status.charAt(0).toUpperCase() + scenario.status.slice(1)}`, scenario.status)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {!editing ? (
              <>
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-dim bg-surface-card border border-border-subtle hover:border-border hover:text-text transition-colors"
                >
                  <IconPencil size={11} />
                  {t('common.edit', '编辑')}
                </button>
                <button
                  onClick={() =>
                    navigate(`/?scenario=${id}`)
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-accent hover:bg-accent-hover transition-colors"
                >
                  <IconShieldSearch size={11} />
                  {t('scenarios.runAnalysis', '启动分析')}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={cancelEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-dim bg-surface-card border border-border-subtle hover:border-border transition-colors"
                >
                  <IconX size={11} />
                  {t('common.cancel', '取消')}
                </button>
                <button
                  disabled={save.isPending || !draft?.name?.trim()}
                  onClick={() => save.mutate(draft)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {save.isPending ? (
                    <IconLoader2 size={11} className="animate-spin" />
                  ) : (
                    <IconCheck size={11} />
                  )}
                  {t('common.save', '保存')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="w-full flex-1 p-5 space-y-4">
          {/* Meta card */}
          <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
            {editing && draft ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-text-muted mb-1.5 block">{t('scenarios.name', '名称')}</label>
                    <input
                      className={inputCls}
                      aria-label={t('scenarios.name', '名称')}
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted mb-1.5 block">{t('scenarios.domain', '领域')}</label>
                    <input
                      className={inputCls}
                      value={draft.domain}
                      placeholder="如：payment"
                      onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1.5 block">{t('scenarios.description', '描述')}</label>
                  <textarea
                    className={textareaCls}
                    rows={3}
                    aria-label={t('scenarios.description', '描述')}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
                <div className="w-40">
                  <label className="text-xs text-text-muted mb-1.5 block">{t('scenarios.status', '状态')}</label>
                  <Select
                    value={draft.status}
                    onValueChange={(v) => setDraft({ ...draft, status: v as typeof draft.status })}
                  >
                    <SelectItem value="active">{t('scenarios.statusActive', '启用')}</SelectItem>
                    <SelectItem value="draft">{t('scenarios.statusDraft', '草稿')}</SelectItem>
                    <SelectItem value="archived">{t('scenarios.statusArchived', '已归档')}</SelectItem>
                  </Select>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0">
                    <IconBook size={18} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-semibold text-text">{scenario.name}</h2>
                    {scenario.domain && (
                      <p className="text-xs text-text-muted mt-0.5 font-mono">{scenario.domain}</p>
                    )}
                    {scenario.description && (
                      <p className="text-sm text-text-dim mt-2 leading-relaxed">{scenario.description}</p>
                    )}
                  </div>
                </div>
                <Separator className="my-4 bg-border-subtle" />
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <p className="text-text-muted mb-0.5">{t('scenarios.version', '版本')}</p>
                    <p className="text-text font-mono">v{scenario.version}</p>
                  </div>
                  <div>
                    <p className="text-text-muted mb-0.5">{t('common.createdAt', '创建时间')}</p>
                    <p className="text-text font-mono">{scenario.createdAt?.slice(0, 16).replace('T', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-text-muted mb-0.5">{t('common.updatedAt', '更新时间')}</p>
                    <p className="text-text font-mono">{scenario.updatedAt?.slice(0, 16).replace('T', ' ')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Data sources */}
          {scenario.dataSources.length > 0 && (
            <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
                <IconDatabase size={12} className="text-accent" />
                <h3 className="text-xs font-semibold text-text uppercase tracking-wide">
                  {t('scenarios.dataSources', '数据源')}
                </h3>
                <span className="ml-auto text-xs text-text-muted">{scenario.dataSources.length}</span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {scenario.dataSources.map((ds) => (
                  <span
                    key={ds}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-surface-soft border border-border text-text-dim"
                  >
                    <IconDatabase size={10} />
                    {ds}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          {scenario.documents.length > 0 && (
            <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
                <IconFileText size={12} className="text-accent" />
                <h3 className="text-xs font-semibold text-text uppercase tracking-wide">
                  {t('scenarios.documents', '文档')}
                </h3>
                <span className="ml-auto text-xs text-text-muted">{scenario.documents.length}</span>
              </div>
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {scenario.documents.map((doc) => (
                  <span
                    key={doc}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-surface-soft border border-border text-text-dim"
                  >
                    <IconFileText size={10} />
                    {doc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Manual notes */}
          <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
              <IconNotes size={12} className="text-accent" />
              <h3 className="text-xs font-semibold text-text uppercase tracking-wide">
                {t('scenarios.manualNotes', '人工备注')}
              </h3>
            </div>
            <div className="px-4 py-3">
              {editing && draft ? (
                <textarea
                  className={textareaCls}
                  rows={4}
                  placeholder={t('scenarios.manualNotesPlaceholder', '记录业务场景相关背景知识、特殊约束、人工发现的风险点等...')}
                  value={draft.manualNotes}
                  onChange={(e) => setDraft({ ...draft, manualNotes: e.target.value })}
                />
              ) : scenario.manualNotes ? (
                <p className="text-sm text-text-dim leading-relaxed whitespace-pre-wrap">{scenario.manualNotes}</p>
              ) : (
                <p className="text-sm text-text-muted italic">{t('scenarios.noNotes', '暂无备注')}</p>
              )}
            </div>
          </div>

          {/* Quick action */}
          {!editing && (
            <div className="flex items-center justify-between p-4 rounded-xl bg-accent/5 border border-accent/20">
              <div>
                <p className="text-sm font-medium text-text">{t('scenarios.startAnalysis', '对此场景进行风险分析')}</p>
                <p className="text-xs text-text-muted mt-0.5">{t('scenarios.startAnalysisDesc', '启动 ReAct 智能体，以此场景为上下文进行分析')}</p>
              </div>
              <button
                onClick={() => navigate(`/?scenario=${id}`)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-accent hover:bg-accent-hover transition-colors shrink-0"
              >
                <IconPlayerPlay size={13} />
                {t('scenarios.runAnalysis', '启动分析')}
              </button>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
