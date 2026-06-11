import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Separator } from '../ui/Separator';
import type { KGNodeType, KGRelationType } from '../../api/client';

const ALL_NODE_TYPES: KGNodeType[] = [
  'rule', 'rule_source', 'rule_system', 'scenario',
  'business', 'profile', 'dimension', 'gap', 'report', 'document',
];

const ALL_RELATION_TYPES: KGRelationType[] = [
  'derived_from', 'belongs_to', 'covers', 'references',
  'conflicts_with', 'replaces', 'has_profile', 'has_entity', 'exposes_gap',
];

const NODE_TYPE_BG: Record<string, string> = {
  rule:         'bg-accent',
  rule_source:  'bg-node-purple',
  rule_system:  'bg-node-lavender',
  scenario:     'bg-success',
  business:     'bg-warn',
  profile:      'bg-warn',
  dimension:    'bg-node-cyan',
  gap:          'bg-danger',
  report:       'bg-node-mint',
  document:     'bg-text-dim',
};

export interface KGFilters {
  nodeTypes: KGNodeType[];
  relationTypes: KGRelationType[];
  searchQuery: string;
}

interface Props {
  filters: KGFilters;
  onChange: (filters: KGFilters) => void;
}

function TypeChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors',
        active
          ? 'border-transparent !text-white bg-surface-soft ring-1 ring-accent'
          : 'border-border text-text-muted bg-transparent hover:border-accent hover:text-text-dim'
      )}
    >
      {color && <span className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />}
      {label}
    </button>
  );
}

export function GraphFiltersPanel({ filters, onChange }: Props) {
  const { t } = useTranslation();

  const toggleNodeType = (type: KGNodeType) => {
    const current = filters.nodeTypes;
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
    onChange({ ...filters, nodeTypes: next });
  };

  const toggleRelationType = (rel: KGRelationType) => {
    const current = filters.relationTypes;
    const next = current.includes(rel) ? current.filter((r) => r !== rel) : [...current, rel];
    onChange({ ...filters, relationTypes: next });
  };

  const selectAll = () => onChange({ ...filters, nodeTypes: ALL_NODE_TYPES, relationTypes: ALL_RELATION_TYPES });
  const clearAll = () => onChange({ ...filters, nodeTypes: [], relationTypes: [] });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-card p-3 text-xs">
      {/* 搜索框 */}
      <input
        type="text"
        placeholder={t('kg.filters.searchPlaceholder')}
        value={filters.searchQuery}
        onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
      />

      {/* 快捷操作 */}
      <div className="flex items-center justify-between">
        <span className="text-text-muted">{t('kg.filters.filter')}</span>
        <div className="flex gap-2">
          <button type="button" onClick={selectAll} className="text-accent hover:underline">{t('kg.filters.selectAll')}</button>
          <span className="text-border">|</span>
          <button type="button" onClick={clearAll} className="text-text-dim hover:underline">{t('kg.filters.clearAll')}</button>
        </div>
      </div>

      {/* 节点类型 */}
      <div>
        <p className="mb-1.5 font-semibold text-text">{t('kg.filters.nodeTypes')}</p>
        <div className="flex flex-wrap gap-1">
          {ALL_NODE_TYPES.map((type) => (
            <TypeChip
              key={type}
              label={t(`kg.nodeType.${type}` as any)}
              active={filters.nodeTypes.includes(type)}
              color={NODE_TYPE_BG[type]}
              onClick={() => toggleNodeType(type)}
            />
          ))}
        </div>
      </div>

      <Separator className="bg-border" />

      {/* 关系类型 */}
      <div>
        <p className="mb-1.5 font-semibold text-text">{t('kg.filters.relations')}</p>
        <div className="flex flex-wrap gap-1">
          {ALL_RELATION_TYPES.map((rel) => (
            <TypeChip
              key={rel}
              label={t(`kg.relation.${rel}` as any)}
              active={filters.relationTypes.includes(rel)}
              onClick={() => toggleRelationType(rel)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
