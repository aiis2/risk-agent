/**
 * Knowledge Graph 完整性检测与功能测试脚本
 * Usage: node scripts/test-knowledge-graph.mjs
 */

const BASE = 'http://127.0.0.1:8787/api/knowledge-graph';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} => ${res.status}: ${text}`);
  return json;
}

let passed = 0, failed = 0;

function check(label, condition, actual) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label} — got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('\n========== Knowledge Graph 完整性测试 ==========\n');

// ── 1. Backfill ──────────────────────────────────────────────────────────────
console.log('── 1. Backfill（从 SQLite 重建图谱）──');
const bf = await req('POST', '/backfill', {});
check('ok=true', bf.ok === true, bf);
check('nodesRestored >= 0', bf.nodesRestored >= 0, bf.nodesRestored);
check('edgesRestored >= 0', bf.edgesRestored >= 0, bf.edgesRestored);
console.log(`   → nodesRestored=${bf.nodesRestored}, edgesRestored=${bf.edgesRestored}`);

// ── 2. Overview ──────────────────────────────────────────────────────────────
console.log('\n── 2. Overview（统计概览）──');
const ov = await req('GET', '/overview');
check('nodeCount >= 0', typeof ov.nodeCount === 'number', ov.nodeCount);
check('edgeCount >= 0', typeof ov.edgeCount === 'number', ov.edgeCount);
check('nodesByType is object', typeof ov.nodesByType === 'object', ov.nodesByType);
check('edgesByRelation is object', typeof ov.edgesByRelation === 'object', ov.edgesByRelation);
console.log(`   → nodeCount=${ov.nodeCount}, edgeCount=${ov.edgeCount}`);
console.log(`   → nodesByType: ${JSON.stringify(ov.nodesByType)}`);
console.log(`   → edgesByRelation: ${JSON.stringify(ov.edgesByRelation)}`);

// ── 3. 写入 — 新建节点 ───────────────────────────────────────────────────────
console.log('\n── 3. 写入 — 新建节点（rule, rule_source, business）──');

const node1 = { id: 'test_rule_001', label: '贷款资质核查规则', nodeType: 'rule', attributes: { version: 'v2.1', risk_level: 'high' } };
const node2 = { id: 'test_src_001',  label: '银行监管指引2024', nodeType: 'rule_source', attributes: { publisher: '央行', year: 2024 } };
const node3 = { id: 'test_biz_001',  label: '个人贷款业务场景', nodeType: 'business', attributes: { category: '零售金融' } };
const node4 = { id: 'test_gap_001',  label: '贷款资质缺口分析', nodeType: 'gap', attributes: { severity: 'medium' } };

for (const n of [node1, node2, node3, node4]) {
  const r = await req('POST', '/nodes', n);
  check(`upsert node ${n.id}`, r.ok === true, r);
}

// ── 4. 写入 — 新建关系边 ─────────────────────────────────────────────────────
console.log('\n── 4. 写入 — 新建关系边 ──');

const edges = [
  { from: { id: node1.id, label: node1.label, nodeType: 'rule' },
    to:   { id: node2.id, label: node2.label, nodeType: 'rule_source' },
    relation: 'derived_from' },
  { from: { id: node1.id, label: node1.label, nodeType: 'rule' },
    to:   { id: node3.id, label: node3.label, nodeType: 'business' },
    relation: 'covers' },
  { from: { id: node1.id, label: node1.label, nodeType: 'rule' },
    to:   { id: node4.id, label: node4.label, nodeType: 'gap' },
    relation: 'exposes_gap' },
];

for (const e of edges) {
  const r = await req('POST', '/edges', e);
  check(`add edge ${e.from.id} -[${e.relation}]-> ${e.to.id}`, r.ok === true, r);
}

// ── 5. 验证：Overview 应更新 ─────────────────────────────────────────────────
console.log('\n── 5. 验证写入后 Overview 更新 ──');
const ov2 = await req('GET', '/overview');
check('nodeCount > 0 after write', ov2.nodeCount > 0, ov2.nodeCount);
check('edgeCount > 0 after write', ov2.edgeCount > 0, ov2.edgeCount);
console.log(`   → nodeCount=${ov2.nodeCount}, edgeCount=${ov2.edgeCount}`);

// ── 6. 搜索 ─────────────────────────────────────────────────────────────────
console.log('\n── 6. 搜索节点 ──');
const searchAll = await req('GET', '/search?limit=100');
check('search returns array', Array.isArray(searchAll), typeof searchAll);
check('search finds test_rule_001', searchAll.some(n => n.id === 'test_rule_001'), searchAll.length);

const searchKw = await req('GET', '/search?q=%E8%B4%B7%E6%AC%BE&limit=10');
check('search by keyword 贷款 returns results', Array.isArray(searchKw) && searchKw.length > 0, searchKw.length);
console.log(`   → keyword search: ${searchKw.map(n => n.label).join(', ')}`);

const searchType = await req('GET', '/search?types=rule&limit=20');
check('search by type=rule returns only rules', Array.isArray(searchType) && searchType.every(n => n.nodeType === 'rule'), searchType.map(n=>n.nodeType));
console.log(`   → type=rule: ${searchType.length} items`);

// ── 7. 邻域查询 ──────────────────────────────────────────────────────────────
console.log('\n── 7. 邻域查询（Neighborhood）──');
const nb = await req('GET', `/neighborhood/test_rule_001?depth=2&direction=both`);
check('neighborhood returns nodes array', Array.isArray(nb.nodes), typeof nb.nodes);
check('neighborhood returns edges array', Array.isArray(nb.edges), typeof nb.edges);
check('neighborhood includes center node', nb.nodes.some(n => n.id === 'test_rule_001'), nb.nodes.length);
check('neighborhood finds downstream gap', nb.nodes.some(n => n.id === 'test_gap_001'), nb.nodes.map(n=>n.id));
console.log(`   → nodes: ${nb.nodes.map(n=>n.id).join(', ')}`);
console.log(`   → edges: ${nb.edges.map(e=>`${e.source}-[${e.relation}]->${e.target}`).join(', ')}`);

// ── 8. 血缘链路 ──────────────────────────────────────────────────────────────
console.log('\n── 8. 血缘链路（Chain）──');
const chain = await req('GET', `/chain/test_rule_001?direction=both`);
check('chain returns nodes array', Array.isArray(chain.nodes), typeof chain.nodes);
check('chain returns edges array', Array.isArray(chain.edges), typeof chain.edges);
console.log(`   → chain nodes: ${chain.nodes.map(n=>n.id).join(', ')}`);

// ── 9. 影响分析 ─────────────────────────────────────────────────────────────
console.log('\n── 9. 影响分析（Impact）──');
const impact = await req('GET', `/impact/test_rule_001`);
check('impact has directImpact array', Array.isArray(impact.directImpact), typeof impact.directImpact);
check('impact has indirectImpact array', Array.isArray(impact.indirectImpact), typeof impact.indirectImpact);
check('impact finds gap as direct', impact.directImpact.some(n => n.id === 'test_gap_001'), impact.directImpact.map(n=>n.id));
console.log(`   → direct: ${impact.directImpact.map(n=>n.id).join(', ')}`);
console.log(`   → indirect: ${impact.indirectImpact.map(n=>n.id).join(', ')}`);

// 详细影响分析
const impactDetail = await req('GET', `/impact/test_rule_001/detail`);
check('impact detail has direct array', Array.isArray(impactDetail.direct), typeof impactDetail.direct);
check('impact detail has byType', typeof impactDetail.byType === 'object', typeof impactDetail.byType);
check('impact detail totalCount >= 0', impactDetail.totalCount >= 0, impactDetail.totalCount);
console.log(`   → detail totalCount=${impactDetail.totalCount}, byType: ${JSON.stringify(Object.fromEntries(Object.entries(impactDetail.byType).map(([k,v])=>[k,v.length])))}`);

// ── 10. 冲突检测 ─────────────────────────────────────────────────────────────
console.log('\n── 10. 冲突检测（Conflicts）──');

// 先写入一对冲突节点
const nodeA = { id: 'test_conflict_a', label: '规则A-限制年龄>=18', nodeType: 'rule', attributes: {} };
const nodeB = { id: 'test_conflict_b', label: '规则B-允许年龄>=16', nodeType: 'rule', attributes: {} };
await req('POST', '/nodes', nodeA);
await req('POST', '/nodes', nodeB);
await req('POST', '/edges', {
  from: { id: nodeA.id, label: nodeA.label, nodeType: 'rule' },
  to:   { id: nodeB.id, label: nodeB.label, nodeType: 'rule' },
  relation: 'conflicts_with',
  attributes: { reason: '年龄门槛不一致' },
});

const conflicts = await req('GET', '/conflicts');
check('conflicts returns array', Array.isArray(conflicts), typeof conflicts);
check('conflict pair found', conflicts.length > 0, conflicts.length);
const cfPair = conflicts.find(c => (c.nodeA.id === nodeA.id || c.nodeB.id === nodeA.id));
check('conflict pair involves test_conflict_a', !!cfPair, conflicts.map(c=>`${c.nodeA.id}↔${c.nodeB.id}`));
console.log(`   → ${conflicts.length} conflict pairs found`);

const nodeConflicts = await req('GET', `/conflicts/test_conflict_a`);
check('node-specific conflicts returned', Array.isArray(nodeConflicts) && nodeConflicts.length > 0, nodeConflicts.length);
console.log(`   → node conflict: ${nodeConflicts.map(c=>`${c.nodeA.id}↔${c.nodeB.id} (${c.source})`).join(', ')}`);

// ── 11. 节点更新（PATCH）────────────────────────────────────────────────────
console.log('\n── 11. 节点更新（PATCH）──');
const patchR = await req('PATCH', `/nodes/test_rule_001`, { label: '贷款资质核查规则v2', attributes: { version: 'v2.2', updated: true } });
check('patch ok=true', patchR.ok === true, patchR);
const afterPatch = await req('GET', '/search?q=test_rule_001&limit=1');
const patchedNode = afterPatch.find(n => n.id === 'test_rule_001');
check('patch label updated', patchedNode?.label === '贷款资质核查规则v2', patchedNode?.label);
console.log(`   → updated label: ${patchedNode?.label}`);

// ── 12. 关系类型过滤 ─────────────────────────────────────────────────────────
console.log('\n── 12. 邻域关系过滤 ──');
const nbFiltered = await req('GET', `/neighborhood/test_rule_001?depth=2&direction=downstream&relations=covers`);
check('filtered neighborhood nodes array', Array.isArray(nbFiltered.nodes), typeof nbFiltered.nodes);
check('filtered edges only covers', nbFiltered.edges.every(e => e.relation === 'covers'), nbFiltered.edges.map(e=>e.relation));
console.log(`   → covers-only edges: ${nbFiltered.edges.length}`);

// ── 13. 节点删除 ─────────────────────────────────────────────────────────────
console.log('\n── 13. 节点删除（DELETE）──');
const delTestNode = { id: 'test_delete_me', label: '删除测试节点', nodeType: 'document' };
await req('POST', '/nodes', delTestNode);
const delR = await req('DELETE', `/nodes/test_delete_me`);
check('delete ok=true', delR.ok === true, delR);
const afterDel = await req('GET', '/search?q=test_delete_me&limit=5');
check('node removed from search', !afterDel.some(n => n.id === 'test_delete_me'), afterDel.map(n=>n.id));
console.log(`   → node deleted and confirmed absent`);

// ── 14. 验证关系类型枚举安全 ─────────────────────────────────────────────────
console.log('\n── 14. 写入安全校验（非法 relation 应报错）──');
try {
  await req('POST', '/edges', {
    from: { id: node1.id, label: node1.label, nodeType: 'rule' },
    to:   { id: node3.id, label: node3.label, nodeType: 'business' },
    relation: 'EVIL_RELATION',
  });
  check('invalid relation rejected', false, 'no error thrown');
} catch (e) {
  check('invalid relation rejected (error thrown)', e.message.includes('4'), e.message);
  console.log(`   → Correctly rejected: ${e.message.split('\n')[0]}`);
}

// ── 15. 最终 Overview ────────────────────────────────────────────────────────
console.log('\n── 15. 最终 Overview 核对 ──');
const ovFinal = await req('GET', '/overview');
check('final nodeCount > 30 (has real + test data)', ovFinal.nodeCount > 30, ovFinal.nodeCount);
check('final edgeCount > 40', ovFinal.edgeCount > 40, ovFinal.edgeCount);
console.log(`   → FINAL: nodeCount=${ovFinal.nodeCount}, edgeCount=${ovFinal.edgeCount}`);
console.log(`   → nodesByType: ${JSON.stringify(ovFinal.nodesByType)}`);
console.log(`   → edgesByRelation: ${JSON.stringify(ovFinal.edgesByRelation)}`);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n========== 测试完成 ==========');
console.log(`PASSED: ${passed}  FAILED: ${failed}`);
if (failed > 0) process.exit(1);
