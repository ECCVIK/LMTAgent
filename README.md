<div align="center">

# ⚡ LMTAgent (`v0.16.0`)

**为 [DeepSeek Harness (DSH Desktop)](https://github.com/anywhere-labs/dsh-desktop) 打造的「WorkBuddy × DSH Brand Blue」8 角色全栈软件研发集群与可视化多智能体编排工作台**

[![DSH Plugin](https://img.shields.io/badge/DSH_Desktop-LMTAgent_v0.16.0-4D6BFE?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://github.com/ECCVIK/LMTAgent)
[![gstack 8 Roles](https://img.shields.io/badge/Architecture-8_Roles_×_Recursive_DAG-2563EB?style=for-the-badge)](https://github.com/garrytan/gstack)
[![Workflow One](https://img.shields.io/badge/Orchestrator-dsh--harness--one_DAG_+_Doc_Wall-0EA5E9?style=for-the-badge)](https://github.com/chumingjun/dsh-harness-one)
[![PostgreSQL Probe](https://img.shields.io/badge/Fact_Store-PostgreSQL_16_Theme--Adaptive_Probe-4D6BFE?style=for-the-badge&logo=postgresql&logoColor=white)](#4-主题自适应-postgresql-实时写表活动探针与双模存储引擎)
[![Tests Passing](https://img.shields.io/badge/Tests-18_Suites_·_888_Assertions_PASS-6366F1?style=for-the-badge)](#6-质量门禁与测试验证)

<p align="center">
  <b>主代理（Captain）意图拆解 · 7 位 <code>gstack</code> 专家子代理协同 · 支持子代理递归派发微任务（<code>maxDepth: 3</code>，默认 <code>thinking: low</code>） · <code>1–12</code> 并发槽在线调节（默认 6） · 当前会话实时同步与自由切换 · 实际参与角色实时决策流预览 · 主题自适应 PG 写表活动探针</b>
</p>

</div>

---

## ✨ 1. 模块化 Bento 仪表盘与 `dsh-harness-one` 可视化工作流画布展示（UI Gallery）

纯粹面向现代多智能体全栈软件工程研发，深度融合 **当前会话实时同步与 Token 遥测（`p1`）**、**实际应用角色实时决策流与舒展单列布局（`p2`）**、**[chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one) 可视化多智能体 DAG 编排画布 / 文稿主从墙 / 飞书通知（`p3`）** 以及 **主题自适应 PG 实时写表探针（`p4`）**：

| **① 会话实时同步、Token 遥测与主题自适应 PG 写表探针（`p1` + `p2` + `p4`）** | **② 可视化多智能体 DAG 编排画布与并发槽在线调节（`p3` + `dsh-harness-one`）** |
| :---: | :---: |
| ![Overview Bento Workbench](docs/assets/ui-overview-workbench.png) | ![Visual Multi-Agent DAG & Concurrency](docs/assets/ui-agents-dag.png) |
| *自动同步当前打开的 DSH 会话并支持下拉框切换任意工作区/会话、真实读取会话 Token 遥测、明暗主题无缝自适应 PG 写表探针* | *顶栏 `6/12` 并发槽步进/快捷胶囊、子代理递归派发 (`maxDepth: 3`, `thinking: low`)、可视化 DAG 节点连线画布（含断点续跑）与 2×4 角色矩阵* |
| **③ PostgreSQL 16 实时写表活动探针与无冲突文件分片（PG Live Probe）** | **④ `dsh-harness-one` 文稿主从墙与飞书群聊报告推送（Doc Wall & Feishu）** |
| ![PostgreSQL Live Write Probe & Shards](docs/assets/ui-assets-pg.png) | ![Doc Wall & Feishu Bot Delivery](docs/assets/ui-report-v2.png) |
| *6 个 File-Disjoint 无冲突分片锁检查器 + PostgreSQL 16 实时表级写入监控 (`modules` / `dag_nodes` / `subagents`)* | *左侧按拓扑顺序列出 DAG 节点产物条带，右侧大卡预览 V2 研发交付文稿与飞书 Webhook 自动推送回执* |

---

## 🧠 2. 核心设计理念：8 角色 `gstack` 虚拟研发团队 + 实时角色决策流预览（`thinking: low`）

本项目将 [Garry Tan `gstack`](https://github.com/garrytan/gstack) 的虚拟工程团队与 [chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one) 的可视化工作流编排深度融合至 [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop)：

- **零幻觉 · 实际参与角色实时决策流**：未派发子代理时保持纯净待命态；仅当角色实际被调用或写库时，在控制台实时预览各角色的任务目标、工具调用、关键决策与输出摘要。
- **主代理拆解 + 子代理递归派发（`maxDepth: 3`）**：除主代理（Captain `plan`）可按 4-Wave DAG 派发 7 类专家子代理外，**所有子代理均挂载 `@deepseek-ai/dsh-tool-subagent`（`maxDepth: 3`）**，遇到局部子问题（如单文件重构、子模块测试修复、独立契约校验）时可自主递归派发轻量级 `Sub-Worker` 协同解决。
- **子代理默认低思考开销（`thinking: low`）**：子代理与递归微任务默认以 **`thinking: low`** 模式运行，兼顾高并发响应速度与 Token 吞吐效率；用户可在控制台顶栏随时一键切换 `low / medium / high`。

| 序号 | 角色 ID | 预设名称 | 对齐 `gstack` 角色与核心技能 | 递归派发与思考策略 | 核心职责与输出契约 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **⓪** | **`plan`** | `LMTAgent 研发集群` | **Captain / 架构主控与调度** | 4-Wave 调度 · `maxDepth: 3` | 拆解用户需求、管理 6–12 并发槽、驱动实时角色决策流与断点续跑 |
| **①** | **`recon`** | `CEO / 产品与需求规划` | **CEO / 产品与需求规划** (`/office-hours`, `/plan-ceo-review`) | 可递归派发 · 默认 `low` | 全量盘点需求边界与仓库模块拓扑（`modules`），产出 PRD 文稿 |
| **②** | **`designer`** | `Designer / 交互与视觉设计` | **Designer / 交互与视觉设计** (`/plan-design-review`, `/design-shotgun`) | 可递归派发 · 默认 `low` | 制定 DSH 品牌蓝令牌、Bento 模块化布局与组件交互契约 |
| **③** | **`assess`** | `Eng Manager / 架构与排期` | **Eng Manager / 架构与排期** (`/plan-eng-review`) | 可递归派发 · 默认 `low` | 冻结接口 Schema，切分 **6 个文件无交集分片（File-Disjoint Sharding）** |
| **④** | **`vuln-scan`** | `Reviewer & CSO / 审查与安全` | **Reviewer & CSO / 审查与安全** (`/review`, `/cso`) | 可递归派发 · 默认 `low` | 静态代码质量审查、并发竞态排查与 STRIDE / OWASP 安全架构审计 |
| **⑤** | **`exploit`** | `Builder / 全栈研发与构建` | **Builder / 全栈研发与构建**（Wave 3 主力 6 并发） | 可递归派发 `Sub-Worker` · 默认 `low` | 在独占文件分片内高并发编码实现，按需派生 `Sub-Worker` 修复局部单测 |
| **⑥** | **`qa`** | `QA Lead / 质量保障与测试` | **QA Lead / 质量保障与测试** (`/qa`, `/benchmark`) | 可递归派发 · 默认 `low` | 运行全量测试套件（18 套件 888 断言）、端到端回归与性能基线门禁 |
| **⑦** | **`internal`** | `Doc & Release / 文档与发布` | **Doc & Release / 文档与发布** (`/ship`, `/document-release`) | 可递归派发 · 默认 `low` | 汇总生成「文稿主从墙」V2 研发交付报告并触发飞书群聊机器人推送 |

---

## 🔄 3. 全区域控制台入口、会话同步与 `dsh-harness-one` 可视化工作流

1. **全区域控制台唤起按钮**：
   - 自动在 DSH Desktop **左侧栏面板列表（`sidebar.panellist`）**、**会话标签页与头部操作栏（`conversation.view` / `conversation.session.header.actions`）**、**右上角工具栏（`conversation.session.header.utilities`）** 及 **输入框上方状态条（`conversation.input.dock`）** 挂载 `⚡ LMTAgent 控制台` 按钮，点击即可打开右侧常驻控制台或全屏工作台。
2. **当前会话自动同步与自由切换（`p1`）**：
   - 切换 DSH 会话时自动同步对应工作区并读取当前会话真实 Token 用量，同时支持在控制台顶部下拉菜单中直接选择并切换任意会话/工作区。
3. **实时角色决策流与可视化 DAG 画布（`p2` + `dsh-harness-one`）**：
   - 实时展示当前项目中实际参与的每个角色的任务决策、工具调用与产物摘要，支持 **断点续跑（Resume from Checkpoint）**、**单节点失败重试（Retry Node）**、**文稿主从墙（Doc Wall）** 与 **飞书群聊机器人通知（Feishu Webhook）**。

---

## 🐘 4. 主题自适应 PostgreSQL 实时写表活动探针与双模存储引擎

内置 **`PgWriteActivityProbe`（PG 写表活动实时探针，`packages/redteam-store/lib/pg-engine.js`）**：

- **明暗主题 100% 自适应（`p4`）**：探针卡片基于 DSH CSS 语义令牌自动适配浅色与深色模式，杜绝深浅色割裂；未发生写入时清晰显示待命态（`0 writes`），发生真实写库时实时展示 `INSERT / UPDATE / UPSERT` 事务流。
- **双模零冲突底座**：支持通过 `REDTEAM_PG_URL` 直连外部 **PostgreSQL 16（Wire Protocol v3 + Schema 隔离 + `GIN tsvector` 全文索引）**，未配置外部 PG 时自动启用 **256MB `mmap` + `WAL` 高并发本地引擎**（零 `SQLITE_BUSY` 写锁冲突）。

---

## 🚀 5. 安装与使用指南（DSH Desktop & CLI）

### 方式一：在 DSH Desktop 插件市场中一键导入（推荐）

打开 **[DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)** → 进入「插件市场」→ 点击右上角 **「导入插件」**，粘贴以下描述即可自动识别并安装：

> 我想安装 LMTAgent（v0.16.0）全栈软件研发集群与可视化多智能体工作流插件，仓库地址是 https://github.com/ECCVIK/LMTAgent ，主包路径在仓库根目录（或 packages/redteam-bundle），入口补丁配置是 cordis.patch.yml，前端工作台入口是 lib/client.js。它内置了 8 位 gstack 软件研发角色（支持子代理递归派发 maxDepth: 3，默认 thinking: low）、可在线调节的 6–12 并发槽、当前会话实时同步与切换、实际应用角色实时决策流预览、dsh-harness-one 可视化 DAG 画布与文稿主从墙、飞书通知以及主题自适应 PostgreSQL 实时写表活动探针，请帮我直接安装并启用该插件。

### 方式二：通过命令行安装

```bash
dsh plugin add github:ECCVIK/LMTAgent
```

---

## 🧪 6. 质量门禁与测试验证

```bash
# 重新编译单包产物并校验同步一致性
node packages/redteam-bundle/tools/build.mjs
node packages/redteam-bundle/tools/build.mjs --check

# 运行全量 18 个测试套件（888 条断言 100% 通过）
node packages/redteam-bundle/tools/test-all.mjs

# 重新生成 4 张 Retina 2x 工作台实机截图
node scripts/capture-ui-screenshots.mjs
```
