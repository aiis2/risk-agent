/**
 * formatters.spec.ts
 * i18n-ui-report.md §7.1 — locale-aware formatter 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '../formatters.js';

// ─── formatDate ─────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats a date string for zh-CN', () => {
    const result = formatDate('2026-04-14', 'zh-CN');
    expect(result).toContain('2026');
    expect(result).toContain('4');
    expect(result).toContain('14');
  });

  it('formats a date string for en-US', () => {
    const result = formatDate('2026-04-14', 'en-US');
    expect(result).toContain('2026');
    expect(result).toMatch(/April|4/);
  });

  it('returns the original string for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('accepts a Date object', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const result = formatDate(d, 'en-US');
    expect(result).toContain('2026');
  });
});

// ─── formatDateTime ──────────────────────────────────────────────────────────

describe('formatDateTime', () => {
  it('formats a datetime string for zh-CN', () => {
    const result = formatDateTime('2026-04-14T08:30:00Z', 'zh-CN');
    expect(result).toContain('2026');
  });

  it('formats a datetime string for en-US', () => {
    const result = formatDateTime('2026-04-14T08:30:00Z', 'en-US');
    expect(result).toContain('2026');
  });

  it('returns original string for invalid input', () => {
    expect(formatDateTime('invalid')).toBe('invalid');
  });
});

// ─── formatCurrency ──────────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats CNY amount for zh-CN', () => {
    const result = formatCurrency(1234.5, 'zh-CN', 'CNY');
    expect(result).toContain('1,234');
  });

  it('formats USD amount for en-US', () => {
    const result = formatCurrency(1234.5, 'en-US', 'USD');
    expect(result).toContain('1,234');
    expect(result).toContain('$');
  });

  it('handles zero', () => {
    const result = formatCurrency(0, 'zh-CN', 'CNY');
    expect(result).toBeDefined();
  });
});

// ─── formatNumber ────────────────────────────────────────────────────────────

describe('formatNumber', () => {
  it('formats large number with separator for zh-CN', () => {
    const result = formatNumber(1234567, 'zh-CN');
    expect(result).toContain('1,234,567');
  });

  it('formats large number with separator for en-US', () => {
    const result = formatNumber(1234567, 'en-US');
    expect(result).toContain('1,234,567');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

// ─── formatPercent ───────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('formats 0.75 as 75.0% for zh-CN', () => {
    const result = formatPercent(0.75, 'zh-CN', 1);
    expect(result).toContain('75');
    expect(result).toContain('%');
  });

  it('formats 0.75 as 75.0% for en-US', () => {
    const result = formatPercent(0.75, 'en-US', 1);
    expect(result).toContain('75');
    expect(result).toContain('%');
  });

  it('formats 1.0 as 100%', () => {
    const result = formatPercent(1.0, 'en-US', 0);
    expect(result).toContain('100');
  });

  it('formats 0.0 as 0%', () => {
    const result = formatPercent(0, 'en-US', 0);
    expect(result).toContain('0');
    expect(result).toContain('%');
  });

  it('respects digits parameter', () => {
    const result0 = formatPercent(0.7777, 'en-US', 0);
    const result2 = formatPercent(0.7777, 'en-US', 2);
    expect(result0).not.toContain('.');
    expect(result2).toContain('.');
  });
});

// ─── formatRelativeTime ──────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  it('returns just now for recent dates in zh-CN', () => {
    const recent = new Date(Date.now() - 10_000); // 10 seconds ago
    expect(formatRelativeTime(recent, 'zh-CN')).toBe('刚刚');
  });

  it('returns just now for recent dates in en-US', () => {
    const recent = new Date(Date.now() - 10_000);
    expect(formatRelativeTime(recent, 'en-US')).toBe('just now');
  });

  it('returns minutes ago for 2-minute-old date in zh-CN', () => {
    const past = new Date(Date.now() - 2 * 60_000);
    expect(formatRelativeTime(past, 'zh-CN')).toContain('分钟前');
  });

  it('returns hours ago for 2-hour-old date in zh-CN', () => {
    const past = new Date(Date.now() - 2 * 60 * 60_000);
    expect(formatRelativeTime(past, 'zh-CN')).toContain('小时前');
  });

  it('returns formatted date for old dates', () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const result = formatRelativeTime(old, 'zh-CN');
    expect(result).toContain('2020');
  });

  it('returns original string for invalid date', () => {
    expect(formatRelativeTime('not-a-date')).toBe('not-a-date');
  });
});
