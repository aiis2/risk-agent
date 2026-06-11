/**
 * i18n formatters — locale-aware 数字/日期/货币格式化工具
 * settings-center-frontend-mapping.md §11.1
 */

/** 格式化日期 */
export function formatDate(date: string | Date, locale = 'zh-CN'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 格式化日期时间 */
export function formatDateTime(date: string | Date, locale = 'zh-CN'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

/** 格式化货币 */
export function formatCurrency(amount: number, locale = 'zh-CN', currency = 'CNY'): string {
  return amount.toLocaleString(locale, { style: 'currency', currency, maximumFractionDigits: 2 });
}

/** 格式化数字（千位分隔符）*/
export function formatNumber(n: number, locale = 'zh-CN'): string {
  return n.toLocaleString(locale);
}

/** 格式化百分比（i18n-ui-report.md §4.3）*/
export function formatPercent(value: number, locale = 'zh-CN', digits = 1): string {
  return value.toLocaleString(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 格式化相对时间（简易版，不依赖 Intl.RelativeTimeFormat）*/
export function formatRelativeTime(date: string | Date, locale = 'zh-CN'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return locale.startsWith('zh') ? '刚刚' : 'just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return locale.startsWith('zh') ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return locale.startsWith('zh') ? `${diffHour} 小时前` : `${diffHour}h ago`;
  }
  return formatDate(d, locale);
}
