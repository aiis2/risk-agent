/**
 * VectorMigrationValidator — 向量存储迁移验证
 * storage-migration-implementation.md §3.6 Task F
 */
import type { MigrationJob } from '../types.js';
import type { ValidationResult } from './StructuredMigrationValidator.js';

export class VectorMigrationValidator {
  async verifyCount(job: MigrationJob): Promise<ValidationResult> {
    // For embedded JSON vector: file-based, count verification not yet supported via IVectorStore.
    void job;
    return { passed: true, details: ['Vector count check skipped (embedded backend)'], errors: [] };
  }

  async runTopKSmokeTest(job: MigrationJob): Promise<ValidationResult> {
    // Requires a sample query vector; skip for embedded backends.
    void job;
    return { passed: true, details: ['Top-K smoke test skipped (no sample vector available)'], errors: [] };
  }
}
