/**
 * @risk-agent/core — 核心协议、存储、QueryEngine、Tool Runtime、Agent 编排
 */

// 基础协议与领域模型
export * from './agents/base/types.js';
export * from './agents/base/AgentState.js';
export * from './agents/base/BaseAgent.js';

// Shared host contracts
export * from './browser/BrowserHostAdapter.js';

// 存储
export * from './storage/interfaces/IStructuredStore.js';
export * from './storage/interfaces/IVectorStore.js';
export * from './storage/interfaces/IGraphStore.js';
export * from './storage/interfaces/IObjectStore.js';
export * from './storage/interfaces/ILineageStore.js';
export * from './storage/registry.js';

// 迁移基础设施
export * from './storage/migration/types.js';
export { MigrationCheckpointStore } from './storage/migration/MigrationCheckpointStore.js';
export { MigrationManifestBuilder } from './storage/migration/MigrationManifestBuilder.js';
export { MigrationPlanner } from './storage/migration/MigrationPlanner.js';
export { MigrationJobRunner } from './storage/migration/MigrationJobRunner.js';

// QueryEngine + 上下文压缩 + 流式工具执行器
export * from './query/QueryEngine.js';
export * from './query/StopHooks.js';
export * from './query/TokenBudget.js';
export * from './query/ContextCompactor.js';
export * from './query/StreamingToolExecutor.js';

// Prompt 组装
export * from './prompt/PromptAssembler.js';

// LLM + ModelRouter
export * from './llm/LLMAdapter.js';
export * from './llm/ModelRouter.js';
export * from './llm/providers/MockProvider.js';
export * from './llm/providers/OpenAIProvider.js';
export * from './llm/providers/AnthropicProvider.js';
export * from './llm/providers/OllamaProvider.js';

// Tool 运行时
export * from './tools/registry/ToolRegistry.js';
export * from './tools/permissions/PermissionManager.js';
export * from './sanitizers/ToolResultSanitizer.js';
export * from './tools/builtin/ReportRenderTool.js';
// HTML 报告渲染工具（tools-skills-system.md §7.3）
export * from './tools/builtin/HtmlReportTool.js';
export * from './tools/builtin/RuleNlParseTool.js';
export * from './tools/builtin/MemoryTools.js';
export * from './tools/builtin/CoordinatorTools.js';
// Git 仓库扫描工具 (tech-stack.md §2.6 simple-git)
export * from './tools/builtin/GitScanTool.js';
export * from './tools/builtin/DeveloperProbeTools.js';
// 通用 Shell 执行工具（hermes-like autonomous CLI execution）
export * from './tools/builtin/ShellExecTool.js';
// 风控专属工具集 (tools-skills-system.md §7.3)
export * from './tools/builtin/RiskRuleTools.js';
// Worker 管理工具 (tools-skills-system.md §7.1-7.2: stop_worker / write_db / file_write)
export * from './tools/builtin/WorkerManagementTools.js';
// 数据质量检测工具 (08-tools-skills.md §8)
export * from './tools/builtin/DataQualityTool.js';
// JS 沙盒执行工具 (10-sandbox-security.md §2)
export * from './tools/builtin/JsSandboxTool.js';
// 以下工具完整导出（08-tools-skills.md §6 全量工具表）
export * from './tools/builtin/AskUserTool.js';
export * from './tools/builtin/DatabaseQueryTool.js';
export * from './tools/builtin/ExternalDatabaseTool.js';
export * from './tools/builtin/FileParserTool.js';
export * from './tools/builtin/GraphTools.js';
export * from './tools/builtin/HttpApiTool.js';
export * from './tools/builtin/ToolSearchTool.js';
export * from './tools/builtin/VectorSearchTool.js';
export * from './tools/builtin/WebFetchTool.js';
// 业务画像与报告验证工具（08-tools-skills.md §6.2/§6.4）
export * from './tools/builtin/ProfileTools.js';
export * from './tools/builtin/ReportValidationTools.js';

// 沙盒安全基础设施 (10-sandbox-security.md)
export * from './sandbox/JsSandbox.js';
export * from './sandbox/JsSandboxHost.js';
export * from './sandbox/LocalProcessSandboxHost.js';
export * from './sandbox/SandboxRuntime.js';
export * from './sandbox/SecurityAuditService.js';

