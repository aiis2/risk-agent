import type { TaskPack, TaskPackContext, RunEvent, RunArtifact, VerificationRecord } from '../../harness/types.js';
import type { CapabilityAcquisitionPlan, CapabilitySourceCandidate } from '../../capabilities/types.js';
import {
  buildCapabilityTemplateBundle,
  type CapabilityTemplateBundle,
  type CapabilityTemplateId,
} from '../../capabilities/ConnectorTemplateCatalog.js';
import { SkillLoader, type Skill as SkillDefinition } from '../../skills/resolver/SkillLoader.js';

type SkillAction = 'list' | 'inspect' | 'test' | 'acquire' | 'debug';
type ManagedCapabilityKind = 'skill' | 'mcp-server' | 'connector';

interface MCPServerSummary {
  serverId: string;
  name: string;
  url: string;
  transport: string;
  description?: string;
  enabled: boolean;
  healthStatus?: string;
  healthError?: string | null;
  lastCheckAt?: string | null;
  toolCount?: number;
}

interface MCPServerCatalog {
  listServers(): Promise<MCPServerSummary[]>;
}

interface SkillSummary {
  name: string;
  description: string;
  source: string;
  path?: string;
}

interface SkillManagementPlan {
  prompt: string;
  capabilityKind: ManagedCapabilityKind;
  action: SkillAction;
  targetSkill?: string;
  targetServer?: string;
  targetTemplateId?: CapabilityTemplateId;
  targetCapabilityName?: string;
  requiresConfirmation: boolean;
  candidateSkills: SkillSummary[];
  candidateServers: MCPServerSummary[];
  toolIds: string[];
  discoveryEnabled: boolean;
  confirmationEnabled: boolean;
}

interface SkillApproval {
  approved: boolean;
  input?: string;
}

interface SkillManagementResult {
  capabilityKind: ManagedCapabilityKind;
  action: SkillAction;
  prompt: string;
  targetSkill?: string;
  targetServer?: string;
  targetTemplateId?: CapabilityTemplateId;
  targetCapabilityName?: string;
  capabilityPlan?: CapabilityAcquisitionPlan;
  templateBundle?: CapabilityTemplateBundle;
  approval?: SkillApproval;
  restrictions?: string[];
  skills?: SkillSummary[];
  servers?: MCPServerSummary[];
  skill?: SkillSummary & { tree?: Array<{ path: string; type: 'file' | 'directory' }> };
  server?: MCPServerSummary;
  testResult?: { success: boolean; output?: string; error?: string };
}

type SkillManagementTaskPackOptions = ConstructorParameters<typeof SkillLoader>[0] & {
  mcpCatalog?: MCPServerCatalog;
};

export class SkillManagementTaskPack implements TaskPack<Record<string, unknown>, SkillManagementPlan, SkillManagementResult> {
  readonly kind = 'skill-management' as const;
  readonly contractVersion = 'skill-management.phase2';
  readonly inputSchema = {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      attachmentContext: { type: 'string' },
      toolIds: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };

  private readonly loader: SkillLoader;
  private readonly mcpCatalog?: MCPServerCatalog;

  constructor(options: SkillManagementTaskPackOptions = {}) {
    const { mcpCatalog, ...loaderOptions } = options;
    this.loader = new SkillLoader(loaderOptions);
    this.mcpCatalog = mcpCatalog;
  }

  async intake(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const prompt = normalizePrompt(input.prompt);
    const attachmentContext = normalizePrompt(input.attachmentContext);
    const toolIds = normalizeStringArray(input.toolIds);
    const discoveryEnabled = isCapabilityEnabled(toolIds, 'tool_search');
    const confirmationEnabled = isCapabilityEnabled(toolIds, 'ask_user');
    const rankingPrompt = [prompt, attachmentContext].filter(Boolean).join('\n');
    const [skills, servers] = await Promise.all([
      this.loader.list(),
      this.mcpCatalog ? this.mcpCatalog.listServers() : Promise.resolve([]),
    ]);
    const rankedSkills = discoveryEnabled ? rankSkills(skills, rankingPrompt) : [];
    const rankedServers = discoveryEnabled ? rankServers(servers, rankingPrompt) : [];
    const targetSkill = resolveRequestedSkill(skills, rankingPrompt, rankedSkills);
    const targetServer = resolveRequestedServer(servers, rankingPrompt, rankedServers);
    const targetTemplateId = resolveRequestedTemplateId(rankingPrompt);
    const targetCapabilityName = targetTemplateId ? resolveRequestedCapabilityName(rankingPrompt) : undefined;
    const capabilityKind = inferCapabilityKind(rankingPrompt, Boolean(targetServer), Boolean(targetTemplateId));
    const action = inferAction(
      rankingPrompt,
      capabilityKind,
      capabilityKind === 'mcp-server'
        ? Boolean(targetServer)
        : capabilityKind === 'connector'
          ? Boolean(targetTemplateId)
          : Boolean(targetSkill),
    );
    const candidateSkills = capabilityKind === 'skill'
      ? discoveryEnabled
        ? rankedSkills.slice(0, 8).map(toSkillSummary)
        : targetSkill
          ? skills.filter((skill) => skill.name === targetSkill).map(toSkillSummary)
          : []
      : [];
    const candidateServers = capabilityKind === 'mcp-server'
      ? discoveryEnabled
        ? rankedServers.slice(0, 8)
        : targetServer
          ? servers.filter((server) => server.name === targetServer)
          : []
      : [];

    return {
      prompt,
      capabilityKind,
      action,
      targetSkill,
      targetServer,
      targetTemplateId,
      targetCapabilityName,
      requiresConfirmation: capabilityKind === 'skill' && action === 'test',
      candidateSkills,
      candidateServers,
      toolIds,
      discoveryEnabled,
      confirmationEnabled,
    };
  }

