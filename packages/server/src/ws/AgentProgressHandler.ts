import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../index.js';
import type { StreamEvent, SessionEvent } from '@risk-agent/core';
import { sessionEventBus } from '../agents/SessionRunner.js';
import { storageEventBus, type StorageEvent } from './storageEventBus.js';

export function registerAgentProgressWS(app: FastifyInstance, ctx: AppContext): void {
  // ── 单会话事件流（per-session StreamEvent）──────────────────────
  app.get('/api/ws/sessions/:id', { websocket: true }, (socket, req) => {
    const { id } = req.params as { id: string };
    // Silence socket errors to prevent uncaught exception crashes on abrupt disconnects
    socket.on('error', () => { /* ignore */ });

    const handle = ctx.runner.getHandle(id);
    if (!handle) {
      try { socket.send(JSON.stringify({ type: 'tool_error', toolUseId: 'ws', error: 'session_not_found' } satisfies StreamEvent)); } catch { /* ignore */ }
      try { socket.close(); } catch { /* ignore */ }
      return;
    }

    // Replay history first
    for (const event of handle.eventHistory) {
      try { socket.send(JSON.stringify(event)); } catch { /* ignore */ }
    }

    let sessionDone = false;
    handle.done.then(() => {
      sessionDone = true;
      try { socket.close(); } catch { /* ignore */ }
    }).catch(() => {
      sessionDone = true;
      try { socket.close(); } catch { /* ignore */ }
    });

    const onEvent = (event: StreamEvent) => {
      if (sessionDone) return;
      try { socket.send(JSON.stringify(event)); } catch { /* ignore */ }
    };
    const onEnd = () => {
      sessionDone = true;
      try { socket.close(); } catch { /* ignore */ }
    };

    handle.emitter.on('event', onEvent);
    handle.emitter.once('end', onEnd);

    socket.on('close', () => {
      handle.emitter.off('event', onEvent);
      handle.emitter.off('end', onEnd);
    });
  });

  // ── 全局会话状态事件流（session-lifecycle.md §5.2）─────────────
  // 客户端连接 /api/ws/sessions（不含 :id）以订阅所有会话生命周期事件。
  // 发送的消息格式：{ type: SessionEvent['type'], ... }
  app.get('/api/ws/sessions', { websocket: true }, (socket) => {
    socket.on('error', () => { /* ignore */ });

    const onSessionEvent = (event: SessionEvent) => {
      try { socket.send(JSON.stringify(event)); } catch { /* ignore */ }
    };

    sessionEventBus.on('session_event', onSessionEvent);

    socket.on('close', () => {
      sessionEventBus.off('session_event', onSessionEvent);
    });
  });

  // ── 存储操作事件流（storage-settings-api.md §9）────────────────
  // 客户端连接 /api/ws/storage 以订阅存储配置操作事件。
  // 发送的消息格式：{ type: StorageEventType, timestamp, data? }
  app.get('/api/ws/storage', { websocket: true }, (socket) => {
    socket.on('error', () => { /* ignore */ });

    const onStorageEvent = (event: StorageEvent) => {
      try { socket.send(JSON.stringify(event)); } catch { /* ignore */ }
    };

    storageEventBus.on('storage_event', onStorageEvent);

    socket.on('close', () => {
      storageEventBus.off('storage_event', onStorageEvent);
    });
  });
}
