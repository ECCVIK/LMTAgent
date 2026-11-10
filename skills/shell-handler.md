---
name: shell-handler
category: 访问
tags: [runtime-session, pty-management, process-supervisor, daemon-health]
description: 【访问】长耗时开发服务进程托管、交互式终端会话（PTY）管理与远端调试端点生命周期维护
---

# 运行态服务进程托管与会话生命周期管理（Runtime Session & Process Handler）

## 适用场景（When to Use）
在启动后台开发服务器（Dev Server）、数据库迁移长任务、远端容器调试会话或维护已登记的运行态探针端点时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 启动后台常驻服务（如 Web 开发服、队列 Worker）时，确保标准输出与错误日志重定向至可观测日志文件，并记录 PID 与监听端口。
2. 对于远端运行态调试端点，通过 `redteam_webshell_add` 规范登记 URL、协议类型与鉴权引用（切勿把明文密码写入数据库）。
3. 定期调用 `redteam_session_check` 检查所有已托管会话的存活状态，掉线或已下线的会话及时通过 `redteam_webshell_update` 刷新状态。
4. 严禁在交互式会话中执行阻塞式无超时命令，所有远程命令均需设置明确的超时阈值。

## 参考命令与代码模板（Reference Snippet）
```
# 检查后台托管服务监听端口与进程健康状态
ps -ef | grep -E "node|python3|postgres" | grep -v grep
```
