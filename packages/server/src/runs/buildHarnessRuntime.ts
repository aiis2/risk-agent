import {
  TaskPackRegistry,
  RunStateMachine,
  RunRouter,
  HarnessRuntime,
  CapabilityAdapterRegistry,
  AnalysisTaskPack,
  createAnalysisCapabilityAdapter,
  createGeneralCapabilityAdapter,
  createKnowledgeQueryCapabilityAdapter,
  createSkillManagementCapabilityAdapter,
  DynamicCapabilityOrchestrator,
  GeneralTaskPack,
  KnowledgeQueryTaskPack,
  SkillManagementTaskPack,
  createJsSandboxHost,
  createLocalProcessSandboxHost,
  QueryEngine,
  PromptAssembler,
  SandboxRuntime,
  SecurityAuditService,
  SkillLoader,
  CostTracker,
  PersonaService,
  UserProfileService,
  type StorageBackendRegistry,
  type Persona,
  type UserProfile,
} from '@risk-agent/core';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfiguredLLMRuntime } from '../llm/factory.js';
import { buildSessionToolRegistry } from '../agents/SessionRunner.js';
import type { BrowserHostAdapter } from '../browser/BrowserHostAdapter.js';
import type { BrowserWorkspaceService } from '../browser/BrowserWorkspaceService.js';
import { loadRuntimePreferences } from '../preferences/runtimePreferences.js';

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

type MCPServerCatalogRecord = {
  server_id: string;
  name: string;
  url: string;
  transport: string;
  description: string | null;
  enabled: number | boolean;
  health_status: string | null;
  health_error: string | null;
  last_check_at: string | null;
  tool_count: number | null;
};

type TranscriptMessage = { role: 'user' | 'assistant'; content: string };

export interface BuildHarnessRuntimeOptions {
  browserWorkspaces?: BrowserWorkspaceService;
  browserHostAdapter?: BrowserHostAdapter | null;
}

function normalizeTranscriptText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function latestGuidanceMessage(runInput: Record<string, unknown> | undefined): string | undefined {
  const turnEnvelope = asRecord(runInput?.turnEnvelope);
  const followUpMessage = normalizeTranscriptText(turnEnvelope?.userMessage);
  if (followUpMessage) {
    return followUpMessage;
  }

  const guidanceMessages = Array.isArray(runInput?.guidanceMessages)
    ? runInput.guidanceMessages.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
    : [];
  return guidanceMessages.at(-1);
}

function buildMemoryLikeTerms(prompt: string): string[] {
  const normalized = prompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ');
  const terms = new Set<string>();

  normalized
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (/[a-zA-Z0-9]/.test(part) && part.length >= 2) {
        terms.add(part.toLowerCase());
      }

      const chineseSegments = part.match(/[\u4e00-\u9fff]+/gu) ?? [];
      chineseSegments.forEach((segment) => {
        if (segment.length >= 2 && segment.length <= 6) {
          terms.add(segment);
        }
        for (const size of [2, 3]) {
          for (let index = 0; index <= segment.length - size; index += 1) {
            terms.add(segment.slice(index, index + size));
          }
        }
      });
    });

  return Array.from(terms)
    .filter((term) => term.length >= 2)
    .sort((left, right) => right.length - left.length)
    .slice(0, 8);
}

function dedupeMemorySnippets(rows: Array<{ content: string }>): string[] {
  return Array.from(new Set(rows.map((row) => row.content.trim()).filter(Boolean))).slice(0, 6);
}

const USER_PREFERENCE_MEMORY_PROMPT_PATTERN = /偏好|简洁|简短|详细|格式|格式化|语气|风格|输出|回复|只返回|一句话|列表|markdown|语言/i;

function buildMemoryFtsQuerySafe(prompt: string): string {
  return prompt
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 5)
    .join(' OR ');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function dropLatestGuidanceDuplicate(messages: TranscriptMessage[], latestGuidance?: string): TranscriptMessage[] {
  if (!latestGuidance || messages.length === 0) {
    return messages;
  }

  const deduped = [...messages];
  const last = deduped.at(-1);
  if (last?.role === 'user' && last.content === latestGuidance) {
    deduped.pop();
  }
  return deduped;
}

