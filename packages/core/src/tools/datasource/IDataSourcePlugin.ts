/**
 * IDataSourcePlugin — 数据源插件统一接口。
 * packages/core/src/tools/datasource/IDataSourcePlugin.ts
 *
 * 所有数据源适配器（HTTP API / Git / MySQL / File 等）均实现此接口，
 * 由 DataSourceRegistry 统一管理，DataSourceAgent 调用。
 */

export interface DataSourceResult {
  /** 数据源类型标识 */
  sourceType: string;
  /** 数据源名称 */
  sourceName: string;
  /** 原始内容（文本形式，供 LLM 消费） */
  rawContent: string;
  /** 结构化解析结果（可选，供业务逻辑使用） */
  structuredData?: unknown;
  metadata: {
    fetchedAt: Date;
    durationMs: number;
    contentSize: number;
    encoding?: string;
  };
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

export interface IDataSourcePlugin {
  /** 工具唯一标识（与 ToolRegistry 注册名一致） */
  readonly name: string;
  /** LLM 可理解的能力描述 */
  readonly description: string;
  /** 参数 Schema（JSON Schema 格式） */
  readonly parameters: Record<string, unknown>;

  /**
   * 采集数据，返回标准化结果。
   * @param params 对应 parameters Schema 的入参
   */
  fetch(params: Record<string, unknown>): Promise<DataSourceResult>;

  /**
   * 可选：测试连通性。
   */
  healthCheck?(): Promise<HealthCheckResult>;
}
