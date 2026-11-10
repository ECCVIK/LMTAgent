<div align="center">

# ⚡ LMTAgent (`dsh-redteam-mode` v0.15.1)

**为 [DeepSeek Harness (DSH Desktop)](https://github.com/anywhere-labs/dsh-desktop) 打造的「WorkBuddy × DSH Brand Blue」8 角色全栈软件研发与安全审计多智能体集群**

[![DSH Plugin](https://img.shields.io/badge/DSH_Desktop-Plugin_v0.15.1-4D6BFE?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://github.com/ECCVIK/lmtagent)
[![gstack 8 Roles](https://img.shields.io/badge/Architecture-8_Roles_×_4--Wave_DAG-2563EB?style=for-the-badge)](https://github.com/garrytan/gstack)
[![PostgreSQL Engine](https://img.shields.io/badge/Fact_Store-PostgreSQL_16_+_WAL_mmap-0EA5E9?style=for-the-badge&logo=postgresql&logoColor=white)](#4-postgresql-高并发双模事实库引擎)
[![Tests Passing](https://img.shields.io/badge/Tests-18_Suites_·_888_Assertions_PASS-4D6BFE?style=for-the-badge)](#6-质量门禁与测试验证)
[![License: MIT](https://img.shields.io/badge/License-MIT-6366F1?style=for-the-badge)](LICENSE)

<p align="center">
  <b>主代理（Captain）拆解用户意图 · 7 位 <code>gstack</code> 专家子代理协同 · 默认 6 并发槽（最高 12） · 4-Wave Bounded DAG 零冲突分片构建 · WorkBuddy × DSH 品牌蓝（<code>#4D6BFE</code>）常驻工作台</b>
</p>

</div>

---

## ✨ 1. WorkBuddy × DSH Brand Blue 界面展示（UI Gallery）

参考 **WorkBuddy 现代双栏 AI 工作台美学** 并全面融合 **DSH Desktop 品牌蓝（`#4D6BFE` → `#2563EB` → `#0EA5E9`）** 视觉系统，提供左侧会话编排流 + 右侧常驻多维控制台（支持一键全屏独立窗口）：

| **① 全局态势工作台（Overview Workbench）** | **② 8 角色集群与 4-Wave DAG 监控（Agents & 6 Slots）** |
| :---: | :---: |
| ![Overview Workbench](docs/assets/ui-overview-workbench.png) | ![Agents & 4-Wave DAG](docs/assets/ui-agents-dag.png) |
| *6 大核心指标卡片、下一步行动建议与 4-Wave DAG 实时流水线* | *6 并发槽实时监控、4-Wave Bounded DAG 卡片与 8 位 `gstack` 角色名册* |
| **③ PostgreSQL 模块与资产测绘（Assets & PG Engine）** | **④ V2 工程交付与安全审计报告（Delivery Report V2）** |
| ![Assets & PostgreSQL Topology](docs/assets/ui-assets-pg.png) | ![Engineering & Security Report V2](docs/assets/ui-report-v2.png) |
| *基于 PostgreSQL Wire v3 + `GIN tsvector` 全文检索的分片模块管理* | *CSO 与 QA 双重签发，一键导出独立 HTML / Word (`.docx`) / Markdown* |

---

## 🧠 2. 核心设计理念：8 角色 `gstack` 虚拟研发团队内化

本项目将 [Garry Tan `gstack`](https://github.com/garrytan/gstack) 的虚拟工程团队方法论深度内化到 [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) 的 Cordis 插件与 Subagent 委派机制中。**主代理（Captain）只负责拆解意图与调度 6 并发槽，绝不越俎代庖写业务代码；所有编码、设计、架构、审计、测试与发布均由具备专属预设与工具链的 7 位叶子专家子代理完成：**

| 序号 | 角色 ID | 预设 ID (`agentPreset`) | 对齐 `gstack` 角色与核心技能 | 核心职责与输出契约 |
| :---: | :--- | :--- | :--- | :--- |
| **⓪** | **`plan`** | `redteam`（主会话） | **Captain / 主控总指挥** | 拆解用户意图、通过 `redteam_agent_slot` 管理 6 并发槽、按 4-Wave DAG 派发子代理、核对事实库并向用户汇报 |
| **①** | **`recon`** | `redteam-worker-recon` | **CEO / 产品与需求规划** (`/office-hours`, `/plan-ceo-review`) | 全量盘点需求边界、仓库模块拓扑与外部攻击面，标注 **P0/P1/P2** 优先级写入事实库 |
| **②** | **`designer`** | `redteam-worker-designer` | **Designer / 交互与视觉设计** (`/plan-design-review`, `/design-shotgun`) | 制定 DSH Desktop 插件 UI 组件树、CSS 变量令牌（`--wb-blue`）与空态/加载/错误三态交互契约 |
| **③** | **`assess`** | `redteam-worker-assess` | **Eng Manager / 架构与排期** (`/plan-eng-review`) | 冻结接口 Schema、数据流边界，并将开发任务切分为 **最多 6 个文件无交集分片（File-Disjoint Sharding）** |
| **④** | **`vuln-scan`** | `redteam-worker-vuln-scan` | **Reviewer & CSO / 审查与安全** (`/review`, `/cso`) | 执行静态代码质量审查、并发竞态排查与 OWASP Top 10 / STRIDE 安全漏洞扫描 |
| **⑤** | **`exploit`** | `redteam-worker-exploit` | **Builder / 全栈研发与构建**（Wave 3 主力 6 并发） | 在独占文件分片内高并发编写核心业务代码、Cordis 插件逻辑、数据库迁移与深度验证脚本 |
| **⑥** | **`qa`** | `redteam-worker-qa` | **QA Lead / 质量保障与测试** (`/qa`, `/benchmark`) | 运行全量单元/集成测试套件、浏览器端到端回归与性能基线，独立复核 `verified` 交付成果 |
| **⑦** | **`internal`** | `redteam-worker-internal` | **Doc & Release / 文档与发布** (`/ship`, `/document-release`) | 同步架构文档、CHANGELOG、跨模块集成冒烟与 V2 标准交付报告生成 |

---

## 🔄 3. 4-Wave Bounded DAG 最优执行排布与 6 并发槽模型

针对多智能体并行开发最常见的三大痛点（**写文件冲突**、**数据库写锁争用**、**API 速率挤占**），集群采用 **4-Wave 有界无环图（Bounded DAG）** 调度拓扑，默认开放 **6 个并发槽**（可在控制台实时调节 `1–12`，立即生效无需重启）：

```mermaid
flowchart LR
  User(["👤 用户需求输入"]) --> Captain["⓪ Captain (plan)<br/>主控意图拆解与 6 槽闸门"]

  subgraph Wave1["Wave 1 · 双轨立项 (2 Slots)"]
    direction TB
    R1["① recon (CEO)<br/>需求边界与模块测绘"]
    R2["② designer (Designer)<br/>UI 规范与设计令牌"]
  end

  subgraph Wave2["Wave 2 · 架构单点锁 (1 Slot)"]
    direction TB
    R3["③ assess (Eng Manager)<br/>接口契约冻结 + 6 分片切分"]
  end

  subgraph Wave3["Wave 3 · 满载并发构建 (6 Slots)"]
    direction TB
    B1["⑤ exploit #1 · Shard A"]
    B2["⑤ exploit #2 · Shard B"]
    B3["⑤ exploit #3..#6 · Shards C–F"]
  end

  subgraph Wave4["Wave 4 · 双轨门禁与发布 (2→1 Slots)"]
    direction TB
    G1["④ vuln-scan (CSO)<br/>代码审查与安全审计"]
    G2["⑥ qa (QA Lead)<br/>全量测试与性能基线"]
    G3["⑦ internal (Release)<br/>文档同步与报告签发"]
    G1 --> G3
    G2 --> G3
  end

  Captain --> Wave1 --> Wave2 --> Wave3 --> Wave4
```

- **文件无交集分片锁（File-Disjoint Sharding）**：Wave 2 的 `assess`（Eng Manager）显式为每个子任务分配独占的文件写入集，使 Wave 3 的 6 个 `exploit`（Builder）槽位能够以 100% 并发效率编码而零合并冲突。
- **实时并发槽闸门（`redteam_agent_slot`）**：支持通过「智能体」页签或环境变量 `REDTEAM_MAX_AGENTS=6` 动态控制并发度（默认 `6`，上限 `12`）。

---

## 🐘 4. PostgreSQL 高并发双模事实库引擎

为支撑 6–12 个并发智能体同时高频读写资产、任务分片、测试记录与知识库，存储层（`packages/redteam-store/lib/pg-engine.js`）升级为 **PostgreSQL Wire Protocol v3 + 零配置高并发 WAL 双模引擎**：

1. **外部 PostgreSQL 集群模式（配置 `REDTEAM_PG_URL` 或 `POSTGRES_URL`）**：
   - 原生实现零依赖 **PostgreSQL Wire Protocol v3** 客户端（支持 `Trust`、`Cleartext` 与 `SCRAM-SHA-256` 认证）。
   - 按项目/靶标自动创建独立 Schema（`CREATE SCHEMA IF NOT EXISTS rt_<engagement_id>`），实现租户级强隔离。
   - 生成完整的 PostgreSQL DDL（含 `JSONB` 扩展字段与 `GIN (to_tsvector('simple', ...))` 全文检索索引）。
2. **零配置高并发本地模式（未配置外部 PG 时自动启用）**：
   - 自动启用 **WAL 预写日志 + 256MB `mmap` 内存映射 + 64MB 页缓存 + 15000ms 忙等待锁**，彻底消除 6 槽并发写入时的 `SQLITE_BUSY` 锁冲突。

```bash
# 可选：连接高性能 PostgreSQL 16 实例（支持连接池大小配置）
export REDTEAM_PG_URL="postgres://postgres:password@127.0.0.1:5432/dsh_cluster"
export REDTEAM_PG_POOL_MAX=12
export REDTEAM_MAX_AGENTS=6
```

---

## 🚀 5. 安装与使用指南（DSH Desktop & CLI）

### 方式一：在 DSH Desktop 插件市场中一键导入（推荐）

打开 **[DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)** → 进入「插件市场」→ 点击右上角 **「导入插件」**，粘贴以下一段完整描述即可自动识别并安装：

> 我想安装 LMTAgent（dsh-redteam-mode v0.15.1）全栈软件研发与安全审计多智能体集群插件，仓库地址是 https://github.com/ECCVIK/lmtagent ，主包路径就在仓库根目录（或者 packages/redteam-bundle），入口补丁配置是 cordis.patch.yml，前端工作台入口是 lib/client.js。它内置了参考 gstack 的 8 位研发角色（Captain 主控 + CEO / Designer / Eng Manager / Reviewer & CSO / Builder / QA Lead / Doc & Release）、默认 6 并发槽（4-Wave Bounded DAG 调度）、WorkBuddy × DSH 品牌蓝常驻控制台以及 PostgreSQL 高并发事实库引擎，请帮我直接安装并启用该插件。

### 方式二：通过命令行安装

```bash
# 从 GitHub 仓库直接安装进当前 DSH 环境
dsh plugin add github:ECCVIK/lmtagent

# 或克隆仓库进行本地构建与开发调试
git clone https://github.com/ECCVIK/lmtagent.git
cd lmtagent
node packages/redteam-bundle/tools/build.mjs
```

---

## 🧪 6. 质量门禁与测试验证

仓库内置 **18 个零依赖自动化测试套件（共 888 条断言）**，覆盖 PostgreSQL 引擎协议解析、8 角色提示词契约、6 并发槽会话隔离、WorkBuddy × DSH Blue UI 渲染树、无障碍键盘交互以及单包发行安全自检：

```bash
# 重新编译单包产物并校验同步一致性
node packages/redteam-bundle/tools/build.mjs
node packages/redteam-bundle/tools/build.mjs --check

# 运行全量 18 个测试套件（888 条断言）
node packages/redteam-bundle/tools/test-all.mjs

# 重新生成 4 张 Retina 2x 工作台截图
node scripts/capture-ui-screenshots.mjs
```

---

## 📂 7. 仓库目录结构

```text
ECCVIK/lmtagent
├── packages/
│   ├── redteam-store/      # PostgreSQL Wire v3 引擎 (pg-engine.js) + 8 角色 gstack 提示词 + V2 报告生成
│   ├── redteam-tools/      # 30+ 研发与审计工具 + 6 并发槽闸门 (concurrency.js) + 会话强隔离
│   ├── redteam-ui/         # WorkBuddy × DSH Brand Blue (#4D6BFE) 样式表 (styles.js) 与常驻控制台 (client.js)
│   └── redteam-bundle/     # 单包合成器 (tools/build.mjs) 与全量测试入口 (tools/test-all.mjs)
├── preset/                 # Captain 主会话预设 (agent.cordis.yml) 与执行角色预设 (worker.cordis.yml)
├── skills/                 # 随包分发的 29+ 专项工程与安全审计技能书
├── scripts/                # UI 高清截图生成脚本 (capture-ui-screenshots.mjs) 与环境自举工具
└── docs/assets/            # WorkBuddy × DSH Blue 工作台高清实机截图
```

---

## 🙏 致谢与参考生态

- **[anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop)** —— 为 DeepSeek Harness (DSH) 插件生态打造的现代化桌面端解决方案（「万物皆插件，桌面本身也是插件」）。
- **[garrytan/gstack](https://github.com/garrytan/gstack)** —— Garry Tan 的虚拟工程团队角色体系（CEO, Designer, Eng Manager, Reviewer/CSO, Builder, QA Lead, Release Manager）。
- **WorkBuddy Design System** —— 现代 AI 协同工作台双栏布局与高可读性卡片视觉规范（适配 DSH 品牌蓝 `#4D6BFE`）。
