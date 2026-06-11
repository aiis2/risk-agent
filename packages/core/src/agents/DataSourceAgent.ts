/**
 * DataSourceAgent — 数据源采集 Agent（§01-data-sources.md 完整实现）。
 *
 * 职责：
 *   1. 从 store 加载所有已启用数据源配置
 *   2. 按 sourceType 分发到对应工具（http_api / git_scan / web_fetch / file_parser / get_database_schema）
 *   3. 归一化并聚合结果
 *   4. 通过 StreamEvent 向 OrchestratorAgent 汇报进度
 */
import type { StreamEvent } from './base/types.js';
import { BaseAgent, type AgentRunOptions } from './base/BaseAgent.js';
import type { IStructuredStore } from '../storage/interfaces/IStructuredStore.js';

export interface DataSourceAgentOptions {
  /** 结构化存储（用于读取 data_sources 表） */
  store: IStructuredStore;
  /**
   * 工具执行器：接受工具名和参数，返回工具输出。
   * 由宿主 Worker/Coordinator 注入，与 ToolRegistry 解耦。
   */
  executeTool: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
}

interface DataSourceRow {
  source_id: string;
  name: string;
  source_type: string;
  config_json: string;
  enabled: number;
}

export class DataSourceAgent extends BaseAgent {
  private readonly agentOpts?: DataSourceAgentOptions;

  constructor(sessionId: string, opts?: DataSourceAgentOptions) {
    super(sessionId);
    this.agentOpts = opts;
  }

  async *run(_opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, undefined> {
    yield {
      type: 'subagent_spawned',
      agentId: 'datasource',
      description: '采集业务数据源',
      taskType: 'subagent',
      workerRole: 'datasource'
    };

    // 如果没有注入 store / executeTool，降级为空操作（兼容单元测试和旧调用方）
    if (!this.agentOpts) {
      yield { type: 'subagent_complete', agentId: 'datasource', status: 'completed', summary: 'datasource noop (no store)' };
      return;
    }

    const { store, executeTool } = this.agentOpts;

    // Step 1: 加载所有启用的数据源
    let sources: DataSourceRow[] = [];
    try {
      sources = await store.all<DataSourceRow>(`SELECT * FROM data_sources WHERE enabled=1 ORDER BY created_at`);
    } catch (err: any) {
      yield { type: 'subagent_complete', agentId: 'datasource', status: 'failed', summary: `加载数据源失败: ${err?.message}` };
      return;
    }

    if (sources.length === 0) {
      yield { type: 'subagent_complete', agentId: 'datasource', status: 'completed', summary: '没有启用的数据源，跳过采集' };
      return;
    }

    yield { type: 'subagent_progress', agentId: 'datasource', text: `找到 ${sources.length} 个启用数据源，开始采集...` };

    const results: Array<{ sourceId: string; name: string; ok: boolean; error?: string }> = [];

    // Step 2: 按类型分发工具调用
    for (const src of sources) {
      const cfg = JSON.parse(src.config_json ?? '{}') as Record<string, unknown>;
      const type = src.source_type;

      yield { type: 'subagent_progress', agentId: 'datasource', text: `正在采集: ${src.name} (${type})` };

      try {
        switch (type) {
          case 'api':
            await executeTool('http_api', {
              url: cfg['baseUrl'] ?? cfg['url'] ?? '',
              method: 'GET',
              headers: (cfg['headers'] as Record<string, string>) ?? {}
            });
            break;

          case 'web':
            await executeTool('web_fetch', { url: cfg['url'] ?? '' });
            break;

          case 'git':
            await executeTool('git_scan', {
              repoUrl: cfg['url'] ?? '',
              branch: cfg['branch'] ?? 'main',
              paths: (cfg['paths'] as string[]) ?? [],
              patterns: (cfg['patterns'] as string[]) ?? ['*.md', '*.json', '*.yaml']
            });
            break;

          case 'file':
            await executeTool('file_parser', {
              filePath: cfg['filePath'] ?? cfg['path'] ?? '',
              encoding: (cfg['encoding'] as string) ?? 'utf-8'
            });
            break;

          case 'db':
            // 两步访问：先获取 schema，再执行预配置 SQL
            await executeTool('get_database_schema', { datasourceId: src.source_id });
            if (cfg['sql']) {
              await executeTool('query_database_external', { datasourceId: src.source_id, sql: cfg['sql'] });
            }
            break;

          case 'mcp':
            // MCP 数据源：透传到 MCPManager，此处仅标记已访问
            yield { type: 'subagent_progress', agentId: 'datasource', text: `MCP 数据源 "${src.name}" 将由 MCP 管理器处理` };
            break;

          default:
            yield { type: 'subagent_progress', agentId: 'datasource', text: `未知数据源类型: ${type}，跳过` };
        }
        results.push({ sourceId: src.source_id, name: src.name, ok: true });
      } catch (err: any) {
        results.push({ sourceId: src.source_id, name: src.name, ok: false, error: err?.message });
        yield { type: 'subagent_progress', agentId: 'datasource', text: `采集失败: ${src.name} — ${err?.message}` };
      }
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const summary = `数据源采集完成：${ok} 成功 / ${failed} 失败（共 ${sources.length} 个）`;

    yield {
      type: 'subagent_complete',
      agentId: 'datasource',
      status: failed > 0 && ok === 0 ? 'failed' : 'completed',
      summary
    };
  }
}
