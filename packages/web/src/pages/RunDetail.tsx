import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconLoader2, IconPlayerStop, IconRoute } from '@tabler/icons-react';
import {
  appendRunMessage,
  cancelRun,
  getRun,
  getRunEvents,
  getRunArtifacts,
  listModels,
  listTools,
  submitRunInput,
  uploadSessionAttachment,
  type RunComposerPayload,
  type RunSummary,
  type RunTimelineEvent,
  type RunArtifactRecord,
} from '../api/client';
import { RunTimeline } from '../components/Runs/RunTimeline';
import { ArtifactPanel } from '../components/Runs/ArtifactPanel';
import { InterventionPanel } from '../components/Runs/InterventionPanel';
import { AgentComposerCard } from '../components/Chat/AgentComposerCard';
import { AgentWorkspaceShell } from '../components/Chat/AgentWorkspaceShell';
import { pickPreferredModel, pickPreferredModelId } from '../lib/preferredModel';
import { ScrollArea } from '../components/ui';

type SendMode = 'stop-and-send' | 'queue' | 'steer';

interface QueuedRunMessage {
  id: string;
  content: string;
  attachmentIds: string[];
  attachments: Awaited<ReturnType<typeof uploadSessionAttachment>>[];
  toolIds: string[];
  modelId?: string;
  mode: SendMode;
}

const TERMINAL_RUN_STATUSES = new Set<RunSummary['status']>(['completed', 'failed', 'cancelled']);

function toggleStringItem(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('attachment_read_failed'));
        return;
      }
      const [, payload = result] = result.split(',', 2);
      resolve(payload);
    };
    reader.onerror = () => reject(new Error('attachment_read_failed'));
    reader.readAsDataURL(file);
  });
}

