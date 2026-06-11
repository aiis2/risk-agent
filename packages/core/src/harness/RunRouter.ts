import type { AgentMode, TaskKind, RoutingDecision } from './types.js';
const EXTERNAL_SKILLS_CLI_PATTERN = /((?:^|\s)(?:npx|pnpm|npm|yarn)\s+skills?\b)|(\bskills\s+add\b)|(\B--skill\b)/iu;

export class RunRouter {
  route(input: { requestedTaskKind?: TaskKind; input: Record<string, unknown> }): RoutingDecision {
    const agentMode = resolveAgentMode(input.input.surface);

    if (input.requestedTaskKind) {
      return {
        agentMode,
        requestedTaskKind: input.requestedTaskKind,
        acceptedTaskKind: input.requestedTaskKind,
        initialCapabilityProfile: input.requestedTaskKind,
        confidence: 1,
        reason: 'explicit_task_kind',
        routeParams: buildRouteParams(input.requestedTaskKind, input.input),
        recommendedPersonaScope: TASK_KIND_TO_PERSONA_SCOPE[input.requestedTaskKind] ?? 'general',
      };
    }

    const combined = collectCombinedInputText(input.input);

    // External CLI skill installation (e.g. `npx skills add`) must run through the
    // general ReAct loop so shell_exec can be invoked.  Do NOT route to skill-management
    // which only returns a static acquisition plan without actually executing anything.
    if (EXTERNAL_SKILLS_CLI_PATTERN.test(combined)) {
      return buildAutoDecision(agentMode, 'general', 0.9, 'phase2_auto_external_skills_cli');
    }

    return buildAutoDecision(agentMode, 'general', 0.56, 'semantic_capability_entry');
  }
}

function buildAutoDecision(
  agentMode: AgentMode,
  acceptedTaskKind: TaskKind,
  confidence: number,
  reason: string,
  routeParams: Record<string, unknown> = {},
): RoutingDecision {
  const scope = TASK_KIND_TO_PERSONA_SCOPE[acceptedTaskKind] ?? 'general';
  return {
    agentMode,
    requestedTaskKind: undefined,
    acceptedTaskKind,
    initialCapabilityProfile: acceptedTaskKind,
    confidence,
    reason,
    routeParams,
    recommendedPersonaScope: scope,
  };
}

const TASK_KIND_TO_PERSONA_SCOPE: Record<TaskKind, RoutingDecision['recommendedPersonaScope']> = {
  analysis: 'analysis',
  'knowledge-query': 'knowledge-query',
  'skill-management': 'skill-management',
  general: 'general',
};

function buildRouteParams(acceptedTaskKind: TaskKind, input: Record<string, unknown>): Record<string, unknown> {
  if (acceptedTaskKind !== 'analysis') {
    return {};
  }

  const businessName = normalizeText(input.businessName);
  const prompt = normalizeText(input.prompt);
  if (businessName || !prompt) {
    return {};
  }

  return {
    businessName: prompt,
  };
}

function collectCombinedInputText(input: Record<string, unknown>): string {
  const prompt = normalizeText(input.prompt);
  const businessName = normalizeText(input.businessName);
  const attachmentContext = normalizeText(input.attachmentContext);
  const guidanceMessages = Array.isArray(input.guidanceMessages)
    ? input.guidanceMessages.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  return [prompt, businessName, attachmentContext, ...guidanceMessages]
    .filter(Boolean)
    .join('\n');
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveAgentMode(surface: unknown): AgentMode {
  const normalized = String(surface ?? '').trim().toLowerCase();
  if (normalized === 'web' || normalized === 'web-cli' || normalized === 'terminal-cli') {
    return 'hermes';
  }

  return 'task-pack';
}
