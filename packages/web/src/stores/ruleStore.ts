/**
 * ruleStore — 规则管理 Zustand store（Track B）
 * project-structure.md §stores/ruleStore.ts
 */
import { create } from 'zustand';
import type { Rule } from '../api/client';

interface RuleStoreState {
  /** 过滤：业务类型 */
  filterBizType: string;
  /** 过滤：风险等级 */
  filterRiskLevel: string;
  /** 过滤：关键词 */
  filterKeyword: string;
  /** NL 解析候选结果 */
  parsedCandidates: Partial<Rule>[];
  /** NL 解析来源标识 */
  parseSource: string | null;

  setFilterBizType: (v: string) => void;
  setFilterRiskLevel: (v: string) => void;
  setFilterKeyword: (kw: string) => void;
  setParsedCandidates: (candidates: Partial<Rule>[], source?: string) => void;
  clearCandidates: () => void;
  clearFilters: () => void;
}

export const useRuleStore = create<RuleStoreState>((set) => ({
  filterBizType: '',
  filterRiskLevel: '',
  filterKeyword: '',
  parsedCandidates: [],
  parseSource: null,

  setFilterBizType: (v) => set({ filterBizType: v }),
  setFilterRiskLevel: (v) => set({ filterRiskLevel: v }),
  setFilterKeyword: (kw) => set({ filterKeyword: kw }),
  setParsedCandidates: (candidates, source?: string) =>
    set({ parsedCandidates: candidates, parseSource: source ?? null }),
  clearCandidates: () => set({ parsedCandidates: [], parseSource: null }),
  clearFilters: () => set({ filterBizType: '', filterRiskLevel: '', filterKeyword: '' }),
}));
