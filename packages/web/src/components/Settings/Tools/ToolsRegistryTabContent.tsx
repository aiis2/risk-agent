import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCpu,
  IconInfinity,
  IconLayoutGrid,
  IconLoader2,
  IconPlayerStop,
  IconSearch,
  IconShieldCheck,
  IconTool,
} from '@tabler/icons-react';
import { listTools, type ToolSummary } from '../../../api/client';
import { ScrollArea } from '../../ui';

function toolPartitionBadge(tool: ToolSummary) {
  if (tool.name === 'ask_user') return { label: '中断', className: 'bg-danger/15 text-danger' };
  if (tool.isConcurrencySafe && !tool.isDestructive) return { label: '并行', className: 'bg-success/15 text-success' };
  return { label: '串行', className: 'bg-warn/15 text-warn' };
}

function toolAccessTierBadge(tool: ToolSummary) {
  switch (tool.sandboxAccessTier) {
    case 'interactive-write-capable':
      return { label: '需审批写入', className: 'bg-danger/12 text-danger' };
    case 'background':
      return { label: '后台档位', className: 'bg-node-cyan/12 text-node-cyan' };
    case 'interactive-readonly':
      return { label: '交互只读', className: 'bg-success/12 text-success' };
    default:
      return null;
  }
}

