import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NavPage = 'dashboard' | 'scenarios' | 'rules' | 'analyze' | 'reports' | 'settings';

const SIDEBAR_COLLAPSE_THRESHOLD = 160;
const SIDEBAR_DEFAULT_WIDTH = 240;

interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activePage: NavPage;
  activeSessionId: string | null;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;
  setActivePage: (page: NavPage) => void;
  setActiveSession: (id: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      activePage: 'dashboard',
      activeSessionId: null,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setSidebarWidth: (w) => set({
        sidebarWidth: w,
        sidebarCollapsed: w < SIDEBAR_COLLAPSE_THRESHOLD,
      }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActivePage: (page) => set({ activePage: page, activeSessionId: null }),
      setActiveSession: (id) => set({ activeSessionId: id, activePage: 'analyze' }),
    }),
    {
      name: 'risk-agent-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarWidth: state.sidebarWidth,
      }),
    }
  )
);
