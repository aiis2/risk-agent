export interface ObjectPutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface IObjectStore {
  init(): Promise<void>;
  close(): Promise<void>;
  put(key: string, data: Buffer | string, opts?: ObjectPutOptions): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}
