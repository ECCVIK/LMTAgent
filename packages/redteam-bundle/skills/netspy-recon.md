---
name: netspy-recon
category: 内网
tags: [netspy, subnet-probe, network-topology, vlan-routing, reachability]
description: 【内网】跨网段路由可达性探测（netspy）：快速绘制容器网络与内网子网连通矩阵，区分网络可达与服务就绪
---

# 跨网段路由拓扑与子网可达性测绘（Netspy Subnet Reachability Probe）

## 适用场景（When to Use）
在多子网容器集群或混合云内网环境中，快速探测当前节点可达的私有网段（10.0.0.0/8、172.16.0.0/12、192.168.0.0/16），为后续 gogo/fscan 服务健康巡检划定范围。

## 标准工程作业流程（Standard Operating Procedure）
1. 使用 `netspy` 或系统路由表（`ip route` / `arp -a`）快速探测当前环境可达的网关与活跃子网段。
2. 将探测到的活跃 C 段移交 `gogo/fscan` 进行精确端口与服务健康检查，避免在无路由的空网段上浪费时间。
3. 严格区分「网络可达」与「服务权限就绪」：网段或端口**可达**仅代表路由互通，必须完成真实的端到端服务鉴权与接口验证后方可登记里程碑。
4. 通过 `redteam_chain_add` 记录子网测绘结果，更新工作区网络拓扑视图。

## 参考命令与代码模板（Reference Snippet）
```
# 查看本机路由表并使用 netspy 探测活跃子网可达性（后续交由 gogo/fscan 细扫）
ip route show
# netspy 快速探测网关可达网段
```
