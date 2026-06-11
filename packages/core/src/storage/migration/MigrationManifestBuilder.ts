/**
 * MigrationManifestBuilder — 扫描源端存储，生成迁移清单
 * storage-migration-implementation.md §3.3 Task C (支撑)
 */
import type { MigrationScope, MigrationManifest } from './types.js';
import type { IStructuredStore } from '../interfaces/IStructuredStore.js';
import type { IObjectStore } from '../interfaces/IObjectStore.js';

export interface ManifestBuilderStores {
  structured: IStructuredStore;
  object?: IObjectStore;
}

export class MigrationManifestBuilder {
  constructor(private readonly stores: ManifestBuilderStores) {}

  async buildForScope(scope: MigrationScope): Promise<MigrationManifest> {
    switch (scope) {
      case 'structured': return this.buildStructuredManifest();
      case 'vector':     return this.buildVectorManifest();
      case 'graph':      return { scopeId: 'graph', recordCount: 0, sizeBytes: 0 };
      case 'object':     return this.buildObjectManifest();
    }
  }

  private async buildStructuredManifest(): Promise<MigrationManifest> {
    const tables = await this.stores.structured.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    let totalRows = 0;
    for (const t of tables) {
      const row = await this.stores.structured.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${t.name}"`
      );
      totalRows += row?.count ?? 0;
    }
    return {
      scopeId: 'structured',
      recordCount: totalRows,
      sizeBytes: 0,
      tables: tables.map((t) => t.name),
    };
  }

  private async buildVectorManifest(): Promise<MigrationManifest> {
    // IVectorStore does not expose listCollections; return a basic manifest
    return { scopeId: 'vector', recordCount: 0, sizeBytes: 0, collections: [] };
  }

  private async buildObjectManifest(): Promise<MigrationManifest> {
    if (!this.stores.object) {
      return { scopeId: 'object', recordCount: 0, sizeBytes: 0, objectKeys: [] };
    }
    try {
      const keys = await this.stores.object.list();
      return { scopeId: 'object', recordCount: keys.length, sizeBytes: 0, objectKeys: keys };
    } catch {
      return { scopeId: 'object', recordCount: 0, sizeBytes: 0, objectKeys: [] };
    }
  }
}
