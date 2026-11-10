---
name: web-fingerprint
category: 侦察
tags: [tech-stack, framework-detection, http-headers, ssr-csr, component-version]
description: 【侦察】Web 应用技术栈指纹分析：识别前端框架（React/Vue/Next.js）、网关服务器、SSR/CSR 渲染模式与组件版本
---

# Web 应用技术栈与架构特征分析（Web Tech-Stack & Architecture Fingerprinting）

## 适用场景（When to Use）
在开展前端重构、全栈接口对接或存量 Web 系统性能与安全评审前，快速识别目标站点的技术栈、构建工具与服务端框架版本。

## 标准工程作业流程（Standard Operating Procedure）
1. 检查 HTTP 响应头（`Server`、`X-Powered-By`、`Content-Security-Policy`、`Cache-Control`）与 Cookie 命名规范。
2. 分析首页 HTML 结构、静态资源路径前缀（如 `/_next/static/`、`/assets/`）及全局挂载特征，判断 SSR/CSR 架构模式。
3. 调用 `redteam_service_add` 将识别出的框架名称、产品名（`product`）与版本号（`version`）结构化入库。
4. 结合识别出的组件版本，调用 `redteam_poc_search` 检查是否存在已知的版本兼容性或安全基线问题。

## 参考命令与代码模板（Reference Snippet）
```
# 采集目标 Web 服务的响应头与页面标题信息
curl -sSI http://127.0.0.1:8080 | head -n 20
```
