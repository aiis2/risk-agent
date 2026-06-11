/**
 * TranscriptSearch — 对话记录全文检索组件
 * （system-architecture.md v3.3 §6.3 Transcript 搜索索引 · FTS5）
 */
import { useState } from 'react';
import {
  IconSearch,
  IconLoader2,
  IconMessage,
  IconUser,
  IconRobot,
  IconTool,
  IconAlertCircle,
  IconClockHour4,
} from '@tabler/icons-react';
import { searchTranscript, type TranscriptSearchResult } from '../../../api/client';

// ─── helpers ─────────────────────────────────────────────────────────────────

function roleLabel(role: string): { label: string; className: string } {
  switch (role) {
    case 'user':      return { label: '用户', className: 'text-accent' };
    case 'assistant': return { label: 'AI', className: 'text-success' };
    case 'tool':      return { label: '工具', className: 'text-warn' };
    default:          return { label: '系统', className: 'text-text-dim' };
  }
}

function RoleIcon({ role }: { role: string }) {
  const size = 12;
  switch (role) {
    case 'user':      return <IconUser size={size} className="text-accent" />;
    case 'assistant': return <IconRobot size={size} className="text-success" />;
    case 'tool':      return <IconTool size={size} className="text-warn" />;
    default:          return <IconMessage size={size} className="text-text-dim" />;
  }
}

/** Render the FTS5 snippet – replace <mark> tags with styled spans */
function Snippet({ html }: { html: string }) {
  // Simple split: we can't use dangerouslySetInnerHTML because of XSS risk.
  // Instead, parse the mark tags manually.
  const parts = html.split(/(<mark>|<\/mark>)/);
  let inMark = false;
  return (
    <span className="text-xs text-text-dim leading-relaxed">
      {parts.map((part, i) => {
        if (part === '<mark>') { inMark = true; return null; }
        if (part === '</mark>') { inMark = false; return null; }
        return inMark ? (
          <mark key={i} className="bg-accent/20 text-accent rounded px-0.5 not-italic">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </span>
  );
}

// ─── Result card ─────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: TranscriptSearchResult }) {
  const { label, className } = roleLabel(result.role);
  const date = new Date(result.createdAt).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className="bg-surface border border-border-subtle rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <RoleIcon role={result.role} />
        <span className={`text-xs font-medium ${className}`}>{label}</span>
        {result.subtype && (
          <span className="text-xs text-text-muted bg-surface-soft px-1.5 py-0.5 rounded">
            {result.subtype}
          </span>
        )}
        <span className="ml-auto text-xs text-text-muted flex items-center gap-1">
          <IconClockHour4 size={10} />
          {date}
        </span>
      </div>
      <Snippet html={result.snippet} />
      <div className="text-xs text-text-muted font-mono">
        会话 {result.sessionId.slice(0, 16)}…
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TranscriptSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TranscriptSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setLastQuery(q);
    try {
      const res = await searchTranscript(q, { limit: 30 });
      setResults(res.results);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? '搜索失败');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search box */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <IconSearch
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索历史对话内容…支持 FTS5 关键词"
            className="w-full bg-surface border border-border-subtle rounded-lg pl-9 pr-4 py-2 text-sm text-text placeholder-text-muted outline-none focus:border-accent transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <IconLoader2 size={14} className="animate-spin" /> : '搜索'}
        </button>
      </form>

      {/* Hint */}
      <p className="text-xs text-text-muted">
        使用 SQLite FTS5 全文检索，支持短语搜索（加引号）和前缀搜索（加 * 号）。
      </p>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-danger">
          <IconAlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Results */}
      {results !== null && !loading && (
        <>
          <div className="text-xs text-text-muted">
            找到 <span className="text-text font-medium">{results.length}</span> 条匹配结果
            {lastQuery && <> — 关键词：<span className="text-accent">"{lastQuery}"</span></>}
          </div>

          {results.length === 0 ? (
            <div className="text-sm text-text-muted text-center py-8">
              未找到相关对话记录
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((r) => (
                <ResultCard key={r.convId} result={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
