/**
 * TaskDAG — DAG 任务图，支持依赖关系的拓扑排序与并行执行层计算。
 * packages/core/src/scheduler/TaskDAG.ts
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DAGTask<TResult = unknown> {
  id: string;
  /** 依赖的上游任务 ID 列表（这些任务完成后才能执行本任务） */
  deps: string[];
  /** 任务执行函数 */
  run: (results: Map<string, TResult>) => Promise<TResult>;
  /** 任务超时（ms），默认 60_000 */
  timeoutMs?: number;
}

export interface DAGResult<TResult = unknown> {
  taskId: string;
  status: TaskStatus;
  result?: TResult;
  error?: Error;
  durationMs: number;
}

/**
 * 计算 DAG 的执行波次（按拓扑序分层）。
 * 每个波次内的任务之间没有互相依赖，可以并行执行。
 */
export function computeWaves<TResult>(tasks: DAGTask<TResult>[]): string[][] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const completed = new Set<string>();
  const waves: string[][] = [];
  const remaining = new Set(tasks.map((t) => t.id));

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      const task = taskMap.get(id)!;
      if (task.deps.every((dep) => completed.has(dep))) {
        wave.push(id);
      }
    }
    if (wave.length === 0) {
      throw new Error(
        `TaskDAG: circular dependency detected. Remaining: [${[...remaining].join(', ')}]`,
      );
    }
    waves.push(wave);
    for (const id of wave) {
      completed.add(id);
      remaining.delete(id);
    }
  }

  return waves;
}

export class TaskDAG<TResult = unknown> {
  private readonly taskMap: Map<string, DAGTask<TResult>>;

  constructor(tasks: DAGTask<TResult>[]) {
    this.taskMap = new Map(tasks.map((t) => [t.id, t]));
    // Validate deps exist
    for (const [id, task] of this.taskMap) {
      for (const dep of task.deps) {
        if (!this.taskMap.has(dep)) {
          throw new Error(`TaskDAG: task "${id}" depends on unknown task "${dep}"`);
        }
      }
    }
  }

  get tasks(): DAGTask<TResult>[] {
    return [...this.taskMap.values()];
  }

  /**
   * 返回执行波次（每波并行执行）。
   */
  waves(): string[][] {
    return computeWaves(this.tasks);
  }

  /**
   * 按 DAG 顺序执行所有任务，支持并发。
   * @param onTaskStart 任务开始时回调
   * @param onTaskDone  任务完成/失败时回调
   */
  async execute(
    opts?: {
      onTaskStart?: (taskId: string) => void;
      onTaskDone?: (result: DAGResult<TResult>) => void;
    },
  ): Promise<Map<string, DAGResult<TResult>>> {
    const results = new Map<string, DAGResult<TResult>>();
    const taskResults = new Map<string, TResult>();

    for (const wave of this.waves()) {
      await Promise.all(
        wave.map(async (id) => {
          const task = this.taskMap.get(id)!;
          const startedAt = Date.now();
          opts?.onTaskStart?.(id);
          try {
            const timeoutMs = task.timeoutMs ?? 60_000;
            const result = await Promise.race([
              task.run(taskResults),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Task "${id}" timed out after ${timeoutMs}ms`)), timeoutMs),
              ),
            ]);
            taskResults.set(id, result);
            const r: DAGResult<TResult> = {
              taskId: id,
              status: 'completed',
              result,
              durationMs: Date.now() - startedAt,
            };
            results.set(id, r);
            opts?.onTaskDone?.(r);
          } catch (err) {
            const r: DAGResult<TResult> = {
              taskId: id,
              status: 'failed',
              error: err instanceof Error ? err : new Error(String(err)),
              durationMs: Date.now() - startedAt,
            };
            results.set(id, r);
            opts?.onTaskDone?.(r);
            throw r.error;
          }
        }),
      );
    }

    return results;
  }
}