function ToolCard({ tool }: { tool: ToolSummary }) {
  const [expanded, setExpanded] = useState(false);
  const partition = toolPartitionBadge(tool);
  const accessTier = toolAccessTierBadge(tool);

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-3 transition-colors hover:border-border">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 text-warn">
          <IconTool size={13} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-text">{tool.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${partition.className}`}>{partition.label}</span>

            {accessTier && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${accessTier.className}`}>{accessTier.label}</span>
            )}

            {tool.isReadOnly && (
              <span className="inline-flex items-center gap-0.5 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                <IconShieldCheck size={9} />只读
              </span>
            )}

            {tool.isDestructive && (
              <span className="inline-flex items-center gap-0.5 rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                <IconAlertTriangle size={9} />破坏性
              </span>
            )}

            {tool.deferred && <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-text-muted">延迟加载</span>}

            {tool.alwaysLoad && (
              <span className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                <IconInfinity size={9} />始终可见
              </span>
            )}

            {tool.isOpenWorld && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">开放世界</span>}
          </div>

          {tool.searchHint && <p className="mt-0.5 text-[10px] italic text-text-muted">"{tool.searchHint}"</p>}

          {(tool.sandboxProfile || tool.sandboxHostKind || tool.sandboxAccessTier) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tool.sandboxHostKind && (
                <span className="inline-flex items-center gap-0.5 rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-accent-hover">
                  <IconCpu size={9} />{tool.sandboxHostKind}
                </span>
              )}
              {tool.sandboxProfile && (
                <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-text-dim">profile {tool.sandboxProfile}</span>
              )}
            </div>
          )}

          <p className="mt-0.5 text-[11px] leading-relaxed text-text-dim">{tool.description}</p>

          {tool.aliases.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tool.aliases.map((alias) => (
                <span key={alias} className="rounded bg-surface-soft px-1 py-0.5 font-mono text-[10px] text-text-muted">
                  {alias}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 shrink-0 text-text-muted transition-colors hover:text-text-dim"
          aria-label={expanded ? '收起' : '展开'}
        >
          {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 border-t border-border-subtle pl-5 pt-2">
          <span className="mb-1 block text-[10px] text-text-muted">Input Schema:</span>
          <pre className="max-h-36 overflow-x-auto rounded bg-surface-soft p-2 font-mono text-[10px] text-accent">
            {JSON.stringify(tool.inputSchema, null, 2)}
          </pre>
          {tool.maxResultSizeChars !== undefined && tool.maxResultSizeChars < Infinity && (
            <div className="mt-1 text-[10px] text-text-muted">最大结果: {tool.maxResultSizeChars.toLocaleString()} chars</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolsRegistryTabContent() {
  const [toolFilter, setToolFilter] = useState<'all' | 'readonly' | 'destructive' | 'deferred'>('all');
  const [toolSearch, setToolSearch] = useState('');
  const tools = useQuery({
    queryKey: ['tools', toolFilter, toolSearch],
    queryFn: () =>
      listTools({
        q: toolSearch || undefined,
        readonly: toolFilter === 'readonly' ? true : undefined,
        destructive: toolFilter === 'destructive' ? true : undefined,
        deferred: toolFilter === 'deferred' ? true : undefined,
      }),
  });

  const currentTools = tools.data?.tools ?? [];
  const cards = useMemo(
    () => [
      {
        label: '当前结果',
        value: String(tools.data?.total ?? 0),
        helper: toolFilter === 'all' ? '当前工具目录中的工具总数。' : '当前筛选条件下命中的工具数量。',
      },
      {
        label: '只读工具',
        value: String(currentTools.filter((tool) => tool.isReadOnly).length),
        helper: '可安全并发执行，适合查询和检索类任务。',
      },
      {
        label: '破坏性工具',
        value: String(currentTools.filter((tool) => tool.isDestructive).length),
        helper: '写操作或高风险动作，执行前应明确确认。',
      },
      {
        label: 'Write Sandbox',
        value: String(currentTools.filter((tool) => tool.sandboxAccessTier === 'interactive-write-capable').length),
        helper: '显式进入 write-capable sandbox 的工具，运行前会经过审批。',
      },
    ],
    [currentTools, toolFilter, tools.data?.total]
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border-subtle bg-surface-card p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-warn/20 bg-warn/10 text-warn">
                <IconLayoutGrid size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text">工具注册表</h3>
                <p className="mt-1 text-xs leading-5 text-text-dim">独立查看内置工具目录、并发分区、危险级别和输入 schema，不再与技能管理混排。</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="inline-flex items-center gap-0.5 rounded-full border border-success/20 bg-success/10 px-2 py-1 text-success">
              <IconShieldCheck size={9} />只读可并行
            </span>
            <span className="inline-flex items-center gap-0.5 rounded-full border border-danger/20 bg-danger/10 px-2 py-1 text-danger">
              <IconAlertTriangle size={9} />破坏性需确认
            </span>
            <span className="inline-flex items-center gap-0.5 rounded-full border border-warn/20 bg-warn/10 px-2 py-1 text-warn">
              <IconPlayerStop size={9} />开放世界副作用
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-border-subtle bg-surface px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-text">{card.value}</p>
              <p className="mt-2 text-[11px] leading-5 text-text-dim">{card.helper}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <IconSearch size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={toolSearch}
              onChange={(event) => setToolSearch(event.target.value)}
              placeholder="搜索工具名称、描述或 searchHint…"
              className="w-full rounded-lg border border-border-subtle bg-surface-sidebar py-2 pl-8 pr-3 text-xs text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['all', '全部'],
              ['readonly', '只读'],
              ['destructive', '破坏性'],
              ['deferred', '延迟'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setToolFilter(value)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
                  toolFilter === value
                    ? 'bg-accent text-white'
                    : 'border border-border-subtle bg-surface-sidebar text-text-dim hover:border-border hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-border-subtle bg-surface px-3 py-3">
          {tools.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <IconLoader2 size={12} className="animate-spin" /> 加载工具注册表…
            </div>
          ) : currentTools.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center text-center text-text-dim">
              <IconTool size={28} className="mb-3 opacity-40" />
              <p className="text-sm font-medium text-text">{toolSearch ? '未找到匹配工具' : '暂无已注册工具'}</p>
              <p className="mt-1 max-w-md text-xs leading-5 text-text-dim">可以尝试清空筛选条件，或在工具目录同步后重新查看。</p>
            </div>
          ) : (
            <ScrollArea className="h-[560px]">
              <div className="space-y-2 pr-2">
                {currentTools.map((tool) => (
                  <ToolCard key={tool.name} tool={tool} />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </section>
    </div>
  );
}