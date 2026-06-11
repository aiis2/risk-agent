import { performance } from 'node:perf_hooks';
import { loadAppPreferences, type WebSearchConfig } from '../preferences/appPreferences.js';

interface StructuredStoreLike {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
}

export interface WebSearchResponse {
  provider: string;
  query: string;
  answer?: string;
  elapsedMs: number;
  results: WebSearchResult[];
}

type LocalWebSearchProvider = 'google' | 'bing' | 'baidu';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBlacklistMatchers(blacklist: string): Array<(url: string) => boolean> {
  return blacklist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      if (entry.startsWith('/') && entry.endsWith('/') && entry.length > 2) {
        try {
          const pattern = new RegExp(entry.slice(1, -1), 'i');
          return [(url: string) => pattern.test(url)];
        } catch {
          return [];
        }
      }

      const wildcard = new RegExp(`^${escapeRegex(entry).replace(/\\\*/g, '.*')}$`, 'i');
      return [(url: string) => wildcard.test(url)];
    });
}

function filterBlacklisted(results: WebSearchResult[], config: WebSearchConfig): WebSearchResult[] {
  const matchers = buildBlacklistMatchers(config.blacklist);
  if (matchers.length === 0) {
    return results;
  }
  return results.filter((result) => !matchers.some((matches) => matches(result.url)));
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

function stripHtml(input: string): string {
  let output = input;
  for (let pass = 0; pass < 2; pass += 1) {
    output = decodeHtmlEntities(output)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  return output
    .replace(/<[a-z/][^>]*(?:>|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clipText(input: string, maxLength = 220): string {
  const text = input.trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function resolveResultUrl(origin: string, href: string): string {
  try {
    return new URL(href, origin).toString();
  } catch {
    return href;
  }
}

function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.url}::${result.title}`;
    if (!result.url || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractBaiduResults(html: string, origin: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const titleMatcher = /<h3[^>]*class="[^"]*(?:c-title|ec_title|\bt\b)[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
  const matches = [...html.matchAll(titleMatcher)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const title = stripHtml(match[2] ?? '');
    const contentStart = (match.index ?? 0) + match[0].length;
    const nextHeadingIndex = matches[index + 1]?.index ?? html.length;
    const rawContent = stripHtml(html.slice(contentStart, Math.min(contentStart + 2400, nextHeadingIndex)));
    const content = clipText(rawContent.replace(new RegExp(`^${escapeRegex(title)}`), '').trim() || rawContent);
    if (!title) continue;
    results.push({
      title,
      url: resolveResultUrl(origin, match[1] ?? ''),
      content,
    });
  }

  return dedupeResults(results);
}

function extractBingResults(html: string, origin: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const matcher = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<p>([\s\S]*?)<\/p>)?/gi;

  for (const match of html.matchAll(matcher)) {
    const title = stripHtml(match[2] ?? '');
    if (!title) continue;
    results.push({
      title,
      url: resolveResultUrl(origin, match[1] ?? ''),
      content: clipText(stripHtml(match[3] ?? '')),
    });
  }

  return dedupeResults(results);
}

function extractGoogleResults(html: string, origin: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const matcher = /<a href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>([\s\S]{0,1200}?)(?=<a href=|$)/gi;

  for (const match of html.matchAll(matcher)) {
    const snippetMatch = match[3]?.match(/<div[^>]*class="[^"]*(?:VwiC3b|s3v9rd|lyLwlc)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const title = stripHtml(match[2] ?? '');
    const href = match[1] ?? '';
    if (!title || (!href.startsWith('http') && !href.startsWith('/url?'))) continue;
    results.push({
      title,
      url: resolveResultUrl(origin, href),
      content: clipText(stripHtml(snippetMatch?.[1] ?? match[3] ?? '')),
    });
  }

  return dedupeResults(results);
}

const LOCAL_PROVIDER_CONFIG: Record<LocalWebSearchProvider, {
  buildUrl: (query: string) => string;
  extract: (html: string, origin: string) => WebSearchResult[];
}> = {
  google: {
    buildUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-CN`,
    extract: extractGoogleResults,
  },
  bing: {
    buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`,
    extract: extractBingResults,
  },
  baidu: {
    buildUrl: (query) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&ie=utf-8`,
    extract: extractBaiduResults,
  },
};

export class WebSearchService {
  constructor(private readonly store: StructuredStoreLike) {}

  async search(query: string, options?: { provider?: string; limit?: number }): Promise<WebSearchResponse> {
    const preferences = await loadAppPreferences(this.store);
    const config = preferences.webSearch;
    const provider = options?.provider?.trim() || config.defaultProvider;

    if (config.providerEnabled[provider] === false) {
      throw new Error(`web_search_provider_disabled:${provider}`);
    }

    if (provider === 'tavily') {
      return this.searchTavily(query, config, options?.limit);
    }

    if (provider in LOCAL_PROVIDER_CONFIG) {
      return this.searchLocalProvider(provider as LocalWebSearchProvider, query, config, options?.limit);
    }

    throw new Error(`web_search_provider_unsupported:${provider}`);
  }

  private async searchTavily(query: string, config: WebSearchConfig, requestedLimit?: number): Promise<WebSearchResponse> {
    const apiKey = config.providerApiKey.tavily?.trim();
    if (!apiKey) {
      throw new Error('tavily_api_key_missing');
    }

    const endpoint = config.providerEndpoint.tavily?.trim() || 'https://api.tavily.com/search';
    const startedAt = performance.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        include_answer: true,
        search_depth: 'advanced',
        max_results: Math.min(Math.max(requestedLimit ?? config.resultCount, 1), 10),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`tavily_request_failed:${response.status}:${detail.slice(0, 200)}`);
    }

    const payload = await response.json() as {
      answer?: string;
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }>;
    };

    const results = filterBlacklisted(
      (payload.results ?? [])
        .filter((item) => item.url)
        .map((item) => ({
          title: item.title?.trim() || item.url || 'Untitled result',
          url: item.url || '',
          content: item.content?.trim() || '',
          score: typeof item.score === 'number' ? item.score : undefined,
          publishedDate: item.published_date?.trim() || undefined,
        })),
      config,
    );

    return {
      provider: 'tavily',
      query,
      answer: typeof payload.answer === 'string' ? payload.answer.trim() : undefined,
      elapsedMs: Math.round(performance.now() - startedAt),
      results,
    };
  }

  private async searchLocalProvider(
    provider: LocalWebSearchProvider,
    query: string,
    config: WebSearchConfig,
    requestedLimit?: number,
  ): Promise<WebSearchResponse> {
    const providerConfig = LOCAL_PROVIDER_CONFIG[provider];
    const url = providerConfig.buildUrl(query);
    const startedAt = performance.now();
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${provider}_request_failed:${response.status}:${detail.slice(0, 200)}`);
    }

    const html = await response.text();
    const limit = Math.min(Math.max(requestedLimit ?? config.resultCount, 1), 10);
    const results = filterBlacklisted(providerConfig.extract(html, url), config).slice(0, limit);

    if (results.length === 0) {
      throw new Error(`${provider}_parse_failed:no_results`);
    }

    return {
      provider,
      query,
      answer: `${provider} 返回 ${results.length} 条可用网页结果。`,
      elapsedMs: Math.round(performance.now() - startedAt),
      results,
    };
  }
}