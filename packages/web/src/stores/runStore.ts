/**
 * runStore — Harness Run Zustand store
 * Manages run-first workbench state: active run, timeline events, artifacts.
 */
import { create } from 'zustand';
import type {
  RunSummary,
  RunTimelineEvent,
  RunArtifactRecord,
} from '../api/client';

interface RunStoreState {
  /** Currently active run in the workbench */
  activeRunId: string | null;
  /** Run list cache */
  runs: RunSummary[];
  /** Run detail cache by ID */
  runsById: Record<string, RunSummary>;
  /** Timeline events per run */
  eventsById: Record<string, RunTimelineEvent[]>;
  /** Artifacts per run */
  artifactsById: Record<string, RunArtifactRecord[]>;
  /** Loading flags */
  loadingList: boolean;
  loadingDetail: boolean;

  setActiveRunId: (id: string | null) => void;
  setRuns: (runs: RunSummary[]) => void;
  setRunDetail: (run: RunSummary) => void;
  appendEvent: (runId: string, event: RunTimelineEvent) => void;
  setEvents: (runId: string, events: RunTimelineEvent[]) => void;
  setArtifacts: (runId: string, artifacts: RunArtifactRecord[]) => void;
  setLoadingList: (loading: boolean) => void;
  setLoadingDetail: (loading: boolean) => void;
  reset: () => void;
}

const initialState = {
  activeRunId: null,
  runs: [],
  runsById: {},
  eventsById: {},
  artifactsById: {},
  loadingList: false,
  loadingDetail: false,
};

export const useRunStore = create<RunStoreState>((set) => ({
  ...initialState,

  setActiveRunId: (id) => set({ activeRunId: id }),

  setRuns: (runs) =>
    set({
      runs,
      runsById: Object.fromEntries(runs.map((r) => [r.runId, r])),
    }),

  setRunDetail: (run) =>
    set((state) => ({
      runsById: { ...state.runsById, [run.runId]: run },
    })),

  appendEvent: (runId, event) =>
    set((state) => ({
      eventsById: {
        ...state.eventsById,
        [runId]: [...(state.eventsById[runId] ?? []), event],
      },
    })),

  setEvents: (runId, events) =>
    set((state) => ({
      eventsById: { ...state.eventsById, [runId]: events },
    })),

  setArtifacts: (runId, artifacts) =>
    set((state) => ({
      artifactsById: { ...state.artifactsById, [runId]: artifacts },
    })),

  setLoadingList: (loading) => set({ loadingList: loading }),
  setLoadingDetail: (loading) => set({ loadingDetail: loading }),

  reset: () => set(initialState),
}));
