import { buildTool, type AgentToolDefinition } from '@risk-agent/core';
import {
  loadAppPreferences,
  maskAppPreferences,
  savePreferencesPatch,
  type AppPreferencesPatch,
} from '../preferences/appPreferences.js';

interface StructuredStoreLike {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
}

interface SystemSettingsToolInput {
  action: 'get' | 'update';
  updates?: AppPreferencesPatch;
}

export function createSystemSettingsTool(store: StructuredStoreLike): AgentToolDefinition<SystemSettingsToolInput> {
  return buildTool<SystemSettingsToolInput>({
    name: 'system_settings',
    description: '读取或更新持久化系统设置，包括默认模型、运行上限，以及 web search 服务商与 API key 等配置。' +
      '当其他工具出现配置类错误（API key 缺失、provider 不可用、browser host 策略不匹配等）时，优先调用 action="get" 检查当前配置，诊断问题后再决定是否调用 action="update" 修复。',
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: 'settings preferences tavily api key web search 配置 默认模型 主题 语言',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'update'],
        },
        updates: {
          type: 'object',
          properties: {
            uiLocale: { type: 'string' },
            reportLocale: { type: 'string' },
            themeMode: { type: 'string' },
            defaultModel: { type: 'string' },
            maxTurns: { type: 'number' },
            compactThresholdTokens: { type: 'number' },
            webSearch: {
              type: 'object',
              properties: {
                defaultProvider: { type: 'string' },
                includeDate: { type: 'boolean' },
                resultCount: { type: 'number' },
                compressionMethod: { type: 'string', enum: ['none', 'summary', 'extract'] },
                blacklist: { type: 'string' },
                providerEnabled: { type: 'object', additionalProperties: { type: 'boolean' } },
                providerApiKey: { type: 'object', additionalProperties: { type: 'string' } },
                providerEndpoint: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
            browserRuntime: {
              type: 'object',
              properties: {
                defaultProvider: { type: 'string', enum: ['embedded-first', 'external-preferred', 'external-only'] },
                defaultWorkspaceMode: { type: 'string', enum: ['exclusive', 'global-shared'] },
                allowManualAttach: { type: 'boolean' },
                allowSharedContribution: { type: 'boolean' },
                externalBrowserMode: { type: 'string', enum: ['system-default', 'configured'] },
                externalBrowserExecutable: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async execute(input) {
      if (input.action === 'get') {
        return {
          ok: true,
          preferences: maskAppPreferences(await loadAppPreferences(store)),
        };
      }

      const updates = input.updates ?? {};
      const preferences = await savePreferencesPatch(store, updates);
      return {
        ok: true,
        updatedKeys: Object.keys(updates),
        preferences: maskAppPreferences(preferences),
      };
    },
  });
}