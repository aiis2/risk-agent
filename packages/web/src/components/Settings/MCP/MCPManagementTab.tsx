/**
 * MCPManagementTab — Cherry Studio style navigation
 *
 * Layout:
 *   Left  ── compact server list (name + URL + health dot + enable toggle)
 *   Right ── empty state  OR  inline-editable detail view with tabs (通用 | 工具)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconActivity,
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClockHour4,
  IconKey,
  IconLoader2,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTool,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  checkMCPHealth,
  createMCPServer,
  deleteMCPServer,
  getMCPTools,
  listMCPServers,
  refreshMCPTools,
  toggleMCPServer,
  updateMCPServer,
  type MCPServer,
  type MCPTool,
} from '../../../api/client';
import { Dialog, DialogContent, DialogClose } from '../../ui/Dialog';
import { Select, SelectItem } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { ScrollArea } from '../../ui/ScrollArea';
import { CapabilityTemplateStudio } from './CapabilityTemplateStudio';

// ─── Shared styles ──────────────────────────────────────────────────────────

const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface-input px-3 py-2 text-sm text-text placeholder:text-text-subtle transition-colors focus:border-accent/60 focus:outline-none';
const labelCls = 'mb-1.5 block text-xs font-medium text-text-muted';

// ─── API error extraction ────────────────────────────────────────────────────

/**
 * Extract a user-readable message from API errors.
 * Handles Zod validation 400 responses: `{ error: 'validation_failed', issues: [{path, message}] }`
 * as well as plain axios / Error instances.
 */
function extractApiErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  // Axios-style error with response body
  const axiosErr = error as { response?: { data?: { issues?: Array<{ path?: unknown[]; message?: string }>; message?: string } } };
  const data = axiosErr.response?.data;
  if (data) {
    if (Array.isArray(data.issues) && data.issues.length > 0) {
      return data.issues
        .map((issue) => {
          const path = Array.isArray(issue.path) && issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
          return `${path}${issue.message ?? ''}`;
        })
        .join('；');
    }
    if (typeof data.message === 'string' && data.message) {
      return data.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// ─── Health badge ────────────────────────────────────────────────────────────

function HealthBadge({ status }: { status: string }) {
  if (status === 'healthy')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <IconCircleCheck size={12} />
        Healthy
      </span>
    );
  if (status === 'degraded')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warn">
        <IconClockHour4 size={12} />
        Degraded
      </span>
    );
  if (status === 'unhealthy')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-danger">
        <IconCircleX size={12} />
        Unhealthy
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-subtle">
      <IconClockHour4 size={12} />
      Unknown
    </span>
  );
}

// ─── Form state ──────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  url: string;
  transport: 'http' | 'sse' | 'stream';
  description: string;
  timeoutMs: number;
  enabled: boolean;
  headers: { key: string; value: string }[];
  authType: 'none' | 'bearer' | 'basic' | 'apikey';
  authToken: string;
  authUser: string;
  authPass: string;
  authKey: string;
  authKeyIn: string;
  retryMax: number;
  retryDelay: number;
  retryMult: number;
}

function blankForm(): FormState {
  return {
    name: '', url: '', transport: 'http', description: '',
    timeoutMs: 30000, enabled: true,
    headers: [],
    authType: 'none', authToken: '', authUser: '', authPass: '', authKey: '', authKeyIn: 'header',
    retryMax: 3, retryDelay: 1000, retryMult: 2,
  };
}

function serverToForm(s: MCPServer): FormState {
  const authType = (s.auth?.type as FormState['authType']) ?? 'none';
  return {
    name: s.name, url: s.url, transport: s.transport, description: s.description,
    timeoutMs: s.timeoutMs, enabled: s.enabled,
    headers: Object.entries(s.headers ?? {}).map(([key, value]) => ({ key, value })),
    authType,
    authToken:  authType === 'bearer'  ? String(s.auth?.token ?? '')  : '',
    authUser:   authType === 'basic'   ? String(s.auth?.username ?? '') : '',
    authPass:   authType === 'basic'   ? String(s.auth?.password ?? '') : '',
    authKey:    authType === 'apikey'  ? String(s.auth?.key ?? '')     : '',
    authKeyIn:  authType === 'apikey'  ? String(s.auth?.keyIn ?? 'header') : 'header',
    retryMax:   Number((s.retryConfig as { maxRetries?: number } | null)?.maxRetries ?? 3),
    retryDelay: Number((s.retryConfig as { delayMs?: number } | null)?.delayMs ?? 1000),
    retryMult:  Number((s.retryConfig as { backoffMultiplier?: number } | null)?.backoffMultiplier ?? 2),
  };
}

