/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { usePreferenceStore } from '../../stores/preferenceStore';

const apiMocks = vi.hoisted(() => ({
  discoverModels: vi.fn(),
  createModel: vi.fn(),
  deleteModel: vi.fn(),
  listModels: vi.fn(),
  getPreferences: vi.fn(),
  putPreferences: vi.fn(),
  testWebSearch: vi.fn(),
  testModel: vi.fn(),
  updateModel: vi.fn(),
  listSkills: vi.fn(),
  listTools: vi.fn(),
  getSkillTree: vi.fn(),
  getSkillFile: vi.fn(),
  createSkill: vi.fn(),
  deleteSkill: vi.fn(),
  testSkill: vi.fn(),
  importSkillPackage: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  discoverModels: apiMocks.discoverModels,
  createModel: apiMocks.createModel,
  deleteModel: apiMocks.deleteModel,
  listModels: apiMocks.listModels,
  getPreferences: apiMocks.getPreferences,
  putPreferences: apiMocks.putPreferences,
  testWebSearch: apiMocks.testWebSearch,
  testModel: apiMocks.testModel,
  updateModel: apiMocks.updateModel,
  listSkills: apiMocks.listSkills,
  listTools: apiMocks.listTools,
  getSkillTree: apiMocks.getSkillTree,
  getSkillFile: apiMocks.getSkillFile,
  createSkill: apiMocks.createSkill,
  deleteSkill: apiMocks.deleteSkill,
  testSkill: apiMocks.testSkill,
  importSkillPackage: apiMocks.importSkillPackage,
}));

vi.mock('../../components/Settings/General/LanguageSettingsCard', () => ({
  LanguageSettingsCard: () => <div>Language Settings</div>,
}));

vi.mock('../../components/Settings/General/ThemeSettingsCard', () => ({
  ThemeSettingsCard: () => <div>Theme Settings</div>,
}));

vi.mock('../../components/Settings/Storage/StorageSettingsPage', () => ({
  StorageSettingsPage: () => <div>Storage Settings</div>,
}));

vi.mock('../../components/Settings/Observability/ObservabilityTab', () => ({
  ObservabilityTab: () => <div>Observability</div>,
}));

vi.mock('../../components/Settings/DataSources/DatasourcesTab', () => ({
  DatasourcesTab: () => <div>Datasources</div>,
}));

vi.mock('../../components/Settings/MCP/MCPManagementTab', () => ({
  MCPManagementTab: () => <div>MCP</div>,
}));

vi.mock('../../components/Settings/Security/SecurityTab', () => ({
  SecurityTab: () => <div>Security</div>,
}));

vi.mock('../../components/Settings/Agents/CustomAgentsTab', () => ({
  CustomAgentsTab: () => <div>Agents</div>,
}));

vi.mock('../../components/Settings/Desktop/DesktopSettingsPanel', () => ({
  DesktopSettingsPanel: () => <div>Desktop</div>,
}));

