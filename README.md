<div align="center">

# ⚡ LMTAgent (`v0.22.0`)

**为 [DeepSeek Harness (DSH Desktop)](https://github.com/anywhere-labs/dsh-desktop) 打造的「`lmtex` 闭环编排 × `gstack` 8 角色协同」全栈软件研发集群与工作台**

[![DSH Plugin](https://img.shields.io/badge/DSH_Desktop-LMTAgent_v0.22.0-4D6BFE?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://github.com/ECCVIK/LMTAgent)
[![Session Isolation](https://img.shields.io/badge/Session_Guard-1:1_Workbench_Isolation_+_Onboarding-0EA5E9?style=for-the-badge)](#1-核心工作台架构与可视化交互能力概览v0220)
[![ShardLock Guard](https://img.shields.io/badge/Concurrency-ShardLock_+_3min_Zombie_Reaper-2563EB?style=for-the-badge)](#3-8-角色-gstack-虚拟软件研发团队与运行时-shardlock-排他锁)
[![PostgreSQL Probe](https://img.shields.io/badge/Fact_Store-PostgreSQL_16_Digest_&_SSE_Stream-4D6BFE?style=for-the-badge&logo=postgresql&logoColor=white)](#5-主题自适应-postgresql-实时写表与摘要压缩探针)
[![Tests Passing](https://img.shields.io/badge/Tests-22_Suites_·_1130_Assertions_PASS-6366F1?style=for-the-badge)](#7-质量门禁与测试验证)

<p align="center">
  <b>本项目诞生宗旨优化许愿式编程的体验和可控，目的是让即使无编程语言基础也可以通过此项目作为流水线标准开发得到想要的软件，加上此项目，你的提示词不再会因为模型各种幻觉问题自我误导偏离你想要的开发方向，而是规划润色你的提示词，并拆解成目标并派发已经写好对应角色的子代理去开发</b>
</p>

</div>

---

## ✨ 1. 核心工作台架构与可视化交互能力概览（`v0.22.0`）

LMTAgent 专为解决大模型「许愿式编程（Wishful Programming）」中**需求模糊幻觉、跨会话状态串台、上下文膨胀、多代理并发踩踏与黑盒不可控**痛点而生，融合 [Garry Tan `gstack`](https://github.com/garrytan/gstack)、[chumingjun/dsh-harness-one](https://github.com/chumingjun/dsh-harness-one)、ComfyUI / n8n 节点编排交互以及 `lmtex` 主从闭环思想。在 `v0.22.0` 中完成了五大关键重构：

- **🧭 1:1 会话专属工作台强隔离与独立「协同与审批」首屏卡片页（`CollabApprovalTab`）**：
  - 按点开的 DSH 会话（`props.sessionId` 权威实例隔离 + `$DSH_HOME/redteam/sessions.json` 状态机）建立 1:1 专属工作台状态，彻底根除新会话或未初始化会话自动串台绑定旧项目的问题；
  - 新增置顶独立一级分区 **「协同与审批」**，集中承载**会话初始化指引卡**（支持一键创建当前会话工作台、**`跳过指引`** 及**未产生对话时随时一键重新获取指引**）、**需求澄清对话与分片立项卡**以及 **Plan & Worker 待审批决策队列卡**。
- **🧹 界面降噪去重与宿主挂载槽位精简（单一视图切换 · 6 核心槽位）**：
  - 彻底清除重复堆叠的视图切换器（仅在顶栏保留唯一紧凑切换）、重复标题栏、冗余环形图与口号式标签；将宿主槽位收敛为 6 个精准入口（移除遮挡对话输入的底部冗余条与重复侧栏文字）。
- **🖼️ 零反馈死循环水平贝塞尔派生树 + `集群 -> 智能体与并发` 全面升级至真实 `p5` 拓扑**：
  - 将水平连线 `<svg>` 置于独立绝对定位轨道（`.rt-h-fanout-col`），彻底根除 `ResizeObserver` 外框内边距反向撑高导致的画布空白问题；
  - 真实 **`集群 -> 智能体与并发`** 页签全面升级为实时 **`p5` 集群工作台**（紧凑并发与租约控制条 + 横/纵 Wave 派生树 + 两步式节点透视抽屉 + 常驻可见的 **`P0 → P3` 全宽跨 Agent 3 段式执行泳道**），并将 8 角色提示词模板解耦至独立 **`角色与提示词`** 子页签。
- **🔒 `ShardLock` 文件排他锁 + `3min` 无心跳僵尸并发槽自动回收**：
  - 运行时 `shard_locks` 排他锁即时拦截重叠文件声明；存储与遥测双层内置 **`3min` 无活跃流/日志心跳自动回收器（`reapExpiredAgentLeases`）**，冻结真实结束耗时并自动释放僵尸 `RUNNING` 槽位与文件锁。
- **⚡ `.jsonl` 字节增量尾读 + `GET /redteam/events` SSE + 100% 真实插件面板截图**：
  - 采用字节偏移增量尾读与 SSE 实时推送，并彻底移除文档截图中任何非插件自身的伪造宿主外壳，确保所见即所得。

| **① 独立「协同与审批」卡片页：1:1 会话初始化指引、需求澄清与审批队列** | **② 升级版「集群 -> 智能体与并发」（`p5` 实时拓扑 + 两步透视 + 全宽泳道）** |
| :---: | :---: |
| ![Standalone Collab & Onboarding Page](docs/assets/ui-overview-workbench.png) | ![Visual Multi-Agent DAG & Concurrency](docs/assets/ui-agents-dag.png) |
| *未绑定会话独立进入初始化指引（支持 `跳过指引` 与未对话一键重开）+ 对话式分片立项 + `-86%` 压缩摘要审批队列* | *真实 `AgentsTab` 首屏承载自适应并发租约控制、横向派生树、原位编辑/重跑透视抽屉与常驻 `P0 → P3` 3 段式泳道* |
| **③ `ShardLock` 文件排他锁矩阵、会话隔离表与 PG 16 摘要压缩探针** | **④ `lmtex` 闭环交付文稿主从墙与飞书群聊 Webhook 推送** |
| ![PostgreSQL Live Write Probe & Shards](docs/assets/ui-assets-pg.png) | ![Doc Wall & Feishu Bot Delivery](docs/assets/ui-report-v2.png) |
| *`session_onboarding` 1:1 强隔离 + `shard_locks` 文件所有权矩阵（`3min` 僵尸锁回收）+ PG 16 实时写表监控* | *基于 `worker_digests` 自动汇编研发交付文稿主从墙，支持 `feishuConfig` 在线配置与真实飞书群聊卡片推送回执* |

---

## 🔄 2. `lmtex` 闭环调用结构：Step 0 许愿润色、`1 Plan + N Workers` 拆解、压缩与审批

借鉴 `lmtex` 成熟的主从闭环调度范式，LMTAgent 在底层存储引擎（`plan_goals` / `worker_tasks` / `worker_digests` / `shard_locks`）、工具契约（`redteam_workflow`）与前端工作台中贯通标准五步流水线：

```text
[用户输入原始口语许愿 (Raw Wish)]
        │
        ▼  Step 0 · 许愿润色与目标拆解向导 (WishRefinerWizard / refineAndDecomposeWish)
┌──────────────────────────────────────────────────────────────────────┐
│ 消除模糊歧义与模型幻觉 ──► 产出结构化验收契约与阶段目标 (plan_goals) │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼  Step 1 · 运行时 ShardLock 排他锁分配与并发槽租约登记 (120s TTL)
┌──────────────────────────────────────────────────────────────────────┐
│ Level 0 · 主控 Plan 编排器                                           │
│ 锁定无交集文件分片 (shard_locks)，拦截路径重叠，保障并行写盘零冲突   │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼  Step 2 · 优先级贴标与多 Worker 递归并发派发 (P0 / P1 / P2 / P3)
┌───────────────┬───────────────┬───────────────┬──────────────────────┐
│ Worker #1     │ Worker #2     │ Worker #3     │ Worker #N            │
│ [P0 焦点审批] │ [P1 核心并发] │ [P1 核心并发] │ [P2 已审归档]        │
│ #ui-canvas    │ #pg-store     │ #sse-stream   │ #qa-gate #smoke-test │
└───────┬───────┴───────┬───────┴───────┬───────┴──────────┬───────────┘
        │               │               │                  │
        ▼  Step 3 · Worker 执行摘要压缩写回 (action: "submit_digest")
┌──────────────────────────────────────────────────────────────────────┐
│ 压缩每个执行器做了什么（what_was_done / files_touched / verification）│
│ 将数千 Token 的工具调用过程压缩 ~85%+ 写入 worker_digests 事实表     │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼  Step 4 · 原位目标微调 / 单分片重跑 / Plan 闭环审批派发新目标
┌──────────────────────────────────────────────────────────────────────┐
│ 支持 ✏️ 编辑目标 (updateWorkerGoal) · 🔄 单点重跑 (retryWorkerTask)  │
│ 或填入 nextGoal 点击「✓ Plan 审批通过并下达新目标」推进下一波次闭环  │
└──────────────────────────────────────────────────────────────────────┘
```

- **UI 渲染优先级四级标签（`ui_priority`）**：
  - **`P0 焦点审批`**：正在运行、报错阻塞、或刚刚执行完毕等待主控 Plan 审批的高优 Worker，自动置顶高亮渲染；
  - **`P1 核心并发`**：当前活跃波次并行推进的核心编码/架构分片；
  - **`P2 已审归档`**：已通过 Plan 审批并完成上下文摘要压缩归档的分片；
  - **`P3 历史快照`**：往期波次基准记录，默认折叠收纳。

---

## 🧠 3. 8 角色 `gstack` 虚拟软件研发团队与运行时 `ShardLock` 排他锁

除主代理（Captain `plan`）外，**所有专家子代理均挂载 `@deepseek-ai/dsh-tool-subagent`（`maxDepth: 3`）**，遇到局部子问题可自主递归派生轻量级 `Sub-Worker`（工作台实时追踪递归父子深度），默认以 **`thinking: low`** 低延迟高吞吐运行（顶栏支持一键切换 `low / medium / high`）：

| 序号 | 角色 ID | 预设名称 | 对齐 `gstack` 角色与核心技能 | 递归派发与思考策略 | 核心职责与输出契约 |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **⓪** | **`plan`** | `LMTAgent 研发集群` | **Captain / 架构主控与闭环审批** | 4-Wave 闭环 · `maxDepth: 3` | 润色并拆解用户许愿、分配 `ShardLock` 与 `P0~P3` 优先级、审批压缩摘要并下达 `nextGoal` |
| **①** | **`recon`** | `CEO / 产品与需求规划` | **CEO / 产品与需求规划** (`/office-hours`, `/plan-ceo-review`) | 可递归派发 · 默认 `low` | 盘点需求边界与仓库模块拓扑（`modules`），消除模糊许愿，产出结构化 PRD |
| **②** | **`designer`** | `Designer / 交互与视觉设计` | **Designer / 交互与视觉设计** (`/plan-design-review`, `/design-shotgun`) | 可递归派发 · 默认 `low` | 制定新手/专家双模式视觉令牌、画布连线规范与组件交互契约 |
| **③** | **`assess`** | `Eng Manager / 架构与排期` | **Eng Manager / 架构与排期** (`/plan-eng-review`) | 可递归派发 · 默认 `low` | 冻结接口 Schema，切分并登记 **`shard_locks` 文件排他分片**，从源头杜绝并发写冲突 |
| **④** | **`vuln-scan`** | `Reviewer & CSO / 审查与安全` | **Reviewer & CSO / 审查与安全** (`/review`, `/cso`) | 可递归派发 · 默认 `low` | 静态代码质量审查、并发租约竞态排查与软件应用安全架构审计 |
| **⑤** | **`exploit`** | `Builder / 全栈研发与构建` | **Builder / 全栈研发与构建**（主力并发执行器） | 可递归派发 `Sub-Worker` · 默认 `low` | 在独占 `ShardLock` 分片内高并发编码实现，完成后释放锁并提交 ~85%+ 压缩比 `worker_digest` |
| **⑥** | **`qa`** | `QA Lead / 质量保障与测试` | **QA Lead / 质量保障与测试** (`/qa`, `/benchmark`) | 可递归派发 · 默认 `low` | 运行全量 20 个测试套件回归门禁、模块化产物同步校验与敏感内容零命中检查 |
| **⑦** | **`internal`** | `Doc & Release / 文档与发布` | **Doc & Release / 文档与发布** (`/ship`, `/document-release`) | 可递归派发 · 默认 `low` | 基于 `worker_digests` 自动汇编「闭环交付文稿主从墙」并通过 `feishuConfig` 推送飞书群聊卡片 |

---

## 🔌 4. 全区域控制台入口、`.jsonl` 增量尾读与 SSE 实时事件流

1. **全区域控制台唤起与一键退出全屏**：在 DSH Desktop **左侧栏面板列表（`sidebar.panellist`）**、**会话头部操作栏（`conversation.session.header.actions`）**、**右上角工具栏（`conversation.session.header.utilities`）** 及 **输入框上方状态条（`conversation.input.dock`）** 挂载 `⚡ LMTAgent 控制台` 按钮；全屏浏览模式下支持顶栏 **`✕ 退出全屏 (Esc)`** 按钮与键盘 `Escape` 立即收起。
2. **增量遥测与 `GET /redteam/events` SSE 推送**：宿主侧通过原生 `tokenMeter` 与 `.jsonl` 字节偏移增量尾读实时采集会话 Token 与子代理树，并通过 `GET /redteam/events` SSE 长连接将数据库写表与节点状态变更毫秒级推送至前端。

---

## 🐘 5. 主题自适应 PostgreSQL 实时写表与摘要压缩探针

内置 **`PgWriteActivityProbe`（`packages/redteam-store/lib/pg-engine.js`）**：

- **表级写入 + 排他分片锁 + 闭环压缩多维监控**：实时追踪 `plan_goals`、`worker_tasks`、`worker_digests`、`shard_locks`、`dag_nodes` 等核心表的 `INSERT / UPDATE / UPSERT` 事务流，直观展示 **`摘要压缩率（compression_ratio_pct）`**、**`节省 Token 数`**、**`活跃分片排他锁 TTL`** 与 **`已审批 / 待审批 Worker 计数`**。
- **双模存储底座**：支持通过 `REDTEAM_PG_URL` 直连外部 **PostgreSQL 16（Wire Protocol v3 + Schema 隔离 + `GIN tsvector` 索引）**；未配置外部 PG 时自动运行于 **256MB `mmap` + `WAL` 高并发本地 SQLite 引擎**（零运行时第三方依赖）。

---

## 🚀 6. 安装与使用指南（DSH Desktop & CLI）

### 方式一：在 DSH Desktop 插件市场中一键导入（推荐）

打开 **[DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)** → 进入「插件市场」→ 点击右上角 **「导入插件」**，粘贴以下描述即可自动识别并安装：

> 我想安装 LMTAgent（v0.22.0）全栈软件研发集群与可视化多智能体工作流插件，仓库地址是 https://github.com/ECCVIK/LMTAgent ，主包路径在仓库根目录（或 packages/redteam-bundle），入口补丁配置是 cordis.patch.yml，前端工作台入口是 lib/client.js。它内置了 1:1 会话专属工作台隔离与可跳过/可重开的初始化指引、独立「协同与审批」对话与审批卡片页、精简高信噪比总览、升级版 p5 集群实时拓扑与全宽跨 Agent 泳道、运行时 ShardLock 文件排他锁与 3min 无心跳僵尸并发槽自动回收、8 位 gstack 软件研发角色（支持 maxDepth: 3 递归子代理）以及 GET /redteam/events SSE 实时流，请帮我直接安装并启用该插件。

### 方式二：通过命令行安装

```bash
dsh plugin add github:ECCVIK/LMTAgent
```

---

## 🧪 7. 质量门禁与测试验证

```bash
# 模块化组装前端样式与客户端、构建单包产物并自动同步仓库根目录 lib/
npm run build
node packages/redteam-bundle/tools/build.mjs --check

# 敏感内容闸门自检与全仓扫描（确保 0 命中）
node scripts/check-no-confidential.mjs --all

# 运行全量 22 个测试套件（含 session-isolation-v022、tabs-render 与 ui-smoke，1130 条断言 100% 通过）
npm test
```

---

## 🪞 8. 诚实自省与演进路线（Resolved in `v0.22.0` & Frontier Roadmap）

我们坚持对每一版真实用户体验与能力边界保持诚实透明——在 `v0.22.0` 中，针对真机实测暴露出的五大核心交互与隔离缺陷完成了彻底修复：

### ✅ 已在 `v0.22.0` 完成根治的真机体验缺陷

1. **根治跨会话自动串台劫持，实现 1:1 会话专属工作台与初始化状态机**：移除了 `discoverHostSessions`、`handleBootstrap` 与前端 `Panel` 将未绑定会话强制回退绑定至旧项目的所有隐式劫持逻辑；每个点开的会话独立拥有 `uninitialized / skipped / initialized` 状态，支持一键创建当前会话工作台、**`跳过指引`**，并在会话尚未产生对话时保留一键**重新获取初始化指引**入口。
2. **新增独立「协同与审批」一级卡片页，彻底分离人机交互与监控遥测**：将会话初始化指引、需求澄清对话立项与 Plan/Worker 阶段审批全部收纳进置顶独立卡片页，不再挤占总览画布或深藏于折叠抽屉。
3. **修复 `ResizeObserver` `+56px/帧` 连线膨胀导致的总览画布白屏**：将水平扇出 `<svg>` 改为独立轨道内 `position: absolute; inset: 0`，对父级网格高度零反向反馈，恢复首屏即见的水平贝塞尔工作流路线图。
4. **清除同一屏 4 处重复模式开关、冗余宿主槽位与口号式噪声**：仅在顶栏保留唯一视图切换器，移除输入框上方的冗余 `ComposerDockBar` 与侧栏重复文字，并将总览收敛为「4 项核心 KPI + 路线图 + 四阶段里程碑条」。
5. **升级真实 `集群 -> 智能体与并发` 至 `p5` 拓扑，并剔除一切伪造宿主外壳截图**：将旧版 `SLOT #1..#12` 列表替换为自适应并发租约条 + 实时派生树 + 两步透视抽屉 + 常驻 `P0 → P3` 泳道（角色提示词独立为 `角色与提示词` 子页签），同时补齐 `3min` 无心跳僵尸 `RUNNING` 槽位回收与 100% 真实插件面板截图。

### 🔭 下一步前沿攻坚方向（`v0.23+` Frontier Milestones）

1. **Cordis 内核级 `fs` 系统调用硬沙箱拦截（Kernel-Level `fs` Pre-Hook Sandbox）**：
   - 当前 `ShardLock` 已在工作流编排与任务锁层拦截越界声明，但若子代理通过原生 `tool-bash` 直接执行底层 shell 重定向写文件，仍需在 Cordis 宿主工具内核层挂载 `fs-write / bash` Pre-Hook 白名单硬拦截。
2. **基于 `pgvector` 的跨波次语义记忆检索（Neural Semantic Digest Retrieval）**：
   - 目前 `worker_digests` 支持结构化压缩与 PostgreSQL `GIN tsvector` 词法全文检索；下一步计划在外部 PG 16 模式下可选启用 `pgvector` 向量嵌入索引，让跨百个分片的长周期项目具备精准语义上下文召回能力。
3. **画布级自由拓扑连线编排（Interactive Edge Re-Wiring & Custom DAG Authoring）**：
   - 在现有原位编辑目标与单分片重跑基础上，进一步支持用户在画布上直接鼠标拖拽端口新建自定义阶段节点、可视化增删依赖边并保存为可复用的团队研发流水线模板。
4. **内部包目录历史命名的平滑兼容迁移**：
   - 为保持已安装用户的 `dsh-redteam-mode` 插件配置与本地 SQLite 历史库 100% 向前兼容，底层 workspace 目录仍保留 `redteam-*` 包名前缀，后续将通过双包别名过渡层平滑演进为统一的 `lmtagent-*` 命名空间。
