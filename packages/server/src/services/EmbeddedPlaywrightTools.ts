import type { BrowserHostAdapter } from '../browser/BrowserHostAdapter.js';
import type { BrowserWorkspaceService } from '../browser/BrowserWorkspaceService.js';
import { loadAppPreferences } from '../preferences/appPreferences.js';

type StructuredStoreLike = {
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

export interface EmbeddedPlaywrightController {
  browserWorkspaces: BrowserWorkspaceService;
  browserHostAdapter: BrowserHostAdapter | null;
  preferenceStore: StructuredStoreLike;
}

export interface EmbeddedPlaywrightToolInvocation {
  toolName: string;
  arguments: Record<string, unknown>;
  sessionId?: string;
}

type SessionTarget = NonNullable<Awaited<ReturnType<BrowserWorkspaceService['resolveSessionTarget']>>>;
type ActiveTabTarget = SessionTarget & { tab: NonNullable<SessionTarget['tab']> };
type Preferences = Awaited<ReturnType<typeof loadAppPreferences>>;

function requireSessionId(sessionId?: string): string {
  if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
    return sessionId.trim();
  }
  throw new Error('Embedded Playwright tools require a sessionId');
}

function requireStringArgument(input: Record<string, unknown>, key: string): string {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if (!value) {
    throw new Error(`${key} requires a non-empty string value`);
  }
  return value;
}

function getOptionalStringArgument(input: Record<string, unknown>, key: string): string | undefined {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  return value || undefined;
}

function getOptionalBooleanArgument(input: Record<string, unknown>, key: string): boolean | undefined {
  return typeof input[key] === 'boolean' ? input[key] : undefined;
}

