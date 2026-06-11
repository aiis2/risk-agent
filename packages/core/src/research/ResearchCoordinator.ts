import type { StreamEvent } from '../agents/base/types.js';
import { ResearchAggregator, type ResearchDimensionResult } from './ResearchAggregator.js';
import type { RuleGapMap } from '../agents/base/types.js';
import { type ResearchDimension, shouldSkipDimension } from './ResearchDimensions.js';

export type ResearchProducer = (dimension: string) => Promise<ResearchDimensionResult>;

// ──────────────────────────────────────────────────────────
// ResearchCoordinator
// ──────────────────────────────────────────────────────────

export class ResearchCoordinator {
  private readonly aggregator = new ResearchAggregator();

  /**
   * run — 基础版本（向后兼容），接受 string[] 维度列表。
   * 内部使用 yield-as-ready 模式（Promise.race），逐个 Worker 完成即 yield。
   */
  async *run(
    dimensions: string[],
    scenarioIds: string[],
    produce: ResearchProducer,
  ): AsyncGenerator<StreamEvent, RuleGapMap, undefined> {
    return yield* this._runDimensions(
      dimensions.map((id) => ({ id, name: id, workers: [], required: true })),
      scenarioIds,
      produce,
    );
  }

  /**
   * runWithDimensions — 完整版本（research-workflow.md §2.3）。
   * 接受 ResearchDimension[] 规格，支持：
   * - 超预算时跳过 required=false 的可选维度
   * - yield-as-ready（Promise.race 模式）
   *
   * @param dimensions  维度列表（含 required 标记）
   * @param scenarioIds 业务场景 ID 列表
   * @param produce     生产函数
   * @param budget      可选预算上下文（usedUsd / totalUsd）
   */
  async *runWithDimensions(
    dimensions: ResearchDimension[],
    scenarioIds: string[],
    produce: ResearchProducer,
    budget?: { usedUsd: number; totalUsd: number },
  ): AsyncGenerator<StreamEvent, RuleGapMap, undefined> {
    return yield* this._runDimensions(dimensions, scenarioIds, produce, budget);
  }

  // ─── 内部实现 ─────────────────────────────────────────────

  private async *_runDimensions(
    dimensions: ResearchDimension[],
    scenarioIds: string[],
    produce: ResearchProducer,
    budget?: { usedUsd: number; totalUsd: number },
  ): AsyncGenerator<StreamEvent, RuleGapMap, undefined> {

    const results: ResearchDimensionResult[] = [];

    // 1. 派发所有维度（跳过超预算的可选维度）
    const pending = new Map<string, Promise<{ id: string; result: ResearchDimensionResult }>>();

    for (const dim of dimensions) {
      if (budget && shouldSkipDimension(dim, budget.usedUsd, budget.totalUsd)) {
        yield { type: 'research_progress', dimension: dim.id, status: 'skipped' };
        continue;
      }
      yield { type: 'research_progress', dimension: dim.id, status: 'started' };
      pending.set(
        dim.id,
        produce(dim.id).then((r) => ({ id: dim.id, result: r })),
      );
    }

    // 2. yield-as-ready：Promise.race 实现按完成顺序 yield（research-workflow.md §2.3）
    while (pending.size > 0) {
      const { id, result } = await Promise.race(pending.values());
      pending.delete(id);
      results.push(result);
      yield { type: 'research_progress', dimension: id, status: 'completed' };
    }

    // 3. 聚合节点
    yield { type: 'research_progress', dimension: 'aggregation', status: 'aggregating' };
    const map = this.aggregator.aggregate(results, scenarioIds);
    yield { type: 'research_progress', dimension: 'aggregation', status: 'completed' };
    yield {
      type: 'research_complete',
      dimensions: dimensions.map((d) => d.id),
      aggregatedTokens: results.reduce((s, r) => s + (r.tokens ?? 0), 0),
    };
    return map;
  }
}

