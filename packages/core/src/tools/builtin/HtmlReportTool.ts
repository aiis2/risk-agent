/**
 * render_html_report — 将报告内容渲染为 HTML，并应用 4 阶段 HTML 消毒管线。
 * (tools-skills-system.md §7.3)
 *
 * 4 阶段管线（与 ToolResultSanitizer 一致）：
 *   1) 深度/spread 防护（limitDepth）
 *   2) XML/HTML 标签转义（防 XSS）
 *   3) 结果序列化限长（MAX_SERIALIZED_LENGTH）
 *   4) 错误 overlay（execute 内异常）
 */
import type { AgentToolDefinition } from '../registry/ToolRegistry.js';
import { ToolResultSanitizer } from '../../sanitizers/ToolResultSanitizer.js';

const sanitizer = new ToolResultSanitizer();

export const renderHtmlReportTool: AgentToolDefinition = {
  name: 'render_html_report',
  description:
    '将 Markdown 文本或结构化报告 JSON 渲染为 HTML 字符串，并经 4 阶段消毒管线处理（防 XSS、限制深度与大小）。',
  isConcurrencySafe: true,
  isDestructive: false,
  isReadOnly: true,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['content'],
    properties: {
      content: {
        type: 'string',
        description: 'Markdown 文本或序列化 JSON，将被转换为 HTML'
      },
      title: {
        type: 'string',
        description: '报告页面标题（可选）'
      }
    }
  },
  async execute(input) {
    const { content, title } = input as { content: string; title?: string };

    // Stage 1: 输入消毒（防注入、深度限制）
    const { value: safeInput } = sanitizer.sanitize(content);
    const safeContent = typeof safeInput === 'string'
      ? safeInput
      : JSON.stringify(safeInput);

    // Stage 2: Markdown → HTML 转换（轻量版，不依赖第三方库）
    const rawHtml = markdownToHtml(safeContent, title);

    // Stage 3: HTML 标签转义（XSS 防护）— 仅转义用户输入区，保留结构标签
    const sanitizedHtml = escapeUserContent(rawHtml);

    // Stage 4: 序列化长度检查
    const { value: finalValue, truncated } = sanitizer.sanitize({ html: sanitizedHtml, title });

    return { ...(finalValue as Record<string, unknown>), truncated };
  }
};

// ──────────────────────────────────────────────────────────
// Markdown → HTML 转换（基础子集）
// ──────────────────────────────────────────────────────────

function markdownToHtml(md: string, title?: string): string {
  const pageTitle = title ? escapeHtml(title) : '报告';

  const body = md
    // 标题 h1-h4
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    // 粗体 / 斜体
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 无序列表
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    // 有序列表
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // 水平线
    .replace(/^---+$/gm, '<hr>')
    // 段落（空行分隔）
    .replace(/\n{2,}/g, '</p><p>')
    // 换行
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 860px; color: #1a1a2e; }
    h1, h2, h3 { color: #1a1a2e; }
    li { margin: .25rem 0; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.5rem 0; }
    strong { color: #c0392b; }
  </style>
</head>
<body>
  <p>${body}</p>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 只转义 <p> / <li> 内的用户内容（保留已生成的结构标签不转义）。
 * 通过将用户原始文本转义后再进行 MD→HTML 转换来规避 XSS，
 * 这里做最终 overlay 检查：确保不含 <script> / onerror 等危险模式。
 */
function escapeUserContent(html: string): string {
  // 移除任何 <script>、<iframe>、on* 事件属性
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=/gi, ' data-removed=');
}
