/**
 * Task ID 生成工具（参考 agent-framework.md §11 · evolution-overview.md §4.2 TaskType ID 前缀体系）
 *
 * 命名约定：
 *   local_agent          → a{8-char hex}   (e.g. a3f7d2b1)
 *   local_bash           → b{8-char hex}   (e.g. b5a9c1e4)
 *   local_workflow       → w{8-char hex}   (e.g. w9c4e8a2)
 *   subagent             → s{8-char hex}   (e.g. s1d5f7c3)
 *   remote_agent         → r{8-char hex}
 *   in_process_teammate  → t{8-char hex}
 *   monitor_mcp          → m{8-char hex}
 *   dream                → d{8-char hex}
 */

import { randomBytes } from 'node:crypto';
import type { TaskType } from '../agents/base/types.js';

const PREFIX_MAP: Record<TaskType, string> = {
  local_agent: 'a',
  local_bash: 'b',
  local_workflow: 'w',
  subagent: 's',
  remote_agent: 'r',
  in_process_teammate: 't',
  monitor_mcp: 'm',
  dream: 'd'
};

/**
 * 生成符合 agent-framework.md §11 前缀规范的 Task ID。
 * @param type TaskType — 任务类型
 * @returns 8字符 hex 带单字母前缀的 ID，如 "a3f7d2b1"
 */
export function generateTaskId(type: TaskType): string {
  const prefix = PREFIX_MAP[type] ?? 'x';
  return `${prefix}${randomBytes(4).toString('hex')}`;
}
