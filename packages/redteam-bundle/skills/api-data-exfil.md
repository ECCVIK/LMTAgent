---
name: api-data-exfil
category: 得分
tags: [api-pagination, batch-export, data-migration, schema-audit, etl]
description: 【得分】高吞吐 API 批量数据分页流式导出、ETL 迁移一致性校验与字段脱敏治理
---

# 大规模数据流式迁移与接口分页治理（API Data Streaming & ETL Verification）

## 适用场景（When to Use）
在执行海量业务数据迁移、游标分页（Cursor Pagination）性能调优、批量导出接口压测或 PII 敏感字段脱敏合规审查时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 检查列表与导出接口是否强制实施游标分页或最大 `limit` 限制，防止单次大查询导致 PostgreSQL 内存溢出。
2. 使用流式游标抽样核对源库与目标库的记录总数（row_count）及核心 Schema 字段完整性。
3. 针对包含敏感字段的数据集，验证序列化层是否正确执行掩码脱敏规则。
4. 调用 `redteam_data_proof`（op=add）登记实测迁移或治理的数据集规模、字段清单与脱敏样本。

## 参考命令与代码模板（Reference Snippet）
```
# 使用游标分页校验批量接口吞吐与结构化字段一致性
curl -sS "http://127.0.0.1:8080/api/v1/records?cursor=0&limit=100" | jq "{count: (.items | length), next_cursor}"
```
