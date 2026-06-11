import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type CookieSameSite = Electron.Cookie['sameSite'];

type SessionCookie = Pick<
  Electron.Cookie,
  'name' | 'value' | 'domain' | 'hostOnly' | 'path' | 'secure' | 'httpOnly' | 'session' | 'sameSite'
>;

type CookieChangeCause =
  | 'inserted'
  | 'inserted-no-change-overwrite'
  | 'inserted-no-value-change-overwrite'
  | 'explicit'
  | 'overwrite'
  | 'expired'
  | 'evicted'
  | 'expired-overwrite';

type PersistedSessionCookie = {
  url: string;
  name: string;
  value: string;
  domain?: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: CookieSameSite;
};

type PersistedCookieFile = {
  version: 1;
  cookies: PersistedSessionCookie[];
};

type CookieStoreLike = {
  set(details: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: CookieSameSite;
  }): Promise<void>;
  flushStore(): Promise<void>;
  on(
    event: 'changed',
    listener: (event: unknown, cookie: SessionCookie, cause: CookieChangeCause, removed: boolean) => void,
  ): void;
  removeListener(
    event: 'changed',
    listener: (event: unknown, cookie: SessionCookie, cause: CookieChangeCause, removed: boolean) => void,
  ): void;
};

type BrowserSessionCookieStoreOptions = {
  cookies: CookieStoreLike;
  storageFilePath: string;
  logger?: (message: string) => void;
};

function createCookieKey(cookie: Pick<SessionCookie, 'name' | 'domain' | 'path'>): string {
  return `${cookie.name}||${cookie.domain ?? ''}||${cookie.path ?? '/'}`;
}

function normalizeCookiePath(pathname?: string): string {
  if (!pathname || pathname.length === 0) {
    return '/';
  }

  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function createCookieUrl(cookie: Pick<SessionCookie, 'domain' | 'path' | 'secure'>): string | null {
  const hostname = cookie.domain?.replace(/^\.+/, '');
  if (!hostname) {
    return null;
  }

  const protocol = cookie.secure ? 'https' : 'http';
  return `${protocol}://${hostname}${normalizeCookiePath(cookie.path)}`;
}

function isPersistedSessionCookie(value: unknown): value is PersistedSessionCookie {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.value === 'string' &&
    typeof candidate.hostOnly === 'boolean' &&
    typeof candidate.path === 'string' &&
    typeof candidate.secure === 'boolean' &&
    typeof candidate.httpOnly === 'boolean'
  );
}

export class BrowserSessionCookieStore {
  private readonly persistedCookies = new Map<string, PersistedSessionCookie>();
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  private readonly handleCookieChanged = (
    _event: unknown,
    cookie: SessionCookie,
    _cause: CookieChangeCause,
    removed: boolean,
  ) => {
    const cookieKey = createCookieKey(cookie);

    if (removed || !cookie.session) {
      this.persistedCookies.delete(cookieKey);
      this.queuePersist();
      return;
    }

    const persistedCookie = this.serializeCookie(cookie);
    if (!persistedCookie) {
      this.persistedCookies.delete(cookieKey);
      this.queuePersist();
      return;
    }

    this.persistedCookies.set(cookieKey, persistedCookie);
    this.queuePersist();
  };

  constructor(private readonly options: BrowserSessionCookieStoreOptions) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const persistedCookies = await this.loadPersistedCookies();
    for (const persistedCookie of persistedCookies) {
      try {
        await this.options.cookies.set(this.toSetCookieDetails(persistedCookie));
        this.persistedCookies.set(createCookieKey(persistedCookie), persistedCookie);
      } catch (error) {
        this.log(`failed to restore browser session cookie ${persistedCookie.name}: ${this.formatError(error)}`);
      }
    }

    this.options.cookies.on('changed', this.handleCookieChanged);
    this.initialized = true;
    await this.persistNow();
  }

  async flush(): Promise<void> {
    await this.writeQueue;
    await this.options.cookies.flushStore();
  }

  async dispose(): Promise<void> {
    if (this.initialized) {
      this.options.cookies.removeListener('changed', this.handleCookieChanged);
      this.initialized = false;
    }

    await this.flush();
  }

  private serializeCookie(cookie: SessionCookie): PersistedSessionCookie | null {
    const url = createCookieUrl(cookie);
    if (!url) {
      this.log(`skipped browser session cookie ${cookie.name} because its domain could not be resolved`);
      return null;
    }

    return {
      url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      hostOnly: cookie.hostOnly === true,
      path: normalizeCookiePath(cookie.path),
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: cookie.sameSite,
    };
  }

  private toSetCookieDetails(cookie: PersistedSessionCookie) {
    const details: {
      url: string;
      name: string;
      value: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: CookieSameSite;
    } = {
      url: cookie.url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    };

    if (cookie.domain && !cookie.hostOnly) {
      details.domain = cookie.domain;
    }

    return details;
  }

  private queuePersist(): void {
    this.writeQueue = this.writeQueue
      .then(() => this.persistNow())
      .catch((error) => {
        this.log(`failed to persist browser session cookies: ${this.formatError(error)}`);
      });
  }

  private async persistNow(): Promise<void> {
    if (this.persistedCookies.size === 0) {
      await rm(this.options.storageFilePath, { force: true });
      return;
    }

    await mkdir(dirname(this.options.storageFilePath), { recursive: true });

    const fileContent: PersistedCookieFile = {
      version: 1,
      cookies: [...this.persistedCookies.values()].sort((left, right) =>
        createCookieKey(left).localeCompare(createCookieKey(right))
      ),
    };

    await writeFile(this.options.storageFilePath, JSON.stringify(fileContent, null, 2), 'utf8');
  }

  private async loadPersistedCookies(): Promise<PersistedSessionCookie[]> {
    try {
      const rawFile = await readFile(this.options.storageFilePath, 'utf8');
      const parsed = JSON.parse(rawFile) as Partial<PersistedCookieFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.cookies)) {
        this.log('ignored browser session cookie store because its format is invalid');
        return [];
      }

      return parsed.cookies.filter(isPersistedSessionCookie);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }

      this.log(`failed to read browser session cookies: ${this.formatError(error)}`);
      return [];
    }
  }

  private log(message: string): void {
    this.options.logger?.(message);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error);
  }
}