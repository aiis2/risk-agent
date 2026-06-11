import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  IconX,
  IconExternalLink,
  IconArrowUpRight,
  IconArrowDownRight,
  IconChartBar,
  IconShield,
  IconBuildingStore,
  IconFile,
  IconAlertTriangle,
  IconReportAnalytics,
  IconAlertOctagon,
  IconRadar,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import { ScrollArea } from '../ui/ScrollArea';
import { Separator } from '../ui/Separator';
import { useKGConflictsForNode, useKGImpactDetail } from '../../hooks/useKnowledgeGraph';
import type { KGNode, KGEdge, KGNodeType } from '../../api/client';

const NODE_TYPE_BG: Record<string, string> = {
  rule:         'bg-accent/20 text-accent',
  rule_source:  'bg-node-purple/20 text-accent',
  rule_system:  'bg-node-lavender/20 text-node-lavender',
  scenario:     'bg-success/20 text-success',
  business:     'bg-warn/20 text-warn',
  profile:      'bg-warn/20 text-warn',
  dimension:    'bg-node-cyan/20 text-node-cyan',
  gap:          'bg-danger/20 text-danger',
  report:       'bg-node-mint/20 text-node-mint',
  document:     'bg-text-dim/20 text-text-dim',
};

function nodeIcon(type: KGNodeType) {
  const cls = 'flex-shrink-0';
  switch (type) {
    case 'rule':
    case 'rule_source':
    case 'rule_system':   return <IconShield size={14} className={cls} />;
    case 'business':
    case 'profile':       return <IconBuildingStore size={14} className={cls} />;
    case 'scenario':      return <IconChartBar size={14} className={cls} />;
    case 'gap':           return <IconAlertTriangle size={14} className={cls} />;
    case 'report':        return <IconReportAnalytics size={14} className={cls} />;
    default:              return <IconFile size={14} className={cls} />;
  }
}

function deepLinkPath(node: KGNode): string | null {
  switch (node.nodeType) {
    case 'rule': return `/rules?highlight=${node.id}`;
    case 'scenario': return `/scenarios/${node.id}`;
    case 'report': return `/reports/${node.id}`;
    case 'business': return `/profiles?highlight=${node.id}`;
    default: return null;
  }
}

interface Props {
  node: KGNode;
  neighborhood?: { nodes: KGNode[]; edges: KGEdge[] };
  onClose: () => void;
  onSelectNode: (node: KGNode) => void;
  onViewChain: (nodeId: string) => void;
  onViewImpact: (nodeId: string) => void;
}

