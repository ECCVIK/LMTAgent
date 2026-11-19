[English](README.md) | 简体中文

# LMTAgent (`v1.1.0` · `dsh-lmtagent`)

**DeepSeek Harness（DSH Desktop）多智能体全栈研发编排工作台** —— 把一句话需求自动拆解为互不冲突的并行开发分片，在**脱离 DSH 主窗体的独立窗口**中实时编排审批，支持越界文件一键 Git 回滚与工作区预算熔断。

```bash
dsh plugin add github:ECCVIK/LMTAgent
```

### 1 分钟快速上手
1. 通过上方命令安装（或在 DSH Desktop「插件市场」搜索 `dsh-lmtagent`），重启 DSH。
2. 点击左侧导航栏或会话顶栏的 **`LMTAgent 控制台`** —— 自动弹出**独立无边框桌面窗口**（可自由拖拽到副屏、最大化，告别拥挤遮挡主界面的右侧窄抽屉）。
3. 在「协同与审批」点击任意一个 **1 分钟体验示例**芯片（`OrderFlow-Demo` 或 `CliRefactor-Demo`），立即体验 AI 需求澄清、4-Wave 分片拆解与实时 DAG 调度。

---

## 为什么装 LMTAgent？

| 单智能体盲写常见痛点 | LMTAgent 的解法 |
| :--- | :--- |
| 需求一句话模糊，写着写着跑偏、塞满假数据 | **AI 需求澄清向导**先收敛验收契约与分片蓝图再开工 |
| 多子代理并发改代码，互相覆盖文件 | **`files_owned` 独占分片锁**写前预检 + **越界一键 Git 回滚** |
| 后台循环跑飞，Token 费用烧穿不自知 | **工作区 Token / 费用预算熔断器** + 有限次指数退避自动重试 |
| 挤在右侧窄抽屉里看不清、黑盒执行 | **独立弹出应用窗口**（支持双屏）+ 全双语实时 DAG 审批控制台 |

---

## 界面预览（`v1.1.0`）

以下截图由无头 Chromium 加载真实编译产物 `packages/redteam-ui/lib/client.js` 与 `styles.js` 直接渲染采集（`zh-CN` 中文界面）：

| 实时总览、上下文构成与效率指标（`总览`） | 集群并发槽与 4-Wave 派生拓扑树（`集群`） |
| :---: | :---: |
| ![实时总览与上下文详表](docs/assets/ui-overview-workbench.png) | ![集群并发与拓扑树](docs/assets/ui-agents-dag.png) |
| **1 分钟体验示例 & 越界文件一键 Git 回滚（`协同与审批`）** | **统一设置、预算熔断与实验性推测 DAG（`设置`）** |
| ![1 分钟示例与一键回滚](docs/assets/ui-assets-pg.png) | ![统一设置与预算熔断](docs/assets/ui-report-v2.png) |

---

## 核心特性（`v1.1.0`）

- **独立弹出桌面窗口（`弹出独立窗口 ↗`）**：基于本机 Edge / Chrome / Chromium `--app=` 无地址栏独立应用窗弹出（自动兜底弹窗或应用内全屏），与 DSH 同源共享 `/lmtagent/api` 与 `/lmtagent/events` 实时事件流，左屏聊天、右屏大窗监控互不遮挡。
- **8 个工程角色预设（`maxDepth: 3`，默认 `thinking: low`）**：`plan`（主控指挥）、`recon`（产品规划 CEO）、`designer`（UI 令牌设计）、`assess`（架构与分片经理）、`exploit`（6 槽并发全栈构建）、`vuln-scan`（代码审查与安全）、`qa`（质量测试门禁）与 `internal`（文档与发布归档）。
- **写前 `ShardLock` 预检 + Git 安全一键回滚**：派发阶段拦截同波次重叠分片；提交摘要后自动审计越界文件，并在审批卡片中通过 `execFileSync('git', ...)` 安全一键恢复受污染文件。
- **预算熔断、自动重试与实验性推测 DAG**：支持配置 `maxTokensPerWorkspace` / `maxCostPerWorkspace` 超限自动暂停、瞬态失败自动退避重试（`maxAutoRetries` `0–3`），以及开启 `speculativeWaveDispatch` 在依赖满足时提前并行派发下游分片。
- **原生全双语控制台（`中文 / EN`）**：顶栏一键即时切换纯中文 / 纯英文界面（持久化于 `lmt_ui_locale`），零中英混杂。
- **完全独立命名空间（`dsh-lmtagent`）**：独立插件 ID、槽位、路由与数据目录（`$DSH_HOME/lmtagent`），可与 `dsh-redteam-mode` 同机零冲突共存，并自动无损迁移旧目录 `$DSH_HOME/redteam` 数据。

