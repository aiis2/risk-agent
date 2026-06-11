import { useState, useRef, useEffect, useLayoutEffect, useCallback, type KeyboardEventHandler, type MouseEventHandler, type RefObject, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconArrowUp,
  IconBolt,
  IconChevronDown,
  IconCircleCheck,
  IconDatabase,
  IconEye,
  IconFileText,
  IconListCheck,
  IconLoader2,
  IconMessageForward,
  IconPaperclip,
  IconPhoto,
  IconPlayerStop,
  IconPlus,
  IconRoute,
  IconShieldCheck,
  IconSparkles,
  IconSquareFilled,
  IconStack2,
  IconX,
  IconZoomIn,
} from '@tabler/icons-react';
import type { ModelConfigRecord, SessionAttachment, ToolSummary } from '../../api/client';
import { RunComposerControls } from '../Runs/RunComposerControls';
import { Dialog, DialogContent } from '../ui';

export const COMPOSER_TEXTAREA_MAX_HEIGHT = 300;
const COMPOSER_TEXTAREA_MIN_HEIGHT = 60;

function clampComposerTextareaHeight(height: number): number {
  return Math.min(Math.max(height, COMPOSER_TEXTAREA_MIN_HEIGHT), COMPOSER_TEXTAREA_MAX_HEIGHT);
}

/** Extensions that support inline text preview in the modal */
const TEXT_PREVIEW_EXTS = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'html', 'htm',
  'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'env',
  'sh', 'bat', 'ps1', 'ts', 'tsx', 'js', 'jsx', 'css',
]);

function getFileExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function canPreviewAsText(filename: string, contentType?: string): boolean {
  if (contentType?.startsWith('text/')) return true;
  return TEXT_PREVIEW_EXTS.has(getFileExt(filename));
}

type PreviewItem =
  | { type: 'image'; url: string; filename: string }
  | { type: 'text'; content: string; filename: string }
  | { type: 'loading'; filename: string };

export interface AgentComposerQueueMessage {
  id: string;
  content: string;
  modeLabel: string;
  meta?: string[];
}

export interface AgentComposerSendModeOption {
  value: string;
  label: string;
}

export interface AgentComposerModeOption {
  value: string;
  label: string;
  eyebrow?: string;
}

// ── Attachment helpers ──────────────────────────────────────────────────────

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentFileIcon({ contentType, size = 11 }: { contentType: string; size?: number }) {
  if (contentType.startsWith('image/')) return <IconPhoto size={size} />;
  return <IconFileText size={size} />;
}

// ── Mode icon ───────────────────────────────────────────────────────────────

function ModeIcon({ value, size = 12 }: { value: string; size?: number }) {
  if (value === 'analysis') return <IconShieldCheck size={size} />;
  if (value === 'knowledge-query') return <IconDatabase size={size} />;
  if (value === 'skill-management') return <IconBolt size={size} />;
  if (value === 'general') return <IconRoute size={size} />;
  return <IconSparkles size={size} />;
}

// ── Main component ──────────────────────────────────────────────────────────

interface AgentComposerCardProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  onSubmit: () => void;
  submitLabel: string;
  busy?: boolean;
  running?: boolean;
  submitDisabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement>;
  textareaHeight?: number | null;
  onTextareaHeightChange?: (height: number) => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  footerHint?: ReactNode;
  footerBadges?: ReactNode;
  models: ModelConfigRecord[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  tools: ToolSummary[];
  selectedToolIds: string[];
  onToggleTool: (toolName: string) => void;
  attachments: SessionAttachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  onSelectFiles: (files: FileList | File[]) => void | Promise<void>;
  uploadingNames: string[];
  attachmentError: string | null;
  fileInputRef: RefObject<HTMLInputElement>;
  queueMessages?: AgentComposerQueueMessage[];
  onRemoveQueuedMessage?: (id: string) => void;
  sendModes?: AgentComposerSendModeOption[];
  selectedSendMode?: string;
  onSelectSendMode?: (value: string) => void;
  /** Called when user wants to send with an explicit mode (from action popup) */
  onSubmitWithMode?: (mode: string) => void;
  onPasteFiles?: (files: File[]) => void;
  textareaProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'placeholder' | 'disabled' | 'onKeyDown'>;
  /** Mode/task-kind options for the Agent dropdown */
  modeOptions?: AgentComposerModeOption[];
  /** Currently selected mode value */
  selectedMode?: string;
  /** Called when user picks a different mode */
  onModeChange?: (value: string) => void;
  /** When true, mode dropdown is shown as read-only run-kind badge */
  hasActiveRun?: boolean;
  /** Show stop/cancel button in toolbar */
  canCancel?: boolean;
  /** Called when user clicks the stop button */
  onCancel?: () => void;
  /** Optional header rendered above the textarea (e.g., active run context strip) */
  contextHeader?: ReactNode;
  /** Optional approval mode picker rendered in the toolbar between 配置工具 and send button */
  approvalModePicker?: ReactNode;
}

