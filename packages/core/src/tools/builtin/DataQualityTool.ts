/**
 * DataQualityTool — 数据质量检测工具（参考 08-tools-skills.md §8）
 *
 * 支持 7 类质量检测：
 *   NULL_RATE_HIGH   — 关键列 null 率 > 50%
 *   MIXED_TYPE       — 同列出现多种数据类型
 *   DATE_FORMAT_MIXED — 日期格式混用
 *   ENUM_ANOMALY     — 枚举列出现训练集外值
 *   EMPTY_COLUMN     — 整列为空
 *   DUPLICATE_ROWS   — 主键重复
 *   NUMERIC_OUTLIER  — 数值超出 5σ 范围
 */

import type { AgentToolDefinition } from '../registry/ToolRegistry.js';

export type QualityIssueCode =
  | 'NULL_RATE_HIGH'
  | 'MIXED_TYPE'
  | 'DATE_FORMAT_MIXED'
  | 'ENUM_ANOMALY'
  | 'EMPTY_COLUMN'
  | 'DUPLICATE_ROWS'
  | 'NUMERIC_OUTLIER';

export interface QualityIssue {
  code: QualityIssueCode;
  column: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  detail?: Record<string, unknown>;
}

export interface QualityReport {
  passed: boolean;
  issues: QualityIssue[];
  stats: {
    totalRows: number;
    totalColumns: number;
    checkedColumns: number;
  };
}

/** 常见日期格式正则 */
const DATE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ISO', re: /^\d{4}-\d{2}-\d{2}/ },
  { name: 'CN', re: /^\d{4}年\d{1,2}月\d{1,2}日/ },
  { name: 'SLASH', re: /^\d{2}\/\d{2}\/\d{4}/ },
  { name: 'DOT', re: /^\d{2}\.\d{2}\.\d{4}/ },
  { name: 'COMPACT', re: /^\d{8}$/ },
];

function detectDateFormat(val: string): string | null {
  for (const { name, re } of DATE_PATTERNS) {
    if (re.test(val)) return name;
  }
  return null;
}

function getType(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'string') {
    if (detectDateFormat(val)) return 'date';
    return 'string';
  }
  return 'object';
}

/**
 * checkDataQuality — 对传入的行数据数组执行数据质量检测。
 *
 * @param rows      数据行列表（Record<string, unknown>[]）
 * @param primaryKey 用于重复行检测的主键字段名（可选）
 * @param enumHints  枚举约束提示 { column: allowedValues[] }（可选）
 * @returns QualityReport
 */
