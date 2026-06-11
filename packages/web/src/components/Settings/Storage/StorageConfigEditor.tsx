/**
 * StorageConfigEditor — Form/JSON 双模式存储配置编辑器
 * settings-center-ui.md §3.3 · settings-center-frontend-mapping.md §5.5
 * 默认 Form Mode，提供「切换到 JSON」入口
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconAlertTriangle, IconCode, IconForms,
  IconChevronDown,
} from '@tabler/icons-react';
import { clsx } from 'clsx';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

interface StorageScope {
  backend: string;
  url?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  bucket?: string;
  pool?: { max?: number };
}

interface ScopeConfig {
  structured: StorageScope;
  vector:     StorageScope;
  graph:      StorageScope;
  object:     StorageScope;
}

function toScopeConfig(raw: Record<string, unknown>): ScopeConfig {
  const s = (raw.structured ?? {}) as StorageScope;
  const v = (raw.vector ?? {}) as StorageScope;
  const g = (raw.graph ?? {}) as StorageScope;
  const o = (raw.object ?? {}) as StorageScope;
  return { structured: s, vector: v, graph: g, object: o };
}

function fromScopeConfig(cfg: ScopeConfig): Record<string, unknown> {
  // 清理空字段，使 JSON 更整洁
  function clean(obj: StorageScope): Record<string, unknown> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined));
  }
  return {
    structured: clean(cfg.structured),
    vector:     clean(cfg.vector),
    graph:      clean(cfg.graph),
    object:     clean(cfg.object),
  };
}

// ─── Form Mode 子组件 ─────────────────────────────────────────────────────────

const inputCls = 'w-full text-xs rounded-md border border-border-subtle bg-surface-sidebar text-text px-2.5 py-1.5 outline-none focus:border-accent/60 placeholder-text-muted transition-colors';

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
      <label className="text-[10px] text-text-muted font-medium uppercase tracking-wide">{label}</label>
      <div>{children}</div>
    </div>
  );
}

interface ScopeSectionProps {
  title: string;
  scope: StorageScope;
  backendOptions: string[];
  onChange: (updated: StorageScope) => void;
}

function ScopeSection({ title, scope, backendOptions, onChange }: ScopeSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const backend = scope.backend ?? '';

  return (
    <div className="rounded-lg border border-border-subtle overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center justify-between w-full px-3 py-2 bg-surface text-left hover:bg-surface-soft transition-colors"
      >
        <span className="text-xs font-semibold text-text capitalize">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono">{backend || '—'}</span>
          <IconChevronDown
            size={12}
            className={clsx('text-text-muted transition-transform', expanded ? 'rotate-180' : '')}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-3 py-2.5 space-y-2 bg-surface-card">
          {/* Backend */}
          <FieldRow label="Backend">
            <select
              aria-label={`${title} backend`}
              value={backend}
              onChange={(e) => onChange({ ...scope, backend: e.target.value })}
              className={inputCls + ' appearance-none cursor-pointer'}
            >
              {backendOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </FieldRow>

          {/* URL / Connection String */}
          {(backend === 'sqlite' || backend === 'postgresql' || backend === 'lancedb' ||
            backend === 'milvus' || backend === 'qdrant' || backend === 'neo4j') && (
            <FieldRow label={backend === 'postgresql' || backend === 'neo4j' ? 'URL' : 'Path/URL'}>
              <input
                value={scope.url ?? ''}
                onChange={(e) => onChange({ ...scope, url: e.target.value })}
                placeholder={
                  backend === 'postgresql' ? 'postgresql://user:pass@host:5432/db' :
                  backend === 'neo4j'     ? 'bolt://neo4j.host:7687' :
                  backend === 'milvus'    ? 'milvus.host:19530' :
                  backend === 'lancedb'   ? './risk_agent_data/data/lance' :
                                           './risk_agent_data/data/risk_agent.db'
                }
                className={inputCls}
              />
            </FieldRow>
          )}

          {/* Object storage extras (minio / s3 / oss) */}
          {(backend === 'minio' || backend === 's3' || backend === 'oss') && (
            <>
              <FieldRow label="Endpoint">
                <input value={scope.endpoint ?? ''} onChange={(e) => onChange({ ...scope, endpoint: e.target.value })}
                  placeholder="http://localhost:9000" className={inputCls} />
              </FieldRow>
              <FieldRow label="Bucket">
                <input value={scope.bucket ?? ''} onChange={(e) => onChange({ ...scope, bucket: e.target.value })}
                  placeholder="risk-agent" className={inputCls} />
              </FieldRow>
              <FieldRow label="AccessKey">
                <input value={scope.accessKey ?? ''} onChange={(e) => onChange({ ...scope, accessKey: e.target.value })}
                  placeholder="minioadmin" className={inputCls} />
              </FieldRow>
              <FieldRow label="SecretKey">
                <input type="password" value={scope.secretKey ?? ''} onChange={(e) => onChange({ ...scope, secretKey: e.target.value })}
                  placeholder="minioadmin" className={inputCls} />
              </FieldRow>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

type EditMode = 'form' | 'json';

interface Props {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>, isValid: boolean) => void;
}

export function StorageConfigEditor({ value, onChange }: Props) {
  const [mode, setMode] = useState<EditMode>('form');
  const [formCfg, setFormCfg] = useState<ScopeConfig>(() => toScopeConfig(value));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const prevValue = useRef(value);

  // 外部 value 变化（切换模板）时同步
  useEffect(() => {
    if (prevValue.current === value) return;
    prevValue.current = value;
    setFormCfg(toScopeConfig(value));
    setJsonText(JSON.stringify(value, null, 2));
    setJsonError(null);
  }, [value]);

  // Form Mode 变化回调
  const handleFormScopeChange = useCallback((scope: keyof ScopeConfig, updated: StorageScope) => {
    setFormCfg((prev) => {
      const next = { ...prev, [scope]: updated };
      const raw = fromScopeConfig(next);
      setJsonText(JSON.stringify(raw, null, 2));
      onChange(raw, true);
      return next;
    });
  }, [onChange]);

  // JSON Mode 变化回调
  const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    setJsonText(raw);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setJsonError(null);
      setFormCfg(toScopeConfig(parsed));
      onChange(parsed, true);
    } catch {
      setJsonError('JSON 格式错误');
      onChange(value, false);
    }
  }, [onChange, value]);

  // 切换模式时同步状态
  const handleModeSwitch = useCallback((m: EditMode) => {
    if (m === 'json') {
      setJsonText(JSON.stringify(fromScopeConfig(formCfg), null, 2));
      setJsonError(null);
    } else {
      // json → form: 只在 JSON 有效时切换
      try {
        setFormCfg(toScopeConfig(JSON.parse(jsonText)));
        setJsonError(null);
      } catch {
        // 保留 json error，不强制切换
        return;
      }
    }
    setMode(m);
  }, [formCfg, jsonText]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted uppercase tracking-wide font-medium flex-1">配置编辑器</span>

        {/* Mode Toggle */}
        <div className="flex items-center rounded-md border border-border-subtle overflow-hidden">
          <button
            type="button"
            onClick={() => handleModeSwitch('form')}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
              mode === 'form'
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:text-text-dim hover:bg-surface-soft'
            )}
          >
            <IconForms size={11} />
            表单
          </button>
          <div className="w-px h-4 bg-border-subtle" />
          <button
            type="button"
            onClick={() => handleModeSwitch('json')}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors',
              mode === 'json'
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:text-text-dim hover:bg-surface-soft'
            )}
          >
            <IconCode size={11} />
            JSON
          </button>
        </div>

        {jsonError && mode === 'json' && (
          <span className="flex items-center gap-1 text-danger text-[10px]">
            <IconAlertTriangle size={11} />
            {jsonError}
          </span>
        )}
      </div>

      {/* Form Mode */}
      {mode === 'form' && (
        <div className="space-y-2">
          <ScopeSection
            title="Structured"
            scope={formCfg.structured}
            backendOptions={['sqlite', 'postgresql', 'mysql']}
            onChange={(s) => handleFormScopeChange('structured', s)}
          />
          <ScopeSection
            title="Vector"
            scope={formCfg.vector}
            backendOptions={['lancedb', 'milvus', 'qdrant', 'chroma']}
            onChange={(s) => handleFormScopeChange('vector', s)}
          />
          <ScopeSection
            title="Graph"
            scope={formCfg.graph}
            backendOptions={['graphology', 'neo4j']}
            onChange={(s) => handleFormScopeChange('graph', s)}
          />
          <ScopeSection
            title="Object"
            scope={formCfg.object}
            backendOptions={['local', 's3', 'minio', 'oss']}
            onChange={(s) => handleFormScopeChange('object', s)}
          />
        </div>
      )}

      {/* JSON Mode */}
      {mode === 'json' && (
        <textarea
          value={jsonText}
          onChange={handleJsonChange}
          spellCheck={false}
          className={clsx(
            'w-full h-64 font-mono text-xs rounded-lg border px-3 py-2.5 resize-y bg-surface-sidebar outline-none transition-colors',
            'text-text placeholder-text-muted',
            jsonError
              ? 'border-danger/40 focus:border-danger'
              : 'border-border-subtle focus:border-accent/60'
          )}
          aria-label="存储配置 JSON"
        />
      )}
    </div>
  );
}
