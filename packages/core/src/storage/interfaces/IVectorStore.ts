export interface VectorRecord {
  id: string;
  vector: number[];
  metadata?: Record<string, unknown>;
  text?: string;
}

export interface VectorSearchHit {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
  text?: string;
}

export interface IVectorStore {
  init(): Promise<void>;
  close(): Promise<void>;
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  query(collection: string, vector: number[], topK?: number): Promise<VectorSearchHit[]>;
  delete(collection: string, ids: string[]): Promise<void>;
}
