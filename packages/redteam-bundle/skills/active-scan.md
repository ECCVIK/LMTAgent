---
name: active-scan
category: 侦察
tags: [service-discovery, port-check, health-probe, openapi, topology]
description: 【侦察】主动服务端口健康探测与 OpenAPI 契约端点盘点（本地与测试环境微服务拓扑测绘）
---

# 主动服务健康探测与接口盘点（Active Service Discovery）

## 适用场景（When to Use）
在启动全栈迭代或微服务重构前，主动探测开发/测试环境中的服务监听端口、健康检查端点（/healthz、/readyz）与 OpenAPI 规范文档。

## 标准工程作业流程（Standard Operating Procedure）
1. 读取当前项目工作区的已登记节点（`redteam_asset_list`），确认待验证的服务网段与模块边界。
2. 对目标开发/测试节点执行轻量级 TCP 端口连通性与 HTTP 健康检查探测，识别 Web 网关、RPC 端口与数据库监听状态。
3. 采集各服务的 `/openapi.json`、`/swagger/v1/swagger.json` 或 GraphQL Schema，调用 `redteam_service_add` 与 `redteam_asset_add` 写入项目工程数据库。
4. 将探测脚本与输出摘要通过 `redteam_chain_add`（stage_code=recon）归档，供架构师与后端研发节点复用。

## 参考命令与代码模板（Reference Snippet）
```
# 探测服务端点健康状态与 OpenAPI 规范
curl -sS -m 5 http://127.0.0.1:8080/healthz
curl -sS -m 5 http://127.0.0.1:8080/openapi.json | jq ".info, (.paths | keys)"
```
