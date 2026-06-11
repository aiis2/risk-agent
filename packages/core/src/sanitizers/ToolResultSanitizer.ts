/**
 * ToolResultSanitizer — 4 阶段消毒管线：
 * 1) JSON/结构检查   2) XML 标签转义   3) spread/递归深度防护   4) 错误 overlay
 *
 * 特殊处理：包含 MCP 图片内容块（browser_take_screenshot 等）的工具结果不受文本截断限制，
 * 以确保图片数据能完整传递给 LLM 视觉能力。
 * 对 browser_snapshot / web_scrape 这类文档结果提升上限，避免长页面内容在进入模型前被过早截断。
 */
export const MAX_SERIALIZED_LENGTH = 30_000;
/** 包含图片内容块时的最大字节数（支持最高约 3MB base64 截图）*/
export const MAX_IMAGE_RESULT_CHARS = 4_000_000;
/** 文档类浏览器结果的更高上限（覆盖长知识库页面的 HTML + text 负载） */
export const MAX_DOCUMENT_RESULT_CHARS = 512_000;
export const MAX_DEPTH = 8;

export interface SanitizeOutcome<T = unknown> {
  value: T;
  truncated: boolean;
  bytes: number;
}

/**
 * 检测工具结果是否包含 MCP 图片内容块。
 * MCP 图片格式：{ content: [{ type: 'image', data: '...', mimeType: '...' }] }
 */
export function containsMcpImageContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsMcpImageContent);
  const obj = value as Record<string, unknown>;
  if (obj['type'] === 'image' && typeof obj['data'] === 'string') return true;
  return Object.values(obj).some(containsMcpImageContent);
}

function containsBrowserDocumentContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsBrowserDocumentContent);

  const obj = value as Record<string, unknown>;
  const html = obj['html'];
  const text = obj['text'];
  const currentUrl = obj['currentUrl'];
  const url = obj['url'];
  const title = obj['title'];
  const extractedChars = obj['extractedChars'];

  const hasHtml = typeof html === 'string' && html.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  const hasKnownUrl =
    (typeof currentUrl === 'string' && currentUrl.length > 0) ||
    (typeof url === 'string' && url.length > 0);
  const hasTitle = typeof title === 'string' && title.length > 0;
  const hasExtractionMetadata = typeof extractedChars === 'number';

  if ((hasHtml && hasKnownUrl) || (hasText && hasKnownUrl && (hasTitle || hasExtractionMetadata || hasHtml))) {
    return true;
  }

  return Object.values(obj).some(containsBrowserDocumentContent);
}

export class ToolResultSanitizer {
  sanitize<T = unknown>(raw: T): SanitizeOutcome<T> {
    const limited = limitDepth(raw, MAX_DEPTH) as T;
    const serialized = serialize(limited);
    const hasImages = containsMcpImageContent(limited);
    const hasBrowserDocumentContent = containsBrowserDocumentContent(limited);
    // 图片内容块与浏览器文档结果使用更高的上限，避免在进入模型前被过早截断。
    const maxLen = hasImages
      ? MAX_IMAGE_RESULT_CHARS
      : hasBrowserDocumentContent
        ? MAX_DOCUMENT_RESULT_CHARS
        : MAX_SERIALIZED_LENGTH;
    let final: unknown = limited;
    let truncated = false;
    if (serialized.length > maxLen) {
      truncated = true;
      final = {
        __truncated: true,
        preview: serialized.slice(0, MAX_SERIALIZED_LENGTH) + '…',
        originalLength: serialized.length
      };
    }
    return { value: final as T, truncated, bytes: serialized.length };
  }

  overlayError(err: unknown): { __tool_error: true; message: string; stack?: string } {
    const e = err instanceof Error ? err : new Error(String(err));
    return { __tool_error: true, message: e.message, stack: e.stack };
  }
}

function limitDepth(value: unknown, depth: number): unknown {
  if (depth <= 0 || value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => limitDepth(v, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // XML/标签转义键名防注入
    const safeKey = k.replace(/[<>&]/g, '_');
    out[safeKey] = limitDepth(v, depth - 1);
  }
  return out;
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
