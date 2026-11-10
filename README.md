<div align="center">

# ⚡ LMTAgent (`dsh-redteam-mode` v0.15.1)

**为 [DeepSeek Harness (DSH Desktop)](https://github.com/anywhere-labs/dsh-desktop) 打造的「WorkBuddy × DSH Brand Blue」8 角色全栈软件研发集群与可视化多智能体编排工作台**

[![DSH Plugin](https://img.shields.io/badge/DSH_Desktop-Plugin_v0.15.1-4D6BFE?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://github.com/ECCVIK/lmtagent)
[![gstack 8 Roles](https://img.shields.io/badge/Architecture-8_Roles_×_Recursive_DAG-2563EB?style=for-the-badge)](https://github.com/garrytan/gstack)
[![Workflow One](https://img.shields.io/badge/Orchestrator-dsh--harness--one_DAG_+_Doc_Wall-0EA5E9?style=for-the-badge)](https://github.com/chumingjun/dsh-harness-one)
[![PostgreSQL Probe](https://img.shields.io/badge/Fact_Store-PostgreSQL_16_Live_Write_Probe-4D6BFE?style=for-the-badge&logo=postgresql&logoColor=white)](#4-postgresql-实时写表活动探针与双模存储引擎)
[![Tests Passing](https://img.shields.io/badge/Tests-18_Suites_·_888_Assertions_PASS-6366F1?style=for-the-badge)](#6-质量门禁与测试验证)

<p align="center">
  <b>主代理（Captain）意图拆解 · 7 位 <code>gstack</code> 专家子代理协同 · 支持子代理递归派发微任务（<code>maxDepth: 3</code>，默认 <code>thinking: low</code>） · <code>1–12</code> 并发槽在线调节（默认 6） · 模块化 Bento 遥测仪表盘 + <code>dsh-harness-one</code> 可视化 DAG 画布 / 文稿主从墙 / 飞书群聊推送 + PG 实时写表活动探针</b>
</p>

</div>

---

## ✨ 1. 模块化 Bento 仪表盘与 `dsh-harness-one` 可视化工作流画布展示（UI Gallery）

全面摒弃传统渗透计分冗余概念，融合 **`dsh-context` 模块化 Bento 遥测卡片（Token / 耗时双环形图 + 载荷分布条）**、**[chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one) 可视化多智能体 DAG 编排画布 / 文稿主从墙 / 飞书通知** 以及 **WorkBuddy × DSH 品牌蓝（`#4D6BFE`）** 视觉系统：

| **① 模块化 Bento 遥测仪表盘与 PG 实时写表探针（`p1` + `p2` + `p4`）** | **② 可视化多智能体 DAG 编排画布与并发槽在线调节（`p3` + `dsh-harness-one`）** |
| :---: | :---: |
| ![Overview Bento Workbench](docs/assets/ui-overview-workbench.png) | ![Visual Multi-Agent DAG & Concurrency](docs/assets/ui-agents-dag.png) |
| *5 大集群指标砖块、上下文载荷与算力分布条、Token/耗时双 SVG 环形图、左下角与底部实时 PG 写表探针* | *顶栏 `6/12` 并发槽步进/快捷胶囊、子代理递归派发 (`maxDepth: 3`, `thinking: low`)、可视化 DAG 节点连线画布（含断点续跑）与 2×4 角色矩阵* |
| **③ PostgreSQL 16 实时写表活动探针与无冲突文件分片（PG Live Probe）** | **④ `dsh-harness-one` 文稿主从墙与飞书群聊战报推送（Doc Wall & Feishu）** |
| ![PostgreSQL Live Write Probe & Shards](docs/assets/ui-assets-pg.png) | ![Doc Wall & Feishu Bot Delivery](docs/assets/ui-report-v2.png) |
| *6 个 File-Disjoint 无冲突分片锁检查器 + PostgreSQL 16 实时表级写入监控 (`modules` / `dag_nodes` / `subagents`)* | *左侧按拓扑顺序列出 DAG 节点产物条带，右侧大卡预览 V2 交付文稿与飞书 Webhook 自动推送回执* |

---

## 🧠 2. 核心设计理念：8 角色 `gstack` 虚拟研发团队 + 子代理递归派发（`thinking: low`）

本项目将 [Garry Tan `gstack`](https://github.com/garrytan/gstack) 的虚拟工程团队与 [chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one) 的可视化工作流编排深度融合至 [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop)：

- **主代理拆解 + 子代理递归派发（`maxDepth: 3`）**：除主代理（Captain `plan`）可按 4-Wave DAG 派发 7 类专家子代理外，**所有子代理均挂载 `@deepseek-ai/dsh-tool-subagent`（`maxDepth: 3`）**，遇到局部子问题（如单文件重构、子模块测试修复、独立契约校验）时可自主递归派发轻量级 `Sub-Worker` 协同解决。
- **子代理默认低思考开销（`thinking: low`）**：子代理与递归微任务默认以 **`thinking: low`** 模式运行，兼顾高并发响应速度与 Token 吞吐效率；用户可在控制台顶栏随时一键切换 `low / medium / high`。

| 序号 | 角色 ID | 预设 ID (`agentPreset`) | 对齐 `gstack` 角色与核心技能 | 递归派发与思考策略 | 核心职责与输出契约 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **⓪** | **`plan`** | `redteam`（主会话） | **Captain / 主控总指挥** | 4-Wave 调度 · `maxDepth: 3` | 拆解用户意图、管理 6–12 并发槽、驱动可视化 DAG 节点流转与断点续跑 |
| **①** | **`recon`** | `redteam-worker-recon` | **CEO / 产品与需求规划** (`/office-hours`, `/plan-ceo-review`) | 可递归派发 · 默认 `low` | 全量盘点需求边界与仓库模块拓扑（`rt_dsh.modules`），产出 PRD 文稿 |
| **②** | **`designer`** | `redteam-worker-designer` | **Designer / 交互与视觉设计** (`/plan-design-review`, `/design-shotgun`) | 可递归派发 · 默认 `low` | 制定 DSH 品牌蓝令牌、Bento 模块化布局与组件交互契约 |
| **③** | **`assess`** | `redteam-worker-assess` | **Eng Manager / 架构与排期** (`/plan-eng-review`) | 可递归派发 · 默认 `low` | 冻结接口 Schema，切分 **6 个文件无交集分片（File-Disjoint Sharding）** |
| **④** | **`vuln-scan`** | `redteam-worker-vuln-scan` | **Reviewer & CSO / 审查与安全** (`/review`, `/cso`) | 可递归派发 · 默认 `low` | 静态代码质量审查、并发竞态排查与 STRIDE / OWASP 安全审计 |
| **⑤** | **`exploit`** | `redteam-worker-exploit` | **Builder / 全栈研发与构建**（Wave 3 主力 6 并发） | 可递归派发 `Sub-Worker` · 默认 `low` | 在独占文件分片内高并发编码实现，按需派生 `Sub-Worker` 修复局部单测 |
| **⑥** | **`qa`** | `redteam-worker-qa` | **QA Lead / 质量保障与测试** (`/qa`, `/benchmark`) | 可递归派发 · 默认 `low` | 运行全量测试套件（18 套件 888 断言）、端到端回归与性能基线门禁 |
| **⑦** | **`internal`** | `redteam-worker-internal` | **Doc & Release / 文档与发布** (`/ship`, `/document-release`) | 可递归派发 · 默认 `low` | 汇总生成「文稿主从墙」V2 交付报告并触发飞书群聊机器人推送 |

---

## 🔄 3. `dsh-harness-one` 可视化多智能体 DAG 编排、断点续跑与文稿主从墙

内置参考 [chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one) 的三大核心工作流模块：

1. **可视化多智能体 DAG 画布（Visual DAG Canvas）**：
   - 实时渲染 4-Wave 8 角色节点与 `↳ Sub-Worker (thinking: low)` 递归子节点连线、节点状态、耗时与输入/输出契约。
   - 支持 **断点续跑（Resume from Checkpoint）** 与 **单节点失败重试（Retry Node）**，无需从头重跑整条研发流水线。
2. **文稿视图：运行产物主从墙（Doc Wall）**：
   - 左侧按拓扑执行顺序列出各节点文稿条带（`① CEO PRD 文稿` → `② Designer UI 令牌` → `③ 6 分片契约` → `⑤ 代码变更摘要` → `⑥ QA 回归报告` → `⑦ V2 最终交付报告`），右侧大卡片实时渲染 Markdown / SQL / 代码产物并支持一键导出 HTML / DOCX。
3. **飞书群聊机器人通知集成（Feishu Webhook Integration）**：
   - 支持配置飞书自定义机器人 Webhook，在 Wave 阶段完成、节点异常或最终报告签发时自动推送结构化战报卡片。

---

## 🐘 4. PostgreSQL 实时写表活动探针与双模存储引擎

针对左下角与态势面板的数据库可观测性需求，内置 **`PgWriteActivityProbe`（PG 写表活动实时探针，`packages/redteam-store/lib/pg-engine.js`）**：

- **表级实时写入监控**：自动拦截并统计 9 张核心集群表（`modules`、`dag_nodes`、`subagents`、`file_shards`、`qa_runs`、`code_audits`、`doc_wall`、`poc_kb`、`sessions`）的实时 `INSERT / UPDATE / UPSERT / SPAWN` 次数、当前行数、活跃写入角色（如 `exploit#2`、`sub#1a(low)`）、单次写入延迟（`0.3ms–0.6ms`）与最近 25 条 SQL 事务流。
- **双模零冲突底座**：支持通过 `REDTEAM_PG_URL` 直连外部 **PostgreSQL 16（Wire Protocol v3 + Schema 隔离 + `GIN tsvector` 全文索引）**，未配置外部 PG 时自动启用 **256MB `mmap` + `WAL` 高并发本地引擎**（零 `SQLITE_BUSY` 写锁冲突）。

---

## 🚀 5. 安装与使用指南（DSH Desktop & CLI）

### 方式一：在 DSH Desktop 插件市场中一键导入（推荐）

打开 **[DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)** → 进入「插件市场」→ 点击右上角 **「导入插件」**，粘贴以下描述即可自动识别并安装：

> 我想安装 LMTAgent（dsh-redteam-mode v0.15.1）全栈软件研发集群与可视化多智能体工作流插件，仓库地址是 https://github.com/ECCVIK/lmtagent ，主包路径在仓库根目录（或 packages/redteam-bundle），入口补丁配置是 cordis.patch.yml，前端工作台入口是 lib/client.js。它内置了 8 位 gstack 研发角色（支持子代理递归派发 maxDepth: 3，默认 thinking: low）、可在线调节的 6–12 并发槽、模块化 Bento 遥测仪表盘、dsh-harness-one 可视化 DAG 画布与文稿主从墙、飞书通知以及 PostgreSQL 实时写表活动探针，请帮我直接安装并启用该插件。

### 方式二：通过命令行安装

```bash
dsh plugin add github:ECCVIK/lmtagent
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
