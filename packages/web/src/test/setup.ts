export {};

import { afterEach } from 'vitest';
import { cleanupMermaidScratch } from '../components/Chat/responseContent';

if (typeof globalThis.localStorage === 'undefined') {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.has(key) ? storage.get(key)! : null;
      },
      setItem(key: string, value: string) {
        storage.set(key, String(value));
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
      key(index: number) {
        return Array.from(storage.keys())[index] ?? null;
      },
      get length() {
        return storage.size;
      },
    },
  });
}

if (typeof globalThis.URL.createObjectURL !== 'function') {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => 'blob:mock-object-url',
  });
}

if (typeof globalThis.URL.revokeObjectURL !== 'function') {
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}

const { i18n } = await import('../i18n');

await i18n.changeLanguage('zh-CN');

afterEach(() => {
  cleanupMermaidScratch();
});
