---
name: webshell-toolkit
category: 访问
tags: [runtime-probe, health-agent, diagnostic-endpoint, hot-reload, telemetry]
description: 【访问】应用运行态诊断探针（Runtime Diagnostic Probe）管理、在线健康巡检与热重载状态同步
---

# 应用运行态诊断探针与端点管理（Runtime Diagnostic Probe Toolkit）

## 适用场景（When to Use）
在受控开发/测试环境中部署或管理应用运行态诊断端点、执行远程健康检查、采集线程/内存快照并同步至项目控制台时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 在登记任何运行态端点前，先调用 `redteam_webshell_list` 查看当前工作区已有的在线端点，直接复用已有连接。
2. 新增运行态诊断端点时，调用 `redteam_webshell_add` 记录完整 URL、协议类型与凭据引用文件（`secret_ref`），并在 `redteam_cleanup` 同步建立待清理记录。
3. 执行长耗时联调前后，调用 `redteam_session_check` 自动探测所有端点的 HTTP 响应状态并刷新在线标记。
4. 项目交付与发版前，必须确保所有临时调试探针均已安全卸载并通过 `redteam_cleanup`（op=update, status=done）完成核销。

## 参考命令与代码模板（Reference Snippet）
```
# 检查运行态诊断端点健康状态
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz
```