  async plan(input: Record<string, unknown>): Promise<SkillManagementPlan> {
    const capabilityKind = normalizeCapabilityKind(input.capabilityKind);
    const targetSkill = normalizeOptionalString(input.targetSkill);
    const targetServer = normalizeOptionalString(input.targetServer);
    const targetTemplateId = normalizeTemplateId(input.targetTemplateId);
    const targetCapabilityName = normalizeOptionalString(input.targetCapabilityName);
    const action = normalizeAction(
      input.action,
      normalizePrompt(input.prompt),
      capabilityKind,
      capabilityKind === 'mcp-server'
        ? Boolean(targetServer)
        : capabilityKind === 'connector'
          ? Boolean(targetTemplateId)
          : Boolean(targetSkill),
    );

    return {
      prompt: normalizePrompt(input.prompt),
      capabilityKind,
      action,
      targetSkill,
      targetServer,
      targetTemplateId,
      targetCapabilityName,
      requiresConfirmation: capabilityKind === 'skill' && action === 'test',
      candidateSkills: Array.isArray(input.candidateSkills) ? input.candidateSkills as SkillSummary[] : [],
      candidateServers: Array.isArray(input.candidateServers) ? input.candidateServers as MCPServerSummary[] : [],
      toolIds: normalizeStringArray(input.toolIds),
      discoveryEnabled: typeof input.discoveryEnabled === 'boolean' ? input.discoveryEnabled : true,
      confirmationEnabled: typeof input.confirmationEnabled === 'boolean' ? input.confirmationEnabled : true,
    };
  }

  async *execute(plan: SkillManagementPlan, ctx: TaskPackContext): AsyncGenerator<RunEvent, SkillManagementResult> {
    await ctx.emit({
      type: 'skill_management_started',
      payload: {
        capabilityKind: plan.capabilityKind,
        action: plan.action,
        targetSkill: plan.targetSkill ?? null,
        targetServer: plan.targetServer ?? null,
        toolIds: plan.toolIds,
        syntheticMetrics: resolveStartSyntheticMetrics(plan),
      },
    });

    if (plan.action === 'list') {
      return await (plan.capabilityKind === 'mcp-server'
        ? this.listServers(plan, ctx)
        : this.listSkills(plan, ctx));
    }

    if (plan.action === 'acquire') {
      return await (plan.capabilityKind === 'mcp-server'
        ? this.acquireServer(plan, ctx)
        : plan.capabilityKind === 'connector'
          ? this.acquireConnector(plan, ctx)
          : this.acquireSkill(plan, ctx));
    }

    if (plan.action === 'debug') {
      return await this.debugServer(plan, ctx);
    }

    if (
      (plan.capabilityKind === 'skill' && !plan.targetSkill)
      || (plan.capabilityKind === 'mcp-server' && !plan.targetServer)
      || (plan.capabilityKind === 'connector' && !plan.targetTemplateId)
    ) {
      const result: SkillManagementResult = {
        capabilityKind: plan.capabilityKind,
        action: plan.action,
        prompt: plan.prompt,
        skills: plan.candidateSkills,
        servers: plan.candidateServers,
      };

      await ctx.createSemanticCheckpoint('capability-target-missing', {
        capabilityKind: plan.capabilityKind,
        action: plan.action,
        candidateCount: plan.candidateSkills.length,
        candidateServerCount: plan.candidateServers.length,
        discoveryEnabled: plan.discoveryEnabled,
      });

      await ctx.emit({
        type: 'skill_management_completed',
        payload: {
          capabilityKind: plan.capabilityKind,
          action: plan.action,
          success: false,
          error: plan.capabilityKind === 'mcp-server'
            ? 'target_server_missing'
            : plan.capabilityKind === 'connector'
              ? 'target_template_missing'
              : 'target_skill_missing',
          syntheticMetrics: {
            turnCount: 1,
          },
        },
      });

      return result;
    }

    if (plan.action === 'inspect') {
      return await (plan.capabilityKind === 'mcp-server'
        ? this.inspectServer(plan, ctx)
        : this.inspectSkill(plan, ctx));
    }

    return await this.testSkill(plan, ctx);
  }

