/**
 * coordinatorMode — Coordinator 模式检测与会话模式匹配
 * （参考 v3.3-evolution-delta.md §3.4 / §4.3）
 */

/**
 * 检查当前进程是否处于 Coordinator 模式。
 * 通过环境变量 RISK_AGENT_COORDINATOR_MODE=1 控制。
 */
export function isCoordinatorMode(): boolean {
  return process.env['RISK_AGENT_COORDINATOR_MODE'] === '1';
}

/**
 * matchSessionMode — 检查当前 Coordinator 模式是否与会话存储的模式匹配。
 * 不匹配时翻转环境变量，使 isCoordinatorMode() 返回正确值。
 *
 * @param sessionMode - sessions 表中存储的 mode 列（'coordinator' | 'normal' | null | undefined）
 * @returns 提示消息（若发生模式切换）或 undefined（无需切换）
 *
 * (v3.3-evolution-delta.md §3.4)
 */
export function matchSessionMode(
  sessionMode: 'coordinator' | 'normal' | null | undefined,
): string | undefined {
  if (!sessionMode) return undefined; // 旧会话无模式记录，不干预

  const currentIsCoordinator = isCoordinatorMode();
  const sessionIsCoordinator = sessionMode === 'coordinator';

  if (currentIsCoordinator === sessionIsCoordinator) return undefined;

  // 翻转环境变量以匹配会话模式
  if (sessionIsCoordinator) {
    process.env['RISK_AGENT_COORDINATOR_MODE'] = '1';
  } else {
    delete process.env['RISK_AGENT_COORDINATOR_MODE'];
  }

  return sessionIsCoordinator
    ? '已进入协调者模式以匹配恢复的会话。'
    : '已退出协调者模式以匹配恢复的会话。';
}

/**
 * getCoordinatorUserContext — 生成 Coordinator System Prompt 中 Worker 工具上下文片段。
 * 仅在 Coordinator 模式下返回非空对象。
 *
 * @param workerTools - Worker 可用工具名列表（过滤掉 INTERNAL_WORKER_TOOLS 后）
 * @param mcpServerNames - 已连接的 MCP 服务器名称列表
 * @param scratchpadDir - Scratchpad 共享目录路径（可选）
 * @returns 上下文字段对象，供 PromptContext 中的 coordinatorWorkerContext 字段使用
 *
 * (v3.3-evolution-delta.md §4.3)
 */
export function getCoordinatorUserContext(
  workerTools: string[],
  mcpServerNames?: string[],
  scratchpadDir?: string,
): { coordinatorWorkerContext: string } | Record<string, never> {
  if (!isCoordinatorMode()) return {};

  const lines: string[] = [];

  if (workerTools.length > 0) {
    lines.push(`Worker 通过 AgentTool 启动后可用以下工具: ${workerTools.join(', ')}`);
  }

  if (mcpServerNames && mcpServerNames.length > 0) {
    lines.push(`Worker 还可使用以下 MCP 服务器的工具: ${mcpServerNames.join(', ')}`);
  }

  if (scratchpadDir) {
    lines.push(
      `Scratchpad 目录: ${scratchpadDir}`,
      'Worker 可在此目录读写文件而无需权限提示。',
      '用于持久化跨 Worker 知识——按需组织文件结构。',
    );
  }

  return { coordinatorWorkerContext: lines.join('\n') };
}
