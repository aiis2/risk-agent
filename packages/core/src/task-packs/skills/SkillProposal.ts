import type { TaskKind } from '../../harness/types.js';

export interface SkillProposalSeed {
  sourceRunId: string;
  taskKind: TaskKind;
  title: string;
  objective: string;
  rationale: string;
  triggerHints: string[];
  workflow: string[];
  evidence: string[];
}

export interface SkillProposalArtifact {
  type: 'skill-proposal';
  sourceRunId: string;
  taskKind: TaskKind;
  title: string;
  rationale: string;
  triggerHints: string[];
  workflow: string[];
  evidence: string[];
  recommendedTaskKind: 'skill-management';
  publishHint: string;
  creationPayload: {
    name: string;
    description: string;
    content: string;
  };
}

export function buildSkillProposal(seed: SkillProposalSeed): SkillProposalArtifact {
  const title = seed.title.trim() || `${seed.taskKind} workflow`;
  const triggerHints = dedupe(seed.triggerHints).slice(0, 5);
  const workflow = dedupe(seed.workflow).slice(0, 6);
  const evidence = dedupe(seed.evidence).slice(0, 5);
  const name = buildSkillName(seed.taskKind, title, seed.sourceRunId);
  const description = `${title} 可复用技能草案`;

  return {
    type: 'skill-proposal',
    sourceRunId: seed.sourceRunId,
    taskKind: seed.taskKind,
    title,
    rationale: seed.rationale,
    triggerHints,
    workflow,
    evidence,
    recommendedTaskKind: 'skill-management',
    publishHint: 'Review creationPayload, then POST it to /api/skills or pass it through the skill-management flow for approval.',
    creationPayload: {
      name,
      description,
      content: buildSkillContent({
        title,
        objective: seed.objective,
        triggerHints,
        workflow,
        evidence,
      }),
    },
  };
}

function buildSkillName(taskKind: TaskKind, title: string, sourceRunId: string): string {
  const asciiTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = sourceRunId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(-6) || 'draft';
  const base = asciiTitle || 'workflow';
  return `${taskKind}-${base}-${suffix}`;
}

function buildSkillContent(input: {
  title: string;
  objective: string;
  triggerHints: string[];
  workflow: string[];
  evidence: string[];
}): string {
  const triggerSection = input.triggerHints.length > 0
    ? input.triggerHints.map((hint) => `- ${hint}`).join('\n')
    : '- Trigger when the workflow closely matches this source run.';
  const workflowSection = input.workflow.length > 0
    ? input.workflow.map((step, index) => `${index + 1}. ${step}`).join('\n')
    : '1. Execute the workflow and produce a stable structured output.';
  const evidenceSection = input.evidence.length > 0
    ? input.evidence.map((item) => `- ${item}`).join('\n')
    : '- No additional evidence was captured from the source run.';

  return [
    `# ${input.title}`,
    '',
    '## Goal',
    input.objective,
    '',
    '## Trigger Hints',
    triggerSection,
    '',
    '## Workflow',
    workflowSection,
    '',
    '## Evidence',
    evidenceSection,
  ].join('\n');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}