  async verify(result: SkillManagementResult, ctx: TaskPackContext): Promise<VerificationRecord> {
    let decision: VerificationRecord['decision'] = 'warn';
    let reasons: string[] = [];

    if (result.action === 'list') {
      if (result.capabilityKind === 'mcp-server') {
        decision = (result.servers?.length ?? 0) > 0 ? 'pass' : 'warn';
        reasons = [(result.servers?.length ?? 0) > 0 ? `mcp_servers_listed:${result.servers?.length ?? 0}` : 'no_mcp_servers_available'];
      } else {
        decision = (result.skills?.length ?? 0) > 0 ? 'pass' : 'warn';
        reasons = [(result.skills?.length ?? 0) > 0 ? `skills_listed:${result.skills?.length ?? 0}` : 'no_skills_available'];
      }
    } else if (result.action === 'acquire' && result.capabilityKind === 'connector') {
      decision = result.templateBundle ? 'pass' : 'warn';
      reasons = [result.templateBundle ? `connector_bundle_ready:${result.templateBundle.templateId}` : 'connector_bundle_missing'];
    } else if (result.action === 'acquire' || result.action === 'debug') {
      decision = result.capabilityPlan ? 'pass' : 'warn';
      reasons = [result.capabilityPlan ? `${result.capabilityKind}_plan_ready:${result.capabilityPlan.availability}` : `${result.capabilityKind}_plan_missing`];
    } else if (result.action === 'inspect') {
      if (result.capabilityKind === 'mcp-server') {
        decision = result.server ? 'pass' : 'warn';
        reasons = [result.server ? 'mcp_server_details_loaded' : 'mcp_server_not_found'];
      } else {
        decision = result.skill ? 'pass' : 'warn';
        reasons = [result.skill ? 'skill_details_loaded' : 'skill_not_found'];
      }
    } else if (!result.approval?.approved) {
      decision = 'warn';
      reasons = ['approval_denied'];
    } else if (result.testResult?.success) {
      decision = 'pass';
      reasons = ['skill_test_succeeded'];
    } else {
      decision = 'fail';
      reasons = [result.testResult?.error ? `skill_test_failed:${result.testResult.error}` : 'skill_test_failed'];
    }

    return {
      verificationId: `ver_${ctx.run.runId}`,
      runId: ctx.run.runId,
      verifierType: 'contract',
      contractVersion: this.contractVersion,
      decision,
      reasons,
      followUpAction: decision === 'fail' ? 'fail_run' : 'none',
      createdAt: ctx.now(),
    };
  }

  async projectResult(result: SkillManagementResult, ctx: TaskPackContext): Promise<RunArtifact[]> {
    return [
      await ctx.publishArtifact({
        kind: 'structured-answer',
        mimeType: 'application/json',
        contentJson: result as unknown as Record<string, unknown>,
      }),
    ];
  }

