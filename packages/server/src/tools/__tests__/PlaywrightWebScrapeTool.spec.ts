import { afterEach, describe, expect, it, vi } from 'vitest';

const browserCloseSpy = vi.hoisted(() => vi.fn(async () => undefined));
const contextCloseSpy = vi.hoisted(() => vi.fn(async () => undefined));
const pageRouteSpy = vi.hoisted(() => vi.fn(async () => undefined));
const pageGotoSpy = vi.hoisted(() => vi.fn(async () => undefined));
const pageWaitForSelectorSpy = vi.hoisted(() => vi.fn(async () => undefined));
const pageEvaluateSpy = vi.hoisted(() => vi.fn(async () => ''));
const pageTitleSpy = vi.hoisted(() => vi.fn(async () => 'Knowledge Article'));
const pageUrlSpy = vi.hoisted(() => vi.fn(() => 'https://example.com/knowledge/article'));
const pageQueryAllSpy = vi.hoisted(() => vi.fn(async () => []));
const browserLaunchSpy = vi.hoisted(() => vi.fn(async () => ({
  newContext: vi.fn(async () => ({
    newPage: vi.fn(async () => ({
      route: pageRouteSpy,
      goto: pageGotoSpy,
      waitForSelector: pageWaitForSelectorSpy,
      evaluate: pageEvaluateSpy,
      title: pageTitleSpy,
      url: pageUrlSpy,
      $$: pageQueryAllSpy,
    })),
    close: contextCloseSpy,
  })),
  close: browserCloseSpy,
})));

vi.mock('playwright', () => ({
  chromium: {
    launch: browserLaunchSpy,
  },
}));

import { playwrightWebScrapeTool } from '../PlaywrightWebScrapeTool.js';

describe('playwrightWebScrapeTool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preserves long rendered article text instead of truncating at 60,000 chars', async () => {
    const longText = 'Rendered knowledge base section '.repeat(4_000);
    pageEvaluateSpy.mockResolvedValueOnce(longText);

    const result = await playwrightWebScrapeTool.execute(
      { url: 'https://example.com/knowledge/article' },
      { signal: undefined } as never,
    );

    expect(browserLaunchSpy).toHaveBeenCalledOnce();
    expect(pageGotoSpy).toHaveBeenCalledWith('https://example.com/knowledge/article', expect.any(Object));
    expect(result.text).toBe(longText);
    expect(result.extractedChars).toBe(longText.length);
    expect(result.truncated).toBe(false);
  });
});