---
name: eng-fullstack-builder
category: 工程
tags: [fullstack-builder, shard-lock, check-scope, submit-digest, clean-implementation]
description: 【工程】Builder / exploit 全栈分片构建规范：严格在 files_owned 范围内实现、修改关键共享文件前调用 check_scope、完成后提交 submit_digest
---

# 全栈分片构建与闭环交付规范（Full-Stack Builder & Scoped Execution）

## 适用场景（When to Use）
`Builder / exploit` 角色在 **Wave 3** 领取独占文件分片（`files_owned`）并执行全栈代码实现、接口联调、缺陷修复与单元测试时使用，确保实现完整可运行、不越界踩踏他人分片并高效压缩上下文回报。

## 标准工程作业流程（Standard Operating Procedure）
1. **核对分片边界与冻结契约**：开工前先调用 `lmt_session_info`、`lmt_workflow({ action: "status" })` 与 `lmt_artifact_query`，确认当前任务分配的 `files_owned` 路径清单、冻结的 API/DB Schema 与相关 UI 四态规范。如需就局部微任务继续拆分子代理，必须先通过 `lmt_agent_slot({ action: "acquire", label, files_owned })` 申请子集分片槽位。
2. **写前分片门禁校验（`check_scope`）**：在编辑任何源码——尤其是关键共享接口文件、导出聚合模块、构建配置或包清单——之前，必须调用 `lmt_workflow`（`action="check_scope"`）核验目标文件路径确属自身 `files_owned` 且未被其他活跃分片锁定；若返回越界或锁冲突，**立即停止修改**并上报主控调整排期或由对应分片拥有者处理。
3. **生产级完整实现（拒绝半成品）**：
   - 在 `files_owned` 内完成真实业务逻辑、边界错误处理、参数校验与完整导出契约，禁止留下 `TODO` 占位符、空函数壳或伪造通过的硬编码 Mock 数据。
   - 涉及数据查询与列表渲染时，实现真实分页/索引与 Loading/Empty/Error/Overflow 四态处理。
   - 同步补齐或更新对应模块的单元测试与边界用例，遵循局部最小变更原则。
4. **分片内本地实测**：实际运行分片关联的语法校验、单元测试与构建检查，记录真实命令与退出码/通过条数；未跑通测试的代码不得宣称完成。
5. **压缩摘要写回事实库（`submit_digest`）**：完成编码与自测后，调用 `lmt_workflow`（`action="submit_digest"`），提交高信噪比结构化摘要（`what_was_done`、`files_touched`、`key_decisions`、`verification`），实现上下文大幅压缩并进入待审批流转；若过程中需要沉淀可复用模式或修复记录，配合 `lmt_artifact_record` 登记。

## 参考命令与代码模板（Reference Snippet）
```json
// 1) 修改文件或关键共享边界前先执行 check_scope 校验
{
  "tool": "lmt_workflow",
  "arguments": {
    "action": "check_scope",
    "worker_task_id": "wt-store-schema",
    "worker_name": "Wave3 exploit 分片构建 #1",
    "files_touched": ["packages/store/lib/core.js"]
  }
}

// 2) 实现与自测通过后提交压缩摘要 submit_digest
{
  "tool": "lmt_workflow",
  "arguments": {
    "action": "submit_digest",
    "worker_task_id": "wt-store-schema",
    "worker_name": "Wave3 exploit 分片构建 #1",
    "what_was_done": "完成分片锁校验与游标分页查询实现，补充 8 条边界单测并全部通过",
    "files_touched": ["packages/store/lib/core.js", "packages/store/test/pagination.test.mjs"],
    "key_decisions": ["保持外键约束开启并在事务内校验分片状态"],
    "verification": "node packages/store/test/pagination.test.mjs -> 通过 8/8"
  }
}
```
