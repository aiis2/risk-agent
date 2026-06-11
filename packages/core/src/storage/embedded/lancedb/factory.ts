import { createRequire } from 'node:module';
import type { IVectorStore } from '../../interfaces/IVectorStore.js';
import { LanceDBStore } from './LanceDBStore.js';
import { LanceDBNativeStore } from './LanceDBNativeStore.js';

/**
 * 检测 @lancedb/lancedb 是否已安装（同步 resolve 不会挂起）
 */
function isLanceDBSdkAvailable(): boolean {
  try {
    const req = createRequire(import.meta.url);
    req.resolve('@lancedb/lancedb');
    return true;
  } catch {
    return false;
  }
}

/**
 * createLanceDBStore — 按 RISK_AGENT_LANCEDB 选择后端：
 *  - `sdk` (默认若可用): 使用 `@lancedb/lancedb` 官方 SDK；加载失败回退 JSON 实现
 *  - `json`: 显式使用 JSON 文件实现
 *
 * 向 `StorageBackendRegistry` 暴露 `IVectorStore` 抽象；调用方无需感知底层差异。
 */
export async function createLanceDBStore(rootDir: string): Promise<IVectorStore> {
  const pref = (process.env.RISK_AGENT_LANCEDB ?? '').toLowerCase();
  if (pref === 'json') return new LanceDBStore(rootDir);

  if (pref === 'sdk' || pref === '') {
    // 先同步检测包是否安装，避免动态 import 挂起
    if (!isLanceDBSdkAvailable()) {
      if (pref === 'sdk') {
        throw new Error('@lancedb/lancedb is not installed');
      }
      return new LanceDBStore(rootDir);
    }
    try {
      const native = new LanceDBNativeStore(rootDir);
      await native.init();
      return native;
    } catch (err) {
      if (pref === 'sdk') {
        throw err;
      }
      return new LanceDBStore(rootDir);
    }
  }

  return new LanceDBStore(rootDir);
}
