/**
 * ParallelScheduler — 带并发控制的并行任务调度器。
 * packages/core/src/scheduler/ParallelScheduler.ts
 *
 * 与 TaskDAG 的区别：ParallelScheduler 不要求明确的依赖图，
 * 而是按批次（wave）并行执行，支持最大并发数限制。
 */

export type SchedulerTaskFn<T> = () => Promise<T>;

export interface SchedulerTask<T> {
  id: string;
  fn: SchedulerTaskFn<T>;
}

export interface SchedulerResult<T> {
  id: string;
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: unknown;
}

/**
 * 简单并行调度器：将任务按 `concurrency` 并发执行，按提交顺序依次启动。
 */
export class ParallelScheduler<T = unknown> {
  constructor(private readonly concurrency: number = 4) {
    if (concurrency < 1) throw new Error('ParallelScheduler: concurrency must be >= 1');
  }

  /**
   * 执行所有任务，最多同时运行 `concurrency` 个，
   * 返回与输入数组等长的结果列表（不抛出单任务错误）。
   */
  async run(tasks: SchedulerTask<T>[]): Promise<SchedulerResult<T>[]> {
    const results: SchedulerResult<T>[] = new Array(tasks.length);
    let idx = 0;

    const worker = async () => {
      while (idx < tasks.length) {
        const current = idx++;
        const task = tasks[current];
        try {
          const value = await task.fn();
          results[current] = { id: task.id, status: 'fulfilled', value };
        } catch (reason) {
          results[current] = { id: task.id, status: 'rejected', reason };
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.concurrency, tasks.length) }, worker);
    await Promise.all(workers);

    return results;
  }

  /**
   * 执行所有任务并以 AsyncGenerator 形式逐个 yield 结果（先完成先返回）。
   */
  async *runStream(tasks: SchedulerTask<T>[]): AsyncGenerator<SchedulerResult<T>> {
    const queue: Array<Promise<SchedulerResult<T>>> = [];
    let idx = 0;

    const fill = () => {
      while (queue.length < this.concurrency && idx < tasks.length) {
        const task = tasks[idx++];
        queue.push(
          task.fn().then(
            (value) => ({ id: task.id, status: 'fulfilled' as const, value }),
            (reason) => ({ id: task.id, status: 'rejected' as const, reason }),
          ),
        );
      }
    };

    fill();
    while (queue.length > 0) {
      const result = await Promise.race(queue.map((p, i) => p.then((r) => ({ r, i }))));
      queue.splice(result.i, 1);
      fill();
      yield result.r;
    }
  }
}
