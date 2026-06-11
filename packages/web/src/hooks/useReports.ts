/**
 * useReports — 报告列表 Hook（封装 TanStack Query）
 * project-structure.md §hooks/useReports.ts
 */
import { useQuery } from '@tanstack/react-query';
import { getReport, listReports } from '../api/client';
import type { ReportSummary } from '../api/client';

/** 报告列表（带可选的业务名过滤） */
export function useReports(filterName?: string) {
  const query = useQuery<ReportSummary[]>({
    queryKey: ['reports'],
    queryFn: listReports,
  });

  const filtered = filterName
    ? (query.data ?? []).filter((r) =>
        r.businessName.toLowerCase().includes(filterName.toLowerCase()),
      )
    : query.data ?? [];

  return { ...query, filtered };
}

/** 单份报告详情（带 locale 支持） */
export function useReportDetail(reportId: string | undefined, locale = 'zh-CN') {
  return useQuery({
    queryKey: ['report', reportId, locale],
    queryFn: () => getReport(reportId!, locale),
    enabled: !!reportId,
  });
}
