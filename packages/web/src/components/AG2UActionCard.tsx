import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMessage, IconCircleCheck, IconAlertCircle, IconLoader2 } from '@tabler/icons-react';
import { clsx } from 'clsx';
import { submitSessionAnswer } from '../api/client.js';

export type AG2UAction = 'report_only' | 'save_kb' | 'write_graph';

/**
 * AG2UActionCard — 当 ReAct 流收到 `ask_user` 事件时，展示三项决策：
 *  - 仅保存报告 (report_only)
 *  - 写入知识库 (save_kb)
 *  - 写入图谱 (write_graph)
 *
 * 点击后调用 `/api/sessions/:id/answer`，由 SessionRunner 把答案 resolve 给 Orchestrator。
 */
export function AG2UActionCard(props: {
  sessionId: string;
  requestId: string;
  question: string;
  options?: string[];
  onAnswered?: (action: AG2UAction) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<AG2UAction | null>(null);
  const [doneAction, setDoneAction] = useState<AG2UAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labels: Record<AG2UAction, string> = {
    report_only: t('agent.ag2u.reportOnly', '仅保存报告'),
    save_kb: t('agent.ag2u.saveKb', '写入知识库'),
    write_graph: t('agent.ag2u.writeGraph', '写入业务图谱'),
  };
  const descriptions: Record<AG2UAction, string> = {
    report_only: t('agent.ag2u.reportOnlyDesc', '分析结果仅写入报告，不影响知识库'),
    save_kb: t('agent.ag2u.saveKbDesc', '同时将关键发现写入结构化知识库'),
    write_graph: t('agent.ag2u.writeGraphDesc', '同时将业务关系写入图谱，供后续分析复用'),
  };

  const acts: AG2UAction[] = (props.options as AG2UAction[])?.length
    ? (props.options as AG2UAction[])
    : ['report_only', 'save_kb', 'write_graph'];

  const submit = async (a: AG2UAction) => {
    try {
      setBusy(a);
      setError(null);
      await submitSessionAnswer(props.sessionId, props.requestId, a);
      setDoneAction(a);
      props.onAnswered?.(a);
    } catch (err: any) {
      setError(err?.message ?? 'submit failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-warn/25 bg-warn/10 p-4">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <IconMessage size={14} className="shrink-0 text-warn" />
        <span className="text-sm font-semibold text-text">
          {t('agent.ag2u.title', '等待决策')}
        </span>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-text-dim">{props.question}</p>

      {doneAction ? (
        <div className="flex items-center gap-2 text-sm text-success">
          <IconCircleCheck size={14} />
          {t('agent.ag2u.done', '已提交：')}
          <span className="font-medium">{labels[doneAction]}</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {acts.map((a) => (
            <button
              key={a}
              disabled={!!busy}
              onClick={() => submit(a)}
              className={clsx(
                'flex flex-col gap-1 p-3 rounded-lg border text-left transition-all',
                busy === a
                  ? 'cursor-wait border-accent/40 bg-accent/20'
                  : 'cursor-pointer border-border bg-surface-card hover:border-accent/50 hover:bg-surface-soft',
                !!busy && busy !== a ? 'opacity-40 cursor-not-allowed' : ''
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-text">
                {busy === a && <IconLoader2 size={10} className="animate-spin" />}
                {labels[a] ?? a}
              </span>
              <span className="text-[10px] leading-relaxed text-text-muted">
                {descriptions[a] ?? ''}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-danger">
          <IconAlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}