function extractStructuredAnswerText(contentJson: string | null, contentText: string | null): string | undefined {
  const directText = normalizeTranscriptText(contentText);
  if (directText) return directText;
  if (!contentJson) return undefined;

  try {
    const parsed = JSON.parse(contentJson) as Record<string, unknown>;
    return normalizeTranscriptText(parsed.response)
      ?? normalizeTranscriptText(parsed.summary)
      ?? normalizeTranscriptText(parsed.text);
  } catch {
    return undefined;
  }
}

async function loadLegacyRecentTranscript(
  store: ReturnType<StorageBackendRegistry['getStructuredStore']>,
  sessionId: string,
  latestGuidance?: string,
): Promise<TranscriptMessage[]> {
  try {
    const rows = await store.all<{ event_type: string; payload: string }>(
      `SELECT event_type, payload FROM stream_events
       WHERE session_id=? AND event_type IN ('text_chunk','user_message')
       ORDER BY rowid DESC LIMIT 80`,
      [sessionId],
    );
    const msgs: TranscriptMessage[] = [];
    for (const row of rows.reverse()) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        if (row.event_type === 'user_message') {
          const content = normalizeTranscriptText(payload.content);
          if (content) msgs.push({ role: 'user', content });
        } else if (row.event_type === 'text_chunk') {
          const text = normalizeTranscriptText(payload.text);
          if (text) msgs.push({ role: 'assistant', content: text });
        }
      } catch {
        // skip malformed rows
      }
    }
    return dropLatestGuidanceDuplicate(msgs, latestGuidance).slice(-12);
  } catch {
    return [];
  }
}

async function loadRunRecentTranscript(
  store: ReturnType<StorageBackendRegistry['getStructuredStore']>,
  run: { runId: string; createdAt: string; input: Record<string, unknown> },
): Promise<TranscriptMessage[]> {
  try {
    const prompt = normalizeTranscriptText(run.input.prompt);
    const latestGuidance = latestGuidanceMessage(run.input);
    const turns: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string; order: number }> = [];
    const runRow = await store.get<{ created_at: string }>(
      `SELECT created_at FROM runs WHERE run_id=? LIMIT 1`,
      [run.runId],
    );
    const rootCreatedAt = runRow?.created_at ?? run.createdAt;

    if (prompt) {
      turns.push({ role: 'user', content: prompt, createdAt: rootCreatedAt, order: 0 });
    }

    const [eventRows, artifactRows] = await Promise.all([
      store.all<{ payload_json: string; created_at: string }>(
        `SELECT payload_json, created_at FROM run_events
         WHERE run_id=? AND event_type='user_message'
         ORDER BY created_at ASC LIMIT 40`,
        [run.runId],
      ),
      store.all<{ content_json: string | null; content_text: string | null; created_at: string; version: number }>(
        `SELECT content_json, content_text, created_at, version FROM run_artifacts
         WHERE run_id=? AND artifact_kind='structured-answer'
         ORDER BY version ASC LIMIT 20`,
        [run.runId],
      ),
    ]);

    for (const [index, row] of eventRows.entries()) {
      try {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const content = normalizeTranscriptText(payload.content);
        if (content) {
          turns.push({ role: 'user', content, createdAt: row.created_at, order: 100 + index });
        }
      } catch {
        // skip malformed rows
      }
    }

    for (const [index, row] of artifactRows.entries()) {
      const content = extractStructuredAnswerText(row.content_json, row.content_text);
      if (content) {
        turns.push({ role: 'assistant', content, createdAt: row.created_at, order: 200 + index });
      }
    }

    turns.sort((left, right) => {
      const byTime = left.createdAt.localeCompare(right.createdAt);
      return byTime !== 0 ? byTime : left.order - right.order;
    });

    return dropLatestGuidanceDuplicate(
      turns.map(({ role, content }) => ({ role, content })),
      latestGuidance,
    ).slice(-12);
  } catch {
    return [];
  }
}

