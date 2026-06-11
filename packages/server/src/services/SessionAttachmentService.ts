import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { AttachmentReference, StorageBackendRegistry } from '@risk-agent/core';

const ATTACHMENT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS session_attachments (
  attachment_id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(session_id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  preview_text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface SessionAttachmentRecord {
  attachmentId: string;
  sessionId?: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  textPreview?: string;
  createdAt?: string;
}

export class SessionAttachmentService {
  constructor(private readonly storage: StorageBackendRegistry) {}

  async upload(input: {
    filename: string;
    contentType?: string;
    dataBase64: string;
    sessionId?: string;
  }): Promise<SessionAttachmentRecord> {
    await this.ensureTable();

    const filename = sanitizeFilename(input.filename);
    if (!filename) {
      throw new Error('attachment_filename_required');
    }

    const payload = input.dataBase64.replace(/^data:[^;]+;base64,/i, '');
    const buffer = Buffer.from(payload, 'base64');
    if (buffer.length === 0) {
      throw new Error('attachment_data_required');
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error('attachment_too_large');
    }

    const attachmentId = `att_${randomUUID().replace(/-/g, '')}`;
    const contentType = normalizeContentType(input.contentType, filename);
    const objectKey = `session-attachments/${attachmentId}/${filename}`;
    const textPreview = createAttachmentPreview(buffer, filename, contentType);

    await this.storage.getObjectStore().put(objectKey, buffer, {
      contentType,
      metadata: {
        attachmentId,
        filename,
      },
    });

    await this.storage.getStructuredStore().run(
      `INSERT INTO session_attachments(attachment_id, session_id, filename, content_type, size_bytes, object_key, preview_text)
       VALUES(?,?,?,?,?,?,?)`,
      [attachmentId, input.sessionId ?? null, filename, contentType, buffer.length, objectKey, textPreview ?? null],
    );

    return {
      attachmentId,
      sessionId: input.sessionId,
      filename,
      contentType,
      sizeBytes: buffer.length,
      objectKey,
      textPreview,
    };
  }

  async assignToSession(sessionId: string, attachmentIds?: string[]): Promise<void> {
    await this.ensureTable();
    if (!attachmentIds?.length) return;
    await this.storage.getStructuredStore().run(
      `UPDATE session_attachments SET session_id=? WHERE attachment_id IN (${attachmentIds.map(() => '?').join(',')})`,
      [sessionId, ...attachmentIds],
    );
  }

  async getByIds(attachmentIds?: string[]): Promise<SessionAttachmentRecord[]> {
    await this.ensureTable();
    if (!attachmentIds?.length) return [];

    const rows = await this.storage.getStructuredStore().all<{
      attachment_id: string;
      session_id: string | null;
      filename: string;
      content_type: string;
      size_bytes: number;
      object_key: string;
      preview_text: string | null;
      created_at: string;
    }>(
      `SELECT attachment_id, session_id, filename, content_type, size_bytes, object_key, preview_text, created_at
       FROM session_attachments
       WHERE attachment_id IN (${attachmentIds.map(() => '?').join(',')})`,
      attachmentIds,
    );

    const byId = new Map(rows.map((row) => [row.attachment_id, {
      attachmentId: row.attachment_id,
      sessionId: row.session_id ?? undefined,
      filename: row.filename,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      objectKey: row.object_key,
      textPreview: row.preview_text ?? undefined,
      createdAt: row.created_at,
    }]));

    return attachmentIds.map((attachmentId) => byId.get(attachmentId)).filter(Boolean) as SessionAttachmentRecord[];
  }

  toMessageRefs(records: SessionAttachmentRecord[]): AttachmentReference[] {
    return records.map((record) => ({
      id: record.attachmentId,
      filename: record.filename,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      textPreview: record.textPreview,
    }));
  }

  buildPromptContext(records: SessionAttachmentRecord[]): string {
    if (records.length === 0) return '';

    const lines = records.flatMap((record) => {
      const header = `- ${record.filename} (${record.contentType}, ${record.sizeBytes} bytes)`;
      if (!record.textPreview) {
        return [header, '  摘要: 二进制附件已上传，当前仅提供元数据。'];
      }
      return [header, `  摘要: ${record.textPreview}`];
    });

    return ['附件上下文：', ...lines].join('\n');
  }

  private async ensureTable(): Promise<void> {
    const store = this.storage.getStructuredStore();
    await store.exec(ATTACHMENT_TABLE_SQL);
    await store.exec(`CREATE INDEX IF NOT EXISTS idx_session_attachments_session ON session_attachments(session_id, created_at DESC)`);
  }
}

function sanitizeFilename(input: string): string {
  return input.trim().replace(/[\\/]+/g, '_').replace(/\.+/g, '.').slice(0, 120);
}

function normalizeContentType(contentType: string | undefined, filename: string): string {
  const normalized = contentType?.trim();
  if (normalized) return normalized;

  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case '.md':
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.xml':
      return 'application/xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function createAttachmentPreview(buffer: Buffer, filename: string, contentType: string): string | undefined {
  if (!isPreviewable(filename, contentType)) {
    return undefined;
  }

  const raw = buffer.toString('utf-8').replace(/\u0000/g, '').trim();
  if (!raw) return undefined;

  const ext = extname(filename).toLowerCase();
  let normalized = raw;
  if (contentType.includes('html') || ext === '.html' || ext === '.htm' || contentType.includes('xml') || ext === '.xml') {
    normalized = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }

  return normalized.replace(/\s+/g, ' ').slice(0, 600).trim();
}

function isPreviewable(filename: string, contentType: string): boolean {
  if (contentType.startsWith('text/')) return true;
  if (contentType === 'application/json' || contentType === 'application/xml') return true;

  const ext = extname(filename).toLowerCase();
  return ['.txt', '.md', '.json', '.csv', '.html', '.htm', '.xml', '.log'].includes(ext);
}