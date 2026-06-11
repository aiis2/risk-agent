import { useTranslation } from 'react-i18next';
import { Separator } from '../ui/Separator';

// 节点类型色系（与 GraphCanvas 保持一致）
const NODE_ITEMS = [
  { type: 'rule',         labelKey: 'kg.nodeType.rule',        bg: 'bg-accent' },
  { type: 'rule_source',  labelKey: 'kg.nodeType.rule_source', bg: 'bg-node-purple' },
  { type: 'rule_system',  labelKey: 'kg.nodeType.rule_system', bg: 'bg-node-lavender' },
  { type: 'scenario',     labelKey: 'kg.nodeType.scenario',    bg: 'bg-success' },
  { type: 'business',     labelKey: 'kg.nodeType.business',    bg: 'bg-warn' },
  { type: 'profile',      labelKey: 'kg.nodeType.profile',     bg: 'bg-warn' },
  { type: 'dimension',    labelKey: 'kg.nodeType.dimension',   bg: 'bg-node-cyan' },
  { type: 'gap',          labelKey: 'kg.nodeType.gap',         bg: 'bg-danger' },
  { type: 'report',       labelKey: 'kg.nodeType.report',      bg: 'bg-node-mint' },
  { type: 'document',     labelKey: 'kg.nodeType.document',    bg: 'bg-text-dim' },
];

const RELATION_ITEMS = [
  { rel: 'derived_from',   labelKey: 'kg.relation.derived_from',   bg: 'bg-accent' },
  { rel: 'belongs_to',     labelKey: 'kg.relation.belongs_to',     bg: 'bg-success' },
  { rel: 'covers',         labelKey: 'kg.relation.covers',         bg: 'bg-node-cyan' },
  { rel: 'references',     labelKey: 'kg.relation.references',     bg: 'bg-text-dim' },
  { rel: 'conflicts_with', labelKey: 'kg.relation.conflicts_with', bg: 'bg-danger' },
  { rel: 'replaces',       labelKey: 'kg.relation.replaces',       bg: 'bg-warn' },
  { rel: 'has_profile',    labelKey: 'kg.relation.has_profile',    bg: 'bg-warn' },
  { rel: 'has_entity',     labelKey: 'kg.relation.has_entity',     bg: 'bg-node-lavender' },
  { rel: 'exposes_gap',    labelKey: 'kg.relation.exposes_gap',    bg: 'bg-danger' },
];

export function GraphLegend() {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border bg-surface-card p-3 text-xs text-text-dim">
      <p className="mb-2 font-semibold text-text">{t('kg.legend.nodeTypes')}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-3">
        {NODE_ITEMS.map(({ type, labelKey, bg }) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${bg}`} />
            <span className="truncate">{t(labelKey)}</span>
          </div>
        ))}
      </div>
      <Separator className="my-2 bg-border" />
      <p className="mb-2 font-semibold text-text">{t('kg.legend.relations')}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {RELATION_ITEMS.map(({ rel, labelKey, bg }) => (
          <div key={rel} className="flex items-center gap-1.5">
            <span className={`h-0.5 w-3 flex-shrink-0 rounded ${bg}`} />
            <span className="truncate">{t(labelKey)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

