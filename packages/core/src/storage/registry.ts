import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorageConfigSchema, type StorageConfig } from '../agents/base/types.js';
import type { IStructuredStore } from './interfaces/IStructuredStore.js';
import type { IVectorStore } from './interfaces/IVectorStore.js';
import type { IGraphStore } from './interfaces/IGraphStore.js';
import type { IObjectStore } from './interfaces/IObjectStore.js';
import type { ILineageStore } from './interfaces/ILineageStore.js';
import { SQLiteStore } from './embedded/sqlite/SQLiteStore.js';
import { createLanceDBStore } from './embedded/lancedb/factory.js';
import { GraphologyStore } from './embedded/graphology/GraphologyStore.js';
import { LineageStore } from './embedded/graphology/LineageStore.js';
import { LocalObjectStore } from './embedded/localfs/LocalObjectStore.js';

export interface StorageBackendPaths {
  dataRoot: string;
  configFile: string;
  sqliteFile: string;
  vectorDir: string;
  graphDir: string;
  objectDir: string;
}

export function resolveDataRoot(override?: string): string {
  if (override) return override;
  if (process.env.RISK_AGENT_DATA_DIR) return process.env.RISK_AGENT_DATA_DIR;
  return join(process.cwd(), 'risk_agent_data');
}

export function resolvePaths(dataRoot: string): StorageBackendPaths {
  return {
    dataRoot,
    configFile: join(dataRoot, 'config', 'storage.json'),
    sqliteFile: join(dataRoot, 'db', 'risk_agent.db'),
    vectorDir: join(dataRoot, 'vectors'),
    graphDir: join(dataRoot, 'graphs'),
    objectDir: join(dataRoot, 'objects')
  };
}

