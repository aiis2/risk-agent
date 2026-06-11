import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';

describe('session attachment and tool contract', () => {
  it('uploads a base64 attachment and persists attachment metadata', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-session-attachment-'));

    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });

      const uploaded = await app.inject({
        method: 'POST',
        url: '/api/session-attachments',
        payload: {
          filename: 'risk-notes.txt',
          contentType: 'text/plain',
          dataBase64: Buffer.from('账户接管风险说明\n需要重点检查异地登录。', 'utf-8').toString('base64'),
        },
      });

      expect(uploaded.statusCode).toBe(201);
      const body = JSON.parse(uploaded.body);
      expect(body.attachmentId).toBeTruthy();
      expect(body.filename).toBe('risk-notes.txt');
      expect(body.contentType).toBe('text/plain');
      expect(body.textPreview).toContain('账户接管风险说明');

      const row = await ctx.storage.getStructuredStore().get<{
        attachment_id: string;
        filename: string;
        content_type: string;
        size_bytes: number;
        object_key: string;
        preview_text: string | null;
      }>(
        `SELECT attachment_id, filename, content_type, size_bytes, object_key, preview_text
         FROM session_attachments
         WHERE attachment_id=?`,
        [body.attachmentId],
      );

      expect(row).toMatchObject({
        attachment_id: body.attachmentId,
        filename: 'risk-notes.txt',
        content_type: 'text/plain',
      });
      expect(row?.size_bytes ?? 0).toBeGreaterThan(0);
      expect(row?.preview_text ?? '').toContain('账户接管风险说明');

      const storedKeys = await ctx.storage.getObjectStore().list('session-attachments/');
      expect(storedKeys).toEqual(expect.arrayContaining([row?.object_key ?? 'missing-object-key']));

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('accepts attachmentIds and toolIds when starting a session', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-session-contract-'));

    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      let capturedInput: Record<string, unknown> | undefined;

      ctx.runner.start = (async (input: any) => {
        capturedInput = input;
        return {
          sessionId: 'sess_start_contract',
          emitter: undefined,
          done: Promise.resolve(),
          cancel: () => undefined,
          eventHistory: [],
          startedAt: '2026-04-24T10:00:00.000Z',
          businessName: input.businessName,
        } as any;
      }) as any;

      const started = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          businessName: 'Attachment Start Session',
          locale: 'zh-CN',
          attachmentIds: ['att_start_1'],
          toolIds: ['file_parse', 'query_database'],
        },
      });

      expect(started.statusCode).toBe(201);
      expect(capturedInput).toMatchObject({
        businessName: 'Attachment Start Session',
        attachmentIds: ['att_start_1'],
        toolIds: ['file_parse', 'query_database'],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });

  it('accepts attachmentIds and toolIds on follow-up messages', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-followup-contract-'));

    try {
      const { app, ctx } = await buildApp({ dataDir: tmp, port: 0 });
      let captured: Record<string, unknown> | undefined;

      ctx.runner.appendUserMessage = (async (_sessionId: string, payload: any) => {
        captured = payload;
        return {
          sessionId: 'sess_followup_contract',
          resumed: true,
          interrupted: false,
        };
      }) as any;

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess_followup_contract/messages',
        payload: {
          content: '请继续分析附件中的异常登录线索',
          modelId: 'mock-model',
          attachmentIds: ['att_followup_1', 'att_followup_2'],
          toolIds: ['file_parse'],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(captured).toMatchObject({
        content: '请继续分析附件中的异常登录线索',
        modelId: 'mock-model',
        attachmentIds: ['att_followup_1', 'att_followup_2'],
        toolIds: ['file_parse'],
      });

      await app.close();
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows fs lag */ }
    }
  });
});