import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../index.js';

/** 对比两版画像，返回 delta（03-analysis-engine.md §4 ProfileDiffEngine） */
function diffProfiles(a: any, b: any) {
  const entA: Record<string, any> = {};
  const entB: Record<string, any> = {};
  for (const e of (a.entities ?? [])) entA[`${e.entityType}:${e.name}`] = e;
  for (const e of (b.entities ?? [])) entB[`${e.entityType}:${e.name}`] = e;

  const addedEntities = Object.keys(entB).filter((k) => !entA[k]).map((k) => entB[k]);
  const removedEntities = Object.keys(entA).filter((k) => !entB[k]).map((k) => entA[k]);

  // 维度覆盖变化
  const dimA: Record<string, number> = {};
  const dimB: Record<string, number> = {};
  for (const d of (a.apiFeatures ?? [])) dimA[d.dimension] = d.coverageRatio;
  for (const d of (b.apiFeatures ?? [])) dimB[d.dimension] = d.coverageRatio;

  const dimensionChanges = Object.keys({ ...dimA, ...dimB }).map((dim) => ({
    dimension: dim,
    ratioA: dimA[dim] ?? 0,
    ratioB: dimB[dim] ?? 0,
    delta: (dimB[dim] ?? 0) - (dimA[dim] ?? 0)
  }));

  const scoreDelta = (b.overallScore ?? 0) - (a.overallScore ?? 0);

  return {
    profileIdA: a.profileId,
    profileIdB: b.profileId,
    businessName: a.businessName,
    versionA: a.version,
    versionB: b.version,
    scoreDelta,
    scoreA: a.overallScore,
    scoreB: b.overallScore,
    addedEntities,
    removedEntities,
    dimensionChanges,
    behaviorCountA: (a.behaviors ?? []).length,
    behaviorCountB: (b.behaviors ?? []).length
  };
}

export function registerBusinessesRoutes(app: FastifyInstance, ctx: AppContext): void {
  const store = ctx.storage.getStructuredStore();

  app.get('/api/businesses/profiles', async (req) => {
    const { name } = (req.query ?? {}) as { name?: string };
    let rows: any[];
    if (name) {
      rows = await store.all<any>(
        `SELECT profile_id, session_id, business_name, version, overall_score, created_at FROM business_profiles WHERE business_name=? ORDER BY version DESC`,
        [name]
      );
    } else {
      rows = await store.all<any>(
        `SELECT profile_id, session_id, business_name, version, overall_score, created_at FROM business_profiles ORDER BY created_at DESC LIMIT 100`
      );
    }
    return rows.map((r: any) => ({
      profileId: r.profile_id,
      sessionId: r.session_id,
      businessName: r.business_name,
      version: r.version,
      overallScore: r.overall_score,
      createdAt: r.created_at
    }));
  });

  app.get('/api/businesses/profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await store.get<any>(`SELECT * FROM business_profiles WHERE profile_id=?`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return {
      profileId: row.profile_id,
      sessionId: row.session_id,
      businessName: row.business_name,
      version: row.version,
      entities: JSON.parse(row.entities_json ?? '[]'),
      behaviors: JSON.parse(row.behaviors_json ?? '[]'),
      apiFeatures: JSON.parse(row.api_features ?? '[]'),
      overallScore: row.overall_score,
      createdAt: row.created_at
    };
  });

  // GET /api/businesses/profiles/diff?id1=&id2=
  // 03-analysis-engine.md §4 — ProfileDiffEngine
  app.get('/api/businesses/profiles/diff', async (req, reply) => {
    const { id1, id2 } = (req.query ?? {}) as { id1?: string; id2?: string };
    if (!id1 || !id2) return reply.code(400).send({ error: 'id1 and id2 required' });
    const [rowA, rowB] = await Promise.all([
      store.get<any>(`SELECT * FROM business_profiles WHERE profile_id=?`, [id1]),
      store.get<any>(`SELECT * FROM business_profiles WHERE profile_id=?`, [id2])
    ]);
    if (!rowA) return reply.code(404).send({ error: 'profile_a_not_found' });
    if (!rowB) return reply.code(404).send({ error: 'profile_b_not_found' });
    const a = {
      profileId: rowA.profile_id, businessName: rowA.business_name,
      version: rowA.version, overallScore: rowA.overall_score,
      entities: JSON.parse(rowA.entities_json ?? '[]'),
      behaviors: JSON.parse(rowA.behaviors_json ?? '[]'),
      apiFeatures: JSON.parse(rowA.api_features ?? '[]')
    };
    const b = {
      profileId: rowB.profile_id, businessName: rowB.business_name,
      version: rowB.version, overallScore: rowB.overall_score,
      entities: JSON.parse(rowB.entities_json ?? '[]'),
      behaviors: JSON.parse(rowB.behaviors_json ?? '[]'),
      apiFeatures: JSON.parse(rowB.api_features ?? '[]')
    };
    return diffProfiles(a, b);
  });

  app.get('/api/businesses/graph', async () => {
    const graph = ctx.storage.getGraphStore();
    return {
      nodes: await graph.listNodes('business_graph'),
      edges: await graph.listEdges('business_graph')
    };
  });

  // GET /api/businesses/:name/gap-history — 历史缺口趋势（06-output-reporting.md §6）
  app.get('/api/businesses/:name/gap-history', async (req, reply) => {
    const { name } = req.params as { name: string };
    const rows = await store.all<any>(
      `SELECT report_id, overall_score, payload_json, created_at
       FROM gap_reports WHERE business_name=? ORDER BY created_at ASC LIMIT 50`,
      [name]
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found' });
    return rows.map((r: any) => {
      let gapCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      try {
        const payload = JSON.parse(r.payload_json);
        const gaps: any[] = payload.allGaps ?? payload.criticalGaps ?? payload.gaps ?? [];
        for (const g of gaps) {
          const sev: string = g.severity ?? 'medium';
          if (sev in gapCounts) (gapCounts as any)[sev]++;
        }
      } catch { /* ignore */ }
      return {
        reportId: r.report_id,
        overallScore: r.overall_score,
        createdAt: r.created_at,
        gapCounts,
      };
    });
  });
}
