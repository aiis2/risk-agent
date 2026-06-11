import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  IconBolt,
  IconCircleCheck,
  IconCode,
  IconCopy,
  IconDownload,
  IconFileDescription,
  IconLoader2,
  IconServer,
  IconSparkles,
} from '@tabler/icons-react';
import {
  generateCapabilityTemplate,
  listCapabilityTemplates,
  type CapabilityTemplateBundle,
  type CapabilityTemplateDescriptor,
} from '../../../api/client';
import { ScrollArea } from '../../ui/ScrollArea';

const inputCls = 'h-10 w-full rounded-xl border border-border bg-surface-input px-3 py-2 text-sm text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none';

const TEMPLATE_ACCENT_CLASS: Record<CapabilityTemplateDescriptor['templateId'], string> = {
  'feishu-bot': 'bg-node-cyan/10 text-node-cyan',
  'dingtalk-bot': 'bg-accent/10 text-accent',
  'discord-bot': 'bg-node-lavender/10 text-node-lavender',
  'generic-webhook': 'bg-success/10 text-success',
  'mcp-server': 'bg-warn/10 text-warn',
};

function resolveDefaultName(template?: CapabilityTemplateDescriptor): string {
  if (!template) return 'generated-capability';
  switch (template.templateId) {
    case 'feishu-bot':
      return 'risk-feishu-bridge';
    case 'dingtalk-bot':
      return 'risk-dingtalk-bridge';
    case 'discord-bot':
      return 'risk-discord-bridge';
    case 'generic-webhook':
      return 'risk-webhook-bridge';
    case 'mcp-server':
      return 'risk-docs-mcp';
  }
}

function resolveDefaultFile(bundle?: CapabilityTemplateBundle): string | null {
  if (!bundle || bundle.files.length === 0) return null;
  return bundle.files.find((file) => file.purpose === 'program')?.path ?? bundle.files[0]?.path ?? null;
}