function getOptionalIntegerArgument(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function requireUrl(input: Record<string, unknown>): string {
  return requireStringArgument(input, 'url');
}

function requireControllableTarget(target: SessionTarget, toolName: string): void {
  if (target.binding.canControl) {
    return;
  }
  throw new Error(`${toolName} requires controller access to the current browser workspace`);
}

function resolveExternalExecutable(preferences: Preferences): string | undefined {
  if (preferences.browserRuntime.externalBrowserMode !== 'configured') {
    return undefined;
  }
  const executable = preferences.browserRuntime.externalBrowserExecutable.trim();
  return executable || undefined;
}

async function loadSessionTarget(
  controller: EmbeddedPlaywrightController,
  sessionId: string,
): Promise<{ preferences: Preferences; target: SessionTarget | null }> {
  const preferences = await loadAppPreferences(controller.preferenceStore);
  const target = await controller.browserWorkspaces.resolveSessionTarget(sessionId);
  return { preferences, target };
}

async function synchronizeHostedTab(
  controller: EmbeddedPlaywrightController,
  tabId: string,
  hostedTab: {
    title: string | null;
    currentUrl: string | null;
    status: string;
    providerTabRef: string;
  } | null,
) {
  if (!hostedTab) {
    return controller.browserWorkspaces.getTab(tabId);
  }

  return controller.browserWorkspaces.updateTabState(tabId, {
    title: hostedTab.title,
    currentUrl: hostedTab.currentUrl,
    status: hostedTab.status,
    providerTabRef: hostedTab.providerTabRef,
  });
}

async function ensureSessionWorkspace(controller: EmbeddedPlaywrightController, sessionId: string) {
  const preferences = await loadAppPreferences(controller.preferenceStore);
  const workspace = await controller.browserWorkspaces.ensureSessionWorkspace(sessionId, preferences.browserRuntime);
  return { preferences, workspace };
}

async function createSessionTab(
  controller: EmbeddedPlaywrightController,
  sessionId: string,
  url: string,
) {
  const { preferences, workspace } = await ensureSessionWorkspace(controller, sessionId);

  if (workspace.providerKind !== 'embedded') {
    if (!controller.browserHostAdapter?.openExternal) {
      throw new Error('External browser fallback is not available in the current runtime');
    }
    await controller.browserHostAdapter.openExternal(url, resolveExternalExecutable(preferences));
    const externalTab = await controller.browserWorkspaces.createTab(workspace.workspaceId, {
      title: 'External Browser',
      currentUrl: url,
      status: 'external-opened',
      providerTabRef: null,
      contributedBySessionId: sessionId,
    });
    return { workspace, tab: externalTab, external: true as const };
  }

  let tab = await controller.browserWorkspaces.createTab(workspace.workspaceId, {
    title: null,
    currentUrl: url,
    status: 'loading',
    providerTabRef: null,
    contributedBySessionId: sessionId,
  });

  if (controller.browserHostAdapter?.createTab) {
    const hostedTab = await controller.browserHostAdapter.createTab(tab.tabId, url, workspace.workspaceId);
    tab = await controller.browserWorkspaces.updateTabState(tab.tabId, {
      title: hostedTab.title,
      currentUrl: hostedTab.currentUrl,
      status: hostedTab.status,
      providerTabRef: hostedTab.providerTabRef,
    });
  }

  return { workspace, tab, external: false as const };
}

async function requireSessionTarget(
  controller: EmbeddedPlaywrightController,
  sessionId: string,
  toolName: string,
): Promise<SessionTarget> {
  const target = await controller.browserWorkspaces.resolveSessionTarget(sessionId);
  if (!target) {
    throw new Error(`${toolName} requires an existing browser workspace for the session`);
  }
  return target;
}

async function requireActiveTabTarget(
  controller: EmbeddedPlaywrightController,
  sessionId: string,
  toolName: string,
): Promise<ActiveTabTarget> {
  const target = await requireSessionTarget(controller, sessionId, toolName);
  if (!target.tab) {
    throw new Error(`${toolName} requires an active browser tab`);
  }
  return target as ActiveTabTarget;
}

async function ensureHostedTab(
  controller: EmbeddedPlaywrightController,
  target: ActiveTabTarget,
) {
  if (target.workspace.providerKind !== 'embedded') {
    return target.tab;
  }

  const currentTab = controller.browserHostAdapter?.readMetadata
    ? await controller.browserHostAdapter.readMetadata(target.tab.tabId)
    : null;
  if (currentTab) {
    return synchronizeHostedTab(controller, target.tab.tabId, currentTab);
  }

  if (!target.tab.currentUrl || !controller.browserHostAdapter?.createTab) {
    return target.tab;
  }

  const recreatedTab = await controller.browserHostAdapter.createTab(
    target.tab.tabId,
    target.tab.currentUrl,
    target.workspace.workspaceId,
  );
  return synchronizeHostedTab(controller, target.tab.tabId, recreatedTab);
}

export async function executeEmbeddedPlaywrightTool(
  controller: EmbeddedPlaywrightController,
  invocation: EmbeddedPlaywrightToolInvocation,
): Promise<unknown> {
  switch (invocation.toolName) {
    case 'browser_tabs_new': {
      const sessionId = requireSessionId(invocation.sessionId);
      const { workspace, tab, external } = await createSessionTab(controller, sessionId, requireUrl(invocation.arguments));
      return { ok: true, workspace, tab, external };
    }

    case 'browser_tabs_list': {
      const sessionId = requireSessionId(invocation.sessionId);
      const { workspace } = await ensureSessionWorkspace(controller, sessionId);
      const tabs = await controller.browserWorkspaces.listWorkspaceTabs(workspace.workspaceId);
      return { ok: true, workspace, tabs };
    }

    case 'browser_tabs_attach': {
      const sessionId = requireSessionId(invocation.sessionId);
      const { preferences } = await loadSessionTarget(controller, sessionId);
      if (!preferences.browserRuntime.allowManualAttach) {
        throw new Error('Manual attach is disabled by browser runtime preferences');
      }
      const workspaceId = requireStringArgument(invocation.arguments, 'workspaceId');
      const binding = await controller.browserWorkspaces.attachWorkspace(sessionId, workspaceId);
      const target = await controller.browserWorkspaces.resolveSessionTarget(sessionId);
      return { ok: true, binding, workspace: target?.workspace ?? null, tab: target?.tab ?? null };
    }

    case 'browser_tabs_share': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await controller.browserWorkspaces.resolveSessionTarget(sessionId);
      const workspaceId = getOptionalStringArgument(invocation.arguments, 'workspaceId') ?? target?.workspace.workspaceId;
      if (!workspaceId) {
        throw new Error('browser_tabs_share requires a workspaceId or an active browser workspace');
      }
      const sharePolicy = getOptionalStringArgument(invocation.arguments, 'sharePolicy') === 'global-default'
        ? 'global-default'
        : 'manual';
      const workspace = await controller.browserWorkspaces.markWorkspaceShared(sessionId, workspaceId, sharePolicy);
      return { ok: true, workspace };
    }

    case 'browser_tabs_detach': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await controller.browserWorkspaces.resolveSessionTarget(sessionId);
      const workspaceId = getOptionalStringArgument(invocation.arguments, 'workspaceId') ?? target?.workspace.workspaceId;
      if (!workspaceId) {
        throw new Error('browser_tabs_detach requires a workspaceId or an active browser workspace');
      }
      await controller.browserWorkspaces.detachWorkspace(sessionId, workspaceId);
      return { ok: true, workspaceId };
    }

    case 'browser_navigate': {
      const sessionId = requireSessionId(invocation.sessionId);
      const url = requireUrl(invocation.arguments);
      const { target } = await loadSessionTarget(controller, sessionId);
      if (!target?.tab) {
        return createSessionTab(controller, sessionId, url);
      }

      const activeTarget = target as ActiveTabTarget;

      requireControllableTarget(activeTarget, invocation.toolName);
      if (activeTarget.workspace.providerKind !== 'embedded') {
        const { preferences } = await loadSessionTarget(controller, sessionId);
        if (!controller.browserHostAdapter?.openExternal) {
          throw new Error('External browser fallback is not available in the current runtime');
        }
        await controller.browserHostAdapter.openExternal(url, resolveExternalExecutable(preferences));
        const tab = await controller.browserWorkspaces.updateTabState(activeTarget.tab.tabId, {
          currentUrl: url,
          status: 'external-opened',
        });
        return { ok: true, workspace: activeTarget.workspace, tab, external: true };
      }

      await ensureHostedTab(controller, activeTarget);

      const hostedTab = controller.browserHostAdapter?.navigate
        ? await controller.browserHostAdapter.navigate(activeTarget.tab.tabId, url)
        : null;
      const tab = hostedTab
        ? await controller.browserWorkspaces.updateTabState(activeTarget.tab.tabId, {
            title: hostedTab.title,
            currentUrl: hostedTab.currentUrl,
            status: hostedTab.status,
            providerTabRef: hostedTab.providerTabRef,
          })
        : await controller.browserWorkspaces.updateTabState(activeTarget.tab.tabId, {
            currentUrl: url,
            status: 'ready',
          });
      return { ok: true, workspace: activeTarget.workspace, tab };
    }

    case 'browser_go_back': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      requireControllableTarget(target, invocation.toolName);
      await ensureHostedTab(controller, target);
      const tab = await synchronizeHostedTab(
        controller,
        target.tab.tabId,
        controller.browserHostAdapter?.goBack ? await controller.browserHostAdapter.goBack(target.tab.tabId) : null,
      );
      return { ok: true, workspace: target.workspace, tab };
    }

    case 'browser_go_forward': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      requireControllableTarget(target, invocation.toolName);
      await ensureHostedTab(controller, target);
      const tab = await synchronizeHostedTab(
        controller,
        target.tab.tabId,
        controller.browserHostAdapter?.goForward ? await controller.browserHostAdapter.goForward(target.tab.tabId) : null,
      );
      return { ok: true, workspace: target.workspace, tab };
    }

    case 'browser_reload': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      requireControllableTarget(target, invocation.toolName);
      await ensureHostedTab(controller, target);
      const tab = await synchronizeHostedTab(
        controller,
        target.tab.tabId,
        controller.browserHostAdapter?.reload ? await controller.browserHostAdapter.reload(target.tab.tabId) : null,
      );
      return { ok: true, workspace: target.workspace, tab };
    }

    case 'browser_click': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      requireControllableTarget(target, invocation.toolName);
      await ensureHostedTab(controller, target);
      const selector = requireStringArgument(invocation.arguments, 'selector');
      const tab = await synchronizeHostedTab(
        controller,
        target.tab.tabId,
        controller.browserHostAdapter?.click ? await controller.browserHostAdapter.click(target.tab.tabId, selector) : null,
      );
      return { ok: true, workspace: target.workspace, tab };
    }

    case 'browser_type': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      requireControllableTarget(target, invocation.toolName);
      await ensureHostedTab(controller, target);
      const selector = requireStringArgument(invocation.arguments, 'selector');
      const text = requireStringArgument(invocation.arguments, 'text');
      const tab = await synchronizeHostedTab(
        controller,
        target.tab.tabId,
        controller.browserHostAdapter?.type
          ? await controller.browserHostAdapter.type(
              target.tab.tabId,
              selector,
              text,
              getOptionalBooleanArgument(invocation.arguments, 'submit'),
            )
          : null,
      );
      return { ok: true, workspace: target.workspace, tab };
    }

    case 'browser_press_key': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      requireControllableTarget(target, invocation.toolName);
      await ensureHostedTab(controller, target);
      const key = requireStringArgument(invocation.arguments, 'key');
      const tab = await synchronizeHostedTab(
        controller,
        target.tab.tabId,
        controller.browserHostAdapter?.press ? await controller.browserHostAdapter.press(target.tab.tabId, key) : null,
      );
      return { ok: true, workspace: target.workspace, tab };
    }

    case 'browser_snapshot': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      await ensureHostedTab(controller, target);
      if (controller.browserHostAdapter?.snapshot) {
        return controller.browserHostAdapter.snapshot(target.tab.tabId);
      }
      return { title: target.tab.title, currentUrl: target.tab.currentUrl, text: '' };
    }

    case 'browser_take_screenshot': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      await ensureHostedTab(controller, target);
      if (!controller.browserHostAdapter?.screenshot) {
        throw new Error('The current runtime does not support browser screenshots');
      }
      const fullPage = getOptionalBooleanArgument(invocation.arguments, 'fullPage') ?? false;
      return {
        title: target.tab.title,
        currentUrl: target.tab.currentUrl,
        screenshot: await controller.browserHostAdapter.screenshot(target.tab.tabId, { fullPage }),
      };
    }

    case 'browser_list_images': {
      const sessionId = requireSessionId(invocation.sessionId);
      const target = await requireActiveTabTarget(controller, sessionId, invocation.toolName);
      await ensureHostedTab(controller, target);
      if (!controller.browserHostAdapter?.listImages) {
        throw new Error('The current runtime does not support browser image listing');
      }
      return {
        title: target.tab.title,
        currentUrl: target.tab.currentUrl,
        images: await controller.browserHostAdapter.listImages(
          target.tab.tabId,
          getOptionalIntegerArgument(invocation.arguments, 'limit'),
        ),
      };
    }

    case 'browser_open_external': {
      const sessionId = requireSessionId(invocation.sessionId);
      const { preferences, target } = await loadSessionTarget(controller, sessionId);
      const url = getOptionalStringArgument(invocation.arguments, 'url') ?? target?.tab?.currentUrl;
      if (!url) {
        throw new Error('browser_open_external requires a url or an active browser tab');
      }
      if (!controller.browserHostAdapter?.openExternal) {
        throw new Error('External browser opening is not available in the current runtime');
      }
      await controller.browserHostAdapter.openExternal(url, resolveExternalExecutable(preferences));
      return { ok: true, currentUrl: url };
    }

    default:
      throw new Error(`Unsupported embedded Playwright tool: ${invocation.toolName}`);
  }
}

