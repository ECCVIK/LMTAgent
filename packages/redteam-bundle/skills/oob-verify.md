---
name: oob-verify
category: 验证
tags: [webhook, async-callback, event-driven, message-queue, idempotency]
description: 【验证】异步事件驱动架构（Webhook / 消息队列回调 / 定时任务）端到端可达性与幂等性验证
---

# 异步回调与事件驱动链路验证（Async Callback & Out-of-Band Verification）

## 适用场景（When to Use）
在开发或测试无同步回显的异步业务流（如支付 Webhook 回调、邮件/通知投递、队列消费者处理、SSRF 防护边界验证）时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 启动受控的本地或测试环境回调接收监听器（Callback Listener），生成带唯一关联标识（Correlation ID）的回调 URL。
2. 触发目标服务的异步任务或事件发布接口，观测回调接收端是否收到预期的请求头、签名与 JSON 载荷。
3. 重复重放相同事件 ID 的回调报文，验证消费端是否正确实现幂等去重（Idempotency Key）。
4. 将异步请求与回调接收日志作为完整证据链存入 `redteam_http_evidence_add`。

## 参考命令与代码模板（Reference Snippet）
```
# 发送带唯一幂等键（Idempotency-Key）的异步事件触发请求
curl -sS -X POST http://127.0.0.1:8080/api/v1/webhooks/test \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: evt-2026-0001" \
  -d "{"event":"build.completed","status":"success"}"
```
