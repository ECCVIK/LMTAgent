---
name: dir-bruteforce
category: 侦察
tags: [route-audit, api-catalog, static-assets, source-map, endpoint-check]
description: 【侦察】Web 路由表完整性盘点、未登记 API 端点探测与生产构建产物（SourceMap/调试路由）暴露检查
---

# Web 路由表审计与静态构建产物检查（Route Catalog & Build Artifact Audit）

## 适用场景（When to Use）
在前端或网关服务上线前，核对代码路由表与实际暴露的 HTTP 端点是否一致，检查是否存在未鉴权的调试路由或意外打包的敏感构建文件。

## 标准工程作业流程（Standard Operating Procedure）
1. 从源码路由配置（Next.js App Router / Express / FastAPI / Spring Controller）提取完整路由清单。
2. 对比线上或测试环境实际响应状态码，确认废弃接口已下线且管理端点均受鉴权中间件保护。
3. 检查静态资源目录是否意外暴露 `.map`（SourceMap）、`.env` 模板或未压缩的构建调试产物。
4. 将盘点确认的 Web 端点与发现的配置问题同步至 `redteam_service_add` 与 `redteam_vuln_add`。

## 参考命令与代码模板（Reference Snippet）
```
# 批量核验核心 API 路由与静态产物的 HTTP 响应状态码
for path in /healthz /api/v1/status /openapi.json; do
  printf "%-24s -> " "$path"
  curl -o /dev/null -s -w "%{http_code}\n" "http://127.0.0.1:8080${path}"
done
```
