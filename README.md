# DSH 软件研发多智能体集群（LMTAgent / DSH DevCluster）

面向 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）与 [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) 打造的**软件研发多智能体集群插件**，深度内化 [garrytan/gstack](https://github.com/garrytan/gstack) 的虚拟工程团队角色体系与哲学（Boil the Lake、Search Before Building、Fix-First 审查、证据化交付）：
只需输入用户需求或工程目标，主控智能体（Captain）即按 **4-Wave 有界 DAG 拓扑** 拆解意图并调度 **8 位专职工程角色**（默认 **6 并发槽位**），所有架构边界、模块契约、缺陷单与验收证据实时写入高性能 **PostgreSQL 事实库**（支持零配置高并发 WAL 嵌入式回退），并在右侧常驻控制台实时可视化。

**59 个结构化工程工具 · 8 位 `gstack` 专职角色 · 4-Wave DAG 调度 · 默认 6 并发槽 · PostgreSQL 双模引擎 · 5 个分区 / 9 个控制台页面**

---

## 核心架构

### 1. 八角色虚拟软件工程团队（内化 `gstack`）

| 角色代号 | 工程角色（`gstack` 映射） | 预设变体 | 核心职责 |
| --- | --- | --- | --- |
| `plan` | **主控编排与任务分发（Captain / Главный）** | `agent.cordis.yml` | 拆解用户意图、管理 6 并发槽闸门、按 4-Wave DAG 派发子任务、汇总交付报告（主会话只指挥不动手） |
| `recon` | **产品需求与代码库勘探（CEO / Product Recon）** | `worker-recon` | `/office-hours` + `/plan-ceo-review`：勘探现有仓库目录、技术栈与外部依赖，收敛 MVP 需求边界 |
| `designer` | **UI/UX 设计审查与交互规范（Designer）** | `worker-designer` | `/plan-design-review` + `/design-review`：制定 Design System 令牌、组件层级、响应式与无障碍规范 |
| `assess` | **架构设计与技术拆解（Eng Manager / Architect）** | `worker-assess` | `/plan-eng-review`：单点锁定模块边界、API 契约与数据表结构，输出文件无交集（File-Disjoint）的并发任务单 |
| `exploit` | **全栈开发与功能实现（Full-Stack Builder）** | `worker-exploit` | 按模块独占分片并发编写前后端代码、Cordis 插件服务与单元/集成测试 |
| `vuln-scan` | **代码审查与安全审计（Staff Reviewer & CSO）** | `worker-vuln-scan` | `/review` + `/cso`：静态审查、契约一致性核对、OWASP Top 10 / 依赖与密钥泄露审计 |
| `qa` | **自动化测试与质量验证（QA Lead）** | `worker-qa` | `/qa` + `/benchmark`：执行真实构建、端到端回归测试与性能基准验证，拒绝无证据宣称通过 |
| `internal` | **文档同步、知识沉淀与发布（Doc & Release Manager）** | `worker-internal` | `/ship` + `/document-release`：同步 `README`/架构文档、沉淀可复用模板入库并生成四段式交付报告 |

### 2. 最优 4-Wave 有界 DAG 执行排布（6 并发槽）

```
Wave 1（并发探索，2 槽） :  [recon 产品与仓库勘探]  ∥  [designer UI/UX 规范设计]
                                      │ (写入 PostgreSQL 事实库)
                                      ▼
Wave 2（单点架构，1 槽） :  [assess 架构师锁定模块接口、Schema 与无冲突文件分片]
                                      │ (生成 N 个文件互不重叠的 P0/P1 开发切片)
                                      ▼
Wave 3（饱和构建，6 槽） :  [exploit #1] ∥ [exploit #2] ∥ [exploit #3] ∥ [exploit #4] ∥ [exploit #5] ∥ [exploit #6]
                                      │ (各自独占目录，跑通模块单测后释放槽位)
                                      ▼
Wave 4（门禁发布，3 槽） :  [vuln-scan 代码与安全审计]  ∥  [qa 集成测试与基准验收]  ──►  [internal 文档同步与发布]
```

### 3. 高性能 PostgreSQL 存储引擎（`pg-engine.js`）

- **原生 PostgreSQL 直连模式**：配置 `REDTEAM_PG_URL`（或 `DSH_PG_URL` / `DATABASE_URL` / 控制台设置页 `pgUrl`）即可启用零外部依赖的 PostgreSQL Wire Protocol v3 连接池（默认 8 连接，支持 SCRAM-SHA-256 / MD5 / TLS），按项目自动隔离 Schema（`eng_<id>` + `dsh_kb`），并使用 `GIN (to_tsvector('simple', ...))` 全文索引加速检索。
- **高并发嵌入式回退模式**：未配置外部 PostgreSQL 时自动回退至预编译语句缓存 + 256MB `mmap` + `WAL` 高并发本地引擎，开箱即用、零原生编译依赖。

---

## 安装与部署

```sh
dsh plugin --profile web add dsh-redteam-mode
```

装完**重启一次 `dsh web`**，在界面助手栏选择预设即可开工。

**配置 PostgreSQL 连接（可选，推荐高并发场景）**：

```sh
export REDTEAM_PG_URL="postgresql://user:password@127.0.0.1:5432/dsh_cluster"
export REDTEAM_MAX_AGENTS=6
```

**从源码构建与本地部署**：

```bash
node packages/redteam-bundle/tools/build.mjs
node packages/redteam-bundle/tools/test-all.mjs
node scripts/deploy-local.mjs
```

完整说明、59 个工具清单与开发流程见 [`docs/详细文档.md`](docs/详细文档.md)。

---

## 数据与隐私（硬约束）

本仓库是**公开**的，推送即发布、无法撤回。下列内容**一律不得入库** ——
`docs/`、`README`、提交说明、Issue/PR 正文、Release 说明都算：

| 不入库 | 说明 | 该放哪 |
| --- | --- | --- |
| **演练战绩 / 战果统计** | 打了几家单位、发现多少资产 / 漏洞 / 凭据、几次得分命中、累计分值 | 仓库外的留档文件（如 `~/redteam-战绩.md`） |
| **逐单位成果明细** | 某个单位多少资产 / 端口 / 漏洞 / 内网段、是否打进内网、内网突破类型 | 同上。**"行业-编号"式脱敏也不行**：脱敏只挡"是谁"，挡不住"打成什么样" |
| **内网段清单** | 一批真实私网 C 段（单个段举例可以，成清单不行） | 同上 |
| **凭据真值** | 口令、密钥、哈希、Cookie、`secret_value` / `pass_key` 的实际值 | 只留在本机 `$DSH_HOME/redteam/engagements/*/assets.db` |

这条约束**有机检、不是靠自觉**（2026-10-12 真实事故：战绩统计曾被写进仓库根 `README` 与 `docs/`，
只能靠改写 git 历史清除）：

```bash
node scripts/check-no-confidential.mjs --selftest   # 证明规则有效（12 拦 / 5 放）
node scripts/check-no-confidential.mjs --all        # 自查工作区（含未跟踪文件）
git config core.hooksPath .githooks                 # 启用提交前闸门（scripts/deploy-local.mjs 会自动配）
```

- **提交前闸门**：`.githooks/pre-commit` 扫暂存区，命中即拦（`git commit --no-verify` 可越过，但先确认是误报）。
- **回归测试**：`packages/redteam-bundle/test/no-confidential.test.mjs` —— 跑规则自检 + 全仓扫描 +
  确认钩子确实接在提交路径上（防"规则还在、闸门没接"）。
- 确实需要在本仓库讨论这类内容时用**占位符写法**：`单位：<靶标单位>　规模：<N> 家　内网段：<私网 C 段>`。

演练数据本身只写在本机 `$DSH_HOME/redteam/`，无遥测、无上报、无云端同步。

---

## 合规

面向**授权范围内**的安全评估：攻防演练、红蓝对抗、企业自检、教学研究。
未获授权的扫描、探测、入侵或数据获取均属违法，与本项目作者无关。MIT，见 [LICENSE](LICENSE)。
