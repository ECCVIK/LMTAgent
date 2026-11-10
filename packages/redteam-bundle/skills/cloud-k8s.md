---
name: cloud-k8s
category: 内网
tags: [kubernetes, docker, helm, service-account, cloud-native]
description: 【内网】云原生容器集群（Kubernetes / Docker）编排配置、ServiceAccount 权限治理与微服务部署验证
---

# 云原生与 Kubernetes 容器编排治理（Cloud-Native & K8s Engineering）

## 适用场景（When to Use）
在设计、部署或审查 Docker 容器镜像、Kubernetes Deployment/Service 清单、RBAC RoleBinding 及 Secret 挂载策略时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 检查容器镜像构建规范：确保采用多阶段构建（Multi-stage Build）、非 root 用户运行及最小化基础镜像。
2. 审查 Kubernetes Pod Security Context、Resource Limits（CPU/Memory）以及就绪/存活探针（readinessProbe/livenessProbe）。
3. 核验 ServiceAccount 与 ClusterRoleBinding 权限范围，杜绝默认挂载高权限集群凭据。
4. 验证跨 Namespace 服务发现与 Ingress 路由规则，并将配置验证结果写入工作流步骤。

## 参考命令与代码模板（Reference Snippet）
```
# 检查 Kubernetes 部署状态与 Pod 健康度
kubectl get deploy,pods,svc -o wide
```