export function loadStorageConfig(paths: StorageBackendPaths): StorageConfig {
  if (!existsSync(paths.configFile)) {
    mkdirSync(join(paths.dataRoot, 'config'), { recursive: true });
    const defaults = StorageConfigSchema.parse({});
    writeFileSync(paths.configFile, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
  try {
    const raw = JSON.parse(readFileSync(paths.configFile, 'utf-8'));
    return StorageConfigSchema.parse(raw);
  } catch {
    return StorageConfigSchema.parse({});
  }
}

export function saveStorageConfig(paths: StorageBackendPaths, cfg: StorageConfig): void {
  mkdirSync(join(paths.dataRoot, 'config'), { recursive: true });
  writeFileSync(paths.configFile, JSON.stringify(StorageConfigSchema.parse(cfg), null, 2), 'utf-8');
}

class LazyVectorStore implements IVectorStore {
  constructor(
    private readonly ensureStore: () => Promise<IVectorStore>,
    private readonly getInitializedStore: () => IVectorStore | undefined,
  ) {}

  async init(): Promise<void> {
    await this.ensureStore();
  }

  async close(): Promise<void> {
    const store = this.getInitializedStore();
    if (!store) return;
    await store.close();
  }

  async upsert(...args: Parameters<IVectorStore['upsert']>): Promise<void> {
    const store = await this.ensureStore();
    await store.upsert(...args);
  }

  async query(...args: Parameters<IVectorStore['query']>): Promise<Awaited<ReturnType<IVectorStore['query']>>> {
    const store = await this.ensureStore();
    return await store.query(...args);
  }

  async delete(...args: Parameters<IVectorStore['delete']>): Promise<void> {
    const store = await this.ensureStore();
    await store.delete(...args);
  }
}

class LazyGraphStore implements IGraphStore {
  constructor(
    private readonly ensureStore: () => Promise<GraphologyStore>,
    private readonly getInitializedStore: () => GraphologyStore | undefined,
  ) {}

  async init(): Promise<void> {
    await this.ensureStore();
  }

  async close(): Promise<void> {
    const store = this.getInitializedStore();
    if (!store) return;
    await store.close();
  }

  async upsertNode(...args: Parameters<IGraphStore['upsertNode']>): Promise<void> {
    const store = await this.ensureStore();
    await store.upsertNode(...args);
  }

  async upsertEdge(...args: Parameters<IGraphStore['upsertEdge']>): Promise<void> {
    const store = await this.ensureStore();
    await store.upsertEdge(...args);
  }

  async listNodes(...args: Parameters<IGraphStore['listNodes']>): Promise<Awaited<ReturnType<IGraphStore['listNodes']>>> {
    const store = await this.ensureStore();
    return await store.listNodes(...args);
  }

  async listEdges(...args: Parameters<IGraphStore['listEdges']>): Promise<Awaited<ReturnType<IGraphStore['listEdges']>>> {
    const store = await this.ensureStore();
    return await store.listEdges(...args);
  }

  async removeNode(...args: Parameters<IGraphStore['removeNode']>): Promise<void> {
    const store = await this.ensureStore();
    await store.removeNode(...args);
  }

  async query(...args: Parameters<IGraphStore['query']>): Promise<Awaited<ReturnType<IGraphStore['query']>>> {
    const store = await this.ensureStore();
    return await store.query(...args);
  }

  async persist(...args: Parameters<IGraphStore['persist']>): Promise<void> {
    const store = await this.ensureStore();
    await store.persist(...args);
  }
}

class LazyObjectStore implements IObjectStore {
  constructor(
    private readonly ensureStore: () => Promise<LocalObjectStore>,
    private readonly getInitializedStore: () => LocalObjectStore | undefined,
  ) {}

  async init(): Promise<void> {
    await this.ensureStore();
  }

  async close(): Promise<void> {
    const store = this.getInitializedStore();
    if (!store) return;
    await store.close();
  }

  async put(...args: Parameters<IObjectStore['put']>): Promise<Awaited<ReturnType<IObjectStore['put']>>> {
    const store = await this.ensureStore();
    return await store.put(...args);
  }

  async get(...args: Parameters<IObjectStore['get']>): Promise<Awaited<ReturnType<IObjectStore['get']>>> {
    const store = await this.ensureStore();
    return await store.get(...args);
  }

  async exists(...args: Parameters<IObjectStore['exists']>): Promise<Awaited<ReturnType<IObjectStore['exists']>>> {
    const store = await this.ensureStore();
    return await store.exists(...args);
  }

  async delete(...args: Parameters<IObjectStore['delete']>): Promise<void> {
    const store = await this.ensureStore();
    await store.delete(...args);
  }

  async list(...args: Parameters<IObjectStore['list']>): Promise<Awaited<ReturnType<IObjectStore['list']>>> {
    const store = await this.ensureStore();
    return await store.list(...args);
  }
}

class LazyLineageStore implements ILineageStore {
  constructor(
    private readonly ensureStore: () => Promise<ILineageStore>,
    private readonly getInitializedStore: () => ILineageStore | undefined,
  ) {}

  async upsertRuleNode(...args: Parameters<ILineageStore['upsertRuleNode']>): Promise<void> {
    const store = await this.ensureStore();
    await store.upsertRuleNode(...args);
  }

  async upsertRelation(...args: Parameters<ILineageStore['upsertRelation']>): Promise<void> {
    const store = await this.ensureStore();
    await store.upsertRelation(...args);
  }

  async getRuleAncestors(...args: Parameters<ILineageStore['getRuleAncestors']>): Promise<Awaited<ReturnType<ILineageStore['getRuleAncestors']>>> {
    const store = await this.ensureStore();
    return await store.getRuleAncestors(...args);
  }

  async getRuleDescendants(...args: Parameters<ILineageStore['getRuleDescendants']>): Promise<Awaited<ReturnType<ILineageStore['getRuleDescendants']>>> {
    const store = await this.ensureStore();
    return await store.getRuleDescendants(...args);
  }

  async listAll(): Promise<Awaited<ReturnType<ILineageStore['listAll']>>> {
    const store = await this.ensureStore();
    return await store.listAll();
  }

  async addLineageEdge(...args: Parameters<ILineageStore['addLineageEdge']>): Promise<void> {
    const store = await this.ensureStore();
    await store.addLineageEdge(...args);
  }

  async getLineageChain(...args: Parameters<ILineageStore['getLineageChain']>): Promise<Awaited<ReturnType<ILineageStore['getLineageChain']>>> {
    const store = await this.ensureStore();
    return await store.getLineageChain(...args);
  }

  async queryByRelation(...args: Parameters<ILineageStore['queryByRelation']>): Promise<Awaited<ReturnType<ILineageStore['queryByRelation']>>> {
    const store = await this.ensureStore();
    return await store.queryByRelation(...args);
  }

  async toDisplayGraph(...args: Parameters<ILineageStore['toDisplayGraph']>): Promise<Awaited<ReturnType<ILineageStore['toDisplayGraph']>>> {
    const store = await this.ensureStore();
    return await store.toDisplayGraph(...args);
  }

  async removeNode(...args: Parameters<ILineageStore['removeNode']>): Promise<void> {
    const store = await this.ensureStore();
    await store.removeNode(...args);
  }
}

export class StorageBackendRegistry {
  private _structured?: SQLiteStore;
  private _vector?: IVectorStore;
  private _vectorFacade?: IVectorStore;
  private _vectorInitPromise?: Promise<IVectorStore>;
  private _graph?: GraphologyStore;
  private _graphFacade?: IGraphStore;
  private _graphInitPromise?: Promise<GraphologyStore>;
  private _lineage?: ILineageStore;
  private _lineageFacade?: ILineageStore;
  private _lineageInitPromise?: Promise<ILineageStore>;
  private _object?: LocalObjectStore;
  private _objectFacade?: IObjectStore;
  private _objectInitPromise?: Promise<LocalObjectStore>;
  private initialized = false;

  constructor(
    public readonly paths: StorageBackendPaths,
    public readonly config: StorageConfig
  ) {}

  static async bootstrap(dataRootOverride?: string): Promise<StorageBackendRegistry> {
    const paths = resolvePaths(resolveDataRoot(dataRootOverride));
    const cfg = loadStorageConfig(paths);
    const reg = new StorageBackendRegistry(paths, cfg);
    await reg.init();
    return reg;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this._structured = new SQLiteStore(this.config.structured.file ?? this.paths.sqliteFile);
    await this._structured.init();

    this.initialized = true;
  }

  private async ensureVectorStore(): Promise<IVectorStore> {
    if (this._vector) return this._vector;

    if (!this._vectorInitPromise) {
      this._vectorInitPromise = (async () => {
        const store = await createLanceDBStore(this.config.vector.path ?? this.paths.vectorDir);
        await store.init();
        this._vector = store;
        return store;
      })().catch((error) => {
        this._vectorInitPromise = undefined;
        throw error;
      });
    }

    return await this._vectorInitPromise;
  }

  private async ensureGraphStore(): Promise<GraphologyStore> {
    if (this._graph) return this._graph;

    if (!this._graphInitPromise) {
      this._graphInitPromise = (async () => {
        const store = new GraphologyStore(this.config.graph.path ?? this.paths.graphDir);
        await store.init();
        this._graph = store;
        return store;
      })().catch((error) => {
        this._graphInitPromise = undefined;
        throw error;
      });
    }

    return await this._graphInitPromise;
  }

  private async ensureLineageStore(): Promise<ILineageStore> {
    if (this._lineage) return this._lineage;

    if (!this._lineageInitPromise) {
      this._lineageInitPromise = (async () => {
        const graph = await this.ensureGraphStore();
        const store = new LineageStore(graph);
        this._lineage = store;
        return store;
      })().catch((error) => {
        this._lineageInitPromise = undefined;
        throw error;
      });
    }

    return await this._lineageInitPromise;
  }

  private async ensureObjectStore(): Promise<LocalObjectStore> {
    if (this._object) return this._object;

    if (!this._objectInitPromise) {
      this._objectInitPromise = (async () => {
        const store = new LocalObjectStore(this.config.object.path ?? this.paths.objectDir);
        await store.init();
        this._object = store;
        return store;
      })().catch((error) => {
        this._objectInitPromise = undefined;
        throw error;
      });
    }

    return await this._objectInitPromise;
  }

  async close(): Promise<void> {
    const vectorStore = this._vector ?? await this._vectorInitPromise?.catch(() => undefined);
    const graphStore = this._graph ?? await this._graphInitPromise?.catch(() => undefined);
    const objectStore = this._object ?? await this._objectInitPromise?.catch(() => undefined);

    await this._structured?.close();
    await vectorStore?.close();
    await graphStore?.close();
    await objectStore?.close();

    this._vector = undefined;
    this._vectorInitPromise = undefined;
    this._graph = undefined;
    this._graphInitPromise = undefined;
    this._lineage = undefined;
    this._lineageInitPromise = undefined;
    this._object = undefined;
    this._objectInitPromise = undefined;
    this.initialized = false;
  }

  getStructuredStore(): IStructuredStore {
    if (!this._structured) throw new Error('StorageBackendRegistry not initialized');
    return this._structured;
  }
  getVectorStore(): IVectorStore {
    if (!this._structured) throw new Error('StorageBackendRegistry not initialized');
    if (!this._vectorFacade) {
      this._vectorFacade = new LazyVectorStore(
        () => this.ensureVectorStore(),
        () => this._vector,
      );
    }
    return this._vectorFacade;
  }
  getGraphStore(): IGraphStore {
    if (!this._structured) throw new Error('StorageBackendRegistry not initialized');
    if (!this._graphFacade) {
      this._graphFacade = new LazyGraphStore(
        () => this.ensureGraphStore(),
        () => this._graph,
      );
    }
    return this._graphFacade;
  }
  getLineageStore(): ILineageStore {
    if (!this._structured) throw new Error('StorageBackendRegistry not initialized');
    if (!this._lineageFacade) {
      this._lineageFacade = new LazyLineageStore(
        () => this.ensureLineageStore(),
        () => this._lineage,
      );
    }
    return this._lineageFacade;
  }
  getObjectStore(): IObjectStore {
    if (!this._structured) throw new Error('StorageBackendRegistry not initialized');
    if (!this._objectFacade) {
      this._objectFacade = new LazyObjectStore(
        () => this.ensureObjectStore(),
        () => this._object,
      );
    }
    return this._objectFacade;
  }
}
