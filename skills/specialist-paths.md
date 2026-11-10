---
name: specialist-paths
category: 规划
tags: [architecture-patterns, domain-playbooks, iam-sso, cloud-native, data-intensive]
description: 【规划】六大专项工程架构研发手册：企业 IAM（AD / 身份）、云原生 K8s、高并发 API、数据密集型存储、CI/CD 供应链与 AI 智能体
---

# 六大专项技术栈工程研发路径手册（Specialist Engineering Playbooks）

## 适用场景（When to Use）
当项目涉及特定复杂技术领域（企业统一身份认证、云原生容器网格、高吞吐数据管道、CI/CD 供应链加固或 AI 智能体编排）时，按专项手册指派最匹配的角色组合。

## 标准工程作业流程（Standard Operating Procedure）
1. 专项一（**AD / 身份** 与多租户鉴权中心）：由 Designer 梳理 OIDC/LDAP 契约，Builder 实现 Token 签发与 RBAC 中间件，QA 实测多角色会话隔离。
2. 专项二（云原生容器与 Kubernetes 编排）：核查 Dockerfile 多阶段构建、K8s ServiceAccount 最小权限与健康探针。
3. 专项三（高并发 API 与微服务网关）：聚焦接口幂等性、游标分页、分布式限流与跨区联调通道稳定性。
4. 专项四（PostgreSQL 16+ 数据密集型应用）：优化事务隔离级别、GIN/B-Tree 索引、WAL 写入延迟与大表迁移校验。
5. 专项五（CI/CD 研发供应链与自动化构建）：锁定依赖树版本（Lockfile）、构建产物签名与环境密钥隔离。
6. 专项六（AI 智能体与自动化工作流）：验证提示词边界防护、工具 Schema 强校验与 6 槽并发调度。

## 参考命令与代码模板（Reference Snippet）
```
# 根据专项技术栈选择对应的自动化测试套件
npm test
```
