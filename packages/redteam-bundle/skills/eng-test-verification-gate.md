---
name: eng-test-verification-gate
category: 工程
tags: [qa-gate, cross-platform, build-check, confidential-gate, verification]
description: 【工程】QA Lead / qa 质量门禁与真实输出验收规范：Windows/Linux 跨平台测试、build.mjs --check、check-no-confidential --all 与零篡改验收
---

# 自动化回归与质量门禁验收规范（Test Verification Gate）

## 适用场景（When to Use）
`QA Lead / qa` 角色在 **Wave 4** 对全栈集成成果执行最终测试门禁、跨平台兼容性验证、产物一致性校验与敏感信息闸门检查时使用，确保只有 100% 实测通过的变更才能进入发版流程。

## 标准工程作业流程（Standard Operating Procedure）
1. **核对待验收目标与既有产物**：调用 `lmt_workflow({ action: "status" })` 与 `lmt_artifact_query` 对照 Wave 1 冻结的 `acceptance_criteria` 及 Wave 4 `finding` 修复记录，确认前置缺陷均已处理完毕。
2. **执行全量自动化测试（诚实门禁原则）**：
   - 在最后一次源码改动后运行全量回归测试入口（如 `node packages/redteam-bundle/tools/test-all.mjs`）以及专项单元测试；逐项核对输出中的 `通过 N/M` 与退出码 `0`。
   - **绝对红线**：严禁为了通过门禁而删减断言、跳过失败用例或用未运行的旧输出冒充本次实测结果。
3. **Windows / Linux 跨平台兼容性专项核验**：
   - 检查路径处理是否正确适配 `path.sep` 与 POSIX `/` 归一化，动态 `import()` 是否使用 `pathToFileURL`。
   - 检查临时目录清理前是否显式关闭 SQLite / PGlite / 文件句柄，防止 Windows 环境下出现 `EBUSY` 锁定错误。
   - 检查换行符（LF/CRLF）与 Git 索引/脚本执行权限兼容，确保 Windows 与 Linux CI 双端一致绿灯。
4. **构建产物零漂移检查（`build.mjs --check`）**：运行 `node packages/redteam-bundle/tools/build.mjs --check`，确认模块化样式、客户端脚本、预设声明与包产物同源码 100% 字节同步，无未重建漂移。
5. **敏感内容防泄露全量闸门（`check-no-confidential --all`）**：运行 `node scripts/check-no-confidential.mjs --all`（连同未跟踪文件一起扫描）与 `--selftest`，确认零敏感统计、零私网清单、零凭据真值残留。
6. **验收证据落库**：调用 `lmt_artifact_record` 登记真实测试命令、通过文件数/断言数及门禁结论；任一门禁失败立即阻断发版并反馈主控打回修复。

## 参考命令与代码模板（Reference Snippet）
```sh
# 1. 全量自动化回归测试（store -> tools -> ui -> bundle）
node packages/redteam-bundle/tools/test-all.mjs

# 2. 构建产物同步一致性检查（零漂移门禁）
node packages/redteam-bundle/tools/build.mjs --check

# 3. 敏感内容防泄露全量扫描（含未跟踪文件）及规则自检
node scripts/check-no-confidential.mjs --all
node scripts/check-no-confidential.mjs --selftest
```
