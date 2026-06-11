/**
 * ProfileTools — 业务画像构建与缺口分析工具
 * (08-tools-skills.md §6.2 分析工具)
 *
 * profile_build — 从数据源提取业务实体，写入 SQLite + 图谱
 * gap_analysis  — 对比画像与风控规则，识别覆盖缺口
 */

import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

// ────────────────────────────────────────────────────────────
// profile_build
// ────────────────────────────────────────────────────────────

export const profileBuildTool: AgentToolDefinition = {
  name: 'profile_build',
  description:
    '基于数据源抽取业务实体，构建业务画像，结果写入结构化存储（SQLite）与业务图谱（Graphology）。',
  isConcurrencySafe: false,
  isDestructive: false,
  isReadOnly: false,
  alwaysLoad: false,
  searchHint: '业务画像 profile 构建 实体抽取 build',
  inputSchema: {
    type: 'object',
    required: ['businessName'],
    properties: {
      businessName: {
        type: 'string',
        description: '业务名称，作为画像的主键标识',
      },
      dataSourceIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要纳入分析的数据源 ID 列表（可选，默认使用全部已接入数据源）',
      },
      scenarioId: {
        type: 'string',
        description: '所属业务场景 ID（可选）',
      },
      overwrite: {
        type: 'boolean',
        description: '若画像已存在是否覆盖（默认 false）',
      },
    },
  },
  async execute(input) {
    const { businessName } = input as { businessName: string };
    // 实际执行由 QueryEngine 层注入 StorageRegistry 后完成；
    // 此 execute 为协议占位，防止被直接调用时报错。
    return {
      status: 'pending',
      message: `profile_build: 业务 "${businessName}" 画像构建请求已接收，等待 QueryEngine 执行`,
    };
  },
};

// ────────────────────────────────────────────────────────────
// gap_analysis
// ────────────────────────────────────────────────────────────

export const gapAnalysisTool: AgentToolDefinition = {
  name: 'gap_analysis',
  description:
    '将业务画像与已有风控规则进行覆盖度比对，识别高风险操作缺乏规则覆盖的缺口，输出结构化缺口报告。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  searchHint: '缺口分析 gap 覆盖度 规则 风险 coverage',
  inputSchema: {
    type: 'object',
    required: ['profileId'],
    properties: {
      profileId: {
        type: 'string',
        description: '目标业务画像 ID',
      },
      ruleIds: {
        type: 'array',
        items: { type: 'string' },
        description: '限定参与对比的规则 ID（可选，默认使用全部规则）',
      },
      minRiskScore: {
        type: 'number',
        description: '输出缺口的最低风险评分阈值（0–10，默认 5）',
      },
    },
  },
  async execute(input) {
    const { profileId } = input as { profileId: string };
    return {
      status: 'pending',
      message: `gap_analysis: 画像 "${profileId}" 缺口分析请求已接收，等待 QueryEngine 执行`,
    };
  },
};
