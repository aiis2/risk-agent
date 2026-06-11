import type { RunArtifact, RunEvent, RunSnapshot } from '@risk-agent/core';
import { TerminalOwnershipStore } from './terminalOwnership.js';

export interface TerminalRunClientOptions {
  readonly baseUrl: string;
  readonly workspaceRoot: string;
  readonly ownershipStore: TerminalOwnershipStore;
  readonly fetchImpl?: typeof fetch;
}

export interface CreateTerminalRunInput {
  readonly prompt: string;
  readonly modelId?: string;
  readonly toolIds?: string[];
}

export interface AppendTerminalRunInput {
  readonly content: string;
  readonly modelId?: string;
  readonly toolIds?: string[];
  readonly mode?: 'stop-and-send' | 'queue' | 'steer';
}

export interface SubmitTerminalRunInput {
  readonly [key: string]: unknown;
}

interface CreateRunResponse {
  readonly runId: string;
  readonly status: string;
  readonly acceptedTaskKind: string;
  readonly initialCheckpoint: unknown;
}

interface AppendRunResponse {
  readonly ok: boolean;
  readonly runId: string;
  readonly resumed: boolean;
  readonly interrupted: boolean;
}

interface SubmitRunResponse {
  readonly ok: true;
  readonly runId: string;
  readonly accepted: boolean;
}

export interface TerminalRunStreamOptions {
  readonly signal?: AbortSignal;
  readonly stopWhen?: (event: RunEvent) => boolean;
}

type FetchLike = typeof fetch;

export class TerminalRunClient {
  private readonly fetchImpl: FetchLike;
  private readonly normalizedBaseUrl: string;

  constructor(private readonly options: TerminalRunClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.normalizedBaseUrl = normalizeBaseUrl(options.baseUrl);
  }

  async createRun(input: CreateTerminalRunInput): Promise<CreateRunResponse> {
    const result = await this.requestJson<CreateRunResponse>('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: {
          prompt: input.prompt,
          ...(input.toolIds?.length ? { toolIds: input.toolIds } : {}),
        },
        ...(input.modelId ? { preferredModel: input.modelId } : {}),
        surface: 'terminal-cli',
      }),
    });
    this.markOwnership(result.runId);
    return result;
  }

  async appendMessage(runId: string, input: AppendTerminalRunInput): Promise<AppendRunResponse> {
    const result = await this.requestJson<AppendRunResponse>(`/api/runs/${runId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(input.toolIds?.length ? { toolIds: input.toolIds } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
      }),
    });
    this.markOwnership(runId);
    return result;
  }

  async submitInput(runId: string, input: SubmitTerminalRunInput): Promise<SubmitRunResponse> {
    const result = await this.requestJson<SubmitRunResponse>(`/api/runs/${runId}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    this.markOwnership(runId);
    return result;
  }

  async cancelRun(runId: string): Promise<void> {
    await this.requestJson<{ ok: boolean }>(`/api/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    this.markOwnership(runId);
  }

  async getRun(runId: string): Promise<RunSnapshot> {
    return this.requestJson<RunSnapshot>(`/api/runs/${runId}`);
  }

  async getRunEvents(runId: string): Promise<RunEvent[]> {
    return this.requestJson<RunEvent[]>(`/api/runs/${runId}/events`);
  }

  async getRunArtifacts(runId: string): Promise<RunArtifact[]> {
    return this.requestJson<RunArtifact[]>(`/api/runs/${runId}/artifacts`);
  }

  async *streamRun(runId: string, options?: TerminalRunStreamOptions): AsyncGenerator<RunEvent> {
    this.markOwnership(runId);
    const response = await this.fetchImpl(`${this.normalizedBaseUrl}/api/runs/${runId}/stream`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(await describeHttpError(response));
    }

    if (!response.body) {
      throw new Error('Run stream returned no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const chunk = takeSseChunk(buffer);
        if (!chunk) {
          break;
        }
        buffer = chunk.rest;
        const event = parseSseChunk(chunk.value);
        if (event) {
          yield event;
          if (options?.stopWhen?.(event)) {
            await reader.cancel().catch(() => undefined);
            return;
          }
        }
      }
    }

    buffer += decoder.decode();
    const finalChunk = buffer.trim();
    if (finalChunk) {
      const event = parseSseChunk(finalChunk);
      if (event) {
        yield event;
        if (options?.stopWhen?.(event)) {
          return;
        }
      }
    }
  }

  markOwnership(runId: string): void {
    this.options.ownershipStore.save({
      baseUrl: this.normalizedBaseUrl,
      workspaceRoot: this.options.workspaceRoot,
      runId,
      updatedAt: new Date().toISOString(),
    });
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.normalizedBaseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(await describeHttpError(response));
    }
    return response.json() as Promise<T>;
  }
}

export function resolveOwnedRunTarget(params: {
  readonly baseUrl: string;
  readonly workspaceRoot: string;
  readonly ownershipStore: TerminalOwnershipStore;
  readonly explicitRunId?: string;
}): string | undefined {
  if (params.explicitRunId?.trim()) {
    return params.explicitRunId.trim();
  }

  return params.ownershipStore.load({
    baseUrl: normalizeBaseUrl(params.baseUrl),
    workspaceRoot: params.workspaceRoot,
  })?.runId;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '').replace(/\/api$/, '');
}

function takeSseChunk(buffer: string): { value: string; rest: string } | null {
  const boundaries = [
    { index: buffer.indexOf('\r\n\r\n'), length: 4 },
    { index: buffer.indexOf('\n\n'), length: 2 },
  ].filter((item) => item.index >= 0);

  if (boundaries.length === 0) {
    return null;
  }

  const firstBoundary = boundaries.reduce((best, current) => (current.index < best.index ? current : best));
  return {
    value: buffer.slice(0, firstBoundary.index),
    rest: buffer.slice(firstBoundary.index + firstBoundary.length),
  };
}

function parseSseChunk(chunk: string): RunEvent | null {
  const dataLines = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join('\n')) as RunEvent;
  } catch {
    return null;
  }
}

async function describeHttpError(response: Response): Promise<string> {
  const fallback = `Request failed with status ${response.status}`;
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.detail === 'string' && body.detail.trim()) {
      return body.detail;
    }
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
}