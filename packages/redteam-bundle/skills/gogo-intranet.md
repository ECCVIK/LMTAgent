---
name: gogo-intranet
category: 内网
tags: [gogo, fingerprint, microservice-discovery, cidr-scan]
description: 【内网】内网高并发服务协议指纹识别与微服务资产自动建档
---

# 内网服务协议指纹识别与拓扑测绘（Gogo Service Fingerprinting）

## 适用场景（When to Use）
需要快速识别内网子网段（CIDR）中各节点的 HTTP/RPC 协议指纹、中间件版本与服务标题并结构化入库时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 确认目标 CIDR 网段与代理通道状态，指定精确的 `-i` 目标网段与 `-p` 端口集合（切勿将网段传给 `-p` 参数）。
2. 经由联调代理执行协议指纹采集：`gogo -i 10.0.0.0/24 -p 80,443,8080,8443 --proxy socks5://127.0.0.1:1080`。
3. 解析输出的协议、产品名与版本信息，调用 `redteam_asset_add` 与 `redteam_service_add` 落盘。
4. 根据指纹识别结果调用 `redteam_asset_assess` 完成模块优先级分级。

## 参考命令与代码模板（Reference Snippet）
```
# 标准服务指纹探测命令模板（-i 指定网段/IP，--proxy 指定联调代理）
gogo -i 10.0.0.0/24 -p 80,443,8080,8443 --proxy socks5://127.0.0.1:1080
```