vi.mock('../../lib/electron', () => ({
  isElectron: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

import { Settings } from '../Settings';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  usePreferenceStore.setState({
    uiLocale: 'zh-CN',
    reportLocale: 'zh-CN',
    themeMode: 'system',
    dirty: false,
    saving: false,
    translationReady: false,
    missingKeysCount: 0,
    errorMessage: undefined,
  });

  window.localStorage.clear();
});

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('Settings skills/tools separation', () => {
  it('uses a responsive settings rail that stacks above content on narrow screens', async () => {
    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([]);

    renderSettings();

    const rail = await screen.findByTestId('settings-section-rail');
    const tabList = screen.getByTestId('settings-section-tabs');
    const content = screen.getByTestId('settings-content');

    expect(rail.className).toContain('w-full');
    expect(rail.className).toContain('lg:w-[240px]');
    expect(rail.className).toContain('lg:h-[100dvh]');
    expect(tabList.className).toContain('overflow-x-auto');
    expect(tabList.className).toContain('lg:overflow-auto');
    expect(content.className).toContain('min-w-0');
  });

  it('hides internal document references from the context settings card', async () => {
    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([]);

    renderSettings();

    expect(await screen.findByText('上下文管理')).toBeTruthy();
    expect(screen.getByText('控制单次分析的最大轮次与自动压缩阈值。')).toBeTruthy();
    expect(screen.queryByText(/09-context-management\.md/i)).toBeNull();
  });

  it('renders a dedicated tools menu and keeps the skills page free of an internal tools toggle', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({ maxTurns: 30, compactThresholdTokens: 80000 });
    apiMocks.listModels.mockResolvedValue([]);
    apiMocks.listSkills.mockResolvedValue({
      data: [
        {
          name: 'find-skills',
          description: 'Discover installed skills',
          source: 'bundled',
          tags: ['discover'],
        },
      ],
    });
    apiMocks.listTools.mockResolvedValue({
      total: 1,
      tools: [
        {
          name: 'search_subagent',
          description: 'Search codebase context',
          aliases: [],
          isReadOnly: true,
          isDestructive: false,
          isConcurrencySafe: true,
          isOpenWorld: false,
          deferred: false,
          alwaysLoad: false,
          inputSchema: { type: 'object' },
        },
      ],
    });
    apiMocks.getSkillTree.mockResolvedValue([{ path: 'SKILL.md', type: 'file' }]);
    apiMocks.getSkillFile.mockResolvedValue({ path: 'SKILL.md', content: '# find-skills', encoding: 'utf-8' });

    renderSettings();

    await user.click(screen.getByRole('button', { name: 'skills' }));

    await screen.findByText(/已安装\s*\(1\)/);
    expect(screen.queryByRole('button', { name: '工具注册表' })).toBeNull();

    const toolsMenuButton = screen.getByRole('button', { name: 'tools' });
    await user.click(toolsMenuButton);

    await waitFor(() => {
      expect(screen.getByText('工具注册表')).toBeTruthy();
    });
  });

  it('cycles sidebar themes in order and persists each switch', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([]);
    apiMocks.putPreferences.mockResolvedValue({ ok: true });

    renderSettings();

    const switcher = screen.getByRole('button', { name: /快速切换主题/i });

    await user.click(switcher);
    await waitFor(() => {
      expect(apiMocks.putPreferences).toHaveBeenLastCalledWith({ themeMode: 'midnight' });
    });
    expect(usePreferenceStore.getState().themeMode).toBe('midnight');

    await user.click(switcher);
    await waitFor(() => {
      expect(apiMocks.putPreferences).toHaveBeenLastCalledWith({ themeMode: 'paper' });
    });
    expect(usePreferenceStore.getState().themeMode).toBe('paper');

    await user.click(switcher);
    await waitFor(() => {
      expect(apiMocks.putPreferences).toHaveBeenLastCalledWith({ themeMode: 'sea' });
    });
    expect(usePreferenceStore.getState().themeMode).toBe('sea');

    await user.click(switcher);
    await waitFor(() => {
      expect(apiMocks.putPreferences).toHaveBeenLastCalledWith({ themeMode: 'system' });
    });
    expect(usePreferenceStore.getState().themeMode).toBe('system');
  });

  it('defaults model tests to lightweight connect mode', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([
      {
        modelId: 'model-1',
        provider: 'openai-compatible',
        modelName: 'qwen3.5-plus',
        config: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-22T00:00:00.000Z',
      },
    ]);
    apiMocks.testModel.mockResolvedValue({
      success: true,
      mode: 'connect',
      provider: 'openai-compatible',
      modelName: 'qwen3.5-plus',
      text: 'Connected successfully (200)',
      durationMs: 24,
    });

    renderSettings();

    await user.click(screen.getByRole('button', { name: 'models' }));
    await user.click(await screen.findByTitle('测试连接'));

    expect(screen.queryByLabelText('测试提示词')).toBeNull();

    await user.click(screen.getByRole('button', { name: '开始测试' }));

    await waitFor(() => {
      expect(apiMocks.testModel).toHaveBeenCalledWith('model-1', { mode: 'connect' });
    });
  });

  it('clears and disables mock default selection when real models are available', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([
      {
        modelId: 'mock-default',
        provider: 'mock',
        modelName: 'browser-sandbox-check',
        config: { scripts: [] },
        enabled: true,
        isDefault: true,
        createdAt: '2026-04-22T00:00:00.000Z',
      },
      {
        modelId: 'real-model',
        provider: 'openrouter',
        modelName: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        config: { baseUrl: 'https://openrouter.ai/api/v1' },
        enabled: true,
        isDefault: false,
        createdAt: '2026-04-21T00:00:00.000Z',
      },
    ]);
    apiMocks.updateModel.mockResolvedValue({ modelId: 'mock-default' });

    renderSettings();

    await user.click(screen.getByRole('button', { name: 'models' }));
    fireEvent.click((await screen.findAllByTitle('编辑'))[0]!);

    const dialog = await screen.findByRole('dialog');
    const switches = within(dialog).getAllByRole('switch');

    await waitFor(() => {
      expect((switches[1] as HTMLElement).hasAttribute('disabled')).toBe(true);
      expect(switches[1]?.getAttribute('data-state')).toBe('unchecked');
    });
    expect(within(dialog).getByText('存在可用真实模型时，Mock 仅保留为调试入口，不能作为默认模型。')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(apiMocks.updateModel).toHaveBeenCalledWith(
        'mock-default',
        expect.objectContaining({
          provider: 'mock',
          isDefault: false,
        }),
      );
    });
  });

  it('renders provider-specific local search settings and saves Baidu as the default provider', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
      webSearch: {
        defaultProvider: 'searxng',
        includeDate: true,
        resultCount: 5,
        compressionMethod: 'none',
        blacklist: '',
        providerEnabled: {
          tavily: true,
          searxng: true,
          bing: true,
          baidu: true,
        },
        providerApiKey: {
          tavily: 'tvly-demo-key',
        },
        providerEndpoint: {
          searxng: 'http://localhost:8080',
        },
      },
    });
    apiMocks.listModels.mockResolvedValue([]);
    apiMocks.putPreferences.mockResolvedValue({ ok: true });

    renderSettings();

    await user.click(screen.getByRole('button', { name: 'websearch' }));
    await screen.findByText('API 服务商');

    await user.click(screen.getByRole('button', { name: /Baidu/i }));

    expect(await screen.findByText('本地搜索设置')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开 Baidu 设置' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '设为默认' }));
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(apiMocks.putPreferences).toHaveBeenLastCalledWith({
        webSearch: expect.objectContaining({
          defaultProvider: 'baidu',
        }),
      });
    });
  });

  it('shows Cherry-style model metadata fields and persists them in model config', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([
      {
        modelId: 'model-1',
        provider: 'openai-compatible',
        modelName: 'kimi-k2.5',
        config: {
          baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
          displayName: 'kimi-k2.5',
          groupName: 'kimi-k2.5',
        },
        enabled: true,
        isDefault: false,
        createdAt: '2026-05-09T00:00:00.000Z',
      },
    ]);
    apiMocks.updateModel.mockResolvedValue({
      modelId: 'model-1',
      provider: 'openai-compatible',
      modelName: 'kimi-k2.5',
      config: {
        baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
        displayName: 'Kimi K2.5',
        groupName: 'Moonshot',
      },
      enabled: true,
      isDefault: false,
      createdAt: '2026-05-09T00:00:00.000Z',
    });

    renderSettings();

    await user.click(screen.getByRole('button', { name: 'models' }));
    fireEvent.click((await screen.findAllByTitle('编辑'))[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('模型 ID')).toBeTruthy();
    expect(within(dialog).getByLabelText('模型名称')).toBeTruthy();
    expect(within(dialog).getByLabelText('分组名称')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Base URL')).toBeNull();
    expect(within(dialog).queryByLabelText('API Key')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: '更多设置' }));
    expect(within(dialog).queryByLabelText('Base URL')).toBeNull();
    expect(within(dialog).queryByLabelText('API Key')).toBeNull();
    expect(within(dialog).getByText('连接设置由当前服务商统一管理')).toBeTruthy();

    await user.clear(within(dialog).getByLabelText('模型名称'));
    await user.type(within(dialog).getByLabelText('模型名称'), 'Kimi K2.5');
    await user.clear(within(dialog).getByLabelText('分组名称'));
    await user.type(within(dialog).getByLabelText('分组名称'), 'Moonshot');
    await user.click(within(dialog).getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(apiMocks.updateModel).toHaveBeenCalledWith(
        'model-1',
        expect.objectContaining({
          modelName: 'kimi-k2.5',
          config: expect.objectContaining({
            displayName: 'Kimi K2.5',
            groupName: 'Moonshot',
          }),
        }),
      );
    });
  });

  it('saves provider aliases from the external provider config area', async () => {
    const user = userEvent.setup();

    apiMocks.getPreferences.mockResolvedValue({
      uiLocale: 'zh-CN',
      reportLocale: 'zh-CN',
      themeMode: 'system',
      maxTurns: 30,
      compactThresholdTokens: 80000,
    });
    apiMocks.listModels.mockResolvedValue([
      {
        modelId: 'provider-model-1',
        provider: 'openai-compatible',
        modelName: 'deepseek-v3',
        config: {
          baseUrl: 'https://api.deepseek.com/v1',
          displayName: 'DeepSeek V3',
          groupName: 'DeepSeek',
        },
        enabled: true,
        isDefault: false,
        createdAt: '2026-05-10T00:00:00.000Z',
      },
    ]);
    apiMocks.updateModel.mockResolvedValue({
      modelId: 'provider-model-1',
      provider: 'openai-compatible',
      modelName: 'deepseek-v3',
      config: {
        baseUrl: 'https://api.deepseek.com/v1',
        providerAlias: 'DeepSeek Gateway',
      },
      enabled: true,
      isDefault: false,
      createdAt: '2026-05-10T00:00:00.000Z',
    });

    renderSettings();

    await user.click(screen.getByRole('button', { name: 'models' }));

    const providerAliasInput = await screen.findByLabelText('服务商别名');
    await user.clear(providerAliasInput);
    await user.type(providerAliasInput, 'DeepSeek Gateway');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(apiMocks.updateModel).toHaveBeenCalledWith(
        'provider-model-1',
        expect.objectContaining({
          config: expect.objectContaining({
            providerAlias: 'DeepSeek Gateway',
          }),
        }),
      );
    });
  });
});
