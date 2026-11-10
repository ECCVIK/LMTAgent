---
name: mobile-code-recon
category: 侦察
tags: [static-analysis, ast-scan, client-bundle, secret-detection, sdk-audit]
description: 【侦察】客户端与移动端构建包（Bundle / APK / 小程序）静态代码分析、硬编码密钥扫描与 API 契约提取
---

# 客户端构建产物静态分析与密钥合规扫描（Client Bundle & Static Code Audit）

## 适用场景（When to Use）
在审计前端打包产物、移动端应用包或第三方 SDK 依赖时，提取后端 API 契约清单并扫描是否误植入硬编码私钥或内部调试地址。

## 标准工程作业流程（Standard Operating Procedure）
1. 扫描代码仓库与构建产物目录中的高熵字符串、私钥头（`BEGIN PRIVATE KEY`）及敏感环境变量前缀。
2. 利用 AST 或正则规则从客户端源码中提取所有 HTTP/WebSocket 请求端点，生成客户端 API 依赖清单。
3. 核对客户端调用的每个接口是否均已在后端网关声明并配置了适当的鉴权策略。
4. 若发现硬编码凭据或未保护的内部端点，立即通过 `redteam_vuln_add` 登记并推动修复。

## 参考命令与代码模板（Reference Snippet）
```
# 扫描源码目录中潜在的硬编码密钥或未脱敏 Token
grep -rnE "(AKIA[0-9A-Z]{16}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)" src/ packages/ 2>/dev/null || echo "Clean: no hardcoded keys found"
```
