/**
 * useCliSession — session state machine for the CLI surface.
 *
 * Manages:
 * - currentRunId + run snapshot
 * - SSE stream connection → writes ANSI-formatted events to xterm
 * - busyMode (idle | queue | steer | interrupt)
 * - recentRuns (for session rail + /history)
 * - waitingUserPayload (prompt flow overlay)
 * - send / interrupt / resume actions
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Terminal } from '@xterm/xterm';
import {
  appendRunMessage,
  buildRunStreamUrl,
  cancelRun,
  createRun,
  getRun,
  getRunArtifacts,
  getRunEvents,
  listRuns,
  resolveRunCurrentCapability,
  submitRunInput,
  type RunComposerPayload,
  type RunSummary,
  type RunTimelineEvent,
} from '../api/client';
import { eventToAnsi, formatUserInput, hr, markdownToAnsi, styled, welcomeBanner } from '../lib/cliAnsi';
import type { BusyMode, CliRuntimeSurface } from '../lib/cliCommands';
import { mergeSandboxDescriptor, summarizeSandboxCompact } from '../lib/sandboxDisplay';
import { readStructuredAnswer } from '../components/Runs/StructuredAnswerSurface';

export interface WaitingUserPayload {
  question: string;
  choices?: string[];
  promptKind?: string;
  checkpointId?: string;
  checkpoint?: Record<string, unknown>;
  approval?: {
    approveLabel?: string;
    denyLabel?: string;
  };
}

export interface ActivityEvent {
  id: string;
  type: string;
  label: string;
  timestamp: number;
}

export interface UseCliSessionOptions {
  terminal: Terminal | null;
  selectedModelId: string;
  selectedToolIds: string[];
  selectedRuntimeSurface: CliRuntimeSurface;
}

export interface UseCliSessionReturn {
  currentRunId: string;
  currentRun: RunSummary | null;
  busyMode: BusyMode;
  setBusyMode: (mode: BusyMode) => void;
  recentRuns: Array<{ runId: string; title: string; status: string; updatedAt: string }>;
  activityEvents: ActivityEvent[];
  waitingUser: WaitingUserPayload | null;
  isSending: boolean;
  sendMessage: (content: string) => Promise<void>;
  submitPromptInput: (value: string) => Promise<void>;
  interruptRun: () => Promise<void>;
  launchBackgroundRun: (content: string) => Promise<string | undefined>;
  startNewSession: () => void;
  resumeSession: (runId: string) => void;
}

const ACTIVITY_EVENT_TYPES = new Set([
  'thinking_start', 'thinking_complete',
  'tool_start', 'tool_complete',
  'subagent_start', 'subagent_complete',
  'interrupt_requested',
  'continuation_decision', 'capability_switched',
  'general_response_started',
  'agent_status',
  'routed', 'plan_created',
  'checkpoint_created',
  'waiting_user', 'user_input_received',
  'artifact_updated', 'verifier_finished',
  'run_completed', 'run_failed', 'run_cancelled',
  'run_status', 'status_update', 'checkpoint',
]);

const REPLAY_WINDOW_SIZE = 12;

const REPLAY_ANCHOR_TYPES = new Set([
  'waiting_user',
  'user_input_received',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'user_message',
]);

function getRunTitle(run: RunSummary): string {
  const input = (run as unknown as { input?: Record<string, unknown> }).input;
  if (input?.businessName) return String(input.businessName);
  if (input?.prompt) return String(input.prompt).slice(0, 45);
  return run.runId.slice(-8);
}

function labelForActivity(type: string, payload: Record<string, unknown>): string {
  const sandbox = summarizeSandboxCompact(payload.sandbox);
  const withSandbox = (label: string) => sandbox ? `${label} · ${sandbox}` : label;

  switch (type) {
    case 'interrupt_requested': return withSandbox('interrupt requested');
    case 'tool_start': return withSandbox(`tool ${String(payload.toolName ?? payload.name ?? type)}`);
    case 'tool_complete': return withSandbox(`tool ${String(payload.toolName ?? payload.name ?? type)} complete`);
    case 'thinking_start': return 'model reasoning';
    case 'thinking_complete': return 'reasoning settled';
    case 'subagent_start': return `agent ${String(payload.agentName ?? payload.name ?? type)} online`;
    case 'subagent_complete': return `agent ${String(payload.agentName ?? payload.name ?? '')} returned`;
    case 'agent_status': return withSandbox(String(payload.message ?? 'Working...'));
    case 'routed': return `route ${String(payload.acceptedTaskKind ?? payload.taskKind ?? 'unknown')}`;
    case 'general_response_started': return `draft ${String(payload.responseMode ?? 'direct')} response`;
    case 'continuation_decision': {
      const decision = String(payload.decision ?? 'continue');
      const nextCapability = String(payload.nextCapabilityProfile ?? payload.currentCapabilityProfile ?? 'general');
      const reason = String(payload.reason ?? '').trim();
      const base = decision === 'stop' ? 'stop orchestration' : `continue -> ${nextCapability}`;
      return reason ? `${base} · ${reason}` : base;
    }
    case 'capability_switched': return `switch -> ${String(payload.to ?? payload.nextCapabilityProfile ?? 'unknown')}`;
    case 'plan_created': return String(payload.summary ?? payload.intent ?? 'plan staged');
    case 'checkpoint_created': return `checkpoint ${String(payload.semanticKind ?? payload.kind ?? 'checkpoint')}`;
    case 'waiting_user': return 'awaiting input';
    case 'user_input_received': return 'input accepted';
    case 'artifact_updated': {
      const kind = String(payload.kind ?? 'artifact');
      const preview = typeof payload.preview === 'string' ? payload.preview.trim() : '';
      if (!preview) {
        return `artifact ${kind}`;
      }
      const shortPreview = preview.length > 44 ? `${preview.slice(0, 43)}…` : preview;
      return `${kind} · ${shortPreview}`;
    }
    case 'verifier_finished': return `verifier ${String(payload.decision ?? 'unknown')}`;
    case 'run_completed': return 'session complete';
    case 'run_failed': return `session failed | ${String(payload.terminationReason ?? 'unknown')}`;
    case 'run_cancelled': return withSandbox(`session interrupted | ${String(payload.reason ?? payload.terminationReason ?? 'user_cancelled')}`);
    default: {
      const status = String(payload.status ?? payload.state ?? payload.message ?? type);
      return withSandbox(status);
    }
  }
}

function toWaitingUserPayload(event: RunTimelineEvent | null | undefined): WaitingUserPayload | null {
  if (!event || event.type !== 'waiting_user') {
    return null;
  }

  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const choiceValues = Array.isArray(payload.choices)
    ? payload.choices
    : Array.isArray(payload.options)
      ? payload.options
      : undefined;
  const checkpoint = payload.checkpoint && typeof payload.checkpoint === 'object'
    ? payload.checkpoint as Record<string, unknown>
    : undefined;
  const approval = payload.approval && typeof payload.approval === 'object'
    ? payload.approval as Record<string, unknown>
    : undefined;

  return {
    question: String(payload.question ?? payload.message ?? 'Input required'),
    choices: choiceValues?.map(String),
    promptKind: payload.promptKind ? String(payload.promptKind) : undefined,
    checkpointId: payload.checkpointId ? String(payload.checkpointId) : undefined,
    checkpoint,
    approval: approval
      ? {
          ...(typeof approval.approveLabel === 'string' ? { approveLabel: approval.approveLabel } : {}),
          ...(typeof approval.denyLabel === 'string' ? { denyLabel: approval.denyLabel } : {}),
        }
      : undefined,
  };
}

function buildReplayWindow(events: RunTimelineEvent[]): { events: RunTimelineEvent[]; omittedCount: number } {
  if (events.length <= REPLAY_WINDOW_SIZE) {
    return { events, omittedCount: 0 };
  }

  let lastAnchorIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (REPLAY_ANCHOR_TYPES.has(events[index]?.type ?? '')) {
      lastAnchorIndex = index;
      break;
    }
  }

  const startIndex = lastAnchorIndex >= 0
    ? Math.max(0, lastAnchorIndex - 6, events.length - REPLAY_WINDOW_SIZE)
    : Math.max(0, events.length - REPLAY_WINDOW_SIZE);

  return {
    events: events.slice(startIndex),
    omittedCount: startIndex,
  };
}

function extractPendingWaitingUser(events: RunTimelineEvent[]): WaitingUserPayload | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    if (event.type === 'waiting_user') {
      return toWaitingUserPayload(event);
    }
    if (
      event.type === 'user_input_received'
      || event.type === 'run_completed'
      || event.type === 'run_failed'
      || event.type === 'run_cancelled'
    ) {
      return null;
    }
  }
  return null;
}

export function useCliSession({
  terminal,
  selectedModelId,
  selectedToolIds,
  selectedRuntimeSurface,
}: UseCliSessionOptions): UseCliSessionReturn {
  const [currentRunId, setCurrentRunId] = useState('');
  const [busyMode, setBusyMode] = useState<BusyMode>('idle');
  const [waitingUser, setWaitingUser] = useState<WaitingUserPayload | null>(null);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [isSending, setIsSending] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const seenEventIds = useRef(new Set<string>());
  const activityCounter = useRef(0);
  const taskKindRef = useRef<string>('');
  const lastSandboxRef = useRef<Record<string, unknown> | null>(null);
  const currentRunIdRef = useRef('');
  const currentRunStatusRef = useRef<RunSummary['status'] | ''>('');

  // Polling for run status while there is an active run
  const { data: currentRun = null } = useQuery<RunSummary>({
    queryKey: ['cli-run', currentRunId],
    queryFn: () =>
      import('../api/client').then((m) => m.getRun(currentRunId)),
    enabled: Boolean(currentRunId),
    // Stop polling once run reaches a terminal state — SSE already delivers real-time updates
    refetchInterval: (query) => {
      const s = (query.state.data as { status?: string } | null)?.status;
      if (s === 'completed' || s === 'failed' || s === 'cancelled') return false;
      return 6000;
    },
  });

  useEffect(() => {
    currentRunIdRef.current = currentRunId;
  }, [currentRunId]);

  useEffect(() => {
    currentRunStatusRef.current = currentRun?.status ?? '';
  }, [currentRun]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const normalizeSandboxEvent = useCallback((event: RunTimelineEvent): RunTimelineEvent => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const mergedSandbox = mergeSandboxDescriptor(lastSandboxRef.current, payload.sandbox);
    if (!mergedSandbox) {
      return event;
    }

    lastSandboxRef.current = mergedSandbox;
    return {
      ...event,
      payload: {
        ...payload,
        sandbox: mergedSandbox,
      },
    };
  }, []);

  const writeTimelineEvent = useCallback((event: RunTimelineEvent) => {
    if (!terminal) return;
    const ansiText = eventToAnsi(event, { taskKind: taskKindRef.current });
    if (ansiText === null) return;
    const inlineTypes = new Set(['text_delta', 'thinking_delta']);
    terminal.write(inlineTypes.has(event.type) ? ansiText : `${ansiText}\r\n`);
  }, [terminal]);

  const buildActivityEvent = useCallback((event: RunTimelineEvent): ActivityEvent | null => {
    if (!ACTIVITY_EVENT_TYPES.has(event.type)) return null;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const timestamp = event.createdAt ? Date.parse(event.createdAt) : Date.now();
    return {
      id: event.eventId ?? `act-${activityCounter.current++}`,
      type: event.type,
      label: labelForActivity(event.type, payload),
      timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
    };
  }, []);

  const appendActivityEvent = useCallback((event: RunTimelineEvent) => {
    const activityItem = buildActivityEvent(event);
    if (!activityItem) return;
    setActivityEvents((prev) => [...prev.slice(-49), activityItem]);
  }, [buildActivityEvent]);

  // Recent runs for session rail + /history
  const { data: rawRuns = [], refetch: refetchRuns } = useQuery<RunSummary[]>({
    queryKey: ['cli-runs-list'],
    queryFn: listRuns,
    refetchInterval: 10000,
  });

  const recentRuns = rawRuns.slice(0, 10).map((r) => ({
    runId: r.runId,
    title: getRunTitle(r),
    status: r.status,
    updatedAt: r.updatedAt ?? r.createdAt ?? '',
  }));

  // ── SSE stream connection ──────────────────────────────────────────────────
  const connectStream = useCallback(
    (runId: string) => {
      clearReconnectTimer();

      // Disconnect previous stream
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const url = buildRunStreamUrl(runId);
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onmessage = (msgEvent) => {
        try {
          const parsedEvent: RunTimelineEvent = JSON.parse(String(msgEvent.data));
          const event = normalizeSandboxEvent(parsedEvent);
          if (!event?.type) return;

          // Deduplicate by eventId
          if (event.eventId && seenEventIds.current.has(event.eventId)) return;
          if (event.eventId) seenEventIds.current.add(event.eventId);

          const payload = (event.payload ?? {}) as Record<string, unknown>;
          reconnectAttemptRef.current = 0;

          // Handle waiting_user — show prompt overlay
          if (event.type === 'waiting_user') {
            setWaitingUser(toWaitingUserPayload(event));
          }

          // Clear waiting_user when run resumes
          if (
            (event.type === 'run_status' && payload.status === 'running')
            || event.type === 'user_input_received'
          ) {
            setWaitingUser(null);
          }

          // Clear waiting_user on completion/failure
          if (
            (event.type === 'run_status' && (payload.status === 'completed' || payload.status === 'failed' || payload.status === 'cancelled'))
            || event.type === 'run_completed'
            || event.type === 'run_failed'
            || event.type === 'run_cancelled'
          ) {
            setWaitingUser(null);
            setBusyMode('idle');

            // For general runs: fetch full artifact response text (preview is truncated to 160 chars)
            if (event.type === 'run_completed' && taskKindRef.current === 'general' && event.runId) {
              const runIdForArtifact = event.runId;
              getRunArtifacts(runIdForArtifact).then((artifacts) => {
                const answer = artifacts.find((a) => a.kind === 'structured-answer');
                const structuredAnswer = answer?.contentJson ? readStructuredAnswer(answer.contentJson) : null;
                const primaryResponse = structuredAnswer?.primaryResponse?.trim();
                const fallbackResponse = typeof (answer?.contentJson as Record<string, unknown> | undefined)?.response === 'string'
                  ? ((answer!.contentJson as Record<string, unknown>).response as string).trim()
                  : null;
                const finalBody = primaryResponse || fallbackResponse;
                if (finalBody && terminal) {
                  terminal.write(`${markdownToAnsi(finalBody)}\r\n`);
                }
              }).catch(() => { /* silently ignore artifact fetch errors */ });
            }
          }

          // Track task kind for output filtering
          if (event.type === 'routed') {
            taskKindRef.current = String(payload.initialCapabilityProfile ?? payload.acceptedTaskKind ?? payload.taskKind ?? '');
          }

          if (event.type === 'capability_switched') {
            taskKindRef.current = String(payload.to ?? taskKindRef.current);
          }

          if (event.type === 'continuation_decision' && payload.decision !== 'stop') {
            taskKindRef.current = String(payload.nextCapabilityProfile ?? payload.currentCapabilityProfile ?? taskKindRef.current);
          }

          // Feed activity lane
          appendActivityEvent(event);

          // Write event to terminal
          writeTimelineEvent(event);
        } catch {
          // ignore parse errors from SSE
        }
      };

      es.onerror = () => {
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }

        if (currentRunIdRef.current !== runId) {
          return;
        }

        const status = currentRunStatusRef.current;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          return;
        }

        reconnectAttemptRef.current += 1;
        const delayMs = Math.min(1000 * reconnectAttemptRef.current, 3000);
        if (terminal && reconnectAttemptRef.current === 1) {
          terminal.write(`${styled.warn('stream disconnected, reconnecting...')}\r\n`);
        }
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (currentRunIdRef.current === runId) {
            connectStream(runId);
          }
        }, delayMs);
      };
    },
    [appendActivityEvent, clearReconnectTimer, terminal, writeTimelineEvent],
  );

  // Connect to stream whenever currentRunId changes
  useEffect(() => {
    if (!currentRunId) return;
    connectStream(currentRunId);
    return () => {
      clearReconnectTimer();
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [clearReconnectTimer, currentRunId, connectStream]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || !terminal) return;
      setIsSending(true);
      const canFollowExistingRun = Boolean(currentRunId) && currentRun?.status !== 'cancelled' && currentRun?.status !== 'failed';

      try {
        // Interrupt mode: cancel first
        if (busyMode === 'interrupt' && currentRunId) {
          terminal.write(`\r\n${styled.warn('[interrupting current run...]')}\r\n`);
          await cancelRun(currentRunId);
          setCurrentRunId('');
          setBusyMode('idle');
        }

        if (!canFollowExistingRun || busyMode === 'interrupt') {
          // Start a new run
          terminal.write(formatUserInput(content));
          const result = await createRun({
            input: { prompt: content, toolIds: selectedToolIds },
            preferredModel: selectedModelId || undefined,
            surface: selectedRuntimeSurface,
          });
          seenEventIds.current.clear();
          taskKindRef.current = '';
          lastSandboxRef.current = null;
          setCurrentRunId(result.runId);
          setActivityEvents([]);
          terminal.write(`${styled.muted(`session ${result.runId.slice(-8)} attached`)}\r\n`);
        } else {
          // Follow-up on existing run
          const mode: RunComposerPayload['mode'] =
            busyMode === 'queue' ? 'queue' : 'steer';
          terminal.write(formatUserInput(content));
          await appendRunMessage(currentRunId, {
            content,
            modelId: selectedModelId || undefined,
            toolIds: selectedToolIds.length ? selectedToolIds : undefined,
            mode,
          });
          // Reconnect SSE stream — the previous stream may have closed when the run
          // completed, so follow-up events would otherwise never arrive.
          // Note: do NOT clear seenEventIds here — we want to avoid re-rendering
          // previous events that replay from the start of the SSE stream.
          if (!eventSourceRef.current) {
            taskKindRef.current = '';
            connectStream(currentRunId);
          }
        }
      } catch (err) {
        terminal.write(`${styled.error(`[error] ${err instanceof Error ? err.message : 'Failed to send message'}`)}\r\n`);
      } finally {
        setIsSending(false);
      }
    },
    [terminal, busyMode, connectStream, currentRun, currentRunId, selectedModelId, selectedRuntimeSurface, selectedToolIds],
  );

  const launchBackgroundRun = useCallback(
    async (content: string) => {
      if (!content.trim() || !terminal) {
        return undefined;
      }

      try {
        terminal.write(formatUserInput(content));
        const result = await createRun({
          input: { prompt: content, toolIds: selectedToolIds },
          preferredModel: selectedModelId || undefined,
          surface: 'background',
        });
        terminal.write(`${styled.success(`[background] queued ${result.runId.slice(-8)}`)}\r\n`);
        terminal.write(`${styled.muted('Track it from /history or the Runs page.')}\r\n`);
        await refetchRuns();
        return result.runId;
      } catch (err) {
        terminal.write(`${styled.error(`[error] ${err instanceof Error ? err.message : 'Failed to start background run'}`)}\r\n`);
        return undefined;
      }
    },
    [terminal, refetchRuns, selectedModelId, selectedToolIds],
  );

  // ── Submit prompt input (waiting_user) ─────────────────────────────────────
  const submitPromptInput = useCallback(
    async (value: string) => {
      if (!currentRunId || !terminal) return;
      try {
        const normalizedValue = value.trim();
        if (!normalizedValue) return;
        const choiceIndex = waitingUser?.choices?.findIndex((choice) => choice === normalizedValue) ?? -1;
        terminal.write(formatUserInput(value));
        setWaitingUser(null);
        await submitRunInput(currentRunId, {
          input: normalizedValue,
          value: normalizedValue,
          ...(choiceIndex >= 0 ? { option: normalizedValue, index: choiceIndex } : {}),
        });
      } catch (err) {
        terminal.write(`${styled.error(`[error] ${err instanceof Error ? err.message : 'Failed to submit input'}`)}\r\n`);
      }
    },
    [currentRunId, terminal, waitingUser],
  );

  // ── Interrupt ──────────────────────────────────────────────────────────────
  const interruptRun = useCallback(async () => {
    if (!currentRunId || !terminal) return;
    try {
      const requestedAt = new Date().toISOString();
      const interruptSandbox = mergeSandboxDescriptor(lastSandboxRef.current, null, {
        state: 'cancelling',
        cancelled: false,
      });
      const interruptEvent = {
        eventId: `local_interrupt_${Date.now()}`,
        runId: currentRunId,
        type: 'interrupt_requested',
        payload: {
          reason: 'user_cancelled',
          ...(interruptSandbox ? { sandbox: interruptSandbox } : {}),
        },
        createdAt: requestedAt,
      } as RunTimelineEvent;
      appendActivityEvent(interruptEvent);
      writeTimelineEvent(interruptEvent);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      await cancelRun(currentRunId);
      const cancelledSandbox = mergeSandboxDescriptor(interruptSandbox, null, {
        state: 'cancelled',
        cancelled: true,
      });
      lastSandboxRef.current = cancelledSandbox;
      const cancelledEvent = {
        eventId: `local_cancel_${Date.now()}`,
        runId: currentRunId,
        type: 'run_cancelled',
        payload: {
          status: 'cancelled',
          reason: 'user_cancelled',
          ...(cancelledSandbox ? { sandbox: cancelledSandbox } : {}),
        },
        createdAt: new Date().toISOString(),
      } as RunTimelineEvent;
      appendActivityEvent(cancelledEvent);
      writeTimelineEvent(cancelledEvent);
      setCurrentRunId('');
      setBusyMode('idle');
      setWaitingUser(null);
    } catch (err) {
      terminal.write(`${styled.error(`[error] ${err instanceof Error ? err.message : 'Cancel failed'}`)}\r\n`);
    }
  }, [appendActivityEvent, currentRunId, terminal, writeTimelineEvent]);

  // ── New session ────────────────────────────────────────────────────────────
  const startNewSession = useCallback(() => {
    clearReconnectTimer();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    seenEventIds.current.clear();
    taskKindRef.current = '';
    lastSandboxRef.current = null;
    setCurrentRunId('');
    setBusyMode('idle');
    setWaitingUser(null);
    setActivityEvents([]);
    if (terminal) {
      terminal.write(hr());
      terminal.write(welcomeBanner());
    }
  }, [clearReconnectTimer, terminal]);

  // ── Resume session ─────────────────────────────────────────────────────────
  const resumeSession = useCallback(
    async (runId: string) => {
      if (!terminal) return;
      try {
        const [snapshot, events] = await Promise.all([
          getRun(runId),
          getRunEvents(runId),
        ]);
        const replayWindow = buildReplayWindow(events);
        lastSandboxRef.current = null;
        seenEventIds.current = new Set(events.map((event) => event.eventId).filter((eventId): eventId is string => Boolean(eventId)));
        taskKindRef.current = resolveRunCurrentCapability(snapshot) ?? snapshot.taskKind;
        const normalizedEvents = replayWindow.events.map((event) => normalizeSandboxEvent(event));
        setActivityEvents(normalizedEvents.map((event) => buildActivityEvent(event)).filter((event): event is ActivityEvent => event !== null));
        setWaitingUser(extractPendingWaitingUser(events));
        setCurrentRunId(runId);
        terminal.write(hr());
        terminal.write(`${styled.system(`attach ${runId.slice(-8)}`)}\r\n`);
        if (replayWindow.omittedCount > 0) {
          terminal.write(`${styled.system(`replay ${normalizedEvents.length} of ${events.length} events`)}\r\n`);
        }
        for (const event of normalizedEvents) {
          writeTimelineEvent(event);
        }
      } catch {
        clearReconnectTimer();
        seenEventIds.current.clear();
        lastSandboxRef.current = null;
        setActivityEvents([]);
        setWaitingUser(null);
        setCurrentRunId(runId);
        terminal.write(hr());
        terminal.write(`${styled.system(`attach ${runId.slice(-8)}`)}\r\n`);
        terminal.write(`${styled.warn('history replay unavailable')}\r\n`);
      }
    },
    [buildActivityEvent, clearReconnectTimer, normalizeSandboxEvent, terminal, writeTimelineEvent],
  );

  return {
    currentRunId,
    currentRun,
    busyMode,
    setBusyMode,
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
  };
}
