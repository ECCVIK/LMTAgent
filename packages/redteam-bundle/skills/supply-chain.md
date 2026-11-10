---
name: supply-chain
category: 内网
tags: [ci-cd, dependency-audit, sbom, git-hooks, artifact-integrity]
description: 【内网】软件供应链安全与 CI/CD 流水线治理：依赖树审计、Lockfile 完整性校验、Git 工作流规范与构建产物可复现性验证
---

# 软件供应链治理与 CI/CD 流水线加固（Software Supply Chain & CI/CD Engineering）

## 适用场景（When to Use）
在审查项目第三方依赖（npm / PyPI / Go Modules）、配置 GitHub Actions / GitLab CI 自动化流水线或执行发版打包可复现性验证时使用。

## 标准工程作业流程（Standard Operating Procedure）
1. 核查依赖锁文件（`package-lock.json` / `pnpm-lock.yaml` / `uv.lock`）是否与清单文件严格同步，杜绝未锁定版本的浮动依赖。
2. 审查 `package.json` 中的生命周期脚本（`preinstall` / `postinstall`）与 CI 构建脚本，确保不存在未经审阅的外部脚本盲执行。
3. 执行构建产物可复现性校验（如 `build.mjs --check`），确保发布的 Bundle 与源码包字节级一致。
4. 对跨仓库或第三方供应链集成的验证，务必确认已在授权的工作区范围内执行。

## 参考命令与代码模板（Reference Snippet）
```
# 验证 Bundle 生成物与源码包完全同步且无漂移
node packages/redteam-bundle/tools/build.mjs --check
```
