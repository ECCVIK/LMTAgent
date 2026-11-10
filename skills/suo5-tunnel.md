---
name: suo5-tunnel
category: 隧道
tags: [http-tunnel, suo5, connection-multiplexing, reverse-proxy, gateway-bridge]
description: 【隧道】基于 HTTP/1.1 与 HTTP/2 全双工流复用的跨环境联调网关通道（suo5）构建与健康诊断
---

# HTTP 全双工流复用联调网关通道（Suo5 HTTP Multiplexing Tunnel）

## 适用场景（When to Use）
在仅允许标准 HTTP/HTTPS 流量的隔离测试区与本地工作区之间，建立高吞吐、低延迟的 SOCKS5 多路复用联调通道时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 确认目标网关端点的 HTTP 流式传输兼容性（检查反向代理是否开启了过早缓冲 `proxy_buffering`）。
2. 启动本地多路复用客户端监听（如 `127.0.0.1:1080`），并通过 `redteam_pivot_probe` 实测后端微服务端口可达性。
3. 验证通过后调用 `redteam_tunnel_add`（`kind: "suo5"`，`entry_kind: "target-http"`）写入工程数据库，供全集群角色共享。
4. 若通道仅在本地回环空转而未连通真实目标服务，严禁谎报为跨区联调达成。

## 参考命令与代码模板（Reference Snippet）
```
# 验证本地 SOCKS5 复用通道到目标服务端点的连通性
curl --proxy socks5h://127.0.0.1:1080 -sS -m 5 http://10.0.0.5:8080/healthz
```
