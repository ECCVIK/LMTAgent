---
name: vps-reverse-shell
category: 隧道
tags: [remote-runner, ssh-tunnel, webhook-relay, cloud-sandbox, port-forwarding]
description: 【隧道】云端开发沙箱与远端测试机（Remote Runner）SSH 反向端口映射与联调回调中继配置
---

# 远端测试沙箱与 SSH 反向端口映射（Remote Sandbox & SSH Port Relay）

## 适用场景（When to Use）
在需要将内网隔离测试节点的端口通过 SSH 反向隧道（`ssh -R`）映射至云端联调沙箱，或配置跨网络构建中继节点时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 从环境变量（如 `REDTEAM_VPS_HOST`）读取已配置的远端联调主机地址，严禁将真实公网 IP 或私钥硬编码进公共代码仓库。
2. 使用带保活参数（`ServerAliveInterval=30`）与仅端口转发标志（`-N`）的 SSH 命令建立反向映射通道。
3. 通道建立后调用 `redteam_tunnel_add` 登记监听端口与 `entry_kind: "target-agent"`（若仅在自建主机上监听而未接入目标节点，则必须标为 `self-only`）。
4. 联调结束后及时断开连接并在清理台账中核销。

## 参考命令与代码模板（Reference Snippet）
```
# 建立带心跳保活的 SSH 反向端口转发（需在环境变量配置远端主机）
# ssh -N -R 127.0.0.1:18080:127.0.0.1:8080 -o ServerAliveInterval=30 user@$REDTEAM_VPS_HOST
```