export function listEmbeddedPlaywrightTools(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate the current embedded browser tab to a URL, creating one when needed.',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
    },
    { name: 'browser_go_back', description: 'Navigate back in the current embedded browser tab.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_go_forward', description: 'Navigate forward in the current embedded browser tab.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_reload', description: 'Reload the current embedded browser tab.', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'browser_click',
      description: 'Click a DOM element in the current embedded browser tab.',
      inputSchema: { type: 'object', required: ['selector'], properties: { selector: { type: 'string' } } },
    },
    {
      name: 'browser_type',
      description: 'Type text into a DOM element in the current embedded browser tab.',
      inputSchema: {
        type: 'object',
        required: ['selector', 'text'],
        properties: { selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } },
      },
    },
    {
      name: 'browser_press_key',
      description: 'Press a keyboard key in the current embedded browser tab.',
      inputSchema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } },
    },
    { name: 'browser_snapshot', description: 'Capture DOM text and HTML from the current embedded browser tab.', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'browser_take_screenshot',
      description: 'Capture a PNG screenshot of the current embedded browser tab.',
      inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' } } },
    },
    {
      name: 'browser_list_images',
      description: 'List image resources from the current embedded browser tab.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    },
    { name: 'browser_tabs_list', description: 'List tabs in the current session browser workspace.', inputSchema: { type: 'object', properties: {} } },
    { name: 'browser_tabs_new', description: 'Create a new browser tab for the current session.', inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } },
    { name: 'browser_tabs_attach', description: 'Attach the current session to an existing shared browser workspace.', inputSchema: { type: 'object', required: ['workspaceId'], properties: { workspaceId: { type: 'string' } } } },
    { name: 'browser_tabs_share', description: 'Share the current browser workspace or a specific workspace.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' }, sharePolicy: { type: 'string', enum: ['manual', 'global-default'] } } } },
    { name: 'browser_tabs_detach', description: 'Detach the current session from a shared browser workspace.', inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } } } },
    { name: 'browser_open_external', description: 'Open a URL in the configured external browser fallback.', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
  ];
}