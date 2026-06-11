import { buildTool, type AgentToolDefinition } from '@risk-agent/core';
import { z } from 'zod';
import type { BrowserWorkspaceService } from '../browser/BrowserWorkspaceService.js';
import type { BrowserHostAdapter, BrowserHostTabSnapshot } from '../browser/BrowserHostAdapter.js';
import { loadAppPreferences } from '../preferences/appPreferences.js';

interface StructuredStoreLike {
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
}

interface BrowserHostToolInput {
  action: string;
  id?: string;
  payload?: Record<string, unknown>;
}

const SessionWorkspacePayloadSchema = z.object({
  sessionId: z.string().min(1),
});

const StandaloneWorkspacePayloadSchema = z.object({}).passthrough();

const ShareWorkspacePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  sharePolicy: z.enum(['manual', 'global-default']).default('manual'),
});

const AttachWorkspacePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
});

const DeleteWorkspacePayloadSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1).nullable().optional(),
});

const CreateTabPayloadSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().nullable().optional(),
  currentUrl: z.string().nullable().optional(),
  status: z.string().optional(),
  providerTabRef: z.string().nullable().optional(),
  contributedBySessionId: z.string().nullable().optional(),
});

const WorkspaceTabPayloadSchema = z.object({
  workspaceId: z.string().min(1),
});

const NavigateTabPayloadSchema = WorkspaceTabPayloadSchema.extend({
  url: z.string().min(1),
});

const SaveLayoutPayloadSchema = z.object({
  workspaceId: z.string().min(1),
  tabs: z.array(z.object({
    tabId: z.string().min(1),
    isPinned: z.boolean(),
  })).min(1),
});

const ClickPayloadSchema = z.object({
  selector: z.string().min(1),
});

const TypePayloadSchema = ClickPayloadSchema.extend({
  text: z.string(),
  submit: z.boolean().optional(),
});

const PressPayloadSchema = z.object({
  key: z.string().min(1),
});

const ScreenshotPayloadSchema = z.object({
  fullPage: z.boolean().optional(),
}).default({});

const ListImagesPayloadSchema = z.object({
  limit: z.number().int().positive().optional(),
}).default({});

const OpenExternalPayloadSchema = z.object({
  url: z.string().min(1),
  executablePath: z.string().optional(),
});

type BrowserHostToolDeps = {
  store: StructuredStoreLike;
  browserWorkspaces: BrowserWorkspaceService;
  browserHostAdapter: BrowserHostAdapter | null;
};

function requireTabId(id: string | undefined, action: string): string {
  if (!id) {
    throw new Error(`${action} requires id`);
  }
  return id;
}

function requireHostMethod<K extends keyof BrowserHostAdapter>(
  browserHostAdapter: BrowserHostAdapter | null,
  methodName: K,
): NonNullable<BrowserHostAdapter[K]> {
  const method = browserHostAdapter?.[methodName];
  if (typeof method !== 'function') {
    throw new Error(`browser host method ${String(methodName)} is unavailable`);
  }
  return method as NonNullable<BrowserHostAdapter[K]>;
}

function normalizeBrowserHostAction(action: string): string {
  if (action === 'read_state') return 'state';
  return action;
}

function normalizeCreateTabPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = payload ? { ...payload } : {};
  if (typeof next.currentUrl !== 'string' && typeof next.url === 'string' && next.url.trim()) {
    next.currentUrl = next.url.trim();
  }
  return next;
}

function normalizeNavigatePayload(id: string | undefined, payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = payload ? { ...payload } : {};
  if (typeof next.workspaceId !== 'string' && typeof id === 'string' && id.startsWith('workspace_')) {
    next.workspaceId = id;
  }
  return next;
}

function toHostedPatch(hostedTab: BrowserHostTabSnapshot) {
  return {
    title: hostedTab.title,
    currentUrl: hostedTab.currentUrl,
    status: hostedTab.status,
    providerTabRef: hostedTab.providerTabRef,
  };
}

async function ensureWorkspaceTab(browserWorkspaces: BrowserWorkspaceService, tabId: string, workspaceId: string) {
  const tab = await browserWorkspaces.getTab(tabId);
  if (!tab || tab.workspaceId !== workspaceId) {
    throw new Error(`Browser tab ${tabId} not found`);
  }
  return tab;
}

