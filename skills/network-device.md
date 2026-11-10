---
name: network-device
category: 内网
tags: [api-gateway, nginx, envoy, load-balancer, ingress-config]
description: 【内网】API 网关（Nginx / Envoy / Kong）与负载均衡器路由配置审查、TLS 加固与健康检查调优
---

# API 网关与网络基础设施配置治理（Gateway & Load Balancer Engineering）

## 适用场景（When to Use）
在配置或审查反向代理（Nginx / Caddy / Envoy）、Kubernetes Ingress、API 网关限流策略及上游连接池参数时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 审查网关路由转发规则，确保内部管理端口（如 `/metrics`、`/admin`、`/actuator`）不对公网直接暴露。
2. 检查代理头部传递配置（`X-Forwarded-For`、`X-Real-IP`、`Host`），防止请求头伪造绕过后端鉴权或限流。
3. 验证网关层的超时控制（`proxy_read_timeout`）、请求体大小限制（`client_max_body_size`）与 TLS 协议版本。
4. 将网关配置审计结论与优化补丁记录至工作区知识库。

## 参考命令与代码模板（Reference Snippet）
```
# 验证 Nginx / 网关配置文件语法并检查响应安全头
curl -I -sS http://127.0.0.1:8080/healthz
```
