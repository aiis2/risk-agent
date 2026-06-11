import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBolt, IconRoute } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createRun, listModels, listTools, uploadSessionAttachment, type SessionAttachment } from '../api/client';
import { AgentComposerCard } from '../components/Chat/AgentComposerCard';
import { AgentWorkspaceShell } from '../components/Chat/AgentWorkspaceShell';
import { pickPreferredModel, pickPreferredModelId } from '../lib/preferredModel';
import { ScrollArea } from '../components/ui';

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

export function RunWorkbench() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<SessionAttachment[]>([]);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: listModels });
  const toolsQuery = useQuery({ queryKey: ['tools', 'runs-workbench'], queryFn: () => listTools() });
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

  const createMutation = useMutation({
    mutationFn: () =>
      createRun({
        input: {
          prompt,
          businessName: prompt.trim(),
          attachmentIds: composerAttachmentIds.length ? composerAttachmentIds : undefined,
          toolIds: selectedToolIds.length ? selectedToolIds : undefined,
        },
        preferredModel: selectedModelId || selectedModel?.modelId || undefined,
        surface: 'web',
      }),
    onSuccess: (result) => {
      navigate(`/runs/${result.runId}`);
    },
  });

  const composer = (
    <AgentComposerCard
      value={prompt}
      onValueChange={setPrompt}
      placeholder={t('runWorkbench.placeholder', '输入任务目标、补充约束，或粘贴附件开始…')}
      onSubmit={() => createMutation.mutate()}
      submitLabel={createMutation.isPending ? t('runWorkbench.creating', '创建中') : t('runWorkbench.startRun', '开始运行')}
      busy={createMutation.isPending}
      submitDisabled={!prompt.trim()}
      footerHint={t('runWorkbench.footerHint', '发送后会创建一次新的运行')}
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
      onPasteFiles={(files) => {
        void handleAttachmentFiles(files);
      }}
    />
  );

  const main = (
    <ScrollArea className="h-full px-6 py-5">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-6">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-card/60 px-5 py-3">
          <div className="inline-flex rounded-xl bg-accent/15 p-2 text-accent shrink-0">
            <IconBolt size={15} />
          </div>
          <p className="text-sm text-text-muted leading-relaxed">
            {t('runWorkbench.intro', '从这里直接启动一次运行，模型、工具、附件与提示词统一输入，创建后自动进入时间线详情页。')}
          </p>
        </div>
      </div>
    </ScrollArea>
  );

  return (
    <AgentWorkspaceShell
      eyebrow={t('runWorkbench.eyebrow', '运行工作台')}
      title={t('runWorkbench.title', '创建一次运行')}
      status={
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">
          <IconRoute size={12} />
          {t('runWorkbench.preview', '预览模式')}
        </span>
      }
      meta={t('runWorkbench.meta', '从这里发起一次运行，不预设必须走分析入口。')}
      main={main}
      composer={composer}
    />
  );
}
