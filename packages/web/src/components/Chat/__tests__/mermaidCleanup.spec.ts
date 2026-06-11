/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { cleanupMermaidScratch } from '../responseContent';

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
});
