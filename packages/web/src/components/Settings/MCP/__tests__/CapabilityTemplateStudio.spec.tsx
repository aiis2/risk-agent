/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMocks = vi.hoisted(() => ({
  listCapabilityTemplates: vi.fn(),
  generateCapabilityTemplate: vi.fn(),
}));

vi.mock('../../../../api/client', () => ({
  listCapabilityTemplates: apiMocks.listCapabilityTemplates,
  generateCapabilityTemplate: apiMocks.generateCapabilityTemplate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'zh-CN', changeLanguage: vi.fn() },
  }),
}));

import { CapabilityTemplateStudio } from '../CapabilityTemplateStudio';

function renderStudio() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CapabilityTemplateStudio />
    </QueryClientProvider>
  );
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

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => true),
  });
});

afterEach(() => {
  cleanup();
});

describe('CapabilityTemplateStudio', () => {
  it('requests a template bundle and previews generated files', async () => {
    const user = userEvent.setup();

    apiMocks.listCapabilityTemplates.mockResolvedValue({
      templates: [
        {
          templateId: 'feishu-bot',
          capabilityKind: 'connector',
          title: 'Feishu Connector',
          description: 'Feishu bootstrap',
          accent: '#78d3f8',
        },
        {
          templateId: 'mcp-server',
          capabilityKind: 'mcp-server',
          title: 'MCP Server',
          description: 'MCP bootstrap',
          accent: '#ffba08',
        },
      ],
    });
    apiMocks.generateCapabilityTemplate.mockResolvedValue({
      bundle: {
        templateId: 'mcp-server',
        capabilityKind: 'mcp-server',
        capabilityName: 'risk-docs-mcp',
        description: 'MCP server skeleton',
        files: [
          {
            path: 'risk-docs-mcp/mcp-server.manifest.json',
            purpose: 'manifest',
            content: '{"version":1}',
          },
          {
            path: 'risk-docs-mcp/src/server.ts',
            purpose: 'program',
            content: 'export async function main() {}',
          },
        ],
        nextSteps: ['Validate transport', 'Wire handlers'],
      },
    });

    renderStudio();

    await screen.findByText('Feishu Connector');
    await user.click(screen.getByRole('button', { name: /MCP Server/i }));
    await user.clear(screen.getByLabelText('Capability Name'));
    await user.type(screen.getByLabelText('Capability Name'), 'risk-docs-mcp');
    await user.click(screen.getByRole('button', { name: '生成骨架包' }));

    await waitFor(() => {
      expect(apiMocks.generateCapabilityTemplate).toHaveBeenCalledWith({
        templateId: 'mcp-server',
        capabilityName: 'risk-docs-mcp',
      });
    });

    await screen.findByText('risk-docs-mcp/mcp-server.manifest.json');
    expect(screen.getByText('export async function main() {}')).toBeTruthy();
    expect(screen.getByText('Validate transport')).toBeTruthy();
  });

  it('falls back to document copy when clipboard permissions are unavailable', async () => {
    const user = userEvent.setup();

    apiMocks.listCapabilityTemplates.mockResolvedValue({
      templates: [
        {
          templateId: 'mcp-server',
          capabilityKind: 'mcp-server',
          title: 'MCP Server',
          description: 'MCP bootstrap',
          accent: '#ffba08',
        },
      ],
    });
    apiMocks.generateCapabilityTemplate.mockResolvedValue({
      bundle: {
        templateId: 'mcp-server',
        capabilityKind: 'mcp-server',
        capabilityName: 'risk-docs-mcp',
        description: 'MCP server skeleton',
        files: [
          {
            path: 'risk-docs-mcp/src/server.ts',
            purpose: 'program',
            content: 'export async function main() {}',
          },
        ],
        nextSteps: ['Validate transport'],
      },
    });

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('clipboard_denied')),
      },
    });

    renderStudio();

    await screen.findByText('MCP Server');
    await user.click(screen.getByRole('button', { name: '生成骨架包' }));
    await screen.findByText('export async function main() {}');
    await user.click(screen.getByRole('button', { name: '复制文件' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy();
    });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});