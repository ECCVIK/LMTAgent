---
name: redteam-setup
category: 基础设施
tags: [workspace-bootstrap, postgresql, env-check, onboarding, toolchain]
description: 【基础设施】LMTAgent 研发集群首次环境自举：PostgreSQL 16+ 存储探针初始化、环境变量配置与工具链健康预检
---

# LMTAgent 研发环境初始化与工具链自举（LMTAgent Workspace & Toolchain Setup）

## 适用场景（When to Use）
首次安装或启动 LMTAgent 插件，或 `redteam_preflight` 提示缺少环境变量、数据库连接配置及可选辅助工具时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 调用 `redteam_preflight` 获取完整的环境诊断报告，查看 PostgreSQL 兼容存储引擎状态（`postgresql-compatible-wal`）、8 角色提示词新鲜度及技能可用性。
2. 在 `$DSH_HOME/.env` 中按需配置外部 API 密钥（如 `DEEPSEEK_API_KEY`）与PostgreSQL 连接参数（`PGHOST`、`PGPORT`、`PGDATABASE`），修改后无需硬编码即可全局生效。
3. 若需重新同步最新的 8 角色默认研发提示词，可调用 `redteam_role_prompt_reset`（all=true）并在右侧控制台「角色配置」页签确认。
4. 自举完成后调用 `redteam_engagement_open` 创建并绑定当前会话的研发项目工作区。

## 参考命令与代码模板（Reference Snippet）
```
# 检查 Node.js、Git、Python 与 PostgreSQL 客户端工具链版本
node -v && git --version && python3 --version
```
