import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThinkingBlock } from '../ThinkingBlock';

describe('ThinkingBlock', () => {
  it('returns null when text is empty', () => {
    const html = renderToStaticMarkup(createElement(ThinkingBlock, { text: '' }));
    expect(html).toBe('');
  });

  it('renders thinking text content when streaming (auto-expanded)', () => {
    // streaming=true causes the block to auto-open, showing the content
    const html = renderToStaticMarkup(createElement(ThinkingBlock, {
      text: '正在分析支付欺诈模式…',
      streaming: true,
    }));
    expect(html).toContain('正在分析支付欺诈模式');
  });

  it('renders "思考过程" label', () => {
    const html = renderToStaticMarkup(createElement(ThinkingBlock, {
      text: '分析中',
    }));
    expect(html).toContain('思考过程');
  });

  it('shows a reasoning trace label for the collapsible draft block', () => {
    const html = renderToStaticMarkup(createElement(ThinkingBlock, {
      text: '先检查命中规则，再对异常链路补充验证。',
    }));
    expect(html).toContain('推理轨迹');
  });

  it('shows streaming indicator when streaming=true', () => {
    const html = renderToStaticMarkup(createElement(ThinkingBlock, {
      text: '正在推理',
      streaming: true,
    }));
    expect(html).toContain('推理中');
    expect(html).toContain('animate-pulse');
  });

  it('shows live draft stats for the current thinking block', () => {
    const html = renderToStaticMarkup(createElement(ThinkingBlock, {
      text: '第一行\n第二行',
      streaming: true,
    }));
    expect(html).toContain('实时');
    expect(html).toContain('2 行');
  });

  it('does not show streaming indicator when streaming=false', () => {
    const html = renderToStaticMarkup(createElement(ThinkingBlock, {
      text: '推理完成的内容',
      streaming: false,
    }));
    expect(html).not.toContain('推理中');
  });
});
