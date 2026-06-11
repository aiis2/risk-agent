import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { IStructuredStore } from '../../storage/interfaces/IStructuredStore.js';

export function createQueryDatabaseTool(store: IStructuredStore): AgentToolDefinition {
  return {
    name: 'query_database',
    description: '对内部 SQLite 数据库执行只读 SELECT 查询。禁止 INSERT/UPDATE/DELETE/DDL。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: true,
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: {
        sql: { type: 'string', description: '只读 SQL' },
        params: { type: 'array', items: {} }
      }
    },
    async execute(input) {
      const { sql, params = [] } = input as { sql: string; params?: unknown[] };
      if (!/^\s*select/i.test(sql)) {
        throw new Error('Only SELECT statements are allowed');
      }
      const rows = await store.all(sql, params);
      return { rowCount: rows.length, rows };
    }
  };
}
