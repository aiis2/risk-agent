/**
 * ProfileDiffEngine — 业务画像演化对比（03-analysis-engine.md §4）
 *
 * 对比同一业务在不同时间点的两个 BusinessProfile，
 * 识别风控覆盖变化趋势。
 */

import type { BusinessProfile } from './base/types.js';

export interface DimensionChange {
  dimension: string;
  ratioA: number;
  ratioB: number;
  delta: number;
}

export interface ProfileEntityDiff {
  entityType: string;
  name: string;
  count: number;
  attributes: Record<string, unknown>;
}

export interface ProfileDiff {
  profileIdA: string;
  profileIdB: string;
  businessName: string;
  versionA: number;
  versionB: number;
  /** 分数变化（正数=改善，负数=恶化） */
  scoreDelta: number;
  scoreA: number;
  scoreB: number;
  /** v2 相比 v1 新增的实体类型 */
  addedEntities: ProfileEntityDiff[];
  /** v1 有而 v2 没有的实体类型 */
  removedEntities: ProfileEntityDiff[];
  /** 各维度覆盖度变化 */
  dimensionChanges: DimensionChange[];
  behaviorCountA: number;
  behaviorCountB: number;
}

export class ProfileDiffEngine {
  /**
   * 对比两版画像，返回结构化 delta
   */
  static compare(a: BusinessProfile, b: BusinessProfile): ProfileDiff {
    // 实体对比
    const entA: Record<string, any> = {};
    const entB: Record<string, any> = {};
    for (const e of (a.entities as any[] ?? [])) {
      entA[`${e.entityType}:${e.name}`] = e;
    }
    for (const e of (b.entities as any[] ?? [])) {
      entB[`${e.entityType}:${e.name}`] = e;
    }
    const addedEntities = Object.keys(entB)
      .filter((k) => !entA[k])
      .map((k) => entB[k] as ProfileEntityDiff);
    const removedEntities = Object.keys(entA)
      .filter((k) => !entB[k])
      .map((k) => entA[k] as ProfileEntityDiff);

    // 维度覆盖度对比
    const dimA: Record<string, number> = {};
    const dimB: Record<string, number> = {};
    for (const d of (a.apiFeatures as any[] ?? [])) {
      dimA[d.dimension] = d.coverageRatio;
    }
    for (const d of (b.apiFeatures as any[] ?? [])) {
      dimB[d.dimension] = d.coverageRatio;
    }
    const allDims = new Set([...Object.keys(dimA), ...Object.keys(dimB)]);
    const dimensionChanges: DimensionChange[] = Array.from(allDims).map((dim) => ({
      dimension: dim,
      ratioA: dimA[dim] ?? 0,
      ratioB: dimB[dim] ?? 0,
      delta: (dimB[dim] ?? 0) - (dimA[dim] ?? 0)
    }));

    const scoreA = a.overallScore ?? 0;
    const scoreB = b.overallScore ?? 0;

    return {
      profileIdA: a.profileId,
      profileIdB: b.profileId,
      businessName: a.businessName,
      versionA: a.version ?? 1,
      versionB: b.version ?? 1,
      scoreDelta: scoreB - scoreA,
      scoreA,
      scoreB,
      addedEntities,
      removedEntities,
      dimensionChanges,
      behaviorCountA: (a.behaviors as any[] ?? []).length,
      behaviorCountB: (b.behaviors as any[] ?? []).length
    };
  }
}
