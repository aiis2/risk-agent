# Docs 与代码设计对齐改进计划

> 日期：2026-04-21
> 目标：让 docs 中对“当前系统设计”的描述重新成为可信来源，并把“已实现能力”“部分实现能力”“规划中能力”明确分层。
> 范围：本次仅走查与系统设计直接相关的文档，重点覆盖 architecture、modules、development、deployment 下与 Agent 生命周期、Research、Storage、Tools/Skills、Settings Center、输出报告、项目结构有关的内容。

---

## 1. 结论摘要

当前文档体系的主要问题不是单点错误，而是三类内容被混写在一起：

- 已经落地的当前实现
- 部分落地、但文档按“已完成”口径描述的能力
- 仍属于建议方案或目标架构的设计稿

这会直接带来三个后果：

- 新开发者会把“目标态”误读成“现状”，在错误前提上继续开发。
- 前后端、桌面端、核心包对同一能力的命名和边界逐渐分叉，文档无法充当统一契约。
- 后续评审无法判断问题应归因于“实现缺口”还是“文档过期”。

本次走查后，优先级最高的偏差集中在：

- Agent 生命周期与阶段定义
- Storage 能力范围与运行时目录规范
- Settings Center 文档与已落地实现的映射关系
- Tools/Skills 协议字段与调度语义
- 报告导出能力的声明与实际交付范围

---

## 2. 差异分类原则

后续整改建议按以下三类处理：

| 类型 | 定义 | 处理原则 |
| --- | --- | --- |
| D1 文档过期 | 代码已有稳定事实，但文档未同步 | 以代码为准，优先修正文档 |
| D2 文档超前 | 文档把目标态写成现状，但代码未兑现 | 先降级文案为规划/待实现，再决定是否立项补实现 |
| D3 双方分叉 | 文档和代码都在描述同一能力，但命名、边界、语义不一致 | 先明确 truth source，再同步两侧 |

建议增加统一文档状态标记：

- current：当前实现的事实描述
- planned：已接受但尚未落地的目标设计
- proposal：仍在讨论中的候选方案

---

## 3. 关键差异矩阵