function formToPayload(f: FormState): Partial<MCPServer> {
  const headersMap: Record<string, string> = {};
  for (const { key, value } of f.headers) {
    if (key.trim()) headersMap[key.trim()] = value;
  }
  let auth: Record<string, unknown> | null = null;
  if (f.authType === 'bearer') auth = { type: 'bearer', token: f.authToken };
  else if (f.authType === 'basic') auth = { type: 'basic', username: f.authUser, password: f.authPass };
  else if (f.authType === 'apikey') auth = { type: 'apikey', key: f.authKey, keyIn: f.authKeyIn };
  return {
    name: f.name, url: f.url, transport: f.transport, description: f.description,
    timeoutMs: f.timeoutMs, enabled: f.enabled,
    headers: headersMap, auth,
    retryConfig: { maxRetries: f.retryMax, delayMs: f.retryDelay, backoffMultiplier: f.retryMult },
  };
}

// ─── Collapsible section ─────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-hover/50"
      >
        <span>{title}</span>
        {open ? (
          <IconChevronDown size={14} className="text-text-muted" />
        ) : (
          <IconChevronRight size={14} className="text-text-muted" />
        )}
      </button>
      {open && <div className="border-t border-border-subtle px-4 py-4">{children}</div>}
    </div>
  );
}

// ─── General tab (inline form) ───────────────────────────────────────────────

type SetFn = <K extends keyof FormState>(k: K, v: FormState[K]) => void;

