# Copilot 工作约定

## 1. 技能优先使用

使用以下技能，主动加载并用于任务实施，无需用户在提示词中重复要求：
- `using-superpowers`（技能发现与调用）
- `frontend-design`（前端界面设计与实现）
- `andrej-karpathy-skills`（LLM loop迭代要求）
- `design-taste-frontend`（前端开发设计）
- `impeccable` (前端开发设计)
- `ui-ux-pro-max` (前端开发规范)

## 2. 浏览器测试方式

**禁止**使用 E2E 测试用例（如 Playwright test runner）。  
测试与验证浏览器行为时，使用：
- VS Code 内置浏览器（Simple Browser / Preview）
- MCP 控制浏览器的方式（如 `mcp_microsoft_pla_browser_*` 或 `mcp_io_github_chr_*` 工具）

## 3. 禁止通过命令行编辑代码文件

**严禁**在 Windows 环境下通过 PowerShell 或任何命令行工具对代码文件进行编写或修改。这类操作可能导致文件编码永久损坏（如 BOM 污染、换行符错乱等严重问题）。  
所有文件修改必须通过编辑器工具（`replace_string_in_file`、`create_file` 等）完成。

## 4. 浏览器页面须完整浏览

使用 Playwright MCP 操作浏览器获取页面信息时：
- 必须滚动页面到底部，确保完整查看所有内容
- 对长页面进行长截图或多次截图，覆盖全部内容
- 页面中的功能说明图片可能包含关键信息，不可遗漏

## 5. 基于真实数据，直面问题

所有功能必须基于真实数据或已实现的接口：
- **禁止**使用 mock 数据或跳过问题
- 遇到问题直接定位并解决
- 问题解决后继续推进任务，确保完整交付

## 6. 清理临时文件并更新文档

任务完成后：
- 清理所有临时测试产生的图片、脚本、文件（如 `tmp-*`、测试截图等）
- 更新本次修复、优化相关的项目文档（`docs/` 目录下对应文档）

## 7. 代码提交
每次涉及代码、配置、文档或其他仓库文件修改的 agent 任务完成后，必须执行完整的 Git 收尾流程，不允许停留在“本地已改但未提交”的状态：
- 先检查并清理本次任务产生的临时文件、测试产物和不应入库的运行时数据
- 使用英文提交信息准确描述本次修改内容
- 提交到当前分支后立即 push 到远程私有仓库
- 只有在 commit 和 push 都成功后，任务才算完成

## 8. 代码质量
注意任何改动需要评估和检查方法可能造成的关联影响，避免改动应到到系统中其他的关联逻辑出现意外错误。

---

## 9. 前端 UI 框架约定（Radix UI 优先）

**前端所有交互式 UI 组件，必须以 Radix UI 为主要基础框架。**

### 9.1 已封装的基础组件（统一从 `components/ui` 导入）

| 组件 | 文件 | Radix 包 | 用途 |
|------|------|---------|------|
| `<Tooltip>` / `<TooltipProvider>` | `components/ui/Tooltip.tsx` | `@radix-ui/react-tooltip` | 图标 hover 提示 |
| `<Dialog>` / `<DialogContent>` / `<DialogTrigger>` | `components/ui/Dialog.tsx` | `@radix-ui/react-dialog` | 确认框、模态弹窗 |
| `<DropdownMenu>` 系列 | `components/ui/DropdownMenu.tsx` | `@radix-ui/react-dropdown-menu` | 下拉菜单、操作菜单 |
| `<ScrollArea>` | `components/ui/ScrollArea.tsx` | `@radix-ui/react-scroll-area` | 自定义滚动条的内容区域 |
| `<Separator>` | `components/ui/Separator.tsx` | `@radix-ui/react-separator` | 水平/垂直分割线 |

**导入规范**：
```tsx
// ✅ 正确：从统一出口导入
import { Tooltip, TooltipProvider, Dialog, DialogContent, ScrollArea, Separator } from '../components/ui';

// ❌ 禁止：直接导入 Radix 原始包
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
```

### 9.2 新增交互组件的开发规范

1. **Dialog / 弹窗**：使用 `<Dialog>` + `<DialogContent>`，禁止使用原生 `<dialog>` 或 `position:fixed` 手写弹窗
2. **Tooltip / 悬浮提示**：使用 `<Tooltip>` 包裹，特别是折叠状态下的图标按钮
3. **下拉菜单**：使用 `<DropdownMenu>` 系列组件，禁止手写绝对定位 dropdown
4. **滚动区域**：列表、消息流、内容面板使用 `<ScrollArea>`，避免原生 `overflow-y-auto` 在 Radix 布局中出现样式冲突
5. **分割线**：使用 `<Separator>` 替代 `<div className="h-px bg-xxx" />`

### 9.3 样式规范（Tailwind CSS + 项目色板）

所有 Radix 组件样式使用 **Tailwind CSS** 工具类，遵循项目标准色板：

| 用途 | 颜色值 |
|------|--------|
| 主背景 | `#0f1220` |
| 侧边栏/Header | `#0d1019` |
| 卡片背景 | `#161a2c` |
| 悬浮/激活背景 | `#1e2340` |
| 边框/分割线 | `#2a3054` |
| 主文字 | `#e6e8f2` |
| 次级文字 | `#8d92a8` |
| 弱化文字 | `#5d6380` |
| 主题蓝（accent） | `#6b8afe` |
| 成功绿 | `#30d158` |
| 警告黄 | `#ffba08` |
| 危险红 | `#ff5a5f` |

### 9.4 尚未封装的 Radix 组件（需要时按规范新增）

如需以下功能，在 `packages/web/src/components/ui/` 下新建对应封装文件，并在 `index.ts` 中导出：
- `@radix-ui/react-select` → Select 下拉选择框
- `@radix-ui/react-checkbox` → Checkbox 复选框
- `@radix-ui/react-switch` → Switch 开关
- `@radix-ui/react-tabs` → Tabs 标签页
- `@radix-ui/react-popover` → Popover 气泡弹出框
- `@radix-ui/react-accordion` → Accordion 折叠面板
- `@radix-ui/react-avatar` → Avatar 用户头像

安装方式：`pnpm --filter @risk-agent/web add @radix-ui/react-<name>`
