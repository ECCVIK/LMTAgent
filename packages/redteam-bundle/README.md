# dsh-lmtagent (`v1.0.0`)

Multi-agent software engineering orchestrator and docked workbench plugin for DeepSeek Harness (DSH Desktop), packaged cleanly as a self-contained single-bundle distribution with zero external runtime dependencies.

[Full English Documentation](https://github.com/ECCVIK/LMTAgent/blob/main/README.md) | [Simplified Chinese Documentation](https://github.com/ECCVIK/LMTAgent/blob/main/README.zh-CN.md)

---

## UI Preview (`v1.0.0`)

| Overview & Expandable Context Drawer | Cluster Scheduling & Topology Tree |
| :---: | :---: |
| ![Overview & Expandable Context Drawer](https://raw.githubusercontent.com/ECCVIK/LMTAgent/main/docs/assets/ui-overview-workbench-en.png) | ![Cluster Scheduling & Topology Tree](https://raw.githubusercontent.com/ECCVIK/LMTAgent/main/docs/assets/ui-agents-dag-en.png) |
| **Collaboration, Quick Demos & Scope Rollback** | **Unified Settings & Dispatch Policy** |
| ![Collaboration, Quick Demos & Scope Rollback](https://raw.githubusercontent.com/ECCVIK/LMTAgent/main/docs/assets/ui-assets-pg-en.png) | ![Unified Settings & Dispatch Policy](https://raw.githubusercontent.com/ECCVIK/LMTAgent/main/docs/assets/ui-report-v2-en.png) |

---

## Key Highlights (`v1.0.0`)

- **Coexistence-Ready Namespace (`dsh-lmtagent`)**: Independent Cordis plugin IDs (`lmtagent-mode`, `lmtagent-tools`, `lmtagent-ui`, `dsh-lmtagent-ui`), routes (`/lmtagent/api`, `/lmtagent/events`), presets (`preset-lmtagent*`), and `$DSH_HOME/lmtagent` workspace storage (with automatic non-destructive copy migration from `$DSH_HOME/redteam`).
- **12 Clean Engineering Skills & 12 Lean `lmt_*` Tools**: Ships strictly the 12 clean engineering and workflow skills (`eng-*` x8 + `campaign-planning`, `browser-automation`, `opsec-hygiene`, `supply-chain`) and 12 compact `lmt_*` tools (`11,645` bytes serialized schema, `58%` below the `28,000`-byte baseline).
- **Modular High-Performance Architecture**: Write-versioned store read memoization, incremental `.jsonl` byte-offset telemetry, pre/post-write `ShardLock` validation with Git `rollbackScopeViolations`, workspace token/cost budget circuit breaker, exponential-backoff auto-retry (`maxAutoRetries`), experimental speculative DAG pipelining (`speculativeWaveDispatch`), and reactive bilingual `zh-CN` / `en-US` UI.

---

## Installation

```bash
dsh plugin add github:ECCVIK/LMTAgent
```

Or install from the DSH Desktop Plugin Market by searching `dsh-lmtagent`.

---

## Verification Gates

```bash
node packages/redteam-bundle/tools/build.mjs --check
node scripts/check-no-confidential.mjs --selftest
node scripts/check-no-confidential.mjs --all
npm test
```
