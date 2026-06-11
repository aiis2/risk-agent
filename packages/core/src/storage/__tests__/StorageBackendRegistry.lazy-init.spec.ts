import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sqliteInit = vi.fn(async () => undefined);
  const vectorInit = vi.fn(async () => undefined);
  const vectorQuery = vi.fn(async () => []);
  const createVectorStore = vi.fn(async () => ({
    init: vectorInit,
    close: vi.fn(async () => undefined),
    upsert: vi.fn(async () => undefined),
    query: vectorQuery,
    delete: vi.fn(async () => undefined),
  }));
  const graphInit = vi.fn(async () => undefined);
  const graphListNodes = vi.fn(async () => []);
  const objectInit = vi.fn(async () => undefined);
  const objectExists = vi.fn(async () => false);

  return {
    sqliteInit,
    vectorInit,
    vectorQuery,
    createVectorStore,
    graphInit,
    graphListNodes,
    objectInit,
    objectExists,
  };
});

vi.mock('../embedded/sqlite/SQLiteStore.js', () => ({
  SQLiteStore: class {
    init = mocks.sqliteInit;
    close = vi.fn(async () => undefined);
  },
}));

vi.mock('../embedded/lancedb/factory.js', () => ({
  createLanceDBStore: mocks.createVectorStore,
}));

vi.mock('../embedded/graphology/GraphologyStore.js', () => ({
  GraphologyStore: class {
    init = mocks.graphInit;
    close = vi.fn(async () => undefined);
    upsertNode = vi.fn(async () => undefined);
    upsertEdge = vi.fn(async () => undefined);
    listNodes = mocks.graphListNodes;
    listEdges = vi.fn(async () => []);
    removeNode = vi.fn(async () => undefined);
    query = vi.fn(async () => []);
    persist = vi.fn(async () => undefined);
  },
}));

vi.mock('../embedded/graphology/LineageStore.js', () => ({
  LineageStore: class {
    upsertRuleNode = vi.fn(async () => undefined);
    upsertRelation = vi.fn(async () => undefined);
    getRuleAncestors = vi.fn(async () => []);
    getRuleDescendants = vi.fn(async () => []);
    listAll = vi.fn(async () => ({ nodes: [], edges: [] }));
    addLineageEdge = vi.fn(async () => undefined);
    getLineageChain = vi.fn(async () => ({
      nodeId: 'rule',
      upstream: [],
      downstream: [],
      upstreamEdges: [],
      downstreamEdges: [],
    }));
    queryByRelation = vi.fn(async () => []);
    toDisplayGraph = vi.fn(async () => ({ nodes: [], edges: [] }));
    removeNode = vi.fn(async () => undefined);
  },
}));

vi.mock('../embedded/localfs/LocalObjectStore.js', () => ({
  LocalObjectStore: class {
    init = mocks.objectInit;
    close = vi.fn(async () => undefined);
    put = vi.fn(async () => 'key');
    get = vi.fn(async () => null);
    exists = mocks.objectExists;
    delete = vi.fn(async () => undefined);
    list = vi.fn(async () => []);
  },
}));

describe('StorageBackendRegistry lazy secondary stores', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockClear());
  });

  it('bootstraps SQLite eagerly but defers vector, graph, and object store init until first use', async () => {
    const { StorageBackendRegistry } = await import('../registry.js');

    const registry = await StorageBackendRegistry.bootstrap('D:/risk-agent-lazy-storage');

    expect(mocks.sqliteInit).toHaveBeenCalledOnce();
    expect(mocks.createVectorStore).not.toHaveBeenCalled();
    expect(mocks.graphInit).not.toHaveBeenCalled();
    expect(mocks.objectInit).not.toHaveBeenCalled();

    await registry.getVectorStore().query('rules', [1, 0, 0]);
    expect(mocks.createVectorStore).toHaveBeenCalledOnce();
    expect(mocks.vectorInit).toHaveBeenCalledOnce();
    expect(mocks.vectorQuery).toHaveBeenCalledOnce();

    await registry.getGraphStore().listNodes('business_graph');
    expect(mocks.graphInit).toHaveBeenCalledOnce();
    expect(mocks.graphListNodes).toHaveBeenCalledOnce();

    await registry.getObjectStore().exists('reports/r1.json');
    expect(mocks.objectInit).toHaveBeenCalledOnce();
    expect(mocks.objectExists).toHaveBeenCalledOnce();
  });
});