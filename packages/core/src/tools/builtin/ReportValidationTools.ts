/**
 * ReportValidationTools — 报告验证与告警发送工具
 * (08-tools-skills.md §6.4 输出工具)
 *
 * validate_report — 检查报告完整性与质量
 * alert_send      — 向指定渠道发送风险告警通知
 */

import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

// ────────────────────────────────────────────────────────────
// validate_report
// ────────────────────────────────────────────────────────────

export const validateReportTool: AgentToolDefinition = {
  name: 'validate_report',
  description:
    '检查风控分析报告的完整性：章节覆盖度、关键指标填充率、规则引用有效性。返回验证结果与缺失项列表。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  searchHint: '报告验证 validate report 完整性 质量检查',
  inputSchema: {
    type: 'object',
    required: ['reportId'],
    properties: {
      reportId: {
        type: 'string',
        description: '待验证的报告 ID',
      },
      checks: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['sections', 'metrics', 'rules', 'references', 'all'],
        },
        description: '要执行的验证项（默认 ["all"]）',
      },
    },
  },
  async execute(input) {
    const { reportId } = input as { reportId: string };
    return {
      status: 'pending',
      message: `validate_report: 报告 "${reportId}" 验证请求已接收，等待 QueryEngine 执行`,
    };
  },
};

// ────────────────────────────────────────────────────────────
// alert_send
// ────────────────────────────────────────────────────────────

export const alertSendTool: AgentToolDefinition = {
  name: 'alert_send',
  description:
    '向指定渠道发送风险告警通知（支持 webhook / email / 企业微信 / 钉钉）。属于破坏性操作，执行前需权限确认。',
  isConcurrencySafe: false,
  isDestructive: true,
  isReadOnly: false,
  alwaysLoad: false,
  searchHint: '告警 alert 通知 webhook 企业微信 钉钉 email',
  inputSchema: {
    type: 'object',
    required: ['channel', 'title', 'body'],
    properties: {
      channel: {
        type: 'string',
        enum: ['webhook', 'email', 'wecom', 'dingtalk'],
        description: '告警渠道类型',
      },
      endpoint: {
        type: 'string',
        description: '目标地址（Webhook URL / 邮件地址 / 机器人 Key 等）',
      },
      title: {
        type: 'string',
        description: '告警标题',
      },
      body: {
        type: 'string',
        description: '告警正文（Markdown 格式）',
      },
      severity: {
        type: 'string',
        enum: ['info', 'warning', 'critical'],
        description: '告警级别（默认 warning）',
      },
    },
  },
  async execute(input) {
    const { severity, title } = input as { severity?: string; title: string };
    return {
      status: 'pending',
      message: `alert_send: [${severity ?? 'warning'}] "${title}" 告警发送请求已接收，等待 QueryEngine 执行`,
    };
  },
};
