import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type CookieSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict';

type CookieRecord = {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: CookieSameSite;
};

type CookieChangeCause =
  | 'inserted'
  | 'inserted-no-change-overwrite'
  | 'inserted-no-value-change-overwrite'
  | 'explicit'
  | 'overwrite'
  | 'expired'
  | 'evicted'
  | 'expired-overwrite';

type CookieChangeHandler = (
  event: unknown,
  cookie: CookieRecord,
  cause: CookieChangeCause,
  removed: boolean,
) => void;

type CookiesMock = {
  get: any;
  set: any;
  flushStore: any;
  on: any;
  removeListener: any;
  emitChanged(cookie: CookieRecord, cause?: CookieChangeCause, removed?: boolean): void;
};

function createCookiesMock(): CookiesMock {
  let changedHandler: CookieChangeHandler | undefined;

  return {
    get: vi.fn(async () => []),
    set: vi.fn(async () => undefined),
    flushStore: vi.fn(async () => undefined),
    on: vi.fn((event: string, handler: CookieChangeHandler) => {
      if (event === 'changed') {
        changedHandler = handler;
      }
    }),
    removeListener: vi.fn((event: string, handler: CookieChangeHandler) => {
      if (event === 'changed' && changedHandler === handler) {
        changedHandler = undefined;
      }
    }),
    emitChanged(cookie: CookieRecord, cause: CookieChangeCause = 'inserted', removed = false) {
      changedHandler?.({}, cookie, cause, removed);
    },
  };
}

async function readPersistedCookies(storageFilePath: string): Promise<unknown> {
  return JSON.parse(await readFile(storageFilePath, 'utf8'));
}

describe('BrowserSessionCookieStore', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directoryPath) => rm(directoryPath, { recursive: true, force: true }))
    );
  });

  it('restores persisted session cookies and preserves host-only semantics', async () => {
    const { BrowserSessionCookieStore } = await import('../BrowserSessionCookieStore.js');

    const cookies = createCookiesMock();
    const tempDirectory = await mkdtemp(join(tmpdir(), 'risk-agent-browser-session-'));
    tempDirectories.push(tempDirectory);
    const storageFilePath = join(tempDirectory, 'session-cookies.json');

    await writeFile(
      storageFilePath,
      JSON.stringify(
        {
          version: 1,
          cookies: [
            {
              url: 'https://example.com/account',
              name: 'host-only-cookie',
              value: 'alpha',
              domain: 'example.com',
              hostOnly: true,
              path: '/account',
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
            },
            {
              url: 'https://example.org/',
              name: 'domain-cookie',
              value: 'beta',
              domain: '.example.org',
              hostOnly: false,
              path: '/',
              secure: true,
              httpOnly: false,
              sameSite: 'strict',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const store = new BrowserSessionCookieStore({ cookies, storageFilePath });
    await store.initialize();

    expect(cookies.set).toHaveBeenCalledTimes(2);

    const hostOnlyRestore = cookies.set.mock.calls[0]?.[0];
    expect(hostOnlyRestore).toMatchObject({
      url: 'https://example.com/account',
      name: 'host-only-cookie',
      value: 'alpha',
      path: '/account',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    expect(hostOnlyRestore).not.toHaveProperty('domain');

    const domainRestore = cookies.set.mock.calls[1]?.[0];
    expect(domainRestore).toMatchObject({
      url: 'https://example.org/',
      name: 'domain-cookie',
      value: 'beta',
      domain: '.example.org',
      path: '/',
      secure: true,
      sameSite: 'strict',
    });
  });

  it('persists session-cookie changes and removes them when cleared', async () => {
    const { BrowserSessionCookieStore } = await import('../BrowserSessionCookieStore.js');

    const cookies = createCookiesMock();
    const tempDirectory = await mkdtemp(join(tmpdir(), 'risk-agent-browser-session-'));
    tempDirectories.push(tempDirectory);
    const storageFilePath = join(tempDirectory, 'session-cookies.json');

    const store = new BrowserSessionCookieStore({ cookies, storageFilePath });
    await store.initialize();

    const sessionCookie: CookieRecord = {
      name: 'risk_agent_cookie',
      value: 'kept',
      domain: 'example.com',
      hostOnly: true,
      path: '/',
      secure: false,
      httpOnly: true,
      session: true,
      sameSite: 'lax',
    };

    cookies.emitChanged(sessionCookie);
    await store.flush();

    await expect(readPersistedCookies(storageFilePath)).resolves.toEqual({
      version: 1,
      cookies: [
        {
          url: 'http://example.com/',
          name: 'risk_agent_cookie',
          value: 'kept',
          domain: 'example.com',
          hostOnly: true,
          path: '/',
          secure: false,
          httpOnly: true,
          sameSite: 'lax',
        },
      ],
    });

    cookies.emitChanged(sessionCookie, 'explicit', true);
    await store.flush();

    await expect(readFile(storageFilePath, 'utf8')).rejects.toThrow();

    await store.dispose();
    expect(cookies.flushStore).toHaveBeenCalled();
  });
});