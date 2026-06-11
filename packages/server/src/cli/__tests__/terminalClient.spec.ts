import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalOwnershipStore } from '../terminalOwnership.js';
import { TerminalRunClient, resolveOwnedRunTarget } from '../terminalClient.js';

describe('TerminalRunClient', () => {
  const baseUrl = 'http://127.0.0.1:8787';
  const workspaceRoot = 'D:/workspace/risk-agent';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a terminal-cli run and records local ownership', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'risk-agent-terminal-cli-'));

    try {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run_term_1',
            status: 'created',
            acceptedTaskKind: 'general',
            initialCheckpoint: null,
          }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

      const ownershipStore = new TerminalOwnershipStore(join(tempDir, 'terminal-state.json'));
      const client = new TerminalRunClient({
        baseUrl,
        workspaceRoot,
        fetchImpl: fetchMock,
        ownershipStore,
      });

      const created = await client.createRun({
        prompt: 'inspect the workspace from the terminal cli',
        modelId: 'model-terminal',
        toolIds: ['git_scan'],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/api/runs`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            input: {
              prompt: 'inspect the workspace from the terminal cli',
              toolIds: ['git_scan'],
            },
            preferredModel: 'model-terminal',
            surface: 'terminal-cli',
          }),
        }),
      );
      expect(created.runId).toBe('run_term_1');

      expect(resolveOwnedRunTarget({
        baseUrl,
        workspaceRoot,
        ownershipStore,
      })).toBe('run_term_1');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the owned run when interrupting without an explicit run id', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'risk-agent-terminal-cli-'));

    try {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const ownershipStore = new TerminalOwnershipStore(join(tempDir, 'terminal-state.json'));
      ownershipStore.save({
        baseUrl,
        workspaceRoot,
        runId: 'run_owned_1',
        updatedAt: '2026-05-07T08:00:00.000Z',
      });

      const client = new TerminalRunClient({
        baseUrl,
        workspaceRoot,
        fetchImpl: fetchMock,
        ownershipStore,
      });

      await client.cancelRun(resolveOwnedRunTarget({
        baseUrl,
        workspaceRoot,
        ownershipStore,
      })!);

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/api/runs/run_owned_1/cancel`,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('submits waiting_user input through the run input endpoint', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'risk-agent-terminal-cli-'));

    try {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, runId: 'run_wait_1', accepted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const ownershipStore = new TerminalOwnershipStore(join(tempDir, 'terminal-state.json'));
      const client = new TerminalRunClient({
        baseUrl,
        workspaceRoot,
        fetchImpl: fetchMock,
        ownershipStore,
      });

      const result = await client.submitInput('run_wait_1', {
        input: '确认',
        approved: true,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/api/runs/run_wait_1/input`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            input: '确认',
            approved: true,
          }),
        }),
      );
      expect(result).toEqual({ ok: true, runId: 'run_wait_1', accepted: true });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('stops streaming once waiting_user is emitted when requested', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'risk-agent-terminal-cli-'));

    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"eventId":"evt_1","runId":"run_wait_2","type":"agent_status","payload":{"message":"thinking"}}',
              '',
              'data: {"eventId":"evt_2","runId":"run_wait_2","type":"waiting_user","payload":{"question":"是否确认启用技能包？","options":["确认","取消"]}}',
              '',
              'data: {"eventId":"evt_3","runId":"run_wait_2","type":"run_completed","payload":{"status":"completed"}}',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      });

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );

      const ownershipStore = new TerminalOwnershipStore(join(tempDir, 'terminal-state.json'));
      const client = new TerminalRunClient({
        baseUrl,
        workspaceRoot,
        fetchImpl: fetchMock,
        ownershipStore,
      });

      const streamedTypes: string[] = [];
      for await (const event of client.streamRun('run_wait_2', {
        stopWhen: (event) => event.type === 'waiting_user',
      })) {
        streamedTypes.push(event.type);
      }

      expect(streamedTypes).toEqual(['agent_status', 'waiting_user']);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});