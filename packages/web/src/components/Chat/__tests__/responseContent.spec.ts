import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResponseContent } from '../responseContent';

describe('ResponseContent', () => {
  it('renders rich markdown blocks with headings, tables, blockquotes and inline code', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: [
        '# 风险摘要',
        '',
        '> 请优先关注高频交易。',
        '',
        '| 指标 | 值 |',
        '| --- | --- |',
        '| 命中规则 | 2 |',
        '',
        '包含 `risk_code` 内联代码。',
      ].join('\n'),
    }));

    expect(html).toContain('<h1');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<table');
    expect(html).toContain('<code class=');
    expect(html).toContain('risk_code</code>');
    expect(html).not.toContain('<pre');
  });

  it('renders blockquotes as labeled callouts', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '> 请优先关注高频交易。',
    }));

    expect(html).toContain('重点提示');
    expect(html).toContain('请优先关注高频交易');
  });

  it('auto-collapses long fenced code blocks for chat readability', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: [
        '```ts',
        ...Array.from({ length: 16 }, (_, index) => `const line${index + 1} = ${index + 1};`),
        '```',
      ].join('\n'),
    }));

    expect(html).toContain('展开');
    expect(html).toContain('TypeScript');
  });

  it('renders headings h1-h3 with correct tag structure', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '# H1\n## H2\n### H3',
    }));
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');
    expect(html).toContain('H1');
    expect(html).toContain('H2');
    expect(html).toContain('H3');
  });

  it('renders short code blocks without collapse controls', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '```json\n{"key": "value"}\n```',
    }));
    // Short block should NOT contain collapse button
    expect(html).not.toContain('展开');
    // HTML may encode quotes; check for key without quotes
    expect(html).toContain('key');
  });

  it('includes copy button on all code blocks', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '```py\nprint("hello")\n```',
    }));
    expect(html).toContain('复制');
  });

  it('renders mermaid fences as diagram panels', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '```mermaid\ngraph TD\nA[开始] --> B[完成]\n```',
    }));

    expect(html).toContain('Mermaid 流程图');
    expect(html).toContain('graph TD');
  });

  it('renders GFM table with thead and tbody', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: [
        '| Name | Score |',
        '| ---- | ----- |',
        '| Risk A | 85 |',
        '| Risk B | 60 |',
      ].join('\n'),
    }));
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    expect(html).toContain('Risk A');
    expect(html).toContain('数据表格');
  });

  it('renders GFM strikethrough text', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '~~已废弃规则~~',
    }));
    expect(html).toContain('<del');
    expect(html).toContain('已废弃规则');
  });

  it('renders horizontal rule', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: 'Section A\n\n---\n\nSection B',
    }));
    expect(html).toContain('Section A');
    expect(html).toContain('Section B');
  });

  it('renders external links with rel=noreferrer', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '[文档链接](https://example.com)',
    }));
    expect(html).toContain('noreferrer');
    expect(html).toContain('https://example.com');
  });

  it('displays streaming cursor when streaming=true', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '正在生成…',
      streaming: true,
    }));
    expect(html).toContain('animate-pulse');
  });

  it('renders a streaming placeholder before markdown content arrives', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '',
      streaming: true,
    }));
    expect(html).toContain('正在生成回答');
    expect(html).toContain('实时草稿');
  });

  it('does not display streaming cursor when streaming=false', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '生成完成',
      streaming: false,
    }));
    expect(html).not.toContain('animate-pulse');
  });

  it('renders ordered and unordered lists', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '- 无序项目A\n- 无序项目B\n\n1. 有序项目1\n2. 有序项目2',
    }));
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toContain('无序项目A');
    expect(html).toContain('有序项目1');
  });

  it('language label maps ts to TypeScript', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '```ts\nconst x = 1;\n```',
    }));
    expect(html).toContain('TypeScript');
  });

  it('language label maps json to JSON', () => {
    const html = renderToStaticMarkup(createElement(ResponseContent, {
      content: '```json\n{}\n```',
    }));
    expect(html).toContain('JSON');
  });
});
