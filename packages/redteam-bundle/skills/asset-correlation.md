---
name: asset-correlation
category: 侦察
tags: [dependency-graph, architecture, service-mesh, domain-mapping]
description: 【侦察】微服务依赖拓扑关联分析：将域名路由、容器节点、数据库实例与代码模块建立映射
---

# 系统架构拓扑与跨模块依赖关联（Architecture & Service Correlation）

## 适用场景（When to Use）
收集到多个服务端点、子域名、容器 IP 与代码包后，梳理它们之间的上下游调用关系、共享数据库与网关归属。

## 标准工程作业流程（Standard Operating Procedure）
1. 调用 `redteam_domain_index` 与 `redteam_asset_list` 汇总当前工作区的所有域名、主机节点与开放端口。
2. 分析各服务的配置文件、环境变量引用与网关路由表，识别核心业务链路（T0/T1）与外围辅助服务（T2/T3）。
3. 使用 `redteam_asset_assess` 为每个核心模块标注研发优先级（high/medium/low）与预期交付物。
4. 调用 `redteam_attack_path` 导出架构拓扑图，供主控架构师（Captain）排布 4-Wave Bounded DAG。

## 参考命令与代码模板（Reference Snippet）
```
# 检查工作区服务模块依赖树
npm ls --depth=1
```
