/**
 * StorageSettingsPage — Storage Tab 主组合页面
 * settings-center-frontend-mapping.md §5.1 layout
 */
import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { storageSettingsApi, type StorageProfile, type ValidateStorageConfigResponse } from '../../../api/storageSettings';
import { ActiveStorageCard } from './ActiveStorageCard';
import { StorageProfileSwitcher } from './StorageProfileSwitcher';
import { StorageConfigEditor } from './StorageConfigEditor';
import { ValidationResultPanel } from './ValidationResultPanel';
import { StorageActionBar, type ActionBarState } from './StorageActionBar';
import { ApplyConfirmDialog } from './ApplyConfirmDialog';
import { RollbackDialog } from './RollbackDialog';
import { MigrationCreateDialog } from './MigrationCreateDialog';
import { MigrationJobTable } from './MigrationJobTable';
import { RevisionHistoryTable } from './RevisionHistoryTable';import { MigrationJobDetailDrawer } from './MigrationJobDetailDrawer';
import { useStorageEvents } from '../../../hooks/useStorageEvents';
export function StorageSettingsPage() {
  const qc = useQueryClient();

  // Subscribe to storage WS events for real-time query invalidation (storage-settings-api.md §9)
  useStorageEvents();

  // Current active storage (for "从当前配置复制")
  const currentQuery = useQuery({
    queryKey: ['storage-current'],
    queryFn: storageSettingsApi.getCurrent,
    staleTime: 10_000,
  });

  // Editor state
  const [config, setConfig] = useState<Record<string, unknown>>({
    structured: { backend: 'sqlite',    path: './risk_agent_data/data/risk_agent.db' },
    vector:     { backend: 'lancedb',   path: './risk_agent_data/data/lance' },
    graph:      { backend: 'graphology', path: './risk_agent_data/data/graph/business_graph.json' },
    object:     { backend: 'local',     basePath: './risk_agent_data/data/objects' },
  });
  const [selectedProfile, setSelectedProfile] = useState<StorageProfile>('embedded');
  const [isDirty, setIsDirty] = useState(false);
  const [isValidJson, setIsValidJson] = useState(true);
  const [validationResult, setValidationResult] = useState<ValidateStorageConfigResponse | null>(null);

  // Dialog state
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [rollbackRevisionId, setRollbackRevisionId] = useState<string | null>(null);
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);

  // Running migration guard
  const migrationJobsQuery = useQuery({
    queryKey: ['storage-migration-jobs'],
    queryFn: () => storageSettingsApi.listMigrationJobs(),
    refetchInterval: 5_000,
  });
  const hasRunningMigration = migrationJobsQuery.data?.jobs.some(
    (j) => j.status === 'queued' || j.status === 'running'
  ) ?? false;

  // Mutations
  const validateMut = useMutation({
    mutationFn: () => storageSettingsApi.validate({ config, profile: selectedProfile }),
    onSuccess: (result) => {
      setValidationResult(result);
      setIsDirty(false);
    },
  });

  const applyMut = useMutation({
    mutationFn: () => storageSettingsApi.apply({ config, profile: selectedProfile, validationId: validationResult?.validationId }),
    onSuccess: () => {
      setApplyDialogOpen(false);
      setValidationResult(null);
      setIsDirty(false);
      void qc.invalidateQueries({ queryKey: ['storage-current'] });
      void qc.invalidateQueries({ queryKey: ['storage-history'] });
    },
  });

  const rollbackMut = useMutation({
    mutationFn: ({ revisionId, reason }: { revisionId: string; reason?: string }) =>
      storageSettingsApi.rollback(revisionId, reason),
    onSuccess: () => {
      setRollbackDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ['storage-current'] });
      void qc.invalidateQueries({ queryKey: ['storage-history'] });
    },
  });

  const migrateMut = useMutation({
    mutationFn: (payload: Parameters<typeof storageSettingsApi.migrate>[0]) =>
      storageSettingsApi.migrate(payload),
    onSuccess: () => {
      setMigrateDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ['storage-migration-jobs'] });
    },
  });

  // Handlers
  const handleConfigChange = useCallback((newConfig: Record<string, unknown>, valid: boolean) => {
    setConfig(newConfig);
    setIsValidJson(valid);
    setIsDirty(true);
    setValidationResult(null);
  }, []);

  const handleProfileSelect = useCallback((profile: StorageProfile, template: Record<string, unknown>) => {
    setSelectedProfile(profile);
    setConfig(template);
    setIsDirty(true);
    setValidationResult(null);
  }, []);

  const handleDownload = useCallback(() => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'storage-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const barState: ActionBarState = {
    isDirty,
    isValidated: validationResult !== null,
    isApplyReady: !!validationResult?.applyReady && isValidJson,
    validating: validateMut.isPending,
    applying: applyMut.isPending,
    rolling: rollbackMut.isPending,
    migrating: migrateMut.isPending || hasRunningMigration,
  };

  return (
    <div className="space-y-5">
      {/* Current state card */}
      <ActiveStorageCard />

      {/* Editor + Validation row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: profile switcher + config editor */}
        <div className="bg-surface-card border border-border-subtle rounded-xl p-4 space-y-4">
          <StorageProfileSwitcher
            selected={selectedProfile}
            currentConfig={currentQuery.data?.config ?? null}
            onSelect={handleProfileSelect}
          />
          <StorageConfigEditor value={config} onChange={handleConfigChange} />
        </div>

        {/* Right: validation result + action bar */}
        <div className="flex flex-col gap-4">
          <div className="bg-surface-card border border-border-subtle rounded-xl p-4 flex-1">
            <ValidationResultPanel result={validationResult} />
          </div>
          <div className="bg-surface-card border border-border-subtle rounded-xl p-4">
            <StorageActionBar
              state={barState}
              onValidate={() => validateMut.mutate()}
              onApply={() => setApplyDialogOpen(true)}
              onRollback={() => setRollbackDialogOpen(true)}
              onMigrate={() => setMigrateDialogOpen(true)}
              onDownload={handleDownload}
            />
            {(validateMut.isError || applyMut.isError || rollbackMut.isError) && (
              <p className="text-xs text-danger mt-2">
                {((validateMut.error || applyMut.error || rollbackMut.error) as Error)?.message ?? '操作失败'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Revision history */}
      <div className="bg-surface-card border border-border-subtle rounded-xl p-4">
        <RevisionHistoryTable onRollbackRequest={(id) => { setRollbackRevisionId(id); setRollbackDialogOpen(true); }} />
      </div>

      {/* Migration jobs */}
      <div className="bg-surface-card border border-border-subtle rounded-xl p-4">
        <MigrationJobTable onViewDetail={(jobId) => setDetailJobId(jobId)} />
      </div>

      {/* Dialogs */}
      <ApplyConfirmDialog
        open={applyDialogOpen}
        profile={selectedProfile}
        currentProfile={currentQuery.data?.activeProfile}
        onConfirm={() => applyMut.mutate()}
        onCancel={() => setApplyDialogOpen(false)}
      />
      <RollbackDialog
        open={rollbackDialogOpen}
        preselectedRevisionId={rollbackRevisionId ?? undefined}
        onConfirm={(revisionId, reason) => rollbackMut.mutate({ revisionId, reason })}
        onCancel={() => { setRollbackDialogOpen(false); setRollbackRevisionId(null); }}
      />
      <MigrationCreateDialog
        open={migrateDialogOpen}
        onConfirm={(payload) => migrateMut.mutate(payload)}
        onCancel={() => setMigrateDialogOpen(false)}
      />
      <MigrationJobDetailDrawer
        jobId={detailJobId}
        onClose={() => setDetailJobId(null)}
      />
    </div>
  );
}
