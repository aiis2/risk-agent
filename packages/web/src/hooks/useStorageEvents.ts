/**
 * useStorageEvents — 订阅存储操作 WebSocket 事件
 * storage-settings-api.md §9 Events & Audit Protocol
 *
 * 连接 /api/ws/storage，接收存储操作事件并自动刷新相关 React Query 缓存。
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type StorageEventType =
  | 'storage-validation-finished'
  | 'storage-apply-started'
  | 'storage-profile-updated'
  | 'storage-rollback-started'
  | 'storage-profile-rollback'
  | 'storage-migration-progress'
  | 'storage-migration-finished';

export interface StorageEvent {
  type: StorageEventType;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type StorageEventHandler = (event: StorageEvent) => void;

/**
 * 订阅存储操作事件，自动刷新受影响的查询。
 * @param onEvent 可选的额外事件处理回调
 */
export function useStorageEvents(onEvent?: StorageEventHandler): void {
  const qc = useQueryClient();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/api/ws/storage`;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (e) => {
        let event: StorageEvent;
        try { event = JSON.parse(e.data as string) as StorageEvent; }
        catch { return; }

        // Refresh relevant queries based on event type
        switch (event.type) {
          case 'storage-validation-finished':
            void qc.invalidateQueries({ queryKey: ['storage-current'] });
            break;
          case 'storage-apply-started':
          case 'storage-profile-updated':
            void qc.invalidateQueries({ queryKey: ['storage-current'] });
            void qc.invalidateQueries({ queryKey: ['storage-history'] });
            break;
          case 'storage-rollback-started':
          case 'storage-profile-rollback':
            void qc.invalidateQueries({ queryKey: ['storage-current'] });
            void qc.invalidateQueries({ queryKey: ['storage-history'] });
            break;
          case 'storage-migration-progress':
            void qc.invalidateQueries({ queryKey: ['storage-migration-jobs'] });
            break;
          case 'storage-migration-finished':
            void qc.invalidateQueries({ queryKey: ['storage-migration-jobs'] });
            void qc.invalidateQueries({ queryKey: ['storage-current'] });
            break;
        }

        handlerRef.current?.(event);
      };

      ws.onclose = () => {
        if (!destroyed) {
          // Reconnect after 3s
          retryTimer = setTimeout(connect, 3_000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [qc]);
}
