import { describe, it, expect } from 'vitest';
import { ToolResultSanitizer, containsMcpImageContent, MAX_SERIALIZED_LENGTH } from '../ToolResultSanitizer.js';

describe('containsMcpImageContent', () => {
  it('returns true for MCP image content block', () => {
    const result = {
      content: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
    };
    expect(containsMcpImageContent(result)).toBe(true);
  });

  it('returns false for MCP text-only content', () => {
    const result = {
      content: [{ type: 'text', text: 'snapshot data' }],
    };
    expect(containsMcpImageContent(result)).toBe(false);
  });

  it('returns true for mixed text+image content', () => {
    const result = {
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', data: 'abc123', mimeType: 'image/png' },
      ],
    };
    expect(containsMcpImageContent(result)).toBe(true);
  });

  it('returns false for non-MCP objects', () => {
    expect(containsMcpImageContent({ url: 'https://example.com', text: 'hello' })).toBe(false);
    expect(containsMcpImageContent('plain string')).toBe(false);
    expect(containsMcpImageContent(null)).toBe(false);
    expect(containsMcpImageContent(undefined)).toBe(false);
  });
});

describe('ToolResultSanitizer.sanitize — image handling', () => {
  const sanitizer = new ToolResultSanitizer();

  it('does not truncate MCP screenshot result even if > 30,000 chars', () => {
    const largeBase64 = 'A'.repeat(200_000); // 200KB image data
    const result = {
      content: [{ type: 'image', data: largeBase64, mimeType: 'image/png' }],
    };
    const outcome = sanitizer.sanitize(result);
    expect(outcome.truncated).toBe(false);
    // Image data should be preserved
    const content = (outcome.value as any).content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].data).toBe(largeBase64);
  });

  it('still truncates large non-image results', () => {
    const largeText = 'X'.repeat(MAX_SERIALIZED_LENGTH + 1000);
    const outcome = sanitizer.sanitize(largeText);
    expect(outcome.truncated).toBe(true);
    expect((outcome.value as any).__truncated).toBe(true);
  });

  it('preserves small text results unchanged', () => {
    const result = { content: [{ type: 'text', text: 'ok' }] };
    const outcome = sanitizer.sanitize(result);
    expect(outcome.truncated).toBe(false);
    expect(outcome.value).toEqual(result);
  });

  it('does not truncate browser snapshot-like document results even if they exceed 30,000 chars', () => {
    const result = {
      title: 'Knowledge Base Article',
      currentUrl: 'https://example.com/wiki/article',
      html: `<html><body>${'Rendered section '.repeat(12_000)}</body></html>`,
      text: 'Rendered document text '.repeat(8_000),
    };

    const outcome = sanitizer.sanitize(result);

    expect(outcome.truncated).toBe(false);
    expect(outcome.value).toEqual(result);
  });

  it('does not truncate web scrape-like document results even if they exceed 30,000 chars', () => {
    const result = {
      url: 'https://example.com/knowledge/confluence',
      title: 'Confluence Article',
      text: 'Rendered article body '.repeat(8_000),
      extractedChars: 176_000,
      truncated: false,
    };

    const outcome = sanitizer.sanitize(result);

    expect(outcome.truncated).toBe(false);
    expect(outcome.value).toEqual(result);
  });
});
