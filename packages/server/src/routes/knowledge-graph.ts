/**
 * Knowledge Graph API Routes
 * /api/knowledge-graph/*
 *
 * 统一图谱读写接口。所有写操作均通过 KnowledgeGraphService，
 * 保证 Graphology + SQLite 镜像表的数据一致性。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KnowledgeGraphService, ConflictDetector, ImpactAnalyzer } from '@risk-agent/core';
import { KG_NODE_TYPES, KG_RELATION_TYPES } from '@risk-agent/core';
import type { AppContext } from '../index.js';

const NodeTypeEnum = z.enum([...KG_NODE_TYPES] as [string, ...string[]]);
const RelationEnum = z.enum([...KG_RELATION_TYPES] as [string, ...string[]]);

const UpsertNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nodeType: NodeTypeEnum,
  attributes: z.record(z.unknown()).optional(),
});

const AddEdgeSchema = z.object({
  from: z.object({ id: z.string(), label: z.string(), nodeType: NodeTypeEnum }),
  to: z.object({ id: z.string(), label: z.string(), nodeType: NodeTypeEnum }),
  relation: RelationEnum,
  attributes: z.record(z.unknown()).optional(),
});

export function registerKnowledgeGraphRoutes(app: FastifyInstance, ctx: AppContext): void {
  const kgs = new KnowledgeGraphService(
    ctx.storage.getGraphStore(),
    ctx.storage.getLineageStore(),
    ctx.storage.getStructuredStore(),
  );
  const conflicts = new ConflictDetector(ctx.storage.getGraphStore());
  const impact = new ImpactAnalyzer(ctx.storage.getGraphStore());

  // ─── 读取接口 ───────────────────────────────────────────────────────────

  /** GET /api/knowledge-graph/overview — 全图统计概览 */
  app.get('/api/knowledge-graph/overview', async () => {
    return kgs.getOverview();
  });

  /** GET /api/knowledge-graph/search — 节点搜索 */
  app.get('/api/knowledge-graph/search', async (req) => {
    const { q, types, limit } = req.query as { q?: string; types?: string; limit?: string };
    const nodeTypes = types ? types.split(',').filter((t) => KG_NODE_TYPES.includes(t as any)) as any[] : undefined;
    return kgs.search({ query: q, nodeTypes, limit: limit ? parseInt(limit, 10) : 50 });
  });

  /** GET /api/knowledge-graph/neighborhood/:nodeId — 邻域查询 */
  app.get('/api/knowledge-graph/neighborhood/:nodeId', async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const { depth, direction, relations } = req.query as { depth?: string; direction?: string; relations?: string };
    const relationTypes = relations ? relations.split(',').filter((r) => KG_RELATION_TYPES.includes(r as any)) as any[] : undefined;
    return kgs.getNeighborhood({
      nodeId,
      depth: depth ? parseInt(depth, 10) : 2,
      direction: (direction as any) ?? 'both',
      relationTypes,
    });
  });

  /** GET /api/knowledge-graph/chain/:nodeId — 血缘链路 */
  app.get('/api/knowledge-graph/chain/:nodeId', async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const { direction } = req.query as { direction?: string };
    return kgs.getChain(nodeId, (direction as any) ?? 'both');
  });

  /** GET /api/knowledge-graph/impact/:nodeId — 影响分析（基础版，来自 KnowledgeGraphService） */
  app.get('/api/knowledge-graph/impact/:nodeId', async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    return kgs.getImpact(nodeId);
  });

  /** GET /api/knowledge-graph/impact/:nodeId/detail — 详细影响分析（分类分组）*/
  app.get('/api/knowledge-graph/impact/:nodeId/detail', async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    const { depth } = req.query as { depth?: string };
    return impact.analyze(nodeId, depth ? parseInt(depth, 10) : 3);
  });

  /** GET /api/knowledge-graph/conflicts — 全图冲突检测 */
  app.get('/api/knowledge-graph/conflicts', async () => {
    return conflicts.detectAll();
  });

  /** GET /api/knowledge-graph/conflicts/:nodeId — 特定节点的冲突 */
  app.get('/api/knowledge-graph/conflicts/:nodeId', async (req) => {
    const { nodeId } = req.params as { nodeId: string };
    return conflicts.detectForNode(nodeId);
  });

  // ─── 写入接口 ───────────────────────────────────────────────────────────

  /** POST /api/knowledge-graph/nodes — 创建或更新节点 */
  app.post('/api/knowledge-graph/nodes', async (req, reply) => {
    const parsed = UpsertNodeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    await kgs.upsertNode(parsed.data as any);
    return { ok: true };
  });

  /** PATCH /api/knowledge-graph/nodes/:id — 更新节点属性 */
  app.patch('/api/knowledge-graph/nodes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { label?: string; attributes?: Record<string, unknown> };
    // 先获取当前节点再合并更新
    const existing = await kgs.search({ query: id, limit: 1 });
    if (!existing.length) return reply.code(404).send({ error: 'not_found' });
    const current = existing[0];
    await kgs.upsertNode({
      id,
      label: body.label ?? current.label,
      nodeType: current.nodeType,
      attributes: { ...current.attributes, ...body.attributes },
    });
    return { ok: true };
  });

  /** DELETE /api/knowledge-graph/nodes/:id — 删除节点及其所有关系 */
  app.delete('/api/knowledge-graph/nodes/:id', async (req) => {
    const { id } = req.params as { id: string };
    await kgs.deleteNode({ id });
    return { ok: true };
  });

  /** POST /api/knowledge-graph/edges — 新增关系边 */
  app.post('/api/knowledge-graph/edges', async (req, reply) => {
    const parsed = AddEdgeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    await kgs.addEdge(parsed.data as any);
    return { ok: true };
  });

  /** POST /api/knowledge-graph/backfill — 从 SQLite 镜像表重建图谱 */
  app.post('/api/knowledge-graph/backfill', async () => {
    const result = await kgs.backfill();
    return { ok: true, ...result };
  });
}
