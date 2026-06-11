import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../index.js';
import { loadAppPreferences } from '../preferences/appPreferences.js';

const SessionWorkspaceRequestSchema = z.object({
  sessionId: z.string().min(1),
});

const OptionalSessionWorkspaceRequestSchema = z.object({
  sessionId: z.string().min(1).nullable().optional(),
});

const ShareWorkspaceRequestSchema = z.object({
  sessionId: z.string().min(1),
  sharePolicy: z.enum(['manual', 'global-default']).default('manual'),
});

const CreateTabRequestSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().nullable().optional(),
  currentUrl: z.string().nullable().optional(),
  status: z.string().optional(),
  providerTabRef: z.string().nullable().optional(),
  contributedBySessionId: z.string().nullable().optional(),
});

const SaveTabLayoutRequestSchema = z.object({
  tabs: z.array(z.object({
    tabId: z.string().min(1),
    isPinned: z.boolean(),
  })).min(1),
});

const ActivateTabRequestSchema = z.object({
  workspaceId: z.string().min(1),
});

const NavigateTabRequestSchema = z.object({
  workspaceId: z.string().min(1),
  url: z.string().min(1),
});

const DeleteTabRequestSchema = z.object({
  workspaceId: z.string().min(1),
});

function sendValidationError(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ error: 'validation_failed', issues });
}

function mapWorkspaceError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'unknown_browser_workspace_error';
  if (message.includes('not found')) {
    return reply.code(404).send({ error: 'browser_workspace_not_found', message });
  }
  if (message.includes('Only the workspace owner')) {
    return reply.code(403).send({ error: 'browser_workspace_forbidden', message });
  }
  if (message.includes('Only shared workspaces')) {
    return reply.code(409).send({ error: 'browser_workspace_not_shared', message });
  }
  return reply.code(500).send({ error: 'browser_workspace_error', message });
}

async function ensureHostedTabState(ctx: AppContext, tabId: string, allowRecreate = true) {
  const tab = await ctx.browserWorkspaces.getTab(tabId);
  if (!tab || tab.currentUrl === null) {
    return tab;
  }

  const metadata = ctx.browserHostAdapter?.readMetadata
    ? await ctx.browserHostAdapter.readMetadata(tabId)
    : null;
  if (metadata) {
    return ctx.browserWorkspaces.updateTabState(tabId, {
      title: metadata.title,
      currentUrl: metadata.currentUrl,
      status: metadata.status,
      providerTabRef: metadata.providerTabRef,
    });
  }

  if (!allowRecreate || !ctx.browserHostAdapter?.createTab) {
    return tab;
  }

  const recreated = await ctx.browserHostAdapter.createTab(tabId, tab.currentUrl, tab.workspaceId);
  return ctx.browserWorkspaces.updateTabState(tabId, {
    title: recreated.title,
    currentUrl: recreated.currentUrl,
    status: recreated.status,
    providerTabRef: recreated.providerTabRef,
  });
}

async function updateHostedTabState(ctx: AppContext, tabId: string, hostedTab: {
  title: string | null;
  currentUrl: string | null;
  status: string;
  providerTabRef: string;
} | null) {
  if (!hostedTab) {
    return ctx.browserWorkspaces.getTab(tabId);
  }

  return ctx.browserWorkspaces.updateTabState(tabId, {
    title: hostedTab.title,
    currentUrl: hostedTab.currentUrl,
    status: hostedTab.status,
    providerTabRef: hostedTab.providerTabRef,
  });
}

async function ensureWorkspaceTab(ctx: AppContext, tabId: string, workspaceId: string) {
  const tab = await ctx.browserWorkspaces.getTab(tabId);
  if (!tab || tab.workspaceId !== workspaceId) {
    throw new Error(`Browser tab ${tabId} not found`);
  }

  return tab;
}

