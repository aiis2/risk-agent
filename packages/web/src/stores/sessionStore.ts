/**
 * sessionStore — 分析会话 Zustand store
 * project-structure.md §stores/sessionStore.ts
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface WorkspaceSessionRecord {
  sessionId: string;
  businessName: string;
  status?: string;
  phase?: string;
  openedAt: string;
  lastViewedAt: string;
}

interface OpenSessionOptions {
  activate?: boolean;
}

const SESSION_WORKSPACE_STORAGE_KEY = 'risk-agent-session-workspace';

interface SessionStoreState {
  /** 当前激活的会话 ID（NewAnalysis 页面使用） */
  activeSessionId: string | null;
  /** 工作台中打开的会话顺序 */
  openSessionIds: string[];
  /** 打开的会话元数据 */
  sessionsById: Record<string, WorkspaceSessionRecord>;
  /** 过滤条件：状态 */
  filterStatus: string;
  /** 过滤条件：关键词 */
  filterKeyword: string;
  openSession: (session: Pick<WorkspaceSessionRecord, 'sessionId' | 'businessName' | 'status' | 'phase'>, options?: OpenSessionOptions) => void;
  closeSession: (id: string) => void;
  syncSessionMeta: (id: string, patch: Partial<Pick<WorkspaceSessionRecord, 'businessName' | 'status' | 'phase'>>) => void;
  setActiveSessionId: (id: string | null) => void;
  setFilterStatus: (status: string) => void;
  setFilterKeyword: (kw: string) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStoreState>()(
  persist(
    (set) => ({
      activeSessionId: null,
      openSessionIds: [],
      sessionsById: {},
      filterStatus: '',
      filterKeyword: '',
      openSession: (session, options) =>
        set((state) => {
          const now = new Date().toISOString();
          const existing = state.sessionsById[session.sessionId];
          const activate = options?.activate ?? true;

          return {
            activeSessionId: activate ? session.sessionId : state.activeSessionId,
            openSessionIds: existing ? state.openSessionIds : [...state.openSessionIds, session.sessionId],
            sessionsById: {
              ...state.sessionsById,
              [session.sessionId]: {
                sessionId: session.sessionId,
                businessName: session.businessName,
                status: session.status ?? existing?.status,
                phase: session.phase ?? existing?.phase,
                openedAt: existing?.openedAt ?? now,
                lastViewedAt: activate ? now : existing?.lastViewedAt ?? now,
              },
            },
          };
        }),
      closeSession: (id) =>
        set((state) => {
          if (!state.sessionsById[id]) return state;

          const currentIndex = state.openSessionIds.indexOf(id);
          const openSessionIds = state.openSessionIds.filter((sessionId) => sessionId !== id);
          const sessionsById = { ...state.sessionsById };
          delete sessionsById[id];

          const fallbackId =
            currentIndex > 0
              ? openSessionIds[currentIndex - 1] ?? null
              : openSessionIds[currentIndex] ?? openSessionIds.at(-1) ?? null;

          return {
            activeSessionId: state.activeSessionId === id ? fallbackId : state.activeSessionId,
            openSessionIds,
            sessionsById,
          };
        }),
      syncSessionMeta: (id, patch) =>
        set((state) => {
          const existing = state.sessionsById[id];
          if (!existing) return state;

          return {
            sessionsById: {
              ...state.sessionsById,
              [id]: {
                ...existing,
                ...(patch.businessName !== undefined ? { businessName: patch.businessName } : null),
                ...(patch.status !== undefined ? { status: patch.status } : null),
                ...(patch.phase !== undefined ? { phase: patch.phase } : null),
              },
            },
          };
        }),
      setActiveSessionId: (id) =>
        set((state) => {
          if (!id) return { activeSessionId: null };

          const existing = state.sessionsById[id];
          if (!existing) return { activeSessionId: id };

          return {
            activeSessionId: id,
            sessionsById: {
              ...state.sessionsById,
              [id]: {
                ...existing,
                lastViewedAt: new Date().toISOString(),
              },
            },
          };
        }),
      setFilterStatus: (status) => set({ filterStatus: status }),
      setFilterKeyword: (kw) => set({ filterKeyword: kw }),
      reset: () =>
        set({
          activeSessionId: null,
          openSessionIds: [],
          sessionsById: {},
          filterStatus: '',
          filterKeyword: '',
        }),
    }),
    {
      name: SESSION_WORKSPACE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeSessionId: state.activeSessionId,
        openSessionIds: state.openSessionIds,
        sessionsById: state.sessionsById,
        filterStatus: state.filterStatus,
        filterKeyword: state.filterKeyword,
      }),
    }
  )
);
