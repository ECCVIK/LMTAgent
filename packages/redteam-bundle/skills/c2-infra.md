---
name: c2-infra
category: 基础设施
tags: [distributed-worker, task-queue, heartbeat, telemetry, coordinator]
description: 【基础设施】分布式研发节点协调器、长连接心跳探针、任务队列分发与集中式日志遥测基础设施配置
---

# 分布式工作节点协调与遥测基础设施（Distributed Worker & Telemetry Infra）

## 适用场景（When to Use）
配置跨主机研发构建节点、长连接运行态探针（Runtime Agent）、集中式任务分发网关或异步构建回调通道时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 检查协调节点与执行节点之间的双向通信配置、TLS 证书及鉴权密钥。
2. 通过 `redteam_session_check` 实测所有已登记运行态探针端点与网关通道的在线率与往返延迟（RTT）。
3. 为长耗时构建、全量测试或数据迁移任务配置健康心跳与断线重连策略。
4. 任务完成后通过 `redteam_cleanup` 更新临时基础设施台账，确保无孤儿进程残留。

## 参考命令与代码模板（Reference Snippet）
```
# 检查本地与远端工作节点健康心跳
curl -sS http://127.0.0.1:9090/metrics | grep -E "worker_active|task_queue_depth"
```
