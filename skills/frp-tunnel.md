---
name: frp-tunnel
category: 隧道
tags: [frp, reverse-proxy, nat-traversal, staging-gateway, webhook-debug]
description: 【隧道】使用 frp 构建高性能跨网段反向代理与 Webhook 回调联调通道
---

# frp 跨网段微服务反向代理与联调网关（FRP Reverse Proxy & Staging Gateway）

## 适用场景（When to Use）
当需要将隔离研发环境中的微服务端口安全映射至联调网关，或接收第三方 Webhook 回调进行端到端集成测试时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 编写最小化的 `frpc.toml` / `frps.toml` 配置文件，启用 Token 鉴权与 TLS 传输加密，严禁暴露未鉴权代理端口。
2. 通道建立后调用 `redteam_tunnel_add` 登记本地监听地址、可达服务段与 `entry_kind`（如 `target-outbound`）。
3. 使用 `redteam_session_check` 验证端到端转发健康状态，确保联调流量稳定可达。
4. 联调任务完成后及时停止代理进程并在 `redteam_tunnel_update` 中标记为 `down`。

## 参考命令与代码模板（Reference Snippet）
```
# 检查 frp 联调客户端配置文件语法与连接状态
ps aux | grep frpc
```
