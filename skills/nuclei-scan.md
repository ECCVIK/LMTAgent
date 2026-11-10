---
name: nuclei-scan
category: 验证
tags: [automated-regression, contract-templates, security-baseline, cve-check]
description: 【验证】基于 YAML 声明式模板的自动化接口契约回归测试与已知组件缺陷（Nday/基线）快速筛查
---

# 声明式模板自动化回归与组件基线扫描（Template-Driven Baseline Verification）

## 适用场景（When to Use）
在版本发布前或接手存量系统时，使用声明式 HTTP/TCP 模板库批量验证接口响应契约、安全响应头及第三方组件已知缺陷。

## 标准工程作业流程（Standard Operating Procedure）
1. 先调用 `redteam_poc_search` 检索本地已验证的回归测试模板与组件检查脚本，避免重复编写。
2. 针对目标服务端点执行定向模板验证（按组件名或标签精确过滤，禁止无差别全量盲扫）。
3. 对模板命中的告警逐一进行人工或脚本复核，确认真实复现且获取完整原始请求/响应报文后，调用 `redteam_vuln_add` 建档。
4. 若新编写了通用的组件回归测试模板，验证通过后调用 `redteam_poc_add` 回填全局知识库。

## 参考命令与代码模板（Reference Snippet）
```
# 使用指定标签或模板路径执行定向基线验证
# nuclei -u http://127.0.0.1:8080 -t http/misconfiguration/ -silent
```
