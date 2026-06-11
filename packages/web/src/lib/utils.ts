/**
 * lib/utils.ts — 通用工具函数
 * project-structure.md §lib/utils.ts
 */
import { clsx, type ClassValue } from 'clsx';

/** 合并 Tailwind CSS 类名，使用 clsx */
export function cn(...inputs: ClassValue[]) {
  return clsx(...inputs);
}

/** 将数字格式化为带单位的缩写（如 1200 → "1.2K"） */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 将 ISO 时间字符串格式化为本地显示（如 "2026-04-20 10:30"） */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** 将 USD 数字格式化为美元字符串（如 0.00123 → "$0.00123"） */
export function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

/** 截断字符串超过 maxLen 部分，添加省略号 */
export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '\u2026' : str;
}

/** 从 coverage percent 值决定颜色类名（>=80 绿，>=50 黄，<50 红） */
export function coverageColor(pct: number): string {
  if (pct >= 80) return 'text-success';
  if (pct >= 50) return 'text-warn';
  return 'text-danger';
}

/** 风险等级 → 颜色方案 */
export function riskLevelColor(level: string): string {
  switch (level) {
    case 'critical': return 'text-danger bg-danger/10 border-danger/25';
    case 'high':     return 'text-warn bg-warn/10 border-warn/25';
    case 'medium':   return 'text-accent bg-accent/10 border-accent/25';
    case 'low':      return 'text-success bg-success/10 border-success/25';
    default:         return 'text-text-dim bg-border/20 border-border/30';
  }
}