export function checkDataQuality(
  rows: Array<Record<string, unknown>>,
  primaryKey?: string,
  enumHints?: Record<string, string[]>
): QualityReport {
  const issues: QualityIssue[] = [];

  if (!rows.length) {
    return {
      passed: true,
      issues: [],
      stats: { totalRows: 0, totalColumns: 0, checkedColumns: 0 }
    };
  }

  // 收集所有列名
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) columnSet.add(k);
  }
  const columns = Array.from(columnSet);
  const totalRows = rows.length;

  for (const col of columns) {
    const values = rows.map((r) => r[col]);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined && v !== '');
    const nullCount = totalRows - nonNullValues.length;
    const nullRate = nullCount / totalRows;

    // EMPTY_COLUMN
    if (nonNullValues.length === 0) {
      issues.push({
        code: 'EMPTY_COLUMN',
        column: col,
        severity: 'warning',
        message: `列 "${col}" 整列为空`,
        detail: { nullCount, totalRows }
      });
      continue;
    }

    // NULL_RATE_HIGH
    if (nullRate > 0.5) {
      issues.push({
        code: 'NULL_RATE_HIGH',
        column: col,
        severity: 'warning',
        message: `列 "${col}" null 率为 ${(nullRate * 100).toFixed(1)}%，超过 50% 阈值`,
        detail: { nullCount, totalRows, nullRate: Math.round(nullRate * 100) / 100 }
      });
    }

    // MIXED_TYPE
    const typeSet = new Set(nonNullValues.map(getType));
    typeSet.delete('null');
    if (typeSet.size > 1) {
      issues.push({
        code: 'MIXED_TYPE',
        column: col,
        severity: 'error',
        message: `列 "${col}" 含混合数据类型: ${Array.from(typeSet).join(', ')}`,
        detail: { types: Array.from(typeSet) }
      });
    }

    // DATE_FORMAT_MIXED
    const stringValues = nonNullValues.filter((v) => typeof v === 'string') as string[];
    if (stringValues.length > 0) {
      const dateFormats = new Set(
        stringValues.map(detectDateFormat).filter((f): f is string => f !== null)
      );
      if (dateFormats.size > 1) {
        issues.push({
          code: 'DATE_FORMAT_MIXED',
          column: col,
          severity: 'warning',
          message: `列 "${col}" 日期格式混用: ${Array.from(dateFormats).join(', ')}`,
          detail: { formats: Array.from(dateFormats) }
        });
      }
    }

    // ENUM_ANOMALY
    if (enumHints?.[col]) {
      const allowed = new Set(enumHints[col]);
      const anomalies = nonNullValues.filter((v) => !allowed.has(String(v)));
      if (anomalies.length > 0) {
        issues.push({
          code: 'ENUM_ANOMALY',
          column: col,
          severity: 'error',
          message: `列 "${col}" 出现枚举外值（共 ${anomalies.length} 行）`,
          detail: { examples: anomalies.slice(0, 5).map(String), allowedValues: Array.from(allowed) }
        });
      }
    }

    // NUMERIC_OUTLIER (5σ rule)
    const numericValues = nonNullValues.filter((v) => typeof v === 'number') as number[];
    if (numericValues.length >= 10) {
      const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      const variance =
        numericValues.reduce((a, b) => a + (b - mean) ** 2, 0) / numericValues.length;
      const std = Math.sqrt(variance);
      if (std > 0) {
        const outliers = numericValues.filter((v) => Math.abs(v - mean) > 5 * std);
        if (outliers.length > 0) {
          issues.push({
            code: 'NUMERIC_OUTLIER',
            column: col,
            severity: 'warning',
            message: `列 "${col}" 有 ${outliers.length} 个数值超出 5σ 范围（均值=${mean.toFixed(2)}, σ=${std.toFixed(2)}）`,
            detail: { mean, std, outlierCount: outliers.length, examples: outliers.slice(0, 3) }
          });
        }
      }
    }
  }

  // DUPLICATE_ROWS
  if (primaryKey) {
    const seen = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const key = String(rows[i][primaryKey] ?? '');
      if (seen.has(key)) {
        const firstIdx = seen.get(key)!;
        issues.push({
          code: 'DUPLICATE_ROWS',
          column: primaryKey,
          severity: 'error',
          message: `主键 "${primaryKey}" 重复值: "${key}"（首次出现行 ${firstIdx + 1}，重复行 ${i + 1}）`,
          detail: { key, firstRow: firstIdx + 1, duplicateRow: i + 1 }
        });
        // 每个重复键只报告一次（避免刷屏）
        seen.delete(key);
      } else {
        seen.set(key, i);
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;

  return {
    passed: errorCount === 0,
    issues,
    stats: {
      totalRows,
      totalColumns: columns.length,
      checkedColumns: columns.length
    }
  };
}

/**
 * createDataQualityTool — 工厂函数，返回 AgentToolDefinition。
 */
export function createDataQualityTool(): AgentToolDefinition {
  return {
    name: 'check_data_quality',
    description:
      '数据质量检测工具，对传入的数据行执行 7 类质量检查（空值率、混合类型、日期格式、枚举异常、全空列、重复行、数值异常），返回 QualityReport。',
    isConcurrencySafe: true,
    isDestructive: false,
    isReadOnly: true,
    alwaysLoad: true,
    inputSchema: {
      type: 'object',
      required: ['rows'],
      properties: {
        rows: {
          type: 'array',
          description: '数据行列表，每行为 Record<string, unknown>',
          items: { type: 'object' }
        },
        primaryKey: {
          type: 'string',
          description: '主键字段名，用于重复行检测（可选）'
        },
        enumHints: {
          type: 'object',
          description: '枚举约束提示，格式：{ "列名": ["允许值1", "允许值2"] }（可选）',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    },
    execute(input: unknown): Promise<QualityReport> {
      const { rows, primaryKey, enumHints } = input as {
        rows: Array<Record<string, unknown>>;
        primaryKey?: string;
        enumHints?: Record<string, string[]>;
      };
      if (!Array.isArray(rows)) {
        return Promise.reject(new Error('rows 必须是数组'));
      }
      return Promise.resolve(checkDataQuality(rows, primaryKey, enumHints));
    }
  };
}
