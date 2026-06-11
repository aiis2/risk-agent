/**
 * DreamTaskRunner — Dream Task 后台异步任务执行器
 * （参考 evolution-overview.md v3.3 · agent-framework.md §4.2 Dream Task 生命周期）
 *
 * Dream Task 是非阻塞的后台长期分析任务：
 * - TaskType 'd' 前缀，不占用主对话线程
 * - 任务完成后通过 onComplete 回调通知 Coordinator
 * - 支持中止、状态查询
 * - 存入 agent_checkpoints 表以支持中断恢复
 */

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../logger.js';
import type { StreamEvent, TaskStatus } from '../agents/base/types.js';

const log = createLogger('DreamTaskRunner');

// ──────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────

export type DreamTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DreamTaskDefinition {
  /** 任务 ID（自动生成 d{hex}，如未提供）*/
  id?: string;
  /** 任务描述（对 Coordinator 可见）*/
  description: string;
  /** 任务执行函数，返回结果字符串 */
  execute: (signal: AbortSignal, onProgress: (msg: string) => void) => Promise<string>;
  /** 超时 ms（默认 10 分钟）*/
  timeoutMs?: number;
  /** 会话 ID（关联会话，用于通知路由）*/
  sessionId?: string;
}

export interface DreamTaskState {
  id: string;
  description: string;
  status: DreamTaskStatus;
  sessionId?: string;
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  progress: string[];
}

// ──────────────────────────────────────────────────────────
// DreamTaskRunner
// ──────────────────────────────────────────────────────────

/**
 * Dream Task 管理器
 *
 * 使用方式：
 *   const runner = new DreamTaskRunner()
 *   const taskId = runner.submit({ description: '后台风险分析', execute: async (signal) => { ... } })
 *   runner.on('completed', (state) => console.log(state.result))
 *   runner.on('failed', (state) => console.error(state.error))
 */
export class DreamTaskRunner extends EventEmitter {
  private readonly tasks = new Map<string, DreamTaskState>();
  private readonly controllers = new Map<string, AbortController>();
  /**
   * 待消费的 dream_task_notification 事件队列。
   * Coordinator 在适当时机调用 drainNotifications() 获取并清空。
   */
  private readonly pendingNotifications: Array<{ taskId: string; status: TaskStatus; summary: string }> = [];

  /**
   * 提交 Dream Task，立即返回 task ID，后台异步执行
   */
  submit(def: DreamTaskDefinition): string {
    const id = def.id ?? `d${randomBytes(4).toString('hex')}`;
    const state: DreamTaskState = {
      id,
      description: def.description,
      status: 'queued',
      sessionId: def.sessionId,
      progress: []
    };
    this.tasks.set(id, state);
    log.info({ id, description: def.description }, 'Dream Task queued');
    // 异步启动，不等待
    void this.run(id, def);
    return id;
  }

  /**
   * 中止 Dream Task
   */
  cancel(id: string): boolean {
    const ctrl = this.controllers.get(id);
    if (!ctrl) return false;
    ctrl.abort();
    const state = this.tasks.get(id);
    if (state) {
      state.status = 'cancelled';
      state.completedAt = new Date();
      this.pendingNotifications.push({ taskId: id, status: 'cancelled', summary: `Dream Task 已取消: ${state.description}` });
      this.emit('cancelled', state);
      log.info({ id }, 'Dream Task cancelled');
    }
    return true;
  }

  /**
   * 获取 Dream Task 当前状态
   */
  getState(id: string): DreamTaskState | undefined {
    return this.tasks.get(id);
  }

  /**
   * 列出所有任务（可按状态过滤）
   */
  list(filter?: DreamTaskStatus): DreamTaskState[] {
    const all = Array.from(this.tasks.values());
    return filter ? all.filter((t) => t.status === filter) : all;
  }

  /**
   * 清理已完成/取消/失败的任务（GC）
   */
  cleanup(): number {
    const terminal: DreamTaskStatus[] = ['completed', 'failed', 'cancelled'];
    let count = 0;
    for (const [id, state] of this.tasks) {
      if (terminal.includes(state.status)) {
        this.tasks.delete(id);
        this.controllers.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * 返回所有待消费的 dream_task_notification 事件并清空队列。
   * Coordinator 在推理循环的合适时机（如每轮前）调用，
   * 将结果 yield 给调用方（react-loop-engine.md §1.2）。
   */
  drainNotifications(): StreamEvent[] {
    if (!this.pendingNotifications.length) return [];
    const drained = this.pendingNotifications.map(
      (n): StreamEvent => ({
        type: 'dream_task_notification',
        taskId: n.taskId,
        status: n.status,
        summary: n.summary
      })
    );
    this.pendingNotifications.length = 0;
    return drained;
  }

  /**
   * 以 StreamEvent 形式获取 Dream Task 通知（供 Coordinator 消费）
   */
  toStreamEvent(state: DreamTaskState): StreamEvent {
    if (state.status === 'completed') {
      return {
        type: 'subagent_complete',
        agentId: state.id,
        status: 'completed',
        summary: state.result ?? '(Dream Task 完成)'
      };
    }
    if (state.status === 'failed') {
      return {
        type: 'subagent_complete',
        agentId: state.id,
        status: 'failed',
        summary: `Dream Task 失败: ${state.error ?? 'unknown'}`
      };
    }
    return {
      type: 'subagent_progress',
      agentId: state.id,
      text: state.progress[state.progress.length - 1] ?? '正在后台执行…'
    };
  }

  // ─── 内部执行 ──────────────────────────────────────────

  private async run(id: string, def: DreamTaskDefinition): Promise<void> {
    const state = this.tasks.get(id)!;
    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);

    const timeout = def.timeoutMs ?? 10 * 60 * 1000; // 默认 10min
    const timer = setTimeout(() => {
      ctrl.abort();
      log.warn({ id, timeout }, 'Dream Task timed out');
    }, timeout);

    try {
      state.status = 'running';
      state.startedAt = new Date();
      this.emit('started', state);

      const onProgress = (msg: string) => {
        state.progress.push(`[${new Date().toISOString()}] ${msg}`);
        this.emit('progress', state);
        log.debug({ id, msg }, 'Dream Task progress');
      };

      const result = await def.execute(ctrl.signal, onProgress);
      state.result = result;
      state.status = 'completed';
      state.completedAt = new Date();
      this.pendingNotifications.push({ taskId: id, status: 'completed', summary: result });
      this.emit('completed', state);
      log.info({ id }, 'Dream Task completed');
    } catch (err) {
      if (state.status === 'cancelled') return; // 已被 cancel() 处理
      state.error = (err as Error).message ?? String(err);
      state.status = 'failed';
      state.completedAt = new Date();
      this.pendingNotifications.push({ taskId: id, status: 'failed', summary: `Dream Task 失败: ${state.error}` });
      this.emit('failed', state);
      log.error({ id, err }, 'Dream Task failed');
    } finally {
      clearTimeout(timer);
      this.controllers.delete(id);
    }
  }
}

// ──────────────────────────────────────────────────────────
// 全局单例（可选）
// ──────────────────────────────────────────────────────────

let _globalRunner: DreamTaskRunner | null = null;

export function getGlobalDreamTaskRunner(): DreamTaskRunner {
  if (!_globalRunner) _globalRunner = new DreamTaskRunner();
  return _globalRunner;
}
