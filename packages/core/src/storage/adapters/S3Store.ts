/**
 * S3Store — AWS S3 / MinIO / OSS 对象存储适配器。
 * packages/core/src/storage/adapters/S3Store.ts
 *
 * 依赖 `@aws-sdk/client-s3`（按需安装：pnpm add -w @aws-sdk/client-s3）。
 * 当 storage.json 中 object.backend === 's3' | 'minio' | 'oss' 时由 registry.ts 加载。
 */
import type { IObjectStore, ObjectPutOptions } from '../interfaces/IObjectStore.js';

export interface S3StoreConfig {
  bucket: string;
  region?: string;
  /** 自定义 endpoint（MinIO/OSS 等 S3-compatible 服务） */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** 路径前缀 */
  prefix?: string;
  forcePathStyle?: boolean;
}

export class S3Store implements IObjectStore {
  private s3: any = null;
  private cmds: any = null; // { PutObjectCommand, GetObjectCommand, ... }
  private readonly prefix: string;

  constructor(private readonly config: S3StoreConfig) {
    this.prefix = config.prefix ?? '';
  }

  async init(): Promise<void> {
    let sdk: any;
    try {
      // @ts-ignore — optional peer dep, install when using s3/minio backend
      sdk = await import('@aws-sdk/client-s3');
    } catch {
      throw new Error(
        'S3Store: `@aws-sdk/client-s3` not installed. Run: pnpm add -w @aws-sdk/client-s3',
      );
    }
    const {
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
      HeadObjectCommand,
      DeleteObjectCommand,
      ListObjectsV2Command,
    } = sdk;
    this.cmds = { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command };

    const clientConfig: Record<string, unknown> = {
      region: this.config.region ?? 'us-east-1',
    };
    if (this.config.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
      clientConfig.forcePathStyle = this.config.forcePathStyle ?? true;
    }
    if (this.config.accessKeyId) {
      clientConfig.credentials = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey ?? '',
      };
    }
    this.s3 = new S3Client(clientConfig);
  }

  async close(): Promise<void> {
    this.s3?.destroy?.();
    this.s3 = null;
    this.cmds = null;
  }

  private key(k: string): string {
    return this.prefix ? `${this.prefix}/${k}` : k;
  }

  async put(key: string, data: Buffer | string, opts?: ObjectPutOptions): Promise<string> {
    await this.s3.send(
      new this.cmds.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.key(key),
        Body: typeof data === 'string' ? Buffer.from(data, 'utf8') : data,
        ContentType: opts?.contentType ?? 'application/octet-stream',
        Metadata: opts?.metadata,
      }),
    );
    return this.key(key);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(
        new this.cmds.GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err: any) {
      if (err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new this.cmds.HeadObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new this.cmds.DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.key(key) }),
    );
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    const fullPrefix = prefix ? `${this.prefix}/${prefix}` : this.prefix;
    do {
      const res: any = await this.s3.send(
        new this.cmds.ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: fullPrefix || undefined,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        const k = obj.Key as string;
        keys.push(this.prefix ? k.replace(`${this.prefix}/`, '') : k);
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);
    return keys;
  }
}
