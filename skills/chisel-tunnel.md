---
name: chisel-tunnel
category: 隧道
tags: [port-forward, http-tunnel, socks5, dev-gateway, chisel]
description: 【隧道】基于 HTTP/WebSocket 封装的轻量级开发联调端口转发与跨网段 SOCKS5 代理配置
---

# HTTP/WebSocket 跨环境联调端口转发（Chisel Dev Port-Forwarding）

## 适用场景（When to Use）
当开发机与隔离测试网段之间仅开放 HTTP/HTTPS 端口，需要建立轻量级 TCP 端口转发或 SOCKS5 代理以开展微服务联调时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 确认目标测试环境的网关准入规则，优先复用 `redteam_sessions` 中已在线的 active 通道。
2. 建立转发通道后，记录本地监听地址（如 `127.0.0.1:1080`）与可达测试子网段。
3. 调用 `redteam_tunnel_add` 登记通道并明确声明 `entry_kind`（如 `target-outbound` 或 `target-http`；仅本机空转填 `self-only`）。
4. 使用 `redteam_pivot_probe` 实测目标后端服务端口可达性，联调结束后在 `redteam_cleanup` 登记关闭。

## 参考命令与代码模板（Reference Snippet）
```
# 启动本地 SOCKS5 联调转发客户端并验证端口监听
ss -tlnp | grep 1080
```
