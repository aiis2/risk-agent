/**
 * SkillImprover — A5 技能自改进代理（dryRun 模式）
 *
 * 流程：
 * 1. 在 skill-management 类 run 完成后触发
 * 2. 调用 sidecar `/curate?kind=skill_curate` 分析技能使用情况
 * 3. 将建议写入 `skill_revisions` 表（status='pending'）
 * 4. 内置技能（is_built_in=1）强制 fork，不直接修改
 * 5. 默认 dryRun=true，仅记录差异；用户在 Settings SkillsSection 审核后才回写
 */

import { randomUUID } from 'node:crypto';
import { getSidecarClient, type CurateSkillResponse } from '../services/SidecarClient.js';

export interface SkillImproverDeps {
  db: {
    run(sql: string, params?: unknown[]): Promise<unknown>;
    all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  };
  logger?: { info(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void };
}

export interface SkillRevisionInput {
  skillId: string;
  skillName: string;
  currentMd: string;
  /** 触发本次评估的 run 摘要 */
  runSummary: string;
  /** dryRun=true 仅记录，不回写文件 */
  dryRun?: boolean;
}

export class SkillImprover {
  constructor(private readonly deps: SkillImproverDeps) {}

  async improve(input: SkillRevisionInput): Promise<void> {
    const { skillId, skillName, currentMd, runSummary, dryRun = true } = input;
    const { logger } = this.deps;

    logger?.info('SkillImprover.improve start', { skillId, skillName, dryRun });

    let improvedMd: string | undefined;
    let reason = 'no suggestions';
    let confidence = 0;

    try {
      const sidecar = getSidecarClient();
      const healthy = await sidecar.isHealthy();
      if (healthy) {
        const result = await sidecar.curate({
          kind: 'skill_curate',
          skillId,
          skillName,
          currentMd,
          recentRunSummary: runSummary,
        });
        const skillResult = result as CurateSkillResponse | null;
        if (skillResult?.improvedMd) {
          improvedMd = skillResult.improvedMd;
          reason = skillResult.reason ?? 'sidecar suggestion';
          confidence = skillResult.confidence ?? 0.5;
        }
      }
    } catch {
      // sidecar 不可用 — 静默跳过
    }

    if (!improvedMd || improvedMd === currentMd) {
      logger?.info('SkillImprover: no improvement suggested', { skillId });
      return;
    }

    // 检查是否内置技能
    const builtinRows = await this.deps.db.all<{ is_builtin: number }>(
      `SELECT is_builtin FROM skills WHERE skill_id = ? LIMIT 1`,
      [skillId],
    ).catch(() => []);
    const isBuiltin = (builtinRows[0]?.is_builtin ?? 0) === 1;

    // 写入 skill_revisions 表（匹配 schema: rev_id, skill_id, skill_name, before_md, after_md, reason, status）
    await this.deps.db.run(
      `INSERT OR IGNORE INTO skill_revisions(
         rev_id, skill_id, skill_name, before_md, after_md, reason, status, created_at
       ) VALUES(?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
      [
        randomUUID(),
        skillId,
        skillName,
        currentMd,
        improvedMd,
        `[confidence:${confidence.toFixed(2)}][dryRun:${dryRun}][builtin:${isBuiltin}] ${reason}`,
      ],
    ).catch((err: unknown) => {
      logger?.error('SkillImprover: failed to write revision', { err });
    });

    logger?.info('SkillImprover: revision recorded', { skillId, confidence, isBuiltin, dryRun });
  }
}

let _instance: SkillImprover | null = null;
export function getSkillImprover(deps: SkillImproverDeps): SkillImprover {
  if (!_instance) _instance = new SkillImprover(deps);
  return _instance;
}
