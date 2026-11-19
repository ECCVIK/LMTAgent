---
name: eng-api-contract-sharding
category: 工程
tags: [api-contract, schema-freeze, file-disjoint-sharding, dag-decompose, eng-manager]
description: 【工程】Eng Manager / assess 系统架构与分片规范：接口 Schema 冻结、File-Disjoint Sharding 独占分片划分、lmt_agent_slot 占槽与 lmt_workflow 依赖编排
---

# 接口契约冻结与 File-Disjoint Sharding 分片编排（API Contract & Sharding）

## 适用场景（When to Use）
`Eng Manager / assess` 角色在 **Wave 2** 承接 Wave 1（需求规格 + UI 令牌）产出时使用：在多路 Builder 并行编码之前，冻结数据结构与前后端 API Schema，按文件互不重叠原则（File-Disjoint Sharding）切分并发分片并锁定 DAG 任务依赖。

## 标准工程作业流程（Standard Operating Procedure）
1. **汇总 Wave 1 规格与当前工程状态**：调用 `lmt_workflow({ action: "status" })`、`lmt_artifact_query` 与 `lmt_agent_slot({ action: "status" })`，拉取 `CEO / recon` 的 `acceptance_criteria`、`Designer` 的组件树与当前可用并发槽位上限。
2. **冻结接口契约与数据 Schema（Schema Freeze）**：
   - 锁定数据库表结构、索引设计、外键约束与迁移幂等规则。
   - 锁定前后端 HTTP / IPC / RPC 接口路径、请求参数类型、响应体结构与错误码约定。
   - 锁定工具参数 Schema（例如显式声明对象 `additionalProperties`，避免宿主注册校验失败），并明确大数据集分页与吞吐契约；冻结后的契约通过 `lmt_artifact_record` 落库，Wave 3 期间未经变更评审不得擅改。
3. **划分 File-Disjoint Sharding 独占分片**：
   - 将源码修改范围拆解为最多 N 个并发槽（默认 6 槽）的独占文件/目录 Glob 集合（`files_owned`），确保任意两个并发分片的 `files_owned` **交集严格为空**。
   - 公共入口、聚合索引或共享配置文件只分配给单个负责整合的分片（或显式设置前置 `depends_on` 顺序），严禁多个并行 Worker 同时修改同一文件。
4. **编排 DAG 依赖并拆解入库**：调用 `lmt_workflow`（`action="decompose"`），传入结构化 `goals` 数组，为每个任务分片明确 `wave`、`role`、`assigned_goal`、`files_owned`、`depends_on`、`ui_priority` 与 `acceptance_criteria`。
5. **并发槽互斥占位与冲突拦截**：拉起每个并行 Worker 前，必须调用 `lmt_agent_slot`（`action="acquire"`，传入 `label` 与 `files_owned`）占用并发槽并触发运行时 `ShardLock` 重叠检测；若返回分片冲突或并发槽已满，调整分片边界或等待释放，严禁越界硬塞。

## 参考命令与代码模板（Reference Snippet）
```json
// 1) 调用 lmt_workflow(action="decompose") 写入文件互斥分片与 depends_on 依赖
{
  "tool": "lmt_workflow",
  "arguments": {
    "action": "decompose",
    "user_prompt": "<需求摘要>",
    "goals": [
      {
        "id": "wt-store-schema",
        "wave": "wave-3",
        "role": "exploit",
        "worker_name": "Wave3 exploit 分片构建 #1",
        "ui_priority": "P0",
        "files_owned": ["packages/store/lib/**"],
        "depends_on": ["wave-2-assess"],
        "assigned_goal": "按冻结 Schema 实现存储层迁移与分页查询"
      },
      {
        "id": "wt-ui-panel",
        "wave": "wave-3",
        "role": "exploit",
        "worker_name": "Wave3 exploit 分片构建 #2",
        "ui_priority": "P1",
        "files_owned": ["packages/ui/src/**"],
        "depends_on": ["wt-store-schema"],
        "assigned_goal": "实现组件树与四态交互视图并对接真实接口"
      }
    ]
  }
}

// 2) 派发前通过 lmt_agent_slot(action="acquire") 执行并发槽与分片互斥校验
{
  "tool": "lmt_agent_slot",
  "arguments": {
    "action": "acquire",
    "label": "Wave3 exploit 分片构建 #1",
    "files_owned": ["packages/store/lib/**"]
  }
}
```
