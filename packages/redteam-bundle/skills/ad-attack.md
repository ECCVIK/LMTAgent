---
name: ad-attack
category: 内网
tags: [iam, ldap, oidc, sso, rbac-audit]
description: 【内网】企业级 IAM / OIDC / LDAP 统一身份认证与 RBAC 权限矩阵架构实现与联调验证
---

# 企业统一身份认证与权限架构治理（Enterprise IAM & RBAC Engineering）

## 适用场景（When to Use）
当项目涉及多租户 SSO、LDAP/Active Directory 组织架构同步、OIDC/OAuth2 令牌签发或细粒度 RBAC/ABAC 权限门禁研发与审查时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 梳理认证中心（IdP）与业务微服务（SP）之间的 Token 签发、JWKS 公钥轮转与会话吊销契约。
2. 检查角色继承关系与权限边界，确保最小权限原则（Least Privilege），防止普通租户角色越权访问系统管理接口。
3. 编写自动化鉴权回归测试，覆盖未登录拦截、普通角色、租户管理员与平台超级管理员四级会话上下文。
4. 验证通过后，通过 `redteam_cred_add` 登记测试环境标准角色凭据引用，并用 `redteam_score_hit` 记录鉴权模块里程碑。

## 参考命令与代码模板（Reference Snippet）
```
# 验证 OIDC Discovery 端点与 JWKS 签名公钥配置
curl -sS https://sso.example.internal/.well-known/openid-configuration | jq "{issuer, token_endpoint, jwks_uri}"
```
