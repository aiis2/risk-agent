import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconFileText, IconChevronRight, IconTrash, IconDownload, IconFileExport, IconDots } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { listReports, deleteReport, exportReportMd, exportReportHtml } from '../api/client';
import { ScrollArea } from '../components/ui/ScrollArea';
import { Dialog, DialogContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../components/ui';

function triggerBlobDownload(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'text-success bg-success/10 border-success/25'
    : score >= 60 ? 'text-warn bg-warn/10 border-warn/25'
    : 'text-danger bg-danger/10 border-danger/25';
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-mono', color)}>
      {score.toFixed(1)}
    </span>
  );
}

export function Reports() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: listReports });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      setPendingDeleteId(null);
    },
  });

  const handleExportMd = async (id: string, name: string) => {
    const md = await exportReportMd(id);
    triggerBlobDownload(md, 'text/markdown', `${name}.md`);
  };

  const handleExportHtml = async (id: string, name: string) => {
    const html = await exportReportHtml(id);
    triggerBlobDownload(html, 'text/html', `${name}.html`);
  };

  return (
    <ScrollArea className="flex-1 bg-surface">
      <div className="flex flex-col min-h-full">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-subtle bg-surface-sidebar shrink-0">
          <IconFileText size={14} className="text-accent" />
          <h1 className="text-sm font-semibold text-text">{t('reports.title', '分析报告')}</h1>
          {(data?.length ?? 0) > 0 && (
            <span className="ml-auto text-xs text-text-muted">
              {data!.length} {t('reports.total', '份')}
            </span>
          )}
        </div>

        <div className="w-full flex-1 p-5">
          <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="px-5 py-8 text-sm text-text-muted text-center">{t('common.loading')}</div>
            ) : !data?.length ? (
              <div className="px-5 py-8 text-sm text-text-muted text-center">{t('common.empty')}</div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_90px_160px_80px] gap-4 px-5 py-2.5 text-xs text-text-muted uppercase tracking-wide">
                  <span>{t('scenarios.name', '名称')}</span>
                  <span>{t('reports.overallScore', '综合分')}</span>
                  <span>{t('reports.created', '生成时间')}</span>
                  <span className="text-right">{t('common.actions', '操作')}</span>
                </div>
                {data.map((r) => (
                  <div
                    key={r.reportId}
                    className="grid grid-cols-[1fr_90px_160px_80px] gap-4 px-5 py-3 items-center hover:bg-surface-soft transition-colors"
                  >
                    <span className="text-sm text-text font-medium truncate">{r.businessName}</span>
                    <ScoreBadge score={r.overallScore} />
                    <span className="text-xs text-text-muted font-mono">{r.createdAt}</span>
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        to={`/reports/${r.reportId}`}
                        className="flex items-center gap-0.5 text-xs text-accent hover:text-accent-hover transition-colors"
                      >
                        {t('reports.view', '查看')} <IconChevronRight size={11} />
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label="更多操作"
                            className="p-1.5 rounded text-text-muted hover:text-text-dim hover:bg-surface-soft transition-colors"
                          >
                            <IconDots size={13} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onClick={() => handleExportMd(r.reportId, r.businessName)}>
                            <IconDownload size={13} className="mr-2" />
                            导出 Markdown
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExportHtml(r.reportId, r.businessName)}>
                            <IconFileExport size={13} className="mr-2" />
                            导出 HTML
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setPendingDeleteId(r.reportId)}
                            className="text-danger focus:text-danger"
                          >
                            <IconTrash size={13} className="mr-2" />
                            删除报告
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <DialogContent className="bg-surface-card border border-border rounded-xl p-6 max-w-sm w-full">
          <h3 className="text-sm font-semibold text-text mb-2">{t('reports.deleteConfirm', '确认删除报告？')}</h3>
          <p className="text-xs text-text-dim mb-5">{t('reports.deleteWarning', '此操作不可撤销。')}</p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setPendingDeleteId(null)}
              className="px-4 py-1.5 rounded-lg text-xs text-text-dim border border-border hover:bg-surface-soft transition-colors"
            >
              {t('common.cancel', '取消')}
            </button>
            <button
              onClick={() => pendingDeleteId && deleteMutation.mutate(pendingDeleteId)}
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