export function AgentComposerCard({
  value,
  onValueChange,
  placeholder,
  disabled = false,
  onSubmit,
  submitLabel,
  busy = false,
  running = false,
  submitDisabled = false,
  textareaRef,
  textareaHeight = null,
  onTextareaHeightChange,
  onKeyDown,
  footerHint,
  footerBadges,
  models,
  selectedModelId,
  onModelChange,
  tools,
  selectedToolIds,
  onToggleTool,
  attachments,
  onRemoveAttachment,
  onSelectFiles,
  uploadingNames,
  attachmentError,
  fileInputRef,
  queueMessages = [],
  onRemoveQueuedMessage,
  sendModes = [],
  selectedSendMode,
  onSelectSendMode,
  onSubmitWithMode,
  onPasteFiles,
  textareaProps,
  modeOptions,
  selectedMode,
  onModeChange,
  hasActiveRun = false,
  canCancel = false,
  onCancel,
  contextHeader,
  approvalModePicker,
}: AgentComposerCardProps) {
  const { t } = useTranslation();
  const [showModePanel, setShowModePanel] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showActionPopup, setShowActionPopup] = useState(false);
  const [queuePanelExpanded, setQueuePanelExpanded] = useState(true);
  const [localImagePreviews, setLocalImagePreviews] = useState<Map<string, string>>(new Map());
  const [localFileRefs, setLocalFileRefs] = useState<Map<string, File>>(new Map());
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null);
  const dragCounter = useRef(0);
  const modePanelRef = useRef<HTMLDivElement>(null);
  const actionPopupRef = useRef<HTMLDivElement>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedTextareaRef = textareaRef ?? internalTextareaRef;

  // Close send-mode dropdown on outside click
  useEffect(() => {
    if (!showActionPopup) return;
    const handleOutside = (e: MouseEvent) => {
      if (actionPopupRef.current && !actionPopupRef.current.contains(e.target as Node)) {
        setShowActionPopup(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showActionPopup]);

  // Measure before paint so the main pane doesn't visibly jump while typing.
  // We avoid the common "set auto then measure" pattern which forces two layout
  // passes and makes the attachment area above the textarea flicker on every
  // keystroke. Instead: reset height to 0px (collapses without reflowing siblings),
  // read scrollHeight (now accurate because element is shorter than content),
  // then apply the final clamped height in one assignment.
  useLayoutEffect(() => {
    const el = resolvedTextareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const contentHeight = clampComposerTextareaHeight(el.scrollHeight);
    const nextHeight = clampComposerTextareaHeight(textareaHeight ?? contentHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > nextHeight ? 'auto' : 'hidden';
  }, [resolvedTextareaRef, textareaHeight, value]);

  const handleTextareaResizeCommit = useCallback<MouseEventHandler<HTMLTextAreaElement>>((event) => {
    if (!onTextareaHeightChange) {
      return;
    }
    const nextHeight = clampComposerTextareaHeight(
      event.currentTarget.getBoundingClientRect().height ||
      event.currentTarget.offsetHeight ||
      parseFloat(event.currentTarget.style.height) ||
      event.currentTarget.clientHeight,
    );
    event.currentTarget.style.height = `${nextHeight}px`;
    event.currentTarget.style.overflowY = event.currentTarget.scrollHeight > nextHeight ? 'auto' : 'hidden';
    onTextareaHeightChange(nextHeight);
  }, [onTextareaHeightChange]);

  // Close mode panel on outside click
  useEffect(() => {
    if (!showModePanel) return;
    const handleOutside = (e: MouseEvent) => {
      if (modePanelRef.current && !modePanelRef.current.contains(e.target as Node)) {
        setShowModePanel(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showModePanel]);

  // Track local blob URL previews for pasted/dropped images (VSCode Copilot style)
  const addLocalPreviews = (files: File[]) => {
    const newImageEntries: [string, string][] = [];
    const newFileEntries: [string, File][] = [];
    for (const file of files) {
      newFileEntries.push([file.name, file]);
      if (file.type.startsWith('image/')) {
        newImageEntries.push([file.name, URL.createObjectURL(file)]);
      }
    }
    if (newImageEntries.length > 0) {
      setLocalImagePreviews((prev) => new Map([...prev, ...newImageEntries]));
    }
    if (newFileEntries.length > 0) {
      setLocalFileRefs((prev) => new Map([...prev, ...newFileEntries]));
    }
  };

  const openTextPreview = useCallback(async (filename: string) => {
    const file = localFileRefs.get(filename);
    if (!file) return;
    setPreviewItem({ type: 'loading', filename });
    try {
      const text = await file.text();
      setPreviewItem({ type: 'text', content: text, filename });
    } catch {
      setPreviewItem(null);
    }
  }, [localFileRefs]);

  const handleRemoveAttachmentWithCleanup = (attachmentId: string) => {
    const att = attachments.find((a) => a.attachmentId === attachmentId);
    if (att) {
      const url = localImagePreviews.get(att.filename);
      if (url) {
        URL.revokeObjectURL(url);
        setLocalImagePreviews((prev) => {
          const next = new Map(prev);
          next.delete(att.filename);
          return next;
        });
      }
      setLocalFileRefs((prev) => {
        const next = new Map(prev);
        next.delete(att.filename);
        return next;
      });
    }
    onRemoveAttachment(attachmentId);
  };

  // Drag-and-drop file handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0 && !disabled) {
      addLocalPreviews(files);
      void onSelectFiles(files);
    }
  };

  const selectedModeOption = modeOptions?.find((o) => o.value === selectedMode);
  const hasAttachments = attachments.length > 0 || uploadingNames.length > 0;
  const showRunningRing = running && !isDragOver;

  return (
    <>
    <div className="relative rounded-2xl">
      {showRunningRing && (
        <>
          <div
            data-testid="composer-running-ring"
            className="pointer-events-none absolute -inset-px rounded-[18px] border border-accent/30 bg-[linear-gradient(180deg,rgba(107,138,254,0.14),rgba(107,138,254,0.03))] shadow-[0_0_0_1px_rgba(107,138,254,0.08)]"
          />
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,rgba(107,138,254,0),rgba(107,138,254,0.88),rgba(48,209,88,0.42),rgba(107,138,254,0))] opacity-85 animate-pulse" />
          <div className="pointer-events-none absolute inset-x-10 -bottom-2 h-10 rounded-full bg-[radial-gradient(circle,rgba(107,138,254,0.28)_0%,rgba(107,138,254,0)_72%)] blur-xl" />
        </>
      )}

      <div
        data-running={showRunningRing ? 'true' : 'false'}
        className={`relative rounded-2xl border bg-surface-card/95 shadow-[0_4px_24px_rgba(0,0,0,0.16)] backdrop-blur-sm transition-colors ${
          isDragOver
            ? 'border-accent/60 ring-1 ring-accent/25'
            : showRunningRing
              ? 'border-accent/25'
              : 'border-border/50'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-accent/8 backdrop-blur-[1px]">
          <IconPaperclip size={20} className="text-accent/80" />
          <span className="text-[12px] font-medium text-accent/80">{t('composer.releaseToAttach', '释放以附加文件')}</span>
        </div>
      )}

      {/* ── 1. Context header (run-active context strip or custom header) ── */}
      {contextHeader && (
        <div className="border-b border-border/30">
          {contextHeader}
        </div>
      )}

      {/* ── 2. Queued messages — collapsible "待办" style panel ─────────── */}
      {queueMessages.length > 0 && (
        <div className="border-b border-border/40">
          {/* Panel header */}
          <button
            type="button"
            onClick={() => setQueuePanelExpanded((v) => !v)}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-surface-card/40"
          >
            <span className={`shrink-0 transition-transform duration-150 ${queuePanelExpanded ? '' : '-rotate-90'}`}>
              <IconChevronDown size={11} className="text-text-subtle/60" />
            </span>
            <IconListCheck size={12} className="shrink-0 text-warning/80" />
            <span className="text-[11px] font-medium text-text">
              {t('composer.pendingMessages', '待发消息')}
              <span className="ml-1.5 rounded-full border border-warning/25 bg-warning/10 px-1.5 py-px text-[10px] font-medium text-warning">
                {queueMessages.length}
              </span>
            </span>
            {/* Clear all */}
            {onRemoveQueuedMessage && queuePanelExpanded && (
              <span className="ml-auto text-[10px] text-text-subtle/40 hover:text-danger/70 transition-colors pr-0.5">
                ×=
              </span>
            )}
          </button>
          {/* Panel body */}
          {queuePanelExpanded && (
            <div className="space-y-px px-3.5 pb-2.5">
              {queueMessages.map((message, idx) => (
                <div
                  key={message.id}
                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface/40 transition-colors group"
                >
                  {/* Indicator dot */}
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${idx === 0 ? 'bg-accent' : 'border border-text-subtle/40 bg-transparent'}`} />
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-text-subtle/60">{message.modeLabel}</span>
                    <p className="mt-px line-clamp-1 text-[11.5px] leading-snug text-text-muted">{message.content}</p>
                    {message.meta && message.meta.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {message.meta.map((item) => (
                          <span key={`${message.id}-${item}`} className="rounded-full border border-border/40 bg-surface-card/60 px-1.5 py-px text-[10px] text-text-subtle">
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {onRemoveQueuedMessage && (
                    <button
                      type="button"
                      onClick={() => onRemoveQueuedMessage(message.id)}
                      className="mt-1 shrink-0 rounded-full p-0.5 text-text-subtle/30 opacity-0 group-hover:opacity-100 transition-all hover:text-danger"
                      aria-label={t('composer.remove', '移除')}
                    >
                      <IconX size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 2. Attachment thumbnails (VSCode Copilot style) ─────────── */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/30 px-4 pb-2.5 pt-3">
          {attachments.map((attachment) => {
            const previewUrl = localImagePreviews.get(attachment.filename);
            const isImage = attachment.contentType.startsWith('image/');
            const canTextPreview = canPreviewAsText(attachment.filename, attachment.contentType);
            return isImage && previewUrl ? (
              /* Image thumbnail — compact 40×40, click to enlarge */
              <div key={attachment.attachmentId} className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border/40 bg-surface-card cursor-zoom-in"
                onClick={() => setPreviewItem({ type: 'image', url: previewUrl, filename: attachment.filename })}
                title={attachment.filename}
              >
                <img
                  src={previewUrl}
                  alt={attachment.filename}
                  className="h-full w-full object-cover"
                />
                {/* Zoom hint */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconZoomIn size={12} className="text-white" />
                </div>
                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemoveAttachmentWithCleanup(attachment.attachmentId); }}
                  className="absolute right-0.5 top-0.5 rounded-full bg-surface-card/80 p-px text-text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                  aria-label={t('composer.removeAttachment', '移除附件 {{name}}', { name: attachment.filename })}
                >
                  <IconX size={8} />
                </button>
              </div>
            ) : (
              /* File chip — with optional preview button for text formats */
              <div
                key={attachment.attachmentId}
                title={attachment.filename}
                className="group inline-flex items-center gap-1.5 rounded-md border border-accent/15 bg-accent/6 px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-accent/25 hover:bg-accent/10"
              >
                <AttachmentFileIcon contentType={attachment.contentType} size={11} />
                <span className="max-w-[120px] truncate font-medium text-text">{attachment.filename}</span>
                <span className="text-text-subtle opacity-60">{formatAttachmentSize(attachment.sizeBytes)}</span>
                {canTextPreview && (
                  <button
                    type="button"
                    onClick={() => void openTextPreview(attachment.filename)}
                    className="rounded p-px text-text-subtle/60 opacity-0 transition-all group-hover:opacity-100 hover:text-accent"
                    aria-label={`预览 ${attachment.filename}`}
                    title="预览文件内容"
                  >
                    <IconEye size={10} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemoveAttachmentWithCleanup(attachment.attachmentId)}
                  className="rounded-full p-px text-text-subtle transition-colors hover:text-danger"
                  aria-label={t('composer.removeAttachment', '移除附件 {{name}}', { name: attachment.filename })}
                >
                  <IconX size={9} />
                </button>
              </div>
            );
          })}
          {uploadingNames.map((name) => (
            <div key={name} title={name} className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-surface/50 px-2 py-1 text-[11px] text-text-subtle">
              <IconLoader2 size={10} className="animate-spin text-accent/60" />
              <span className="max-w-[120px] truncate">{name}</span>
            </div>
          ))}
        </div>
      )}
      {attachmentError && (
        <p className="border-b border-border/30 px-4 py-1.5 text-[11px] text-danger">{attachmentError}</p>
      )}

      {/* ── 3. Textarea ───────────────────────────────────────────────── */}
      <textarea
        ref={resolvedTextareaRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files ?? []);
          if (files.length === 0 || !onPasteFiles) return;
          event.preventDefault();
          addLocalPreviews(files);
          onPasteFiles(files);
        }}
        onMouseUp={handleTextareaResizeCommit}
        className="min-h-[60px] max-h-[300px] w-full resize-y border-0 bg-transparent px-4 py-3 text-[14px] leading-[1.7] text-text outline-none placeholder:text-text-subtle/50 disabled:cursor-not-allowed disabled:opacity-60"
        {...textareaProps}
      />

      {/* ── 4. Toolbar — VSCode Copilot layout ────────────────────────── */}
      <div className="flex items-center gap-0.5 border-t border-border/25 px-2 pb-1.5 pt-1">

        {/* + button — attach files */}
        <button
          type="button"
          title={t('composer.attachFilesOrImages', '附加文件或图片')}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-surface hover:text-text"
          aria-label={t('composer.uploadAttachment', '上传附件')}
        >
          <IconPlus size={15} strokeWidth={2} />
        </button>

        {/* Vertical separator */}
        <div className="mx-1 h-4 w-px bg-border/40" />

        {/* Mode dropdown / badge — Agent like VSCode */}
        {modeOptions && modeOptions.length > 0 && (
          <div className="relative">
            {hasActiveRun ? (
              /* Read-only mode badge when run is active */
              <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-text-muted">
                <ModeIcon value={selectedMode ?? 'auto'} size={12} />
                <span>{selectedModeOption?.label ?? t('composer.agentMode', 'Agent')}</span>
              </span>
            ) : (
              /* Clickable dropdown when no run active */
              <>
                <button
                  type="button"
                  onClick={() => setShowModePanel((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors ${showModePanel ? 'bg-surface text-text' : 'text-text-muted hover:bg-surface/60 hover:text-text'}`}
                  title={t('composer.chooseTaskMode', '选择任务模式')}
                >
                  <ModeIcon value={selectedMode ?? 'auto'} size={12} />
                  <span>{selectedModeOption?.label ?? t('composer.autoMode', 'Auto')}</span>
                  <IconChevronDown size={10} className={`shrink-0 transition-transform ${showModePanel ? 'rotate-180' : ''}`} />
                </button>
                {showModePanel && (
                  <div ref={modePanelRef} className="absolute bottom-full left-0 z-20 mb-2 w-52 rounded-xl border border-border bg-surface shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-sm">
                    <div className="border-b border-border/40 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">{t('composer.taskMode', '任务模式')}</p>
                    </div>
                    <div className="p-1.5">
                      {modeOptions.map((option) => {
                        const isSelected = option.value === selectedMode;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              onModeChange?.(option.value);
                              setShowModePanel(false);
                            }}
                            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isSelected ? 'bg-accent/10 text-text' : 'text-text-muted hover:bg-surface-card/80 hover:text-text'}`}
                          >
                            <span className={`shrink-0 ${isSelected ? 'text-accent' : ''}`}>
                              <ModeIcon value={option.value} size={13} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium leading-tight">{option.label}</p>
                              {option.eyebrow && (
                                <p className="text-[10px] text-text-subtle">{option.eyebrow}</p>
                              )}
                            </div>
                            {isSelected && <IconCircleCheck size={12} className="shrink-0 text-accent" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Vertical separator */}
        {modeOptions && modeOptions.length > 0 && (
          <div className="mx-0.5 h-4 w-px bg-border/40" />
        )}

        {/* Model + Tools from RunComposerControls */}
        <RunComposerControls
          models={models}
          selectedModelId={selectedModelId}
          onModelChange={onModelChange}
          tools={tools}
          selectedToolIds={selectedToolIds}
          onToggleTool={onToggleTool}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          onSelectFiles={(files) => {
            addLocalPreviews(Array.from(files));
            void onSelectFiles(files);
          }}
          uploadingNames={uploadingNames}
          attachmentError={attachmentError}
          fileInputRef={fileInputRef}
          hideAttachButton
        />

        {/* Approval mode picker — between 配置工具 and send button */}
        {approvalModePicker && (
          <>
            <div className="mx-1 h-4 w-px bg-border/40" />
            {approvalModePicker}
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* ── Right action cluster ───────────────────────────────────── */}
        <div className="flex items-center gap-1">

          {/* Stop button — always shown when run is active */}
          {canCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              title={t('composer.stopCurrentRun', '停止当前运行')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/40 bg-surface-card/60 text-text-muted transition-colors hover:border-danger/30 hover:bg-danger/8 hover:text-danger"
              aria-label={t('composer.stop', '停止')}
            >
              <IconSquareFilled size={11} />
            </button>
          )}

          {/* Send area — 4 states */}
          {canCancel && value.trim() ? (
            /* State: run active + text → [↑ steer] [∨ expand] split button */
            <div ref={actionPopupRef} className="relative flex items-center">
              {/* Send-mode dropdown popup */}
              {showActionPopup && sendModes.length > 0 && (
                <div className="absolute bottom-full right-0 z-30 mb-2 w-56 overflow-hidden rounded-xl border border-border/60 bg-surface shadow-[0_16px_44px_rgba(0,0,0,0.28)] backdrop-blur-sm">
                  <div className="border-b border-border/30 px-3 py-1.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-text-subtle/50">{t('composer.sendMethod', '发送方式')}</p>
                  </div>
                  <div className="p-1">
                    {sendModes.map((mode) => {
                      const isSelected = mode.value === selectedSendMode;
                      const shortcut =
                        mode.value === 'stop-and-send' ? undefined :
                        mode.value === 'queue' ? 'Enter' : 'Alt+↵';
                      const ModeItemIcon = mode.value === 'stop-and-send'
                        ? IconPlayerStop
                        : mode.value === 'queue'
                          ? IconStack2
                          : IconRoute;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => {
                            onSelectSendMode?.(mode.value);
                            onSubmitWithMode?.(mode.value);
                            setShowActionPopup(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors ${isSelected ? 'bg-accent/10 text-text' : 'text-text-muted hover:bg-surface-card/70 hover:text-text'}`}
                        >
                          <ModeItemIcon size={12} className="shrink-0 text-accent/60" />
                          <span className="flex-1 font-medium">{mode.label}</span>
                          {shortcut && (
                            <kbd className="shrink-0 rounded border border-border/40 bg-surface-card/70 px-1.5 py-px font-mono text-[10px] text-text-subtle/60">
                              {shortcut}
                            </kbd>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Split button group: [↑ steer] | [∨] */}
              <div className="flex items-center overflow-hidden rounded-xl bg-accent shadow-[0_2px_10px_rgba(107,138,254,0.28)]">
                <button
                  type="button"
                  onClick={() => { onSubmitWithMode?.('steer'); setShowActionPopup(false); }}
                  disabled={busy}
                  title={t('composer.steerByMessageShortcut', '通过消息引导 (Alt+↵)')}
                  aria-label={t('composer.steerByMessage', '通过消息引导')}
                  className="inline-flex h-8 items-center px-2.5 text-white transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-60"
                >
                  {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowUp size={15} />}
                </button>
                {sendModes.length > 1 && (
                  <>
                    <div className="h-4 w-px bg-white/20" />
                    <button
                      type="button"
                      onClick={() => setShowActionPopup((v) => !v)}
                      title={t('composer.moreSendOptions', '更多发送选项')}
                      aria-label={t('composer.moreSendOptions', '更多发送选项')}
                      className="inline-flex h-8 w-6 items-center justify-center text-white transition-colors hover:bg-white/10 active:bg-white/20"
                    >
                      <IconChevronDown size={11} className={`transition-transform duration-150 ${showActionPopup ? 'rotate-180' : ''}`} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : canCancel && !value.trim() ? (
            /* State: run active + no text → nothing (only stop button above) */
            null
          ) : (
            /* State: no active run → single arrow button */
            <button
              type="button"
              onClick={onSubmit}
              disabled={busy || disabled || submitDisabled}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white shadow-[0_2px_10px_rgba(107,138,254,0.28)] transition-all hover:bg-accent/90 active:translate-y-px active:shadow-none disabled:cursor-default disabled:bg-surface-card/60 disabled:text-text-subtle/50 disabled:shadow-none"
              aria-label={submitLabel}
              title={submitLabel}
            >
              {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconArrowUp size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* ── 5. Context / footer bar ───────────────────────────────────── */}
      {(footerHint || footerBadges) && (
        <div className="flex items-center gap-2 border-t border-border/20 px-3 py-1.5">
          {footerHint ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-text-subtle">
              <IconMessageForward size={11} className="shrink-0 text-accent/50" />
              <span className="truncate">{footerHint}</span>
            </span>
          ) : <div className="flex-1" />}
          {/* Keyboard shortcut hint */}
          <span className="shrink-0 text-[10px] text-text-subtle/35 hidden sm:flex items-center gap-1">
            <kbd className="rounded border border-border/30 bg-surface/60 px-1 py-px text-[9px] font-mono">⌘</kbd>
            <kbd className="rounded border border-border/30 bg-surface/60 px-1 py-px text-[9px] font-mono">↵</kbd>
          </span>
          {footerBadges && (
            <div className="flex shrink-0 items-center gap-1.5">
              {footerBadges}
            </div>
          )}
        </div>
      )}
      </div>
    </div>

    {/* ── Preview modal (images + text files) ─────────────────────── */}
    <Dialog open={previewItem !== null} onOpenChange={(open) => { if (!open) setPreviewItem(null); }}>
      <DialogContent
        className="max-w-4xl w-full p-0 overflow-hidden bg-surface-sidebar border-border"
        showClose={false}
      >
        {/* Header bar */}
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
          <span className="flex-1 truncate text-[13px] font-medium text-text">
            {previewItem?.filename}
          </span>
          <button
            type="button"
            onClick={() => setPreviewItem(null)}
            className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-surface-soft hover:text-text"
            aria-label="关闭预览"
          >
            <IconX size={15} />
          </button>
        </div>
        {/* Preview body */}
        <div className="max-h-[75vh] overflow-auto">
          {previewItem?.type === 'image' && (
            <div className="flex items-center justify-center p-4">
              <img
                src={previewItem.url}
                alt={previewItem.filename}
                className="max-h-[65vh] max-w-full object-contain rounded-lg"
              />
            </div>
          )}
          {previewItem?.type === 'text' && (
            <pre className="px-4 py-4 text-[12px] leading-[1.7] text-text-muted whitespace-pre-wrap break-words font-mono">
              {previewItem.content}
            </pre>
          )}
          {previewItem?.type === 'loading' && (
            <div className="flex h-32 items-center justify-center gap-2 text-text-muted">
              <IconLoader2 size={16} className="animate-spin text-accent/60" />
              <span className="text-sm">正在读取文件…</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