| ID | 主题 | 类型 | 优先级 | 现状差异 | 证据 |
| --- | --- | --- | --- | --- | --- |
| G1 | Agent 生命周期 | D1 | P0 | 文档将 Coordinator 主流程描述为 Research → Synthesis → Implementation → Verification；代码实际先执行独立 Pre-Phase，先跑 RiskRuleAgent 和 ProfileAgent，再进入 Research。 | 文档：[docs/architecture/agent-framework.md](../docs/architecture/agent-framework.md)，代码：[packages/core/src/agents/OrchestratorAgent.ts](../packages/core/src/agents/OrchestratorAgent.ts) |
| G2 | Storage 能力边界 | D2 | P0 | 文档宣称 StorageBackendRegistry 已支持 embedded / hybrid / external 切换与外部适配器；代码当前 bootstrap 和 init 只接通 embedded 路径，外部化更多停留在配置与控制面。 | 文档：[docs/modules/04-storage-layer.md](../docs/modules/04-storage-layer.md)、[docs/deployment/storage-profiles.md](../docs/deployment/storage-profiles.md)，代码：[packages/core/src/storage/registry.ts](../packages/core/src/storage/registry.ts)、[packages/server/src/routes/settings-storage.ts](../packages/server/src/routes/settings-storage.ts) |
| G3 | Storage 目录规范 | D3 | P0 | 文档之间、core、desktop 对数据目录约定不一致。storage-layer 文档写 db/vectors/graphs；storage-profiles 文档写 data/risk_agent.db；desktop 代码实际初始化 data/lance/graph/objects，且根目录使用 userData，而不是 exe 同级目录。 | 文档：[docs/modules/04-storage-layer.md](../docs/modules/04-storage-layer.md)、[docs/deployment/storage-profiles.md](../docs/deployment/storage-profiles.md)、[docs/deployment/desktop-app.md](../docs/deployment/desktop-app.md)，代码：[packages/core/src/storage/registry.ts](../packages/core/src/storage/registry.ts)、[packages/desktop/src/backend.ts](../packages/desktop/src/backend.ts)、[packages/desktop/src/main.ts](../packages/desktop/src/main.ts) |
| G4 | Settings Center 文档映射 | D1 + D3 | P1 | 文档仍以“建议补出文件布局”的口径描述 Storage 设置页；代码中 API、hooks、stores、组件已大量落地，但页面主体仍使用本地状态，未完全收敛到文档建议的 store/hook 架构。 | 文档：[docs/architecture/settings-center-frontend-mapping.md](../docs/architecture/settings-center-frontend-mapping.md)、[docs/architecture/settings-center-ui.md](../docs/architecture/settings-center-ui.md)，代码：[packages/web/src/pages/Settings.tsx](../packages/web/src/pages/Settings.tsx)、[packages/web/src/components/Settings/Storage/StorageSettingsPage.tsx](../packages/web/src/components/Settings/Storage/StorageSettingsPage.tsx)、[packages/web/src/stores/storageSettingsStore.ts](../packages/web/src/stores/storageSettingsStore.ts)、[packages/web/src/hooks/useStorageSettings.ts](../packages/web/src/hooks/useStorageSettings.ts) |
| G5 | Tool/Skill 协议字段 | D3 | P1 | 文档里的协议字段与代码实际接口并不完全同构，例如 shouldDefer 与 deferred、cancel/block 与 halt/wait/parallel、函数式属性与布尔属性混用。 | 文档：[docs/modules/08-tools-skills.md](../docs/modules/08-tools-skills.md)、[docs/architecture/tools-skills-system.md](../docs/architecture/tools-skills-system.md)，代码：[packages/core/src/tools/registry/ToolRegistry.ts](../packages/core/src/tools/registry/ToolRegistry.ts)、[packages/core/src/skills/resolver/SkillLoader.ts](../packages/core/src/skills/resolver/SkillLoader.ts) |
| G6 | 报告导出能力 | D2 | P1 | 文档声称 Markdown / HTML / PDF / JSON 导出均可用；代码实际已提供 JSON 详情、Markdown、HTML 路由，但 PDF 缺失，core 中 export_report 仍是占位实现。 | 文档：[docs/modules/06-output-reporting.md](../docs/modules/06-output-reporting.md)，代码：[packages/server/src/routes/reports.ts](../packages/server/src/routes/reports.ts)、[packages/core/src/tools/builtin/ReportRenderTool.ts](../packages/core/src/tools/builtin/ReportRenderTool.ts)、[packages/core/src/tools/builtin/HtmlReportTool.ts](../packages/core/src/tools/builtin/HtmlReportTool.ts)、[packages/core/src/tools/builtin/RiskRuleTools.ts](../packages/core/src/tools/builtin/RiskRuleTools.ts) |
| G7 | Research 执行语义 | D1 | P2 | 文档总体方向正确，但没有把实际的 Promise.race yield-as-ready、预算跳过可选维度、runWithDimensions 接口边界写清楚。 | 文档：[docs/architecture/research-workflow.md](../docs/architecture/research-workflow.md)，代码：[packages/core/src/research/ResearchCoordinator.ts](../packages/core/src/research/ResearchCoordinator.ts) |
| G8 | 项目结构文档 | D1 | P2 | project-structure 文档大方向仍有效，但对前端 stores、server routes、Settings 标签页与部分命名存在滞后，容易继续积累漂移。 | 文档：[docs/development/project-structure.md](../docs/development/project-structure.md)，代码：[packages/web/src/App.tsx](../packages/web/src/App.tsx)、[packages/web/src/stores](../packages/web/src/stores)、[packages/server/src/routes](../packages/server/src/routes) |

---

## 4. 分主题整改建议

### 4.1 Agent 生命周期

问题判断：当前属于文档事实层遗漏，不建议先改代码。

建议动作：

- 在 [docs/architecture/agent-framework.md](../docs/architecture/agent-framework.md) 中补入 Pre-Phase，明确 collecting → analysis → report 的阶段迁移。
- 在 [docs/architecture/system-architecture.md](../docs/architecture/system-architecture.md) 和相关流程图中区分“本地工作流阶段”和“真正的 Worker/Research 阶段”。
- 明确 RiskRuleAgent、ProfileAgent 在当前实现中承担的是预处理职责，而不是与 Research 同层并行的一般调查 Worker。

验收标准：

- 文档中的阶段图能完整解释 [packages/core/src/agents/OrchestratorAgent.ts](../packages/core/src/agents/OrchestratorAgent.ts) 的执行顺序。
- 新读者阅读文档后，不会误以为 Research 是系统入口阶段。

### 4.2 Storage 能力边界与目录规范

问题判断：这是当前最危险的混写区域，既有文档超前，也有规范分叉。

建议动作：

