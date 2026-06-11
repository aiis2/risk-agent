import { useEffect, useMemo, useState } from 'react';
import {
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconListDetails,
  IconNotes,
  IconSparkles,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { ResponseContent } from '../Chat/responseContent';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

interface StructuredAnswerAuxiliarySection {
  id: string;
  label: string;
  summaryLabel: string;
  items: string[];
  ordered?: boolean;
  Icon: typeof IconListDetails;
}

interface StructuredAnswerPayload {
  primaryResponse: string;
  auxiliarySections: StructuredAnswerAuxiliarySection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readPrimaryResponse(value: Record<string, unknown>): string {
  const candidates = [value.response, value.summary, value.overview, value.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

function splitStructuredAnswerResponse(response: string): { primaryResponse: string; leadResponse: string } {
  const normalized = response.trim();
  if (!normalized) {
    return { primaryResponse: '', leadResponse: '' };
  }

  const dividerMatch = /\n\s*(?:---|\*\*\*)\s*\n/.exec(normalized);
  if (dividerMatch) {
    const leadResponse = normalized.slice(0, dividerMatch.index).trim();
    const primaryResponse = normalized.slice(dividerMatch.index + dividerMatch[0].length).trim();
    if (leadResponse && primaryResponse) {
      return { primaryResponse, leadResponse };
    }
  }

  const firstHeadingOffset = normalized.search(/\n#{1,6}\s+/);
  if (firstHeadingOffset > 0) {
    const leadResponse = normalized.slice(0, firstHeadingOffset).trim();
    const primaryResponse = normalized.slice(firstHeadingOffset + 1).trim();
    if (leadResponse && primaryResponse) {
      return { primaryResponse, leadResponse };
    }
  }

  return { primaryResponse: normalized, leadResponse: '' };
}

function normalizeAuxiliarySectionText(text: string, sectionLabel?: string): string {
  const normalized = text
    .replace(/^#{1,6}\s+/u, '')
    .trim();

  if (!sectionLabel) {
    return normalized;
  }

  const escapedLabel = sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return normalized
    .replace(new RegExp(`^${escapedLabel}(?:[：:\-\s]*)`, 'u'), '')
    .trim();
}

export function readStructuredAnswer(value: unknown): StructuredAnswerPayload | null {
  if (!isRecord(value)) return null;

  const response = readPrimaryResponse(value);
  const notes = isStringArray(value.notes) ? value.notes.filter(Boolean) : [];
  const suggestedNextActions = isStringArray(value.suggestedNextActions)
    ? value.suggestedNextActions.filter(Boolean)
    : [];
  const evidence = isStringArray(value.evidence) ? value.evidence.filter(Boolean) : [];

  if (!response && notes.length === 0 && suggestedNextActions.length === 0 && evidence.length === 0) {
    return null;
  }

  const { primaryResponse, leadResponse } = splitStructuredAnswerResponse(response);
  const auxiliarySections: StructuredAnswerAuxiliarySection[] = [];

  if (leadResponse) {
    auxiliarySections.push({
      id: 'lead',
      label: '过程说明',
      summaryLabel: '过程',
      items: [normalizeAuxiliarySectionText(leadResponse, '过程说明')],
      Icon: IconListDetails,
    });
  }

  if (notes.length > 0) {
    auxiliarySections.push({
      id: 'notes',
      label: '备注',
      summaryLabel: '备注',
      items: notes.map((note) => normalizeAuxiliarySectionText(note, '备注')),
      Icon: IconNotes,
    });
  }

  if (suggestedNextActions.length > 0) {
    auxiliarySections.push({
      id: 'suggested-next-actions',
      label: '后续建议',
      summaryLabel: '建议',
      items: suggestedNextActions,
      ordered: true,
      Icon: IconBulb,
    });
  }

  if (evidence.length > 0) {
    auxiliarySections.push({
      id: 'evidence',
      label: '证据',
      summaryLabel: '证据',
      items: evidence,
      Icon: IconSparkles,
    });
  }

  return {
    primaryResponse: primaryResponse || response,
    auxiliarySections,
  };
}

function AuxiliarySection({
  section,
  compact = false,
}: {
  section: StructuredAnswerAuxiliarySection;
  compact?: boolean;
}) {
  const contentClassName = compact
    ? '[&_p]:text-[11px] [&_p]:leading-5 [&_li]:text-[11px] [&_li]:leading-5 [&_ol]:text-[11px] [&_ul]:text-[11px] [&_blockquote]:text-[11px]'
    : '[&_p]:text-xs [&_p]:leading-6';

  return (
    <section className="rounded-[16px] border border-border/60 bg-surface/90 px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-subtle">
        <section.Icon size={11} className="text-accent/75" />
        <span>{section.label}</span>
      </div>

      {section.ordered ? (
        <ol className="space-y-2">
          {section.items.map((item, index) => (
            <li key={`${section.id}_${index}`} className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">
                {index + 1}
              </span>
              <ResponseContent content={item} className={contentClassName} />
            </li>
          ))}
        </ol>
      ) : section.items.length === 1 ? (
        <ResponseContent content={section.items[0]} className={contentClassName} />
      ) : (
        <ul className="space-y-1.5">
          {section.items.map((item, index) => (
            <li key={`${section.id}_${index}`}>
              <ResponseContent content={item} className={contentClassName} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function StructuredAnswerSurface({
  content,
  identityKey,
  runStatus,
  compact = false,
  detailsOnly = false,
  className,
}: {
  content: unknown;
  identityKey: string;
  runStatus?: string;
  compact?: boolean;
  detailsOnly?: boolean;
  className?: string;
}) {
  const structuredAnswer = useMemo(() => readStructuredAnswer(content), [content]);
  const hasAuxiliary = (structuredAnswer?.auxiliarySections.length ?? 0) > 0;
  const isTerminal = runStatus ? TERMINAL_RUN_STATUSES.has(runStatus) : true;
  const [auxiliaryOpen, setAuxiliaryOpen] = useState(hasAuxiliary && !isTerminal);
  const [hasUserToggledAuxiliary, setHasUserToggledAuxiliary] = useState(false);

  useEffect(() => {
    setHasUserToggledAuxiliary(false);
  }, [identityKey]);

  useEffect(() => {
    if (!hasAuxiliary || hasUserToggledAuxiliary) return;
    setAuxiliaryOpen(!isTerminal);
  }, [hasAuxiliary, hasUserToggledAuxiliary, isTerminal]);

  if (!structuredAnswer) return null;

  if (detailsOnly) {
    return (
      <div className={clsx('space-y-3', className)}>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/15 bg-accent/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/80">
          <IconListDetails size={11} />
          响应详情
        </div>

        {hasAuxiliary ? (
          structuredAnswer.auxiliarySections.map((section) => (
            <AuxiliarySection key={section.id} section={section} compact={compact} />
          ))
        ) : (
          <section className="rounded-[16px] border border-border/60 bg-surface/90 px-3.5 py-3">
            <p className={compact ? 'text-[11px] leading-5 text-text-muted' : 'text-xs leading-6 text-text-muted'}>
              无额外响应详情。
            </p>
          </section>
        )}
      </div>
    );
  }

  const auxiliarySummary = structuredAnswer.auxiliarySections.map((section) => section.summaryLabel).join('、');
  const auxiliaryItemCount = structuredAnswer.auxiliarySections.reduce((count, section) => count + section.items.length, 0);

  return (
    <div className={clsx('overflow-hidden rounded-[22px] border border-border bg-surface shadow-[0_12px_30px_rgba(0,0,0,0.12)]', className)}>
      <div className={clsx(compact ? 'px-3 py-3' : 'px-4 py-4')}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/80">
            <IconSparkles size={11} />
            最终回复
          </div>
          {hasAuxiliary ? (
            <span className="text-[10px] text-text-subtle/70">正文优先，辅助信息已分层</span>
          ) : null}
        </div>

        <ResponseContent content={structuredAnswer.primaryResponse} />
      </div>

      {hasAuxiliary ? (
        <Collapsible
          open={auxiliaryOpen}
          onOpenChange={(open) => {
            setHasUserToggledAuxiliary(true);
            setAuxiliaryOpen(open);
          }}
          className="border-t border-border/70 bg-surface-card/55"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={`辅助内容${auxiliaryOpen ? '收起' : '展开'}`}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-card/75"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-surface text-text-muted">
                <IconListDetails size={14} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-text">辅助内容</span>
                <span className="block text-[11px] leading-4 text-text-muted">{auxiliarySummary}</span>
              </span>

              <span className="shrink-0 rounded-full border border-border/60 bg-surface px-2 py-1 text-[10px] font-medium text-text-muted">
                {auxiliaryItemCount} 项
              </span>

              <span className="shrink-0 text-text-subtle/70">
                {auxiliaryOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </span>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
            <div className={clsx('space-y-3 border-t border-border/60', compact ? 'px-3 py-3' : 'px-4 py-4')}>
              {structuredAnswer.auxiliarySections.map((section) => (
                <AuxiliarySection key={section.id} section={section} compact={compact} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}