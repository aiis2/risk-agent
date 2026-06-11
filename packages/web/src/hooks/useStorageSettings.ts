/**
 * useStorageSettings — 存储设置业务 hook
 * settings-center-frontend-mapping.md §8
 * 封装 TanStack Query + storageSettingsStore 联动
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageSettingsApi } from '../api/storageSettings';
import { useStorageSettingsStore } from '../stores/storageSettingsStore';

export function useStorageSettings() {
  const qc = useQueryClient();
  const store = useStorageSettingsStore();

  // ─── 查询 ───────────────────────────────────────────────────────────────────

  const currentQuery = useQuery({
    queryKey: ['storage-current'],
    queryFn: storageSettingsApi.getCurrent,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const historyQuery = useQuery({
    queryKey: ['storage-history'],
    queryFn: () => storageSettingsApi.getHistory(20),
    staleTime: 10_000,
  });

  // ─── 校验 ────────────────────────────────────────────────────────────────────

  const validateMut = useMutation({
    mutationFn: () => storageSettingsApi.validate({
      config: store.candidateConfig,
      profile: store.candidateProfile,
    }),
    onMutate: () => store.setPageState('validating'),
    onSuccess: (result) => {
      store.setValidation(result);
      // validated state set in store.setValidation
    },
    onError: (err) => store.setError((err as Error).message),
  });

  // ─── 应用 ────────────────────────────────────────────────────────────────────

  const applyMut = useMutation({
    mutationFn: () => storageSettingsApi.apply({
      config: store.candidateConfig,
      profile: store.candidateProfile,
      validationId: store.validation?.validationId,
    }),
    onMutate: () => store.setPageState('applying'),
    onSuccess: () => {
      store.closeApplyDialog();
      store.setValidation(null);
      store.setDirty(false);
      store.setPageState('ready');
      void qc.invalidateQueries({ queryKey: ['storage-current'] });
      void qc.invalidateQueries({ queryKey: ['storage-history'] });
    },
    onError: (err) => store.setError((err as Error).message),
  });

  // ─── 回滚 ────────────────────────────────────────────────────────────────────

  const rollbackMut = useMutation({
    mutationFn: ({ revisionId, reason }: { revisionId: string; reason?: string }) =>
      storageSettingsApi.rollback(revisionId, reason),
    onMutate: () => store.setPageState('rolling-back'),
    onSuccess: () => {
      store.closeRollbackDialog();
      store.setPageState('ready');
      void qc.invalidateQueries({ queryKey: ['storage-current'] });
      void qc.invalidateQueries({ queryKey: ['storage-history'] });
    },
    onError: (err) => store.setError((err as Error).message),
  });

  return {
    // Data
    current: currentQuery.data ?? null,
    revisions: historyQuery.data?.revisions ?? [],
    isLoadingCurrent: currentQuery.isLoading,
    isLoadingHistory: historyQuery.isLoading,

    // Mutations
    validate: () => validateMut.mutate(),
    apply: () => applyMut.mutate(),
    rollback: (revisionId: string, reason?: string) =>
      rollbackMut.mutate({ revisionId, reason }),

    // Mutation state
    isValidating: validateMut.isPending,
    isApplying: applyMut.isPending,
    isRollingBack: rollbackMut.isPending,
    validateError: validateMut.error as Error | null,
    applyError: applyMut.error as Error | null,
    rollbackError: rollbackMut.error as Error | null,
  };
}