- 先把 [docs/modules/04-storage-layer.md](../docs/modules/04-storage-layer.md) 分成两层：
  - 当前实现能力矩阵
  - 目标态外部化能力矩阵
- 在 [docs/deployment/storage-profiles.md](../docs/deployment/storage-profiles.md) 顶部显式声明：哪些 profile 当前只是配置样例，哪些 profile 已被 registry 实际支持。
- 在 [docs/deployment/desktop-app.md](../docs/deployment/desktop-app.md) 中修正数据目录根位置，明确当前桌面端使用 `userData/risk_agent_data`，不是 exe 同级目录。
- 统一一份唯一的数据目录规范，明确以下三点：
  - 根目录来源
  - 结构化/向量/图/对象的子目录命名
  - desktop 与 core 是否允许差异化路径映射
- 若短期不实现真正的 external backend 注入与 hot-swap，则必须在文档中把这些能力降级为 planned。
- 若决定继续推进实现，则应另起执行计划，把外部适配器接入、活跃 registry 切换、迁移范围、失败回滚机制拆成独立任务。

验收标准：

- 任意一份 storage 文档都不会再把“配置可写”误写成“运行时已支持”。
- core、desktop、deployment 文档对路径规范只保留一套说法。

### 4.3 Settings Center

问题判断：文档明显落后于代码，同时代码内部也存在“已抽出 store/hook，但页面仍保留本地状态”的半收敛状态。

建议动作：

- 把 [docs/architecture/settings-center-frontend-mapping.md](../docs/architecture/settings-center-frontend-mapping.md) 从“推荐文件布局”改成“当前实现 + 待收敛项”。
- 修正路由文件名与实际目录，例如服务端当前文件是 [packages/server/src/routes/settings-storage.ts](../packages/server/src/routes/settings-storage.ts)，不是 storage-settings.ts。
- 在 [docs/architecture/settings-center-ui.md](../docs/architecture/settings-center-ui.md) 中补齐当前 8 个一级标签页：general、models、datasources、mcp、skills、storage、observability、security。
- 新增一条明确的代码整改项：让 [packages/web/src/components/Settings/Storage/StorageSettingsPage.tsx](../packages/web/src/components/Settings/Storage/StorageSettingsPage.tsx) 收敛到 [packages/web/src/stores/storageSettingsStore.ts](../packages/web/src/stores/storageSettingsStore.ts) 和相关 hooks，避免页面局部状态与全局状态两套来源长期并存。

验收标准：

- 文档中列出的 Settings Storage 组件、API、store、hooks 与仓库实际文件一一对应。
- 页面状态流的唯一来源在文档中能被清楚识别，不再出现“文档说是 store 驱动，代码却是本地 state 驱动”的隐性分叉。

### 4.4 Tool / Skill 协议

问题判断：当前更像“概念文档”和“实现接口”并存，但没有明确边界。

建议动作：

- 把 [docs/modules/08-tools-skills.md](../docs/modules/08-tools-skills.md) 定位为面向产品/架构的高层说明，避免逐字段伪同步。
- 把 [docs/architecture/tools-skills-system.md](../docs/architecture/tools-skills-system.md) 改成当前实现协议文档，字段名、枚举值、默认值直接以 [packages/core/src/tools/registry/ToolRegistry.ts](../packages/core/src/tools/registry/ToolRegistry.ts) 和 [packages/core/src/skills/resolver/SkillLoader.ts](../packages/core/src/skills/resolver/SkillLoader.ts) 为准。
- 明确哪些字段是当前生效字段，哪些只是演进方向，避免同时出现两套命名。

验收标准：

- 文档中的接口字段名、枚举值、延迟加载语义能直接映射到代码，不需要读者二次猜测。
- 协议文档不再出现“看起来很完整，但代码根本不是这个接口”的情况。

### 4.5 输出与报告

问题判断：这是“部分实现被写成完全实现”的典型区域。

建议动作：

- 立即修正 [docs/modules/06-output-reporting.md](../docs/modules/06-output-reporting.md) 中对 PDF 和对象存储持久化的现状表述。
- 明确区分三层职责：
  - core 的 Markdown/HTML 渲染能力
  - server 的下载路由能力
  - web 的下载触发与展示能力
- 对 [packages/core/src/tools/builtin/RiskRuleTools.ts](../packages/core/src/tools/builtin/RiskRuleTools.ts) 中的 export_report 占位实现做决策：
  - 若近期要支持工具导出，就补齐真实实现与测试
  - 若近期不做，就不要在文档中把它视为已可用能力
