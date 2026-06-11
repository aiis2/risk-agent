-- Risk Agent embedded SQLite schema (v0.1 MVP)
-- 参考：docs/modules/04-storage-layer.md §2

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_scenarios (
  scenario_id    TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  domain         TEXT,
  status         TEXT DEFAULT 'draft',
  version        INTEGER DEFAULT 1,
  data_sources   TEXT DEFAULT '[]',
  documents      TEXT DEFAULT '[]',
  manual_notes   TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scenario_domain ON business_scenarios(domain, status);

CREATE TABLE IF NOT EXISTS collected_data (
  data_id          TEXT PRIMARY KEY,
  scenario_id      TEXT REFERENCES business_scenarios(scenario_id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL,
  source_config_id TEXT,
  raw_data         TEXT,
  normalized       TEXT,
  quality_report   TEXT,
  collected_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collected_scenario ON collected_data(scenario_id);

-- 风控规则系统（多系统规则管理，§02-risk-knowledge-base §9）
-- 必须在 risk_rules 之前定义（FK 约束需要目标表先存在于 DML 时）
CREATE TABLE IF NOT EXISTS rule_systems (
  system_id    TEXT PRIMARY KEY,
  system_name  TEXT NOT NULL,
  system_type  TEXT DEFAULT 'manual',   -- 'realtime'|'offline'|'manual'
  sync_config  TEXT,                    -- JSON: { apiUrl, syncInterval, authType }
  rule_count   INTEGER DEFAULT 0,
  last_sync_at TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_rules (
  rule_id         TEXT PRIMARY KEY,
  rule_name       TEXT NOT NULL,
  rule_code       TEXT,
  biz_type        TEXT,
  rule_type       TEXT,
  conditions_json TEXT,
  actions_json    TEXT,
  coverage_json   TEXT DEFAULT '[]',
  risk_level      TEXT,
  source          TEXT,
  description     TEXT,
  status          TEXT DEFAULT 'active',
  synced_at       TEXT DEFAULT (datetime('now')),
  effective_from  TEXT,
  effective_to    TEXT,
  system_id       TEXT REFERENCES rule_systems(system_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_biz ON risk_rules(biz_type, status);
CREATE INDEX IF NOT EXISTS idx_rule_type ON risk_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_rule_system ON risk_rules(system_id);

CREATE TABLE IF NOT EXISTS rule_lineage (
  lineage_id    TEXT PRIMARY KEY,
  source_rule   TEXT NOT NULL,
  target_rule   TEXT NOT NULL,
  relation      TEXT NOT NULL,
  attributes    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lineage_source ON rule_lineage(source_rule);
CREATE INDEX IF NOT EXISTS idx_lineage_target ON rule_lineage(target_rule);

CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  scenario_id     TEXT REFERENCES business_scenarios(scenario_id),
  business_name   TEXT NOT NULL,
  description     TEXT,
  status          TEXT DEFAULT 'pending',
  phase           TEXT DEFAULT 'prepare',
  rule_scope      TEXT,
  locale          TEXT DEFAULT 'zh-CN',
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT,
  config_snapshot TEXT,
  -- session-lifecycle.md §4.3 mode recovery
  mode            TEXT DEFAULT 'coordinator',
  -- session-lifecycle.md §2 state machine
  paused_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_scenario ON sessions(scenario_id);

CREATE TABLE IF NOT EXISTS business_profiles (
  profile_id     TEXT PRIMARY KEY,
  session_id     TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
  business_name  TEXT NOT NULL,
  version        INTEGER DEFAULT 1,
  entities_json  TEXT DEFAULT '[]',
  behaviors_json TEXT DEFAULT '[]',
  api_features   TEXT DEFAULT '[]',
  overall_score  REAL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profile_biz ON business_profiles(business_name, version);

CREATE TABLE IF NOT EXISTS gap_reports (
  report_id       TEXT PRIMARY KEY,
  session_id      TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
  business_name   TEXT NOT NULL,
  locale          TEXT DEFAULT 'zh-CN',
  overall_score   REAL DEFAULT 0,
  payload_json    TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_report_session ON gap_reports(session_id);

CREATE TABLE IF NOT EXISTS stream_events (
  event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_session ON stream_events(session_id, event_id);

CREATE TABLE IF NOT EXISTS memories (
  memory_id   TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  metadata    TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mem_key ON memories(memory_type, key);

CREATE TABLE IF NOT EXISTS cost_snapshots (
  snapshot_id    TEXT PRIMARY KEY,
  session_id     TEXT,
  model          TEXT,
  input_tokens   INTEGER DEFAULT 0,
  output_tokens  INTEGER DEFAULT 0,
  cached_tokens  INTEGER DEFAULT 0,
  estimated_usd  REAL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cost_session ON cost_snapshots(session_id);

CREATE TABLE IF NOT EXISTS business_graph_nodes (
  node_id      TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  node_type    TEXT NOT NULL,
  payload_json TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bgn_type ON business_graph_nodes(node_type);

-- 规则血缘图谱节点镜像（用于服务重启后回填 LINEAGE_GRAPH）
CREATE TABLE IF NOT EXISTS lineage_graph_nodes (
  node_id      TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  node_type    TEXT NOT NULL,
  payload_json TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lgn_type ON lineage_graph_nodes(node_type);

CREATE TABLE IF NOT EXISTS business_graph_edges (
  edge_id      TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL,
  to_node_id   TEXT NOT NULL,
  edge_type    TEXT NOT NULL,
  payload_json TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bge_from ON business_graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_bge_to   ON business_graph_edges(to_node_id);

CREATE TABLE IF NOT EXISTS mcp_servers (
  server_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  transport      TEXT NOT NULL,
  url            TEXT,
  description    TEXT,
  timeout_ms     INTEGER DEFAULT 30000,
  enabled        INTEGER DEFAULT 1,
  config_json    TEXT,   -- JSON: { headers, auth, retryConfig }
  health_status  TEXT DEFAULT 'unknown',  -- 'healthy'|'degraded'|'unhealthy'|'unknown'
  health_error   TEXT,
  last_check_at  TEXT,
  tool_count     INTEGER DEFAULT 0,
  last_status    TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_sources (
  source_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  config_json  TEXT,
  enabled      INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS datasource_knowledge_snapshots (
  snapshot_id        TEXT PRIMARY KEY,
  source_id          TEXT NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
  source_type        TEXT NOT NULL,
  graph_name         TEXT NOT NULL,
  vector_collection  TEXT NOT NULL,
  status             TEXT DEFAULT 'ready',
  node_count         INTEGER DEFAULT 0,
  edge_count         INTEGER DEFAULT 0,
  document_count     INTEGER DEFAULT 0,
  metadata_json      TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ds_knowledge_source ON datasource_knowledge_snapshots(source_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS datasource_knowledge_documents (
  document_id    TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES data_sources(source_id) ON DELETE CASCADE,
  snapshot_id    TEXT NOT NULL,
  document_type  TEXT NOT NULL,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  metadata_json  TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ds_knowledge_docs_source ON datasource_knowledge_documents(source_id, document_type);

CREATE TABLE IF NOT EXISTS model_configs (
  model_id     TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  model_name   TEXT NOT NULL,
  role         TEXT,
  config_json  TEXT,
  enabled      INTEGER DEFAULT 1,
  is_default   INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preferences (
  pref_key     TEXT PRIMARY KEY,
  pref_value   TEXT NOT NULL,
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- Agent 检查点（支持中断恢复）
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  checkpoint_id        TEXT PRIMARY KEY,
  session_id           TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
  task_id              TEXT,
  completed_workers    TEXT DEFAULT '[]',   -- JSON string[]
  intermediate_results TEXT DEFAULT '{}',  -- JSON Record<string, any>
  plan_json            TEXT,               -- JSON TaskPlan
  token_budget         TEXT,               -- JSON TokenBudgetState
  correction_round     INTEGER DEFAULT 0,
  memory_snapshot      TEXT,               -- JSON {shortTermEntries, recentLongTermIds}
  created_at           TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checkpoint_session ON agent_checkpoints(session_id);

-- Agent 工具调用审计日志
CREATE TABLE IF NOT EXISTS agent_trace_logs (
  trace_id      TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  tool_use_id   TEXT,
  input_json    TEXT,
  output_json   TEXT,
  is_error      INTEGER DEFAULT 0,
  duration_ms   INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trace_session ON agent_trace_logs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trace_tool    ON agent_trace_logs(tool_name);

-- 技能管理（Skills 系统）
CREATE TABLE IF NOT EXISTS skills (
  skill_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  source       TEXT DEFAULT 'bundled',   -- 'bundled'|'directory'|'mcp'|'dynamic'
  config_json  TEXT,
  enabled      INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- 会话消息历史（Chat 记录）
CREATE TABLE IF NOT EXISTS conversations (
  conv_id     TEXT PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
  -- 每条消息的稳定 UUID（session-lifecycle.md §3.2 · 用于 compact_boundary 定位）
  uuid        TEXT,
  role        TEXT NOT NULL,   -- 'user'|'assistant'|'system'|'progress'|'attachment'
  -- 消息子类型（compact_boundary 等），用于 snip 重放定位
  subtype     TEXT,
  content     TEXT NOT NULL,
  metadata    TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_uuid ON conversations(uuid) WHERE uuid IS NOT NULL;

-- FTS5 全文检索索引（system-architecture.md v3.3 §6.3 Transcript 搜索）
-- content='' 表示外部内容表，依赖 insert/delete trigger 保持同步
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
  content,
  role UNINDEXED,
  session_id UNINDEXED,
  content='conversations',
  content_rowid='rowid'
);

-- 自动同步 FTS5 索引
CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
  INSERT INTO conversations_fts(rowid, content, role, session_id)
    VALUES (new.rowid, new.content, new.role, new.session_id);
END;
CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, content, role, session_id)
    VALUES ('delete', old.rowid, old.content, old.role, old.session_id);
END;
CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
  INSERT INTO conversations_fts(conversations_fts, rowid, content, role, session_id)
    VALUES ('delete', old.rowid, old.content, old.role, old.session_id);
  INSERT INTO conversations_fts(rowid, content, role, session_id)
    VALUES (new.rowid, new.content, new.role, new.session_id);
END;

-- sessions 表补充 mode/paused_at 已迁入 CREATE TABLE sessions 定义，无需 ALTER TABLE

-- ──────────────────────────────────────────────────────────────────────────────
-- 存储配置管理（settings-center-frontend-mapping.md / storage-settings-api.md）
-- ──────────────────────────────────────────────────────────────────────────────

-- 存储配置修订历史（支持 rollback）
CREATE TABLE IF NOT EXISTS storage_revisions (
  revision_id    TEXT PRIMARY KEY,
  profile        TEXT NOT NULL DEFAULT 'embedded',  -- 'embedded'|'hybrid'|'full-external'|'custom'
  config_json    TEXT NOT NULL,
  config_hash    TEXT NOT NULL,
  is_active      INTEGER DEFAULT 0,
  source         TEXT DEFAULT 'ui',  -- 'ui'|'api'|'file-sync'
  created_by     TEXT DEFAULT 'user',
  comment        TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_storage_rev_active ON storage_revisions(is_active);

-- 存储迁移任务（异步长任务）
CREATE TABLE IF NOT EXISTS storage_migration_jobs (
  job_id             TEXT PRIMARY KEY,
  source_revision_id TEXT,
  target_revision_id TEXT,
  scopes_json        TEXT DEFAULT '["structured"]',
  dry_run            INTEGER DEFAULT 0,
  status             TEXT DEFAULT 'queued',   -- 'queued'|'running'|'completed'|'failed'|'cancelled'
  progress           REAL DEFAULT 0,
  current_scope      TEXT,                    -- 当前正在处理的 scope（运行中时有值）
  started_at         TEXT,
  finished_at        TEXT,
  error_message      TEXT,
  result_json        TEXT,
  created_at         TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_smj_status ON storage_migration_jobs(status);

-- 迁移步骤检查点（MigrationCheckpointStore）
CREATE TABLE IF NOT EXISTS migration_checkpoints (
  job_id      TEXT NOT NULL,
  step        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  detail      TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, step)
);
CREATE INDEX IF NOT EXISTS idx_mc_job ON migration_checkpoints(job_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 规则来源追踪（04-storage-layer.md §2.2）
-- ──────────────────────────────────────────────────────────────────────────────

-- 规则来源（导入文件 / API 同步 / 手工录入 / 模型生成）
CREATE TABLE IF NOT EXISTS rule_sources (
  source_id     TEXT PRIMARY KEY,
  system_name   TEXT NOT NULL,
  system_type   TEXT DEFAULT 'manual',   -- 'realtime'|'offline'|'manual'
  source_type   TEXT NOT NULL,           -- 'file_import'|'api_sync'|'manual_input'|'model_generated'
  file_name     TEXT,
  rule_count    INTEGER DEFAULT 0,
  imported_by   TEXT,
  import_note   TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rule_source_type ON rule_sources(source_type);

-- 规则-来源关联映射
CREATE TABLE IF NOT EXISTS rule_source_mapping (
  rule_id       TEXT REFERENCES risk_rules(rule_id) ON DELETE CASCADE,
  source_id     TEXT REFERENCES rule_sources(source_id) ON DELETE CASCADE,
  confidence    REAL DEFAULT 1.0,
  parse_notes   TEXT,
  PRIMARY KEY (rule_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_rsm_source ON rule_source_mapping(source_id);

-- 存储审计日志（system-architecture.md v3.3 §7.2）
CREATE TABLE IF NOT EXISTS storage_audit_logs (
  audit_id        TEXT PRIMARY KEY,
  operation       TEXT NOT NULL,        -- 'apply'|'rollback'|'validate'
  operator        TEXT DEFAULT 'user',
  source          TEXT DEFAULT 'ui',
  revision_from   TEXT,
  revision_to     TEXT,
  backend_info    TEXT,
  success         INTEGER DEFAULT 1,
  error_reason    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_op ON storage_audit_logs(operation, created_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- 会话级费用汇总（04-storage-layer.md §10）
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_costs (
  cost_id                  TEXT PRIMARY KEY,
  session_id               TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
  total_cost_usd           REAL NOT NULL DEFAULT 0,
  total_input_tokens       INTEGER DEFAULT 0,
  total_output_tokens      INTEGER DEFAULT 0,
  cache_read_tokens        INTEGER DEFAULT 0,
  cache_create_tokens      INTEGER DEFAULT 0,
  total_api_duration_ms    INTEGER DEFAULT 0,
  total_tool_duration_ms   INTEGER DEFAULT 0,
  model_usage_json         TEXT,   -- JSON: Record<modelName, ModelUsage>
  lines_added              INTEGER DEFAULT 0,
  lines_removed            INTEGER DEFAULT 0,
  created_at               TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_costs_session ON session_costs(session_id);
CREATE INDEX IF NOT EXISTS idx_session_costs_date    ON session_costs(created_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- MCP 工具缓存（05-mcp-management.md §11 · 工具发现结果持久化）
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_tool_cache (
  cache_id        TEXT PRIMARY KEY,
  server_id       TEXT NOT NULL REFERENCES mcp_servers(server_id) ON DELETE CASCADE,
  tool_name       TEXT NOT NULL,
  description     TEXT,
  schema_json     TEXT,          -- JSON: inputSchema
  discovered_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(server_id, tool_name)
);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_server ON mcp_tool_cache(server_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Harness Kernel Phase 1 — Run-first persistence
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS runs (
  run_id                TEXT PRIMARY KEY,
  task_kind             TEXT NOT NULL,
  status                TEXT NOT NULL,
  termination_reason    TEXT,
  input_json            TEXT NOT NULL,
  routing_json          TEXT NOT NULL,
  current_checkpoint_id TEXT,
  latest_artifact_id    TEXT,
  verifier_state_json   TEXT,
  metrics_json          TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  completed_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS run_checkpoints (
  checkpoint_id      TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  checkpoint_kind    TEXT NOT NULL,
  checkpoint_scope   TEXT NOT NULL,
  snapshot_json      TEXT NOT NULL,
  transcript_offset  INTEGER NOT NULL,
  artifact_ref       TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_checkpoints_run ON run_checkpoints(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
  event_id      TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at ASC);

CREATE TABLE IF NOT EXISTS run_artifacts (
  artifact_id    TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  artifact_kind  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  content_json   TEXT,
  content_text   TEXT,
  version        INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run ON run_artifacts(run_id, version DESC);

CREATE TABLE IF NOT EXISTS run_verifications (
  verification_id  TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  checkpoint_id    TEXT,
  verifier_type    TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  decision         TEXT NOT NULL,
  reasons_json     TEXT NOT NULL,
  followup_action  TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_verifications_run ON run_verifications(run_id, created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- Hermes-style Persona / UserProfile / Memory Curator / Skill self-improvement
-- 参考：docs/plans/2026-04-29-hermes-persona-memory-and-xterm-cli.md
-- ──────────────────────────────────────────────────────────────────────────────

-- 人格档案（SOUL.md 等价物）。built-in 不可改，仅可 fork。
CREATE TABLE IF NOT EXISTS personas (
  persona_id     TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT,
  system_prompt  TEXT NOT NULL,
  traits_json    TEXT DEFAULT '{}',     -- JSON: { tone, expertise[], style }
  scope          TEXT DEFAULT 'general', -- 'general'|'analysis'|'knowledge-query'|'skill-management'|'data-analysis'
  source         TEXT DEFAULT 'user',    -- 'builtin'|'user'|'fork'
  is_built_in    INTEGER DEFAULT 0,
  parent_id      TEXT,                   -- fork 关系
  enabled        INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_scope ON personas(scope, enabled);

-- 会话当前选用的人格（一对一）
CREATE TABLE IF NOT EXISTS session_persona (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  persona_id  TEXT NOT NULL REFERENCES personas(persona_id) ON DELETE RESTRICT,
  source      TEXT DEFAULT 'auto',   -- 'auto'|'user'|'fallback'
  applied_at  TEXT DEFAULT (datetime('now'))
);

-- 用户画像（USER.md 等价）
CREATE TABLE IF NOT EXISTS user_profiles (
  profile_id        TEXT PRIMARY KEY,
  owner_key         TEXT NOT NULL UNIQUE,            -- 默认 'local-default'，预留多用户
  display_name      TEXT,
  traits_json       TEXT DEFAULT '{}',               -- JSON: { industry, role, language_pref }
  preferences_json  TEXT DEFAULT '{}',               -- JSON: { verbosity, format }
  learned_facts_json TEXT DEFAULT '[]',              -- JSON [{ key, value, learnedAt, source }]
  version           INTEGER DEFAULT 1,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- 长期记忆事实（结构化、可向量化、可 FTS）
CREATE TABLE IF NOT EXISTS memory_facts (
  fact_id          TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  content_hash     TEXT,                     -- SHA256(content)[0:16] 用于快速去重
  category         TEXT DEFAULT 'general',   -- 'domain_knowledge'|'user_preference'|'analysis_pattern'|'risk_template'|'general'
  source_session   TEXT,
  source_run       TEXT,
  source_round     INTEGER,
  confidence       REAL DEFAULT 0.7,
  embedding_status TEXT DEFAULT 'pending',   -- 'pending'|'ready'|'failed'|'skipped'
  use_count        INTEGER DEFAULT 0,
  last_used_at     TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_hash ON memory_facts(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_facts_category ON memory_facts(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_facts_embed ON memory_facts(embedding_status);

-- FTS5 索引（memory_facts.content）
CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(
  content,
  category UNINDEXED,
  fact_id UNINDEXED,
  content='memory_facts',
  content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS memory_facts_ai AFTER INSERT ON memory_facts BEGIN
  INSERT INTO memory_facts_fts(rowid, content, category, fact_id)
    VALUES (new.rowid, new.content, new.category, new.fact_id);
END;
CREATE TRIGGER IF NOT EXISTS memory_facts_ad AFTER DELETE ON memory_facts BEGIN
  INSERT INTO memory_facts_fts(memory_facts_fts, rowid, content, category, fact_id)
    VALUES ('delete', old.rowid, old.content, old.category, old.fact_id);
END;
CREATE TRIGGER IF NOT EXISTS memory_facts_au AFTER UPDATE ON memory_facts BEGIN
  INSERT INTO memory_facts_fts(memory_facts_fts, rowid, content, category, fact_id)
    VALUES ('delete', old.rowid, old.content, old.category, old.fact_id);
  INSERT INTO memory_facts_fts(rowid, content, category, fact_id)
    VALUES (new.rowid, new.content, new.category, new.fact_id);
END;

-- 技能改进建议（默认 dryRun，仅记录，不直接改 SKILL.md）
CREATE TABLE IF NOT EXISTS skill_revisions (
  rev_id      TEXT PRIMARY KEY,
  skill_id    TEXT NOT NULL,
  skill_name  TEXT,
  before_md   TEXT,
  after_md    TEXT NOT NULL,
  reason      TEXT,
  run_id      TEXT,
  status      TEXT DEFAULT 'pending',   -- 'pending'|'accepted'|'rejected'|'applied'
  reviewer    TEXT,
  reviewed_at TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_skill_rev_status ON skill_revisions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_rev_skill  ON skill_revisions(skill_id);