async function updateHostedTabState(
  browserWorkspaces: BrowserWorkspaceService,
  tabId: string,
  hostedTab: BrowserHostTabSnapshot | null,
) {
  if (!hostedTab) {
    return browserWorkspaces.getTab(tabId);
  }
  return browserWorkspaces.updateTabState(tabId, toHostedPatch(hostedTab));
}

async function ensureHostedTabState(
  browserWorkspaces: BrowserWorkspaceService,
  browserHostAdapter: BrowserHostAdapter | null,
  tabId: string,
  allowRecreate = true,
) {
  const tab = await browserWorkspaces.getTab(tabId);
  if (!tab || tab.currentUrl === null) {
    return tab;
  }

  const metadata = browserHostAdapter?.readMetadata
    ? await browserHostAdapter.readMetadata(tabId)
    : null;
  if (metadata) {
    return browserWorkspaces.updateTabState(tabId, toHostedPatch(metadata));
  }

  if (!allowRecreate || !browserHostAdapter?.createTab) {
    return tab;
  }

  const recreated = await browserHostAdapter.createTab(tabId, tab.currentUrl, tab.workspaceId);
  return browserWorkspaces.updateTabState(tabId, toHostedPatch(recreated));
}

async function syncHostedTabsForState(
  browserWorkspaces: BrowserWorkspaceService,
  browserHostAdapter: BrowserHostAdapter | null,
) {
  const state = await browserWorkspaces.listState();
  if (!(browserHostAdapter?.isAvailable() ?? false)) {
    return state;
  }

  const workspaceById = new Map(state.workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const hostedTabs = state.tabs.filter((tab) => {
    const workspace = workspaceById.get(tab.workspaceId);
    return workspace?.providerKind === 'embedded' && tab.currentUrl !== null;
  });

  await Promise.all(hostedTabs.map((tab) => ensureHostedTabState(browserWorkspaces, browserHostAdapter, tab.tabId, false)));
  return browserWorkspaces.listState();
}

export function createBrowserHostTool({ store, browserWorkspaces, browserHostAdapter }: BrowserHostToolDeps): AgentToolDefinition<BrowserHostToolInput> {
  return buildTool<BrowserHostToolInput>({
    name: 'browser_host',
    description: '管理内置浏览器 host、工作区和标签页，并对 hosted tab 执行导航、快照、截图与交互动作。',
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    alwaysLoad: true,
    searchHint: 'browser host workspace tab navigate snapshot screenshot click type press 内置浏览器',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
      },
    },
    async execute(input, ctx) {
      const action = normalizeBrowserHostAction(input.action);

      switch (action) {
        case 'state': {
          const state = await syncHostedTabsForState(browserWorkspaces, browserHostAdapter);
          return { ok: true, hostAvailable: browserHostAdapter?.isAvailable() ?? false, ...state };
        }

        case 'ensure_session_workspace': {
          const payload = SessionWorkspacePayloadSchema.parse({
            ...(input.payload ?? {}),
            sessionId: typeof input.payload?.sessionId === 'string' && input.payload.sessionId.trim()
              ? input.payload.sessionId.trim()
              : ctx.sessionId,
          });
          const preferences = await loadAppPreferences(store);
          const workspace = await browserWorkspaces.ensureSessionWorkspace(payload.sessionId, preferences.browserRuntime);
          return { ok: true, workspace };
        }

        case 'ensure_standalone_workspace': {
          StandaloneWorkspacePayloadSchema.parse(input.payload ?? {});
          const preferences = await loadAppPreferences(store);
          const workspace = await browserWorkspaces.ensureStandaloneWorkspace(preferences.browserRuntime);
          return { ok: true, workspace };
        }

        case 'share_workspace': {
          const payload = ShareWorkspacePayloadSchema.parse(input.payload ?? {});
          const workspace = await browserWorkspaces.markWorkspaceShared(payload.sessionId, payload.workspaceId, payload.sharePolicy);
          return { ok: true, workspace };
        }

        case 'attach_workspace': {
          const payload = AttachWorkspacePayloadSchema.parse(input.payload ?? {});
          const preferences = await loadAppPreferences(store);
          if (!preferences.browserRuntime.allowManualAttach) {
            throw new Error('manual_attach_disabled');
          }
          const binding = await browserWorkspaces.attachWorkspace(payload.sessionId, payload.workspaceId);
          return { ok: true, binding };
        }

        case 'detach_workspace': {
          const payload = AttachWorkspacePayloadSchema.parse(input.payload ?? {});
          await browserWorkspaces.detachWorkspace(payload.sessionId, payload.workspaceId);
          return { ok: true, workspaceId: payload.workspaceId, sessionId: payload.sessionId };
        }

        case 'delete_workspace': {
          const payload = DeleteWorkspacePayloadSchema.parse(input.payload ?? {});
          const tabs = await browserWorkspaces.listWorkspaceTabs(payload.workspaceId);
          if (browserHostAdapter?.closeTab) {
            await Promise.all(tabs.map((tab) => browserHostAdapter.closeTab?.(tab.tabId)));
          }
          await browserWorkspaces.deleteWorkspace(payload.sessionId ?? null, payload.workspaceId);
          return { ok: true, workspaceId: payload.workspaceId };
        }

        case 'create_tab': {
          const payload = CreateTabPayloadSchema.parse(normalizeCreateTabPayload(input.payload));
          let tab = await browserWorkspaces.createTab(payload.workspaceId, payload);
          if (payload.currentUrl && browserHostAdapter?.createTab) {
            const hostedTab = await browserHostAdapter.createTab(tab.tabId, payload.currentUrl, payload.workspaceId);
            tab = await browserWorkspaces.updateTabState(tab.tabId, toHostedPatch(hostedTab));
          }
          return { ok: true, tab };
        }

        case 'navigate': {
          const payload = NavigateTabPayloadSchema.parse(normalizeNavigatePayload(input.id, input.payload));
          if (input.id && input.id !== payload.workspaceId) {
            await ensureWorkspaceTab(browserWorkspaces, input.id, payload.workspaceId);
            await ensureHostedTabState(browserWorkspaces, browserHostAdapter, input.id);
            const hostedTab = browserHostAdapter?.navigate
              ? await browserHostAdapter.navigate(input.id, payload.url)
              : null;
            const tab = hostedTab
              ? await updateHostedTabState(browserWorkspaces, input.id, hostedTab)
              : await browserWorkspaces.updateTabState(input.id, { currentUrl: payload.url, status: 'ready' });
            return { ok: true, tab };
          }

          let tab = await browserWorkspaces.createTab(payload.workspaceId, {
            currentUrl: payload.url,
            title: null,
          });
          if (browserHostAdapter?.createTab) {
            const hostedTab = await browserHostAdapter.createTab(tab.tabId, payload.url, payload.workspaceId);
            tab = await browserWorkspaces.updateTabState(tab.tabId, toHostedPatch(hostedTab));
          }
          return { ok: true, tab };
        }

        case 'save_layout': {
          const payload = SaveLayoutPayloadSchema.parse(input.payload ?? {});
          const tabs = await browserWorkspaces.saveTabLayout(payload.workspaceId, payload.tabs);
          return { ok: true, tabs };
        }

        case 'activate_tab': {
          const tabId = requireTabId(input.id, input.action);
          const payload = WorkspaceTabPayloadSchema.parse(input.payload ?? {});
          const workspace = await browserWorkspaces.activateTab(payload.workspaceId, tabId);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          if (browserHostAdapter?.activateTab) {
            await browserHostAdapter.activateTab(tabId);
          }
          return { ok: true, workspace };
        }

        case 'reload_tab': {
          const tabId = requireTabId(input.id, input.action);
          const payload = WorkspaceTabPayloadSchema.parse(input.payload ?? {});
          await ensureWorkspaceTab(browserWorkspaces, tabId, payload.workspaceId);
          let tab = await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const reload = browserHostAdapter?.reload;
          const hostedTab = reload ? await reload(tabId) : null;
          if (hostedTab) {
            tab = await browserWorkspaces.updateTabState(tabId, toHostedPatch(hostedTab));
          }
          return { ok: true, tab };
        }

        case 'navigate_tab': {
          const tabId = requireTabId(input.id, input.action);
          const payload = NavigateTabPayloadSchema.parse(input.payload ?? {});
          await ensureWorkspaceTab(browserWorkspaces, tabId, payload.workspaceId);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const hostedTab = browserHostAdapter?.navigate
            ? await browserHostAdapter.navigate(tabId, payload.url)
            : null;
          const tab = hostedTab
            ? await updateHostedTabState(browserWorkspaces, tabId, hostedTab)
            : await browserWorkspaces.updateTabState(tabId, { currentUrl: payload.url, status: 'ready' });
          return { ok: true, tab };
        }

        case 'go_back': {
          const tabId = requireTabId(input.id, input.action);
          const payload = WorkspaceTabPayloadSchema.parse(input.payload ?? {});
          await ensureWorkspaceTab(browserWorkspaces, tabId, payload.workspaceId);
          let tab = await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const hostedTab = browserHostAdapter?.goBack ? await browserHostAdapter.goBack(tabId) : null;
          if (hostedTab) {
            tab = await updateHostedTabState(browserWorkspaces, tabId, hostedTab);
          }
          return { ok: true, tab };
        }

        case 'go_forward': {
          const tabId = requireTabId(input.id, input.action);
          const payload = WorkspaceTabPayloadSchema.parse(input.payload ?? {});
          await ensureWorkspaceTab(browserWorkspaces, tabId, payload.workspaceId);
          let tab = await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const hostedTab = browserHostAdapter?.goForward ? await browserHostAdapter.goForward(tabId) : null;
          if (hostedTab) {
            tab = await updateHostedTabState(browserWorkspaces, tabId, hostedTab);
          }
          return { ok: true, tab };
        }

        case 'close_tab': {
          const tabId = requireTabId(input.id, input.action);
          const payload = WorkspaceTabPayloadSchema.parse(input.payload ?? {});
          const tab = await browserWorkspaces.getTab(tabId);
          if (!tab || tab.workspaceId !== payload.workspaceId) {
            throw new Error(`Browser tab ${tabId} not found`);
          }
          if (browserHostAdapter?.closeTab) {
            await browserHostAdapter.closeTab(tabId);
          }
          const result = await browserWorkspaces.removeTab(tabId);
          return { ok: true, workspaceId: result.workspaceId, closedTabId: tabId, nextActiveTabId: result.nextActiveTabId };
        }

        case 'snapshot_tab': {
          const tabId = requireTabId(input.id, input.action);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const snapshot = await requireHostMethod(browserHostAdapter, 'snapshot')(tabId);
          return { ok: true, snapshot };
        }

        case 'screenshot_tab': {
          const tabId = requireTabId(input.id, input.action);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const payload = ScreenshotPayloadSchema.parse(input.payload ?? {});
          const screenshot = await requireHostMethod(browserHostAdapter, 'screenshot')(tabId, payload);
          return { ok: true, screenshot };
        }

        case 'list_images': {
          const tabId = requireTabId(input.id, input.action);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const payload = ListImagesPayloadSchema.parse(input.payload ?? {});
          const images = await requireHostMethod(browserHostAdapter, 'listImages')(tabId, payload.limit);
          return { ok: true, items: images };
        }

        case 'click': {
          const tabId = requireTabId(input.id, input.action);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const payload = ClickPayloadSchema.parse(input.payload ?? {});
          const hostedTab = await requireHostMethod(browserHostAdapter, 'click')(tabId, payload.selector);
          const tab = await updateHostedTabState(browserWorkspaces, tabId, hostedTab ?? null);
          return { ok: true, tab };
        }

        case 'type': {
          const tabId = requireTabId(input.id, input.action);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const payload = TypePayloadSchema.parse(input.payload ?? {});
          const hostedTab = await requireHostMethod(browserHostAdapter, 'type')(tabId, payload.selector, payload.text, payload.submit);
          const tab = await updateHostedTabState(browserWorkspaces, tabId, hostedTab ?? null);
          return { ok: true, tab };
        }

        case 'press': {
          const tabId = requireTabId(input.id, input.action);
          await ensureHostedTabState(browserWorkspaces, browserHostAdapter, tabId);
          const payload = PressPayloadSchema.parse(input.payload ?? {});
          const hostedTab = await requireHostMethod(browserHostAdapter, 'press')(tabId, payload.key);
          const tab = await updateHostedTabState(browserWorkspaces, tabId, hostedTab ?? null);
          return { ok: true, tab };
        }

        case 'open_window': {
          await requireHostMethod(browserHostAdapter, 'ensureWindow')();
          return { ok: true };
        }

        case 'focus_window': {
          await requireHostMethod(browserHostAdapter, 'focusWindow')();
          return { ok: true };
        }

        case 'open_external': {
          const payload = OpenExternalPayloadSchema.parse(input.payload ?? {});
          await requireHostMethod(browserHostAdapter, 'openExternal')(payload.url, payload.executablePath);
          return { ok: true, url: payload.url };
        }

        default:
          throw new Error(`unsupported browser_host action: ${input.action}`);
      }
    },
  });
}