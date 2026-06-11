/**
 * PlaywrightWebScrapeTool — 无头浏览器网页抓取工具
 *
 * 使用 Playwright Chromium 渲染页面（含 JS 执行），适用于：
 * - SPA 单页应用、动态内容页面
 * - 需要 JavaScript 执行才能显示内容的页面
 * - 公告、新闻、监管政策等需要完整渲染的页面
 *
 * 与 web_fetch 的区别：
 * - web_fetch  = 简单 HTTP GET（undici），速度快，适合静态 HTML/API
 * - web_scrape = Playwright 浏览器渲染，支持动态页面，耗时较长（5-30s）
 */

import { chromium, type Browser } from 'playwright';
import type { AgentToolDefinition } from '@risk-agent/core';

const MAX_TEXT_CHARS = 240_000;

export const playwrightWebScrapeTool: AgentToolDefinition = {
  name: 'web_scrape',
  description:
    '使用无头 Chromium 浏览器抓取网页内容，支持 JavaScript 渲染的动态页面（SPA、新闻、公告、监管政策等）。' +
    '当 web_fetch 无法获取完整内容（页面依赖 JS 渲染）时使用此工具。每次调用会启动浏览器，耗时约 10-30 秒。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  deferred: true,
  searchHint: '网页抓取 浏览器 playwright 动态页面 JS渲染 SPA scrape browser 联网 公告 新闻 监管',
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: '目标网页的完整 URL（必须以 http:// 或 https:// 开头）',
      },
      waitForSelector: {
        type: 'string',
        description: '等待指定 CSS 选择器出现后再提取内容（可选，例如 ".article-body"）',
      },
      extractSelector: {
        type: 'string',
        description: '仅提取匹配 CSS 选择器的元素文本，留空则提取整个 body（可选）',
      },
      timeoutMs: {
        type: 'number',
        description: '页面加载超时毫秒数（默认 30000，最大 60000）',
      },
      waitUntil: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle'],
        description: '等待页面加载状态（默认 "networkidle"，动态内容可用 "networkidle"）',
      },
    },
  },

  async execute(input, ctx) {
    const {
      url,
      waitForSelector,
      extractSelector,
      timeoutMs = 30_000,
      waitUntil = 'networkidle',
    } = input as {
      url: string;
      waitForSelector?: string;
      extractSelector?: string;
      timeoutMs?: number;
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    };

    // Clamp timeout to a reasonable maximum
    const effectiveTimeout = Math.min(Math.max(timeoutMs, 5_000), 60_000);

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      }).catch((launchErr: unknown) => {
        // Provide a user-friendly error when the Chromium binary is missing
        const msg = launchErr instanceof Error ? launchErr.message : String(launchErr);
        const isMissing = msg.includes("Executable doesn't exist") || msg.includes('executable') || msg.includes('not found');
        if (isMissing) {
          throw new Error(
            'Chromium 浏览器未安装。请运行 `npx playwright install chromium` 完成安装后重试，或使用 web_fetch 工具代替。',
          );
        }
        throw launchErr;
      });

      // Abort browser if signal fires
      let aborted = false;
      if (ctx.signal) {
        ctx.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            void browser?.close().catch(() => undefined);
          },
          { once: true },
        );
      }

      if (aborted) {
        return { url, error: 'aborted', text: '', title: '' };
      }

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'zh-CN,zh;q=0.9,en;q=0.8',
        extraHTTPHeaders: {
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });

      const page = await context.newPage();

      // Block ads/tracking resources to speed up loading
      await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot}', (route) =>
        route.abort(),
      );

      await page.goto(url, {
        waitUntil: waitUntil as any,
        timeout: effectiveTimeout,
      });

      if (waitForSelector) {
        await page
          .waitForSelector(waitForSelector, {
            timeout: Math.min(effectiveTimeout, 15_000),
          })
          .catch(() => undefined); // don't fail if selector not found
      }

      let text: string;
      if (extractSelector) {
        const elements = await page.$$(extractSelector);
        if (elements.length === 0) {
          // Fall back to full body if selector matched nothing
          text = await page.evaluate(() => document.body?.innerText ?? '');
        } else {
          const texts = await Promise.all(elements.map((el) => el.innerText()));
          text = texts.join('\n\n');
        }
      } else {
        text = await page.evaluate(() => document.body?.innerText ?? '');
      }

      const title = await page.title().catch(() => '');
      const finalUrl = page.url();

      await context.close();

      const truncated = text.slice(0, MAX_TEXT_CHARS);
      return {
        url: finalUrl,
        title,
        text: truncated,
        extractedChars: text.length,
        truncated: text.length > MAX_TEXT_CHARS,
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  },
};
