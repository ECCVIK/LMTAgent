---
name: browser-automation
category: 验证
tags: [playwright, e2e-testing, ui-verification, screenshot, dom-audit]
description: 【验证】基于无头浏览器的前端 UI 端到端（E2E）交互自动化测试、表单断言与视觉截图留存
---

# 前端端到端自动化测试与视觉验收（Browser E2E & Visual Verification）

## 适用场景（When to Use）
在完成前端组件开发、登录鉴权流程或复杂状态交互后，通过真实浏览器渲染页面、验证 DOM 状态并采集高保真验收截图。

## 标准工程作业流程（Standard Operating Procedure）
1. 启动本地或测试环境前端服务，确认入口 URL 与路由可正常加载且无 Console 未捕获异常。
2. 执行真实表单填充、登录会话建立与核心业务流点击操作，验证网络请求状态码与页面状态同步。
3. 采集关键交互界面的完整截图，并通过 `redteam_shot_save` 关联至对应的工程里程碑或评审单。
4. 确保所有鉴权与 UI 里程碑均具备真实浏览器渲染验证证据。

## 参考命令与代码模板（Reference Snippet）
```
# 使用 Playwright 执行无头浏览器端到端断言与截图
npx playwright test --reporter=list
```
