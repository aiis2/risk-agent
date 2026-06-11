/**
 * CliPage — Hermes-style CLI session surface with xterm.js ANSI emulation.
 *
 * Layout:
 *   ┌─── Header ─────────────────────────────────────────────────────┐
 *   │ [icon] CLI   run-id   model   [activity-toggle] [sessions-tgl] │
 *   ├────────────────────────────────────┬──────────────┬────────────┤
 *   │           xterm.js terminal        │ ActivityLane │ SessionRail│
 *   ├────────────────────────────────────┴──────────────┴────────────┤
 *   │ [PromptBar — shown only when waiting_user]                      │
 *   │ [CliComposer — always visible]                                  │
 *   └─────────────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconChevronDown,
  IconHistory,
  IconLoader2,
  IconSparkles,
  IconTerminal2,
} from '@tabler/icons-react';
import { listModels, listTools } from '../api/client';
import { welcomeBanner } from '../lib/cliAnsi';
import { executeSlashCommand, type CliContext } from '../lib/cliCommands';
import type { BusyMode, CliRuntimeSurface } from '../lib/cliCommands';
import { pickPreferredModel, pickPreferredModelId } from '../lib/preferredModel';
import { useXterm } from '../hooks/useXterm';
import { useCliSession } from '../hooks/useCliSession';
import { CliTerminal } from '../components/Cli/CliTerminal';
import { CliComposer } from '../components/Cli/CliComposer';
import { ActivityLane } from '../components/Cli/ActivityLane';
import { SessionRail } from '../components/Cli/SessionRail';
import { PromptBar } from '../components/Cli/PromptBar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui';

// xterm.js requires its own CSS for canvas/DOM rendering
import '@xterm/xterm/css/xterm.css';

export function CliPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [selectedRuntimeSurface, setSelectedRuntimeSurface] = useState<CliRuntimeSurface>('web-cli');
  const [busyModeOverride, setBusyModeOverride] = useState<BusyMode>('idle');
  const terminalReadyRef = useRef(false);
  const terminalBannerFrameRef = useRef<number | null>(null);

  // ── Fetch models + tools ──────────────────────────────────────────────────
  const { data: modelsData = [] } = useQuery({
    queryKey: ['models'],
    queryFn: listModels,
  });
  const { data: toolsData } = useQuery({
    queryKey: ['tools', 'cli'],
    queryFn: () => listTools(),
  });

  const enabledModels = modelsData.filter((m) => m.enabled);
  const availableTools = toolsData?.tools ?? [];

  // Set default model once loaded
  useEffect(() => {
    if (enabledModels.length === 0) return;
    const fallbackModelId = pickPreferredModelId(enabledModels, selectedModelId);
    if (!fallbackModelId || fallbackModelId === selectedModelId) return;
    setSelectedModelId(fallbackModelId);
  }, [enabledModels, selectedModelId]);

  // ── xterm.js instance ──────────────────────────────────────────────────────
  const { terminal, clear: clearTerminal } = useXterm({
    containerRef,
  });

  useEffect(() => {
    if (!terminal || terminalReadyRef.current) return;
    terminalBannerFrameRef.current = window.requestAnimationFrame(() => {
      terminal.reset();
      terminal.write(welcomeBanner());
      terminalReadyRef.current = true;
      terminalBannerFrameRef.current = null;
    });

    return () => {
      if (terminalBannerFrameRef.current !== null) {
        window.cancelAnimationFrame(terminalBannerFrameRef.current);
        terminalBannerFrameRef.current = null;
      }
    };
  }, [terminal]);

  // ── CLI session state ──────────────────────────────────────────────────────
  const {
    currentRunId,
    currentRun,
    busyMode: sessionBusyMode,
    setBusyMode: setSessionBusyMode,
    recentRuns,
    activityEvents,
    waitingUser,
    isSending,
    sendMessage,
    submitPromptInput,
    interruptRun,
    launchBackgroundRun,
    startNewSession,
    resumeSession,
  } = useCliSession({ terminal, selectedModelId, selectedToolIds, selectedRuntimeSurface });

  // Merge busyMode: session auto-idles; command overrides take effect
  const busyMode: BusyMode = sessionBusyMode !== 'idle' ? sessionBusyMode : busyModeOverride;
  const setBusyMode = useCallback(
    (mode: BusyMode) => {
      setBusyModeOverride(mode);
      setSessionBusyMode(mode);
    },
    [setSessionBusyMode],
  );

  const isRunning = currentRun?.status === 'running';
  const currentModel = pickPreferredModel(enabledModels, selectedModelId);
  const selectedModelLabel = currentModel?.modelName ?? (enabledModels.length === 0 ? 'loading...' : 'select model');
  const hasPinnedTools = selectedToolIds.length > 0;
  const runtimeBadgeLabel = selectedRuntimeSurface === 'terminal-cli'
    ? 'next tty'
    : selectedRuntimeSurface === 'background'
      ? 'next bg'
      : 'next web';
  const handleStartNewSession = useCallback(() => {
    setBusyModeOverride('idle');
    setSessionBusyMode('idle');
    startNewSession();
  }, [setSessionBusyMode, startNewSession]);

  const handleToggleActivity = useCallback(() => {
    setActivityOpen((prev) => {
      const next = !prev;
      if (next) setSessionsOpen(false);
      return next;
    });
  }, []);

  const handleToggleSessions = useCallback(() => {
    setSessionsOpen((prev) => {
      const next = !prev;
      if (next) setActivityOpen(false);
      return next;
    });
  }, []);

  const handleResumeSession = useCallback(
    (runId: string) => {
      setSessionsOpen(false);
      resumeSession(runId);
    },
    [resumeSession],
  );

  // ── Build slash command context ────────────────────────────────────────────
  const buildCliContext = useCallback((): CliContext | null => {
    if (!terminal) return null;
    return {
      terminal,
      currentRunId,
      busyMode,
      setBusyMode,
      selectedRuntimeSurface,
      setSelectedRuntimeSurface,
      selectedModelId,
      setSelectedModelId,
      selectedToolIds,
      setSelectedToolIds,
      launchBackgroundRun,
      onNewSession: handleStartNewSession,
      onClear: clearTerminal,
      onResume: resumeSession,
      onInterrupt: interruptRun,
      enabledModels: enabledModels.map((m) => ({
        modelId: m.modelId,
        modelName: m.modelName,
        isDefault: m.isDefault,
      })),
      availableTools: availableTools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
      recentRuns,
    };
  }, [
    terminal,
    currentRunId,
    busyMode,
    setBusyMode,
    selectedRuntimeSurface,
    selectedModelId,
    selectedToolIds,
    enabledModels,
    availableTools,
    recentRuns,
    handleStartNewSession,
    clearTerminal,
    resumeSession,
    interruptRun,
  ]);

  // ── Handle send ────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      if (!content.trim() || !terminal) return;
      const ctx = buildCliContext();
      if (ctx && executeSlashCommand(content, ctx)) return;
      void sendMessage(content);
    },
    [terminal, buildCliContext, sendMessage],
  );

  return (
    <div className="cli-page-shell flex h-full min-h-0 flex-col overflow-hidden px-2 py-2 font-sans text-text sm:px-3 sm:py-3">
      <div className="cli-workbench-shell relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cli-border backdrop-blur">
        <div className="cli-topbar flex h-12 shrink-0 items-center gap-3 border-b px-4 sm:px-5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>

          <div className="flex min-w-0 items-center gap-2 border-l border-border pl-3">
            <div className="flex h-6 w-6 items-center justify-center text-accent">
              <IconTerminal2 size={14} />
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.26em] text-text">
              risk agent cli
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
              {currentRunId ? `run·${currentRunId.slice(-8)}` : 'standby'}
            </span>
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-warn">
                <IconLoader2 size={10} className="animate-spin" />
                running
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                  waitingUser ? 'text-accent/70' : 'text-text-dim'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${waitingUser ? 'bg-accent' : 'bg-success'}`} />
                {waitingUser ? 'awaiting input' : 'ready'}
              </span>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                selectedRuntimeSurface === 'terminal-cli'
                  ? 'text-warn'
                  : selectedRuntimeSurface === 'background'
                    ? 'text-text-dim'
                    : 'text-text-dim'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${selectedRuntimeSurface === 'terminal-cli' ? 'bg-warn' : selectedRuntimeSurface === 'background' ? 'bg-border' : 'bg-border'}`} />
              {runtimeBadgeLabel}
            </span>

            <span
              className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                hasPinnedTools ? 'text-accent/70' : 'text-text-dim'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${hasPinnedTools ? 'bg-accent' : 'bg-border'}`} />
              {hasPinnedTools ? `${selectedToolIds.length} tools pinned` : 'tools auto'}
            </span>

            <div className="relative">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 max-w-[13rem] items-center gap-1.5 overflow-hidden font-mono text-[11px] text-text transition-colors hover:text-text"
                    aria-label={selectedModelLabel}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-border" />
                    <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
                    <IconChevronDown size={12} className="text-text-dim" />
                  </button>
                </DropdownMenuTrigger>
                {enabledModels.length > 0 && (
                  <DropdownMenuContent align="end" className="cli-popover w-56 rounded-2xl border-border font-mono text-[11px]">
                    {enabledModels.map((m) => (
                      <DropdownMenuItem
                        key={m.modelId}
                        onClick={() => setSelectedModelId(m.modelId)}
                        className={`gap-2 px-3 py-2.5 font-mono text-[11px] ${
                          m.modelId === selectedModelId ? 'text-accent' : 'text-text-dim'
                        }`}
                      >
                        <span className="w-3 text-center text-accent">
                          {m.modelId === selectedModelId ? '*' : ''}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{m.modelName}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </div>

            <button
              type="button"
              onClick={handleToggleActivity}
              title="Toggle activity lane"
              aria-label="Toggle activity lane"
              className={`inline-flex items-center gap-1.5 font-mono text-[11px] transition-colors ${
                activityOpen ? 'text-accent/70' : 'text-text-dim hover:text-text'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${activityEvents.length > 0 ? 'bg-accent' : 'bg-border'}`} />
              <IconSparkles size={12} />
              <span>activity</span>
              {activityEvents.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activityOpen ? 'bg-accent/20 text-accent' : 'bg-surface-card text-accent/70'}`}>
                  {activityEvents.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleToggleSessions}
              title="Toggle sessions panel"
              aria-label="Toggle sessions panel"
              className={`inline-flex items-center gap-1.5 font-mono text-[11px] transition-colors ${
                sessionsOpen ? 'text-accent/70' : 'text-text-dim hover:text-text'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${recentRuns.length > 0 ? 'bg-accent' : 'bg-border'}`} />
              <IconHistory size={12} />
              <span>sessions</span>
              {recentRuns.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${sessionsOpen ? 'bg-accent/20 text-accent' : 'bg-surface-card text-accent/70'}`}>
                  {recentRuns.length}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="cli-terminal-stage relative min-h-0 flex-1 overflow-hidden">
          <div className="cli-terminal-sheen pointer-events-none absolute inset-x-0 top-0 z-10 h-12" />
          <CliTerminal ref={containerRef} className="h-full w-full px-3 py-3 sm:px-4 sm:py-4" />

          <ActivityLane
            events={activityEvents}
            isOpen={activityOpen}
            onToggle={handleToggleActivity}
          />

          <SessionRail
            runs={recentRuns}
            currentRunId={currentRunId}
            onResume={handleResumeSession}
            isOpen={sessionsOpen}
            onToggle={handleToggleSessions}
          />
        </div>

        <div className="cli-dock shrink-0 border-t">
          {waitingUser && (
            <PromptBar
              prompt={waitingUser}
              onSubmit={submitPromptInput}
            />
          )}

          <CliComposer
            busyMode={busyMode}
            isSending={isSending}
            onSend={handleSend}
            onInterrupt={interruptRun}
            onClear={clearTerminal}
            isRunning={isRunning}
            toolCount={selectedToolIds.length}
            currentRunId={currentRunId}
            runStartedAt={currentRun?.createdAt ? new Date(currentRun.createdAt).getTime() : undefined}
            runMetrics={currentRun?.metrics ? {
              turnCount: currentRun.metrics.turnCount,
              inputTokens: currentRun.metrics.inputTokens,
              outputTokens: currentRun.metrics.outputTokens,
              estimatedUsd: currentRun.metrics.estimatedUsd,
            } : undefined}
          />
        </div>
      </div>
    </div>
  );
}








