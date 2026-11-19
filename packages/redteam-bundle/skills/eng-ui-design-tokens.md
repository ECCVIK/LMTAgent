---
name: eng-ui-design-tokens
category: 工程
tags: [design-tokens, component-tree, information-architecture, four-states, ui-spec]
description: 【工程】Designer 交互与视觉设计规范：信息架构、组件树、Design Tokens 与四态交互（Loading/Empty/Error/Overflow）契约
---

# UI 信息架构、组件树与四态交互令牌规范（UI Architecture & Design Tokens）

## 适用场景（When to Use）
`Designer / designer` 角色在 **Wave 1** 参与前端/桌面端面板、工作台控制台或可视化页面设计时使用：在编码开工前锁死信息架构、组件层级、语义化 Design Tokens 与完整四态交互，消除模板化拼凑（AI Slop）、空壳按钮与布局溢出问题。

## 标准工程作业流程（Standard Operating Procedure）
1. **复用既有视觉与组件上下文**：调用 `lmt_artifact_query` 查阅已登记的 UI 规范与界面产物，并检查现有样式 Token 文件（如 CSS `:root` 与暗色主题变量映射），确保新界面与宿主视觉体系一致。
2. **构建信息架构（Information Architecture）**：明确视图主次层级、导航路径、关键操作触发点与响应式断点（Desktop / Compact Sidebar）；每个可交互控件必须绑定真实状态源与反馈行为，禁止设计无后续动作的假按钮。
3. **拆解组件树（Component Tree）与数据流**：定义容器组件与展示组件的职责边界、Props 输入、事件回调与受控状态；标注每个列表或指标卡片对应的真实后端数据源，空闲态必须真实反映 `0` 或空集，不得硬编码装饰性假指标。
4. **定义语义化 Design Tokens**：统一沉淀颜色（背景层级、主强调色、语义状态色、边框线）、字号字重、间距网格、圆角、阴影及 Light / Dark 双主题自适应变量（CSS Custom Properties），禁止在组件内散落魔法色值。
5. **锁死四态交互契约（Four-State Matrix）与渲染安全**：
   - **Loading（加载态）**：骨架屏或局部 Spinner 占位，异步提交期间置灰禁用触发按钮防重入。
   - **Empty（空状态）**：区分“尚未初始化”与“筛选无命中”，提供明确文案说明与一键引导动作。
   - **Error（错误态）**：展示可读错误摘要（非静默失败或裸堆栈），保留已填表单输入并提供“重试 / 回退”入口。
   - **Overflow（极值/溢出态）**：长字符串截断（`text-overflow: ellipsis` + `title` 提示）、超长列表（如 ≥1 万条记录）分页或虚拟滚动、窄容器弹性换行防横向滚动条溢出。
   - **渲染安全边界**：动态文本默认走转义渲染，禁止未消毒 HTML 拼接；完成后通过 `lmt_artifact_record` 落库组件树与 Token 规范，并在需要同步状态时配合 `lmt_session_info` / `lmt_workflow` 交接给 Wave 2。

## 参考命令与代码模板（Reference Snippet）
```css
/* Design Tokens 示例：语义化双主题变量与四态容器边界 */
:root {
  --ui-bg-surface: #ffffff;
  --ui-bg-subtle: #f1f5f9;
  --ui-text-primary: #0f172a;
  --ui-border-default: #e2e8f0;
  --ui-accent-primary: #4d6bfe;
  --ui-status-error: #dc2626;
}

.panel-list-item {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```
