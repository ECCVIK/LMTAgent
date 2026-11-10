---
name: fofa-recon
category: 侦察
tags: [domain-inventory, external-surface, tls-cert, subdomain, asset-catalog]
description: 【侦察】外部域名与公网服务端点资产盘点、TLS 证书透明度查询与网关入口架构测绘
---

# 公网服务端点与域名资产盘点（External Service & Domain Inventory）

## 适用场景（When to Use）
在大型多系统架构重构或云端服务迁移初期，全面盘点项目关联的公网域名、子域名、CDN 边缘节点与 API 网关入口。

## 标准工程作业流程（Standard Operating Procedure）
1. 汇总项目已知的主域名、公网 IP 段与云负载均衡入口。
2. 结合 DNS 解析记录与 TLS 证书 SAN（Subject Alternative Name）信息，补全子服务域名映射表。
3. 调用 `redteam_asset_add` 与 `redteam_service_add` 将确认归属的服务端点录入工程数据库，并附上归属证据。
4. 通过 `redteam_domain_index` 核对域名与后端服务节点的聚合关系。

## 参考命令与代码模板（Reference Snippet）
```
# 查询域名 DNS 解析与 TLS 证书主题备用名称（SAN）
dig +short api.example.com
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null 2>/dev/null | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
```
