/** @vitest-environment jsdom */

import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  getSkillTree: vi.fn(),
  getSkillFile: vi.fn(),
  createSkill: vi.fn(),
  deleteSkill: vi.fn(),
  testSkill: vi.fn(),
  importSkillPackage: vi.fn(),
  installSkillFromUrl: vi.fn(),
  listTools: vi.fn(),
}));

vi.mock('../../../api/client', () => ({
  listSkills: apiMocks.listSkills,
  getSkillTree: apiMocks.getSkillTree,
  getSkillFile: apiMocks.getSkillFile,
  createSkill: apiMocks.createSkill,
  deleteSkill: apiMocks.deleteSkill,
  testSkill: apiMocks.testSkill,
  importSkillPackage: apiMocks.importSkillPackage,
  installSkillFromUrl: apiMocks.installSkillFromUrl,
  listTools: apiMocks.listTools,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

import { SkillsTabContent } from '../Skills/SkillsTabContent';
import { ToolsRegistryTabContent } from '../Tools/ToolsRegistryTabContent';

function renderPanel(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

function buildTool(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    description: `${name} description`,
    aliases: [],
    isReadOnly: false,
    isDestructive: false,
    isConcurrencySafe: true,
    isOpenWorld: false,
    deferred: false,
    alwaysLoad: false,
    inputSchema: { type: 'object' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
});

describe('Skills and tools workbenches', () => {
  it('starts with an installed skills list and keeps the preview pane empty until a skill is chosen', async () => {
    apiMocks.listSkills.mockResolvedValue({
      data: [
        {
          name: 'find-skills',
          description: 'Discover installed skills',
          source: 'bundled',
          version: '1.0.0',
          tags: ['discover'],
          path: 'D:/skills/find-skills',
          paths: [],
          contextMode: 'shared',
        },
        {
          name: 'skill-creator',
          description: 'Create and inspect local skill packages',
          source: 'directory',
          version: '1.2.0',
          tags: ['authoring'],
          path: 'D:/skills/skill-creator',
          paths: ['packages/web/**'],
          contextMode: 'fork',
        },
      ],
    });

    renderPanel(<SkillsTabContent />);

    await screen.findByText(/已安装\s*\(2\)/);

    expect(screen.getByText('未选择技能')).toBeTruthy();
    expect(apiMocks.getSkillTree).not.toHaveBeenCalled();
  });

  it('keeps a discovery search box and re-queries skills from the backend', async () => {
    const user = userEvent.setup();

    apiMocks.listSkills.mockImplementation(async (params?: { q?: string }) => {
      const allSkills = [
        {
          name: 'find-skills',
          description: 'Discover installed skills',
          source: 'bundled',
          version: '1.0.0',
          tags: ['discover'],
          path: 'D:/skills/find-skills',
          paths: [],
          contextMode: 'shared',
        },
        {
          name: 'skill-creator',
          description: 'Create and inspect local skill packages',
          source: 'directory',
          version: '1.2.0',
          tags: ['authoring'],
          path: 'D:/skills/skill-creator',
          paths: ['packages/web/**'],
          contextMode: 'fork',
        },
      ];
      if (!params?.q) return { data: allSkills };
      const query = params.q.toLowerCase();
      return {
        data: allSkills.filter((skill) =>
          skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query)
        ),
      };
    });

    renderPanel(<SkillsTabContent />);

    await screen.findByText(/已安装\s*\(2\)/);
    await user.type(screen.getByLabelText('搜索技能'), 'creator');

    await waitFor(() => {
      expect(apiMocks.listSkills).toHaveBeenLastCalledWith({ q: 'creator' });
    });

    await waitFor(() => {
      expect(screen.getByText('skill-creator')).toBeTruthy();
      expect(screen.queryByText('find-skills')).toBeNull();
    });
  });

  it('opens a dedicated file navigator and preview after selecting a skill', async () => {
    const user = userEvent.setup();

    apiMocks.listSkills.mockResolvedValue({
      data: [
        {
          name: 'find-skills',
          description: 'Discover installed skills',
          source: 'bundled',
          version: '1.0.0',
          tags: ['discover'],
          path: 'D:/skills/find-skills',
          paths: [],
          contextMode: 'shared',
        },
        {
          name: 'skill-creator',
          description: 'Create and inspect local skill packages',
          source: 'directory',
          version: '1.2.0',
          tags: ['authoring'],
          path: 'D:/skills/skill-creator',
          paths: ['packages/web/**'],
          contextMode: 'fork',
        },
      ],
    });
    apiMocks.getSkillTree.mockImplementation(async (skillName: string) => {
      if (skillName === 'skill-creator') {
        return [
          { path: 'agents', type: 'directory' },
          { path: 'assets', type: 'directory' },
          { path: 'SKILL.md', type: 'file' },
          { path: 'viewer.html', type: 'file' },
        ];
      }
      return [{ path: 'SKILL.md', type: 'file' }];
    });
    apiMocks.getSkillFile.mockImplementation(async (_skillName: string, filePath: string) => ({
      path: filePath,
      content: filePath === 'viewer.html' ? '<html>viewer</html>' : '# skill-creator',
      encoding: 'utf-8',
    }));

    renderPanel(<SkillsTabContent />);

    await screen.findByText(/已安装\s*\(2\)/);

    await user.click(screen.getByRole('button', { name: /skill-creator/i }));

    await screen.findByText('viewer.html');
    await user.click(screen.getByRole('button', { name: /viewer\.html/i }));

    await screen.findByText('<html>viewer</html>');
  });

  it('shows a successful test banner when the skill test API returns output', async () => {
    const user = userEvent.setup();

    apiMocks.listSkills.mockResolvedValue({
      data: [
        {
          name: 'webapp-testing',
          description: 'Playwright testing toolkit',
          source: 'directory',
          version: '1.0.0',
          tags: ['testing'],
          path: 'D:/skills/webapp-testing',
          paths: [],
          contextMode: 'shared',
        },
      ],
    });
    apiMocks.getSkillTree.mockResolvedValue([{ path: 'SKILL.md', type: 'file' }]);
    apiMocks.getSkillFile.mockResolvedValue({
      path: 'SKILL.md',
      content: '# webapp-testing',
      encoding: 'utf-8',
    });
    apiMocks.testSkill.mockResolvedValue({
      success: true,
      data: { output: 'skill test passed' },
    });

    renderPanel(<SkillsTabContent />);

    await screen.findByText('webapp-testing');
    await user.click(screen.getByRole('button', { name: /webapp-testing/i }));
    await user.click(screen.getByRole('button', { name: '测试' }));

    await screen.findByText('测试通过');
    expect(screen.getByText('skill test passed')).toBeTruthy();
  });

  it('re-queries tools when search and destructive filtering are combined', async () => {
    const user = userEvent.setup();

    apiMocks.listTools.mockImplementation(async (params?: { q?: string; destructive?: boolean }) => {
      if (params?.destructive && params?.q === 'delete') {
        return {
          total: 1,
          tools: [buildTool('delete_risk_rule', { isDestructive: true, isConcurrencySafe: false })],
        };
      }

      if (params?.q === 'delete') {
        return {
          total: 1,
          tools: [buildTool('delete_risk_rule', { isDestructive: true, isConcurrencySafe: false })],
        };
      }

      if (params?.destructive) {
        return {
          total: 2,
          tools: [
            buildTool('delete_risk_rule', { isDestructive: true, isConcurrencySafe: false }),
            buildTool('modify_risk_rule', { isDestructive: true, isConcurrencySafe: false }),
          ],
        };
      }

      return {
        total: 3,
        tools: [
          buildTool('search_subagent', { isReadOnly: true }),
          buildTool('query_database', { isReadOnly: true }),
          buildTool('delete_risk_rule', { isDestructive: true, isConcurrencySafe: false }),
        ],
      };
    });

    renderPanel(<ToolsRegistryTabContent />);

    await screen.findByText('search_subagent');

    await user.type(screen.getByPlaceholderText('搜索工具名称、描述或 searchHint…'), 'delete');

    await waitFor(() => {
      expect(apiMocks.listTools).toHaveBeenLastCalledWith({
        q: 'delete',
        readonly: undefined,
        destructive: undefined,
        deferred: undefined,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('delete_risk_rule')).toBeTruthy();
      expect(screen.queryByText('search_subagent')).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: '破坏性' }));

    await waitFor(() => {
      expect(apiMocks.listTools).toHaveBeenLastCalledWith({
        q: 'delete',
        readonly: undefined,
        destructive: true,
        deferred: undefined,
      });
    });
  });

  it('shows the search empty state when readonly filtering removes the remaining results', async () => {
    const user = userEvent.setup();

    apiMocks.listTools.mockImplementation(async (params?: { q?: string; readonly?: boolean }) => {
      if (params?.readonly && params?.q === 'delete') {
        return { total: 0, tools: [] };
      }

      if (params?.q === 'delete') {
        return {
          total: 1,
          tools: [buildTool('delete_risk_rule', { isDestructive: true, isConcurrencySafe: false })],
        };
      }

      if (params?.readonly) {
        return {
          total: 1,
          tools: [buildTool('query_database', { isReadOnly: true })],
        };
      }

      return {
        total: 2,
        tools: [
          buildTool('query_database', { isReadOnly: true }),
          buildTool('delete_risk_rule', { isDestructive: true, isConcurrencySafe: false }),
        ],
      };
    });

    renderPanel(<ToolsRegistryTabContent />);

    await screen.findByText('query_database');

    await user.type(screen.getByPlaceholderText('搜索工具名称、描述或 searchHint…'), 'delete');
    await user.click(screen.getByRole('button', { name: '只读' }));

    await waitFor(() => {
      expect(apiMocks.listTools).toHaveBeenLastCalledWith({
        q: 'delete',
        readonly: true,
        destructive: undefined,
        deferred: undefined,
      });
    });

    await screen.findByText('未找到匹配工具');
  });
});