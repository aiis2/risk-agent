import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SkillLoader,
  createLogger,
  type RunArtifact,
  type RunSnapshot,
  type StorageBackendRegistry,
  type TaskKind,
  type VerificationRecord,
} from '@risk-agent/core';

const log = createLogger('SkillPatternLearner');
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROMOTION_THRESHOLD = 2;

interface SkillProposalArtifact {
  type: 'skill-proposal';
  sourceRunId?: string;
  taskKind: TaskKind;
  title: string;
  rationale?: string;
  triggerHints: string[];
  workflow: string[];
  evidence: string[];
  creationPayload: {
    name?: string;
    description?: string;
    content?: string;
  };
}

interface StoredPatternRow {
  pattern_key: string;
  task_kind: TaskKind;
  pattern_label: string;
  pattern_slug: string;
  proposal_json: string;
  occurrence_count: number;
  first_run_id: string;
  last_run_id: string;
  promoted_skill_name?: string | null;
}

interface PatternDescriptor {
  label: string;
  slug: string;
}

export interface LearnedSkillObservation {
  patternKey: string;
  patternLabel: string;
  occurrenceCount: number;
  promotedSkillName?: string;
  promotedNow: boolean;
}

export class SkillPatternLearner {
  private schemaReady = false;

  constructor(private readonly storage: StorageBackendRegistry) {}

