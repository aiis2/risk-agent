/** @vitest-environment jsdom */

import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn()
}));

vi.mock('mermaid', () => ({
  default: mermaidMocks
}));

import { ResponseContent, cleanupMermaidScratch } from '../responseContent';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('cleanupMermaidScratch', () => {
  it('cleans only body-level mermaid scratch nodes', () => {
    const scratchContainer = document.createElement('div');
    scratchContainer.id = 'drisk-agent-mermaid-test';
    document.body.appendChild(scratchContainer);

    const scratchSvg = document.createElement('svg');
    scratchSvg.id = 'risk-agent-mermaid-test';
    document.body.appendChild(scratchSvg);

    const renderedContainer = document.createElement('div');
    renderedContainer.innerHTML = '<svg id="risk-agent-mermaid-rendered"></svg>';
    document.body.appendChild(renderedContainer);

    cleanupMermaidScratch();

    expect(document.getElementById('drisk-agent-mermaid-test')).toBeNull();
    expect(document.getElementById('risk-agent-mermaid-test')).toBeNull();
    expect(renderedContainer.querySelector('#risk-agent-mermaid-rendered')).toBeTruthy();

    renderedContainer.remove();
  });

  it('renders Mermaid through the strict sanitizer boundary and localizes failures', async () => {
    const firstChart = 'graph TD\nA[Start] --> B[End]';
    const secondChart = 'sequenceDiagram\nAlice->>Bob: review risk';
    let successRenderId = '';
    let failureRenderId = '';

    function appendScratchNodes(renderId: string) {
      const scratchContainer = document.createElement('div');
      scratchContainer.id = `d${renderId}`;

      const scratchSvg = document.createElement('svg');
      scratchSvg.id = renderId;

      document.body.append(scratchContainer, scratchSvg);
    }

    mermaidMocks.render
      .mockImplementationOnce(async (renderId: string) => {
        successRenderId = renderId;
        appendScratchNodes(renderId);
        return {
          svg: '<svg data-mermaid-output="true"><text>rendered</text></svg>'
        };
      })
      .mockImplementationOnce(async (renderId: string) => {
        failureRenderId = renderId;
        appendScratchNodes(renderId);
        throw new Error('unsafe diagram rejected');
      });

    const view = render(
      createElement(ResponseContent, {
        content: `\`\`\`mermaid\n\n${firstChart}\n\n\`\`\``
      })
    );

    await waitFor(() => {
      expect(view.container.querySelector('[data-mermaid-output="true"]')).toBeTruthy();
    });

    expect(mermaidMocks.initialize).toHaveBeenCalledOnce();
    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
        startOnLoad: false
      })
    );
    expect(mermaidMocks.render).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^risk-agent-mermaid-/),
      firstChart
    );
    expect(successRenderId).toMatch(/^risk-agent-mermaid-/);
    expect(document.getElementById(`d${successRenderId}`)).toBeNull();
    expect(document.getElementById(successRenderId)).toBeNull();

    view.rerender(
      createElement(ResponseContent, {
        content: `\`\`\`mermaid\n\n${secondChart}\n\n\`\`\``
      })
    );

    expect(await screen.findByText('Mermaid 渲染失败')).toBeTruthy();
    expect(screen.getByText('unsafe diagram rejected')).toBeTruthy();
    expect(
      screen.getByText((_content, element) => {
        return element?.tagName === 'CODE' && element.textContent === secondChart;
      })
    ).toBeTruthy();
    expect(mermaidMocks.render).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^risk-agent-mermaid-/),
      secondChart
    );
    expect(failureRenderId).toMatch(/^risk-agent-mermaid-/);
    expect(document.getElementById(`d${failureRenderId}`)).toBeNull();
    expect(document.getElementById(failureRenderId)).toBeNull();
  });
});