export function RunDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [interventionInput, setInterventionInput] = useState('');
  const [sidePanelTab, setSidePanelTab] = useState<'artifacts' | 'metrics' | 'input'>('artifacts');
  const [composerValue, setComposerValue] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<Awaited<ReturnType<typeof uploadSessionAttachment>>[]>([]);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<SendMode>('steer');
  const [queuedMessages, setQueuedMessages] = useState<QueuedRunMessage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueDispatchBlockedRef = useRef(false);

  const { data: run, isLoading: loadingRun } = useQuery<RunSummary>({
    queryKey: ['run', id],
    queryFn: () => getRun(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = (query.state.data as RunSummary | undefined)?.status;
      if (status && TERMINAL_RUN_STATUSES.has(status)) return false;
      return 5000;
    },
  });

  const { data: events = [] } = useQuery<RunTimelineEvent[]>({
    queryKey: ['run-events', id],
    queryFn: () => getRunEvents(id!),
    enabled: !!id,
    refetchInterval: () => {
      const run = queryClient.getQueryData<RunSummary>(['run', id]);
      if (run && TERMINAL_RUN_STATUSES.has(run.status)) return false;
      return 5000;
    },
  });

  const { data: artifacts = [] } = useQuery<RunArtifactRecord[]>({
    queryKey: ['run-artifacts', id],
    queryFn: () => getRunArtifacts(id!),
    enabled: !!id,
    refetchInterval: () => {
      const run = queryClient.getQueryData<RunSummary>(['run', id]);
      if (run && TERMINAL_RUN_STATUSES.has(run.status)) return false;
      return 10000;
    },
  });

  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: listModels });
  const toolsQuery = useQuery({ queryKey: ['tools', 'run-detail'], queryFn: () => listTools() });
  const enabledModels = (modelsQuery.data ?? []).filter((model) => model.enabled);
  const availableTools = toolsQuery.data?.tools ?? [];
  const composerAttachmentIds = composerAttachments.map((attachment) => attachment.attachmentId);
  const selectedModel = pickPreferredModel(enabledModels, selectedModelId);

  useEffect(() => {
    if (enabledModels.length === 0) return;
    const fallbackModelId = pickPreferredModelId(enabledModels, selectedModelId);
    if (!fallbackModelId || fallbackModelId === selectedModelId) return;
    setSelectedModelId(fallbackModelId);
  }, [enabledModels, selectedModelId]);

  const toggleToolSelection = useCallback((toolName: string) => {
    setSelectedToolIds((prev) => toggleStringItem(prev, toolName));
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((prev) => prev.filter((attachment) => attachment.attachmentId !== attachmentId));
  }, []);

  const handleAttachmentFiles = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    setAttachmentError(null);
    setUploadingNames((prev) => [...prev, ...fileList.map((file) => file.name)]);

    try {
      const uploaded = await Promise.all(
        fileList.map(async (file) => {
          const dataBase64 = await readFileAsBase64(file);
          return uploadSessionAttachment({
            filename: file.name,
            contentType: file.type || undefined,
            dataBase64,
          });
        }),
      );

      setComposerAttachments((prev) => {
        const next = [...prev];
        for (const attachment of uploaded) {
          if (!next.some((item) => item.attachmentId === attachment.attachmentId)) {
            next.push(attachment);
          }
        }
        return next;
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'attachment_upload_failed');
    } finally {
      setUploadingNames((prev) => prev.filter((name) => !fileList.some((file) => file.name === name)));
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const submitMutation = useMutation({
    mutationFn: () => submitRunInput(id!, { input: interventionInput }),
    onSuccess: () => {
      setInterventionInput('');
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['run-events', id] });
    },
  });

  const followUpMutation = useMutation({
    mutationFn: (payload: RunComposerPayload) => appendRunMessage(id!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['run-events', id] });
      queryClient.invalidateQueries({ queryKey: ['run-artifacts', id] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['run', id] });
      queryClient.invalidateQueries({ queryKey: ['run-events', id] });
    },
  });

  const queueMessage = useCallback((content: string, mode: SendMode) => {
    setQueuedMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        content,
        attachmentIds: [...composerAttachmentIds],
        attachments: [...composerAttachments],
        toolIds: [...selectedToolIds],
        modelId: selectedModelId || selectedModel?.modelId,
        mode,
      },
    ]);
    setComposerValue('');
    setComposerAttachments([]);
    setAttachmentError(null);
    void queryClient.invalidateQueries({ queryKey: ['run', id] });
  }, [composerAttachmentIds, composerAttachments, id, queryClient, selectedModel?.modelId, selectedModelId, selectedToolIds]);

  useEffect(() => {
    if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) {
      queueDispatchBlockedRef.current = false;
    }
  }, [run?.status]);

  useEffect(() => {
    if (!id || !run || queuedMessages.length === 0 || followUpMutation.isPending || queueDispatchBlockedRef.current) {
      return;
    }
    if (!TERMINAL_RUN_STATUSES.has(run.status)) {
      return;
    }

    const [first, ...rest] = queuedMessages;
    queueDispatchBlockedRef.current = true;
    setQueuedMessages(rest);
    followUpMutation.mutate({
      content: first.content,
      modelId: first.modelId,
      attachmentIds: first.attachmentIds,
      toolIds: first.toolIds,
      mode: first.mode,
    });
  }, [followUpMutation, id, queuedMessages, run]);

  const handleComposerSubmit = useCallback((mode?: SendMode) => {
    if (!id || !run) return;
    const trimmed = composerValue.trim();
    if (!trimmed) return;

    const effectiveMode = mode ?? sendMode;

    if (effectiveMode === 'queue' && !TERMINAL_RUN_STATUSES.has(run.status)) {
      queueMessage(trimmed, effectiveMode);
      return;
    }

    setComposerValue('');
    setComposerAttachments([]);
    setAttachmentError(null);
    followUpMutation.mutate({
      content: trimmed,
      modelId: selectedModelId || selectedModel?.modelId || undefined,
      attachmentIds: composerAttachmentIds,
      toolIds: selectedToolIds,
      mode: effectiveMode,
    });
  }, [composerAttachmentIds, composerValue, followUpMutation, id, queueMessage, run, selectedModel?.modelId, selectedModelId, selectedToolIds, sendMode]);

  if (loadingRun) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-text-muted">
        <IconLoader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-text-muted">
        {t('runDetail.notFound', 'Run not found.')}
      </div>
    );
  }

  const canCancel = !['completed', 'failed', 'cancelled'].includes(run.status);
  const canComposeFollowUp = run.status !== 'waiting_user';
  const sendModeLabels: Record<SendMode, string> = {
    'stop-and-send': t('runDetail.sendModes.stopAndSend', '停止并发送'),
    queue: t('runDetail.sendModes.queue', '添加到队列'),
    steer: t('runDetail.sendModes.steer', '通过消息引导'),
  };
  const sendButtonLabel = sendMode === 'queue' ? t('runDetail.sendModes.queue', '添加到队列') : t('runDetail.send', '发送');
  const runStatusLabel = t(`runDetail.status.${run.status}`, run.status);
  const queueItems = queuedMessages.map((message) => ({
    id: message.id,
    content: message.content,
    modeLabel: sendModeLabels[message.mode],
    meta: [
      message.attachments.length > 0 ? t('runDetail.queueMeta.attachments', '附件 {{count}}', { count: message.attachments.length }) : '',
      message.toolIds.length > 0 ? t('runDetail.queueMeta.tools', '工具 {{count}}', { count: message.toolIds.length }) : '',
    ].filter(Boolean),
  }));

  const composer = canComposeFollowUp ? (
    <AgentComposerCard
      value={composerValue}
      onValueChange={setComposerValue}
      placeholder={t('runDetail.placeholder', '通过消息补充引导或继续当前 run...')}
      onSubmit={() => handleComposerSubmit()}
      onSubmitWithMode={canCancel ? (mode) => handleComposerSubmit(mode as SendMode) : undefined}
      submitLabel={followUpMutation.isPending ? t('runDetail.sending', '发送中') : sendButtonLabel}
      busy={followUpMutation.isPending}
      running={canCancel}
      submitDisabled={!composerValue.trim()}
      footerHint={t('runDetail.footerHint', '在同一 run 中追加引导、排队下一轮分析，或切换当前 follow-up 的模型与工具。')}
      models={enabledModels}
      selectedModelId={selectedModelId}
      onModelChange={setSelectedModelId}
      tools={availableTools}
      selectedToolIds={selectedToolIds}
      onToggleTool={toggleToolSelection}
      attachments={composerAttachments}
      onRemoveAttachment={removeComposerAttachment}
      onSelectFiles={handleAttachmentFiles}
      uploadingNames={uploadingNames}
      attachmentError={attachmentError}
      fileInputRef={fileInputRef}
      queueMessages={queueItems}
      onRemoveQueuedMessage={(queuedId) => setQueuedMessages((prev) => prev.filter((item) => item.id !== queuedId))}
      sendModes={[
        { value: 'stop-and-send', label: t('runDetail.sendModes.stopAndSend', '停止并发送') },
        { value: 'queue', label: t('runDetail.sendModes.queue', '添加到队列') },
        { value: 'steer', label: t('runDetail.sendModes.steer', '通过消息引导') },
      ]}
      selectedSendMode={sendMode}
      onSelectSendMode={(value) => setSendMode(value as SendMode)}
      canCancel={canCancel}
      onPasteFiles={(files) => {
        void handleAttachmentFiles(files);
      }}
    />
  ) : undefined;

  const main = (
    <ScrollArea className="h-full px-6 py-4">
      <div className="space-y-4 pb-5">
        {run.status === 'waiting_user' && (
          <InterventionPanel
            runId={run.runId}
            status={run.status}
            value={interventionInput}
            onChange={setInterventionInput}
            onSubmit={() => submitMutation.mutate()}
            busy={submitMutation.isPending}
          />
        )}

        <div className="rounded-[28px] border border-border bg-surface-card/70 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
          <RunTimeline events={events} run={run} artifacts={artifacts} />
        </div>
      </div>
    </ScrollArea>
  );

  const aside = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border/70 px-4 py-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-text-subtle">{t('runDetail.sidePanel', 'Run side panel')}</p>
        <h2 className="mt-1 text-sm font-semibold text-text">{t('runDetail.statusAndArtifacts', '状态与产物')}</h2>
        <div className="mt-4 grid w-full grid-cols-3 gap-2 rounded-[22px] bg-surface p-1.5">
          {[
            ['artifacts', t('runDetail.tabs.artifacts', 'Artifacts')],
            ['metrics', t('runDetail.tabs.metrics', 'Metrics')],
            ['input', t('runDetail.tabs.input', 'Input')],
          ].map(([value, label]) => {
            const selected = sidePanelTab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSidePanelTab(value as 'artifacts' | 'metrics' | 'input')}
                className={`rounded-[18px] px-3 py-2 text-xs transition-colors ${selected ? 'bg-surface-card text-text shadow-[0_8px_20px_rgba(0,0,0,0.14)]' : 'text-text-muted hover:bg-surface-card/70 hover:text-text'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-4 py-4">
        {sidePanelTab === 'artifacts' && (
          <ScrollArea className="h-full pr-2">
            <ArtifactPanel artifacts={artifacts} />
          </ScrollArea>
        )}

        {sidePanelTab === 'metrics' && run.metrics && (
          <ScrollArea className="h-full pr-2">
            <div className="rounded-[24px] border border-border bg-surface-card/88 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">{t('runDetail.metrics.title', 'Metrics')}</h3>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-[18px] border border-border bg-surface px-3 py-3">
                  <dt className="text-text-muted">{t('runDetail.metrics.turns', 'Turns')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">{run.metrics.turnCount}</dd>
                </div>
                <div className="rounded-[18px] border border-border bg-surface px-3 py-3">
                  <dt className="text-text-muted">{t('runDetail.metrics.toolCalls', 'Tool calls')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">{run.metrics.toolCallCount}</dd>
                </div>
                <div className="rounded-[18px] border border-border bg-surface px-3 py-3">
                  <dt className="text-text-muted">{t('runDetail.metrics.inputTokens', 'Input tokens')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">{run.metrics.inputTokens.toLocaleString()}</dd>
                </div>
                <div className="rounded-[18px] border border-border bg-surface px-3 py-3">
                  <dt className="text-text-muted">{t('runDetail.metrics.outputTokens', 'Output tokens')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">{run.metrics.outputTokens.toLocaleString()}</dd>
                </div>
                <div className="col-span-2 rounded-[18px] border border-border bg-surface px-3 py-3">
                  <dt className="text-text-muted">{t('runDetail.metrics.estimatedCost', 'Est. cost')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-text">${run.metrics.estimatedUsd.toFixed(4)}</dd>
                </div>
              </dl>
            </div>
          </ScrollArea>
        )}

        {sidePanelTab === 'input' && (
          <ScrollArea className="h-full pr-2">
            <InterventionPanel
              runId={run.runId}
              status={run.status}
              value={interventionInput}
              onChange={setInterventionInput}
              onSubmit={() => submitMutation.mutate()}
              busy={submitMutation.isPending}
            />
          </ScrollArea>
        )}
      </div>
    </div>
  );

  return (
    <AgentWorkspaceShell
      eyebrow={t('runDetail.eyebrow', 'Run Detail')}
      title={run.runId}
      status={
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">
          <IconRoute size={12} />
          {runStatusLabel}
          {run.terminationReason ? ` (${run.terminationReason})` : ''}
        </span>
      }
      meta={t('runDetail.meta', 'Created {{date}} · {{kind}}', {
        date: new Date(run.createdAt).toLocaleString(i18n.language),
        kind: run.taskKind,
      })}
      actions={
        canCancel ? (
          <button
            type="button"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
          >
            {cancelMutation.isPending ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlayerStop size={14} />}
            {cancelMutation.isPending ? t('runDetail.cancelling', 'Cancelling...') : t('runDetail.cancelRun', 'Cancel run')}
          </button>
        ) : null
      }
      main={main}
      composer={composer}
      aside={aside}
      asideTitle={t('runDetail.statusAndArtifacts', '状态与产物')}
    />
  );
}
