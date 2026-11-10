---
name: kimi-webbridge
category: 侦察
tags: [doc-bridge, knowledge-retrieval, api-spec, cross-reference]
description: 【侦察】跨源技术文档桥接检索、长上下文架构规范对齐与开源方案对比分析
---

# 长上下文技术文档桥接与规范对齐（Web Knowledge Bridge & Spec Alignment）

## 适用场景（When to Use）
需要整合多份外部 RFC 标准、云厂商 SDK 文档或跨仓库接口规范，进行长上下文对比与架构方案选型时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 明确待解决的架构设计问题或跨版本 SDK 兼容性疑问，列出核心检索关键词。
2. 抓取官方权威文档与变更日志，过滤过时的社区二手片段，提取可验证的代码示例与配置契约。
3. 在本地沙箱编写最小化验证脚本（MVP）实测文档方案的可行性。
4. 将验证通过的跨版本适配方案通过 `redteam_poc_add` 归档至工程知识库。

## 参考命令与代码模板（Reference Snippet）
```
# 抓取并提取在线 OpenAPI / 技术文档结构摘要
curl -sS https://httpbin.org/json | jq "."
```
