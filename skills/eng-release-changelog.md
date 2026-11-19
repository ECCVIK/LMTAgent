---
name: eng-release-changelog
category: 工程
tags: [release-notes, changelog, bilingual-docs, report-export, doc-release]
description: 【工程】Doc & Release / internal 发版与变更日志规范：基于 worker_digests 汇编中英双语 Release Notes、lmt_report_export 归档与发版终检
---

# 双语变更日志汇编与发版交付规范（Release Notes & Archive Export）

## 适用场景（When to Use）
`Doc & Release / internal` 角色在 **Wave 4 收尾阶段** 确认代码审查与测试门禁全部通过后使用：汇总事实库中的 `worker_digests` 编写中英双语 Release Notes、同步项目文档、导出工程交付报告并完成发版前最终核验。

## 标准工程作业流程（Standard Operating Procedure）
1. **核对发布前置门禁与环境状态**：调用 `lmt_workflow({ action: "status" })`、`lmt_artifact_query` 与 `lmt_preflight` 核实：`vuln-scan` 无未解决的高危 `finding`、`qa` 全部测试门禁与构建一致性检查已绿灯，且环境工具链就绪。
2. **基于 `worker_digests` 提取真实变更事实**：从已审批（`approved`）的 `worker_digests` 记录中逐条汇总 `what_was_done`、`files_touched`、`key_decisions` 与 `verification` 验证结果；**严禁脱离真实提交记录编造未实现的功能特性或未验证的性能数字**。
3. **汇编中英双语 Release Notes 与文档同步**：
   - 在版本发布目录（如 `docs/releases/vX.Y.Z.md`）生成或更新中英双语 Release Notes：包含版本概述、核心变更分类（Features / Architecture / Fixes / Verification）、迁移或配置说明与实测门禁结果。
   - 同步核对中文/英文主文档（如 `README.md` 与 `README.zh-CN.md`）的版本号、命令示例与功能矩阵，确保与当前源码实现 100% 一致。
   - 严守公开仓库保密底线：发版说明内禁止写入真实凭据、内网段清单、本机绝对路径或未脱敏敏感环境细节。
4. **导出工程交付报告与归档（`lmt_report_export`）**：调用 `lmt_report_export` 导出结构化工程交付报告，核对报告中模块清单、分片变更摘要与验收验证链路完整无缺；必要时调用 `lmt_artifact_record` 登记发版归档产物。
5. **发版前最终复核**：确认版本号对齐、生成物与源码同步、工作区干净无残留临时文件且敏感内容门禁通过后，再执行打 Tag 或发布动作。

## 参考命令与代码模板（Reference Snippet）
```json
// 1) 调用 lmt_artifact_query 查阅已归档的验收证据与审批状态
{
  "tool": "lmt_artifact_query",
  "arguments": {
    "kind": "digest"
  }
}

// 2) 调用 lmt_report_export 导出结构化交付报告用于发版归档
{
  "tool": "lmt_report_export",
  "arguments": {
    "format": "markdown"
  }
}
```
