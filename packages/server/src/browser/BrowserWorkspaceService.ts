import { randomUUID } from 'node:crypto';
import type { BrowserRuntimePreferences } from '../preferences/appPreferences.js';

type StructuredStoreLike = {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

type WorkspaceVisibility = 'exclusive' | 'shared';
type ProviderKind = 'embedded' | 'system-default' | 'external-configured';
type SharePolicy = 'manual' | 'global-default';
type BindingRole = 'owner' | 'observer';
type BindingSource = 'default' | 'manual-attach';

type WorkspaceRow = {
  workspace_id: string;
  owner_session_id: string | null;
  owner_type: string;
  visibility: WorkspaceVisibility;
  provider_kind: ProviderKind;
  share_policy: SharePolicy;
  controller_session_id: string | null;
  last_active_tab_id: string | null;
  created_at: string;
  updated_at: string;
};

type BindingRow = {
  binding_id: string;
  session_id: string;
  workspace_id: string;
  role: BindingRole;
  source: BindingSource;
  can_control: number;
  attached_at: string;
  detached_at: string | null;
};

type TabRow = {
  tab_id: string;
  workspace_id: string;
  title: string | null;
  current_url: string | null;
  status: string;
  provider_tab_ref: string | null;
  contributed_by_session_id: string | null;
  is_pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export interface BrowserWorkspaceRecord {
  workspaceId: string;
  ownerSessionId: string | null;
  ownerType: string;
  visibility: WorkspaceVisibility;
  providerKind: ProviderKind;
  sharePolicy: SharePolicy;
  controllerSessionId: string | null;
  lastActiveTabId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserBindingRecord {
  bindingId: string;
  sessionId: string;
  workspaceId: string;
  role: BindingRole;
  source: BindingSource;
  canControl: boolean;
  attachedAt: string;
  detachedAt: string | null;
}

export interface BrowserTabRecord {
  tabId: string;
  workspaceId: string;
  title: string | null;
  currentUrl: string | null;
  status: string;
  providerTabRef: string | null;
  contributedBySessionId: string | null;
  isPinned: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBrowserTabInput {
  title?: string | null;
  currentUrl?: string | null;
  status?: string;
  providerTabRef?: string | null;
  contributedBySessionId?: string | null;
  isPinned?: boolean;
  sortOrder?: number;
}

export interface BrowserTabLayoutInput {
  tabId: string;
  isPinned: boolean;
}

export interface ResolvedBrowserSessionTarget {
  workspace: BrowserWorkspaceRecord;
  binding: BrowserBindingRecord;
  tab: BrowserTabRecord | null;
}

export interface BrowserWorkspaceState {
  workspaces: BrowserWorkspaceRecord[];
  tabs: BrowserTabRecord[];
  bindings: BrowserBindingRecord[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function toProviderKind(preferences: BrowserRuntimePreferences): ProviderKind {
  if (preferences.defaultProvider === 'embedded-first') {
    return 'embedded';
  }
  return preferences.externalBrowserMode === 'configured' ? 'external-configured' : 'system-default';
}

function toVisibility(preferences: BrowserRuntimePreferences): WorkspaceVisibility {
  return preferences.defaultWorkspaceMode === 'global-shared' ? 'shared' : 'exclusive';
}

function toSharePolicy(preferences: BrowserRuntimePreferences): SharePolicy {
  return preferences.defaultWorkspaceMode === 'global-shared' ? 'global-default' : 'manual';
}

function mapWorkspace(row: WorkspaceRow): BrowserWorkspaceRecord {
  return {
    workspaceId: row.workspace_id,
    ownerSessionId: row.owner_session_id,
    ownerType: row.owner_type,
    visibility: row.visibility,
    providerKind: row.provider_kind,
    sharePolicy: row.share_policy,
    controllerSessionId: row.controller_session_id,
    lastActiveTabId: row.last_active_tab_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBinding(row: BindingRow): BrowserBindingRecord {
  return {
    bindingId: row.binding_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    role: row.role,
    source: row.source,
    canControl: Boolean(row.can_control),
    attachedAt: row.attached_at,
    detachedAt: row.detached_at,
  };
}

function mapTab(row: TabRow): BrowserTabRecord {
  return {
    tabId: row.tab_id,
    workspaceId: row.workspace_id,
    title: row.title,
    currentUrl: row.current_url,
    status: row.status,
    providerTabRef: row.provider_tab_ref,
    contributedBySessionId: row.contributed_by_session_id,
    isPinned: Boolean(row.is_pinned),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TAB_ORDER_SQL = 'ORDER BY is_pinned DESC, sort_order ASC, created_at ASC';

export class BrowserWorkspaceService {
  constructor(private readonly store: StructuredStoreLike) {}

  async ensureSchema(): Promise<void> {
    await this.store.run(`
      CREATE TABLE IF NOT EXISTS browser_workspaces (
        workspace_id TEXT PRIMARY KEY,
        owner_session_id TEXT,
        owner_type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        share_policy TEXT NOT NULL,
        controller_session_id TEXT,
        last_active_tab_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.store.run(`
      CREATE TABLE IF NOT EXISTS browser_tabs (
        tab_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES browser_workspaces(workspace_id) ON DELETE CASCADE,
        title TEXT,
        current_url TEXT,
        status TEXT NOT NULL,
        provider_tab_ref TEXT,
        contributed_by_session_id TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.store.run(`
      CREATE TABLE IF NOT EXISTS session_browser_bindings (
        binding_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES browser_workspaces(workspace_id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        source TEXT NOT NULL,
        can_control INTEGER NOT NULL DEFAULT 0,
        attached_at TEXT NOT NULL,
        detached_at TEXT
      )
    `);
  }

  async listState(): Promise<BrowserWorkspaceState> {
    const [workspaces, tabs, bindings] = await Promise.all([
      this.store.all<WorkspaceRow>(`SELECT * FROM browser_workspaces ORDER BY created_at ASC`),
      this.store.all<TabRow>(`SELECT * FROM browser_tabs ORDER BY workspace_id ASC, is_pinned DESC, sort_order ASC, created_at ASC`),
      this.store.all<BindingRow>(`SELECT * FROM session_browser_bindings WHERE detached_at IS NULL ORDER BY attached_at ASC`),
    ]);

    return {
      workspaces: workspaces.map(mapWorkspace),
      tabs: tabs.map(mapTab),
      bindings: bindings.map(mapBinding),
    };
  }

  async ensureSessionWorkspace(sessionId: string, preferences: BrowserRuntimePreferences): Promise<BrowserWorkspaceRecord> {
    const existingBinding = await this.store.get<BindingRow>(
      `SELECT * FROM session_browser_bindings WHERE session_id=? AND detached_at IS NULL ORDER BY attached_at DESC LIMIT 1`,
      [sessionId],
    );

    if (existingBinding) {
      const existingWorkspace = await this.store.get<WorkspaceRow>(
        `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
        [existingBinding.workspace_id],
      );
      if (existingWorkspace) {
        return mapWorkspace(existingWorkspace);
      }
    }

    const timestamp = nowIso();
    const workspaceId = nextId('workspace');
    await this.store.run(
      `INSERT INTO browser_workspaces(workspace_id, owner_session_id, owner_type, visibility, provider_kind, share_policy, controller_session_id, last_active_tab_id, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        workspaceId,
        sessionId,
        'session',
        toVisibility(preferences),
        toProviderKind(preferences),
        toSharePolicy(preferences),
        sessionId,
        null,
        timestamp,
        timestamp,
      ],
    );

    await this.store.run(
      `INSERT INTO session_browser_bindings(binding_id, session_id, workspace_id, role, source, can_control, attached_at, detached_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [nextId('binding'), sessionId, workspaceId, 'owner', 'default', 1, timestamp, null],
    );

    const created = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!created) {
      throw new Error(`Browser workspace ${workspaceId} was not created`);
    }
    return mapWorkspace(created);
  }

  async ensureStandaloneWorkspace(preferences: BrowserRuntimePreferences): Promise<BrowserWorkspaceRecord> {
    const existing = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE owner_type=? ORDER BY created_at DESC LIMIT 1`,
      ['browser-host'],
    );
    if (existing) {
      return mapWorkspace(existing);
    }

    const timestamp = nowIso();
    const workspaceId = nextId('workspace');
    await this.store.run(
      `INSERT INTO browser_workspaces(workspace_id, owner_session_id, owner_type, visibility, provider_kind, share_policy, controller_session_id, last_active_tab_id, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        workspaceId,
        null,
        'browser-host',
        'exclusive',
        toProviderKind(preferences),
        'manual',
        null,
        null,
        timestamp,
        timestamp,
      ],
    );

    const created = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!created) {
      throw new Error(`Browser workspace ${workspaceId} was not created`);
    }
    return mapWorkspace(created);
  }

  async markWorkspaceShared(sessionId: string, workspaceId: string, sharePolicy: SharePolicy): Promise<BrowserWorkspaceRecord> {
    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!workspace) {
      throw new Error(`Browser workspace ${workspaceId} not found`);
    }
    if (workspace.owner_session_id && workspace.owner_session_id !== sessionId) {
      throw new Error('Only the workspace owner can change share visibility');
    }

    const updatedAt = nowIso();
    await this.store.run(
      `UPDATE browser_workspaces SET visibility=?, share_policy=?, updated_at=? WHERE workspace_id=?`,
      ['shared', sharePolicy, updatedAt, workspaceId],
    );

    const updated = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!updated) {
      throw new Error(`Browser workspace ${workspaceId} disappeared after update`);
    }
    return mapWorkspace(updated);
  }

  async attachWorkspace(sessionId: string, workspaceId: string): Promise<BrowserBindingRecord> {
    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!workspace) {
      throw new Error(`Browser workspace ${workspaceId} not found`);
    }
    if (workspace.visibility !== 'shared' && workspace.owner_session_id !== sessionId) {
      throw new Error('Only shared workspaces can be attached by another session');
    }

    const existing = await this.store.get<BindingRow>(
      `SELECT * FROM session_browser_bindings WHERE session_id=? AND workspace_id=? AND detached_at IS NULL LIMIT 1`,
      [sessionId, workspaceId],
    );
    if (existing) {
      return mapBinding(existing);
    }

    const attachedAt = nowIso();
    await this.store.run(
      `INSERT INTO session_browser_bindings(binding_id, session_id, workspace_id, role, source, can_control, attached_at, detached_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [nextId('binding'), sessionId, workspaceId, 'observer', 'manual-attach', 0, attachedAt, null],
    );

    const created = await this.store.get<BindingRow>(
      `SELECT * FROM session_browser_bindings WHERE session_id=? AND workspace_id=? AND detached_at IS NULL LIMIT 1`,
      [sessionId, workspaceId],
    );
    if (!created) {
      throw new Error(`Session ${sessionId} was not attached to workspace ${workspaceId}`);
    }
    return mapBinding(created);
  }

  async detachWorkspace(sessionId: string, workspaceId: string): Promise<void> {
    await this.store.run(
      `UPDATE session_browser_bindings SET detached_at=? WHERE session_id=? AND workspace_id=? AND detached_at IS NULL`,
      [nowIso(), sessionId, workspaceId],
    );
  }

  async deleteWorkspace(sessionId: string | null, workspaceId: string): Promise<void> {
    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!workspace) {
      throw new Error(`Browser workspace ${workspaceId} not found`);
    }
    if (workspace.owner_session_id && workspace.owner_session_id !== sessionId) {
      throw new Error('Only the workspace owner can delete the workspace');
    }

    await this.store.run(`DELETE FROM session_browser_bindings WHERE workspace_id=?`, [workspaceId]);
    await this.store.run(`DELETE FROM browser_tabs WHERE workspace_id=?`, [workspaceId]);
    await this.store.run(`DELETE FROM browser_workspaces WHERE workspace_id=?`, [workspaceId]);
  }

  async createTab(workspaceId: string, input: CreateBrowserTabInput): Promise<BrowserTabRecord> {
    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!workspace) {
      throw new Error(`Browser workspace ${workspaceId} not found`);
    }

    const tabId = nextId('tab');
    const timestamp = nowIso();
    const nextSortOrder = input.sortOrder ?? await this.getNextSortOrder(workspaceId);
    await this.store.run(
      `INSERT INTO browser_tabs(tab_id, workspace_id, title, current_url, status, provider_tab_ref, contributed_by_session_id, is_pinned, sort_order, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tabId,
        workspaceId,
        input.title ?? null,
        input.currentUrl ?? null,
        input.status ?? 'ready',
        input.providerTabRef ?? null,
        input.contributedBySessionId ?? null,
        input.isPinned ? 1 : 0,
        nextSortOrder,
        timestamp,
        timestamp,
      ],
    );

    await this.store.run(
      `UPDATE browser_workspaces SET last_active_tab_id=?, updated_at=? WHERE workspace_id=?`,
      [tabId, timestamp, workspaceId],
    );

    const created = await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE tab_id=? LIMIT 1`,
      [tabId],
    );
    if (!created) {
      throw new Error(`Browser tab ${tabId} was not created`);
    }
    return mapTab(created);
  }

  async activateTab(workspaceId: string, tabId: string): Promise<BrowserWorkspaceRecord> {
    const tab = await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE tab_id=? AND workspace_id=? LIMIT 1`,
      [tabId, workspaceId],
    );
    if (!tab) {
      throw new Error(`Browser tab ${tabId} not found in workspace ${workspaceId}`);
    }

    const updatedAt = nowIso();
    await this.store.run(
      `UPDATE browser_workspaces SET last_active_tab_id=?, updated_at=? WHERE workspace_id=?`,
      [tabId, updatedAt, workspaceId],
    );

    const updated = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!updated) {
      throw new Error(`Browser workspace ${workspaceId} disappeared after activation`);
    }
    return mapWorkspace(updated);
  }

  async updateTabState(tabId: string, patch: CreateBrowserTabInput): Promise<BrowserTabRecord> {
    const existing = await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE tab_id=? LIMIT 1`,
      [tabId],
    );
    if (!existing) {
      throw new Error(`Browser tab ${tabId} not found`);
    }

    const next = {
      title: patch.title ?? existing.title,
      currentUrl: patch.currentUrl ?? existing.current_url,
      status: patch.status ?? existing.status,
      providerTabRef: patch.providerTabRef ?? existing.provider_tab_ref,
      contributedBySessionId: patch.contributedBySessionId ?? existing.contributed_by_session_id,
      isPinned: patch.isPinned ?? Boolean(existing.is_pinned),
      sortOrder: patch.sortOrder ?? existing.sort_order,
    };

    await this.store.run(
      `UPDATE browser_tabs SET title=?, current_url=?, status=?, provider_tab_ref=?, contributed_by_session_id=?, is_pinned=?, sort_order=?, updated_at=? WHERE tab_id=?`,
      [
        next.title,
        next.currentUrl,
        next.status,
        next.providerTabRef,
        next.contributedBySessionId,
        next.isPinned ? 1 : 0,
        next.sortOrder,
        nowIso(),
        tabId,
      ],
    );

    const updated = await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE tab_id=? LIMIT 1`,
      [tabId],
    );
    if (!updated) {
      throw new Error(`Browser tab ${tabId} disappeared after update`);
    }
    return mapTab(updated);
  }

  async getTab(tabId: string): Promise<BrowserTabRecord | null> {
    const row = await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE tab_id=? LIMIT 1`,
      [tabId],
    );
    return row ? mapTab(row) : null;
  }

  async listWorkspaceTabs(workspaceId: string): Promise<BrowserTabRecord[]> {
    const rows = await this.store.all<TabRow>(
      `SELECT * FROM browser_tabs WHERE workspace_id=? ${TAB_ORDER_SQL}`,
      [workspaceId],
    );
    return rows.map(mapTab);
  }

  async saveTabLayout(workspaceId: string, tabs: BrowserTabLayoutInput[]): Promise<BrowserTabRecord[]> {
    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [workspaceId],
    );
    if (!workspace) {
      throw new Error(`Browser workspace ${workspaceId} not found`);
    }

    const existingTabs = await this.store.all<TabRow>(
      `SELECT * FROM browser_tabs WHERE workspace_id=?`,
      [workspaceId],
    );
    if (existingTabs.length !== tabs.length) {
      throw new Error(`Browser tab layout for workspace ${workspaceId} is incomplete`);
    }

    const existingIds = new Set(existingTabs.map((tab) => tab.tab_id));
    const layoutIds = new Set(tabs.map((tab) => tab.tabId));
    if (existingIds.size !== layoutIds.size || tabs.some((tab) => !existingIds.has(tab.tabId))) {
      throw new Error(`Browser tab layout for workspace ${workspaceId} contains unknown tabs`);
    }

    const timestamp = nowIso();
    for (const [index, tab] of tabs.entries()) {
      await this.store.run(
        `UPDATE browser_tabs SET is_pinned=?, sort_order=?, updated_at=? WHERE tab_id=? AND workspace_id=?`,
        [tab.isPinned ? 1 : 0, index, timestamp, tab.tabId, workspaceId],
      );
    }

    await this.store.run(
      `UPDATE browser_workspaces SET updated_at=? WHERE workspace_id=?`,
      [timestamp, workspaceId],
    );

    return this.listWorkspaceTabs(workspaceId);
  }

  async removeTab(tabId: string): Promise<{ workspaceId: string; nextActiveTabId: string | null }> {
    const existing = await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE tab_id=? LIMIT 1`,
      [tabId],
    );
    if (!existing) {
      throw new Error(`Browser tab ${tabId} not found`);
    }

    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [existing.workspace_id],
    );
    const orderedTabs = await this.store.all<TabRow>(
      `SELECT * FROM browser_tabs WHERE workspace_id=? ${TAB_ORDER_SQL}`,
      [existing.workspace_id],
    );
    const currentIndex = orderedTabs.findIndex((tab) => tab.tab_id === tabId);
    const remainingTabs = orderedTabs.filter((tab) => tab.tab_id !== tabId);
    const removingActive = workspace?.last_active_tab_id === tabId;
    const nextActiveTabId = removingActive
      ? remainingTabs[currentIndex]?.tab_id ?? remainingTabs[currentIndex - 1]?.tab_id ?? null
      : workspace?.last_active_tab_id ?? remainingTabs[0]?.tab_id ?? null;

    await this.store.run(`DELETE FROM browser_tabs WHERE tab_id=?`, [tabId]);
    await this.store.run(
      `UPDATE browser_workspaces SET last_active_tab_id=?, updated_at=? WHERE workspace_id=?`,
      [nextActiveTabId, nowIso(), existing.workspace_id],
    );

    return {
      workspaceId: existing.workspace_id,
      nextActiveTabId,
    };
  }

  async resolveSessionTarget(sessionId: string): Promise<ResolvedBrowserSessionTarget | null> {
    const binding = await this.store.get<BindingRow>(
      `SELECT * FROM session_browser_bindings WHERE session_id=? AND detached_at IS NULL ORDER BY attached_at DESC LIMIT 1`,
      [sessionId],
    );
    if (!binding) {
      return null;
    }

    const workspace = await this.store.get<WorkspaceRow>(
      `SELECT * FROM browser_workspaces WHERE workspace_id=? LIMIT 1`,
      [binding.workspace_id],
    );
    if (!workspace) {
      return null;
    }

    const lastActiveTab = workspace.last_active_tab_id
      ? await this.store.get<TabRow>(`SELECT * FROM browser_tabs WHERE tab_id=? LIMIT 1`, [workspace.last_active_tab_id])
      : undefined;
    const tab = lastActiveTab ?? await this.store.get<TabRow>(
      `SELECT * FROM browser_tabs WHERE workspace_id=? ${TAB_ORDER_SQL} LIMIT 1`,
      [workspace.workspace_id],
    );

    return {
      workspace: mapWorkspace(workspace),
      binding: mapBinding(binding),
      tab: tab ? mapTab(tab) : null,
    };
  }

  private async getNextSortOrder(workspaceId: string): Promise<number> {
    const row = await this.store.get<{ max_sort_order: number | null }>(
      `SELECT MAX(sort_order) AS max_sort_order FROM browser_tabs WHERE workspace_id=?`,
      [workspaceId],
    );
    return (row?.max_sort_order ?? -1) + 1;
  }
}