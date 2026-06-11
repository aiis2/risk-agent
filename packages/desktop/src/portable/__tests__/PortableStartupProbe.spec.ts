import { describe, expect, it } from 'vitest';

import {
  collectDescendantProcessIds,
  normalizePortableListeners,
  normalizePortableProcesses,
  selectPortableUiEndpoint,
} from '../PortableStartupProbe.js';

describe('PortableStartupProbe', () => {
  it('collects the portable launcher process tree', () => {
    const processIds = collectDescendantProcessIds(3000, [
      { processId: 3000, parentProcessId: 35008 },
      { processId: 30868, parentProcessId: 3000 },
      { processId: 29100, parentProcessId: 30868 },
      { processId: 34748, parentProcessId: 30868 },
      { processId: 5140, parentProcessId: 30868 },
      { processId: 99999, parentProcessId: 42 },
    ]);

    expect(processIds).toEqual([3000, 30868, 29100, 34748, 5140]);
  });

  it('selects the first Risk Agent UI port from launcher-owned listeners', () => {
    const endpoint = selectPortableUiEndpoint({
      launcherProcessId: 3000,
      processes: [
        { processId: 3000, parentProcessId: 35008 },
        { processId: 30868, parentProcessId: 3000 },
        { processId: 29100, parentProcessId: 30868 },
      ],
      listeners: [
        { localAddress: '127.0.0.1', localPort: 8931, owningProcess: 30868 },
        { localAddress: '127.0.0.1', localPort: 61087, owningProcess: 30868 },
        { localAddress: '127.0.0.1', localPort: 62000, owningProcess: 99999 },
      ],
      probes: [
        { port: 8931, statusCode: 404, body: 'not found' },
        {
          port: 61087,
          statusCode: 200,
          body: '<!doctype html><html lang="zh-CN"><head><title>Risk Agent</title></head><body><div id="root"></div></body></html>',
        },
      ],
    });

    expect(endpoint).toEqual({ port: 61087, owningProcess: 30868 });
  });

  it('normalizes PowerShell process and listener records before endpoint selection', () => {
    const endpoint = selectPortableUiEndpoint({
      launcherProcessId: 3000,
      processes: normalizePortableProcesses([
        { ProcessId: 3000, ParentProcessId: 35008 },
        { ProcessId: 30868, ParentProcessId: 3000 },
      ]),
      listeners: normalizePortableListeners([
        { LocalAddress: '127.0.0.1', LocalPort: 8931, OwningProcess: 30868 },
        { LocalAddress: '127.0.0.1', LocalPort: 61087, OwningProcess: 30868 },
      ]),
      probes: [
        { port: 8931, statusCode: 404, body: 'not found' },
        {
          port: 61087,
          statusCode: 200,
          body: '<!doctype html><html lang="zh-CN"><head><title>Risk Agent</title></head><body><div id="root"></div></body></html>',
        },
      ],
    });

    expect(endpoint).toEqual({ port: 61087, owningProcess: 30868 });
  });
});