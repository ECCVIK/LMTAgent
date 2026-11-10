<div align="center">

# ⚡ LMTAgent (`dsh-redteam-mode` v0.15.1)

**为 [DeepSeek Harness (DSH Desktop)](https://github.com/anywhere-labs/dsh-desktop) 打造的「WorkBuddy × DSH Brand Blue」8 角色全栈软件研发与安全审计多智能体集群**

[![DSH Plugin](https://img.shields.io/badge/DSH_Desktop-Plugin_v0.15.1-4D6BFE?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://github.com/ECCVIK/lmtagent)
[![gstack 8 Roles](https://img.shields.io/badge/Architecture-8_Roles_×_4--Wave_DAG-2563EB?style=for-the-badge)](https://github.com/garrytan/gstack)
[![PostgreSQL Engine](https://img.shields.io/badge/Fact_Store-PostgreSQL_16_+_WAL_mmap-0EA5E9?style=for-the-badge&logo=postgresql&logoColor=white)](#4-postgresql-高并发双模事实库引擎)
[![Tests Passing](https://img.shields.io/badge/Tests-18_Suites_·_888_Assertions_PASS-4D6BFE?style=for-the-badge)](#6-质量门禁与测试验证)

<p align="center">
  <b>主代理（Captain）拆解用户意图 · 7 位 <code>gstack</code> 专家子代理协同 · 默认 6 并发槽（最高 12） · 4-Wave Bounded DAG 零冲突分片构建 · WorkBuddy × DSH 品牌蓝（<code>#4D6BFE</code>）常驻工作台</b>
</p>

</div>

---

## ✨ 1. WorkBuddy × DSH Brand Blue 界面展示（UI Gallery）

参考 **WorkBuddy 现代双栏 AI 工作台美学** 并全面融合 **DSH Desktop 品牌蓝（`#4D6BFE` → `#2563EB` → `#0EA5E9`）** 视觉系统，提供左侧会话编排流 + 右侧常驻多维控制台（支持一键全屏独立窗口）：

| **① 全局态势工作台（Overview Workbench）** | **② 8 角色集群与 4-Wave DAG 监控（Agents & 6 Slots）** |
| :---: | :---: |
| ![Overview Workbench](https://raw.githubusercontent.com/ECCVIK/lmtagent/main/docs/assets/ui-overview-workbench.png) | ![Agents & 4-Wave DAG](https://raw.githubusercontent.com/ECCVIK/lmtagent/main/docs/assets/ui-agents-dag.png) |
| *6 大核心指标卡片、下一步行动建议与 4-Wave DAG 实时流水线* | *6 并发槽实时监控、4-Wave Bounded DAG 卡片与 8 位 `gstack` 角色名册* |
| **③ PostgreSQL 模块与资产测绘（Assets & PG Engine）** | **④ V2 工程交付与安全审计报告（Delivery Report V2）** |
| ![Assets & PostgreSQL Topology](https://raw.githubusercontent.com/ECCVIK/lmtagent/main/docs/assets/ui-assets-pg.png) | ![Engineering & Security Report V2](https://raw.githubusercontent.com/ECCVIK/lmtagent/main/docs/assets/ui-report-v2.png) |
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

- **Wave 1（双轨立项，2 槽）**：并行派发 `recon`（CEO）+ `designer`（Designer）摸清需求、仓库拓扑与 UI 规范。
- **Wave 2（架构单点锁，1 槽）**：派发 `assess`（Eng Manager）冻结接口契约与文件无交集的开发分片（File-Disjoint Sharding）。
- **Wave 3（高并发分片构建，满载 6 槽）**：并行派发最多 6 个 `exploit`（Builder）在各自独占文件集内编码与自测。
- **Wave 4（双轨门禁与收尾，2 槽 → 1 槽）**：并行派发 `vuln-scan`（Reviewer & CSO）+ `qa`（QA Lead）审计测试，通过后由 `internal`（Doc & Release）收口发布。

---

## 🐘 4. PostgreSQL 高并发双模事实库引擎

存储层支持 `REDTEAM_PG_URL`（PostgreSQL Wire Protocol v3 + Schema 隔离 + `GIN tsvector` 全文检索），未配置外部实例时自动启用零配置高并发 `256MB mmap WAL` 引擎：

```bash
export REDTEAM_PG_URL="postgres://postgres:password@127.0.0.1:5432/dsh_cluster"
export REDTEAM_PG_POOL_MAX=12
export REDTEAM_MAX_AGENTS=6
```

---

## 🚀 5. 在 DSH Desktop 中一键导入

在 **DSH Desktop** 的「插件市场 → 导入插件」中粘贴：

> 我想安装 LMTAgent（dsh-redteam-mode v0.15.1）全栈软件研发与安全审计多智能体集群插件，仓库地址是 https://github.com/ECCVIK/lmtagent ，主包路径就在仓库根目录（或者 packages/redteam-bundle），入口补丁配置是 cordis.patch.yml，前端工作台入口是 lib/client.js。请帮我直接安装并启用该插件。
