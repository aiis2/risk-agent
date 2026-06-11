/**
 * SkillsTab — 技能管理标签页
 * 参考 tools-skills-system.md §6 三层技能体系
 *
 * 展示：
 *  - 技能来源徽章（bundled / directory / mcp / ai-generated / dynamic / conditional）
 *  - Cherry 风格左侧技能目录 + 右侧详情工作台
 *  - 技能包 ZIP / 文件夹导入
 */

import { type ChangeEvent, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBolt,
  IconBook2,
  IconChevronLeft,
  IconBrain,
  IconCircleCheck,
  IconCircleX,
  IconCode,
  IconCopy,
  IconFileDescription,
  IconFileZip,
  IconFolder,
  IconFolderOpen,
  IconGitBranch,
  IconLink,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconWand,
  IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import {
  createSkill,
  deleteSkill,
  getSkillFile,
  getSkillTree,
  importSkillPackage,
  installSkillFromUrl,
  listSkills,
  testSkill,
} from '../../../api/client';
import { Dialog, DialogContent, DialogDescription, DialogTitle, ScrollArea, Switch } from '../../ui';
import { readSkillPackageFromFolder, readSkillPackageFromZip } from './skillPackage';

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  bundled: { label: '内置', className: 'bg-accent/15 text-accent' },
  directory: { label: '目录', className: 'bg-success/15 text-success' },
  mcp: { label: 'MCP', className: 'bg-warn/15 text-warn' },
  'ai-generated': { label: 'AI生成', className: 'bg-accent/15 text-accent' },
  dynamic: { label: '动态', className: 'bg-success/15 text-success' },
  conditional: { label: '条件', className: 'bg-warn/15 text-warn' },
};

const SOURCE_ICON: Record<string, ReactNode> = {
  bundled: <IconBook2 size={11} />,
  directory: <IconFolder size={11} />,
  mcp: <IconGitBranch size={11} />,
  'ai-generated': <IconWand size={11} />,
  dynamic: <IconBolt size={11} />,
  conditional: <IconCode size={11} />,
};

function CreateSkillDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', content: '' });
  const [error, setError] = useState('');

  const doCreate = useMutation({
    mutationFn: () => createSkill(form),
    onSuccess: () => {
      onCreated();
      onClose();
      setForm({ name: '', description: '', content: '' });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent showClose={false} className="max-w-lg overflow-hidden border border-border bg-surface-card p-0 text-text">
        <div className="flex items-start gap-2 border-b border-border px-5 py-3.5">
          <IconWand size={15} className="text-accent" />
          <div className="flex-1">
            <DialogTitle className="text-sm font-semibold text-text">创建自定义技能</DialogTitle>
            <DialogDescription className="mt-1 text-[11px] leading-5 text-text-muted">
              填写名称、描述和 Markdown 内容，创建一个可本地测试的技能。
            </DialogDescription>
          </div>
          <button onClick={onClose} title="关闭" className="text-text-subtle transition-colors hover:text-text-muted">
            <IconX size={14} />
          </button>
        </div>

        <div className="space-y-3.5 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">
              技能名称 <span className="text-danger">*</span>
            </label>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="my-custom-skill"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 font-mono text-xs text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none"
            />
            <p className="mt-0.5 text-[10px] text-text-subtle">仅允许小写字母、数字、短横线和下划线</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">
              描述 <span className="text-danger">*</span>
            </label>
            <input
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="技能的功能描述…"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">
              技能内容 (Markdown) <span className="text-danger">*</span>
            </label>
            <textarea
              value={form.content}
              onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
              placeholder={'# 技能名称\n\n技能使用说明和执行步骤…'}
              rows={8}
              className="w-full resize-y rounded-lg border border-border bg-surface-input px-3 py-2 font-mono text-xs text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none"
            />
            <p className="mt-0.5 text-[10px] text-text-subtle">支持 Markdown 格式。内容会经过安全扫描。</p>
          </div>

          {error && (
            <div className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">
              <IconCircleX size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text">
            取消
          </button>
          <button
            onClick={() => {
              setError('');
              doCreate.mutate();
            }}
            disabled={!form.name.trim() || !form.description.trim() || !form.content.trim() || doCreate.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {doCreate.isPending ? <IconLoader2 size={12} className="animate-spin" /> : <IconPlus size={12} />}
            创建技能
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SkillTestResult = { success: boolean; output?: string; error?: string } | null;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败';
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  }
}

function InstallSkillFromUrlDialog({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: (skillName: string) => void | Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setUrl('');
      setName('');
      setOverwrite(false);
      setError('');
    }
  }, [open]);

  const installMut = useMutation({
    mutationFn: () => installSkillFromUrl(url.trim(), name.trim() || undefined, overwrite),
    onSuccess: async (result) => {
      await onInstalled(result.data.name);
      onClose();
      setUrl('');
      setName('');
      setOverwrite(false);
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent showClose={false} className="max-w-lg overflow-hidden border border-border bg-surface-card p-0 text-text">
        <div className="flex items-start gap-2 border-b border-border px-5 py-3.5">
          <IconLink size={15} className="text-accent" />
          <div className="flex-1">
            <DialogTitle className="text-sm font-semibold text-text">从 URL 安装技能</DialogTitle>
            <DialogDescription className="mt-1 text-[11px] leading-5 text-text-muted">
              输入远程 SKILL.md 地址，前端会调用后端现有安装接口并执行安全扫描。
            </DialogDescription>
          </div>
          <button onClick={onClose} title="关闭" className="text-text-subtle transition-colors hover:text-text-muted">
            <IconX size={14} />
          </button>
        </div>

        <div className="space-y-3.5 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">
              远程地址 <span className="text-danger">*</span>
            </label>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/skills/my-skill/SKILL.md"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">技能名称（可选）</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="留空则按 URL 自动推导"
              className="w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-xs text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-text">允许覆盖同名技能</p>
              <p className="mt-1 text-[10px] leading-5 text-text-subtle">如果目标技能已存在，则用远程内容替换本地版本。</p>
            </div>
            <Switch checked={overwrite} onCheckedChange={setOverwrite} aria-label="允许覆盖同名技能" />
          </div>

          {error && (
            <div className="flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-[11px] text-danger">
              <IconCircleX size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text">
            取消
          </button>
          <button
            onClick={() => {
              setError('');
              installMut.mutate();
            }}
            disabled={!url.trim() || installMut.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {installMut.isPending ? <IconLoader2 size={12} className="animate-spin" /> : <IconLink size={12} />}
            安装技能
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsTabContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [skillSearch, setSkillSearch] = useState('');
  const deferredSkillSearch = useDeferredValue(skillSearch.trim());
  const [createOpen, setCreateOpen] = useState(false);
  const [installFromUrlOpen, setInstallFromUrlOpen] = useState(false);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SkillTestResult>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const folderPickerProps = { webkitdirectory: 'true', directory: 'true' } as Record<string, string>;

  const skills = useQuery({
    queryKey: ['skills', deferredSkillSearch],
    queryFn: () => listSkills(deferredSkillSearch ? { q: deferredSkillSearch } : undefined),
  });

  const deleteSkillMut = useMutation({
    mutationFn: deleteSkill,
    onSuccess: async (_, deletedName) => {
      if (selectedSkillName === deletedName) {
        setSelectedSkillName(null);
        setSelectedFilePath(null);
        setTestResult(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const testSkillMut = useMutation({
    mutationFn: testSkill,
    onSuccess: (result) =>
      setTestResult({
        success: true,
        output: result?.data?.output ?? '测试通过',
      }),
    onError: (error: Error) => setTestResult({ success: false, error: error.message }),
  });

  const importZipMut = useMutation({
    mutationFn: async (file: File) => importSkillPackage(await readSkillPackageFromZip(file)),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      setSelectedSkillName(result.data.name);
      setSelectedFilePath('SKILL.md');
    },
  });

  const importFolderMut = useMutation({
    mutationFn: async (files: FileList) => importSkillPackage(await readSkillPackageFromFolder(files)),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['skills'] });
      setSelectedSkillName(result.data.name);
      setSelectedFilePath('SKILL.md');
    },
  });

  const skillList = skills.data?.data ?? [];
  const filteredSkills = skillList;
  const selectedSkill = skillList.find((skill) => skill.name === selectedSkillName) ?? null;

  useEffect(() => {
    if (filteredSkills.length === 0) {
      setSelectedSkillName(null);
      setSelectedFilePath(null);
      return;
    }
    if (selectedSkillName && !filteredSkills.some((skill) => skill.name === selectedSkillName)) {
      setSelectedSkillName(null);
      setSelectedFilePath(null);
    }
  }, [filteredSkills, selectedSkillName]);

  useEffect(() => {
    setTestResult(null);
  }, [selectedSkillName]);

  const skillTree = useQuery({
    queryKey: ['skill-tree', selectedSkillName],
    queryFn: () => getSkillTree(selectedSkillName!),
    enabled: Boolean(selectedSkillName && selectedSkill?.path),
  });

  const fileEntries = useMemo(
    () => (skillTree.data ?? []).filter((entry) => entry.type === 'file'),
    [skillTree.data]
  );
  const directoryEntries = useMemo(
    () => (skillTree.data ?? []).filter((entry) => entry.type === 'directory'),
    [skillTree.data]
  );

  useEffect(() => {
    if (!selectedSkill?.path) {
      setSelectedFilePath(null);
      return;
    }
    if (fileEntries.length === 0) {
      setSelectedFilePath(null);
      return;
    }
    if (!selectedFilePath || !fileEntries.some((entry) => entry.path === selectedFilePath)) {
      const preferred = fileEntries.find((entry) => entry.path === 'SKILL.md') ?? fileEntries[0];
      setSelectedFilePath(preferred.path);
    }
  }, [fileEntries, selectedFilePath, selectedSkill?.path]);

  const skillFile = useQuery({
    queryKey: ['skill-file', selectedSkillName, selectedFilePath],
    queryFn: () => getSkillFile(selectedSkillName!, selectedFilePath!),
    enabled: Boolean(selectedSkillName && selectedFilePath && selectedSkill?.path),
  });

  const importError = importZipMut.error ?? importFolderMut.error;
  const importing = importZipMut.isPending || importFolderMut.isPending;
  const selectedBadge = selectedSkill ? SOURCE_BADGE[selectedSkill.source] ?? SOURCE_BADGE.bundled : SOURCE_BADGE.bundled;
  const selectedIcon = selectedSkill ? SOURCE_ICON[selectedSkill.source] ?? SOURCE_ICON.bundled : SOURCE_ICON.bundled;

  function invalidateSkills() {
    void queryClient.invalidateQueries({ queryKey: ['skills'] });
  }

  async function handleInstalledSkill(skillName: string) {
    await queryClient.invalidateQueries({ queryKey: ['skills'] });
    setSelectedSkillName(skillName);
    setSelectedFilePath('SKILL.md');
  }

  function triggerZipImport() {
    zipInputRef.current?.click();
  }

  function triggerFolderImport() {
    folderInputRef.current?.click();
  }

  function handleZipInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    importZipMut.mutate(file);
    event.target.value = '';
  }

  function handleFolderInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    importFolderMut.mutate(files);
    event.target.value = '';
  }

  function confirmDeleteSelectedSkill() {
    if (!selectedSkill || !(selectedSkill.source === 'directory' || selectedSkill.source === 'ai-generated')) return;
    if (window.confirm(`确认删除技能 "${selectedSkill.name}"？`)) {
      deleteSkillMut.mutate(selectedSkill.name);
    }
  }

  return (
    <div className="space-y-4">
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        title="导入技能 ZIP"
        aria-label="导入技能 ZIP"
        onChange={handleZipInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        title="导入技能目录"
        aria-label="导入技能目录"
        onChange={handleFolderInputChange}
        {...folderPickerProps}
      />

      {(importing || importError || testResult) && (
        <section className="space-y-3">
          {(importing || importError) && (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${importError ? 'border-danger/20 bg-danger/10 text-danger' : 'border-accent/20 bg-accent/10 text-accent'}`}>
              {importError ? readErrorMessage(importError) : '正在导入技能包，请稍候…'}
            </div>
          )}

          {testResult && (
            <div className={`rounded-2xl border px-4 py-3 text-sm ${testResult.success ? 'border-success/20 bg-success/10 text-success' : 'border-danger/20 bg-danger/10 text-danger'}`}>
              <div className="flex items-start gap-2">
                {testResult.success ? <IconCircleCheck size={14} className="mt-0.5 shrink-0" /> : <IconCircleX size={14} className="mt-0.5 shrink-0" />}
                <div>
                  <p className="font-medium">{testResult.success ? '测试通过' : '测试失败'}</p>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] leading-6">{testResult.success ? testResult.output ?? '测试通过' : testResult.error}</pre>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-2xl border border-border bg-surface-card">
          <div className="border-b border-border px-4 py-4">
            {selectedSkill ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSkillName(null);
                    setSelectedFilePath(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text"
                >
                  <IconChevronLeft size={13} /> 已安装技能
                </button>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-text">{selectedSkill.name}</h3>
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${selectedBadge.className}`}>
                        {selectedIcon}{selectedBadge.label}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-text-muted">{selectedSkill.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border-subtle bg-surface px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">Files</p>
                    <p className="mt-1 text-sm font-semibold text-text">{fileEntries.length}</p>
                  </div>
                  <div className="rounded-xl border border-border-subtle bg-surface px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">Dirs</p>
                    <p className="mt-1 text-sm font-semibold text-text">{directoryEntries.length}</p>
                  </div>
                  <div className="rounded-xl border border-border-subtle bg-surface px-2 py-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">Version</p>
                    <p className="mt-1 truncate text-sm font-semibold text-text">{selectedSkill.version ?? '—'}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTestResult(null);
                      testSkillMut.mutate(selectedSkill.name);
                    }}
                    disabled={testSkillMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                  >
                    {testSkillMut.isPending ? <IconLoader2 size={12} className="animate-spin" /> : <IconPlayerPlay size={12} />}
                    测试
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(selectedSkill.name)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                  >
                    <IconCopy size={12} /> 复制名称
                  </button>
                  {(selectedSkill.source === 'directory' || selectedSkill.source === 'ai-generated') && (
                    <button
                      type="button"
                      onClick={confirmDeleteSelectedSkill}
                      disabled={deleteSkillMut.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
                    >
                      <IconTrash size={12} /> 删除
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-text-subtle">Skills</p>
                    <h3 className="mt-2 text-lg font-semibold text-text">已安装 ({skillList.length})</h3>
                    <p className="mt-2 text-xs leading-5 text-text-muted">按安装视角浏览技能，选中后左侧切换为文件树。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                    aria-label="新建技能"
                  >
                    <IconPlus size={14} />
                  </button>
                </div>

                <div className="relative mt-4">
                  <IconSearch size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
                  <input
                    aria-label="筛选已安装技能"
                    value={skillSearch}
                    onChange={(event) => setSkillSearch(event.target.value)}
                    placeholder="搜索已安装技能…"
                    className="w-full rounded-lg border border-border-subtle bg-surface-input py-2 pl-8 pr-3 text-xs text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                  />
                </div>
              </>
            )}
          </div>

          <ScrollArea className="h-[560px] px-3 py-3">
            {selectedSkill ? (
              <div className="space-y-2">
                {selectedSkill.path && (
                  <p className="truncate rounded-xl border border-border-subtle bg-surface px-3 py-2 font-mono text-[11px] text-text-subtle">{selectedSkill.path}</p>
                )}
                {selectedSkill.path ? (
                  <div className="space-y-1.5">
                    {skillTree.isLoading && (
                      <div className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-3 text-xs text-text-subtle">
                        <IconLoader2 size={12} className="animate-spin" /> 加载文件列表…
                      </div>
                    )}
                    {(skillTree.data ?? []).map((entry) => entry.type === 'directory' ? (
                      <div key={entry.path} className="flex items-center gap-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs text-text-subtle">
                        <IconFolder size={12} /> {entry.path}
                      </div>
                    ) : (
                      <button
                        key={entry.path}
                        type="button"
                        onClick={() => setSelectedFilePath(entry.path)}
                        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${selectedFilePath === entry.path ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border-subtle bg-surface text-text-muted hover:border-border hover:bg-surface-hover hover:text-text'}`}
                      >
                        <IconFileDescription size={12} /> {entry.path}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-center text-text-muted">
                    <IconFolder size={22} className="mb-3 opacity-40" />
                    <p className="text-sm font-medium text-text">当前技能没有本地目录</p>
                    <p className="mt-1 max-w-[220px] text-xs leading-5 text-text-muted">只有带本地路径的技能才会显示文件导航。</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {skills.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-text-subtle">
                    <IconLoader2 size={12} className="animate-spin" /> 加载技能…
                  </div>
                )}

                {!skills.isLoading && filteredSkills.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-6 text-center text-text-muted">
                    <p className="text-sm font-medium text-text">{skillSearch ? '未找到匹配技能' : t('common.empty', '暂无技能')}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">可以新建技能，或者直接导入 ZIP / 文件夹技能包。</p>
                  </div>
                )}

                {filteredSkills.map((skill) => {
                  const active = skill.name === selectedSkillName;
                  const badge = SOURCE_BADGE[skill.source] ?? SOURCE_BADGE.bundled;
                  const icon = SOURCE_ICON[skill.source] ?? SOURCE_ICON.bundled;

                  return (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() => setSelectedSkillName(skill.name)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${active ? 'border-accent/40 bg-accent/10' : 'border-border-subtle bg-surface hover:border-border hover:bg-surface-hover/70'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text">{skill.name}</p>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{skill.description}</p>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${badge.className}`}>
                          {icon}{badge.label}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-1">
                          {skill.tags?.slice(0, 2).map((tag) => (
                            <span key={tag} className="rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] text-text-subtle">
                              {tag}
                            </span>
                          ))}
                        </div>
                        {skill.version && <span className="text-[10px] uppercase tracking-[0.14em] text-text-subtle">v{skill.version}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-border px-3 py-3">
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setInstallFromUrlOpen(true)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
              >
                <IconLink size={12} /> 从 URL 安装
              </button>
              <button
                type="button"
                onClick={triggerZipImport}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
              >
                <IconFileZip size={12} /> 从 ZIP 文件安装
              </button>
              <button
                type="button"
                onClick={triggerFolderImport}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
              >
                <IconFolderOpen size={12} /> 从文件夹安装
              </button>
            </div>
          </div>
        </aside>

        <section className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-surface-card">
          {/* Right panel header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <IconBrain size={14} className="text-accent" />
              <span className="text-sm font-semibold text-text">技能</span>
              {selectedSkill && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${selectedBadge.className}`}>
                  {selectedIcon}{selectedBadge.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-56">
                <IconSearch size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
                <input
                  aria-label="搜索技能"
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  placeholder="发现更多技能..."
                  className="w-full rounded-lg border border-border bg-surface-input py-1.5 pl-7 pr-3 text-xs text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setInstallFromUrlOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
              >
                <IconLink size={12} /> 从 URL 安装
              </button>
            </div>
          </div>
          {!selectedSkill ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-text-muted">
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-accent/20 bg-accent/10 text-accent">
                <IconBrain size={22} />
              </div>
              <p className="mt-5 text-lg font-semibold text-text">未选择技能</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">从左侧选择一个已安装技能，或者直接安装新的技能包。选中后这里会显示文件内容预览。</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setInstallFromUrlOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                >
                  <IconLink size={12} /> 从 URL 安装
                </button>
                <button
                  type="button"
                  onClick={triggerZipImport}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                >
                  <IconFileZip size={12} /> 从 ZIP 文件安装
                </button>
                <button
                  type="button"
                  onClick={triggerFolderImport}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                >
                  <IconFolderOpen size={12} /> 从文件夹安装
                </button>
              </div>
            </div>
          ) : selectedSkill.path ? (
            <div className="flex flex-1 flex-col">
              <div className="border-b border-border bg-surface-card px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-text-muted">{selectedFilePath ?? selectedSkill.name}</p>
                  {selectedFilePath && (
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(skillFile.data?.content ?? '')}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                    >
                      <IconCopy size={12} /> 复制
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 p-4">
                <div className="h-full rounded-2xl border border-border-subtle bg-surface p-4">
                  {skillFile.isLoading ? (
                    <div className="flex items-center gap-2 text-xs text-text-subtle">
                      <IconLoader2 size={12} className="animate-spin" /> 加载文件内容…
                    </div>
                  ) : skillFile.data ? (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                        <span>{skillFile.data.path}</span>
                        <span>{skillFile.data.encoding}</span>
                      </div>
                      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-all text-[11px] leading-6 text-text-muted">{skillFile.data.content}</pre>
                    </>
                  ) : (
                    <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-text-subtle">
                      <IconFileDescription size={26} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium text-text">选择一个文件开始预览</p>
                      <p className="mt-1 text-xs leading-5 text-text-muted">默认会优先选中 SKILL.md，随后你可以切换到其它文件。</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-text-muted">
              <IconUpload size={28} className="mb-3 opacity-40" />
              <p className="text-base font-semibold text-text">当前技能没有可预览的本地文件</p>
              <p className="mt-1 max-w-md text-sm leading-6 text-text-muted">导入目录型技能后，即可在这里浏览和复制文件内容。</p>
            </div>
          )}
        </section>
      </section>

      <CreateSkillDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={invalidateSkills} />
      <InstallSkillFromUrlDialog
        open={installFromUrlOpen}
        onClose={() => setInstallFromUrlOpen(false)}
        onInstalled={handleInstalledSkill}
      />
    </div>
  );
}