export function NodeDetailPanel({ node, neighborhood, onClose, onSelectNode, onViewChain, onViewImpact }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: nodeConflicts } = useKGConflictsForNode(node.id);
  const { data: impactDetail } = useKGImpactDetail(node.id);

  const upstream = neighborhood?.edges
    .filter((e) => e.target === node.id)
    .map((e) => ({ edge: e, node: neighborhood.nodes.find((n) => n.id === e.source) }))
    .filter((x) => x.node) ?? [];

  const downstream = neighborhood?.edges
    .filter((e) => e.source === node.id)
    .map((e) => ({ edge: e, node: neighborhood.nodes.find((n) => n.id === e.target) }))
    .filter((x) => x.node) ?? [];

  const link = deepLinkPath(node);

  return (
    <div className="flex flex-col h-full border-l border-border bg-surface-sidebar">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-3 border-b border-border">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={clsx('flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', NODE_TYPE_BG[node.nodeType] ?? 'bg-surface-soft text-text-dim')}>
              {nodeIcon(node.nodeType)}
              {t(`kg.nodeType.${node.nodeType}` as any)}
            </span>
          </div>
          <p className="font-semibold text-text text-sm leading-snug truncate">{node.label}</p>
          <p className="text-text-muted text-xs mt-0.5 font-mono truncate">
            {t('kg.detail.nodeId', { defaultValue: '节点 ID' })} · {node.id}
          </p>
        </div>
        <button type="button" onClick={onClose} title={t('common.close')} className="text-text-muted hover:text-text p-0.5 flex-shrink-0 mt-0.5">
          <IconX size={16} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onViewChain(node.id)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-surface-card text-text-dim hover:border-accent hover:text-accent"
            >
              {t('kg.detail.viewChain')}
            </button>
            <button
              type="button"
              onClick={() => onViewImpact(node.id)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-surface-card text-text-dim hover:border-warn hover:text-warn"
            >
              {t('kg.detail.viewImpact')}
            </button>
            {link && (
              <button
                type="button"
                onClick={() => navigate(link)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-surface-card text-text-dim hover:border-success hover:text-success"
              >
                <IconExternalLink size={12} />
                {t('kg.detail.goToPage')}
              </button>
            )}
          </div>

          {/* 属性 */}
          {node.attributes && Object.keys(node.attributes).length > 0 && (
            <>
              <Separator className="bg-border" />
              <div>
                <p className="text-xs font-semibold text-text mb-1.5">{t('kg.detail.attributes')}</p>
                <div className="space-y-1">
                  {Object.entries(node.attributes).map(([k, v]) => (
                    k !== 'nodeType' && (
                      <div key={k} className="flex justify-between gap-2 text-xs">
                        <span className="text-text-muted flex-shrink-0">{k}</span>
                        <span className="text-text-dim text-right truncate">{String(v)}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 上游关系 */}
          {upstream.length > 0 && (
            <>
              <Separator className="bg-border" />
              <div>
                <p className="text-xs font-semibold text-text mb-1.5 flex items-center gap-1">
                  <IconArrowUpRight size={13} className="text-accent" />
                  {t('kg.detail.upstream')} ({upstream.length})
                </p>
                <div className="space-y-1">
                  {upstream.map(({ edge, node: upNode }) => (
                    <button
                      type="button"
                      key={edge.source}
                      onClick={() => onSelectNode(upNode!)}
                      className="w-full text-left rounded px-2 py-1 text-xs hover:bg-surface-soft flex items-center justify-between gap-2 group"
                    >
                      <span className="truncate text-text-dim group-hover:text-text">{upNode?.label ?? edge.source}</span>
                      <span className="flex-shrink-0 text-text-muted">{t(`kg.relation.${edge.relation}` as any, { defaultValue: edge.relation })}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 下游关系 */}
          {downstream.length > 0 && (
            <>
              <Separator className="bg-border" />
              <div>
                <p className="text-xs font-semibold text-text mb-1.5 flex items-center gap-1">
                  <IconArrowDownRight size={13} className="text-success" />
                  {t('kg.detail.downstream')} ({downstream.length})
                </p>
                <div className="space-y-1">
                  {downstream.map(({ edge, node: downNode }) => (
                    <button
                      type="button"
                      key={edge.target}
                      onClick={() => onSelectNode(downNode!)}
                      className="w-full text-left rounded px-2 py-1 text-xs hover:bg-surface-soft flex items-center justify-between gap-2 group"
                    >
                      <span className="truncate text-text-dim group-hover:text-text">{downNode?.label ?? edge.target}</span>
                      <span className="flex-shrink-0 text-text-muted">{t(`kg.relation.${edge.relation}` as any, { defaultValue: edge.relation })}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {!upstream.length && !downstream.length && (
            <p className="text-xs text-text-muted italic">{t('kg.detail.noRelations')}</p>
          )}

          {/* 冲突检测 */}
          {nodeConflicts && nodeConflicts.length > 0 && (
            <>
              <Separator className="bg-border" />
              <div>
                <p className="text-xs font-semibold text-danger mb-1.5 flex items-center gap-1">
                  <IconAlertOctagon size={13} />
                  {t('kg.detail.conflicts')} ({nodeConflicts.length})
                </p>
                <div className="space-y-1">
                  {nodeConflicts.map((pair, i) => {
                    const other = pair.nodeA.id === node.id ? pair.nodeB : pair.nodeA;
                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => onSelectNode(other)}
                        className="w-full text-left rounded px-2 py-1 text-xs hover:bg-danger/10 flex items-start gap-2 group border border-danger/15"
                      >
                        <span className="truncate text-danger/80 group-hover:text-danger flex-1">{other.label}</span>
                        {pair.reason && <span className="text-text-muted text-[10px] truncate">{pair.reason}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* 影响分析摘要 */}
          {impactDetail && impactDetail.totalCount > 0 && (
            <>
              <Separator className="bg-border" />
              <div>
                <p className="text-xs font-semibold text-warn mb-1.5 flex items-center gap-1">
                  <IconRadar size={13} />
                  {t('kg.detail.impactSummary')} ({impactDetail.totalCount})
                </p>
                <div className="space-y-1">
                  {Object.entries(impactDetail.byType).map(([type, nodes]) => (
                    nodes && nodes.length > 0 && (
                      <div key={type} className="flex items-center justify-between text-xs px-2 py-0.5">
                        <span className="text-text-dim">{t(`kg.nodeType.${type}` as any)}</span>
                        <span className="text-warn font-mono">{nodes.length}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
