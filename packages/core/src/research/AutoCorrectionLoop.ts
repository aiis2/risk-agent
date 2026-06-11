/**
 * AutoCorrectionLoop — 自动纠错循环
 * 参考 research-workflow.md §5 — 自动纠错循环（v3.0）
 *
 * 支持 Coordinator 在 Verification Worker 发现错误后自动触发纠错，
 * 最多重试 MAX_CORRECTION_ROUNDS 次，失败后通知用户等待人工处理。
 */

import type { StreamEvent } from '../agents/base/types.js';

// ──────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────

export type VerificationStatus = 'PASS' | 'WARN' | 'ERROR';

export interface VerificationResult {
  status: VerificationStatus;
  details?: string;
  /** 具体失败的任务描述列表 */
  failedItems?: string[];
}

export interface CorrectionContext {
  type: 'verification_error';
  round: number;
  details: string;
  failedTasks: string[];
}

// ──────────────────────────────────────────────────────────
// AutoCorrectionLoop
// ──────────────────────────────────────────────────────────

/**
 * 自动纠错循环控制器。
 *
 * 使用方式（在 Coordinator run() 内调用）：
 * ```typescript
 * const loop = new AutoCorrectionLoop({ maxCorrectionRounds: 3 })
 * yield* loop.run(verifyFn, correctFn, notifyUserFn)
 * ```
 */
export class AutoCorrectionLoop {
  private rounds = 0;
  private lastErrorDetails: string | undefined;
  private injectedContext: CorrectionContext | undefined;

  readonly maxRounds: number;

  constructor(config?: { maxCorrectionRounds?: number }) {
    this.maxRounds = config?.maxCorrectionRounds ?? 3;
  }

  /**
   * 运行带纠错的验证循环。
   *
   * @param verify  — 验证函数（返回 VerificationResult）
   * @param correct — 纠错函数（接收错误上下文，执行修正）
   * @param notify  — 超过最大次数时的用户通知函数
   */
  async *run(
    verify: () => Promise<VerificationResult>,
    correct: (ctx: CorrectionContext) => AsyncGenerator<StreamEvent>,
    notify: (message: string) => void,
  ): AsyncGenerator<StreamEvent> {

    while (true) {
      const result = await verify();

      if (result.status === 'PASS' || result.status === 'WARN') {
        yield {
          type: 'correction_complete',
          round: this.rounds,
          success: true,
        };
        return;
      }

      // ERROR — 触发纠错
      if (this.rounds >= this.maxRounds) {
        yield {
          type: 'correction_complete',
          round: this.rounds,
          success: false,
        };
        notify(
          `实施结果验证失败（已尝试 ${this.maxRounds} 次自动修正）。\n` +
          `具体问题：${this.lastErrorDetails ?? '未知错误'}\n` +
          `请检查后手动干预或调整分析范围。`,
        );
        return;
      }

      this.rounds++;
      this.lastErrorDetails = result.details;

      const ctx: CorrectionContext = {
        type: 'verification_error',
        round: this.rounds,
        details: result.details ?? '验证失败（无详情）',
        failedTasks: result.failedItems ?? [],
      };
      this.injectedContext = ctx;

      yield {
        type: 'correction_start',
        round: this.rounds,
        reason: ctx.details,
      };

      // 执行纠错逻辑（由调用方提供）
      yield* correct(ctx);
    }
  }

  /** 获取当前注入的纠错上下文（供 correct 函数读取） */
  getLastCorrectionContext(): CorrectionContext | undefined {
    return this.injectedContext;
  }

  /** 获取最后一次错误详情（用于用户通知） */
  getLastErrorDetails(): string | undefined {
    return this.lastErrorDetails;
  }

  /** 当前已进行的纠错轮次 */
  get correctionRounds(): number {
    return this.rounds;
  }
}
