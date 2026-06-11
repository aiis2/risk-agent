/**
 * Custom Agents API client — v3.3 自定义代理接口
 * (agent-framework.md §29)
 */

import { api } from './client';

export interface CustomAgentSummary {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  temperature?: number;
  sourcePath: string;
  layer: 'project' | 'user' | 'system';
}

export interface CustomAgentDetail extends CustomAgentSummary {
  systemPrompt: string;
}

export const listCustomAgents = () =>
  api.get<{ success: boolean; data: CustomAgentSummary[] }>('/custom-agents').then((r) => r.data.data);

export const getCustomAgent = (name: string) =>
  api.get<{ success: boolean; data: CustomAgentDetail }>(`/custom-agents/${encodeURIComponent(name)}`).then((r) => r.data.data);
