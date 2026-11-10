---
name: recon-pipeline
category: 侦察
tags: [discovery-pipeline, architecture-mapping, module-inventory, priority-triage]
description: 【侦察】标准化四步架构勘探流水线：静态仓库盘点 → 服务端点测绘 → 接口契约采集 → 研发优先级分级
---

# 标准化四步架构勘探与模块建档流水线（Architecture Discovery Pipeline）

## 适用场景（When to Use）
工作区启动的第一阶段（Wave 1），由架构与需求分析角色按标准流水线完成全量模块盘点、服务建档与优先级评估。

## 标准工程作业流程（Standard Operating Procedure）
1. 阶段一（静态盘点）：扫描代码仓库结构、依赖树与环境变量配置模板，建立模块清单。
2. 阶段二（服务端点测绘）：探测本地或联调环境中的活跃主机节点与监听端口，调用 `redteam_asset_add` 与 `redteam_service_add` 批量建档。
3. 阶段三（接口与数据层画像）：提取各服务的 HTTP 路由、RPC 契约与 PostgreSQL 表结构。
4. 阶段四（优先级分级）：调用 `redteam_asset_assess` 按 T0（核心主干）至 T3（外围工具）完成分级，确保 `assessed=no` 归零后交接给下一波次。

## 参考命令与代码模板（Reference Snippet）
```
# 检查当前工作区未完成评估的节点数量
# 调用 redteam_asset_list(assessed="no") 确认全部完成分级
```
