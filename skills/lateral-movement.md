---
name: lateral-movement
category: 内网
tags: [service-mesh, east-west-traffic, rpc-integration, mtls, zero-trust]
description: 【内网】微服务东西向（East-West）流量调用链联调、mTLS 服务间鉴权与跨模块契约集成验证
---

# 微服务东西向调用链联调与零信任边界验证（East-West Service Integration）

## 适用场景（When to Use）
在多个后端微服务、消息队列与共享数据层之间开展跨服务调用链联调、mTLS 双向认证配置或东西向权限隔离审查时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 调用 `redteam_attack_path` 查看当前微服务拓扑与上下游调用依赖。
2. 验证服务间调用（REST / gRPC / MQ）是否携带合法的服务身份凭证（Service Token / mTLS 证书）并传递分布式追踪 Context（Trace ID）。
3. 测试上游服务超时、熔断与降级策略，防止单点故障沿东西向调用链级联扩散。
4. 使用 `redteam_chain_add`（stage_code=internal）完整记录跨模块联调步骤与验证输出。

## 参考命令与代码模板（Reference Snippet）
```
# 携带分布式追踪头测试内部微服务间 RPC/HTTP 契约
curl -sS -H "X-Trace-Id: trace-dev-001" http://127.0.0.1:8081/internal/v1/orders/check
```
