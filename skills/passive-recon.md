---
name: passive-recon
category: 侦察
tags: [codebase-indexing, git-history, schema-analysis, doc-mining, zero-touch]
description: 【侦察】零干扰静态代码库盘点：通过 Git 历史、依赖清单、数据库 Schema 与文档快速构建系统全景认知
---

# 静态代码库盘点与架构考古（Static Codebase & Schema Discovery）

## 适用场景（When to Use）
新接手一个代码仓库或开启新工作区（Engagement）时，在不启动或干扰任何线上服务的前提下，全面摸清项目技术栈、模块划分与历史演进。

## 标准工程作业流程（Standard Operating Procedure）
1. 读取根工作区的 `package.json`、`pyproject.toml`、`go.mod` 或 `docker-compose.yml`，识别核心框架、运行脚本与数据库依赖。
2. 检索数据库迁移目录（`migrations/`、`prisma/`、`sql/`）与模型定义，梳理核心实体表结构与索引设计。
3. 查看近期 Git 提交日志（`git log -n 20 --oneline`），了解最近的架构变更热点与历史遗留问题。
4. 将盘点出的模块结构、服务端口与技术栈信息录入工作区，为后续设计评审与编码实现奠定基础。

## 参考命令与代码模板（Reference Snippet）
```
# 快速盘点仓库目录结构与近期提交历史
git log -n 10 --oneline
find . -maxdepth 3 -not -path "*/.*" -not -path "./node_modules*"
```
