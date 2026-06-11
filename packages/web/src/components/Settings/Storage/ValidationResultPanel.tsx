/**
 * ValidationResultPanel — 校验结果展示
 * settings-center-frontend-mapping.md §5.6
 */
import { IconCircleCheck, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { ValidateStorageConfigResponse } from '../../../api/storageSettings';

type HealthStatus = 'ok' | 'error';

function HealthRow({ scope, status }: { scope: string; status: HealthStatus }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-text-dim capitalize">{scope}</span>
      {status === 'ok' ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <IconCircleCheck size={12} />
          OK
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-danger">
          <IconAlertTriangle size={12} />
          Error
        </span>
      )}
    </div>
  );
}

interface Props {
  result: ValidateStorageConfigResponse | null;
}

export function ValidationResultPanel({ result }: Props) {
  if (!result) {
    return (
      <div className="flex flex-col gap-1.5 bg-surface border border-dashed border-border-subtle rounded-lg p-4 text-center">
        <IconInfoCircle size={18} className="text-border mx-auto" />
        <p className="text-xs text-text-muted">点击「校验」查看各存储后端健康状态</p>
      </div>
    );
  }

  const scopes = ['structured', 'vector', 'graph', 'object'] as const;
  const allOk = scopes.every((s) => result.health[s] === 'ok');

  return (
    <div className={clsx(
      'bg-surface-card border rounded-lg p-4 space-y-3',
      allOk ? 'border-success/20' : 'border-danger/20'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text">校验结果</span>
        {result.applyReady ? (
          <span className="text-xs text-success bg-success/10 border border-success/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <IconCircleCheck size={11} />
            可应用
          </span>
        ) : (
          <span className="text-xs text-danger bg-danger/10 border border-danger/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <IconAlertTriangle size={11} />
            不可应用
          </span>
        )}
      </div>

      {/* 后端 info */}
      <div className="grid grid-cols-2 gap-1.5">
        {scopes.map((scope) => (
          <HealthRow key={scope} scope={scope} status={result.health[scope] ?? 'error'} />
        ))}
      </div>

      {/* 警告 */}
      {result.warnings.length > 0 && (
        <div className="pt-2 border-t border-border-subtle space-y-1">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-warn">
              <IconAlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Profile */}
      <div className="text-[10px] text-text-muted">Profile: {result.normalizedProfile}</div>
    </div>
  );
}
