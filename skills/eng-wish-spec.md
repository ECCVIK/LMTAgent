---
name: eng-wish-spec
category: 工程
tags: [wish-refinement, acceptance-criteria, repo-inventory, api-discovery, ceo-recon]
description: 【工程】CEO / recon 需求边界澄清、真实仓库与 API 盘点及结构化 acceptance_criteria 收敛规范
---

# 需求澄清、仓库盘点与验收标准收敛（Wish Specification & Repo Inventory）

## 适用场景（When to Use）
`CEO / recon` 角色在 **Wave 1** 接到用户一句话“许愿式”工程需求时使用：在编写任何业务代码之前，澄清需求边界、盘点真实代码仓库与 API 数据源、生成结构化 `acceptance_criteria` 并落库规格产物，彻底杜绝「许愿式编程（Wishful Programming）」的模糊假设与假数据占位。

## 标准工程作业流程（Standard Operating Procedure）
1. **核对会话与既有事实库**：先调用 `lmt_session_info` 与 `lmt_artifact_query` 确认当前绑定的项目工作区及已有工程产物，避免与历史模块或既有契约重复。
2. **盘点真实代码仓与 API 边界**：静态检索仓库目录、包导出符号、数据库 Schema、现有服务路由与真实公开接口/免鉴权数据源，区分 **T0/T1 核心主链路**与 **T2/T3 外围模块**，严禁凭空捏造不存在的接口路径或 Mock 假数据。
3. **精炼需求与澄清边界（Clarifications）**：调用 `lmt_workflow`（`action="refine_wish"`），传入 `user_prompt`（或 `wish`），收敛出清晰的 **In-Scope / Out-of-Scope 边界**、数据持久化兼容要求、性能规模预期与核心 `clarifications` 列表。
4. **锁定结构化验收标准（`acceptance_criteria`）**：为每项核心需求输出可机检、可复现的 `acceptance_criteria`（包含入口模块、前置条件、预期状态流转、验证命令与失败信号），供 Wave 2 `Eng Manager / assess` 拆片与 Wave 4 `QA Lead / qa` 验收对照。
5. **规格产物落库交接**：调用 `lmt_artifact_record` 将核实后的仓库模块拓扑、真实 API 契约与结构化需求规格（`refined_spec`）记录入库；`CEO / recon` 本阶段只做需求收敛与真实盘点，不直接修改业务实现代码。

## 参考命令与代码模板（Reference Snippet）
```json
// 1) 调用 lmt_workflow(action="refine_wish") 生成需求澄清与验收标准
{
  "tool": "lmt_workflow",
  "arguments": {
    "action": "refine_wish",
    "user_prompt": "<原始工程需求描述>",
    "commit": false
  }
}

// 2) 调用 lmt_artifact_record 将结构化规格与真实仓库盘点落库
{
  "tool": "lmt_artifact_record",
  "arguments": {
    "kind": "spec",
    "title": "Wave 1 需求边界与 acceptance_criteria 规格",
    "target": "docs/specs/feature-spec.md",
    "summary": "已盘点核心模块入口、真实 API 契约与 4 条可验证 acceptance_criteria"
  }
}
```
