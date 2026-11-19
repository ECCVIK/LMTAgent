---
name: eng-git-recovery
category: 工程
tags: [shard-lock, git-recovery, rollback-scope, scope-violation, untracked-safety]
description: 【工程】ShardLock 写盘越界排查与 Git 安全回滚规范：git diff 核验越界变更，通过 lmt_workflow(action=rollback_scope) 仅回滚已跟踪越界文件并保护 untracked 草稿
---

# ShardLock 写盘越界排查与 Git 安全回滚规范（Scope Audit & Git Recovery）

## 适用场景（When to Use）
当多并发分片构建中出现 `check_scope` 拦截告警、`submit_digest` 触发分片越界提示（`shard_warning`）、或工作区出现非本分片 `files_owned` 范围内的源码改动时使用，用于精确排查越界范围并安全回滚已跟踪文件的误改，同时完整保留未跟踪（untracked）的新建草稿与验证文件。

## 标准工程作业流程（Standard Operating Procedure）
1. **拉取分片范围与越界告警事实**：调用 `lmt_workflow({ action: "status" })` 与 `lmt_artifact_query` 核对涉事 Worker 合法持有的 `files_owned` 清单、当前活跃 `ShardLock` 归属以及越界告警涉及的文件路径。
2. **使用 Git 精确盘点工作区变更分类**：
   - 运行 `git status --porcelain` 与 `git diff --name-only` 列出所有变更文件，逐一对照 `files_owned` 分为三类：
     1. **分片内合法变更**：落在自身 `files_owned` 内的改动（必须保留）。
     2. **已跟踪（tracked）越界修改**：Git 已纳管但超出 `files_owned` 的误改文件（回滚目标）。
     3. **未跟踪（untracked）文件**：工作区新建草稿、临时实验脚本或尚未 `git add` 的新文件（**严禁误删**）。
   - 对越界路径运行 `git diff -- <path>` 核验具体改动内容，确认无须保留后进入受控回滚。
3. **执行 `rollback_scope` 安全回滚**：
   - 调用 `lmt_workflow`（`action="rollback_scope"`），传入 `worker_task_id` / `worker_name` 与核验确认的越界路径（或由平台自动比对 `files_owned` 推导的越界列表）。
   - **安全不变量**：`rollback_scope` 仅将**已跟踪（tracked）且越出分片边界**的文件恢复至基准提交状态，**绝不执行整仓 `git reset --hard`、`git checkout -- .` 或 `git clean -fd`**，确保开发者的 untracked 草稿与合法分片修改零损失。
4. **回滚后复检与状态同步**：重新执行 `git status --short` 与 `git diff --name-only` 确认越界变更已彻底清除且 untracked 草稿完好；随后通过 `lmt_workflow`（`action="check_scope"` 或重新提交 `submit_digest`）及 `lmt_artifact_record` 记录越界排查与恢复结果。

## 参考命令与代码模板（Reference Snippet）
```sh
# 1. 核查工作区状态与已跟踪文件改动清单（严禁直接 git reset --hard 或 git clean -fd）
git status --porcelain
git diff --name-only
git diff -- <tracked-out-of-scope-file>
```

```json
// 2. 通过 lmt_workflow(action="rollback_scope") 安全回滚已跟踪越界文件（保留 untracked 草稿）
{
  "tool": "lmt_workflow",
  "arguments": {
    "action": "rollback_scope",
    "worker_task_id": "wt-ui-panel",
    "worker_name": "Wave3 exploit 分片构建 #2",
    "files_to_rollback": ["packages/store/lib/core.js"]
  }
}
```
