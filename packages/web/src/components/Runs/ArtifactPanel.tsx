import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunArtifactRecord } from '../../api/client';
import { createSkill } from '../../api/client';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCode,
  IconFile,
  IconListCheck,
  IconLoader2,
  IconShieldCheck,
  IconSparkles,
} from '@tabler/icons-react';
import { StructuredAnswerSurface } from './StructuredAnswerSurface';

interface SkillProposalPayload {
  type: 'skill-proposal';
  sourceRunId?: string;
  taskKind?: string;
  title?: string;
  rationale?: string;
  triggerHints?: string[];
  workflow?: string[];
  evidence?: string[];
  publishHint?: string;
  creationPayload: {
    name?: string;
    description?: string;
    content?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readSkillProposal(value: unknown): SkillProposalPayload | null {
  if (!isRecord(value) || value.type !== 'skill-proposal' || !isRecord(value.creationPayload)) {
    return null;
  }

  return {
    type: 'skill-proposal',
    sourceRunId: typeof value.sourceRunId === 'string' ? value.sourceRunId : undefined,
    taskKind: typeof value.taskKind === 'string' ? value.taskKind : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    rationale: typeof value.rationale === 'string' ? value.rationale : undefined,
    triggerHints: isStringArray(value.triggerHints) ? value.triggerHints : [],
    workflow: isStringArray(value.workflow) ? value.workflow : [],
    evidence: isStringArray(value.evidence) ? value.evidence : [],
    publishHint: typeof value.publishHint === 'string' ? value.publishHint : undefined,
    creationPayload: {
      name: typeof value.creationPayload.name === 'string' ? value.creationPayload.name : undefined,
      description: typeof value.creationPayload.description === 'string' ? value.creationPayload.description : undefined,
      content: typeof value.creationPayload.content === 'string' ? value.creationPayload.content : undefined,
    },
  };
}

function ProposalList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-text-muted">暂无建议。</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] text-text-muted"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function SkillProposalCard({ artifact, proposal }: { artifact: RunArtifactRecord; proposal: SkillProposalPayload }) {
  const [skillName, setSkillName] = useState(proposal.creationPayload.name ?? '');
  const [description, setDescription] = useState(proposal.creationPayload.description ?? '');
  const [content, setContent] = useState(proposal.creationPayload.content ?? '');
  const [publishedName, setPublishedName] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    setSkillName(proposal.creationPayload.name ?? '');
    setDescription(proposal.creationPayload.description ?? '');
    setContent(proposal.creationPayload.content ?? '');
    setPublishedName(null);
    setPublishError(null);
  }, [artifact.artifactId, proposal.creationPayload.content, proposal.creationPayload.description, proposal.creationPayload.name]);

  const publishMutation = useMutation({
    mutationFn: (payload: { name: string; description: string; content: string }) => createSkill(payload),
    onSuccess: (_result, variables) => {
      setPublishedName(variables.name);
      setPublishError(null);
    },
    onError: (error) => {
      setPublishError(error instanceof Error ? error.message : 'skill_publish_failed');
    },
  });

  const canPublish = skillName.trim() && description.trim() && content.trim();

