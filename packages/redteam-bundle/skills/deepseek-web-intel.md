---
name: deepseek-web-intel
category: 侦察
tags: [deepseek, web-search, web-fetch, doc-research, tech-intel]
description: 【侦察】调用 DeepSeek 官方 Search / Fetch 接口检索最新技术文档、开源组件变更日志与架构方案
---

# DeepSeek 官方搜索与网页抓取集成（DeepSeek Web Search & Fetch）

## 适用场景（When to Use）
当内置 web_search 工具不可用或需要高精度检索官方技术文档、RFC 规范、开源库 Issue 及版本兼容性说明时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 从环境变量读取 `DEEPSEEK_API_KEY`（也可在可选的 `$DSH_HOME/.env` 中配置后加载，严禁将密钥硬编码进代码仓库）。
2. 调用 `https://api.deepseek.com/v1/tools/search` 检索结构化技术结果，或调用 `https://api.deepseek.com/v1/tools/fetch` 抓取指定文档页面的 Markdown 正文。
3. 将检索到的架构方案、API 变更说明或版本兼容结论提炼后写入 `redteam_poc_add` 或工作流决策记录。

## 参考命令与代码模板（Reference Snippet）
```
import os, json, urllib.request

# 必需环境变量：DEEPSEEK_API_KEY
API_KEY = os.environ["DEEPSEEK_API_KEY"]

def deepseek_search(query: str):
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/tools/search",
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def deepseek_fetch(url: str):
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/tools/fetch",
        data=json.dumps({"url": url}).encode("utf-8"),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))
```
