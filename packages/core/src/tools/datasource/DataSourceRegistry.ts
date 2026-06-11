/**
 * DataSourceRegistry — 数据源插件注册中心。
 * packages/core/src/tools/datasource/DataSourceRegistry.ts
 *
 * 维护所有注册的数据源插件，DataSourceAgent 通过此注册中心查找并调用。
 */
import type { IDataSourcePlugin } from './IDataSourcePlugin.js';

export class DataSourceRegistry {
  private static readonly _plugins = new Map<string, IDataSourcePlugin>();

  /**
   * 注册一个数据源插件。
   * 已存在同名插件时覆盖（允许热替换）。
   */
  static register(plugin: IDataSourcePlugin): void {
    this._plugins.set(plugin.name, plugin);
  }

  /** 按名称查找插件，未找到返回 undefined */
  static get(name: string): IDataSourcePlugin | undefined {
    return this._plugins.get(name);
  }

  /** 列出所有已注册插件 */
  static list(): IDataSourcePlugin[] {
    return Array.from(this._plugins.values());
  }

  /** 按类型过滤插件 */
  static listByType(type: string): IDataSourcePlugin[] {
    return this.list().filter((p) => p.name.startsWith(type));
  }

  /** 注销插件 */
  static unregister(name: string): void {
    this._plugins.delete(name);
  }

  /** 健康检查所有已注册插件 */
  static async healthCheckAll(): Promise<Array<{ name: string; healthy: boolean; message?: string; latencyMs?: number }>> {
    return Promise.all(
      this.list().map(async (p) => {
        if (!p.healthCheck) return { name: p.name, healthy: true, message: 'no_check_defined' };
        const start = Date.now();
        try {
          const res = await p.healthCheck();
          return { name: p.name, healthy: res.healthy, message: res.message, latencyMs: Date.now() - start };
        } catch (err: any) {
          return { name: p.name, healthy: false, message: err?.message, latencyMs: Date.now() - start };
        }
      })
    );
  }
}
