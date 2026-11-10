---
name: opsec-hygiene
category: 基础设施
tags: [env-hygiene, secret-sanitization, git-clean, cleanup-ledger, audit-log]
description: 【基础设施】研发工程操作卫生规范：严禁明文密钥入库、非破坏性测试底线与发布前环境清理台账核销
---

# 工程环境卫生与安全交付合规规范（Engineering Hygiene & Safe Delivery）

## 适用场景（When to Use）
贯穿整个 LMTAgent 研发周期的工程安全底线：管理 API 密钥、保护生产数据安全、清理临时联调探针并确保代码仓库零敏感信息泄露。

## 标准工程作业流程（Standard Operating Procedure）
1. 密钥隔离：所有第三方 API Key、数据库口令与私钥必须通过环境变量或 `.env`（已加入 `.gitignore`）注入，严禁写进命令行参数、源码注释或提交历史。
2. 非破坏性原则：在预发或存量数据库上验证迁移与查询时，坚持只读抽样或事务回滚（`BEGIN ... ROLLBACK`），严禁执行未备份的 `DROP` / `TRUNCATE`。
3. 清理台账闭环：联调期间创建的临时测试账号、运行态探针端点与端口转发通道必须登记至 `redteam_cleanup`，交付前逐项核销为 `done`。
4. 发版前运行敏感信息扫描测试，确保打包产物干净可复现。

## 参考命令与代码模板（Reference Snippet）
```
# 检查 Git 工作区状态与敏感信息零泄露测试
git status --short
node packages/redteam-bundle/test/no-confidential.test.mjs
```
