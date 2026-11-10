---
name: cn-proxy-pool
category: 基础设施
tags: [network-egress, proxy-routing, mirror-registry, latency-tuning]
description: 【基础设施】多区域网络出口路由、镜像源加速（npm/PyPI/Docker）与高可用代理池健康检查配置
---

# 研发网络出口路由与镜像源加速治理（Network Egress & Registry Acceleration）

## 适用场景（When to Use）
在跨区域拉取依赖包、访问外部技术文档 API 或进行多节点分布式联调遇到网络限流/高延迟时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 检测当前运行环境的出网连通性、DNS 解析延迟与代理环境变量（`HTTP_PROXY` / `HTTPS_PROXY`）。
2. 为包管理器（npm / pnpm / uv / pip）配置高可用镜像源与超时重试参数。
3. 定期对代理池节点执行 TCP 握手延迟探测，自动剔除失效或高丢包出口节点。
4. 将验证可用的网络配置写入工作区环境备忘，供集群内各子智能体共享。

## 参考命令与代码模板（Reference Snippet）
```
# 测试当前环境网络出口连通性与响应耗时
curl -o /dev/null -s -w "HTTP %{http_code} | Total: %{time_total}s\n" https://registry.npmjs.org/-/ping
```
