/**
 * storageSettingsStore — 存储设置页面状态机（Zustand）
 * settings-center-frontend-mapping.md §4.1 + §4.2
 * settings-center-ui.md §4.1
 */
import { create } from 'zustand';
import type { ActiveStorageState, StorageConfigRevision, StorageMigrationJob, StorageProfile, ValidateStorageConfigResponse } from '../api/storageSettings';

// ─── 页面状态机类型 ───────────────────────────────────────────────────────────

export type StoragePageState =
  | 'loading'
  | 'ready'
  | 'dirty'
  | 'validating'
  | 'validated'
  | 'apply-pending'
  | 'applying'
  | 'rollback-pending'
  | 'rolling-back'
  | 'migrating'
  | 'error';

// ─── Storage Settings Store ───────────────────────────────────────────────────

interface StorageSettingsState {
  current: ActiveStorageState | null;
  candidateConfig: Record<string, unknown>;
  candidateProfile: StorageProfile;
  validation: ValidateStorageConfigResponse | null;
  revisions: StorageConfigRevision[];
  pageState: StoragePageState;
  dirty: boolean;
  loadingCurrent: boolean;
  loadingHistory: boolean;
  errorMessage?: string;

  // Dialog open flags (uiStore subset)
  applyDialogOpen: boolean;
  rollbackDialogOpen: boolean;
  migrationDialogOpen: boolean;
  selectedRevisionId?: string;
  detailJobId?: string;
}

interface StorageSettingsActions {
  setCurrent: (s: ActiveStorageState | null) => void;
  setCandidateConfig: (cfg: Record<string, unknown>, profile?: StorageProfile) => void;
  setValidation: (v: ValidateStorageConfigResponse | null) => void;
  setRevisions: (r: StorageConfigRevision[]) => void;
  setPageState: (s: StoragePageState) => void;
  setDirty: (v: boolean) => void;
  setError: (msg?: string) => void;

  openApplyDialog: () => void;
  closeApplyDialog: () => void;
  openRollbackDialog: (revisionId?: string) => void;
  closeRollbackDialog: () => void;
  openMigrationDialog: () => void;
  closeMigrationDialog: () => void;
  openJobDetail: (jobId: string) => void;
  closeJobDetail: () => void;

  reset: () => void;
}

const DEFAULT_CONFIG: Record<string, unknown> = {
  structured: { backend: 'sqlite', url: '' },
  vector:     { backend: 'json' },
  graph:      { backend: 'graphology' },
  object:     { backend: 'none' },
};

export const useStorageSettingsStore = create<StorageSettingsState & StorageSettingsActions>((set) => ({
  current: null,
  candidateConfig: DEFAULT_CONFIG,
  candidateProfile: 'embedded',
  validation: null,
  revisions: [],
  pageState: 'loading',
  dirty: false,
  loadingCurrent: false,
  loadingHistory: false,
  errorMessage: undefined,

  applyDialogOpen: false,
  rollbackDialogOpen: false,
  migrationDialogOpen: false,
  selectedRevisionId: undefined,
  detailJobId: undefined,

  setCurrent: (s) => set({ current: s, loadingCurrent: false }),
  setCandidateConfig: (cfg, profile) => set((st) => ({
    candidateConfig: cfg,
    candidateProfile: profile ?? st.candidateProfile,
    dirty: true,
    validation: null,
    pageState: 'dirty',
  })),
  setValidation: (v) => set({ validation: v, pageState: v ? 'validated' : 'dirty' }),
  setRevisions: (r) => set({ revisions: r, loadingHistory: false }),
  setPageState: (s) => set({ pageState: s }),
  setDirty: (v) => set({ dirty: v }),
  setError: (msg) => set({ errorMessage: msg, pageState: msg ? 'error' : 'ready' }),

  openApplyDialog: () => set({ applyDialogOpen: true, pageState: 'apply-pending' }),
  closeApplyDialog: () => set({ applyDialogOpen: false }),
  openRollbackDialog: (revisionId) => set({ rollbackDialogOpen: true, selectedRevisionId: revisionId, pageState: 'rollback-pending' }),
  closeRollbackDialog: () => set({ rollbackDialogOpen: false }),
  openMigrationDialog: () => set({ migrationDialogOpen: true }),
  closeMigrationDialog: () => set({ migrationDialogOpen: false }),
  openJobDetail: (jobId) => set({ detailJobId: jobId }),
  closeJobDetail: () => set({ detailJobId: undefined }),

  reset: () => set({
    candidateConfig: DEFAULT_CONFIG,
    candidateProfile: 'embedded',
    validation: null,
    dirty: false,
    pageState: 'ready',
    errorMessage: undefined,
    applyDialogOpen: false,
    rollbackDialogOpen: false,
    migrationDialogOpen: false,
    selectedRevisionId: undefined,
    detailJobId: undefined,
  }),
}));

// ─── Migration Jobs Store ─────────────────────────────────────────────────────

interface StorageJobsState {
  migrationJobs: StorageMigrationJob[];
  activeJobId?: string;
  polling: boolean;
  pollingIntervalMs: number;
  errorMessage?: string;
}

interface StorageJobsActions {
  setJobs: (jobs: StorageMigrationJob[]) => void;
  upsertJob: (job: StorageMigrationJob) => void;
  setActiveJobId: (id?: string) => void;
  setPolling: (v: boolean) => void;
}

export const useStorageJobsStore = create<StorageJobsState & StorageJobsActions>((set) => ({
  migrationJobs: [],
  activeJobId: undefined,
  polling: false,
  pollingIntervalMs: 5000,
  errorMessage: undefined,

  setJobs: (jobs) => set({ migrationJobs: jobs }),
  upsertJob: (job) => set((st) => {
    const existing = st.migrationJobs.findIndex((j) => j.jobId === job.jobId);
    if (existing >= 0) {
      const jobs = [...st.migrationJobs];
      jobs[existing] = job;
      return { migrationJobs: jobs };
    }
    return { migrationJobs: [job, ...st.migrationJobs] };
  }),
  setActiveJobId: (id) => set({ activeJobId: id }),
  setPolling: (v) => set({ polling: v }),
}));
