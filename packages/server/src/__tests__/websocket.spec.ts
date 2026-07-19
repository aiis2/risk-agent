import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { publishStorageEvent, storageEventBus } from '../ws/storageEventBus.js';

describe('websocket compatibility', () => {
  it('delivers storage events and removes the listener after disconnect', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'risk-agent-ws-'));
    const { app } = await buildApp({ dataDir, port: 0 });
    let socket: Awaited<ReturnType<typeof app.injectWS>> | undefined;

    try {
      await app.ready();
      const listenerBaseline = storageEventBus.listenerCount('storage_event');

      socket = await app.injectWS('/api/ws/storage');
      expect(storageEventBus.listenerCount('storage_event')).toBe(listenerBaseline + 1);

      const message = once(socket, 'message');
      publishStorageEvent('storage-validation-finished', { ok: true });

      const [payload] = await message;
      expect(JSON.parse(payload.toString())).toMatchObject({
        type: 'storage-validation-finished',
        data: { ok: true }
      });

      const closed = once(socket, 'close');
      socket.terminate();
      await closed;
      socket = undefined;

      expect(storageEventBus.listenerCount('storage_event')).toBe(listenerBaseline);
    } finally {
      socket?.terminate();
      await app.close();
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // Windows may briefly retain handles after the application closes.
      }
    }
  });
});
