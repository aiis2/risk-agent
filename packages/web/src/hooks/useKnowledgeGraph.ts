import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getKGOverview,
  searchKG,
  getKGNeighborhood,
  getKGChain,
  getKGImpact,
  getKGImpactDetail,
  getKGConflicts,
  getKGConflictsForNode,
  createKGNode,
  updateKGNode,
  deleteKGNode,
  createKGEdge,
  runKGBackfill,
  type KGNodeType,
  type KGRelationType,
} from '../api/client';

// ─── 查询 hooks ───────────────────────────────────────────────────────────────

export function useKGOverview() {
  return useQuery({
    queryKey: ['kg', 'overview'],
    queryFn: getKGOverview,
    staleTime: 30_000,
  });
}

export function useKGSearch(query?: string, types?: KGNodeType[], limit = 50) {
  return useQuery({
    queryKey: ['kg', 'search', query, types?.join(','), limit],
    queryFn: () => searchKG(query, types, limit),
    staleTime: 15_000,
  });
}

export function useKGNeighborhood(
  nodeId: string | undefined,
  opts?: { depth?: number; direction?: 'upstream' | 'downstream' | 'both'; relations?: KGRelationType[] }
) {
  return useQuery({
    queryKey: ['kg', 'neighborhood', nodeId, opts?.depth, opts?.direction, opts?.relations?.join(',')],
    queryFn: () => getKGNeighborhood(nodeId!, opts),
    staleTime: 15_000,
    enabled: !!nodeId,
  });
}

export function useKGChain(nodeId: string | undefined, direction?: 'upstream' | 'downstream' | 'both') {
  return useQuery({
    queryKey: ['kg', 'chain', nodeId, direction],
    queryFn: () => getKGChain(nodeId!, direction),
    staleTime: 15_000,
    enabled: !!nodeId,
  });
}

export function useKGImpact(nodeId: string | undefined) {
  return useQuery({
    queryKey: ['kg', 'impact', nodeId],
    queryFn: () => getKGImpact(nodeId!),
    staleTime: 15_000,
    enabled: !!nodeId,
  });
}

export function useKGImpactDetail(nodeId: string | undefined, depth?: number) {
  return useQuery({
    queryKey: ['kg', 'impact-detail', nodeId, depth],
    queryFn: () => getKGImpactDetail(nodeId!, depth),
    staleTime: 15_000,
    enabled: !!nodeId,
  });
}

export function useKGConflicts() {
  return useQuery({
    queryKey: ['kg', 'conflicts'],
    queryFn: getKGConflicts,
    staleTime: 30_000,
  });
}

export function useKGConflictsForNode(nodeId: string | undefined) {
  return useQuery({
    queryKey: ['kg', 'conflicts', nodeId],
    queryFn: () => getKGConflictsForNode(nodeId!),
    staleTime: 15_000,
    enabled: !!nodeId,
  });
}

// ─── 写入 mutations ───────────────────────────────────────────────────────────

export function useCreateKGNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createKGNode,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kg'] }); },
  });
}

export function useUpdateKGNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { label?: string; attributes?: Record<string, unknown> } }) =>
      updateKGNode(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kg'] }); },
  });
}

export function useDeleteKGNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteKGNode,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kg'] }); },
  });
}

export function useCreateKGEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createKGEdge,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kg'] }); },
  });
}

export function useRunKGBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runKGBackfill,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kg'] }); },
  });
}
