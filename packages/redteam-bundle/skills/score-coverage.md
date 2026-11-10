---
name: score-coverage
category: 得分
tags: [milestone-matrix, acceptance-criteria, deliverable-verification, quality-gate]
description: 【得分】研发里程碑全量覆盖矩阵：核对 8 大工程交付类别与 25 项验收标准，确保交付证据链完整闭合
---

# 工程里程碑覆盖矩阵与验收标准核对（Milestone Coverage & Acceptance Gate）

## 适用场景（When to Use）
在规划阶段目标、处理非标准基础设施模块（如网关、容器集群、身份中心、CI/CD 流水线）或在发版前复核里程碑达成度时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 调用 `redteam_score_list` 查看 8 大里程碑类别（认证与会话、服务与容器、数据库与存储、基础设施与域名、跨网段网关、系统验证、数据治理、核心业务交付）的达成进度与上限（cap）。
2. 严格遵循去重口径：同一服务端口只按最高交付档位计一次（G1），沙箱自建的 Mock 测试账号必须标注 `self_created=true`（不计入正式里程碑得分）。
3. 跨网段联调里程碑（`boundary-*`）必须提供结构化 `boundary` 四要素对象（`entry_zone`、`target_zone`、`isolation`、`target_asset`）。
4. 登记里程碑前确认已通过 `redteam_http_evidence_add`、`redteam_shot_save` 或 `command` 参数备齐可复现验收材料。

## 参考命令与代码模板（Reference Snippet）
```
# 生成四段式工程里程碑与质量交付报告并检查缺口（missing_evidence）
# 调用 redteam_score_report(markdown=false) 检查每项的 missing_evidence 字段
```
