/**
 * useStorageMigration — 迁移任务 hook
 * settings-center-frontend-mapping.md §8
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageSettingsApi } from '../api/storageSettings';

export function useStorageMigration() {
  const qc = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ['storage-migration-jobs'],
    queryFn: () => storageSettingsApi.listMigrationJobs(),
    refetchInterval: (query) => {
      // 有运行中的任务时快速轮询，否则降频
      const jobs = query.state.data?.jobs ?? [];
      return jobs.some((j) => j.status === 'running') ? 2_500 : 15_000;
    },
  });

  const createMigrationMut = useMutation({
    mutationFn: (payload: Parameters<typeof storageSettingsApi.migrate>[0]) =>
      storageSettingsApi.migrate(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['storage-migration-jobs'] });
    },
  });

  return {
    jobs: jobsQuery.data?.jobs ?? [],
    isLoading: jobsQuery.isLoading,

    createMigration: createMigrationMut.mutate,
    isCreating: createMigrationMut.isPending,
    createError: createMigrationMut.error as Error | null,

    /** 手动获取单个任务详情 */
    getJobDetail: storageSettingsApi.getMigrationJob,
  };
}
