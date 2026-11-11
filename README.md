<div align="center">

# ⚡ LMTAgent (`v0.20.0`)

**为 [DeepSeek Harness (DSH Desktop)](https://github.com/anywhere-labs/dsh-desktop) 打造的「`lmtex` 闭环编排 × `gstack` 8 角色协同」全栈软件研发集群与工作台**

[![DSH Plugin](https://img.shields.io/badge/DSH_Desktop-LMTAgent_v0.20.0-4D6BFE?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://github.com/ECCVIK/LMTAgent)
[![lmtex Closed Loop](https://img.shields.io/badge/Orchestrator-1_Plan_+_N_Workers_Closed_Loop-0EA5E9?style=for-the-badge)](#2-lmtex-闭环调用结构1-plan--n-workers-目标拆解摘要压缩与审批派发)
[![gstack 8 Roles](https://img.shields.io/badge/Architecture-8_Roles_×_Recursive_DAG-2563EB?style=for-the-badge)](https://github.com/garrytan/gstack)
[![PostgreSQL Probe](https://img.shields.io/badge/Fact_Store-PostgreSQL_16_Digest_&_Probe-4D6BFE?style=for-the-badge&logo=postgresql&logoColor=white)](#5-主题自适应-postgresql-实时写表与摘要压缩探针)
[![Tests Passing](https://img.shields.io/badge/Tests-19_Suites_·_969_Assertions_PASS-6366F1?style=for-the-badge)](#7-质量门禁与测试验证)

<p align="center">
  <b>本项目诞生宗旨优化许愿式编程的体验和可控，目的是让即使无编程语言基础也可以通过此项目作为流水线标准开发得到想要的软件，加上此项目，你的提示词不再会因为模型各种幻觉问题自我误导偏离你想要的开发方向，而是规划润色你的提示词，并拆解成目标并派发已经写好对应角色的子代理去开发</b>
</p>

</div>

---

## ✨ 1. 核心工作台架构与可视化交互能力概览（`v0.20.0`）

LMTAgent 专为解决大模型「许愿式编程（Wishful Programming）」中**上下文膨胀、职责混乱、改东坏西与黑盒不可控**痛点而生，融合 [Garry Tan `gstack`](https://github.com/garrytan/gstack)、[chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one)、ComfyUI / n8n 节点编排交互以及 `lmtex` 主从闭环思想：

- **🖼️ 首屏全宽 60–120 FPS 零重绘工作流树画布**：
  - 工作流树完整占据首屏主视口（`min-height: calc(100vh - 180px)`），手抓背景平移与滚轮缩放采用 `requestAnimationFrame` + GPU `translate3d` 直写合成层（**拖拽过程 0 次 React 组件重绘**），彻底告别多节点画布掉帧卡顿。
- **➔ 默认横向向右派生树 + ⬇ 纵向向下派生备选切换**：
  - 默认采用清晰的**自左向右横向派生结构**（`Level 0 主控 Plan` ──► 水平三次贝塞尔曲线 ──► `Wave 1~4 波次汇总卡` ──► 向右展开子代理分片卡），自动折叠高密度波次防止 50+ 子代理刷屏；画布工具栏旁内置 **`⚙️ 树布局设置`** 按钮，可一键切换回传统的**纵向向下派生备选视图**。
- **🔎 两步式节点探针抽屉 + 下置 100% 全宽流程面板**：
  - 点击画布任意节点或泳道，先在画布正下方的全宽抽屉中检视三段式执行细节（`📥 委派目标` ──► `⚙️ 核心执行轨迹` ──► `📤 压缩摘要与 Plan 审批`），确认无误后再点击 **`💬 跳转侧边聊天框打开该 Agent 会话 ↗`** 精准切入对应子代理原始对话（绝不误触强跳）。
  - 下方依次全宽铺开按 `P0 → P1 → P2 → P3` 排序的**跨 Agent 3 段式执行泳道**与**响应式协作任务网格**，彻底消除窄分栏文字截断。

| **① 会话实时同步、Token 遥测与主题自适应 PG 写表探针** | **② 可视化多智能体 DAG 编排画布与并发槽在线调节** |
| :---: | :---: |
| ![Overview Bento Workbench](docs/assets/ui-overview-workbench.png) | ![Visual Multi-Agent DAG & Concurrency](docs/assets/ui-agents-dag.png) |
| *自动同步当前打开的 DSH 会话并支持下拉框切换任意工作区/会话、真实读取会话 Token 遥测、明暗主题无缝自适应 PG 探针* | *顶栏 `1–12` 并发槽在线调节、子代理递归派发 (`maxDepth: 3`, `thinking: low`)、60FPS 平移缩放工作流树与角色协同矩阵* |
| **③ PostgreSQL 16 实时写表与摘要压缩探针** | **④ `dsh-harness-one` 文稿主从墙与飞书群聊报告推送** |
| ![PostgreSQL Live Write Probe & Shards](docs/assets/ui-assets-pg.png) | ![Doc Wall & Feishu Bot Delivery](docs/assets/ui-report-v2.png) |
| *File-Disjoint 无冲突分片检查器 + PostgreSQL 实时表级写入监控 (`plan_goals` / `worker_tasks` / `worker_digests`) 与压缩率统计* | *左侧按拓扑顺序列出 DAG 节点产物条带，右侧大卡预览研发交付文稿与飞书 Webhook 自动推送回执* |

---

## 🔄 2. `lmtex` 闭环调用结构：`1 Plan + N Workers` 目标拆解、摘要压缩与审批派发

借鉴 `lmtex` 成熟的主从闭环调度范式，LMTAgent 在底层存储引擎（`plan_goals` / `worker_tasks` / `worker_digests`）、工具契约（`redteam_workflow`）与前端工作台中贯通四步标准流水线：

```text
[用户输入原始 Prompt]
        │
        ▼  Step 1 · 拿到 Prompt 即刻规划润色与拆分 (action: "decompose")
┌──────────────────────────────────────────────────────────────────────┐
│ Level 0 · 主控 Plan 编排器                                           │
│ 将模糊需求拆解为结构化阶段目标 (plan_goals) 与无交集文件分片任务     │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼  Step 2 · 优先级贴标与多 Worker 并发派发 (P0 / P1 / P2 / P3)
┌───────────────┬───────────────┬───────────────┬──────────────────────┐
│ Worker #1     │ Worker #2     │ Worker #3     │ Worker #N            │
│ [P0 焦点审批] │ [P1 核心并发] │ [P1 核心并发] │ [P2 已审归档]        │
│ #ui-canvas    │ #pg-store     │ #prompt-rule  │ #qa-gate #smoke-test │
└───────┬───────┴───────┬───────┴───────┬───────┴──────────┬───────────┘
        │               │               │                  │
        ▼  Step 3 · Worker 执行摘要压缩写回 (action: "submit_digest")
┌──────────────────────────────────────────────────────────────────────┐
│ 压缩每个执行器做了什么（what_was_done / files_touched / verification）│
│ 将数千 Token 的工具调用过程压缩 ~85%+ 写入 worker_digests 事实表     │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼  Step 4 · 主控 Plan 审批并下达新目标 (action: "approve_worker")
┌──────────────────────────────────────────────────────────────────────┐
│ 主控 Plan（或用户在工作台点击「✓ Plan 审批通过并下达新目标」）       │
│ 验收压缩摘要 ──► 标记 approved (降权归档至 P2) ──► 派发下一波次新目标 │
└──────────────────────────────────────────────────────────────────────┘
```

- **UI 渲染优先级四级标签（`ui_priority`）**：
  - **`P0 焦点审批`**：正在运行、报错阻塞、或刚刚执行完毕等待主控 Plan 审批的高优 Worker，自动置顶高亮渲染；
  - **`P1 核心并发`**：当前活跃波次并行推进的核心编码/架构分片；
  - **`P2 已审归档`**：已通过 Plan 审批并完成上下文摘要压缩归档的分片；
  - **`P3 历史快照`**：往期波次基准记录，默认折叠收纳。

---

## 🧠 3. 8 角色 `gstack` 虚拟软件研发团队（`maxDepth: 3` · 默认 `thinking: low`）

除主代理（Captain `plan`）外，**所有专家子代理均挂载 `@deepseek-ai/dsh-tool-subagent`（`maxDepth: 3`）**，遇到局部子问题可自主递归派生轻量级 `Sub-Worker`，默认以 **`thinking: low`** 低延迟高吞吐运行（顶栏支持一键切换 `low / medium / high`）：

| 序号 | 角色 ID | 预设名称 | 对齐 `gstack` 角色与核心技能 | 递归派发与思考策略 | 核心职责与输出契约 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **⓪** | **`plan`** | `LMTAgent 研发集群` | **Captain / 架构主控与闭环审批** | 4-Wave 闭环 · `maxDepth: 3` | 润色并拆解用户 Prompt、分配 `P0~P3` 优先级、审批 Worker 压缩摘要并派发后续目标 |
| **①** | **`recon`** | `CEO / 产品与需求规划` | **CEO / 产品与需求规划** (`/office-hours`, `/plan-ceo-review`) | 可递归派发 · 默认 `low` | 盘点需求边界与仓库模块拓扑（`modules`），消除模糊许愿，产出结构化 PRD |
| **②** | **`designer`** | `Designer / 交互与视觉设计` | **Designer / 交互与视觉设计** (`/plan-design-review`, `/design-shotgun`) | 可递归派发 · 默认 `low` | 制定视觉令牌、Bento 模块化布局、动效规范与组件交互契约 |
| **③** | **`assess`** | `Eng Manager / 架构与排期` | **Eng Manager / 架构与排期** (`/plan-eng-review`) | 可递归派发 · 默认 `low` | 冻结接口 Schema，切分 **文件无交集分片（File-Disjoint Sharding）** 杜绝写冲突 |
| **④** | **`vuln-scan`** | `Reviewer & CSO / 审查与安全` | **Reviewer & CSO / 审查与安全** (`/review`, `/cso`) | 可递归派发 · 默认 `low` | 静态代码质量审查、并发竞态排查与软件应用安全架构审计 |
| **⑤** | **`exploit`** | `Builder / 全栈研发与构建` | **Builder / 全栈研发与构建**（主力并发执行器） | 可递归派发 `Sub-Worker` · 默认 `low` | 在独占文件分片内高并发编码实现，完成后提交 ~85%+ 压缩比 `worker_digest` |
| **⑥** | **`qa`** | `QA Lead / 质量保障与测试` | **QA Lead / 质量保障与测试** (`/qa`, `/benchmark`) | 可递归派发 · 默认 `low` | 运行全量测试套件（19 套件 969 断言）、无障碍契约与冒烟回归门禁 |
| **⑦** | **`internal`** | `Doc & Release / 文档与发布` | **Doc & Release / 文档与发布** (`/ship`, `/document-release`) | 可递归派发 · 默认 `low` | 汇总生成「文稿主从墙」交付报告并触发飞书群聊机器人推送 |

---

## 🔌 4. 全区域控制台入口与宿主会话实时同步

1. **全区域控制台唤起按钮**：在 DSH Desktop **左侧栏面板列表（`sidebar.panellist`）**、**会话头部操作栏（`conversation.session.header.actions`）**、**右上角工具栏（`conversation.session.header.utilities`）** 及 **输入框上方状态条（`conversation.input.dock`）** 挂载 `⚡ LMTAgent 控制台` 按钮。
2. **宿主会话无感同步**：切换 DSH 会话时轻量级同步当前活跃工作区与真实 Token 遥测，并自动将宿主派生的子代理会话幂等同步至 `plan_goals / worker_tasks / worker_digests` 表。

---

## 🐘 5. 主题自适应 PostgreSQL 实时写表与摘要压缩探针

内置 **`PgWriteActivityProbe`（`packages/redteam-store/lib/pg-engine.js`）**：

- **表级写入 + 闭环压缩双维监控**：实时追踪 `plan_goals`、`worker_tasks`、`worker_digests`、`dag_nodes` 等 12 张核心表的 `INSERT / UPDATE / UPSERT` 事务流，并在探针面板直观展示 **`摘要压缩率（compression_ratio_pct）`**、**`节省 Token 数`** 与 **`已审批 / 待审批 Worker 计数`**。
- **双模存储底座**：支持通过 `REDTEAM_PG_URL` 直连外部 **PostgreSQL 16（Wire Protocol v3 + Schema 隔离 + `GIN tsvector` 索引）**；未配置外部 PG 时自动运行于 **256MB `mmap` + `WAL` 高并发本地 SQLite 引擎**（零运行时第三方依赖）。

---

## 🚀 6. 安装与使用指南（DSH Desktop & CLI）

### 方式一：在 DSH Desktop 插件市场中一键导入（推荐）

打开 **[DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)** → 进入「插件市场」→ 点击右上角 **「导入插件」**，粘贴以下描述即可自动识别并安装：

> 我想安装 LMTAgent（v0.20.0）全栈软件研发集群与可视化多智能体工作流插件，仓库地址是 https://github.com/ECCVIK/LMTAgent ，主包路径在仓库根目录（或 packages/redteam-bundle），入口补丁配置是 cordis.patch.yml，前端工作台入口是 lib/client.js。它内置了 lmtex（1 Plan + N Workers）闭环目标拆解与摘要压缩审批机制、8 位 gstack 软件研发角色（支持子代理递归派发 maxDepth: 3，默认 thinking: low）、60FPS 横向向右派生/纵向备选工作流树画布、两步式节点探针与侧边对话跳转、以及主题自适应 PostgreSQL 实时写表与压缩探针，请帮我直接安装并启用该插件。

### 方式二：通过命令行安装

```bash
dsh plugin add github:ECCVIK/LMTAgent
```

---

## 🧪 7. 质量门禁与测试验证

```bash
# 重新编译单包产物、同步根目录 lib/ 并校验一致性
npm run build
cp -rf packages/redteam-bundle/lib/* lib/
node packages/redteam-bundle/tools/build.mjs --check

# 运行全量 19 个测试套件（969 条断言 100% 通过）
npm test
```

---

## 🪞 8. 诚实自省：当前插件的不足与演进路线（Known Limitations & Roadmap）

为了真正践行「让无编程基础用户也能稳定可控地开发软件」的初心，我们坦诚梳理本插件当前阶段仍存在的核心短板与下一步攻坚方向：

1. **「提示词软约束」尚未升级为「运行时硬沙箱拦截」**：
   - 当前 `1 Plan + N Workers` 的先拆解后编码、文件无交集分片（File-Disjoint Sharding）与 `submit_digest` 摘要写回，主要依靠系统提示词约束与 UI 层幂等同步兜底。若底层模型偶发“抢跑”直接越界改文件，尚未在工具执行层（`fs-write / edit` Pre-Hook）做强制路径白名单拦截。
2. **宿主深度联动受限于非公开 SDK，存在启发式耦合**：
   - DSH Desktop 目前尚未开放官方稳定的前端 `openSession(id)` 路由 API 与流式子代理事件总线；因此会话遥测依赖本地日志增量扫描，侧边聊天框跳转需结合 `postMessage / localStorage` 与侧边栏 DOM 匹配回退，宿主大版本改版时需同步适配。
3. **前端单文件体积偏大与历史内部命名包袱**：
   - 为保持零外部构建依赖直出原生 ESM，`client.js`（7,300+ 行）与 `styles.js`（2,600+ 行）体量较大且缺乏 TypeScript 静态类型检查；同时底层包目录名（`redteam-*`）与部分旧表字段仍带有早期骨架的历史命名痕迹，后续需做无损模块拆分与 Schema 命名统一迁移。
4. **画布交互仍偏「观测与审批」，尚未实现「画布级直接拖拽编排」**：
   - 目前 60FPS 工作流树已支持横向/纵向切换、波次折叠与点击检视审批，但用户尚不能像在 ComfyUI / n8n 中那样直接在画布上拖拽连线新建自定义节点、断开重连依赖边或双击节点原位改写子代理 Prompt 单点重跑。
5. **面向纯零基础用户的「低术语引导模式」仍需加强**：
   - 工作台中仍保留了较多面向工程师的硬核指标（如 `DAG`、`Wave 1~4`、`PG Write Probe`、`P0~P3`）；下一步计划引入面向零代码用户的 **「自然语言需求润色向导（Prompt Wizard）简洁视图」**，将复杂工程遥测按需隐藏在「专家模式」之后。
