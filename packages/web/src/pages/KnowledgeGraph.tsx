import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconShare2,
  IconRefresh,
  IconDatabase,
  IconAlertTriangle,
  IconShield,
  IconBuildingStore,
  IconChartBar,
  IconAlertOctagon,
} from '@tabler/icons-react';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { ScrollArea } from '../components/ui/ScrollArea';
import { GraphCanvas } from '../components/KnowledgeGraph/GraphCanvas';
import { GraphFiltersPanel, type KGFilters } from '../components/KnowledgeGraph/GraphFiltersPanel';
import { NodeDetailPanel } from '../components/KnowledgeGraph/NodeDetailPanel';
import {
  useKGOverview,
  useKGSearch,
  useKGNeighborhood,
  useKGChain,
  useRunKGBackfill,
  useKGConflicts,
} from '../hooks/useKnowledgeGraph';
import type { KGNode, KGNodeType } from '../api/client';

const ALL_NODE_TYPES: KGNodeType[] = [
  'rule', 'rule_source', 'rule_system', 'scenario',
  'business', 'profile', 'dimension', 'gap', 'report', 'document',
];

type TabId = 'overview' | 'lineage' | 'business' | 'gaps';

function OverviewStatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-card p-4 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-surface-soft flex items-center justify-center text-accent">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-text leading-none">{value}</p>
        <p className="text-xs text-text-dim mt-0.5">{label}</p>
      </div>
    </div>
  );
}