  return (
    <div className="space-y-4">
      <div className="rounded-[22px] border border-accent/25 bg-[linear-gradient(145deg,rgba(107,138,254,0.18),rgba(22,26,44,0.96))] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.24)]">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-accent">
              <IconSparkles size={12} />
              Skill proposal
            </div>
            <h3 className="text-base font-semibold text-text">{proposal.title ?? '建议沉淀为新技能'}</h3>
            {proposal.rationale ? <p className="text-sm leading-6 text-text-muted">{proposal.rationale}</p> : null}
          </div>
          <div className="text-right text-[11px] text-text-muted">
            <div>{proposal.taskKind ?? artifact.kind}</div>
            <time>{new Date(artifact.createdAt).toLocaleString()}</time>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <section className="rounded-2xl border border-border bg-surface p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">触发提示</h4>
          <ProposalList items={proposal.triggerHints ?? []} />
        </section>
        <section className="rounded-2xl border border-border bg-surface p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">工作流</h4>
          <ProposalList items={proposal.workflow ?? []} />
        </section>
        <section className="rounded-2xl border border-border bg-surface p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">证据</h4>
          <ProposalList items={proposal.evidence ?? []} />
        </section>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-text">发布配置</h4>
            <p className="text-xs text-text-muted">审阅名称、描述与内容后，再将提案发布到技能仓库。</p>
          </div>
          {proposal.publishHint ? (
            <span className="rounded-full border border-border-subtle bg-surface-card px-2.5 py-1 text-[11px] text-text-muted">
              {proposal.publishHint}
            </span>
          ) : null}
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-text-muted">
            <span className="mb-1.5 block">Skill name</span>
            <input
              aria-label="Skill name"
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-text outline-none transition focus:border-accent/50"
            />
          </label>

          <label className="block text-xs font-medium text-text-muted">
            <span className="mb-1.5 block">Skill description</span>
            <input
              aria-label="Skill description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-xl border border-border bg-surface-card px-3 py-2 text-sm text-text outline-none transition focus:border-accent/50"
            />
          </label>

          <label className="block text-xs font-medium text-text-muted">
            <span className="mb-1.5 block">Skill content</span>
            <textarea
              aria-label="Skill content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={10}
              className="w-full rounded-[18px] border border-border bg-surface-card px-3 py-2 font-mono text-xs leading-6 text-text outline-none transition focus:border-accent/50"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="space-y-1 text-xs">
            {publishedName ? (
              <p className="inline-flex items-center gap-1.5 text-success">
                <IconCheck size={14} />
                已发布为 {publishedName}
              </p>
            ) : null}
            {publishError ? <p className="text-danger">{publishError}</p> : null}
          </div>

          <button
            type="button"
            onClick={() => publishMutation.mutate({ name: skillName.trim(), description: description.trim(), content: content.trim() })}
            disabled={!canPublish || publishMutation.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishMutation.isPending ? <IconLoader2 size={15} className="animate-spin" /> : <IconSparkles size={15} />}
            发布技能
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Risk-report artifact rendering ──────────────────────────────────────────

interface ReportContent {
  reportId?: string;
  sessionId?: string;
  businessName?: string;
  locale?: string;
  overallScore?: number;
  coverageMatrix?: Record<string, unknown>;
}

function readReportContent(value: unknown): ReportContent | null {
  if (!isRecord(value)) return null;
  const hasReportFields =
    'businessName' in value || 'overallScore' in value || 'coverageMatrix' in value;
  if (!hasReportFields) return null;
  return {
    reportId: typeof value.reportId === 'string' ? value.reportId : undefined,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
    businessName: typeof value.businessName === 'string' ? value.businessName : undefined,
    locale: typeof value.locale === 'string' ? value.locale : undefined,
    overallScore: typeof value.overallScore === 'number' ? value.overallScore : undefined,
    coverageMatrix: normalizeCoverageMatrix(value.coverageMatrix),
  };
}

const DIM_CN: Record<string, string> = {
  'risk-rules': '风险规则',
  'business-profile': '业务画像',
  'external-market': '外部市场',
  'regulatory-compliance': '合规要求',
  'operational-risk': '运营风险',
  'credit-risk': '信用风险',
  'fraud-risk': '欺诈风险',
  'market-risk': '市场风险',
  'liquidity-risk': '流动性风险',
};

/** Normalize coverageMatrix: supports both Record<string,…> and Array<{scenarioName,…}> */
function normalizeCoverageMatrix(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const result: Record<string, unknown> = {};
    for (const entry of value) {
      if (isRecord(entry)) {
        const key =
          typeof entry.scenarioName === 'string'
            ? entry.scenarioName
            : String(Object.keys(result).length);
        result[key] = entry;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  if (isRecord(value)) return value as Record<string, unknown>;
  return undefined;
}

function scoreColorClass(score: number) {
  if (score >= 80) return { text: 'text-success', border: 'border-success/25', bg: 'bg-success/6' };
  if (score >= 60) return { text: 'text-warning', border: 'border-warning/25', bg: 'bg-warning/6' };
  return { text: 'text-danger', border: 'border-danger/25', bg: 'bg-danger/6' };
}

function DimensionCard({ dimKey, dimData }: { dimKey: string; dimData: unknown }) {
  // dimKey may be an English code (from Record) or a scenario name (from normalized array)
  const label = DIM_CN[dimKey] ?? dimKey;
  // Support both `score` (generic) and `coveragePercent` (scenario matrix)
  const score =
    isRecord(dimData) && typeof dimData.coveragePercent === 'number'
      ? dimData.coveragePercent
      : isRecord(dimData) && typeof dimData.score === 'number'
        ? dimData.score
        : undefined;
  const missing =
    isRecord(dimData) && Array.isArray(dimData.missingRuleTypes)
      ? (dimData.missingRuleTypes as string[]).filter(Boolean)
      : [];
  const cls = score !== undefined ? scoreColorClass(score) : null;

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        cls ? `${cls.border} ${cls.bg}` : 'border-border/40 bg-surface-card/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-text-muted">{label}</span>
        {score !== undefined && (
          <span className={`shrink-0 text-[12px] font-bold tabular-nums ${cls!.text}`}>
            {score}%
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <p className="mt-0.5 truncate text-[10px] leading-4 text-danger/70">
          缺: {missing.join(', ')}
        </p>
      )}
    </div>
  );
}

function ReportArtifactCard({
  artifact,
  content,
}: {
  artifact: RunArtifactRecord;
  content: ReportContent;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const dims = content.coverageMatrix ? Object.entries(content.coverageMatrix) : [];
  const cls = content.overallScore !== undefined ? scoreColorClass(content.overallScore) : null;

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div
        className={`rounded-[22px] border p-4 ${
          cls ? `${cls.border} ${cls.bg}` : 'border-border bg-surface-card'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-accent">
              <IconShieldCheck size={10} />
              风控分析报告
            </div>
            <h3 className="text-[14px] font-semibold leading-snug text-text">
              {content.businessName ?? '分析报告'}
            </h3>
            {content.reportId && (
              <p className="mt-1 font-mono text-[10px] text-text-subtle/40">
                {content.reportId.slice(0, 12)}…
              </p>
            )}
          </div>
          {content.overallScore !== undefined && (
            <div className="shrink-0 text-center">
              <div
                className={`text-[32px] font-bold leading-none tabular-nums ${cls!.text}`}
              >
                {content.overallScore}
              </div>
              <div className="mt-0.5 text-[10px] text-text-subtle">综合得分</div>
            </div>
          )}
        </div>
      </div>

      {/* Coverage matrix */}
      {dims.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-card/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-text-subtle">
            <IconListCheck size={11} />
            覆盖维度
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {dims.map(([key, data]) => (
              <DimensionCard key={key} dimKey={key} dimData={data} />
            ))}
          </div>
        </div>
      )}

      {/* Footer: timestamp + raw JSON toggle */}
      <div className="flex items-center justify-between gap-2">
        <time className="text-[11px] text-text-subtle/50">
          {new Date(artifact.createdAt).toLocaleString()}
        </time>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-text-subtle/60 transition-colors hover:text-text-muted"
        >
          <IconCode size={11} />
          {showRaw ? '收起 JSON' : '查看原始 JSON'}
        </button>
      </div>

      {showRaw && (
        <pre className="max-h-64 overflow-y-auto rounded-2xl border border-border bg-surface px-3 py-3 text-[11px] leading-6 text-text-muted">
          {JSON.stringify(artifact.contentJson, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ArtifactPanel({ artifacts, runStatus }: { artifacts: RunArtifactRecord[]; runStatus?: string }) {
  // Sort: report kind first, then by time desc, then version desc
  const sorted = useMemo(() => sortArtifacts(artifacts), [artifacts]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when artifacts change (new run)
  const sortedIds = sorted.map((a) => a.artifactId).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const artifact = useMemo(() => sorted[Math.min(selectedIndex, sorted.length - 1)], [sorted, selectedIndex, sortedIds]);

  const proposal = useMemo(() => readSkillProposal(artifact?.contentJson), [artifact?.contentJson]);
  const report = useMemo(
    () =>
      artifact && !proposal ? readReportContent(artifact.contentJson) : null,
    [artifact, proposal],
  );

  if (!artifact) {
    return (
      <div className="rounded-[24px] border border-border bg-surface-card/88 p-4 text-sm text-text-muted shadow-[0_12px_24px_rgba(0,0,0,0.12)]">
        尚无产物，当前 run 生成结果后会在这里出现。
      </div>
    );
  }

  const hasMultiple = sorted.length > 1;
  const kindIcon =
    artifact.kind === 'markdown' ? (
      <IconFile size={14} />
    ) : artifact.kind === 'report' ? (
      <IconShieldCheck size={14} className="text-accent" />
    ) : (
      <IconCode size={14} />
    );

  return (
    <div className="rounded-[26px] border border-border bg-surface-card/92 p-4 shadow-[0_16px_34px_rgba(0,0,0,0.14)]">
      {/* Header: artifact kind/version + multi-artifact nav */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-text">
          {kindIcon}
          {artifact.kind} v{artifact.version}
        </span>
        {hasMultiple ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={selectedIndex === 0}
              onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-border/50 text-text-subtle transition-colors hover:bg-surface-card hover:text-text disabled:opacity-30"
              title="上一个产物"
            >
              <IconChevronLeft size={12} />
            </button>
            <span className="min-w-[36px] text-center text-[11px] text-text-subtle">
              {selectedIndex + 1} / {sorted.length}
            </span>
            <button
              type="button"
              disabled={selectedIndex >= sorted.length - 1}
              onClick={() => setSelectedIndex((i) => Math.min(sorted.length - 1, i + 1))}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-border/50 text-text-subtle transition-colors hover:bg-surface-card hover:text-text disabled:opacity-30"
              title="下一个产物"
            >
              <IconChevronRight size={12} />
            </button>
          </div>
        ) : (
          <time className="text-xs text-text-muted">
            {new Date(artifact.createdAt).toLocaleString()}
          </time>
        )}
      </div>
      {proposal ? (
        <SkillProposalCard artifact={artifact} proposal={proposal} />
      ) : report ? (
        <ReportArtifactCard artifact={artifact} content={report} />
      ) : artifact.kind === 'structured-answer' && artifact.contentJson ? (
        <StructuredAnswerSurface content={artifact.contentJson} identityKey={artifact.artifactId} runStatus={runStatus} />
      ) : artifact.kind === 'markdown' && artifact.contentText ? (
        <div className="whitespace-pre-wrap rounded-[22px] border border-border bg-surface px-4 py-4 text-sm leading-7 text-text">
          {artifact.contentText}
        </div>
      ) : (
        <pre className="overflow-x-auto rounded-[22px] border border-border bg-surface px-3 py-3 text-xs leading-6 text-text-muted">
          {JSON.stringify(artifact.contentJson ?? {}, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Latest artifact first.
 *  When timestamps are equal, prefer higher-signal kinds before raw JSON. */
function artifactPriority(artifact: RunArtifactRecord): number {
  if (readSkillProposal(artifact.contentJson)) return 2;

  switch (artifact.kind) {
    case 'report': return 0;
    case 'structured-answer': return 1;
    case 'markdown': return 3;
    case 'json': return 4; // includes skill-proposal
    default: return 5;
  }
}

function sortArtifacts(artifacts: RunArtifactRecord[]): RunArtifactRecord[] {
  return [...artifacts].sort((a, b) => {
    const kindDiff = artifactPriority(a) - artifactPriority(b);
    if (kindDiff !== 0) return kindDiff;
    const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    return b.version - a.version;
  });
}