function GeneralTab({ form, set }: { form: FormState; set: SetFn }) {
  const addHeader = () => set('headers', [...form.headers, { key: '', value: '' }]);
  const removeHeader = (i: number) =>
    set('headers', form.headers.filter((_, idx) => idx !== i));
  const setHeader = (i: number, field: 'key' | 'value', val: string) =>
    set(
      'headers',
      form.headers.map((h, idx) => (idx === i ? { ...h, [field]: val } : h)),
    );

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}><span className="mr-0.5 text-danger">✱</span> 名称</label>
        <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="my-mcp-server" />
      </div>
      <div>
        <label className={labelCls}>URL</label>
        <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="http://localhost:3000" />
      </div>
      <div>
        <label className={labelCls}>描述</label>
        <input className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="可选描述" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>传输方式</label>
          <Select value={form.transport} onValueChange={(v) => set('transport', v as 'http' | 'sse' | 'stream')}>
            <SelectItem value="http">http</SelectItem>
            <SelectItem value="sse">sse</SelectItem>
            <SelectItem value="stream">stream</SelectItem>
          </Select>
        </div>
        <div>
          <label className={labelCls}>超时 (ms)</label>
          <input type="number" aria-label="超时毫秒" className={inputCls} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} min={1000} step={1000} />
        </div>
      </div>
      <CollapsibleSection title="认证配置">
        <div className="space-y-3">
          <Select value={form.authType} onValueChange={(v) => set('authType', v as FormState['authType'])}>
            <SelectItem value="none">无</SelectItem>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="basic">Basic Auth</SelectItem>
            <SelectItem value="apikey">API Key</SelectItem>
          </Select>
          {form.authType === 'bearer' && (
            <div className="relative">
              <IconKey size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input type="password" aria-label="Bearer Token" className={clsx(inputCls, 'pl-9')} value={form.authToken} onChange={(e) => set('authToken', e.target.value)} placeholder="Bearer token" />
            </div>
          )}
          {form.authType === 'basic' && (
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="用户名" placeholder="用户名" className={inputCls} value={form.authUser} onChange={(e) => set('authUser', e.target.value)} />
              <input type="password" aria-label="密码" placeholder="密码" className={inputCls} value={form.authPass} onChange={(e) => set('authPass', e.target.value)} />
            </div>
          )}
          {form.authType === 'apikey' && (
            <div className="grid grid-cols-2 gap-2">
              <input type="password" aria-label="API Key" placeholder="api-key" className={inputCls} value={form.authKey} onChange={(e) => set('authKey', e.target.value)} />
              <Select value={form.authKeyIn} onValueChange={(v) => set('authKeyIn', v)}>
                <SelectItem value="header">In Header</SelectItem>
                <SelectItem value="query">In Query</SelectItem>
              </Select>
            </div>
          )}
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="自定义请求头">
        <div className="space-y-2">
          {form.headers.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`请求头名称 ${i + 1}`} className={clsx(inputCls, 'flex-1')} value={h.key} onChange={(e) => setHeader(i, 'key', e.target.value)} placeholder="Header-Name" />
              <input aria-label={`请求头值 ${i + 1}`} className={clsx(inputCls, 'flex-1')} value={h.value} onChange={(e) => setHeader(i, 'value', e.target.value)} placeholder="value" />
              <button type="button" title="删除" aria-label="删除请求头" onClick={() => removeHeader(i)} className="shrink-0 text-text-subtle transition-colors hover:text-danger">
                <IconX size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={addHeader} className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text">
            <IconPlus size={12} /> 添加请求头
          </button>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="重试配置">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>最大重试</label>
            <input type="number" aria-label="最大重试次数" min={0} max={10} className={inputCls} value={form.retryMax} onChange={(e) => set('retryMax', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>延迟 (ms)</label>
            <input type="number" aria-label="重试延迟" min={100} step={100} className={inputCls} value={form.retryDelay} onChange={(e) => set('retryDelay', Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>退避倍数</label>
            <input type="number" aria-label="退避倍数" min={1} step={0.5} className={inputCls} value={form.retryMult} onChange={(e) => set('retryMult', Number(e.target.value))} />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ─── Tools tab ───────────────────────────────────────────────────────────────

function ToolsTab({ serverId }: { serverId: string }) {
  const tools = useQuery({ queryKey: ['mcp-tools', serverId], queryFn: () => getMCPTools(serverId) });
  const list = (tools.data ?? []) as MCPTool[];
  if (tools.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-subtle">
        <IconLoader2 size={18} className="mr-2 animate-spin" />
        <span className="text-sm">加载工具中…</span>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <IconTool size={28} className="mb-3 text-text-muted opacity-30" />
        <p className="text-sm font-medium text-text">暂无缓存工具</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">点击右上角 "刷新工具" 发现可用工具</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {list.map((tool) => (
        <div key={tool.name} className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm text-accent">{tool.name}</p>
              {tool.description && <p className="mt-1 text-xs leading-5 text-text-muted">{tool.description}</p>}
            </div>
            <span className="shrink-0 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-subtle">tool</span>
          </div>
          {tool.schema != null && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[0.12em] text-text-subtle hover:text-text-muted">Input Schema</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-surface-card p-2 text-[11px] leading-5 text-text-muted">{JSON.stringify(tool.schema, null, 2)}</pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Add-server dialog (new servers only) ────────────────────────────────────

interface AddServerDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (serverId: string) => void;
}

function AddServerDialog({ open, onClose, onSaved }: AddServerDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());

  useEffect(() => {
    if (open) setForm(blankForm());
  }, [open]);

  const set = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K]) =>
      setForm((prev) => ({ ...prev, [k]: v })),
    [],
  );

  const createMut = useMutation({
    mutationFn: () => createMCPServer(formToPayload(form)),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['mcp'] });
      onSaved(data.serverId);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title="添加 MCP 服务器"
        description="配置传输方式、URL 和鉴权信息以连接 MCP 服务器。"
        className="max-h-[80vh] max-w-lg overflow-y-auto"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}><span className="mr-0.5 text-danger">✱</span> 名称</label>
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="my-mcp-server" />
            </div>
            <div>
              <label className={labelCls}><span className="mr-0.5 text-danger">✱</span> URL</label>
              <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="http://localhost:3000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>传输方式</label>
              <Select value={form.transport} onValueChange={(v) => set('transport', v as 'http' | 'sse' | 'stream')}>
                <SelectItem value="http">http</SelectItem>
                <SelectItem value="sse">sse</SelectItem>
                <SelectItem value="stream">stream</SelectItem>
              </Select>
            </div>
            <div>
              <label className={labelCls}>超时 (ms)</label>
              <input type="number" aria-label="超时毫秒" className={inputCls} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} min={1000} step={1000} />
            </div>
          </div>
          <div>
            <label className={labelCls}>描述</label>
            <input className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="可选描述" />
          </div>
          {createMut.isError && (
            <p className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
              {extractApiErrorMessage(createMut.error, '创建失败')}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <DialogClose asChild>
              <button type="button" className="px-4 py-1.5 text-sm text-text-muted transition-colors hover:text-text">取消</button>
            </DialogClose>
            <button
              type="button"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.name.trim() || !form.url.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createMut.isPending ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlus size={13} />}
              保存
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

type DetailTab = 'general' | 'tools';

export function MCPManagementTab() {
  const qc = useQueryClient();

  const servers = useQuery({ queryKey: ['mcp'], queryFn: listMCPServers });

  const deleteMut = useMutation({
    mutationFn: deleteMCPServer,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp'] });
      setSelectedServerId(null);
      setForm(blankForm());
    },
  });
  const toggleMut = useMutation({
    mutationFn: toggleMCPServer,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mcp'] }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MCPServer> }) =>
      updateMCPServer(id, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mcp'] }),
  });
  const healthMut = useMutation({
    mutationFn: checkMCPHealth,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mcp'] }),
  });
  const refreshMut = useMutation({
    mutationFn: refreshMCPTools,
    onSuccess: (_data, serverId) => {
      void qc.invalidateQueries({ queryKey: ['mcp'] });
      void qc.invalidateQueries({ queryKey: ['mcp-tools', serverId] });
    },
  });

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('general');
  const [form, setForm] = useState<FormState>(blankForm());

  const list = (servers.data ?? []) as MCPServer[];
  const selectedServer = list.find((s) => s.serverId === selectedServerId) ?? null;
  const isFormValid = form.name.trim().length > 0 && form.url.trim().length > 0;
  const hasUnsavedChanges = selectedServer != null
    && JSON.stringify(formToPayload(form)) !== JSON.stringify(formToPayload(serverToForm(selectedServer)));

  // Reset form when switching to a different server
  const prevIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedServerId === prevIdRef.current) return;
    prevIdRef.current = selectedServerId;
    if (selectedServerId) {
      const server = list.find((s) => s.serverId === selectedServerId);
      if (server) setForm(serverToForm(server));
    }
  }, [selectedServerId, list]);

  const set = useCallback(
    <K extends keyof FormState>(k: K, v: FormState[K]) =>
      setForm((prev) => ({ ...prev, [k]: v })),
    [],
  );

  const handleSave = () => {
    if (!selectedServer) return;
    updateMut.mutate({ id: selectedServer.serverId, data: formToPayload(form) });
  };

  const handleDelete = () => {
    if (!selectedServer) return;
    if (window.confirm(`确认删除服务器 "${selectedServer.name}"？`)) {
      deleteMut.mutate(selectedServer.serverId);
    }
  };

  const toolCount = selectedServer?.toolCount ?? 0;

  return (
    <div className="space-y-4">
      {/* ── Main two-column panel ── */}
      <section className="grid min-h-[680px] overflow-hidden rounded-2xl border border-border bg-surface-card xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* LEFT: compact server list */}
        <aside className="flex flex-col border-b border-border bg-surface xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
            <div className="flex items-center gap-2">
              <IconServer size={14} className="text-accent" />
              <span className="text-sm font-semibold text-text">MCP 服务器</span>
              {list.length > 0 && (
                <span className="rounded-full border border-border bg-surface-card px-2 py-0.5 text-[10px] text-text-muted">{list.length}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAddDialogOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              <IconPlus size={12} /> 添加
            </button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-0.5 p-2">
              {servers.isLoading && (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-subtle">
                  <IconLoader2 size={12} className="animate-spin" /> 加载中…
                </div>
              )}
              {!servers.isLoading && list.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <IconServer size={22} className="mb-3 text-text-subtle opacity-30" />
                  <p className="text-xs font-medium text-text">暂无服务器</p>
                  <p className="mt-1 text-[11px] leading-5 text-text-muted">点击 "添加" 开始配置</p>
                </div>
              )}
              {list.map((server) => {
                const active = server.serverId === selectedServerId;
                return (
                  <div
                    key={server.serverId}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setSelectedServerId(server.serverId); setDetailTab('general'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedServerId(server.serverId); setDetailTab('general'); } }}
                    className={clsx(
                      'group w-full cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      active ? 'bg-accent/10' : 'hover:bg-surface-hover',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className={clsx('min-w-0 flex-1 truncate text-sm font-medium', active ? 'text-accent' : 'text-text')}>
                        {server.name}
                      </p>
                      <div className="shrink-0" onClick={(e) => { e.stopPropagation(); toggleMut.mutate(server.serverId); }}>
                        <Switch checked={server.enabled} onCheckedChange={() => {}} />
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {server.healthStatus === 'healthy' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />}
                      {server.healthStatus === 'unhealthy' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />}
                      {server.healthStatus === 'degraded' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
                      <span className={clsx('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em]', active ? 'bg-accent/15 text-accent' : 'bg-surface-card text-text-subtle')}>
                        {server.transport}
                      </span>
                      {server.toolCount > 0 && <span className="text-[10px] text-text-subtle">{server.toolCount} tools</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Studio trigger button */}
          <div className="shrink-0 border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text"
            >
              <IconServer size={12} /> 模板生成工作台
            </button>
          </div>
        </aside>

        {/* RIGHT: detail view or empty state */}
        <section className="flex min-w-0 flex-col">
          {selectedServer ? (
            <>
              {/* Detail header */}
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedServerId(null)}
                    aria-label="返回列表"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-accent/40 hover:text-text"
                  >
                    <IconArrowLeft size={14} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-text">{selectedServer.name}</h3>
                      <span className="rounded border border-border bg-surface-card px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-text-muted">{selectedServer.transport}</span>
                      <HealthBadge status={selectedServer.healthStatus} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-text-subtle">{selectedServer.url}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => healthMut.mutate(selectedServer.serverId)}
                    disabled={healthMut.isPending || hasUnsavedChanges}
                    aria-label="测试连接"
                    title={hasUnsavedChanges ? '请先保存后再测试' : '测试连接'}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-50"
                  >
                    <IconActivity size={13} className={clsx(healthMut.isPending && 'animate-pulse')} />
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshMut.mutate(selectedServer.serverId)}
                    disabled={refreshMut.isPending || hasUnsavedChanges}
                    aria-label="刷新工具"
                    title={hasUnsavedChanges ? '请先保存后再刷新工具' : '刷新工具'}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-accent/40 hover:text-text disabled:opacity-50"
                  >
                    <IconRefresh size={13} className={clsx(refreshMut.isPending && 'animate-spin')} />
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    aria-label="删除服务器"
                    title="删除服务器"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-danger/30 text-danger/60 transition-colors hover:border-danger/60 hover:text-danger"
                  >
                    <IconTrash size={13} />
                  </button>
                  <Switch
                    checked={form.enabled}
                    aria-label="启用服务器"
                    disabled={updateMut.isPending || !isFormValid}
                    onCheckedChange={(v) => {
                      const nextForm = { ...form, enabled: v };
                      setForm(nextForm);
                      updateMut.mutate({ id: selectedServer.serverId, data: formToPayload(nextForm) });
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={updateMut.isPending || !isFormValid}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updateMut.isPending && <IconLoader2 size={12} className="animate-spin" />}
                    保存
                  </button>
                </div>
              </div>

              {updateMut.isSuccess && (
                <div className="mx-5 mt-3 flex items-center gap-1.5 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-xs text-success">
                  <IconCircleCheck size={12} /> 已保存
                </div>
              )}
              {updateMut.isError && (
                <div className="mx-5 mt-3 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {extractApiErrorMessage(updateMut.error, '保存失败')}
                </div>
              )}

              {/* Tabs */}
              <div className="flex border-b border-border px-5">
                {(
                  [
                    { key: 'general', label: '通用' },
                    { key: 'tools', label: toolCount > 0 ? `工具 (${toolCount})` : '工具' },
                  ] as { key: DetailTab; label: string }[]
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDetailTab(key)}
                    className={clsx(
                      '-mb-px border-b-2 px-4 py-3 text-sm transition-colors',
                      detailTab === key ? 'border-accent font-medium text-accent' : 'border-transparent text-text-muted hover:text-text',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="p-5">
                  {detailTab === 'general' && <GeneralTab form={form} set={set} />}
                  {detailTab === 'tools' && <ToolsTab serverId={selectedServer.serverId} />}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex min-h-[680px] flex-col items-center justify-center px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-text-subtle">
                <IconServer size={22} />
              </div>
              <p className="mt-4 text-base font-semibold text-text">选择服务器查看详情</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-text-muted">
                从左侧选择一个 MCP 服务器，即可在此配置连接参数、鉴权信息，并浏览缓存的工具列表。
              </p>
              <button
                type="button"
                onClick={() => setAddDialogOpen(true)}
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/15"
              >
                <IconPlus size={14} /> 添加服务器
              </button>
            </div>
          )}
        </section>
      </section>

      {/* Capability Template Studio Modal */}
      <Dialog open={studioOpen} onOpenChange={setStudioOpen}>
        <DialogContent showClose className="max-w-5xl overflow-hidden border border-border bg-surface-card p-0 text-text">
          <div className="max-h-[80vh] overflow-y-auto p-5">
            <CapabilityTemplateStudio />
          </div>
        </DialogContent>
      </Dialog>

      <AddServerDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSaved={(serverId) => {
          setAddDialogOpen(false);
          setSelectedServerId(serverId);
          setDetailTab('general');
        }}
      />
    </div>
  );
}