  async observeSuccessfulRun(input: {
    snapshot: RunSnapshot;
    artifacts: RunArtifact[];
    verification?: VerificationRecord;
  }): Promise<LearnedSkillObservation[]> {
    if (input.snapshot.status !== 'completed') {
      return [];
    }

    if (input.verification?.decision === 'fail') {
      return [];
    }

    const proposals = input.artifacts
      .map((artifact) => readSkillProposal(artifact))
      .filter((proposal): proposal is SkillProposalArtifact => proposal !== null);

    if (proposals.length === 0) {
      return [];
    }

    await this.ensureSchema();
    const store = this.storage.getStructuredStore();
    const loader = new SkillLoader({
      bundledDir: join(WORKSPACE_ROOT, '.agents', 'skills'),
      userSkillDir: join(this.storage.paths.dataRoot, 'skills'),
      projectSkillDir: SkillLoader.defaultProjectSkillDir(WORKSPACE_ROOT),
    });
    const observations: LearnedSkillObservation[] = [];

    for (const proposal of proposals) {
      const descriptor = inferPatternDescriptor(proposal);
      const patternKey = buildPatternKey(proposal, descriptor);
      const existing = await store.get<StoredPatternRow>(
        `SELECT pattern_key, task_kind, pattern_label, pattern_slug, proposal_json, occurrence_count, first_run_id, last_run_id, promoted_skill_name
         FROM learned_skill_patterns WHERE pattern_key=? LIMIT 1`,
        [patternKey],
      );

      const mergedProposal = mergeProposals(existing?.proposal_json ? safeParseProposal(existing.proposal_json) : null, proposal, descriptor.label);
      const occurrenceCount = (existing?.occurrence_count ?? 0) + 1;
      let promotedSkillName = normalizeOptionalString(existing?.promoted_skill_name);
      let promotedNow = false;

      if (!promotedSkillName && occurrenceCount >= PROMOTION_THRESHOLD) {
        const learnedSkillName = buildLearnedSkillName(proposal.taskKind, descriptor.slug, patternKey);
        const existingSkill = await loader.getSkill(learnedSkillName);
        if (existingSkill) {
          promotedSkillName = learnedSkillName;
        } else {
          const learnedContent = buildLearnedSkillContent({
            proposal: mergedProposal,
            descriptor,
            occurrenceCount,
          });
          await loader.createSkill(
            learnedSkillName,
            `${descriptor.label} 自动学习技能`,
            learnedContent,
          );
          promotedSkillName = learnedSkillName;
          promotedNow = true;
          log.info({ patternKey, learnedSkillName, occurrenceCount }, 'autonomous skill created from successful runs');
        }
      }

      const now = new Date().toISOString();
      if (!existing) {
        await store.run(
          `INSERT INTO learned_skill_patterns(
             pattern_key, task_kind, pattern_label, pattern_slug, proposal_json, occurrence_count, first_run_id, last_run_id, promoted_skill_name, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            patternKey,
            proposal.taskKind,
            descriptor.label,
            descriptor.slug,
            JSON.stringify(mergedProposal),
            occurrenceCount,
            input.snapshot.runId,
            input.snapshot.runId,
            promotedSkillName ?? null,
            now,
            now,
          ],
        );
      } else {
        await store.run(
          `UPDATE learned_skill_patterns
           SET pattern_label=?, pattern_slug=?, proposal_json=?, occurrence_count=?, last_run_id=?, promoted_skill_name=?, updated_at=?
           WHERE pattern_key=?`,
          [
            descriptor.label,
            descriptor.slug,
            JSON.stringify(mergedProposal),
            occurrenceCount,
            input.snapshot.runId,
            promotedSkillName ?? null,
            now,
            patternKey,
          ],
        );
      }

      observations.push({
        patternKey,
        patternLabel: descriptor.label,
        occurrenceCount,
        promotedSkillName,
        promotedNow,
      });
    }

    return observations;
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }

    await this.storage.getStructuredStore().run(
      `CREATE TABLE IF NOT EXISTS learned_skill_patterns (
         pattern_key TEXT PRIMARY KEY,
         task_kind TEXT NOT NULL,
         pattern_label TEXT NOT NULL,
         pattern_slug TEXT NOT NULL,
         proposal_json TEXT NOT NULL,
         occurrence_count INTEGER NOT NULL DEFAULT 0,
         first_run_id TEXT NOT NULL,
         last_run_id TEXT NOT NULL,
         promoted_skill_name TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    );

    this.schemaReady = true;
  }
}

function readSkillProposal(artifact: RunArtifact): SkillProposalArtifact | null {
  if (artifact.kind !== 'json' || !artifact.contentJson || typeof artifact.contentJson !== 'object') {
    return null;
  }

  const value = artifact.contentJson as Record<string, unknown>;
  if (value.type !== 'skill-proposal') {
    return null;
  }

  const taskKind = normalizeTaskKind(value.taskKind);
  const title = normalizeOptionalString(value.title);
  const creationPayload = value.creationPayload && typeof value.creationPayload === 'object'
    ? value.creationPayload as Record<string, unknown>
    : undefined;

  if (!taskKind || !title || !creationPayload) {
    return null;
  }

  return {
    type: 'skill-proposal',
    sourceRunId: normalizeOptionalString(value.sourceRunId),
    taskKind,
    title,
    rationale: normalizeOptionalString(value.rationale),
    triggerHints: normalizeStringArray(value.triggerHints),
    workflow: normalizeStringArray(value.workflow),
    evidence: normalizeStringArray(value.evidence),
    creationPayload: {
      name: normalizeOptionalString(creationPayload.name),
      description: normalizeOptionalString(creationPayload.description),
      content: normalizeOptionalString(creationPayload.content),
    },
  };
}

function safeParseProposal(raw: string): SkillProposalArtifact | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      type: 'skill-proposal',
      sourceRunId: normalizeOptionalString(parsed.sourceRunId),
      taskKind: normalizeTaskKind(parsed.taskKind) ?? 'general',
      title: normalizeOptionalString(parsed.title) ?? 'workflow',
      rationale: normalizeOptionalString(parsed.rationale),
      triggerHints: normalizeStringArray(parsed.triggerHints),
      workflow: normalizeStringArray(parsed.workflow),
      evidence: normalizeStringArray(parsed.evidence),
      creationPayload: parsed.creationPayload && typeof parsed.creationPayload === 'object'
        ? {
            name: normalizeOptionalString((parsed.creationPayload as Record<string, unknown>).name),
            description: normalizeOptionalString((parsed.creationPayload as Record<string, unknown>).description),
            content: normalizeOptionalString((parsed.creationPayload as Record<string, unknown>).content),
          }
        : {},
    };
  } catch {
    return null;
  }
}

