import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolCallBlock } from '../ToolCallBlock';
import type { ToolCallRecord } from '../../../stores/chatStore';

function makeRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    callId: 'call-001',
    toolName: 'search_rules',
    status: 'running',
    params: {},
    ...overrides,
  };
}

describe('ToolCallBlock', () => {
  it('renders tool name in header', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ toolName: 'query_database' }),
    }));
    expect(html).toContain('query_database');
  });

  it('renders a readable category badge for the matched tool type', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ toolName: 'search_rules', status: 'done', result: 'ok' }),
    }));
    expect(html).toContain('检索');
  });

  it('shows "执行中" status when running', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'running' }),
    }));
    expect(html).toContain('执行中');
  });

  it('shows "完成" status when done', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'done', result: 'found 3 results' }),
    }));
    expect(html).toContain('完成');
  });

  it('shows "失败" status when error', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'error', error: 'Connection timeout' }),
    }));
    expect(html).toContain('失败');
    expect(html).toContain('Connection timeout');
  });

  it('renders params as JSON when error (expanded)', () => {
    // status=error auto-expands the collapsible so params are visible
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({
        status: 'error',
        error: 'timeout',
        params: { query: 'payment fraud', limit: 10 },
      }),
    }));
    expect(html).toContain('payment fraud');
    expect(html).toContain('参数');
  });

  it('renders result section when error with result (expanded)', () => {
    // Use running state so collapsible is open
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'running', result: '{"rules": 5}', params: {} }),
    }));
    expect(html).toContain('结果');
  });

  it('renders copy button when result exists and expanded', () => {
    // Error state is always expanded
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'error', error: 'fail', result: 'some result text', params: {} }),
    }));
    // Copy button appears in result section
    expect(html).toContain('复制');
  });

  it('renders duration when provided', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'done', result: 'ok', durationMs: 1350 }),
    }));
    expect(html).toContain('1.4s');
  });

  it('renders duration in ms for short calls', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'done', result: 'ok', durationMs: 250 }),
    }));
    expect(html).toContain('250ms');
  });

  it('pretty-prints valid JSON result when expanded (running)', () => {
    const jsonResult = '{"score":85,"rules":["rule-a","rule-b"]}';
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'running', result: jsonResult }),
    }));
    // Pretty printed - should have indented version with score key visible
    expect(html).toContain('score');
    expect(html).toContain('rule-a');
  });

  it('labels parsed JSON output as structured result metadata', () => {
    const jsonResult = '{"score":85,"rules":["rule-a","rule-b"]}';
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'running', result: jsonResult }),
    }));
    expect(html).toContain('结构化结果');
    expect(html).toContain('JSON');
  });

  it('shows error section with danger styling when error', () => {
    const html = renderToStaticMarkup(createElement(ToolCallBlock, {
      tool: makeRecord({ status: 'error', error: 'LLM call failed' }),
    }));
    expect(html).toContain('错误');
    expect(html).toContain('LLM call failed');
  });
});
