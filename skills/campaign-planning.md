---
name: campaign-planning
category: 规划
tags: [dag-orchestration, timebox, wave-planning, gstack, milestone]
description: 【规划】LMTAgent 4-Wave Bounded DAG 研发战役规划、时间盒（Timebox）预算控制与 6 并发槽调度策略
---

# 多角色研发战役规划与 4-Wave DAG 调度（Engineering Campaign Planning）

## 适用场景（When to Use）
主控架构师（Captain）在项目启动、阶段复盘或遇到研发阻塞时，制定多角色并行执行计划、分配并发槽位与设定时间盒预算。

## 标准工程作业流程（Standard Operating Procedure）
1. 调用 `redteam_overview` 与 `redteam_score_list` 盘点当前工作区进度、待办里程碑与可用并发槽位。
2. 按 4-Wave Bounded DAG 排布研发波次：Wave 1（CEO 需求收敛 + Designer 架构设计）→ Wave 2（Eng Manager 任务拆解）→ Wave 3（Builder 全栈实现）→ Wave 4（Reviewer 审查 + QA 回归 + Release 交付）。
3. 严格执行**时间盒**（Timebox）纪律：单角色单波次任务设定明确的时间盒与产出标准，超时未收敛立即切换备选架构方案。
4. 通过 `redteam_todo` 维护跨波次任务看板，确保每个并发槽位职责正交、互不覆盖。

## 参考命令与代码模板（Reference Snippet）
```
# 查看工作区工程概览与里程碑进度
# 优先调用 redteam_overview / redteam_score_list / redteam_agent_slot
```
