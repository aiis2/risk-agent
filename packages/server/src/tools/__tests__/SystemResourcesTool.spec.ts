import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../index.js';
import { createSystemResourcesTool } from '../SystemResourcesTool.js';

describe('createSystemResourcesTool', () => {
  it('manages models, datasources, MCP servers, skills, and tool catalog entries', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'risk-agent-system-resources-'));
    let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;

    try {
      const built = await buildApp({ dataDir: tmp, port: 0 });
      app = built.app;
      const { ctx } = built;
      const tool = createSystemResourcesTool(ctx.storage);

      const createdModel = await tool.execute({
        domain: 'models',
        action: 'create',
        payload: {
          provider: 'openai-compatible',
          modelName: 'qwen-test',
          config: {
            baseUrl: 'https://api.example.com/v1',
            displayName: 'Qwen Test',
          },
          enabled: true,
        },
      });
      expect(createdModel.ok).toBe(true);

      const listedModels = await tool.execute({ domain: 'models', action: 'list' });
      expect(listedModels.items.some((item: { modelName: string }) => item.modelName === 'qwen-test')).toBe(true);

      const createdDatasource = await tool.execute({
        domain: 'datasources',
        action: 'create',
        payload: {
          name: 'Example Docs',
          sourceType: 'web',
          config: { baseUrl: 'https://example.com' },
          enabled: true,
        },
      });
      expect(createdDatasource.ok).toBe(true);

      const listedDatasources = await tool.execute({ domain: 'datasources', action: 'list' });
      expect(listedDatasources.items.some((item: { name: string }) => item.name === 'Example Docs')).toBe(true);

      const createdScenario = await tool.execute({
        domain: 'scenarios',
        action: 'create',
        payload: {
          name: '收单场景',
          description: '用于验证 Agent 场景 CRUD',
          domain: 'payments',
          status: 'active',
          dataSources: ['source-a'],
          documents: ['doc-a'],
          manualNotes: '需要补充实名核验说明',
        },
      });
      expect(createdScenario.ok).toBe(true);

      const listedScenarios = await tool.execute({ domain: 'scenarios', action: 'list', query: '收单' });
      expect(listedScenarios.items.some((item: { name: string }) => item.name === '收单场景')).toBe(true);

      const readScenario = await tool.execute({
        domain: 'scenarios',
        action: 'read',
        id: createdScenario.item.scenarioId,
      });
      expect(readScenario.item.name).toBe('收单场景');

      const createdRule = await tool.execute({
        domain: 'rules',
        action: 'create',
        payload: {
          ruleName: '异常登录限制',
          bizType: 'payments',
          ruleType: 'behavior',
          description: '连续失败登录达到阈值时触发拦截',
          coverage: ['login', 'device'],
          status: 'active',
        },
      });
      expect(createdRule.ok).toBe(true);

      const createdRuleFromAlias = await tool.execute({
        domain: 'rules',
        action: 'create',
        payload: {
          name: '别名规则创建',
          bizType: 'payments',
          ruleType: 'behavior',
          coverage: ['login'],
        },
      });
      expect(createdRuleFromAlias.ok).toBe(true);
      expect(createdRuleFromAlias.item.ruleName).toBe('别名规则创建');

      const listedRules = await tool.execute({ domain: 'rules', action: 'list', query: '异常登录' });
      expect(listedRules.items.some((item: { ruleName: string }) => item.ruleName === '异常登录限制')).toBe(true);

      const readRule = await tool.execute({
        domain: 'rules',
        action: 'read',
        id: createdRule.item.ruleId,
      });
      expect(readRule.item.ruleName).toBe('异常登录限制');

      const createdProfile = await tool.execute({
        domain: 'profiles',
        action: 'create',
        payload: {
          businessName: '收单业务画像',
          version: 1,
          entities: [{ entityType: 'merchant', name: '商户', count: 1 }],
          behaviors: [{ action: 'login', risk: 'medium' }],
          apiFeatures: [{ dimension: 'login', coverageRatio: 0.62 }],
          overallScore: 78,
        },
      });
      expect(createdProfile.ok).toBe(true);

      const createdProfileFromAlias = await tool.execute({
        domain: 'profiles',
        action: 'create',
        payload: {
          name: '别名业务画像',
          entities: [{ entityType: 'merchant', name: '商户别名', count: 1 }],
          behaviors: [{ action: 'login', risk: 'low' }],
        },
      });
      expect(createdProfileFromAlias.ok).toBe(true);
      expect(createdProfileFromAlias.item.businessName).toBe('别名业务画像');

      const listedProfiles = await tool.execute({ domain: 'profiles', action: 'list', query: '收单业务画像' });
      expect(listedProfiles.items.some((item: { businessName: string }) => item.businessName === '收单业务画像')).toBe(true);

      const readProfile = await tool.execute({
        domain: 'profiles',
        action: 'read',
        id: createdProfile.item.profileId,
      });
      expect(readProfile.item.businessName).toBe('收单业务画像');

      const upsertedNode = await tool.execute({
        domain: 'knowledge_graph',
        action: 'upsert_node',
        payload: {
          id: 'business:test',
          label: '收单业务',
          nodeType: 'business',
          attributes: { source: 'system_resources_test' },
        },
      });
      expect(upsertedNode.ok).toBe(true);

      const createdBusinessNode = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create_node',
        payload: {
          nodeType: 'business',
          name: '别名业务节点',
          attributes: { source: 'system_resources_alias_test' },
        },
      });
      expect(createdBusinessNode.ok).toBe(true);
      expect(createdBusinessNode.item.label).toBe('别名业务节点');
      expect(createdBusinessNode.item.id).toContain('business:');

      const createdScenarioNode = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create_node',
        payload: {
          nodeType: 'scenario',
          name: '别名场景节点',
        },
      });
      expect(createdScenarioNode.ok).toBe(true);

      const createdNodeFromLabelTypeAlias = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create_node',
        payload: {
          label: 'business',
          properties: {
            name: '属性承载业务节点',
          },
        },
      });
      expect(createdNodeFromLabelTypeAlias.ok).toBe(true);
      expect(createdNodeFromLabelTypeAlias.item.nodeType).toBe('business');
      expect(createdNodeFromLabelTypeAlias.item.label).toBe('属性承载业务节点');

      const createdNodeFromExplicitNodeTypeAndPropertyName = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create_node',
        payload: {
          id: 'business:explicit-property-name',
          nodeType: 'business',
          properties: {
            name: '显式类型属性节点',
          },
        },
      });
      expect(createdNodeFromExplicitNodeTypeAndPropertyName.ok).toBe(true);
      expect(createdNodeFromExplicitNodeTypeAndPropertyName.item.id).toBe('business:explicit-property-name');
      expect(createdNodeFromExplicitNodeTypeAndPropertyName.item.nodeType).toBe('business');
      expect(createdNodeFromExplicitNodeTypeAndPropertyName.item.label).toBe('显式类型属性节点');

      const createdNodeFromGenericCreate = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create',
        payload: {
          nodeType: 'business',
          name: '通用创建业务节点',
          properties: { source: 'system_resources_generic_create_test' },
        },
      });
      expect(createdNodeFromGenericCreate.ok).toBe(true);
      expect(createdNodeFromGenericCreate.item.label).toBe('通用创建业务节点');

      const createdNodeFromGenericCreateAliases = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create',
        payload: {
          type: 'node',
          label: 'business',
          name: '判别式业务节点',
        },
      });
      expect(createdNodeFromGenericCreateAliases.ok).toBe(true);
      expect(createdNodeFromGenericCreateAliases.item.nodeType).toBe('business');
      expect(createdNodeFromGenericCreateAliases.item.label).toBe('判别式业务节点');

      const createdEdgeFromAliases = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create_edge',
        payload: {
          fromId: createdBusinessNode.item.id,
          toId: createdScenarioNode.item.id,
          relation: 'belongs_to',
          attributes: { source: 'system_resources_alias_test' },
        },
      });
      expect(createdEdgeFromAliases.ok).toBe(true);
      expect(createdEdgeFromAliases.item.from.id).toBe(createdBusinessNode.item.id);
      expect(createdEdgeFromAliases.item.to.id).toBe(createdScenarioNode.item.id);

      const createdEdgeFromTypeAlias = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create_edge',
        payload: {
          type: 'belongs_to',
          sourceId: createdScenarioNode.item.id,
          targetId: createdBusinessNode.item.id,
        },
      });
      expect(createdEdgeFromTypeAlias.ok).toBe(true);
      expect(createdEdgeFromTypeAlias.item.relation).toBe('belongs_to');

      const createdEdgeFromGenericCreate = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create',
        payload: {
          fromId: createdBusinessNode.item.id,
          toId: createdScenarioNode.item.id,
          relation: 'belongs_to',
          properties: { source: 'system_resources_generic_create_test' },
        },
      });
      expect(createdEdgeFromGenericCreate.ok).toBe(true);
      expect(createdEdgeFromGenericCreate.item.from.id).toBe(createdBusinessNode.item.id);
      expect(createdEdgeFromGenericCreate.item.to.id).toBe(createdScenarioNode.item.id);

      const createdEdgeFromGenericCreateAliases = await tool.execute({
        domain: 'knowledge_graph',
        action: 'create',
        payload: {
          type: 'edge',
          edgeType: 'belongs_to',
          sourceId: createdScenarioNode.item.id,
          targetId: createdBusinessNode.item.id,
        },
      });
      expect(createdEdgeFromGenericCreateAliases.ok).toBe(true);
      expect(createdEdgeFromGenericCreateAliases.item.relation).toBe('belongs_to');
      expect(createdEdgeFromGenericCreateAliases.item.from.id).toBe(createdScenarioNode.item.id);
      expect(createdEdgeFromGenericCreateAliases.item.to.id).toBe(createdBusinessNode.item.id);

      const addedEdge = await tool.execute({
        domain: 'knowledge_graph',
        action: 'add_edge',
        payload: {
          from: { id: 'business:test', label: '收单业务', nodeType: 'business' },
          to: { id: 'scenario:test', label: '收单场景', nodeType: 'scenario' },
          relation: 'belongs_to',
          attributes: { source: 'system_resources_test' },
        },
      });
      expect(addedEdge.ok).toBe(true);

      const searchedGraph = await tool.execute({
        domain: 'knowledge_graph',
        action: 'search',
        payload: { query: '收单', limit: 10 },
      });
      expect(searchedGraph.items.some((item: { id: string }) => item.id === 'business:test')).toBe(true);

      const readGraphNode = await tool.execute({
        domain: 'knowledge_graph',
        action: 'read',
        id: createdBusinessNode.item.id,
      });
      expect(readGraphNode.item.id).toBe(createdBusinessNode.item.id);
      expect(readGraphNode.item.label).toBe('别名业务节点');

      const getGraphNode = await tool.execute({
        domain: 'knowledge_graph',
        action: 'get_node',
        id: createdScenarioNode.item.id,
      });
      expect(getGraphNode.item.id).toBe(createdScenarioNode.item.id);
      expect(getGraphNode.item.label).toBe('别名场景节点');

      const queriedGraph = await tool.execute({
        domain: 'knowledge_graph',
        action: 'query',
        query: '收单',
      });
      expect(queriedGraph.items.some((item: { id: string }) => item.id === 'business:test')).toBe(true);

      const createdServer = await tool.execute({
        domain: 'mcp',
        action: 'create',
        payload: {
          name: 'Example MCP',
          url: 'https://example.com/mcp',
          transport: 'http',
          auth: null,
          enabled: true,
        },
      });
      expect(createdServer.ok).toBe(true);

      const listedServers = await tool.execute({ domain: 'mcp', action: 'list' });
      expect(listedServers.items.some((item: { name: string }) => item.name === 'Example MCP')).toBe(true);

      const createdSkill = await tool.execute({
        domain: 'skills',
        action: 'create',
        payload: {
          name: 'demo_skill',
          description: 'Demo skill',
          content: '# Demo skill\n\nBody.',
        },
      });
      expect(createdSkill.ok).toBe(true);

      const fetchedSkill = await tool.execute({ domain: 'skills', action: 'get', id: 'demo_skill' });
      expect(fetchedSkill.item.name).toBe('demo_skill');

      const listedTools = await tool.execute({ domain: 'tools', action: 'list', query: 'system' });
      expect(listedTools.items.some((item: { name: string }) => item.name === 'system_settings')).toBe(true);

      const deletedSkill = await tool.execute({ domain: 'skills', action: 'delete', id: 'demo_skill' });
      expect(deletedSkill.ok).toBe(true);

      const listedSkills = await tool.execute({ domain: 'skills', action: 'list' });
      expect(listedSkills.items.some((item: { name: string }) => item.name === 'demo_skill')).toBe(false);
    } finally {
      await app?.close().catch(() => undefined);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});