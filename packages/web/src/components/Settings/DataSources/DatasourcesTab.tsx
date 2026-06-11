/**
 * DatasourcesTab — 数据源配置管理（完整实现）。
 *
 * 功能：
 *  - 按 sourceType 显示差异化配置表单（api/web/git/db/file/mcp）
 *  - 测试连通性（POST /api/datasources/:id/test）
 *  - 查看数据库表结构（GET /api/datasources/:id/schema，db 类型）
 *  - 内联编辑（PUT /api/datasources/:id）
 *  - 健康状态徽章
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  IconLink,
  IconPlus,
  IconTrash,
  IconRefresh,
  IconDatabase,
  IconPlugConnected,
  IconPlugConnectedX,
  IconCode,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconCheck,
  IconX,
} from '@tabler/icons-react';
import { clsx } from 'clsx';
import {
  createDataSource,
  deleteDataSource,
  getDataSourceKnowledge,
  getDataSourceSchema,
  getDataSourcesHealth,
  listDataSources,
  rebuildDataSourceKnowledge,
  searchDataSourceKnowledge,
  testDataSource,
  updateDataSource,
  type DataSource,
  type DataSourceKnowledgeSearchHit,
  type DataSourceKnowledgeSummary,
  type DbSchemaTable,
} from '../../../api/client';
import { Select, SelectItem } from '../../ui/Select';
import { Switch } from '../../ui/Switch';

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputCls =
  'w-full h-8 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent/50 transition-colors';
const btnPrimaryCls =
  'flex items-center gap-1.5 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent rounded-lg text-sm transition-colors';
const btnGhostCls =
  'flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-surface-soft transition-colors';

// ─── Type badge ──────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  api: 'bg-accent/15 text-accent',
  web: 'bg-accent/15 text-accent',
  git: 'bg-warn/15 text-warn',
  db: 'bg-success/15 text-success',
  file: 'bg-warn/15 text-warn',
  mcp: 'bg-node-cyan/15 text-node-cyan',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium uppercase', TYPE_COLORS[type] ?? 'bg-border text-text-dim')}>
      {type}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'unhealthy' | 'unknown' | 'testing';

function StatusBadge({ status, latencyMs }: { status: HealthStatus; latencyMs?: number }) {
  if (status === 'testing') return (
    <span className="flex items-center gap-1 text-warn text-xs"><IconRefresh size={11} className="animate-spin" />Testing...</span>
  );
  if (status === 'healthy') return (
    <span className="flex items-center gap-1 text-success text-xs">
      <IconPlugConnected size={11} />OK{latencyMs != null ? ` ${latencyMs}ms` : ''}
    </span>
  );
  if (status === 'unhealthy') return (
    <span className="flex items-center gap-1 text-danger text-xs"><IconPlugConnectedX size={11} />Failed</span>
  );
  return <span className="text-text-muted text-xs">—</span>;
}

// ─── Type-specific config fields ─────────────────────────────────────────────

interface ConfigFieldsProps {
  type: DataSource['sourceType'];
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

function ConfigFields({ type, config, onChange }: ConfigFieldsProps) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const str = (key: string) => (config[key] as string) ?? '';

  if (type === 'api' || type === 'web') return (
    <div className="space-y-2">
      <FieldRow label="Base URL" required>
        <input value={str('baseUrl')} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.example.com" aria-label="Base URL" className={inputCls} />
      </FieldRow>
      <FieldRow label="Headers (JSON)">
        <input value={str('headers')} onChange={(e) => set('headers', e.target.value)} placeholder='{"Authorization":"Bearer ..."}' aria-label="Headers" className={inputCls} />
      </FieldRow>
    </div>
  );

  if (type === 'git') return (
    <div className="space-y-2">
      <FieldRow label="Repository URL" required>
        <input value={str('url')} onChange={(e) => set('url', e.target.value)} placeholder="https://github.com/org/repo.git" aria-label="Repository URL" className={inputCls} />
      </FieldRow>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Branch">
          <input value={str('branch')} onChange={(e) => set('branch', e.target.value)} placeholder="main" aria-label="Branch" className={inputCls} />
        </FieldRow>
        <FieldRow label="Token">
          <input type="password" value={str('token')} onChange={(e) => set('token', e.target.value)} placeholder="ghp_..." aria-label="Access Token" className={inputCls} />
        </FieldRow>
      </div>
    </div>
  );

  if (type === 'db') return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="DB Type" required>
          <Select value={(config['dbType'] as string) ?? 'mysql'} onValueChange={(v) => set('dbType', v)}>
            <SelectItem value="mysql">MySQL</SelectItem>
            <SelectItem value="doris">Doris</SelectItem>
            <SelectItem value="postgresql">PostgreSQL</SelectItem>
          </Select>
        </FieldRow>
        <FieldRow label="Database" required>
          <input value={str('database')} onChange={(e) => set('database', e.target.value)} placeholder="my_db" aria-label="Database Name" className={inputCls} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Host" required>
          <input value={str('host')} onChange={(e) => set('host', e.target.value)} placeholder="localhost" aria-label="Host" className={inputCls} />
        </FieldRow>
        <FieldRow label="Port">
          <input type="number" value={str('port')} onChange={(e) => set('port', e.target.value)} placeholder="3306" aria-label="Port" className={inputCls} />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FieldRow label="Username">
          <input value={str('username')} onChange={(e) => set('username', e.target.value)} placeholder="root" aria-label="Username" className={inputCls} />
        </FieldRow>
        <FieldRow label="Password">
          <input type="password" value={str('password')} onChange={(e) => set('password', e.target.value)} placeholder="••••••" aria-label="Password" className={inputCls} />
        </FieldRow>
      </div>
    </div>
  );

  if (type === 'file') return (
    <div className="space-y-2">
      <FieldRow label="File Path" required>
        <input value={str('filePath')} onChange={(e) => set('filePath', e.target.value)} placeholder="/data/rules.json" aria-label="File Path" className={inputCls} />
      </FieldRow>
      <FieldRow label="Encoding">
        <Select value={(config['encoding'] as string) ?? 'utf-8'} onValueChange={(v) => set('encoding', v)}>
          <SelectItem value="utf-8">UTF-8</SelectItem>
          <SelectItem value="gbk">GBK</SelectItem>
          <SelectItem value="latin1">Latin-1</SelectItem>
        </Select>
      </FieldRow>
    </div>
  );

  if (type === 'mcp') return (
    <div className="space-y-2">
      <FieldRow label="MCP Server URL" required>
        <input value={str('url')} onChange={(e) => set('url', e.target.value)} placeholder="http://localhost:3000" aria-label="MCP Server URL" className={inputCls} />
      </FieldRow>
      <FieldRow label="Tool Name">
        <input value={str('toolName')} onChange={(e) => set('toolName', e.target.value)} placeholder="my_tool" aria-label="Tool Name" className={inputCls} />
      </FieldRow>
    </div>
  );

  return null;
}

function FieldRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-text-muted">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Schema Viewer ────────────────────────────────────────────────────────────

function SchemaViewer({ tables }: { tables: DbSchemaTable[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  if (tables.length === 0) return <p className="text-xs text-text-muted py-2">No tables found.</p>;

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden text-xs">
      {tables.map((table) => (
        <div key={table.name} className="border-t border-border-subtle first:border-t-0">
          <button
            onClick={() => toggle(table.name)}
            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-surface-soft transition-colors"
          >
            {expanded.has(table.name) ? <IconChevronDown size={12} className="text-text-muted" /> : <IconChevronRight size={12} className="text-text-muted" />}
            <span className="text-text font-medium">{table.name}</span>
            {table.comment && <span className="text-text-muted text-[10px]">{table.comment}</span>}
            <span className="ml-auto text-text-muted">{table.columns.length} cols</span>
          </button>
          {expanded.has(table.name) && (
            <div className="bg-surface px-3 pb-2">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Column', 'Type', 'Nullable'].map((h) => (
                      <th key={h} className="text-left py-1 pr-3 text-text-muted font-medium text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.columns.map((col) => (
                    <tr key={col.name} className="border-t border-border-subtle/30">
                      <td className="py-1 pr-3 text-accent">{col.name}</td>
                      <td className="py-1 pr-3 text-text-dim font-mono">{col.type}</td>
                      <td className="py-1 text-text-muted">{col.nullable ? 'YES' : 'NO'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── DataSource Row ───────────────────────────────────────────────────────────

function DataSourceRow({ ds, healthMap }: { ds: DataSource; healthMap: Map<string, { healthy: boolean; latencyMs: number }> }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editConfig, setEditConfig] = useState<Record<string, unknown>>(ds.config);
  const [editName, setEditName] = useState(ds.name);
  const [editEnabled, setEditEnabled] = useState(ds.enabled);
  const [testStatus, setTestStatus] = useState<HealthStatus>('unknown');
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaTables, setSchemaTables] = useState<DbSchemaTable[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeSummary, setKnowledgeSummary] = useState<DataSourceKnowledgeSummary | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string>();
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeHits, setKnowledgeHits] = useState<DataSourceKnowledgeSearchHit[]>([]);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const [testMsg, setTestMsg] = useState<string>();

  const health = healthMap.get(ds.sourceId);
  const displayStatus: HealthStatus = testStatus !== 'unknown' ? testStatus : health ? (health.healthy ? 'healthy' : 'unhealthy') : 'unknown';

  const delDS = useMutation({ mutationFn: () => deleteDataSource(ds.sourceId), onSuccess: () => qc.invalidateQueries({ queryKey: ['ds'] }) });
  const saveDS = useMutation({
    mutationFn: () => updateDataSource(ds.sourceId, { name: editName, config: editConfig, enabled: editEnabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ds'] }); setEditing(false); },
  });

  const handleTest = async () => {
    setTestStatus('testing');
    setTestMsg(undefined);
    try {
      const r = await testDataSource(ds.sourceId);
      setTestStatus(r.healthy ? 'healthy' : 'unhealthy');
      setTestMsg(r.message);
    } catch {
      setTestStatus('unhealthy');
      setTestMsg('connection failed');
    }
  };

  const handleSchema = async () => {
    if (schemaOpen) { setSchemaOpen(false); return; }
    setSchemaLoading(true);
    setSchemaOpen(true);
    try {
      const r = await getDataSourceSchema(ds.sourceId);
      setSchemaTables(r.tables);
    } catch { setSchemaTables([]); }
    setSchemaLoading(false);
  };

  const handleKnowledgeToggle = async () => {
    if (knowledgeOpen) {
      setKnowledgeOpen(false);
      return;
    }
    setKnowledgeOpen(true);
    setKnowledgeLoading(true);
    setKnowledgeError(undefined);
    try {
      const summary = await getDataSourceKnowledge(ds.sourceId);
      setKnowledgeSummary(summary);
    } catch {
      setKnowledgeSummary(null);
      setKnowledgeHits([]);
      setKnowledgeError('尚未构建数据源知识资产');
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const handleKnowledgeRebuild = async () => {
    setKnowledgeLoading(true);
    setKnowledgeError(undefined);
    try {
      const summary = await rebuildDataSourceKnowledge(ds.sourceId);
      setKnowledgeSummary(summary);
      setKnowledgeOpen(true);
      if (knowledgeQuery.trim()) {
        const result = await searchDataSourceKnowledge(ds.sourceId, knowledgeQuery.trim(), 6);
        setKnowledgeHits(result.hits);
      } else {
        setKnowledgeHits([]);
      }
      qc.invalidateQueries({ queryKey: ['ds'] });
    } catch {
      setKnowledgeError('知识资产构建失败');
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const handleKnowledgeSearch = async () => {
    if (!knowledgeQuery.trim()) return;
    setKnowledgeSearching(true);
    setKnowledgeError(undefined);
    try {
      const result = await searchDataSourceKnowledge(ds.sourceId, knowledgeQuery.trim(), 6);
      setKnowledgeHits(result.hits);
    } catch {
      setKnowledgeHits([]);
      setKnowledgeError('知识检索失败，请先构建知识资产');
    } finally {
      setKnowledgeSearching(false);
    }
  };

  return (
    <div className="border-t border-border-subtle first:border-t-0">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface-card/50 transition-colors">
        {/* Status */}
        <div className="w-24 shrink-0">
          <StatusBadge status={displayStatus} latencyMs={testStatus !== 'unknown' ? undefined : health?.latencyMs} />
          {testMsg && <p className="text-[10px] text-text-muted truncate max-w-[90px]" title={testMsg}>{testMsg}</p>}
        </div>

        {/* Name / Type */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className={clsx(inputCls, 'h-7 text-xs')} aria-label="Edit name" />
          ) : (
            <p className="text-sm text-text font-medium truncate">{ds.name}</p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <TypeBadge type={ds.sourceType} />
            <span className="text-[10px] text-text-muted">{ds.sourceId.slice(0, 8)}…</span>
          </div>
        </div>

        {/* Config summary (non-edit) */}
        {!editing && (
          <div className="hidden lg:block flex-1 min-w-0">
            <p className="text-xs text-text-muted truncate">
              {(ds.config['baseUrl'] ?? ds.config['url'] ?? ds.config['host'] ?? ds.config['filePath'] ?? '') as string}
            </p>
          </div>
        )}

        {/* Enabled */}
        <div className="shrink-0">
          {editing ? (
            <Switch checked={editEnabled} onCheckedChange={setEditEnabled} aria-label="Enable datasource" />
          ) : (
            <span className={clsx('text-[10px]', ds.enabled ? 'text-success' : 'text-text-muted')}>
              {ds.enabled ? 'enabled' : 'disabled'}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {editing ? (
            <>
              <button className={clsx(btnGhostCls, 'text-success')} onClick={() => saveDS.mutate()}>
                <IconCheck size={12} />Save
              </button>
              <button className={clsx(btnGhostCls, 'text-text-muted')} onClick={() => setEditing(false)} title="Cancel">
                <IconX size={12} />
              </button>
            </>
          ) : (
            <>
              <button className={clsx(btnGhostCls, 'text-text-dim')} onClick={handleTest} title="Test connection">
                <IconPlugConnected size={12} />Test
              </button>
              {ds.sourceType === 'db' && (
                <button className={clsx(btnGhostCls, 'text-text-dim')} onClick={handleSchema} title="View schema">
                  <IconCode size={12} />Schema
                </button>
              )}
              <button className={clsx(btnGhostCls, knowledgeOpen ? 'text-accent' : 'text-text-dim')} onClick={handleKnowledgeToggle} title="Data source knowledge">
                <IconDatabase size={12} />Knowledge
              </button>
              <button className={clsx(btnGhostCls, 'text-text-dim')} onClick={() => { setEditing(true); setEditConfig(ds.config); setEditName(ds.name); setEditEnabled(ds.enabled); }}>
                <IconEdit size={12} />Edit
              </button>
              <button className={clsx(btnGhostCls, 'text-danger')} onClick={() => delDS.mutate()} title="Delete">
                <IconTrash size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Edit config panel */}
      {editing && (
        <div className="px-4 pb-3 bg-surface">
          <ConfigFields type={ds.sourceType} config={editConfig} onChange={setEditConfig} />
        </div>
      )}

      {/* Schema viewer */}
      {schemaOpen && ds.sourceType === 'db' && (
        <div className="px-4 pb-3 bg-surface">
          <div className="flex items-center gap-2 mb-2">
            <IconDatabase size={12} className="text-success" />
            <span className="text-xs text-text-dim">Database Schema</span>
          </div>
          {schemaLoading ? (
            <p className="text-xs text-text-muted">Loading schema...</p>
          ) : (
            <SchemaViewer tables={schemaTables} />
          )}
        </div>
      )}

      {knowledgeOpen && (
        <div className="px-4 pb-3 bg-surface">
          <div className="rounded-xl border border-border-subtle bg-surface-sidebar p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <IconDatabase size={12} className="text-accent" />
                  <span className="text-xs font-semibold text-text">Data Source Knowledge</span>
                </div>
                <p className="mt-1 text-[11px] text-text-muted">为当前数据源维护独立 graph 与 vector 资产，供 Agent 快速定位表、字段、端点与配置线索。</p>
              </div>
              <button className={clsx(btnGhostCls, 'text-accent')} onClick={handleKnowledgeRebuild}>
                <IconRefresh size={12} className={knowledgeLoading ? 'animate-spin' : ''} />
                {knowledgeSummary ? 'Rebuild' : 'Build'}
              </button>
            </div>

            {knowledgeLoading && <p className="text-xs text-text-muted">Building knowledge assets...</p>}

            {!knowledgeLoading && knowledgeSummary && (
              <div className="grid gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Nodes</p>
                  <p className="mt-1 text-sm text-text">{knowledgeSummary.nodeCount}</p>
                </div>
                <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Edges</p>
                  <p className="mt-1 text-sm text-text">{knowledgeSummary.edgeCount}</p>
                </div>
                <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Docs</p>
                  <p className="mt-1 text-sm text-text">{knowledgeSummary.documentCount}</p>
                </div>
                <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">Built At</p>
                  <p className="mt-1 text-sm text-text truncate" title={knowledgeSummary.builtAt}>{knowledgeSummary.builtAt}</p>
                </div>
              </div>
            )}

            {!knowledgeLoading && knowledgeSummary && (
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={knowledgeQuery}
                  onChange={(e) => setKnowledgeQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleKnowledgeSearch();
                    }
                  }}
                  placeholder={ds.sourceType === 'db' ? '搜索字段、表名、注释，例如：支付渠道 / order_id' : '搜索端点、URL、配置关键词'}
                  className={inputCls}
                  aria-label="Search datasource knowledge"
                />
                <button className={clsx(btnPrimaryCls, knowledgeSearching && 'opacity-60')} onClick={handleKnowledgeSearch} disabled={knowledgeSearching || !knowledgeQuery.trim()}>
                  <IconCode size={13} />Search
                </button>
              </div>
            )}

            {knowledgeSummary && (
              <div className="text-[11px] text-text-muted space-y-1">
                <p>Graph: <span className="text-text-dim font-mono">{knowledgeSummary.graphName}</span></p>
                <p>Collection: <span className="text-text-dim font-mono">{knowledgeSummary.vectorCollection}</span></p>
              </div>
            )}

            {knowledgeHits.length > 0 && (
              <div className="space-y-2">
                {knowledgeHits.map((hit) => (
                  <div key={hit.documentId} className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-text">{hit.title}</span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-dim">{hit.documentType}</span>
                      <span className="text-[10px] text-text-muted">score {hit.score.toFixed(2)}</span>
                    </div>
                    <p className="mt-1 text-xs text-text-dim whitespace-pre-wrap break-words">{hit.excerpt}</p>
                  </div>
                ))}
              </div>
            )}

            {knowledgeError && <p className="text-xs text-danger">{knowledgeError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New DataSource Form ──────────────────────────────────────────────────────

function NewDSForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', sourceType: 'api' as DataSource['sourceType'], enabled: true });
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const addDS = useMutation({
    mutationFn: () => createDataSource({ name: form.name, sourceType: form.sourceType, config, enabled: form.enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ds'] }); onDone(); },
  });

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3 mb-4">
      <p className="text-xs font-semibold text-text-dim uppercase tracking-wide">New Data Source</p>
      <div className="grid grid-cols-3 gap-3">
        <FieldRow label="Name" required>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-datasource" aria-label="Data Source Name" className={inputCls} />
        </FieldRow>
        <FieldRow label="Type" required>
          <Select value={form.sourceType} onValueChange={(v) => { setForm({ ...form, sourceType: v as DataSource['sourceType'] }); setConfig({}); }}>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="web">Web</SelectItem>
            <SelectItem value="git">Git</SelectItem>
            <SelectItem value="db">Database</SelectItem>
            <SelectItem value="file">File</SelectItem>
            <SelectItem value="mcp">MCP</SelectItem>
          </Select>
        </FieldRow>
        <FieldRow label="Enabled">
          <div className="h-8 flex items-center">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} aria-label="Enable new datasource" />
          </div>
        </FieldRow>
      </div>
      <ConfigFields type={form.sourceType} config={config} onChange={setConfig} />
      <div className="flex gap-2 pt-1">
        <button className={btnPrimaryCls} onClick={() => addDS.mutate()} disabled={!form.name}>
          <IconPlus size={13} />Create
        </button>
        <button className={clsx(btnGhostCls, 'text-text-muted')} onClick={onDone}>
          <IconX size={13} />Cancel
        </button>
      </div>
      {addDS.isError && <p className="text-xs text-danger">Create failed. Check inputs.</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DatasourcesTab() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const ds = useQuery({ queryKey: ['ds'], queryFn: listDataSources });
  const health = useQuery({ queryKey: ['ds-health'], queryFn: getDataSourcesHealth, refetchInterval: 60_000 });

  const healthMap = new Map<string, { healthy: boolean; latencyMs: number }>(
    (health.data ?? []).map((h) => [h.sourceId, { healthy: h.healthy, latencyMs: h.latencyMs }])
  );

  const sources = (ds.data ?? []) as DataSource[];

  return (
    <section className="bg-surface-card border border-border-subtle rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <IconLink size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">{t('settings.datasources')}</h2>
          <span className="text-xs text-text-muted">({sources.length})</span>
        </div>
        <button className={btnPrimaryCls} onClick={() => setShowForm((v) => !v)}>
          <IconPlus size={13} />{t('common.create')}
        </button>
      </div>

      {showForm && <NewDSForm onDone={() => setShowForm(false)} />}

      {ds.isLoading && <p className="text-xs text-text-muted py-4 text-center">Loading...</p>}

      {sources.length > 0 && (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[96px_1fr_1fr_80px_180px] gap-3 px-4 py-2 bg-surface text-[10px] font-medium text-text-muted uppercase tracking-wide">
            <span>Status</span>
            <span>Name</span>
            <span className="hidden lg:block">Endpoint</span>
            <span>State</span>
            <span>Actions</span>
          </div>
          {sources.map((d) => (
            <DataSourceRow key={d.sourceId} ds={d} healthMap={healthMap} />
          ))}
        </div>
      )}

      {!ds.isLoading && sources.length === 0 && !showForm && (
        <div className="text-center py-8 text-text-muted">
          <IconLink size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No data sources configured</p>
          <p className="text-xs mt-1">Add an API, database, Git repo, or file source</p>
        </div>
      )}
    </section>
  );
}