function mergeProposals(existing: SkillProposalArtifact | null, next: SkillProposalArtifact, patternLabel: string): SkillProposalArtifact {
  return {
    ...next,
    title: patternLabel,
    rationale: existing?.rationale ?? next.rationale,
    triggerHints: dedupeStrings([...(existing?.triggerHints ?? []), ...next.triggerHints]).slice(0, 8),
    workflow: dedupeStrings([...(existing?.workflow ?? []), ...next.workflow]).slice(0, 8),
    evidence: dedupeStrings([...(existing?.evidence ?? []), ...next.evidence]).slice(0, 10),
    creationPayload: {
      ...next.creationPayload,
      name: existing?.creationPayload.name ?? next.creationPayload.name,
      description: next.creationPayload.description ?? existing?.creationPayload.description,
      content: next.creationPayload.content ?? existing?.creationPayload.content,
    },
  };
}

function inferPatternDescriptor(proposal: SkillProposalArtifact): PatternDescriptor {
  const corpus = [
    proposal.title,
    proposal.rationale,
    ...proposal.triggerHints,
    ...proposal.workflow,
    ...proposal.evidence,
  ].filter(Boolean).join(' ');

  if (proposal.taskKind === 'general' && isWebPriceCollectionPattern(corpus)) {
    return {
      label: '网页数据抓取并汇总',
      slug: 'web-data-collection-summary',
    };
  }

  if (proposal.taskKind === 'general' && /(附件|attachment|file|文档|资料|pdf|截图|image|screenshot)/i.test(corpus)) {
    return {
      label: '多源资料整理与摘要输出',
      slug: 'multi-source-briefing',
    };
  }

  const fallbackLabel = proposal.title.trim() || `${proposal.taskKind} workflow`;
  return {
    label: fallbackLabel,
    slug: slugify(fallbackLabel) || `${proposal.taskKind}-workflow`,
  };
}

function isWebPriceCollectionPattern(corpus: string): boolean {
  const normalized = corpus.toLowerCase();
  const hasPriceSignal = /(价格|报价|price|pricing|quote)/i.test(normalized);
  const hasWebSignal = /(网页|页面|网站|web|browser|抓取|采集|爬取|scrape|crawl|fetch|collect|web_fetch|web_search)/i.test(normalized);
  return hasPriceSignal && hasWebSignal;
}

function buildPatternKey(proposal: SkillProposalArtifact, descriptor: PatternDescriptor): string {
  const workflowSignature = proposal.workflow.map(normalizePatternText).join('|');
  const raw = [proposal.taskKind, descriptor.slug, workflowSignature].join('::');
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16);
  return `${proposal.taskKind}:${descriptor.slug}:${hash}`;
}

function normalizePatternText(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/run_[a-z0-9]+/g, '<run>')
    .replace(/[0-9]+/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLearnedSkillName(taskKind: TaskKind, slug: string, patternKey: string): string {
  const suffix = patternKey.split(':').at(-1)?.slice(-6) ?? 'learned';
  return `learned-${taskKind}-${slug}`.slice(0, 48).replace(/-+$/g, '') + `-${suffix}`;
}

function buildLearnedSkillContent(input: {
  proposal: SkillProposalArtifact;
  descriptor: PatternDescriptor;
  occurrenceCount: number;
}): string {
  const triggerSection = input.proposal.triggerHints.length > 0
    ? input.proposal.triggerHints.map((hint) => `- ${hint}`).join('\n')
    : '- Trigger when the workflow matches this learned pattern.';
  const workflowSection = input.proposal.workflow.length > 0
    ? input.proposal.workflow.map((step, index) => `${index + 1}. ${step}`).join('\n')
    : '1. Reproduce the learned workflow and return a structured result.';
  const evidenceSection = [
    `- Learned automatically after ${input.occurrenceCount} successful runs.`,
    ...input.proposal.evidence.map((item) => `- ${item}`),
  ].slice(0, 10).join('\n');

  return [
    `# ${input.descriptor.label}`,
    '',
    '## Goal',
    `Execute the learned workflow for ${input.descriptor.label} and produce a stable structured output.`,
    '',
    '## Trigger Hints',
    triggerSection,
    '',
    '## Procedure',
    workflowSection,
    '',
    '## Evidence',
    evidenceSection,
    '',
    '## Verification',
    '- Confirm the workflow completes successfully and produces a report or structured answer aligned with the requested scope.',
  ].join('\n');
}

function normalizeTaskKind(value: unknown): TaskKind | undefined {
  return value === 'analysis' || value === 'general' || value === 'knowledge-query' || value === 'skill-management'
    ? value
    : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}