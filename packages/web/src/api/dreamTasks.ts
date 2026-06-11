/**
 * Dream Tasks API client — v3.3 后台异步任务接口
 * (agent-framework.md §30)
 */

import { api } from './client';

export type DreamTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DreamTaskState {
  id: string;
  description: string;
  status: DreamTaskStatus;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  progress: string[];
}

export const listDreamTasks = (status?: DreamTaskStatus) =>
  api.get<{ success: boolean; data: DreamTaskState[] }>('/dream-tasks', {
    params: status ? { status } : undefined,
  }).then((r) => r.data.data);

export const getDreamTask = (id: string) =>
  api.get<{ success: boolean; data: DreamTaskState }>(`/dream-tasks/${id}`).then((r) => r.data.data);

export const cancelDreamTask = (id: string) =>
  api.delete<{ success: boolean }>(`/dream-tasks/${id}`).then((r) => r.data);

export const cleanupDreamTasks = () =>
  api.post<{ success: boolean; data: { removed: number } }>('/dream-tasks/cleanup').then((r) => r.data.data);