// 知识图谱统一服务层
export * from './knowledge-graph/types.js';
export { KnowledgeGraphService } from './knowledge-graph/KnowledgeGraphService.js';
export { ConflictDetector } from './knowledge-graph/ConflictDetector.js';
export { ImpactAnalyzer } from './knowledge-graph/ImpactAnalyzer.js';

// 成本与消耗
export * from './cost/CostTracker.js';

// Capability model
export * from './capabilities/types.js';
export * from './capabilities/ConnectorTemplateCatalog.js';

// Research
export * from './research/ResearchAggregator.js';
export * from './research/ResearchCoordinator.js';
export * from './research/ResearchDimensions.js';
export * from './research/AutoCorrectionLoop.js';
export * from './research/WorkerPromptTemplates.js';

// 记忆系统
export * from './memory/MemoryService.js';

// Hermes 风格人格 / 用户画像（A1 / A2，2026-04-29 实施计划）
export * from './persona/PersonaService.js';
export * from './persona/builtin/personas.js';
export * from './userProfile/UserProfileService.js';

// Harness Kernel
export * from './harness/types.js';
export * from './harness/CapabilityAdapter.js';
export { TaskPackRegistry } from './harness/TaskPackRegistry.js';
export { RunStateMachine } from './harness/RunStateMachine.js';
export { CheckpointManager, type CheckpointPersister } from './harness/CheckpointManager.js';
export { VerifierOrchestrator, type RunVerifier } from './harness/Verifier.js';
export { RunRouter } from './harness/RunRouter.js';
export { HarnessRuntime } from './harness/HarnessRuntime.js';
export { DynamicCapabilityOrchestrator } from './harness/DynamicCapabilityOrchestrator.js';

// Task Packs
export { AnalysisTaskPack } from './task-packs/analysis/AnalysisTaskPack.js';
export { GeneralTaskPack } from './task-packs/general/GeneralTaskPack.js';
export { KnowledgeQueryTaskPack } from './task-packs/knowledge/KnowledgeQueryTaskPack.js';
export { SkillManagementTaskPack } from './task-packs/skills/SkillManagementTaskPack.js';
export {
  runAnalysisWorkflow,
  produceDimension,
  buildAnalysisReport,
  expectedRuleTypesForDimension,
} from './task-packs/analysis/AnalysisWorkflow.js';

// Agent 编排
export * from './agents/OrchestratorAgent.js';
export * from './agents/PlanAgent.js';
export * from './agents/SubAgentDispatcher.js';
export * from './agents/DreamTaskRunner.js';
export * from './agents/DataSourceAgent.js';
export * from './agents/RiskRuleAgent.js';
export * from './agents/ProfileAgent.js';
export * from './agents/ProfileDiffEngine.js';
export * from './agents/GapAnalysisAgent.js';
export * from './agents/ReportAgent.js';
// 自定义代理加载器 (system-architecture.md v3.3 §2 Custom Agents)
export * from './agents/CustomAgentLoader.js';

// 技能
export * from './skills/SkillDefinition.js';
export * from './skills/resolver/SkillLoader.js';
export * from './skills/SkillGuard.js';

// 存储 + Transcript
export * from './storage/TranscriptStore.js';
// Scratchpad 跨 Worker 共享目录 (system-architecture.md v3.3 §4.3)
export * from './storage/ScratchpadStore.js';

// 工具函数
export * from './utils/taskId.js';

// 日志
export * from './logger.js';

// Observability — JSONL debug logger (system-architecture.md v3.3 §6.2)
export * from './observability/DebugLogger.js';
// Observability — OTel SQLite Span Store (v3.3-evolution-delta.md §9.1)
export * from './observability/OTelStore.js';

// QueryEngine 扩展
// ContentReplacementStore — 大工具结果压缩替换（v3.3-evolution-delta.md §6.2）
export * from './query/ContentReplacementStore.js';

// Coordinator 模式工具（v3.3-evolution-delta.md §3.4 / §4.3）
export * from './agents/coordinator/coordinatorMode.js';

// v3.3 §7 Snip Compaction 协议工具 — isSnipBoundaryMessage / SnipBoundaryMessage
// (已内嵌在 ./agents/base/types.js，随 export * 一同导出)

// v3.3 §2.5 ask() 便捷包装（已内嵌在 ./query/QueryEngine.js，随 export * 一同导出）
// v3.3 §6.1 AgentToolDefinition 扩展属性（requiresUserInteraction/isMcp/extractSearchText/isResultTruncated）
// (已内嵌在 ./tools/registry/ToolRegistry.js，随 export * 一同导出）