function downloadBundle(bundle: CapabilityTemplateBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `${bundle.capabilityName}.bundle.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the DOM-based copy path below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function CapabilityTemplateStudio() {
  const templatesQuery = useQuery({
    queryKey: ['capability-templates'],
    queryFn: listCapabilityTemplates,
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<CapabilityTemplateDescriptor['templateId'] | null>(null);
  const [capabilityName, setCapabilityName] = useState('generated-capability');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const templates = templatesQuery.data?.templates ?? [];
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.templateId === selectedTemplateId) ?? templates[0] ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) {
      setSelectedTemplateId(templates[0].templateId);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    setCapabilityName(resolveDefaultName(selectedTemplate ?? undefined));
  }, [selectedTemplate?.templateId]);

  const generateMutation = useMutation({
    mutationFn: async (payload: Parameters<typeof generateCapabilityTemplate>[0]) => generateCapabilityTemplate(payload),
    onSuccess: ({ bundle }) => {
      setSelectedFilePath(resolveDefaultFile(bundle));
    },
  });

  const bundle = generateMutation.data?.bundle;
  const activeFile = bundle?.files.find((file) => file.path === selectedFilePath) ?? bundle?.files[0] ?? null;

  async function handleCopyActiveFile() {
    if (!activeFile?.content) return;
    const didCopy = await copyText(activeFile.content);
    setCopied(didCopy);
    setCopyFailed(!didCopy);
    window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 1200);
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-card p-5 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-accent">
                <IconSparkles size={15} />
                <span className="text-[11px] uppercase tracking-[0.22em]">Capability Studio</span>
              </div>
              <h3 className="mt-2 text-xl font-semibold text-text">按模板生成可审阅的接入骨架包</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">
                这里直接请求 server API，生成 Feishu、钉钉、Discord 和 MCP 的骨架包。生成结果包含 manifest、环境变量约定、入口代码和后续接入建议。
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-text-subtle">Templates</p>
              <p className="mt-1 text-lg font-semibold text-text">{templates.length}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((template) => {
              const active = selectedTemplate?.templateId === template.templateId;
              return (
                <button
                  key={template.templateId}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.templateId)}
                  className={clsx(
                    'rounded-2xl border px-4 py-4 text-left transition-all duration-150',
                    active
                      ? 'border-accent/50 bg-accent/10 shadow-sm'
                      : 'border-border bg-surface hover:border-border hover:bg-surface-hover/70'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={clsx(
                        'mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10',
                        TEMPLATE_ACCENT_CLASS[template.templateId],
                      )}
                    >
                      {template.capabilityKind === 'mcp-server' ? <IconServer size={18} /> : <IconBolt size={18} />}
                    </div>
                    <span className="rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
                      {template.capabilityKind === 'mcp-server' ? 'MCP' : 'Connector'}
                    </span>
                  </div>

                  <p className="mt-4 text-sm font-semibold text-text">{template.title}</p>
                  <p className="mt-2 text-xs leading-5 text-text-muted">{template.description}</p>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div>
                <label htmlFor="capability-template-name" className="mb-2 block text-xs text-text-muted">Capability Name</label>
                <input
                  id="capability-template-name"
                  aria-label="Capability Name"
                  value={capabilityName}
                  onChange={(event) => setCapabilityName(event.target.value)}
                  className={inputCls}
                  placeholder="risk-docs-mcp"
                />
              </div>

              <button
                type="button"
                onClick={() => selectedTemplate && generateMutation.mutate({
                  templateId: selectedTemplate.templateId,
                  capabilityName,
                })}
                disabled={!selectedTemplate || !capabilityName.trim() || generateMutation.isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generateMutation.isPending ? <IconLoader2 size={15} className="animate-spin" /> : <IconSparkles size={15} />}
                生成骨架包
              </button>
            </div>

            {generateMutation.isError && (
              <div className="mt-3 rounded-2xl border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                生成失败，请检查 server API 是否可用。
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-rows-[auto_minmax(0,1fr)]">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-text-subtle">Latest Bundle</p>
                <p className="mt-1 text-lg font-semibold text-text">{bundle?.capabilityName ?? '等待生成'}</p>
                <p className="mt-2 text-sm leading-6 text-text-muted">{bundle?.description ?? '选择模板并输入名称后，会在这里展示返回的文件清单和代码内容。'}</p>
              </div>

              {bundle && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyActiveFile}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-card px-3 py-2 text-xs text-text-muted transition-colors hover:text-text"
                  >
                    {copied ? <IconCircleCheck size={13} /> : <IconCopy size={13} />}
                    {copied ? '已复制' : copyFailed ? '复制失败' : '复制文件'}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadBundle(bundle)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-card px-3 py-2 text-xs text-text-muted transition-colors hover:text-text"
                  >
                    <IconDownload size={13} /> 导出 JSON
                  </button>
                </div>
              )}
            </div>

            {bundle && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">Capability</p>
                  <p className="mt-2 text-sm text-text">{bundle.capabilityKind === 'mcp-server' ? 'MCP Server' : 'Connector'}</p>
                </div>
                <div className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">Files</p>
                  <p className="mt-2 text-sm text-text">{bundle.files.length}</p>
                </div>
                <div className="rounded-2xl border border-border-subtle bg-surface-card px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">Next Steps</p>
                  <p className="mt-2 text-sm text-text">{bundle.nextSteps.length}</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid min-h-[420px] gap-4 rounded-2xl border border-border bg-surface p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-border-subtle bg-surface-card p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-text-subtle">
                <IconFileDescription size={13} /> Bundle Files
              </div>
              <ScrollArea className="mt-3 h-[320px] pr-2">
                <div className="space-y-2">
                  {bundle?.files.map((file) => {
                    const active = file.path === activeFile?.path;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedFilePath(file.path)}
                        className={clsx(
                          'w-full rounded-2xl border px-3 py-2 text-left transition-colors',
                          active
                            ? 'border-accent/50 bg-accent/10 text-text'
                            : 'border-border-subtle bg-surface text-text-muted hover:border-border hover:text-text'
                        )}
                      >
                        <p className="text-xs font-medium">{file.path}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-text-subtle">{file.purpose}</p>
                      </button>
                    );
                  })}

                  {!bundle && (
                    <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-xs leading-5 text-text-muted">
                      生成后会在这里列出返回的文件。
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="grid gap-4 xl:grid-rows-[minmax(0,1fr)_auto]">
              <div className="rounded-2xl border border-border-subtle bg-surface-card p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-text-subtle">
                  <IconCode size={13} /> Preview
                </div>
                <ScrollArea className="mt-3 h-[320px] pr-2">
                  <pre className="whitespace-pre-wrap break-words rounded-2xl border border-border-subtle bg-surface p-4 text-xs leading-6 text-text-muted">
                    {activeFile?.content ?? '生成后会自动选中主程序文件并显示内容。'}
                  </pre>
                </ScrollArea>
              </div>

              <div className="rounded-2xl border border-border-subtle bg-surface-card p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-text-subtle">
                  <IconSparkles size={13} /> Review Checklist
                </div>
                <div className="mt-3 space-y-2">
                  {bundle?.nextSteps.map((step) => (
                    <div key={step} className="rounded-2xl border border-border-subtle bg-surface px-3 py-2 text-sm leading-6 text-text-muted">
                      {step}
                    </div>
                  ))}

                  {!bundle && (
                    <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-4 text-sm leading-6 text-text-muted">
                      这里会显示生成结果自带的接入建议，方便把骨架包继续接到审批、MCP 调试或连接器注册链路。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}