---

<details>
<summary><strong>技术架构、精简工具集、技能包、存储与测试命令（展开查看）</strong></summary>

### 1. 12 个精简 `lmt_*` 工具 & 12 项纯净工程技能包
- **12 个高内聚 `lmt_*` 工具**（`lmt_workflow`、`lmt_agent_slot`、`lmt_engagement_open`、`lmt_session_bind`、`lmt_session_info`、`lmt_sessions`、`lmt_preflight`、`lmt_role_prompt`、`lmt_roles`、`lmt_artifact_record`、`lmt_artifact_query`、`lmt_report_export`）：完整序列化 Schema 仅 **`11,645` 字节**（较 `28,000` 字节旧基准下降 **58%**），全部 26 个 object 节点显式声明 `additionalProperties: false`。
- **12 个纯净工程与协作技能**：`eng-wish-spec`、`eng-ui-design-tokens`、`eng-api-contract-sharding`、`eng-fullstack-builder`、`eng-code-review-security`、`eng-test-verification-gate`、`eng-release-changelog`、`eng-git-recovery`、`campaign-planning`、`browser-automation`、`opsec-hygiene`、`supply-chain`（历史渗透手册通过 `OMITTED_SKILLS` 移出默认包）。

### 2. 高性能模块化内核（零外部运行时依赖）
- **存储内核（`packages/redteam-store/lib/core.js`，`6,415` 行）**：拆分为 `shard-policy.js`、`session-bindings.js`、`dag-workflow.js`、`settings.js`、`pg-engine.js` 与 `prompts.js`，内置写版本号 + SQLite `total_changes()` + `workflow-dag.json` `mtimeMs` 内存读缓存。
- **宿主桥接（`packages/redteam-ui/lib/index.js`，`3,550+` 行）**：拆分为 `window-launcher.js`、`scope-rollback.js`、`dag-scheduler.js`、`settings-bridge.js`、`update-manager.js`、`telemetry-jsonl.js`、`dsh-dispatch.js` 与 `llm-planner.js`。
- **双模存储**：配置 `LMTAGENT_PG_URL`、`REDTEAM_PG_URL`、`DSH_PG_URL`、`DATABASE_URL` 或 `PGHOST` 时连接外部 PostgreSQL（Wire Protocol v3）；未配置时使用 `$DSH_HOME/lmtagent` 本地 SQLite WAL。
- **6 个独立 `lmtagent-*` 宿主槽位**：`lmtagent-console`（`shell.overlay`）、`lmtagent-workbench`（`main`）、`lmtagent-panellist`（`sidebar.panellist`）、`lmtagent-view`（`conversation.view`）、`lmtagent-header-toggle`（`conversation.session.header.utilities`）、`lmtagent-settings`（`settings.section`）。

### 3. 构建、门禁与全量测试

```bash
npm run build
node packages/redteam-bundle/tools/build.mjs --check
node packages/redteam-ui/tools/assemble-client.mjs --check
node packages/redteam-ui/tools/assemble-styles.mjs --check
node scripts/check-no-confidential.mjs --selftest
node scripts/check-no-confidential.mjs --all
npm test
```

全部 **22 个零依赖测试套件（`1,295` 条断言）**通过，敏感内容闸门 `0` 命中。

</details>
