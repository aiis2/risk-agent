/**
 * CLI slash command registry — Hermes commands.py pattern.
 * Each CommandDef includes name, aliases, description, argsHint, category,
 * and a handler that receives (args: string, ctx: CliContext).
 */

import { styled, formatUserInput } from './cliAnsi';
import type { Terminal } from '@xterm/xterm';
import { listPersonas, applyPersonaToSession, getInsights, listSkills, getSkill, deleteSkill, testSkill, installSkillFromUrl, getKGOverview, searchKG, getKGNeighborhood, getKGImpact, getKGConflicts, createKGNode, createKGEdge, deleteKGNode, runKGBackfill } from '../api/client';
import type { KGNodeType, KGRelationType } from '../api/client';

// ── Context passed to every command handler ─────────────────────────────────
export interface CliContext {
  terminal: Terminal;
  currentRunId: string;
  /** 可选：当前 CLI 关联的会话 ID（A1：用于把 persona 绑定到 session） */
  currentSessionId?: string;
  busyMode: BusyMode;
  setBusyMode: (mode: BusyMode) => void;
  selectedRuntimeSurface: CliRuntimeSurface;
  setSelectedRuntimeSurface: (surface: CliRuntimeSurface) => void;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  selectedToolIds: string[];
  setSelectedToolIds: (ids: string[]) => void;
  launchBackgroundRun: (prompt: string) => Promise<string | undefined>;
  onNewSession: () => void;
  onClear: () => void;
  onResume: (runId: string) => void;
  onInterrupt: () => void | Promise<void>;
  enabledModels: Array<{ modelId: string; modelName: string; isDefault?: boolean }>;
  availableTools: Array<{ name: string; description?: string }>;
  recentRuns: Array<{ runId: string; title: string; status: string; updatedAt: string }>;
}

export type BusyMode = 'idle' | 'queue' | 'steer' | 'interrupt';
export type CliRuntimeSurface = 'web-cli' | 'terminal-cli' | 'background';

// ── CommandDef ───────────────────────────────────────────────────────────────
export interface CommandDef {
  name: string;
  aliases?: string[];
  description: string;
  argsHint?: string;
  category: 'session' | 'config' | 'mode' | 'info';
  handler: (args: string, ctx: CliContext) => void | Promise<void>;
}

// ── Helper: write a line to the terminal ────────────────────────────────────
function writeln(terminal: Terminal, text: string) {
  terminal.write(`${text}\r\n`);
}

