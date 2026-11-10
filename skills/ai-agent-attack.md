---
name: ai-agent-attack
category: 验证
tags: [llm-agent, prompt-guard, tool-sandbox, rag-eval, schema-validation]
description: 【验证】AI 智能体与 LLM 工具调用链可靠性评估、結構化输出校验与沙箱边界防护测试
---

# AI 智能体工作流工程化与沙箱可靠性验证（AI Agent & Tooling Reliability）

## 适用场景（When to Use）
在构建或评审基于大语言模型（LLM）的多智能体编排系统、MCP 工具调用、RAG 检索管道及结构化 JSON 输出契约时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 审查智能体系统提示词（System Prompt）与外部不可信数据（用户输入、网页抓取、文档切片）的隔离边界，确保数据内容不触发未授权工具调用。
2. 验证所有工具调用（Tool Call）的 JSON Schema 严格校验与幂等回退机制，确保参数异常时返回结构化错误而非崩溃。
3. 评估多智能体并发槽位（6-Slot Concurrency Gate）与最大递归深度（maxDepth: 3）在异常重试场景下的退避表现。
4. 记录评估报告与边界测试用例至 `redteam_vuln_add` 或 `redteam_attack_file_add`。

## 参考命令与代码模板（Reference Snippet）
```
# 运行智能体工具 Schema 契约与并发门禁回归测试
node packages/redteam-tools/test/tool-schema.test.mjs
```
