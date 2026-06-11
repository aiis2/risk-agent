import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TerminalOwnedRunRecord {
  readonly baseUrl: string;
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly updatedAt: string;
}

interface TerminalOwnershipState {
  readonly version: 1;
  readonly records: TerminalOwnedRunRecord[];
}

const EMPTY_STATE: TerminalOwnershipState = {
  version: 1,
  records: [],
};

/** Maximum number of distinct (baseUrl, workspaceRoot) pairs to retain. */
const MAX_RECORDS = 50;

export class TerminalOwnershipStore {
  constructor(private readonly filePath: string) {}

  load(params: { baseUrl: string; workspaceRoot: string }): TerminalOwnedRunRecord | undefined {
    return this.readState().records.find(
      (record) => record.baseUrl === params.baseUrl && record.workspaceRoot === params.workspaceRoot,
    );
  }

  save(record: TerminalOwnedRunRecord): void {
    const state = this.readState();
    const nextRecords = state.records.filter(
      (entry) => !(entry.baseUrl === record.baseUrl && entry.workspaceRoot === record.workspaceRoot),
    );
    nextRecords.push(record);
    // Keep only the most recent MAX_RECORDS entries to prevent unbounded file growth.
    const trimmed = nextRecords.length > MAX_RECORDS
      ? nextRecords.slice(nextRecords.length - MAX_RECORDS)
      : nextRecords;
    this.writeState({ version: 1, records: trimmed });
  }

  clear(params: { baseUrl: string; workspaceRoot: string }): void {
    const state = this.readState();
    const nextRecords = state.records.filter(
      (record) => !(record.baseUrl === params.baseUrl && record.workspaceRoot === params.workspaceRoot),
    );
    this.writeState({ version: 1, records: nextRecords });
  }

  private readState(): TerminalOwnershipState {
    if (!existsSync(this.filePath)) {
      return EMPTY_STATE;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TerminalOwnershipState>;
      if (!Array.isArray(parsed.records)) {
        return EMPTY_STATE;
      }
      return {
        version: 1,
        records: parsed.records.filter(isOwnedRunRecord),
      };
    } catch {
      return EMPTY_STATE;
    }
  }

  private writeState(state: TerminalOwnershipState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }
}

function isOwnedRunRecord(value: unknown): value is TerminalOwnedRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.baseUrl === 'string'
    && typeof record.workspaceRoot === 'string'
    && typeof record.runId === 'string'
    && typeof record.updatedAt === 'string'
  );
}