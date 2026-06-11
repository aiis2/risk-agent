import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

// ─── 内置轻量 HTML 标签剥离器 ──────────────────────────────────────────────

/** 简单剥除 HTML 标签，保留文字内容（无需外部依赖） */
function stripHtml(html: string): string {
  return html
    // 移除 <script> 和 <style> 块（含内容）
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // 块级元素插换行
    .replace(/<\/(p|div|li|h[1-6]|tr|br|blockquote)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // 移除所有剩余标签
    .replace(/<[^>]+>/g, ' ')
    // 解码常见 HTML 实体
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // 折叠空白
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** CSV 转 Markdown 表格（前 200 行） */
function csvToMarkdown(csv: string): string {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return '';

  const MAX_ROWS = 200;
  const rows = lines.slice(0, MAX_ROWS).map((l) => l.split(',').map((v) => v.trim().replace(/^"|"$/g, '')));

  const header = rows[0];
  if (!header) return csv;
  const divider = header.map(() => '---');
  const body = rows.slice(1);

  const table = [
    '| ' + header.join(' | ') + ' |',
    '| ' + divider.join(' | ') + ' |',
    ...body.map((r) => '| ' + r.join(' | ') + ' |')
  ].join('\n');

  const truncated = lines.length > MAX_ROWS ? `\n\n*(showing first ${MAX_ROWS} of ${lines.length} rows)*` : '';
  return table + truncated;
}

export const fileParseTool: AgentToolDefinition = {
  name: 'file_parse',
  description:
    '读取并提取本地文档的文本内容。支持：txt/md/json/jsonl/csv/xml/html/htm。' +
    '对 CSV 自动转换为 Markdown 表格，对 HTML/XML 提取纯文本。',
  isConcurrencySafe: true,
  isDestructive: false,
  alwaysLoad: false,
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: '文件绝对路径' },
      maxChars: {
        type: 'number',
        description: '最大返回字符数（默认 50000）',
        default: 50000
      }
    }
  },
  async execute(input) {
    const { path, maxChars = 50_000 } = input as { path: string; maxChars?: number };
    if (!existsSync(path)) return { error: 'not_found', path };
    const st = statSync(path);
    if (!st.isFile()) return { error: 'not_a_file', path };
    if (st.size > 20 * 1024 * 1024) return { error: 'too_large', size: st.size, max: '20MB' };

    const ext = extname(path).toLowerCase();
    const SUPPORTED = ['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.html', '.htm', '.log', '.yaml', '.yml', '.toml', '.ini', '.env'];

    if (!SUPPORTED.includes(ext)) {
      return {
        error: 'unsupported_format',
        ext,
        supported: SUPPORTED.join(', '),
        hint: 'For .docx/.xlsx/.pdf, use the appropriate data-source tool with optional dependency packages.'
      };
    }

    const raw = readFileSync(path, 'utf-8');
    let text: string;
    let format: string;

    switch (ext) {
      case '.html':
      case '.htm':
        text = stripHtml(raw);
        format = 'html→text';
        break;

      case '.xml':
        // Strip XML tags, preserve text content
        text = raw
          .replace(/<\?[^>]+\?>/g, '')        // processing instructions
          .replace(/<!--[\s\S]*?-->/g, '')      // comments
          .replace(/<[^>]+>/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim();
        format = 'xml→text';
        break;

      case '.csv':
        text = csvToMarkdown(raw);
        format = 'csv→markdown-table';
        break;

      case '.tsv': {
        // Convert tabs to commas, then treat as CSV
        const asCsv = raw.replace(/\t/g, ',');
        text = csvToMarkdown(asCsv);
        format = 'tsv→markdown-table';
        break;
      }

      case '.json': {
        // Pretty-print for readability up to 1 MB, otherwise truncate
        try {
          const parsed = JSON.parse(raw);
          text = JSON.stringify(parsed, null, 2);
        } catch {
          text = raw;
        }
        format = 'json';
        break;
      }

      default:
        text = raw;
        format = ext.slice(1) || 'text';
    }

    const truncated = text.length > maxChars;
    return {
      path,
      ext,
      format,
      size: st.size,
      truncated,
      text: truncated ? text.slice(0, maxChars) + '\n\n[...truncated]' : text
    };
  }
};

