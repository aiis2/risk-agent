import { useId, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAdjustments,
  IconCheck,
  IconChevronDown,
  IconCpu,
  IconSearch,
  IconTool,
  IconX,
} from '@tabler/icons-react';
import type { ModelConfigRecord, SessionAttachment, ToolSummary } from '../../api/client';
import { pickPreferredModel } from '../../lib/preferredModel';

interface RunComposerControlsProps {
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
  /** When true, attach button is hidden (parent renders it separately) */
  hideAttachButton?: boolean;
}

export function RunComposerControls({
  models,
  selectedModelId,
  onModelChange,
  tools,
  selectedToolIds,
  onToggleTool,
  attachments,
  onRemoveAttachment: _onRemoveAttachment,
  onSelectFiles,
  uploadingNames: _uploadingNames,
  attachmentError: _attachmentError,
  fileInputRef,
  hideAttachButton = false,
}: RunComposerControlsProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [activePanel, setActivePanel] = useState<'models' | 'tools' | null>(null);
  const [toolSearch, setToolSearch] = useState('');
  const selectedModel = pickPreferredModel(models, selectedModelId);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredTools = toolSearch.trim()
    ? tools.filter(
        (t) =>
          t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
          (t.description ?? '').toLowerCase().includes(toolSearch.toLowerCase()),
      )
    : tools;

  return (
    <div ref={containerRef} className="relative flex min-w-0 max-w-full items-center gap-1">
      {/* Hidden file input — always rendered so ref stays valid */}
      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        multiple
        aria-label={t('runComposerControls.uploadAttachment', '上传附件')}
        className="sr-only"
        onChange={(event) => {
          if (event.target.files?.length) {
            onSelectFiles(event.target.files);
          }
        }}
      />

      {/* Model selector */}
      <button
        type="button"
        onClick={() => setActivePanel((prev) => (prev === 'models' ? null : 'models'))}
        title={t('runComposerControls.selectModel', '选择模型')}
        className={`inline-flex min-w-0 max-w-[11rem] shrink items-center gap-1 overflow-hidden rounded-lg border px-2 py-1 text-[12px] transition-colors sm:max-w-[12.5rem] ${activePanel === 'models' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-transparent text-text-muted hover:border-border/50 hover:text-text'}`}
      >
        <IconCpu size={13} className={selectedModel ? 'text-accent/80 shrink-0' : 'shrink-0'} />
        <span className="min-w-0 flex-1 truncate font-medium">{selectedModel?.modelName ?? t('runComposerControls.selectModel', '选择模型')}</span>
        <IconChevronDown size={10} className={`shrink-0 transition-transform ${activePanel === 'models' ? 'rotate-180' : ''}`} />
      </button>

      {/* Tools selector — icon-only with badge count, or "自动" indicator when none selected */}
      <button
        type="button"
        onClick={() => setActivePanel((prev) => (prev === 'tools' ? null : 'tools'))}
        aria-label={selectedToolIds.length > 0
          ? t('runComposerControls.toolsButtonWithCount', '工具 {{count}}', { count: selectedToolIds.length })
          : t('runComposerControls.toolsAutoMode', '工具自动（全部可用）')}
        title={selectedToolIds.length > 0
          ? t('runComposerControls.toolsRestrictedTitle', '已限制 {{count}} 个工具（点击修改）', { count: selectedToolIds.length })
          : t('runComposerControls.toolsAutoTitle', 'Agent 自动选用工具 · 点击限制特定工具')}
        className={`relative inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[12px] transition-colors ${activePanel === 'tools' ? 'border-accent/40 bg-accent/10 text-accent' : selectedToolIds.length > 0 ? 'border-accent/20 bg-accent/6 text-accent' : 'border-transparent text-text-muted hover:border-border/50 hover:text-text'}`}
      >
        <IconAdjustments size={13} className="shrink-0" />
        {selectedToolIds.length > 0 ? (
          <span className="font-medium tabular-nums">{selectedToolIds.length}</span>
        ) : (
          <span className="font-medium opacity-60">{t('runComposerControls.toolsAutoLabel', '自动')}</span>
        )}
      </button>

      {/* Attach button — optional, parent may handle it via + button */}
      {!hideAttachButton && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title={attachments.length > 0
            ? t('runComposerControls.attachmentCountTitle', '{{count}} 个附件', { count: attachments.length })
            : t('runComposerControls.uploadAttachment', '上传附件')}
          className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[12px] transition-colors ${attachments.length > 0 ? 'border-accent/20 bg-accent/6 text-accent' : 'border-transparent text-text-muted hover:border-border/50 hover:text-text'}`}
        >
          <span>{attachments.length > 0
            ? t('runComposerControls.attachmentCountLabel', '{{count}} 附件', { count: attachments.length })
            : t('runComposerControls.attachments', '附件')}</span>
        </button>
      )}

      {/* Panel: Models */}
      {activePanel === 'models' && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-[0_16px_44px_rgba(0,0,0,0.24)] backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <IconCpu size={12} className="text-accent" />
                <p className="text-xs font-semibold text-text">{t('runComposerControls.modelConfig', '模型配置')}</p>
            </div>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              className="rounded-full p-0.5 text-text-subtle transition-colors hover:bg-surface-card hover:text-text"
              aria-label={t('runComposerControls.closeModelConfig', '关闭模型配置')}
            >
              <IconX size={12} />
            </button>
          </div>
          <div className="p-2">
            <div className="grid gap-0.5">
              {models.map((model) => {
                const selected = model.modelId === selectedModel?.modelId;
                const providerLabel = model.provider
                  ? model.provider.replace('openai-compatible', 'Custom').replace('openai', 'OpenAI').replace('anthropic', 'Anthropic').replace('google', 'Google')
                  : undefined;
                return (
                  <button
                    key={model.modelId}
                    type="button"
                    onClick={() => {
                      onModelChange(model.modelId);
                      setActivePanel(null);
                    }}
                    className={`flex min-w-0 w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? 'bg-accent/10 text-text' : 'text-text-muted hover:bg-surface-card/70 hover:text-text'}`}
                  >
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-accent/15 text-accent' : 'bg-surface-card text-text-subtle'}`}>
                      <IconCpu size={11} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium leading-tight">{model.modelName}</p>
                      {providerLabel && (
                        <p className="truncate text-[10px] text-text-subtle">{providerLabel}</p>
                      )}
                    </div>
                    {selected ? <IconCheck size={12} className="shrink-0 text-accent" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Panel: Tools */}
      {activePanel === 'tools' && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-xl border border-border bg-surface shadow-[0_16px_44px_rgba(0,0,0,0.24)] backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <IconAdjustments size={12} className="text-accent" />
              <p className="text-xs font-semibold text-text">{t('runComposerControls.toolAllowlist', '工具限制')}</p>
              {selectedToolIds.length > 0 ? (
                <span className="rounded-full border border-accent/25 bg-accent/10 px-1.5 py-px text-[10px] text-accent">{t('runComposerControls.selectedCount', '{{count}} 已选', { count: selectedToolIds.length })}</span>
              ) : (
                <span className="rounded-full border border-success/25 bg-success/8 px-1.5 py-px text-[10px] text-success/80">{t('runComposerControls.allToolsAuto', '自动 · 全部可用')}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setActivePanel(null); setToolSearch(''); }}
              className="rounded-full p-0.5 text-text-subtle transition-colors hover:bg-surface-card hover:text-text"
              aria-label={t('runComposerControls.closeToolAllowlist', '关闭工具限制面板')}
            >
              <IconX size={12} />
            </button>
          </div>
          {/* Hint: explain auto vs restricted */}
          <div className="border-b border-border/30 px-3 py-2">
            <p className="text-[11px] text-text-subtle leading-relaxed">
              {selectedToolIds.length > 0
                ? t('runComposerControls.toolRestrictedHint', 'Agent 本轮仅可使用已选工具。清空选择可恢复自动模式。')
                : t('runComposerControls.toolAutoHint', 'Agent 自动决定使用哪些工具。选择特定工具可限制本轮的工具范围。')}
            </p>
          </div>
          {/* Search */}
          <div className="border-b border-border/30 px-2 py-1.5">
            <div className="flex items-center gap-1.5 rounded-lg bg-surface-card/60 px-2 py-1">
              <IconSearch size={11} className="shrink-0 text-text-subtle" />
              <input
                type="text"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                placeholder={t('runComposerControls.searchTools', '搜索工具...')}
                className="flex-1 bg-transparent text-[12px] text-text placeholder:text-text-subtle outline-none"
              />
              {toolSearch && (
                <button type="button" onClick={() => setToolSearch('')} className="text-text-subtle hover:text-text" aria-label={t('runComposerControls.clearSearch', '清除搜索')}>
                  <IconX size={10} />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-2">
            {filteredTools.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-muted">
                {toolSearch ? t('runComposerControls.noMatchingTools', '没有匹配的工具') : t('runComposerControls.noAvailableTools', '没有可用工具')}
              </p>
            ) : (
              <div className="grid gap-0.5">
                {filteredTools.map((tool) => {
                  const selected = selectedToolIds.includes(tool.name);
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => onToggleTool(tool.name)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? 'bg-accent/10 text-text' : 'text-text-muted hover:bg-surface-card/70 hover:text-text'}`}
                    >
                      <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${selected ? 'bg-accent text-white' : 'border border-border bg-surface-card text-text-subtle'}`}>
                        {selected ? <IconCheck size={9} /> : <IconTool size={9} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium leading-tight">{tool.name}</p>
                        {tool.description && (
                          <p className="line-clamp-1 text-[10px] leading-4 text-text-subtle">{tool.description}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