async function syncHostedTabsForState(ctx: AppContext) {
  const state = await ctx.browserWorkspaces.listState();
  if (!(ctx.browserHostAdapter?.isAvailable() ?? false)) {
    return state;
  }

  const workspaceById = new Map(state.workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const hostedTabs = state.tabs.filter((tab) => {
    const workspace = workspaceById.get(tab.workspaceId);
    return workspace?.providerKind === 'embedded' && tab.currentUrl !== null;
  });

  if (hostedTabs.length === 0) {
    return state;
  }

  await Promise.all(hostedTabs.map((tab) => ensureHostedTabState(ctx, tab.tabId, false)));
  return ctx.browserWorkspaces.listState();
}

export function registerBrowserRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.get('/api/browser/state', async () => {
    const state = await syncHostedTabsForState(ctx);
    return {
      hostAvailable: ctx.browserHostAdapter?.isAvailable() ?? false,
      ...state,
    };
  });

  app.post('/api/browser/workspaces/session', async (req, reply) => {
    const parsed = SessionWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    const preferences = await loadAppPreferences(store);
    const workspace = await ctx.browserWorkspaces.ensureSessionWorkspace(
      parsed.data.sessionId,
      preferences.browserRuntime,
    );

    return reply.code(201).send({ ok: true, workspace });
  });

  app.post('/api/browser/workspaces/standalone', async (_req, reply) => {
    const preferences = await loadAppPreferences(store);
    const workspace = await ctx.browserWorkspaces.ensureStandaloneWorkspace(preferences.browserRuntime);
    return reply.code(201).send({ ok: true, workspace });
  });

  app.post('/api/browser/workspaces/:workspaceId/share', async (req, reply) => {
    const parsed = ShareWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const workspace = await ctx.browserWorkspaces.markWorkspaceShared(
        parsed.data.sessionId,
        (req.params as { workspaceId: string }).workspaceId,
        parsed.data.sharePolicy,
      );
      return { ok: true, workspace };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/workspaces/:workspaceId/attach', async (req, reply) => {
    const parsed = SessionWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    const preferences = await loadAppPreferences(store);
    if (!preferences.browserRuntime.allowManualAttach) {
      return reply.code(409).send({ error: 'manual_attach_disabled' });
    }

    try {
      const binding = await ctx.browserWorkspaces.attachWorkspace(
        parsed.data.sessionId,
        (req.params as { workspaceId: string }).workspaceId,
      );
      return { ok: true, binding };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/workspaces/:workspaceId/detach', async (req, reply) => {
    const parsed = SessionWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      await ctx.browserWorkspaces.detachWorkspace(
        parsed.data.sessionId,
        (req.params as { workspaceId: string }).workspaceId,
      );
      return { ok: true, workspaceId: (req.params as { workspaceId: string }).workspaceId, sessionId: parsed.data.sessionId };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.delete('/api/browser/workspaces/:workspaceId', async (req, reply) => {
    const parsed = OptionalSessionWorkspaceRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    const workspaceId = (req.params as { workspaceId: string }).workspaceId;

    try {
      const tabs = await ctx.browserWorkspaces.listWorkspaceTabs(workspaceId);
      const closeHostedTab = ctx.browserHostAdapter?.closeTab;
      if (closeHostedTab) {
        await Promise.all(tabs.map((tab) => closeHostedTab(tab.tabId)));
      }
      await ctx.browserWorkspaces.deleteWorkspace(parsed.data.sessionId ?? null, workspaceId);
      return { ok: true, workspaceId };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/tabs', async (req, reply) => {
    const parsed = CreateTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      let tab = await ctx.browserWorkspaces.createTab(parsed.data.workspaceId, parsed.data);

      if (ctx.browserHostAdapter?.createTab && parsed.data.currentUrl) {
        const hostedTab = await ctx.browserHostAdapter.createTab(
          tab.tabId,
          parsed.data.currentUrl,
          parsed.data.workspaceId,
        );
        tab = await ctx.browserWorkspaces.updateTabState(tab.tabId, {
          title: hostedTab.title,
          currentUrl: hostedTab.currentUrl,
          status: hostedTab.status,
          providerTabRef: hostedTab.providerTabRef,
        });
      }

      return reply.code(201).send({ ok: true, tab });
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/workspaces/:workspaceId/tabs/layout', async (req, reply) => {
    const parsed = SaveTabLayoutRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabs = await ctx.browserWorkspaces.saveTabLayout(
        (req.params as { workspaceId: string }).workspaceId,
        parsed.data.tabs,
      );
      return { ok: true, tabs };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/tabs/:tabId/activate', async (req, reply) => {
    const parsed = ActivateTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabId = (req.params as { tabId: string }).tabId;
      const workspace = await ctx.browserWorkspaces.activateTab(
        parsed.data.workspaceId,
        tabId,
      );

      await ensureHostedTabState(ctx, tabId);

      if (ctx.browserHostAdapter?.activateTab) {
        await ctx.browserHostAdapter.activateTab(tabId);
      }

      return { ok: true, workspace };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/tabs/:tabId/reload', async (req, reply) => {
    const parsed = ActivateTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabId = (req.params as { tabId: string }).tabId;
      let tab = await ensureHostedTabState(ctx, tabId);
      const hostedTab = ctx.browserHostAdapter?.reload
        ? await ctx.browserHostAdapter.reload(tabId)
        : null;
      if (hostedTab) {
        tab = await ctx.browserWorkspaces.updateTabState(tabId, {
          title: hostedTab.title,
          currentUrl: hostedTab.currentUrl,
          status: hostedTab.status,
          providerTabRef: hostedTab.providerTabRef,
        });
      }
      return { ok: true, tab };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/tabs/:tabId/navigate', async (req, reply) => {
    const parsed = NavigateTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabId = (req.params as { tabId: string }).tabId;
      await ensureWorkspaceTab(ctx, tabId, parsed.data.workspaceId);
      await ensureHostedTabState(ctx, tabId);
      const hostedTab = ctx.browserHostAdapter?.navigate
        ? await ctx.browserHostAdapter.navigate(tabId, parsed.data.url)
        : null;
      const tab = hostedTab
        ? await updateHostedTabState(ctx, tabId, hostedTab)
        : await ctx.browserWorkspaces.updateTabState(tabId, {
            currentUrl: parsed.data.url,
            status: 'ready',
          });

      return { ok: true, tab };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/tabs/:tabId/back', async (req, reply) => {
    const parsed = ActivateTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabId = (req.params as { tabId: string }).tabId;
      await ensureWorkspaceTab(ctx, tabId, parsed.data.workspaceId);
      let tab = await ensureHostedTabState(ctx, tabId);
      const hostedTab = ctx.browserHostAdapter?.goBack
        ? await ctx.browserHostAdapter.goBack(tabId)
        : null;
      if (hostedTab) {
        tab = await updateHostedTabState(ctx, tabId, hostedTab);
      }

      return { ok: true, tab };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.post('/api/browser/tabs/:tabId/forward', async (req, reply) => {
    const parsed = ActivateTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabId = (req.params as { tabId: string }).tabId;
      await ensureWorkspaceTab(ctx, tabId, parsed.data.workspaceId);
      let tab = await ensureHostedTabState(ctx, tabId);
      const hostedTab = ctx.browserHostAdapter?.goForward
        ? await ctx.browserHostAdapter.goForward(tabId)
        : null;
      if (hostedTab) {
        tab = await updateHostedTabState(ctx, tabId, hostedTab);
      }

      return { ok: true, tab };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });

  app.delete('/api/browser/tabs/:tabId', async (req, reply) => {
    const parsed = DeleteTabRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error.issues);
    }

    try {
      const tabId = (req.params as { tabId: string }).tabId;
      const tab = await ctx.browserWorkspaces.getTab(tabId);
      if (!tab || tab.workspaceId !== parsed.data.workspaceId) {
        return reply.code(404).send({ error: 'browser_workspace_not_found', message: `Browser tab ${tabId} not found` });
      }
      if (ctx.browserHostAdapter?.closeTab) {
        await ctx.browserHostAdapter.closeTab(tabId);
      }
      const result = await ctx.browserWorkspaces.removeTab(tabId);
      return { ok: true, workspaceId: result.workspaceId, closedTabId: tabId, nextActiveTabId: result.nextActiveTabId };
    } catch (error) {
      return mapWorkspaceError(reply, error);
    }
  });
}