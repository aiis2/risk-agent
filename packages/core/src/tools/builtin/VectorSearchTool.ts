import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import type { IVectorStore } from '../../storage/interfaces/IVectorStore.js';

export function createVectorSearchTool(store: IVectorStore): AgentToolDefinition {
  return {
    name: 'vector_search',
    description: '对向量库的指定 collection 进行语义检索，返回 topK 命中。',
    isConcurrencySafe: true,
    isDestructive: false,
    alwaysLoad: false,
    inputSchema: {
      type: 'object',
      required: ['collection', 'vector'],
      properties: {
        collection: { type: 'string' },
        vector: { type: 'array', items: { type: 'number' } },
        topK: { type: 'number', default: 5 }
      }
    },
    async execute(input) {
      const { collection, vector, topK = 5 } = input as { collection: string; vector: number[]; topK?: number };
      const hits = await store.query(collection, vector, topK);
      return { hits };
    }
  };
}
