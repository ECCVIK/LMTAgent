---
name: credential-attack
category: 访问
tags: [auth-testing, password-policy, rate-limit, jwt-verify, session-security]
description: 【访问】认证接口安全基线测试：口令复杂度策略、登录限流（Rate Limit）、JWT 签名校验与会话生命周期验证
---

# 身份认证基线与会话安全验证（Authentication & Session Baseline Testing）

## 适用场景（When to Use）
在审查登录注册模块、API Token 鉴权中间件、OAuth2 回调及分布式 Session 存储安全性时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 检查默认配置与初始化种子数据，确保生产与预发环境不存在弱默认口令或未受保护的调试账号。
2. 测试登录与验证码接口的滑动窗口限流（Rate Limiting）与账号锁定机制是否正常生效。
3. 验证 JWT / Session Token 的签名算法强度、过期时间（exp）校验以及登出后的服务端吊销状态。
4. 实测通过的鉴权基线与发现的配置缺陷分别通过 `redteam_vuln_add` 与 `redteam_score_hit` 记录。

## 参考命令与代码模板（Reference Snippet）
```
# 验证鉴权端点在缺少或携带无效 Token 时的 401 拦截行为
curl -i -sS -H "Authorization: Bearer invalid.token.signature" http://127.0.0.1:8080/api/v1/profile | head -n 15
```
