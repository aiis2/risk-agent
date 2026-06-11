/**
 * uiStore — 全局 UI 状态 store
 * project-structure.md §stores/uiStore.ts
 *
 * 注意：主要的 useUIStore 在 hooks/useUIStore.ts，此文件作为 stores/ 目录的
 * 统一出口，方便其他模块从 stores/ 路径导入。
 */
export { useUIStore } from '../hooks/useUIStore';
export type { NavPage } from '../hooks/useUIStore';
