/**
 * StorageProfileSwitcher — 模板切换（Embedded / Hybrid / Full External / Custom）
 * settings-center-ui.md §3.2 · settings-center-frontend-mapping.md §5.4
 * 新增：从当前配置复制 / 重置为模板 按钮
 */
import { IconServer, IconServerBolt, IconCloud, IconSettings2, IconCopy, IconRefresh } from '@tabler/icons-react';
import { clsx } from 'clsx';
import type { StorageProfile } from '../../../api/storageSettings';

interface ProfileOption {
  value: StorageProfile;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const PROFILES: ProfileOption[] = [
  { value: 'embedded',      label: 'Embedded',      desc: 'SQLite + LanceDB，单机开箱即用', Icon: IconServer },
  { value: 'hybrid',        label: 'Hybrid',         desc: 'PostgreSQL + LanceDB + MinIO',  Icon: IconServerBolt },
  { value: 'full-external', label: 'Full External',  desc: 'PostgreSQL + Milvus + Neo4j + S3', Icon: IconCloud },
  { value: 'custom',        label: 'Custom',         desc: '完全自定义配置',                Icon: IconSettings2 },
];

/** storage-profiles.md §2/3/4 三种标准 Profile 配置模板 */
export const TEMPLATES: Record<StorageProfile, Record<string, unknown>> = {
  // Profile A: Embedded（默认推荐）— SQLite + LanceDB + Graphology + Local
  embedded: {
    structured: { backend: 'sqlite',    path: './risk_agent_data/data/risk_agent.db' },
    vector:     { backend: 'lancedb',   path: './risk_agent_data/data/lance' },
    graph:      { backend: 'graphology', path: './risk_agent_data/data/graph/business_graph.json' },
    object:     { backend: 'local',     basePath: './risk_agent_data/data/objects' },
  },
  // Profile B: Hybrid（推荐团队落地起点）— PostgreSQL + LanceDB + Graphology + MinIO
  hybrid: {
    structured: {
      backend: 'postgresql',
      url: '${env.PG_CONNECTION_STRING}',
      schema: 'public',
      pool: { min: 2, max: 10 },
    },
    vector:     { backend: 'lancedb',   path: './risk_agent_data/data/lance' },
    graph:      { backend: 'graphology', path: './risk_agent_data/data/graph/business_graph.json' },
    object: {
      backend: 'minio',
      endpoint: '${env.MINIO_ENDPOINT}',
      bucket:   '${env.MINIO_BUCKET}',
      accessKey: '${env.MINIO_ACCESS_KEY}',
      secretKey: '${env.MINIO_SECRET_KEY}',
    },
  },
  // Profile C: Full External（企业级生产）— PostgreSQL + Milvus + Neo4j + S3
  'full-external': {
    structured: {
      backend: 'postgresql',
      url: '${env.PG_CONNECTION_STRING}',
      schema: 'public',
      pool: { min: 5, max: 20 },
    },
    vector: {
      backend: 'milvus',
      url: '${env.MILVUS_ADDRESS}',
    },
    graph: {
      backend: 'neo4j',
      url: '${env.NEO4J_URI}',
    },
    object: {
      backend: 's3',
      endpoint: '${env.S3_ENDPOINT}',
      bucket:   '${env.S3_BUCKET}',
      accessKey: '${env.S3_ACCESS_KEY_ID}',
      secretKey: '${env.S3_SECRET_ACCESS_KEY}',
    },
  },
  // Custom: 以 embedded 为基础，用户自由修改
  custom: {
    structured: { backend: 'sqlite',    path: './risk_agent_data/data/risk_agent.db' },
    vector:     { backend: 'lancedb',   path: './risk_agent_data/data/lance' },
    graph:      { backend: 'graphology', path: './risk_agent_data/data/graph/business_graph.json' },
    object:     { backend: 'local',     basePath: './risk_agent_data/data/objects' },
  },
};

interface Props {
  selected: StorageProfile;
  /** 当前激活的配置（从服务端获取），用于"从当前配置复制" */
  currentConfig?: Record<string, unknown> | null;
  onSelect: (profile: StorageProfile, template: Record<string, unknown>) => void;
}

export function StorageProfileSwitcher({ selected, currentConfig, onSelect }: Props) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">存储模板</h4>
      <div className="grid grid-cols-2 gap-2">
        {PROFILES.map(({ value, label, desc, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value, TEMPLATES[value])}
            className={clsx(
              'flex flex-col gap-1 p-3 rounded-lg border text-left transition-colors',
              selected === value
                ? 'border-accent bg-surface-soft text-accent'
                : 'border-border bg-surface text-text-dim hover:border-border-strong hover:text-text'
            )}
          >
            <div className="flex items-center gap-1.5">
              <Icon size={13} />
              <span className="text-xs font-semibold">{label}</span>
            </div>
            <span className="text-[10px] opacity-70">{desc}</span>
          </button>
        ))}
      </div>

      {/* 辅助操作 */}
      <div className="flex items-center gap-2 pt-1">
        {currentConfig && (
          <button
            type="button"
            onClick={() => onSelect('custom', currentConfig)}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-dim transition-colors"
          >
            <IconCopy size={11} />
            从当前配置复制
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelect(selected, TEMPLATES[selected])}
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-dim transition-colors"
        >
          <IconRefresh size={11} />
          重置为模板
        </button>
      </div>
    </div>
  );
}
