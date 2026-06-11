/**
 * ActiveStorageCard — 当前激活存储配置卡片
 * settings-center-frontend-mapping.md §5.2
 */
import { useQuery } from '@tanstack/react-query';
import {
  IconDatabase,
  IconRefresh,
  IconAlertTriangle,
  IconCircleCheck,
  IconLoader2,
  IconServerBolt,
  IconClockCheck,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { storageSettingsApi, type ActiveStorageState } from '../../../api/storageSettings';
import { Tooltip, TooltipProvider } from '../../ui';

// ─── 状态颜色映射 ──────────────────────────────────────────────────────────

function statusColor(status: ActiveStorageState['status']) {
  switch (status) {
    case 'ready':        return 'text-success border-success/20 bg-success/10';
    case 'applying':
    case 'validating':   return 'text-warn border-warn/20 bg-warn/10';
    case 'migrating':    return 'text-accent border-accent/20 bg-accent/10';
    case 'rolling-back': return 'text-warn border-warn/20 bg-warn/10';
    case 'error':        return 'text-danger border-danger/20 bg-danger/10';
    default:             return 'text-text-dim border-border bg-surface-soft';
  }
}

function StatusIcon({ status }: { status: ActiveStorageState['status'] }) {
  switch (status) {
    case 'ready':        return <IconCircleCheck size={13} className="text-success" />;
    case 'applying':
    case 'validating':
    case 'migrating':    return <IconLoader2 size={13} className="animate-spin text-warn" />;
    case 'error':        return <IconAlertTriangle size={13} className="text-danger" />;
    default:             return <IconServerBolt size={13} className="text-text-dim" />;
  }
}

// ─── 后端信息小标签 ────────────────────────────────────────────────────────

function BackendBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-text-muted uppercase tracking-wide">{label}</span>
      <span className="text-xs text-text font-mono bg-surface px-2 py-0.5 rounded border border-border-subtle">{value}</span>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export function ActiveStorageCard() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['storage-current'],
    queryFn: storageSettingsApi.getCurrent,
    refetchInterval: 30_000,
  });

  return (
    <div className="bg-surface-card border border-border-subtle rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconDatabase size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-text">当前激活配置</h3>
        </div>
        <TooltipProvider>
          <Tooltip content="刷新状态" side="left">
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="p-1.5 rounded-lg hover:bg-surface-soft text-text-muted hover:text-text-dim transition-colors disabled:opacity-40"
              aria-label="刷新存储状态"
            >
              <IconRefresh size={13} className={clsx(isFetching && 'animate-spin')} />
            </button>
          </Tooltip>
        </TooltipProvider>
      </div>

      {isLoading ? (
        /* Skeleton */
        <div className="space-y-4 animate-pulse" aria-label="加载存储状态…">
          <div className="flex items-center gap-3">
            <div className="h-5 w-24 rounded-md bg-border-subtle" />
            <div className="h-5 w-20 rounded-full bg-border-subtle" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0,1,2,3].map((i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-16 rounded bg-border-subtle" />
                <div className="h-6 w-full rounded-md bg-border-subtle" />
              </div>
            ))}
          </div>
          <div className="h-3 w-48 rounded bg-border-subtle" />
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Profile + Status */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-text capitalize">{data.activeProfile}</span>
            <span className={clsx('flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium', statusColor(data.status))}>
              <StatusIcon status={data.status} />
              {data.status}
            </span>
            {data.restartRequired && (
              <span className="flex items-center gap-1 text-[10px] text-warn bg-warn/10 border border-warn/20 px-2 py-0.5 rounded-full">
                <IconAlertTriangle size={10} />
                需重启生效
              </span>
            )}
          </div>

          {/* Backend info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <BackendBadge label="Structured" value={data.backendInfo.structured} />
            <BackendBadge label="Vector"     value={data.backendInfo.vector} />
            <BackendBadge label="Graph"      value={data.backendInfo.graph} />
            <BackendBadge label="Object"     value={data.backendInfo.object} />
          </div>

          {/* Revision ID + lastValidatedAt */}
          <div className="flex items-center gap-4 text-[10px] text-text-muted flex-wrap">
            <span>
              Revision: <span className="font-mono">{data.activeRevisionId}</span>
            </span>
            {data.lastValidatedAt && (
              <span className="flex items-center gap-1 text-[10px] text-text-muted">
                <IconClockCheck size={10} className="text-success/60" />
                最近验证：{new Date(data.lastValidatedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted">无法获取存储状态</p>
      )}
    </div>
  );
}