// ── Command Registry ─────────────────────────────────────────────────────────
export const COMMANDS: CommandDef[] = [
  // ── info ──
  {
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show all available commands',
    category: 'info',
    handler: (_args, { terminal }) => {
      writeln(terminal, '');
      writeln(terminal, styled.accent('Available commands'));
      writeln(terminal, styled.separator());

      const byCategory: Record<string, CommandDef[]> = {};
      for (const cmd of COMMANDS) {
        (byCategory[cmd.category] ??= []).push(cmd);
      }

      const order: CommandDef['category'][] = ['session', 'mode', 'config', 'info'];
      const catLabel: Record<string, string> = {
        session: 'Session',
        mode: 'Busy Mode',
        config: 'Configuration',
        info: 'Info',
      };

      for (const cat of order) {
        const cmds = byCategory[cat];
        if (!cmds?.length) continue;
        writeln(terminal, styled.label(catLabel[cat]));
        for (const cmd of cmds) {
          const aliases = cmd.aliases ? styled.muted(` (${cmd.aliases.join(', ')})`) : '';
          const hint = cmd.argsHint ? ` ${styled.muted(cmd.argsHint)}` : '';
          const nameCol = `  /${cmd.name}${hint}`.padEnd(28);
          writeln(terminal, `${styled.tool(nameCol)}${styled.system(cmd.description)}${aliases}`);
        }
      }
      writeln(terminal, styled.separator());
      writeln(terminal, '');
    },
  },

  // ── session ──
  {
    name: 'new',
    aliases: ['n'],
    description: 'Start a new CLI session (clears current run)',
    category: 'session',
    handler: (_args, { terminal, onNewSession }) => {
      writeln(terminal, styled.system('Starting new session...'));
      onNewSession();
    },
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Clear terminal output',
    category: 'session',
    handler: (_args, { terminal, onClear }) => {
      terminal.clear();
      onClear();
    },
  },
  {
    name: 'history',
    aliases: ['hist', 'ls'],
    description: 'Show recent sessions',
    category: 'session',
    handler: (_args, { terminal, recentRuns }) => {
      writeln(terminal, '');
      if (recentRuns.length === 0) {
        writeln(terminal, styled.muted('No recent sessions.'));
        return;
      }
      writeln(terminal, styled.accent('Recent sessions'));
      writeln(terminal, styled.separator());
      recentRuns.slice(0, 10).forEach((run, i) => {
        const idx = String(i + 1).padStart(2, ' ');
        const status = run.status === 'completed'
          ? styled.success('done')
          : run.status === 'running'
            ? styled.warn('running')
            : run.status === 'failed'
              ? styled.error('failed')
              : styled.muted(run.status);
        const id = styled.muted(run.runId.slice(-8));
        writeln(terminal, `  ${styled.label(idx)}  ${id}  [${status}]  ${run.title}`);
      });
      writeln(terminal, styled.muted('  Use /resume <id-suffix> to resume a session.'));
      writeln(terminal, '');
    },
  },
  {
    name: 'resume',
    aliases: ['r'],
    description: 'Resume a previous session by ID suffix',
    argsHint: '<id-suffix>',
    category: 'session',
    handler: (args, { terminal, recentRuns, onResume }) => {
      const suffix = args.trim().toLowerCase();
      if (!suffix) {
        writeln(terminal, styled.warn('Usage: /resume <id-suffix>'));
        return;
      }
      const match = recentRuns.find((r) => r.runId.toLowerCase().endsWith(suffix));
      if (!match) {
        writeln(terminal, styled.error(`No session found matching: ${suffix}`));
        return;
      }
      writeln(terminal, styled.system(`Resuming session ${match.runId.slice(-8)}...`));
      onResume(match.runId);
    },
  },

  // ── busy modes ──
  {
    name: 'queue',
    description: 'Set busy mode: next message will be queued until run completes',
    category: 'mode',
    handler: (_args, { terminal, setBusyMode }) => {
      setBusyMode('queue');
      writeln(terminal, styled.accent('[mode] queue — messages will be enqueued'));
    },
  },
  {
    name: 'steer',
    description: 'Set busy mode: next message will redirect the running agent',
    category: 'mode',
    handler: (_args, { terminal, setBusyMode }) => {
      setBusyMode('steer');
      writeln(terminal, styled.accent('[mode] steer — messages will redirect the agent'));
    },
  },
  {
    name: 'interrupt',
    aliases: ['stop', 'cancel'],
    description: 'Cancel the current running session',
    category: 'mode',
    handler: (_args, { terminal, currentRunId, onInterrupt, setBusyMode }) => {
      if (!currentRunId) {
        setBusyMode('interrupt');
        writeln(terminal, styled.warn('[mode] interrupt — no active run to cancel yet'));
        return;
      }
      writeln(terminal, styled.warn('[interrupt] cancelling current run...'));
      void onInterrupt();
    },
  },

  // ── session extended ──
  {
    name: 'title',
    aliases: ['rename'],
    description: 'Set a display label for the current run',
    argsHint: '<title>',
    category: 'session',
    handler: (args, { terminal, currentRunId }) => {
      if (!args.trim()) {
        writeln(terminal, styled.warn('Usage: /title <run label>'));
        return;
      }
      if (!currentRunId) {
        writeln(terminal, styled.warn('No active run to label.'));
        return;
      }
      try {
        const labels = JSON.parse(localStorage.getItem('risk-agent.run-labels') ?? '{}');
        labels[currentRunId] = args.trim();
        localStorage.setItem('risk-agent.run-labels', JSON.stringify(labels));
        writeln(terminal, styled.success(`Run labelled: ${styled.accent(args.trim())}`));
      } catch {
        writeln(terminal, styled.warn(`Label stored in memory (localStorage unavailable): ${args.trim()}`));
      }
    },
  },
  {
    name: 'background',
    aliases: ['bg'],
    description: 'Run a prompt in a detached background session',
    argsHint: '<prompt>',
    category: 'session',
    handler: async (args, { terminal, launchBackgroundRun }) => {
      if (!args.trim()) {
        writeln(terminal, styled.warn('Usage: /background <prompt>'));
        return;
      }
      await launchBackgroundRun(args.trim());
    },
  },
  {
    name: 'compress',
    aliases: ['gc'],
    description: 'Compress / summarise the current session context',
    category: 'session',
    handler: (_args, { terminal, currentRunId }) => {
      if (!currentRunId) {
        writeln(terminal, styled.warn('No active session to compress.'));
        return;
      }
      writeln(terminal, styled.muted('Context compression is managed automatically by the server.'));
      writeln(terminal, styled.muted('Use /new to start a fresh session if context is too long.'));
    },
  },
  {
    name: 'verbose',
    aliases: ['v'],
    description: 'Toggle verbose tool output in the terminal',
    category: 'config',
    handler: (_args, { terminal }) => {
      const VERBOSE_KEY = 'risk-agent.cli.verbose';
      const current = localStorage.getItem(VERBOSE_KEY) === 'true';
      const next = !current;
      localStorage.setItem(VERBOSE_KEY, String(next));
      writeln(terminal, next
        ? styled.success('[verbose] ON — all tool events will stream to the transcript')
        : styled.muted('[verbose] OFF — tool events suppressed'));
    },
  },
  {
    name: 'usage',
    aliases: ['cost', 'tokens'],
    description: 'Show token/cost breakdown for the current run',
    category: 'info',
    handler: async (_args, { terminal, currentRunId, recentRuns }) => {
      if (!currentRunId) {
        writeln(terminal, styled.warn('No active run. Start a conversation first.'));
        return;
      }
      // 从最近 runs 缓存中找当前 run 指标
      const run = recentRuns.find((r) => r.runId === currentRunId);
      writeln(terminal, '');
      writeln(terminal, styled.accent('Session Usage'));
      writeln(terminal, styled.separator());
      if (!run) {
        writeln(terminal, styled.muted('  Loading metrics... Run may still be in progress.'));
        writeln(terminal, styled.muted(`  Run ID: ${currentRunId}`));
      } else {
        const m = run as any;
        writeln(terminal, `  ${styled.label('Status'.padEnd(20))} ${styled.system(run.status)}`);
        if (m.metrics) {
          writeln(terminal, `  ${styled.label('Cost (USD)'.padEnd(20))} ${styled.tool(`$${(m.metrics.estimatedUsd ?? 0).toFixed(6)}`)}`);
          writeln(terminal, `  ${styled.label('Input tokens'.padEnd(20))} ${styled.system(String(m.metrics.inputTokens ?? 0))}`);
          writeln(terminal, `  ${styled.label('Output tokens'.padEnd(20))} ${styled.system(String(m.metrics.outputTokens ?? 0))}`);
          if ((m.metrics.cachedTokens ?? 0) > 0) {
            writeln(terminal, `  ${styled.label('Cache tokens'.padEnd(20))} ${styled.muted(String(m.metrics.cachedTokens ?? 0))}`);
          }
          writeln(terminal, `  ${styled.label('Turns'.padEnd(20))} ${styled.muted(String(m.metrics.turnCount ?? 0))}`);
        }
      }
      writeln(terminal, '');
    },
  },

  // ── config ──
  {
    name: 'runtime',
    aliases: ['surface'],
    description: 'Get or set the runtime surface used for the next new CLI session',
    argsHint: '[web|terminal|background]',
    category: 'config',
    handler: (args, { terminal, currentRunId, selectedRuntimeSurface, setSelectedRuntimeSurface }) => {
      const query = args.trim().toLowerCase();
      const currentLabel = selectedRuntimeSurface === 'terminal-cli'
        ? 'terminal-cli (tty policy)'
        : selectedRuntimeSurface === 'background'
          ? 'background (detached non-tty policy)'
          : 'web-cli (non-tty policy)';

      if (!query) {
        writeln(terminal, styled.system(`Current runtime surface: ${styled.accent(currentLabel)}`));
        writeln(terminal, styled.muted('Applies to the next newly created CLI session.'));
        return;
      }

      let nextSurface: CliRuntimeSurface | null = null;
      if (query === 'web' || query === 'web-cli') {
        nextSurface = 'web-cli';
      }
      if (query === 'terminal' || query === 'tty' || query === 'terminal-cli') {
        nextSurface = 'terminal-cli';
      }
      if (query === 'background' || query === 'bg') {
        nextSurface = 'background';
      }

      if (!nextSurface) {
        writeln(terminal, styled.warn('Usage: /runtime [web|terminal|background]'));
        return;
      }

      setSelectedRuntimeSurface(nextSurface);
      writeln(
        terminal,
        styled.success(
          nextSurface === 'terminal-cli'
            ? 'Runtime switched to terminal-cli. New sessions will request tty sandbox policies.'
            : nextSurface === 'background'
              ? 'Runtime switched to background. New sessions will start detached with non-tty background sandbox policies.'
            : 'Runtime switched to web-cli. New sessions will use the standard web sandbox policies.',
        ),
      );
      if (currentRunId) {
        writeln(terminal, styled.muted('The active run keeps its existing runtime surface. Start /new to use the new setting.'));
      }
    },
  },
  {
    name: 'model',
    aliases: ['m'],
    description: 'Get or set the active model',
    argsHint: '[name]',
    category: 'config',
    handler: (args, { terminal, enabledModels, selectedModelId, setSelectedModelId }) => {
      if (!args.trim()) {
        const current = enabledModels.find((m) => m.modelId === selectedModelId);
        writeln(terminal, styled.system(`Current model: ${styled.accent(current?.modelName ?? selectedModelId)}`));
        writeln(terminal, '');
        enabledModels.forEach((m) => {
          const marker = m.modelId === selectedModelId ? styled.success('*') : ' ';
          writeln(terminal, `  ${marker} ${styled.tool(m.modelName)} ${styled.muted(m.modelId)}`);
        });
        return;
      }
      const query = args.trim().toLowerCase();
      const match = enabledModels.find(
        (m) => m.modelId.toLowerCase() === query || m.modelName.toLowerCase().includes(query),
      );
      if (!match) {
        writeln(terminal, styled.error(`No model found matching: ${args.trim()}`));
        return;
      }
      setSelectedModelId(match.modelId);
      writeln(terminal, styled.success(`Model switched to: ${match.modelName}`));
    },
  },
  {
    name: 'persona',
    aliases: ['p'],
    description: 'List personas or apply one to the current session',
    argsHint: '[name]',
    category: 'config',
    handler: async (args, { terminal, currentSessionId }) => {
      const query = args.trim();
      try {
        const items = await listPersonas();
        if (!query) {
          writeln(terminal, '');
          writeln(terminal, styled.accent('Personas'));
          writeln(terminal, styled.separator());
          if (items.length === 0) {
            writeln(terminal, styled.muted('  (no personas)'));
          } else {
            items.forEach((p) => {
              const tag = p.isBuiltIn ? styled.muted('[builtin]') : styled.success('[custom]');
              writeln(terminal, `  ${tag} ${styled.tool(p.name)} ${styled.muted(`(${p.scope})`)} ${styled.system(p.description ?? '')}`);
            });
          }
          writeln(terminal, styled.muted('  Use /persona <name> to apply to current session'));
          writeln(terminal, '');
          return;
        }
        const match = items.find(
          (p) => p.name.toLowerCase() === query.toLowerCase() || p.personaId === query,
        );
        if (!match) {
          writeln(terminal, styled.error(`No persona found: ${query}`));
          return;
        }
        if (!currentSessionId) {
          // 无 session 时本地保存为 "下次新会话默认 persona" 的提示
          try {
            window.localStorage.setItem('risk-agent.cli.pendingPersonaId', match.personaId);
          } catch {
            // ignore
          }
          writeln(terminal, styled.warn('No active session. Persona saved as default for the next session.'));
          writeln(terminal, `  Selected: ${styled.tool(match.name)}`);
          return;
        }
        await applyPersonaToSession(currentSessionId, match.personaId, 'user');
        writeln(terminal, styled.success(`Persona applied: ${styled.tool(match.name)}`));
      } catch (err: any) {
        writeln(terminal, styled.error(`Failed to load/apply persona: ${err?.message ?? 'unknown'}`));
      }
    },
  },
  {
    name: 'insights',
    aliases: ['memory', 'facts'],
    description: 'Show recent memory insights from past sessions',
    argsHint: '[--days N]',
    category: 'info',
    handler: async (args, { terminal }) => {
      let days = 30;
      const daysMatch = args.match(/--days\s+(\d+)/);
      if (daysMatch) days = parseInt(daysMatch[1], 10);

      writeln(terminal, '');
      writeln(terminal, styled.accent(`Memory Insights (last ${days} days)`));
      writeln(terminal, styled.separator());
      try {
        const summary = await getInsights(days);
        if (summary.totalFacts === 0) {
          writeln(terminal, styled.muted('  No memory facts yet. Have a conversation to build your memory.'));
          writeln(terminal, '');
          return;
        }
        writeln(terminal, styled.muted(`  Total: ${summary.totalFacts} facts`));
        writeln(terminal, '');
        for (const group of summary.groups) {
          writeln(terminal, styled.label(`  ${group.label}`));
          for (const fact of group.facts.slice(0, 5)) {
            const conf = `[${Math.round(fact.confidence * 100)}%]`;
            writeln(terminal, `    ${styled.muted(conf)} ${styled.system(fact.content)}`);
          }
          if (group.facts.length > 5) {
            writeln(terminal, styled.muted(`    ... and ${group.facts.length - 5} more`));
          }
          writeln(terminal, '');
        }
      } catch (err: any) {
        writeln(terminal, styled.error(`Failed to load insights: ${err?.message ?? 'unknown'}`));
      }
    },
  },
  {
    name: 'tools',
    aliases: ['t'],
    description: 'List tools or toggle a tool on/off',
    argsHint: '[name]',
    category: 'config',
    handler: (args, { terminal, availableTools, selectedToolIds, setSelectedToolIds }) => {
      if (!args.trim()) {
        writeln(terminal, styled.system('Available tools:'));
        if (availableTools.length === 0) {
          writeln(terminal, styled.muted('  (none configured)'));
          return;
        }
        availableTools.forEach((tool) => {
          const active = selectedToolIds.includes(tool.name);
          const marker = active ? styled.success('[on] ') : styled.muted('[off]');
          writeln(terminal, `  ${marker} ${styled.tool(tool.name)} ${styled.muted(tool.description ?? '')}`);
        });
        return;
      }
      const query = args.trim().toLowerCase();
      const match = availableTools.find((t) => t.name.toLowerCase() === query);
      if (!match) {
        writeln(terminal, styled.error(`No tool found: ${args.trim()}`));
        return;
      }
      const next = selectedToolIds.includes(match.name)
        ? selectedToolIds.filter((id) => id !== match.name)
        : [...selectedToolIds, match.name];
      setSelectedToolIds(next);
      const status = next.includes(match.name) ? styled.success('enabled') : styled.warn('disabled');
      writeln(terminal, `Tool ${styled.tool(match.name)} ${status}`);
    },
  },

  // ── skills hub — mirrors Hermes skills_hub.py slash command handler ──
  {
    name: 'skills',
    aliases: ['sk'],
    description: 'Manage skills: list, inspect, test, delete, install',
    argsHint: '[list|inspect <name>|test <name>|delete <name>|install <url>]',
    category: 'config',
    handler: async (args, { terminal }) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() ?? '';

      // ── /skills or /skills list ─────────────────────────────────────
      if (!sub || sub === 'list') {
        writeln(terminal, '');
        writeln(terminal, styled.accent('Installed Skills'));
        writeln(terminal, styled.separator());
        try {
          const result = await listSkills();
          const skills = result.data ?? [];
          if (skills.length === 0) {
            writeln(terminal, styled.muted('  No skills installed.'));
            writeln(terminal, styled.muted('  Use /skills install <url> to install from URL.'));
          } else {
            const nameW = Math.max(12, ...skills.map((s) => s.name.length)) + 2;
            writeln(terminal, `  ${styled.label('Name'.padEnd(nameW))}${styled.label('Source'.padEnd(12))}${styled.label('Description')}`);
            for (const s of skills) {
              const name = styled.tool(s.name.padEnd(nameW));
              const src = styled.muted((s.source ?? '').padEnd(12));
              const desc = styled.system((s.description ?? '').slice(0, 55));
              writeln(terminal, `  ${name}${src}${desc}`);
            }
            writeln(terminal, styled.muted(`  ${skills.length} skill(s) loaded.`));
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`Error listing skills: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // ── /skills inspect <name> ─────────────────────────────────────
      if (sub === 'inspect') {
        const name = parts.slice(1).join(' ').trim();
        if (!name) {
          writeln(terminal, styled.warn('Usage: /skills inspect <name>'));
          return;
        }
        writeln(terminal, '');
        try {
          const result = await getSkill(name);
          const s = result.data;
          if (!s) {
            writeln(terminal, styled.error(`Skill not found: ${name}`));
            return;
          }
          writeln(terminal, styled.accent(`Skill: ${s.name}`));
          writeln(terminal, styled.separator());
          writeln(terminal, `  ${styled.label('Name'.padEnd(14))} ${styled.system(s.name)}`);
          writeln(terminal, `  ${styled.label('Source'.padEnd(14))} ${styled.muted(s.source ?? '')}`);
          writeln(terminal, `  ${styled.label('Description'.padEnd(14))} ${styled.system(s.description ?? '')}`);
          if (s.author) writeln(terminal, `  ${styled.label('Author'.padEnd(14))} ${styled.muted(s.author)}`);
          if (s.version) writeln(terminal, `  ${styled.label('Version'.padEnd(14))} ${styled.muted(s.version)}`);
          if (s.tags?.length) writeln(terminal, `  ${styled.label('Tags'.padEnd(14))} ${s.tags.map((t) => styled.tool(t)).join('  ')}`);
        } catch (err: any) {
          writeln(terminal, styled.error(`Error inspecting skill: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // ── /skills test <name> ─────────────────────────────────────────
      if (sub === 'test') {
        const name = parts.slice(1).join(' ').trim();
        if (!name) {
          writeln(terminal, styled.warn('Usage: /skills test <name>'));
          return;
        }
        writeln(terminal, styled.system(`Testing skill: ${name}...`));
        try {
          const result = (await testSkill(name)) as any;
          if (result?.data?.output) {
            writeln(terminal, styled.success(`[test passed]  ${result.data.output}`));
          } else {
            writeln(terminal, styled.success('[test passed]'));
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`[test failed]  ${err?.message ?? 'unknown'}`));
        }
        return;
      }

      // ── /skills delete <name> ───────────────────────────────────────
      if (sub === 'delete' || sub === 'remove' || sub === 'uninstall') {
        const name = parts.slice(1).join(' ').trim();
        if (!name) {
          writeln(terminal, styled.warn('Usage: /skills delete <name>'));
          return;
        }
        writeln(terminal, styled.warn(`Deleting skill: ${name}...`));
        try {
          await deleteSkill(name);
          writeln(terminal, styled.success(`Skill deleted: ${name}`));
        } catch (err: any) {
          writeln(terminal, styled.error(`Error deleting skill: ${err?.message ?? 'unknown'}`));
        }
        return;
      }

      // ── /skills install <url> [--name <name>] ──────────────────────
      if (sub === 'install') {
        const urlArg = parts[1];
        if (!urlArg) {
          writeln(terminal, styled.warn('Usage: /skills install <url> [--name <name>] [--force]'));
          writeln(terminal, styled.muted('  <url> — direct URL to a SKILL.md file'));
          return;
        }
        // Parse optional flags
        let nameOverride = '';
        let force = false;
        for (let i = 2; i < parts.length; i++) {
          if (parts[i] === '--name' && parts[i + 1]) { nameOverride = parts[++i]; }
          if (parts[i] === '--force') { force = true; }
        }

        writeln(terminal, styled.system(`Fetching skill from: ${urlArg}`));
        writeln(terminal, styled.muted('  Running security scan...'));
        try {
          const result = await installSkillFromUrl(urlArg, nameOverride || undefined, force);
          const skill = result.data;
          const scan = (result as any).scan;
          const verdict: string = scan?.verdict ?? 'unknown';
          const trust: string = scan?.trustLevel ?? 'community';
          const findingsCount: number = scan?.findings?.length ?? 0;
          // Verdict display
          const verdictColor = verdict === 'safe'
            ? styled.success
            : verdict === 'caution'
              ? styled.warn
              : styled.error;
          writeln(terminal, styled.success(`[installed]  ${skill.name}`));
          writeln(terminal, styled.muted(`  Source:  ${skill.source}`));
          writeln(terminal, styled.muted(`  Desc:    ${skill.description ?? ''}`));
          writeln(terminal, `  Trust:   ${styled.muted(trust)}   Scan: ${verdictColor(verdict.toUpperCase())} (${findingsCount} finding${findingsCount === 1 ? '' : 's'})`);
          writeln(terminal, styled.muted('  Use /skills list to verify installation.'));
        } catch (err: any) {
          const errMsg: string = err?.message ?? 'unknown';
          writeln(terminal, styled.error(`[install failed]  ${errMsg}`));
          // If the server returned a scan report, display it
          if (err?.response) {
            try {
              const body = typeof err.response === 'object' ? err.response : JSON.parse(err.response);
              if (body?.report) {
                writeln(terminal, '');
                writeln(terminal, styled.muted('--- Security Scan Report ---'));
                for (const line of (body.report as string).split('\n')) {
                  writeln(terminal, styled.muted(`  ${line}`));
                }
              }
            } catch { /* ignore */ }
          }
        }
        return;
      }

      // ── /skills scan <url> — dry-run security scan without installing ──
      if (sub === 'scan') {
        const urlArg = parts[1];
        if (!urlArg) {
          writeln(terminal, styled.warn('Usage: /skills scan <url>'));
          writeln(terminal, styled.muted('  Shows the security scan report for a remote skill without installing it.'));
          return;
        }
        writeln(terminal, styled.system(`Scanning skill from: ${urlArg}`));
        writeln(terminal, styled.muted('  Fetching & analyzing...'));
        try {
          // Use a dummy install attempt with overwrite=false and catch blocked result
          const result = await installSkillFromUrl(urlArg, undefined, false);
          const scan = (result as any).scan;
          const verdict: string = scan?.verdict ?? 'unknown';
          const findingsCount: number = scan?.findings?.length ?? 0;
          const verdictColor = verdict === 'safe' ? styled.success : verdict === 'caution' ? styled.warn : styled.error;
          writeln(terminal, verdictColor(`[scan]  Verdict: ${verdict.toUpperCase()}  (${findingsCount} finding${findingsCount === 1 ? '' : 's'})`));
          writeln(terminal, styled.muted(`  Trust: ${scan?.trustLevel ?? 'community'}  Summary: ${scan?.summary ?? ''}`));
          writeln(terminal, styled.muted('  Note: skill was installed since scan passed. Use /skills delete to remove.'));
        } catch (err: any) {
          const errMsg: string = err?.message ?? 'unknown';
          writeln(terminal, styled.error(`[scan]  ${errMsg}`));
        }
        return;
      }

      // ── /skills help ───────────────────────────────────────────────
      writeln(terminal, '');
      writeln(terminal, styled.accent('/skills — Skills Hub'));
      writeln(terminal, styled.separator());
      writeln(terminal, `  ${styled.tool('/skills list'.padEnd(32))}${styled.system('List all installed skills')}`);
      writeln(terminal, `  ${styled.tool('/skills inspect <name>'.padEnd(32))}${styled.system('Show skill details')}`);
      writeln(terminal, `  ${styled.tool('/skills test <name>'.padEnd(32))}${styled.system('Run skill test (dry-run)')}`);
      writeln(terminal, `  ${styled.tool('/skills delete <name>'.padEnd(32))}${styled.system('Remove a skill')}`);
      writeln(terminal, `  ${styled.tool('/skills install <url>'.padEnd(32))}${styled.system('Install skill from URL (with security scan)')}`);
      writeln(terminal, `  ${styled.tool('/skills scan <url>'.padEnd(32))}${styled.system('Security scan only — no install')}`);
      writeln(terminal, '');
    },
  },

  // ── /compact — summarise / truncate session context ──────────────────────
  {
    name: 'compact',
    aliases: ['summarise', 'summarize'],
    description: 'Compact session context (clear terminal + signal server compression)',
    category: 'session',
    handler: (_args, { terminal, currentRunId, onClear }) => {
      if (!currentRunId) {
        writeln(terminal, styled.warn('No active session to compact.'));
        writeln(terminal, styled.muted('  Start a conversation first, then use /compact to save context window.'));
        return;
      }
      writeln(terminal, styled.accent('[compact] Compacting session context...'));
      writeln(terminal, styled.muted('  Clearing transcript and requesting context summarisation from server.'));
      writeln(terminal, styled.muted('  The conversation history remains intact on the server side.'));
      // Clear the xterm transcript to free visual space
      setTimeout(() => {
        onClear();
        writeln(terminal, styled.success('[compact] Terminal cleared. Context summary preserved on server.'));
        writeln(terminal, styled.muted('  Continue your session — the agent retains full context.'));
        writeln(terminal, '');
      }, 400);
    },
  },

  // ── /shortcuts — keyboard shortcut reference ─────────────────────────────
  {
    name: 'shortcuts',
    aliases: ['keys', 'kb'],
    description: 'Show keyboard shortcut reference',
    category: 'info',
    handler: (_args, { terminal }) => {
      writeln(terminal, '');
      writeln(terminal, styled.accent('Keyboard Shortcuts'));
      writeln(terminal, styled.separator());
      const shortcuts: Array<[string, string]> = [
        ['Enter', 'Send message'],
        ['Alt+Enter / Ctrl+J', 'Insert newline (multiline input)'],
        ['Ctrl+C', 'Interrupt running session'],
        ['Ctrl+L', 'Clear terminal output'],
        ['↑ / ↓', 'Navigate command history'],
        ['Tab', 'Accept slash command autocomplete'],
        ['Esc', 'Dismiss autocomplete / prompt'],
        ['1–9', 'Select choice (when waiting_user prompt shown)'],
      ];
      for (const [key, desc] of shortcuts) {
        writeln(terminal, `  ${styled.tool(key.padEnd(28))}${styled.system(desc)}`);
      }
      writeln(terminal, styled.separator());
      writeln(terminal, styled.muted('  Tip: /help shows all slash commands'));
      writeln(terminal, '');
    },
  },

  // ── /kg — Knowledge Graph CLI ─────────────────────────────────────────────
  {
    name: 'kg',
    aliases: ['graph', 'knowledge-graph'],
    description: 'Interact with the knowledge graph',
    argsHint: '<overview|search|neighborhood|impact|conflicts|write|backfill> [args]',
    category: 'info',
    handler: async (args, { terminal }) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() ?? '';

      // /kg (no args) → show kg help
      if (!sub) {
        writeln(terminal, '');
        writeln(terminal, styled.accent('Knowledge Graph commands'));
        writeln(terminal, styled.separator());
        const cmds: Array<[string, string]> = [
          ['/kg overview',                        'Show graph stats (nodes/edges counts)'],
          ['/kg search <query> [type]',           'Search nodes by keyword and optional type filter'],
          ['/kg neighborhood <nodeId> [depth]',   'Show neighborhood of a node (default depth=2)'],
          ['/kg impact <nodeId>',                 'Analyze downstream impact of a node'],
          ['/kg conflicts [nodeId]',              'Detect conflict pairs (optionally for a specific node)'],
          ['/kg write node <id> <label> <type>',  'Upsert a node into the graph'],
          ['/kg write edge <fromId> <toId> <rel>', 'Add a directed edge between two existing nodes'],
          ['/kg delete <nodeId>',                 'Delete a node and its relations'],
          ['/kg backfill',                        'Rebuild in-memory graph from SQLite mirror'],
        ];
        for (const [cmd, desc] of cmds) {
          writeln(terminal, `  ${styled.tool(cmd.padEnd(40))}${styled.muted(desc)}`);
        }
        writeln(terminal, styled.separator());
        writeln(terminal, styled.muted('  Node types: rule | rule_source | rule_system | scenario | business | profile | dimension | gap | report | document'));
        writeln(terminal, styled.muted('  Relations:  derived_from | belongs_to | covers | references | conflicts_with | replaces | has_profile | has_entity | exposes_gap'));
        writeln(terminal, '');
        return;
      }

      // /kg overview
      if (sub === 'overview' || sub === 'stats') {
        writeln(terminal, '');
        try {
          const ov = await getKGOverview();
          writeln(terminal, styled.accent('Knowledge Graph Overview'));
          writeln(terminal, styled.separator());
          writeln(terminal, `  ${styled.label('Nodes'.padEnd(16))} ${styled.system(String(ov.nodeCount))}`);
          writeln(terminal, `  ${styled.label('Edges'.padEnd(16))} ${styled.system(String(ov.edgeCount))}`);
          writeln(terminal, '');
          writeln(terminal, styled.label('  Nodes by type'));
          for (const [type, count] of Object.entries(ov.nodesByType)) {
            writeln(terminal, `    ${styled.tool(type.padEnd(16))}${styled.muted(String(count))}`);
          }
          writeln(terminal, '');
          writeln(terminal, styled.label('  Edges by relation'));
          for (const [rel, count] of Object.entries(ov.edgesByRelation)) {
            writeln(terminal, `    ${styled.tool(rel.padEnd(16))}${styled.muted(String(count))}`);
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // /kg search <query> [type]
      if (sub === 'search' || sub === 'find') {
        const query = parts[1];
        const typeArg = parts[2] as KGNodeType | undefined;
        if (!query) {
          writeln(terminal, styled.warn('Usage: /kg search <query> [nodeType]'));
          return;
        }
        writeln(terminal, '');
        try {
          const results = await searchKG(query, typeArg ? [typeArg] : undefined, 20);
          if (!results.length) {
            writeln(terminal, styled.muted(`No nodes found for "${query}"`));
          } else {
            writeln(terminal, styled.accent(`Search results for "${query}" (${results.length})`));
            writeln(terminal, styled.separator());
            for (const n of results) {
              writeln(terminal, `  ${styled.tool(n.nodeType.padEnd(14))}${styled.system(n.label)}  ${styled.muted(n.id)}`);
            }
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // /kg neighborhood <nodeId> [depth]
      if (sub === 'neighborhood' || sub === 'nb' || sub === 'neighbors') {
        const nodeId = parts[1];
        const depth = parseInt(parts[2] ?? '2', 10) || 2;
        if (!nodeId) {
          writeln(terminal, styled.warn('Usage: /kg neighborhood <nodeId> [depth]'));
          return;
        }
        writeln(terminal, '');
        try {
          const nb = await getKGNeighborhood(nodeId, { depth, direction: 'both' });
          writeln(terminal, styled.accent(`Neighborhood of ${nodeId} (depth=${depth})`));
          writeln(terminal, styled.separator());
          writeln(terminal, styled.label(`  Nodes (${nb.nodes.length})`));
          for (const n of nb.nodes) {
            const marker = n.id === nodeId ? styled.accent('● ') : '  ';
            writeln(terminal, `${marker}${styled.tool(n.nodeType.padEnd(14))}${styled.system(n.label)}  ${styled.muted(n.id)}`);
          }
          if (nb.edges.length) {
            writeln(terminal, '');
            writeln(terminal, styled.label(`  Edges (${nb.edges.length})`));
            for (const e of nb.edges) {
              writeln(terminal, `    ${styled.muted(e.source)} ${styled.tool(`-[${e.relation}]->`)} ${styled.muted(e.target)}`);
            }
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // /kg impact <nodeId>
      if (sub === 'impact') {
        const nodeId = parts[1];
        if (!nodeId) {
          writeln(terminal, styled.warn('Usage: /kg impact <nodeId>'));
          return;
        }
        writeln(terminal, '');
        try {
          const impact = await getKGImpact(nodeId);
          writeln(terminal, styled.accent(`Impact analysis for ${nodeId}`));
          writeln(terminal, styled.separator());
          writeln(terminal, styled.label(`  Direct impact (${impact.directImpact.length})`));
          for (const n of impact.directImpact) {
            writeln(terminal, `    ${styled.tool(n.nodeType.padEnd(14))}${styled.system(n.label)}  ${styled.muted(n.id)}`);
          }
          if (impact.indirectImpact.length) {
            writeln(terminal, styled.label(`  Indirect impact (${impact.indirectImpact.length})`));
            for (const n of impact.indirectImpact) {
              writeln(terminal, `    ${styled.tool(n.nodeType.padEnd(14))}${styled.system(n.label)}  ${styled.muted(n.id)}`);
            }
          }
          if (!impact.directImpact.length && !impact.indirectImpact.length) {
            writeln(terminal, styled.muted('  No downstream impact found.'));
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // /kg conflicts [nodeId]
      if (sub === 'conflicts' || sub === 'conflict') {
        const nodeId = parts[1];
        writeln(terminal, '');
        try {
          const pairs = await getKGConflicts();
          const filtered = nodeId ? pairs.filter(p => p.nodeA.id === nodeId || p.nodeB.id === nodeId) : pairs;
          if (!filtered.length) {
            writeln(terminal, styled.success(`No conflict pairs found${nodeId ? ` for ${nodeId}` : ''}.`));
          } else {
            writeln(terminal, styled.accent(`Conflict pairs (${filtered.length})`));
            writeln(terminal, styled.separator());
            for (const p of filtered) {
              const tag = p.source === 'explicit' ? styled.error('[explicit]') : styled.warn('[inferred]');
              writeln(terminal, `  ${tag} ${styled.system(p.nodeA.label)} ${styled.muted('↔')} ${styled.system(p.nodeB.label)}`);
              if (p.reason) writeln(terminal, `         ${styled.muted(p.reason)}`);
            }
          }
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // /kg write node <id> <label> <type>
      // /kg write edge <fromId> <toId> <relation>
      if (sub === 'write' || sub === 'add') {
        const op = parts[1]?.toLowerCase();

        if (op === 'node') {
          const [, , id, ...rest] = parts;
          // label can be quoted or space-separated before last token
          // Format: /kg write node <id> <type> <label words...>  OR  /kg write node <id> <label> <type>
          // Simple: treat last token as type, everything before as label
          const nodeType = rest[rest.length - 1] as KGNodeType;
          const label = rest.slice(0, -1).join(' ');
          if (!id || !label || !nodeType) {
            writeln(terminal, styled.warn('Usage: /kg write node <id> <label words...> <nodeType>'));
            writeln(terminal, styled.muted('  Types: rule | rule_source | rule_system | scenario | business | profile | dimension | gap | report | document'));
            return;
          }
          writeln(terminal, '');
          try {
            await createKGNode({ id, label, nodeType });
            writeln(terminal, styled.success(`Node created: [${nodeType}] ${label}  (${id})`));
          } catch (err: any) {
            writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
          }
          writeln(terminal, '');
          return;
        }

        if (op === 'edge') {
          const [, , fromId, toId, relation] = parts;
          if (!fromId || !toId || !relation) {
            writeln(terminal, styled.warn('Usage: /kg write edge <fromId> <toId> <relation>'));
            writeln(terminal, styled.muted('  Relations: derived_from | belongs_to | covers | references | conflicts_with | replaces | has_profile | has_entity | exposes_gap'));
            return;
          }
          writeln(terminal, '');
          try {
            // We need node type for edge – look up nodes first
            const nodes = await searchKG(undefined, undefined, 200);
            const fromNode = nodes.find(n => n.id === fromId);
            const toNode = nodes.find(n => n.id === toId);
            if (!fromNode) { writeln(terminal, styled.error(`Node not found: ${fromId}`)); writeln(terminal, ''); return; }
            if (!toNode) { writeln(terminal, styled.error(`Node not found: ${toId}`)); writeln(terminal, ''); return; }
            await createKGEdge({
              from: { id: fromNode.id, label: fromNode.label, nodeType: fromNode.nodeType },
              to: { id: toNode.id, label: toNode.label, nodeType: toNode.nodeType },
              relation: relation as KGRelationType,
            });
            writeln(terminal, styled.success(`Edge created: ${fromId} -[${relation}]-> ${toId}`));
          } catch (err: any) {
            writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
          }
          writeln(terminal, '');
          return;
        }

        writeln(terminal, styled.warn('Usage: /kg write node|edge ...'));
        return;
      }

      // /kg delete <nodeId>
      if (sub === 'delete' || sub === 'del' || sub === 'remove') {
        const nodeId = parts[1];
        if (!nodeId) {
          writeln(terminal, styled.warn('Usage: /kg delete <nodeId>'));
          return;
        }
        writeln(terminal, '');
        try {
          await deleteKGNode(nodeId);
          writeln(terminal, styled.success(`Node deleted: ${nodeId}`));
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      // /kg backfill
      if (sub === 'backfill' || sub === 'rebuild') {
        writeln(terminal, styled.system('Rebuilding knowledge graph from SQLite mirror...'));
        try {
          const result = await runKGBackfill();
          writeln(terminal, styled.success(`Backfill complete: ${result.nodesRestored} nodes, ${result.edgesRestored} edges restored.`));
        } catch (err: any) {
          writeln(terminal, styled.error(`Error: ${err?.message ?? 'unknown'}`));
        }
        writeln(terminal, '');
        return;
      }

      writeln(terminal, styled.warn(`Unknown /kg subcommand: ${sub}. Type /kg for help.`));
    },
  },
];

// ── Registry lookup ──────────────────────────────────────────────────────────
const _nameMap = new Map<string, CommandDef>();
for (const cmd of COMMANDS) {
  _nameMap.set(cmd.name, cmd);
  for (const alias of cmd.aliases ?? []) {
    _nameMap.set(alias, cmd);
  }
}

export function findCommand(name: string): CommandDef | undefined {
  return _nameMap.get(name.toLowerCase());
}

/**
 * Parse and execute a slash command string like "/help" or "/model claude".
 * Returns true if the input was a slash command (even if unknown), false otherwise.
 */
export function executeSlashCommand(rawValue: string, ctx: CliContext): boolean {
  if (!rawValue.startsWith('/')) return false;

  const trimmed = rawValue.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  const cmd = findCommand(name);
  if (!cmd) {
    ctx.terminal.write(`${formatUserInput(trimmed)}${styled.error(`Unknown command: /${name}. Try /help.`)}\r\n`);
    return true;
  }

  ctx.terminal.write(formatUserInput(trimmed));
  void cmd.handler(args, ctx);
  return true;
}

/**
 * Return all commands matching a partial slash prefix (for autocomplete).
 * Input: partial string like "/mo" or "/h"
 */
export function autocompleteCommands(partial: string): CommandDef[] {
  if (!partial.startsWith('/')) return [];
  const prefix = partial.slice(1).toLowerCase();
  if (!prefix) return COMMANDS;
  return COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(prefix) ||
      (cmd.aliases ?? []).some((a) => a.startsWith(prefix)),
  );
}
