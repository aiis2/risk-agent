import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { IObjectStore, ObjectPutOptions } from '../../interfaces/IObjectStore.js';

export class LocalObjectStore implements IObjectStore {
  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
  }
  async close(): Promise<void> {
    /* no-op */
  }

  private pathFor(key: string): string {
    const safe = key.replace(/^\/+/, '').replace(/\.\./g, '');
    return join(this.rootDir, safe);
  }

  async put(key: string, data: Buffer | string, _opts?: ObjectPutOptions): Promise<string> {
    const p = this.pathFor(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    return p;
  }

  async get(key: string): Promise<Buffer | null> {
    const p = this.pathFor(key);
    if (!existsSync(p)) return null;
    return readFileSync(p);
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    const p = this.pathFor(key);
    if (existsSync(p)) unlinkSync(p);
  }

  async list(prefix = ''): Promise<string[]> {
    const base = this.pathFor(prefix);
    const root = existsSync(base) && statSync(base).isDirectory() ? base : this.rootDir;
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else out.push(relative(this.rootDir, p).replace(/\\/g, '/'));
      }
    };
    if (existsSync(root)) walk(root);
    return prefix ? out.filter((k) => k.startsWith(prefix)) : out;
  }
}
