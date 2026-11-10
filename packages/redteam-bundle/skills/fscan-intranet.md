---
name: fscan-intranet
category: 内网
tags: [intranet-health, service-matrix, middleware-check, port-audit]
description: 【内网】内网微服务网段批量健康巡检、中间件版本基线核查与配置合规扫描
---

# 内网微服务矩阵健康巡检与基线核查（Intranet Service Matrix Inspection）

## 适用场景（When to Use）
在进入内网微服务集群联调或开展架构安全基线巡检时，批量核查子网内的数据库、缓存、消息队列与微服务端口状态。

## 标准工程作业流程（Standard Operating Procedure）
1. 先调用 `redteam_sessions` 确认当前可用的跨网段联调转发通道，避免重复建立连接。
2. 针对目标测试子网执行并发度受控的服务端口与健康探针巡检，识别 PostgreSQL、Redis、Kafka、gRPC 等组件状态。
3. 将巡检发现的服务节点与中间件版本批量同步至 `redteam_asset_add` 与 `redteam_service_add`。
4. 若发现未开启鉴权的中间件或过时配置，立即通过 `redteam_vuln_add` 登记修复单。

## 参考命令与代码模板（Reference Snippet）
```
# 通过本地 SOCKS5 通道探测内网微服务健康端点
curl --proxy socks5h://127.0.0.1:1080 -sS -m 5 http://10.0.0.12:8080/healthz
```
