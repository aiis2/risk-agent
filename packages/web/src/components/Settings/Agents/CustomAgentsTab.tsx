/**
 * CustomAgentsTab — v3.3 agent-framework.md §29
 * 展示系统中已发现的自定义代理 (.agent.md) 列表
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconRobot,
  IconRefresh,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconUser,
  IconBuildingSkyscraper,
  IconFolder,
  IconTools,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { listCustomAgents, getCustomAgent } from '../../../api/customAgents';
import type { CustomAgentSummary } from '../../../api/customAgents';

const LAYER_LABELS: Record<CustomAgentSummary['layer'], string> = {
  project: '项目级',
  user: '用户级',
  system: '系统内置',
};

const LAYER_COLORS: Record<CustomAgentSummary['layer'], string> = {
  project: 'text-accent bg-accent/10 border-accent/20',
  user: 'text-warn bg-warn/10 border-warn/20',
  system: 'text-success bg-success/10 border-success/20',
};

function LayerIcon({ layer }: { layer: CustomAgentSummary['layer'] }) {
  switch (layer) {
    case 'project': return <IconFolder size={10} />;
    case 'user': return <IconUser size={10} />;
    case 'system': return <IconBuildingSkyscraper size={10} />;
  }
}

function AgentDetailPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['custom-agent', name],
    queryFn: () => getCustomAgent(name),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-surface-sidebar border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <IconRobot size={16} className="text-accent" />
            <span className="text-sm font-semibold text-text">@{name}</span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors text-xs px-2 py-1 rounded"
          >
            关闭
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-text-muted text-sm">加载中...</span>
          </div>
        ) : data ? (
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            {data.description && (
              <p className="text-sm text-text-dim">{data.description}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {data.model && (
                <div className="bg-surface-card rounded-lg p-3 border border-border-subtle">
                  <p className="text-[10px] text-text-muted mb-1">模型</p>
                  <p className="text-xs text-text font-mono">{data.model}</p>
                </div>
              )}
              {data.temperature != null && (
                <div className="bg-surface-card rounded-lg p-3 border border-border-subtle">
                  <p className="text-[10px] text-text-muted mb-1">Temperature</p>
                  <p className="text-xs text-text font-mono">{data.temperature}</p>
                </div>
              )}
            </div>
            {data.tools && data.tools.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <IconTools size={11} className="text-text-muted" />
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">允许工具</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.tools.map((t) => (
                    <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-soft border border-border/60 text-text-dim">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <IconCode size={11} className="text-text-muted" />
                <p className="text-[10px] text-text-muted uppercase tracking-wide">System Prompt</p>
              </div>
              <pre className="text-[11px] font-mono text-text-dim bg-surface border border-border-subtle rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {data.systemPrompt}
              </pre>
            </div>
            <div>
              <p className="text-[10px] text-text-muted font-mono truncate">
                来源: {data.sourcePath}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-40">
            <span className="text-danger text-sm">加载失败</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: CustomAgentSummary }) {
  const [open, setOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div className="bg-surface-card border border-border-subtle rounded-xl overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-soft/40 transition-colors"
        >
          {open ? (
            <IconChevronDown size={12} className="text-text-muted shrink-0" />
          ) : (
            <IconChevronRight size={12} className="text-text-muted shrink-0" />
          )}
          <IconRobot size={14} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">@{agent.name}</span>
              <span className={clsx(
                'inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded border',
                LAYER_COLORS[agent.layer]
              )}>
                <LayerIcon layer={agent.layer} />
                {LAYER_LABELS[agent.layer]}
              </span>
              {agent.model && (
                <span className="text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border/60">
                  {agent.model}
                </span>
              )}
            </div>
            {agent.description && (
              <p className="text-xs text-text-muted mt-0.5 truncate">{agent.description}</p>
            )}
          </div>
        </button>

        {open && (
          <div className="px-4 pb-4 border-t border-border-subtle/50 pt-3 space-y-3">
            {agent.tools && agent.tools.length > 0 && (
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <IconTools size={10} className="text-text-muted" />
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">工具</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((t) => (
                    <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-soft border border-border/60 text-text-dim">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDetail(true)}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors px-3 py-1.5 bg-accent/10 hover:bg-accent/20 rounded-lg border border-accent/20"
              >
                <IconCode size={11} />
                查看 System Prompt
              </button>
              <span className="text-[10px] text-text-muted font-mono truncate flex-1">
                {agent.sourcePath}
              </span>
            </div>
          </div>
        )}
      </div>

      {showDetail && (
        <AgentDetailPanel name={agent.name} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}

export function CustomAgentsTab() {
  const { data: agents, isLoading, refetch } = useQuery({
    queryKey: ['custom-agents'],
    queryFn: listCustomAgents,
  });

  const grouped = agents?.reduce<Record<string, CustomAgentSummary[]>>((acc, a) => {
    const k = a.layer;
    (acc[k] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text flex items-center gap-2">
            <IconRobot size={16} className="text-accent" />
            自定义代理
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            通过 .agent.md 文件定义，支持 @name 语法调用（agent-framework.md §29）
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-dim hover:text-text bg-surface-card hover:bg-surface-soft border border-border rounded-lg transition-colors"
        >
          <IconRefresh size={11} className={isLoading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* Discovery paths info */}
      <div className="bg-surface-card border border-border-subtle rounded-xl p-4">
        <p className="text-xs text-text-muted font-medium mb-2">代理发现路径（优先级由高到低）</p>
        <div className="space-y-1">
          {[
            { layer: 'project', path: '<project>/.agents/*.agent.md' },
            { layer: 'user', path: '~/.risk-agent/agents/*.agent.md' },
            { layer: 'system', path: '<dataDir>/agents/*.agent.md' },
          ].map(({ layer, path }) => (
            <div key={layer} className="flex items-center gap-2">
              <span className={clsx(
                'inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border font-mono w-16 justify-center',
                LAYER_COLORS[layer as CustomAgentSummary['layer']]
              )}>
                {LAYER_LABELS[layer as CustomAgentSummary['layer']]}
              </span>
              <span className="text-[11px] font-mono text-text-muted">{path}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Agent list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-24">
          <span className="text-text-muted text-sm">加载中...</span>
        </div>
      ) : !agents?.length ? (
        <div className="text-center py-12 bg-surface-card border border-border-subtle rounded-xl">
          <IconRobot size={32} className="text-border mx-auto mb-3" />
          <p className="text-sm text-text-muted">未发现自定义代理</p>
          <p className="text-xs text-text-muted mt-1">
            在项目根目录 .agents/ 下创建 .agent.md 文件即可
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(['project', 'user', 'system'] as const).map((layer) => {
            const items = grouped?.[layer];
            if (!items?.length) return null;
            return (
              <div key={layer}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={clsx(
                    'inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border font-mono',
                    LAYER_COLORS[layer]
                  )}>
                    <LayerIcon layer={layer} />
                    {LAYER_LABELS[layer]}
                  </span>
                  <span className="text-[10px] text-text-muted">{items.length} 个代理</span>
                </div>
                <div className="space-y-2">
                  {items.map((agent) => (
                    <AgentRow key={agent.name} agent={agent} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
