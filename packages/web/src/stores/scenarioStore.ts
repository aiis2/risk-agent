/**
 * scenarioStore — 业务场景 Zustand store（Track A）
 * project-structure.md §stores/scenarioStore.ts
 */
import { create } from 'zustand';
import type { Scenario } from '../api/client';

interface ScenarioStoreState {
  /** 当前选中的场景 ID（分析时预选） */
  selectedIds: string[];
  /** 过滤关键词 */
  filterKeyword: string;
  /** 过滤状态 */
  filterStatus: string;
  /** 本地草稿（未保存到服务端） */
  draftForm: Partial<Scenario> | null;

  setSelectedIds: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setFilterKeyword: (kw: string) => void;
  setFilterStatus: (status: string) => void;
  setDraftForm: (form: Partial<Scenario> | null) => void;
  clearFilters: () => void;
}

export const useScenarioStore = create<ScenarioStoreState>((set, get) => ({
  selectedIds: [],
  filterKeyword: '',
  filterStatus: '',
  draftForm: null,

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) => {
    const { selectedIds } = get();
    set({
      selectedIds: selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    });
  },
  setFilterKeyword: (kw) => set({ filterKeyword: kw }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setDraftForm: (form) => set({ draftForm: form }),
  clearFilters: () => set({ filterKeyword: '', filterStatus: '' }),
}));
