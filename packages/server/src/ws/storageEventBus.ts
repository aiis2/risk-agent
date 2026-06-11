/**
 * storageEventBus — 存储操作事件总线
 * storage-settings-api.md §9 Events & Audit Protocol
 *
 * 发布/订阅存储相关操作事件，供 WebSocket 端点广播给前端。
 */
import { EventEmitter } from 'node:events';

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

export const storageEventBus = new EventEmitter();
storageEventBus.setMaxListeners(50);

/** Publish a storage event */
export function publishStorageEvent(type: StorageEventType, data?: Record<string, unknown>): void {
  const event: StorageEvent = { type, timestamp: new Date().toISOString(), data };
  storageEventBus.emit('storage_event', event);
}