- 若 PDF 仍是明确目标，单独拉出执行项，明确生成位置、依赖和渲染来源，避免 server/core 双处重复实现。

验收标准：

- 文档中的导出能力与实际 API/工具完全一致。
- 新读者不会再从文档中推断出一个不存在的 PDF 或完整对象持久化链路。

### 4.6 Research 与项目结构文档

问题判断：偏差程度次于前几项，但属于会持续积累的慢性问题。

建议动作：

- 在 [docs/architecture/research-workflow.md](../docs/architecture/research-workflow.md) 中补写 runWithDimensions、可选维度跳过、Promise.race 的完成先出语义。
- 将 [docs/development/project-structure.md](../docs/development/project-structure.md) 从“详列所有文件”调整为“稳定目录边界 + 高频入口文件”，减少文件级清单快速过期的问题。
- 对 project-structure 中必须精确列出的清单，优先选择 routes、pages、stores 这类对外说明价值高但可脚本校验的目录。

验收标准：

- 文档仍然可用，但维护成本下降，不再因页面或路由新增导致大段结构图持续失真。

---

## 5. 分阶段执行计划

### Phase A：先修正文档事实层

范围：

- [docs/architecture/agent-framework.md](../docs/architecture/agent-framework.md)
- [docs/modules/04-storage-layer.md](../docs/modules/04-storage-layer.md)
- [docs/deployment/storage-profiles.md](../docs/deployment/storage-profiles.md)
- [docs/deployment/desktop-app.md](../docs/deployment/desktop-app.md)
- [docs/modules/06-output-reporting.md](../docs/modules/06-output-reporting.md)
- [docs/architecture/settings-center-ui.md](../docs/architecture/settings-center-ui.md)
- [docs/architecture/settings-center-frontend-mapping.md](../docs/architecture/settings-center-frontend-mapping.md)

目标：

- 把所有 P0/P1 误导性描述先收回到当前事实层。
- 所有“尚未兑现”的能力必须带 planned 标记，不再伪装成 current。

### Phase B：收敛设计与实现边界

范围：

- [packages/web/src/components/Settings/Storage/StorageSettingsPage.tsx](../packages/web/src/components/Settings/Storage/StorageSettingsPage.tsx)
- [packages/web/src/stores/storageSettingsStore.ts](../packages/web/src/stores/storageSettingsStore.ts)
- [packages/web/src/hooks/useStorageSettings.ts](../packages/web/src/hooks/useStorageSettings.ts)
- [packages/core/src/tools/builtin/RiskRuleTools.ts](../packages/core/src/tools/builtin/RiskRuleTools.ts)
- [packages/core/src/storage/registry.ts](../packages/core/src/storage/registry.ts)

目标：

- 对于已经决定保留的目标架构，消除“文档建议”和“代码实际”之间的中间态。
- 对于短期不做的目标能力，把文档中的实现承诺移除。

### Phase C：建立长期对齐机制

建议动作：

- 在 docs 目录统一增加状态字段和“代码 truth source”链接。
- 为项目结构、Settings Storage、报告导出、Storage 路径约定增加最小化校验脚本或 checklist。
- 把“改动系统契约时同步更新设计文档”加入 PR 模板或交付 checklist。
- 避免继续维护过细的“手写全量目录树”，优先维护稳定的边界文档和关键入口文档。

验收标准：

- 下次同类走查时，偏差能集中在局部实现演进，而不是大面积事实层失真。

---

## 6. 建议的落地顺序

1. 先修 P0：Agent 生命周期、Storage 能力边界、Storage 目录规范。
2. 再修 P1：Settings Center、Tool/Skill 协议、报告导出能力。
3. 最后收敛 P2：Research 细节和项目结构文档。
4. 待事实层文档稳定后，再决定是否为 external storage、PDF export、统一 Settings 状态管理单独立项。

---

## 7. 退出标准

当以下条件同时满足时，可认为本轮对齐完成：

- 所有高风险文档都标注了 current 或 planned，不再混写。
- Storage、Agent、Settings、Reporting 四个主题不存在明显误导性声明。
- 文档中的关键文件路径、路由名、标签页、能力矩阵能在代码中直接找到对应项。
- 尚未实现的能力都被明确标记为计划项，而不是现状描述。

---

## 8. 后续建议

如果要继续推进，可拆成两个后续任务：

- 任务一：文档事实层修复批次，只改 docs，不动业务代码。
- 任务二：设计收敛批次，专门处理 storage externalization、export_report、Settings 状态源统一等实现问题。