function createMcpCatalog(store: ReturnType<StorageBackendRegistry['getStructuredStore']>) {
  return {
    listServers: async () => {
      try {
        const rows = await store.all<MCPServerCatalogRecord>(
          `SELECT server_id, name, url, transport, description, enabled, health_status, health_error, last_check_at, tool_count
           FROM mcp_servers
           ORDER BY created_at DESC`,
        );

        return rows.map((row) => ({
          serverId: row.server_id,
          name: row.name,
          url: row.url,
          transport: row.transport,
          description: row.description ?? undefined,
          enabled: Boolean(row.enabled),
          healthStatus: row.health_status ?? 'unknown',
          healthError: row.health_error,
          lastCheckAt: row.last_check_at,
          toolCount: row.tool_count ?? 0,
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Build a fully-wired HarnessRuntime for the run-first execution path.
 * Resolves the LLM runtime, creates task-pack instances, and returns
 * a ready-to-execute HarnessRuntime.
 */
export async function buildHarnessRuntime(
  storage: StorageBackendRegistry,
  modelId?: string,
  surface?: string,
  options: BuildHarnessRuntimeOptions = {},
): Promise<HarnessRuntime> {
  const store = storage.getStructuredStore();
  const llmRuntime = await buildConfiguredLLMRuntime(store, modelId);
  const runtimePreferences = await loadRuntimePreferences(store);
  const sandboxRuntime = new SandboxRuntime([createJsSandboxHost(), createLocalProcessSandboxHost()]);
  const sandboxEntrypoint = surface === 'terminal-cli'
    ? 'terminal-cli'
    : surface === 'background'
      ? 'background'
      : 'web-cli';
  const securityAudit = new SecurityAuditService({
    exec: (sql: string) => store.exec(sql),
    run: (sql: string, params: unknown[]) => store.run(sql, params),
    all: <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params ?? []),
  });

  const { registry: toolRegistry, mcpServers } = await buildSessionToolRegistry(storage, {
    browserWorkspaces: options.browserWorkspaces,
    browserHostAdapter: options.browserHostAdapter ?? null,
  });
  const queryEngine = new QueryEngine(
    llmRuntime.adapter,
    new PromptAssembler(),
    toolRegistry,
    new CostTracker(),
    {
      sessionId: `run-bootstrap-${modelId ?? 'default'}`,
      model: llmRuntime.model,
      maxSteps: runtimePreferences.maxTurns,
      mcpServers,
      temperature: llmRuntime.settings.temperature,
      maxTokens: llmRuntime.settings.maxTokens,
      compactThresholdTokens: runtimePreferences.compactThresholdTokens,
      sandboxRuntime,
      sandboxEntrypoint,
      sandboxWorkspaceRoots: [WORKSPACE_ROOT],
      sandboxAuditLogger: securityAudit,
      cwd: WORKSPACE_ROOT,
    },
  );

  const registry = new TaskPackRegistry();
  registry.register(new AnalysisTaskPack({ storage, queryEngine }));

  // A1+A6：Persona/UserProfile 服务（适配 IStructuredStore → DbAdapter）
  const dbAdapter = {
    run: async (sql: string, params?: unknown[]) => {
      await store.run(sql, params);
    },
    all: async <T = unknown>(sql: string, params?: unknown[]) => store.all<T>(sql, params),
  };
  const personaService = new PersonaService(dbAdapter);
  const userProfileService = new UserProfileService(dbAdapter);
  await personaService.ensureBuiltins().catch(() => undefined);

  registry.register(
    new GeneralTaskPack({
      llmAdapter: llmRuntime.adapter,
      model: llmRuntime.model,
      resolvePersona: async (ctx): Promise<Persona | undefined> => {
        const sessionId = (ctx.run.input as Record<string, unknown> | undefined)?.sessionId as string | undefined
          ?? (ctx.run.routing?.routeParams as Record<string, unknown> | undefined)?.sessionId as string | undefined;
        const routerHint = ctx.run.routing?.recommendedPersonaScope;
        try {
          const { persona } = await personaService.resolveForRun({
            sessionId,
            taskKind: ctx.run.taskKind,
            routerHintScope: routerHint,
          });
          return persona;
        } catch {
          return undefined;
        }
      },
      resolveUserProfile: async (): Promise<UserProfile | undefined> => {
        try {
          return await userProfileService.getOrCreate();
        } catch {
          return undefined;
        }
      },
      // A3: memory snippets — FTS5 全文搜索 memory_facts
      resolveMemorySnippets: async (_ctx, prompt: string): Promise<string[]> => {
        try {
          if (!prompt || prompt.length < 3) return [];
          const keywords = buildMemoryFtsQuerySafe(prompt);
          let snippets: string[] = [];

          if (keywords) {
            const rows = await store.all<{ content: string }>(
              `SELECT mf.content FROM memory_facts_fts fts
               JOIN memory_facts mf ON mf.rowid = fts.rowid
               WHERE memory_facts_fts MATCH ?
               ORDER BY rank
               LIMIT 6`,
              [keywords],
            );
            snippets = dedupeMemorySnippets(rows);
          }

          if (snippets.length === 0) {
            const likeTerms = buildMemoryLikeTerms(prompt);
            if (likeTerms.length > 0) {
              const whereClause = likeTerms.map(() => 'content LIKE ?').join(' OR ');
              const rows = await store.all<{ content: string }>(
                `SELECT content FROM memory_facts
                 WHERE ${whereClause}
                 ORDER BY CASE category WHEN 'user_preference' THEN 0 ELSE 1 END,
                          use_count DESC,
                          confidence DESC,
                          created_at DESC
                 LIMIT 6`,
                likeTerms.map((term) => `%${term}%`),
              );
              snippets = dedupeMemorySnippets(rows);
            }
          }

          if (snippets.length === 0 && USER_PREFERENCE_MEMORY_PROMPT_PATTERN.test(prompt)) {
            const rows = await store.all<{ content: string }>(
              `SELECT content FROM memory_facts
               WHERE category='user_preference'
               ORDER BY use_count DESC, confidence DESC, created_at DESC
               LIMIT 3`,
            );
            snippets = dedupeMemorySnippets(rows);
          }

          return snippets;
        } catch {
          return [];
        }
      },
      // A3: recent transcript — 从 stream_events 加载最近几轮消息
      resolveRecentTranscript: async (ctx): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> => {
        const runInput = (ctx.run.input as Record<string, unknown> | undefined) ?? {};
        const sessionId = runInput.sessionId as string | undefined;
        const latestGuidance = latestGuidanceMessage(runInput);

        if (sessionId) {
          return loadLegacyRecentTranscript(store, sessionId, latestGuidance);
        }

        return loadRunRecentTranscript(store, {
          runId: ctx.run.runId,
          createdAt: ctx.run.createdAt,
          input: runInput,
        });
      },
      // Tool-assisted ReAct path: create a fresh QueryEngine per run with only the
      // requested tools visible, enabling Playwright MCP and other tool-use tasks.
      createQueryEngine: ({ runId, toolIds }) => new QueryEngine(
        llmRuntime.adapter,
        new PromptAssembler(),
        toolRegistry,
        new CostTracker(),
        {
          sessionId: runId,
          model: llmRuntime.model,
          maxSteps: runtimePreferences.maxTurns,
          mcpServers,
          allowedToolNames: toolIds.length > 0 ? toolIds : undefined,
          temperature: llmRuntime.settings.temperature,
          maxTokens: llmRuntime.settings.maxTokens,
          compactThresholdTokens: runtimePreferences.compactThresholdTokens,
          sandboxRuntime,
          sandboxEntrypoint,
          sandboxWorkspaceRoots: [WORKSPACE_ROOT],
          sandboxAuditLogger: securityAudit,
          cwd: WORKSPACE_ROOT,
        },
      ),
    }),
  );
  registry.register(new KnowledgeQueryTaskPack({ storage }));
  registry.register(new SkillManagementTaskPack({
    bundledDir: join(WORKSPACE_ROOT, '.agents', 'skills'),
    userSkillDir: join(storage.paths.dataRoot, 'skills'),
    projectSkillDir: SkillLoader.defaultProjectSkillDir(WORKSPACE_ROOT),
    mcpCatalog: createMcpCatalog(store),
  }));

  const adapters = new CapabilityAdapterRegistry();
  adapters.register(createGeneralCapabilityAdapter());
  adapters.register(createAnalysisCapabilityAdapter());
  adapters.register(createKnowledgeQueryCapabilityAdapter());
  adapters.register(createSkillManagementCapabilityAdapter());

  return new HarnessRuntime({
    registry,
    stateMachine: new RunStateMachine(),
    router: new RunRouter(),
    orchestrator: new DynamicCapabilityOrchestrator({
      llmAdapter: llmRuntime.adapter,
      model: llmRuntime.model,
      adapters,
      maxRounds: runtimePreferences.maxTurns,
    }),
  });
}