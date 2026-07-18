import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktopPackagePath = resolve(__dirname, '../../package.json');
const desktopTsconfigPath = resolve(__dirname, '../../tsconfig.json');
const backendPath = resolve(__dirname, '../backend.ts');
const browserHostServicePath = resolve(__dirname, '../browserHost/BrowserHostService.ts');
const serverAdapterPath = resolve(__dirname, '../../../server/src/browser/BrowserHostAdapter.ts');
const coreAdapterPath = resolve(__dirname, '../../../core/src/browser/BrowserHostAdapter.ts');
const coreIndexPath = resolve(__dirname, '../../../core/src/index.ts');

describe('desktop compile-time dependency boundary', () => {
  it('uses core contracts without resolving generated server output', () => {
    const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const desktopTsconfig = JSON.parse(readFileSync(desktopTsconfigPath, 'utf8')) as {
      compilerOptions?: { paths?: Record<string, string[]> };
      references?: Array<{ path?: string }>;
    };
    const backend = readFileSync(backendPath, 'utf8');
    const browserHostService = readFileSync(browserHostServicePath, 'utf8');
    const serverAdapter = readFileSync(serverAdapterPath, 'utf8');
    const coreAdapter = readFileSync(coreAdapterPath, 'utf8');
    const coreIndex = readFileSync(coreIndexPath, 'utf8');

    expect(desktopPackage.dependencies?.['@risk-agent/core']).toBeUndefined();
    expect(desktopTsconfig.compilerOptions?.paths?.['@risk-agent/core/browser-host']).toEqual([
      '../core/src/browser/BrowserHostAdapter.ts',
    ]);
    expect(desktopTsconfig.references).toContainEqual({ path: '../core' });
    expect(backend).toContain("from '@risk-agent/core/browser-host'");
    expect(browserHostService).toContain("from '@risk-agent/core/browser-host'");
    expect(backend).not.toContain("from '@risk-agent/server'");
    expect(backend).not.toContain("typeof import('@risk-agent/server')");
    expect(browserHostService).not.toContain("from '@risk-agent/server'");
    expect(backend).toContain("nativeServerModuleLoader('@risk-agent/server')");
    expect(serverAdapter).toContain("from '@risk-agent/core'");
    expect(coreAdapter).toContain('export interface BrowserHostAdapter');
    expect(coreIndex).toContain("export * from './browser/BrowserHostAdapter.js'");
  });
});
