import type { TaskPackContext, VerificationRecord } from './types.js';

export interface RunVerifier<TResult = unknown> {
  verify(result: TResult, ctx: TaskPackContext): Promise<VerificationRecord>;
}

export class VerifierOrchestrator<TResult = unknown> {
  constructor(private readonly verifiers: RunVerifier<TResult>[]) {}

  async run(result: TResult, ctx: TaskPackContext): Promise<VerificationRecord> {
    let lastRecord: VerificationRecord | null = null;

    for (const verifier of this.verifiers) {
      const record = await verifier.verify(result, ctx);
      lastRecord = record;
      if (record.decision === 'fail') {
        return record;
      }
    }

    if (!lastRecord) {
      throw new Error('No verifiers registered for run');
    }

    return lastRecord;
  }
}
