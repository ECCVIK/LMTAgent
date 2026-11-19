---
name: eng-code-review-security
category: 工程
tags: [code-review, security-audit, concurrency-race, path-traversal, injection-guard]
description: 【工程】Reviewer & CSO / vuln-scan 静态代码审查与安全审计规范：并发竞态、路径穿越、注入风险排查并记录 finding 产物
---

# 静态代码审查与安全编码审计规范（Code Review & Defensive Security Audit）

## 适用场景（When to Use）
`Reviewer & CSO / vuln-scan` 角色在 **Wave 4** 对 Wave 3 合入分片执行独立代码审查（Code Review）与防御性安全编码审计时使用，旨在在发版前拦截逻辑缺陷、并发竞态、输入安全隐患与“许愿式编程”假实现残留。

## 标准工程作业流程（Standard Operating Procedure）
1. **拉取变更摘要与既有缺陷基线**：调用 `lmt_workflow({ action: "status" })` 与 `lmt_artifact_query` 核对各分片提交的 `files_touched`、技术决策与已登记问题单，避免对已闭环且无新改动的模块重复告警。
2. **核心安全编码与稳定性静态审查（P0 优先）**：
   - **注入风险防御（Injection Defense）**：核查数据库查询是否全部采用参数化占位符（严禁字符串拼接 SQL）；核查外部进程调用是否采用 `execFile` / `spawn` 参数数组并关闭非必要 Shell 解释（严禁拼接用户输入到命令行）；核查前端渲染是否对动态内容转义且无不安全 HTML 注入；核查外部文档/响应解析是否隔离为纯数据而非控制指令。
   - **路径穿越与文件系统边界（Path Traversal Guard）**：核查所有文件读写、解压、静态资源服务与导出路径是否在规范化（`path.resolve`）后严格校验归属根目录前缀，阻断 `../` 逃逸、空字节与非法文件名。
   - **并发竞态与事务一致性（Concurrency & Race Audit）**：排查多 Worker/多请求场景下的 TOCTOU（检查与使用时间差）、缺失数据库事务原子性、幂等重入产生重复记录、未清理定时器或文件句柄泄漏问题。
3. **反假数据与契约完整性审查（P1）**：核查是否存在未实现 `TODO`、硬编码假指标、吞异常空 `catch` 块、前后端字段名漂移、大表查询缺失索引或 N+1 循环查询，以及代码中硬编码密钥/令牌残留。
4. **结构化落库缺陷单（`kind="finding"`）**：对每条有确凿代码位置（文件路径 + 行号）与复现依据的真实问题，调用 `lmt_artifact_record` 并传入 `kind: "finding"` 持久化记录（写明 `severity`、影响范围、根因与最小修复方案）；绝不输出无证据支撑的猜测性告警。
5. **阻断与返工流转**：若存在阻断发版的 High/Critical 级 `finding`，配合 `lmt_workflow`（`action="approve_worker"` 配合 `decision="revision_requested"`）打回对应分片修订，修复后复审确认闭环。

## 参考命令与代码模板（Reference Snippet）
```json
// 发现真实安全或逻辑缺陷后，调用 lmt_artifact_record(kind="finding") 落库
{
  "tool": "lmt_artifact_record",
  "arguments": {
    "kind": "finding",
    "severity": "high",
    "title": "导出路径未校验根目录边界存在路径穿越风险",
    "target": "packages/tools/lib/export.js:142",
    "evidence": "resolve(baseDir, userInput) 未校验结果是否仍以 baseDir + sep 开头，传入 ../ 可跳出导出目录",
    "recommendation": "使用 path.relative(baseDir, targetPath) 校验非 '..' 开头且非绝对路径后再执行读写"
  }
}
```