export function KnowledgeGraph() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const incomingNodeId = searchParams.get('nodeId');

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedNode, setSelectedNode] = useState<KGNode | undefined>();
  const [chainNodeId, setChainNodeId] = useState<string | undefined>();
  const [filters, setFilters] = useState<KGFilters>({
    nodeTypes: ALL_NODE_TYPES,
    relationTypes: [],
    searchQuery: '',
  });

  const { data: overview, isLoading: loadingOverview } = useKGOverview();
  const { data: allConflicts } = useKGConflicts();
  const backfill = useRunKGBackfill();

  // 全图搜索节点（根据 filters 或搜索词）
  const searchTypes = filters.nodeTypes.length < ALL_NODE_TYPES.length ? filters.nodeTypes : undefined;
  const { data: searchResults } = useKGSearch(filters.searchQuery || undefined, searchTypes, 200);

  // 从 URL ?nodeId 参数自动定位并选中节点
  useEffect(() => {
    if (!incomingNodeId || !searchResults) return;
    const found = searchResults.find((n) => n.id === incomingNodeId);
    if (found && (!selectedNode || selectedNode.id !== incomingNodeId)) {
      setSelectedNode(found);
    }
  }, [incomingNodeId, searchResults, selectedNode]);

  // 选中节点的邻域
  const { data: neighborhood } = useKGNeighborhood(selectedNode?.id, {
    depth: 2,
    direction: 'both',
    relations: filters.relationTypes.length ? filters.relationTypes : undefined,
  });

  // 血缘链路（当切换 lineage tab 时使用 chainNodeId 或第一个 rule 节点）
  const { data: chainData } = useKGChain(
    activeTab === 'lineage' ? (chainNodeId ?? searchResults?.find((n) => n.nodeType === 'rule')?.id) : undefined,
    'both'
  );

  // 当前 tab 显示的图数据
  const currentGraph = useMemo(() => {
    if (activeTab === 'lineage' && chainData) return chainData;
    if (!searchResults) return { nodes: [], edges: [] };

    // 过滤节点类型
    let nodes = searchResults;
    if (filters.nodeTypes.length && filters.nodeTypes.length < ALL_NODE_TYPES.length) {
      nodes = nodes.filter((n) => filters.nodeTypes.includes(n.nodeType));
    }

    // business/profile tab 过滤
    if (activeTab === 'business') {
      nodes = nodes.filter((n) => ['business', 'profile', 'dimension'].includes(n.nodeType));
    }
    if (activeTab === 'gaps') {
      nodes = nodes.filter((n) => ['gap', 'report', 'scenario'].includes(n.nodeType));
    }

    return { nodes, edges: neighborhood?.edges ?? [] };
  }, [activeTab, chainData, searchResults, filters.nodeTypes, neighborhood]);

  return (
    <div className="flex h-full flex-col bg-surface text-text">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <IconShare2 size={18} className="text-accent" />
          <h1 className="text-base font-semibold">{t('nav.knowledgeGraph')}</h1>
          {loadingOverview && <span className="text-xs text-text-muted ml-2">{t('common.loading')}</span>}
        </div>
        <button
          type="button"
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
          className="flex items-center gap-1.5 rounded border border-border bg-surface-card px-3 py-1.5 text-xs text-text-dim hover:border-accent hover:text-text disabled:opacity-50"
        >
          <IconRefresh size={13} className={backfill.isPending ? 'animate-spin' : ''} />
          {t('kg.backfill')}
        </button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} className="flex flex-col flex-1 min-h-0">
        <TabsList className="flex gap-1 border-b border-border px-5 pt-2 rounded-none bg-transparent">
          {(
            [
              { id: 'overview', labelKey: 'kg.tab.overview',  icon: <IconDatabase size={14} /> },
              { id: 'lineage',  labelKey: 'kg.tab.lineage',   icon: <IconShield size={14} /> },
              { id: 'business', labelKey: 'kg.tab.business',  icon: <IconBuildingStore size={14} /> },
              { id: 'gaps',     labelKey: 'kg.tab.gaps',      icon: <IconAlertTriangle size={14} /> },
            ] as const
          ).map(({ id, labelKey, icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="flex items-center gap-1.5 rounded-t px-3 py-1.5 text-xs text-text-muted border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:text-text hover:text-text-dim"
            >
              {icon}
              {t(labelKey as any)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex flex-1 min-h-0">
          {/* Left: Filters */}
          <aside className="w-52 flex-shrink-0 border-r border-border flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                <GraphFiltersPanel filters={filters} onChange={setFilters} />
              </div>
            </ScrollArea>
          </aside>

          {/* Center: Canvas */}
          <main className="flex-1 min-w-0 flex flex-col p-4 gap-3">
            {/* Overview stats */}
            {activeTab === 'overview' && overview && (
              <div className="grid grid-cols-3 gap-3 flex-shrink-0 pointer-events-none">
                <OverviewStatCard label={t('kg.stats.totalNodes')} value={overview.nodeCount} icon={<IconDatabase size={18} />} />
                <OverviewStatCard label={t('kg.stats.totalEdges')} value={overview.edgeCount} icon={<IconShare2 size={18} />} />
                <OverviewStatCard
                  label={t('kg.stats.rules')}
                  value={(overview.nodesByType['rule'] ?? 0) + (overview.nodesByType['rule_source'] ?? 0) + (overview.nodesByType['rule_system'] ?? 0)}
                  icon={<IconShield size={18} />}
                />
                <OverviewStatCard label={t('kg.stats.gaps')} value={overview.nodesByType['gap'] ?? 0} icon={<IconAlertTriangle size={18} />} />
                {allConflicts !== undefined && (
                  <OverviewStatCard
                    label={t('kg.stats.conflicts')}
                    value={allConflicts.length}
                    icon={<IconAlertOctagon size={18} />}
                  />
                )}
              </div>
            )}

            {/* Lineage tab: select chain root */}
            {activeTab === 'lineage' && (
              <div className="flex items-center gap-2 text-xs text-text-dim pointer-events-none">
                <IconChartBar size={14} />
                <span>{t('kg.lineage.rootHint')}</span>
                {chainNodeId && (
                  <button type="button" onClick={() => setChainNodeId(undefined)} className="text-danger hover:underline pointer-events-auto">
                    {t('kg.lineage.clearRoot')}
                  </button>
                )}
              </div>
            )}

            {/* Graph Canvas */}
            <div className="flex-1 min-h-0 relative z-0">
              <GraphCanvas
                nodes={currentGraph.nodes}
                edges={currentGraph.edges}
                selectedNodeId={selectedNode?.id}
                onNodeClick={(node) => {
                  setSelectedNode(node);
                  if (activeTab === 'lineage') setChainNodeId(node.id);
                }}
                emptyHint={t('kg.emptyHint')}
              />
            </div>
          </main>

          {/* Right: Node Detail Panel */}
          {selectedNode && (
            <aside className="w-72 flex-shrink-0 flex flex-col min-h-0">
              <NodeDetailPanel
                node={selectedNode}
                neighborhood={neighborhood}
                onClose={() => setSelectedNode(undefined)}
                onSelectNode={(node) => setSelectedNode(node)}
                onViewChain={(id) => { setChainNodeId(id); setActiveTab('lineage'); }}
                onViewImpact={(id) => { setSelectedNode({ ...selectedNode, id }); }}
              />
            </aside>
          )}
        </div>
      </Tabs>
    </div>
  );
}