  private async listSkills(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const skills = plan.candidateSkills.length > 0
      ? plan.candidateSkills
      : (await this.loader.list()).map(toSkillSummary);
    const result: SkillManagementResult = {
      capabilityKind: 'skill',
      action: 'list',
      prompt: plan.prompt,
      restrictions: plan.discoveryEnabled ? [] : ['tool_search_not_enabled'],
      skills,
    };

    await ctx.createSemanticCheckpoint('skill-catalogued', {
      action: 'list',
      totalSkills: skills.length,
      discoveryEnabled: plan.discoveryEnabled,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'skill',
        action: 'list',
        totalSkills: skills.length,
        success: true,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async listServers(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const servers = plan.candidateServers.length > 0
      ? plan.candidateServers
      : this.mcpCatalog
        ? await this.mcpCatalog.listServers()
        : [];
    const result: SkillManagementResult = {
      capabilityKind: 'mcp-server',
      action: 'list',
      prompt: plan.prompt,
      restrictions: plan.discoveryEnabled ? [] : ['tool_search_not_enabled'],
      servers,
    };

    await ctx.createSemanticCheckpoint('mcp-catalogued', {
      action: 'list',
      totalServers: servers.length,
      discoveryEnabled: plan.discoveryEnabled,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'mcp-server',
        action: 'list',
        totalServers: servers.length,
        success: true,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async acquireSkill(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const installedSkill = plan.targetSkill ? await this.loader.getSkill(plan.targetSkill) : undefined;
    const capabilityPlan = buildSkillAcquisitionPlan(plan, installedSkill, plan.candidateSkills);
    const result: SkillManagementResult = {
      capabilityKind: 'skill',
      action: 'acquire',
      prompt: plan.prompt,
      targetSkill: plan.targetSkill,
      restrictions: capabilityPlan.steps.some((step) => step.status === 'blocked') ? ['tool_search_not_enabled'] : [],
      capabilityPlan,
    };

    await ctx.createSemanticCheckpoint('skill-acquisition-planned', {
      action: 'acquire',
      targetSkill: plan.targetSkill,
      availability: capabilityPlan.availability,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'skill',
        action: 'acquire',
        targetSkill: plan.targetSkill,
        success: true,
        availability: capabilityPlan.availability,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async acquireServer(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const installedServer = await this.getServerByName(plan.targetServer);
    const capabilityPlan = buildMcpCapabilityPlan(plan, installedServer, plan.candidateServers, 'acquire');
    const result: SkillManagementResult = {
      capabilityKind: 'mcp-server',
      action: 'acquire',
      prompt: plan.prompt,
      targetServer: plan.targetServer,
      server: installedServer,
      restrictions: capabilityPlan.steps.some((step) => step.status === 'blocked') ? ['tool_search_not_enabled'] : [],
      capabilityPlan,
    };

    await ctx.createSemanticCheckpoint('mcp-acquisition-planned', {
      action: 'acquire',
      targetServer: plan.targetServer,
      availability: capabilityPlan.availability,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'mcp-server',
        action: 'acquire',
        targetServer: plan.targetServer,
        success: true,
        availability: capabilityPlan.availability,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async acquireConnector(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const targetTemplateId = plan.targetTemplateId!;
    const targetCapabilityName = plan.targetCapabilityName ?? 'generated-capability';
    const templateBundle = buildCapabilityTemplateBundle({
      templateId: targetTemplateId,
      capabilityName: targetCapabilityName,
    });
    const result: SkillManagementResult = {
      capabilityKind: 'connector',
      action: 'acquire',
      prompt: plan.prompt,
      targetTemplateId,
      targetCapabilityName: templateBundle.capabilityName,
      templateBundle,
    };

    await ctx.createSemanticCheckpoint('connector-template-generated', {
      action: 'acquire',
      targetTemplateId,
      capabilityName: templateBundle.capabilityName,
      fileCount: templateBundle.files.length,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'connector',
        action: 'acquire',
        targetTemplateId,
        capabilityName: templateBundle.capabilityName,
        success: true,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async debugServer(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const installedServer = await this.getServerByName(plan.targetServer);
    const capabilityPlan = buildMcpCapabilityPlan(plan, installedServer, plan.candidateServers, 'debug');
    const result: SkillManagementResult = {
      capabilityKind: 'mcp-server',
      action: 'debug',
      prompt: plan.prompt,
      targetServer: plan.targetServer,
      server: installedServer,
      restrictions: capabilityPlan.steps.some((step) => step.status === 'blocked') ? ['tool_search_not_enabled'] : [],
      capabilityPlan,
    };

    await ctx.createSemanticCheckpoint('mcp-debug-planned', {
      action: 'debug',
      targetServer: plan.targetServer,
      availability: capabilityPlan.availability,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'mcp-server',
        action: 'debug',
        targetServer: plan.targetServer,
        success: true,
        availability: capabilityPlan.availability,
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async inspectSkill(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const targetSkill = plan.targetSkill!;
    const skill = await this.loader.getSkill(targetSkill);
    const tree = skill ? await this.loader.getSkillTree(targetSkill) : null;
    const result: SkillManagementResult = {
      capabilityKind: 'skill',
      action: 'inspect',
      prompt: plan.prompt,
      targetSkill,
      skill: skill
        ? {
            ...toSkillSummary(skill),
            tree: tree ?? undefined,
          }
        : undefined,
    };

    await ctx.createSemanticCheckpoint('skill-inspected', {
      action: 'inspect',
      targetSkill,
      found: Boolean(skill),
      discoveryEnabled: plan.discoveryEnabled,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'skill',
        action: 'inspect',
        targetSkill,
        found: Boolean(skill),
        success: Boolean(skill),
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async inspectServer(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    const server = await this.getServerByName(plan.targetServer);
    const result: SkillManagementResult = {
      capabilityKind: 'mcp-server',
      action: 'inspect',
      prompt: plan.prompt,
      targetServer: plan.targetServer,
      server,
    };

    await ctx.createSemanticCheckpoint('mcp-inspected', {
      action: 'inspect',
      targetServer: plan.targetServer,
      found: Boolean(server),
      discoveryEnabled: plan.discoveryEnabled,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'mcp-server',
        action: 'inspect',
        targetServer: plan.targetServer,
        found: Boolean(server),
        success: Boolean(server),
        syntheticMetrics: {
          turnCount: 1,
        },
      },
    });

    return result;
  }

  private async testSkill(plan: SkillManagementPlan, ctx: TaskPackContext): Promise<SkillManagementResult> {
    if (!plan.confirmationEnabled) {
      const blocked: SkillManagementResult = {
        capabilityKind: 'skill',
        action: 'test',
        prompt: plan.prompt,
        targetSkill: plan.targetSkill,
        restrictions: ['ask_user_not_enabled'],
        testResult: {
          success: false,
          error: 'tool_selection_blocks_confirmation',
        },
      };

      await ctx.createSemanticCheckpoint('skill-test-blocked', {
        action: 'test',
        targetSkill: plan.targetSkill,
        reason: 'ask_user_not_enabled',
      });

      await ctx.emit({
        type: 'skill_management_completed',
        payload: {
          capabilityKind: 'skill',
          action: 'test',
          targetSkill: plan.targetSkill,
          success: false,
          error: 'tool_selection_blocks_confirmation',
          syntheticMetrics: {
            turnCount: 1,
            toolCallCount: 0,
          },
        },
      });

      return blocked;
    }

    const approvalPayload = await ctx.requestUserInput({
      question: `确认执行技能 dry-run：${plan.targetSkill}？`,
      options: ['确认', '取消'],
      checkpoint: {
        action: 'test',
        targetSkill: plan.targetSkill,
      },
    });
    const approval = normalizeApproval(approvalPayload);

    if (!approval.approved) {
      const denied: SkillManagementResult = {
        capabilityKind: 'skill',
        action: 'test',
        prompt: plan.prompt,
        targetSkill: plan.targetSkill,
        approval,
        testResult: {
          success: false,
          error: 'approval_denied',
        },
      };

      await ctx.createSemanticCheckpoint('skill-test-denied', {
        action: 'test',
        targetSkill: plan.targetSkill,
      });

      await ctx.emit({
        type: 'skill_management_completed',
        payload: {
          capabilityKind: 'skill',
          action: 'test',
          targetSkill: plan.targetSkill,
          success: false,
          error: 'approval_denied',
          syntheticMetrics: {
            turnCount: 1,
            toolCallCount: 0,
          },
        },
      });

      return denied;
    }

    const testResult = await this.loader.testSkill(plan.targetSkill!);
    const result: SkillManagementResult = {
      capabilityKind: 'skill',
      action: 'test',
      prompt: plan.prompt,
      targetSkill: plan.targetSkill,
      approval,
      testResult,
    };

    await ctx.createSemanticCheckpoint('skill-test-complete', {
      action: 'test',
      targetSkill: plan.targetSkill,
      success: testResult.success,
    });

    await ctx.emit({
      type: 'skill_management_completed',
      payload: {
        capabilityKind: 'skill',
        action: 'test',
        targetSkill: plan.targetSkill,
        success: testResult.success,
        syntheticMetrics: {
          turnCount: 1,
          toolCallCount: 1,
        },
      },
    });

    return result;
  }

  private async getServerByName(serverName: string | undefined): Promise<MCPServerSummary | undefined> {
    if (!this.mcpCatalog || !serverName) {
      return undefined;
    }
    const servers = await this.mcpCatalog.listServers();
    return servers.find((server) => server.name === serverName);
  }
}

function normalizePrompt(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizePrompt(value);
  return normalized || undefined;
}

function normalizeCapabilityKind(value: unknown): ManagedCapabilityKind {
  if (value === 'mcp-server' || value === 'connector') {
    return value;
  }
  return 'skill';
}

function normalizeTemplateId(value: unknown): CapabilityTemplateId | undefined {
  return isCapabilityTemplateId(value) ? value : undefined;
}

function normalizeAction(value: unknown, prompt: string, capabilityKind: ManagedCapabilityKind, hasTarget: boolean): SkillAction {
  if (value === 'list' || value === 'inspect' || value === 'test' || value === 'acquire' || value === 'debug') {
    return value;
  }
  return inferAction(prompt, capabilityKind, hasTarget);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizePrompt(entry))
    .filter(Boolean);
}

function isCapabilityEnabled(toolIds: string[], capability: 'tool_search' | 'ask_user'): boolean {
  return toolIds.length === 0 || toolIds.includes(capability);
}

function resolveStartSyntheticMetrics(plan: SkillManagementPlan): { turnCount?: number; toolCallCount: number } {
  if (plan.action === 'list' || plan.action === 'acquire') {
    return {
      toolCallCount: plan.discoveryEnabled ? 1 : 0,
    };
  }

  if (plan.action === 'debug' || plan.action === 'inspect') {
    return {
      toolCallCount: 1,
    };
  }

  return {
    turnCount: plan.confirmationEnabled ? 1 : undefined,
    toolCallCount: 0,
  };
}

function inferAction(prompt: string, capabilityKind: ManagedCapabilityKind, hasTarget: boolean): SkillAction {
  if (capabilityKind === 'mcp-server') {
    if (/(调试|debug|排查|诊断|修复|health|刷新工具|refresh)/i.test(prompt)) return 'debug';
    if (/(安装|install|添加|接入|获取|enable|acquire|connect)/i.test(prompt)) return 'acquire';
    if (/(详情|说明|介绍|查看|inspect|tree|file)/i.test(prompt)) return 'inspect';
    if (/(列出|有哪些|列表|list|全部|所有)/i.test(prompt)) return 'list';
    return hasTarget ? 'inspect' : 'list';
  }

  if (capabilityKind === 'connector') {
    if (/(生成|create|generate|骨架|模板|skeleton|template|scaffold|接入|connect)/i.test(prompt)) return 'acquire';
    if (/(列出|有哪些|列表|list|全部|所有)/i.test(prompt)) return 'list';
    return hasTarget ? 'acquire' : 'list';
  }

  if (/(安装|install|添加|接入|获取|enable|acquire)/i.test(prompt)) return 'acquire';
  if (/(测试|test|验证|dry[- ]?run)/i.test(prompt)) return 'test';
  if (/(详情|说明|介绍|查看|inspect|tree|file)/i.test(prompt)) return 'inspect';
  if (/(列出|有哪些|列表|list|全部技能|所有技能)/i.test(prompt)) return 'list';
  return hasTarget ? 'inspect' : 'list';
}

function inferCapabilityKind(prompt: string, hasTargetServer: boolean, hasTargetTemplate: boolean): ManagedCapabilityKind {
  if (hasTargetTemplate || isConnectorPrompt(prompt)) {
    return 'connector';
  }
  if (hasTargetServer || isMcpPrompt(prompt)) {
    return 'mcp-server';
  }
  return 'skill';
}

function toSkillSummary(skill: SkillDefinition): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    path: skill.path,
  };
}

function tokenizePrompt(prompt: string): string[] {
  return [...new Set(
    prompt
      .split(/[\s,，。；;、|/]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  )];
}

function rankSkills(skills: SkillDefinition[], prompt: string): SkillDefinition[] {
  const keywords = tokenizePrompt(prompt);
  if (keywords.length === 0) {
    return [...skills].sort((left, right) => left.name.localeCompare(right.name, 'en'));
  }

  return [...skills]
    .map((skill) => ({
      skill,
      score: scoreSkill(skill, keywords),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name, 'en'))
    .map((entry) => entry.skill);
}

function scoreSkill(skill: SkillDefinition, keywords: string[]): number {
  const haystack = `${skill.name}\n${skill.description}`.toLowerCase();
  let score = 0;
  keywords.forEach((keyword) => {
    const normalized = keyword.toLowerCase();
    if (!normalized) return;
    if (skill.name.toLowerCase() === normalized) {
      score += 4;
      return;
    }
    if (skill.name.toLowerCase().includes(normalized)) {
      score += 2;
      return;
    }
    if (haystack.includes(normalized)) {
      score += 1;
    }
  });
  return score;
}

function rankServers(servers: MCPServerSummary[], prompt: string): MCPServerSummary[] {
  const keywords = tokenizePrompt(prompt);
  if (keywords.length === 0) {
    return [...servers].sort((left, right) => left.name.localeCompare(right.name, 'en'));
  }

  return [...servers]
    .map((server) => ({
      server,
      score: scoreServer(server, keywords),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.server.name.localeCompare(right.server.name, 'en'))
    .map((entry) => entry.server);
}

function scoreServer(server: MCPServerSummary, keywords: string[]): number {
  const haystack = `${server.name}\n${server.description ?? ''}\n${server.url}`.toLowerCase();
  let score = 0;
  keywords.forEach((keyword) => {
    const normalized = keyword.toLowerCase();
    if (!normalized) return;
    if (server.name.toLowerCase() === normalized) {
      score += 4;
      return;
    }
    if (server.name.toLowerCase().includes(normalized)) {
      score += 2;
      return;
    }
    if (haystack.includes(normalized)) {
      score += 1;
    }
  });
  return score;
}

function resolveTargetSkill(skills: SkillDefinition[], prompt: string, ranked: SkillDefinition[]): string | undefined {
  const loweredPrompt = prompt.toLowerCase();
  const exact = skills.find((skill) => loweredPrompt.includes(skill.name.toLowerCase()));
  if (exact) return exact.name;
  return ranked[0]?.name;
}

function resolveTargetServer(servers: MCPServerSummary[], prompt: string, ranked: MCPServerSummary[]): string | undefined {
  const loweredPrompt = prompt.toLowerCase();
  const exact = servers.find((server) => loweredPrompt.includes(server.name.toLowerCase()));
  if (exact) return exact.name;
  return ranked[0]?.name;
}

function resolveRequestedSkill(skills: SkillDefinition[], prompt: string, ranked: SkillDefinition[]): string | undefined {
  const resolved = resolveTargetSkill(skills, prompt, ranked);
  if (resolved) return resolved;
  return extractRequestedSkillName(prompt);
}

function resolveRequestedServer(servers: MCPServerSummary[], prompt: string, ranked: MCPServerSummary[]): string | undefined {
  const resolved = resolveTargetServer(servers, prompt, ranked);
  if (resolved) return resolved;
  return extractRequestedServerName(prompt);
}

function extractRequestedSkillName(prompt: string): string | undefined {
  const matched = prompt.match(/(?:安装|install|添加|接入|获取|enable|acquire)\s*["“”']?([a-z0-9][a-z0-9_-]{1,63})["“”']?\s*(?:技能|skill)?/iu);
  if (!matched?.[1]) {
    return undefined;
  }
  return matched[1].trim();
}

function extractRequestedServerName(prompt: string): string | undefined {
  const matched = prompt.match(/(?:调试|debug|排查|修复|接入|安装|添加|connect|acquire)\s*["“”']?([a-z0-9][a-z0-9_-]{1,63})["“”']?\s*(?:mcp(?:\s*(?:服务|服务器|server))?)/iu);
  if (!matched?.[1]) {
    return undefined;
  }
  return matched[1].trim();
}

function resolveRequestedTemplateId(prompt: string): CapabilityTemplateId | undefined {
  const loweredPrompt = prompt.toLowerCase();
  if (/(discord)/iu.test(loweredPrompt)) return 'discord-bot';
  if (/(dingtalk|钉钉)/iu.test(prompt)) return 'dingtalk-bot';
  if (/(feishu|飞书)/iu.test(prompt)) return 'feishu-bot';
  if (/(generic\s*webhook|webhook|connector)/iu.test(loweredPrompt)) return 'generic-webhook';
  return undefined;
}

function resolveRequestedCapabilityName(prompt: string): string {
  const matched = prompt.match(/(?:名为|叫做|叫|named|called)\s*["“”']?([a-z0-9][a-z0-9_-]{1,63})["“”']?/iu);
  if (matched?.[1]) {
    return matched[1].trim();
  }
  return 'generated-capability';
}

function isMcpPrompt(prompt: string): boolean {
  return /(mcp|model context protocol|mcp\s*(?:服务|服务器|server))/iu.test(prompt);
}

function isConnectorPrompt(prompt: string): boolean {
  return /((feishu|飞书|dingtalk|钉钉|discord|webhook|connector|机器人|bot).*(骨架|模板|skeleton|template|scaffold|生成|create|generate))|((骨架|模板|skeleton|template|scaffold|生成|create|generate).*(feishu|飞书|dingtalk|钉钉|discord|webhook|connector|机器人|bot))/iu.test(prompt);
}

function isCapabilityTemplateId(value: unknown): value is CapabilityTemplateId {
  return value === 'feishu-bot'
    || value === 'dingtalk-bot'
    || value === 'discord-bot'
    || value === 'generic-webhook'
    || value === 'mcp-server';
}

function buildSkillAcquisitionPlan(
  plan: SkillManagementPlan,
  installedSkill: SkillDefinition | null | undefined,
  candidateSkills: SkillSummary[],
): CapabilityAcquisitionPlan {
  const availability = installedSkill ? 'available' : 'missing';
  const candidates = installedSkill
    ? [toInstalledCapabilityCandidate(installedSkill)]
    : candidateSkills.map(toCandidateSource);
  const discoveryBlocked = !plan.discoveryEnabled && !installedSkill;

  return {
    capabilityKind: 'skill',
    capabilityName: plan.targetSkill ?? 'unknown-skill',
    intent: 'acquire',
    availability,
    candidates,
    requiredCapabilities: availability === 'missing' ? ['tool_search'] : [],
    steps: [
      {
        kind: 'discover',
        status: installedSkill ? 'pending' : discoveryBlocked ? 'blocked' : 'ready',
        ...(discoveryBlocked ? { reason: 'tool_search_not_enabled' } : {}),
      },
      {
        kind: 'fetch',
        status: availability === 'available' ? 'pending' : discoveryBlocked ? 'blocked' : 'pending',
        ...(discoveryBlocked ? { reason: 'waiting_for_discovery_source' } : {}),
      },
      { kind: 'security-scan', status: 'pending' },
      { kind: 'dry-run', status: 'pending' },
      { kind: 'install', status: 'pending' },
      { kind: 'verify', status: 'pending' },
    ],
    recommendedNextAction: availability === 'available'
      ? 'verify'
      : discoveryBlocked
        ? 'none'
        : 'discover',
  };
}

function buildMcpCapabilityPlan(
  plan: SkillManagementPlan,
  installedServer: MCPServerSummary | undefined,
  candidateServers: MCPServerSummary[],
  intent: 'acquire' | 'debug',
): CapabilityAcquisitionPlan {
  const availability = installedServer ? 'available' : 'missing';
  const candidates = installedServer
    ? [toInstalledServerCandidate(installedServer)]
    : candidateServers.map(toServerCandidateSource);
  const discoveryBlocked = !plan.discoveryEnabled && !installedServer;
  const serverBlockedReason = availability === 'missing' ? 'server_not_configured' : undefined;

  if (intent === 'debug') {
    return {
      capabilityKind: 'mcp-server',
      capabilityName: plan.targetServer ?? 'unknown-mcp-server',
      intent,
      availability,
      candidates,
      requiredCapabilities: availability === 'missing' ? ['tool_search'] : [],
      steps: [
        {
          kind: 'discover',
          status: installedServer ? 'pending' : discoveryBlocked ? 'blocked' : 'ready',
          ...(discoveryBlocked ? { reason: 'tool_search_not_enabled' } : {}),
        },
        {
          kind: 'health-check',
          status: installedServer ? 'ready' : 'blocked',
          ...(serverBlockedReason ? { reason: serverBlockedReason } : {}),
        },
        {
          kind: 'refresh-tools',
          status: installedServer ? 'ready' : 'blocked',
          ...(serverBlockedReason ? { reason: serverBlockedReason } : {}),
        },
        { kind: 'verify', status: 'pending' },
      ],
      recommendedNextAction: installedServer ? 'verify' : discoveryBlocked ? 'none' : 'discover',
    };
  }

  return {
    capabilityKind: 'mcp-server',
    capabilityName: plan.targetServer ?? 'unknown-mcp-server',
    intent,
    availability,
    candidates,
    requiredCapabilities: availability === 'missing' ? ['tool_search'] : [],
    steps: [
      {
        kind: 'discover',
        status: installedServer ? 'pending' : discoveryBlocked ? 'blocked' : 'ready',
        ...(discoveryBlocked ? { reason: 'tool_search_not_enabled' } : {}),
      },
      {
        kind: 'fetch',
        status: availability === 'available' ? 'pending' : discoveryBlocked ? 'blocked' : 'pending',
        ...(discoveryBlocked ? { reason: 'waiting_for_server_source' } : {}),
      },
      { kind: 'dry-run', status: availability === 'available' ? 'ready' : 'pending' },
      { kind: 'install', status: 'pending' },
      { kind: 'verify', status: 'pending' },
    ],
    recommendedNextAction: availability === 'available'
      ? 'verify'
      : discoveryBlocked
        ? 'none'
        : 'discover',
  };
}

function toInstalledCapabilityCandidate(skill: SkillDefinition): CapabilitySourceCandidate {
  return {
    kind: skill.source === 'directory' ? 'directory' : 'installed',
    identifier: skill.name,
    label: skill.name,
    trust: 'trusted',
    installed: true,
  };
}

function toCandidateSource(skill: SkillSummary): CapabilitySourceCandidate {
  return {
    kind: skill.source === 'directory' ? 'directory' : 'catalog',
    identifier: skill.name,
    label: skill.name,
    trust: skill.source === 'bundled' ? 'trusted' : 'review',
    installed: false,
  };
}

function toInstalledServerCandidate(server: MCPServerSummary): CapabilitySourceCandidate {
  return {
    kind: 'installed',
    identifier: server.serverId,
    label: server.name,
    trust: 'trusted',
    installed: true,
  };
}

function toServerCandidateSource(server: MCPServerSummary): CapabilitySourceCandidate {
  return {
    kind: 'catalog',
    identifier: server.serverId,
    label: server.name,
    trust: server.enabled ? 'review' : 'untrusted',
    installed: false,
  };
}

function normalizeApproval(payload: Record<string, unknown>): SkillApproval {
  if (typeof payload.approved === 'boolean') {
    return {
      approved: payload.approved,
      input: normalizeOptionalString(payload.input),
    };
  }

  const input = normalizeOptionalString(payload.input);
  return {
    approved: input ? /^(确认|同意|yes|y|approve|ok)$/i.test(input) : false,
    input,
  };
}