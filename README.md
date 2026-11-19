English | [简体中文](README.zh-CN.md)

# LMTAgent (`v1.0.0` · `dsh-lmtagent`)

Multi-agent software engineering orchestrator and docked workbench plugin for DeepSeek Harness (DSH Desktop).

Built around a **4-Wave Bounded DAG engineering pipeline** (`Wish Clarification -> File-Disjoint Sharding -> Concurrent Master-Worker Dispatch -> Digest Compression -> Approval & Wave Advance`), LMTAgent turns ambiguous feature wishes into structured specifications, enforces file-level write isolation across parallel subagents, guards workspace token/cost budgets, and keeps host telemetry and storage completely isolated in an independent namespace (`dsh-lmtagent`) that coexists cleanly with `dsh-redteam-mode`.

---

## UI Preview (`v1.0.0`)

Captured directly in headless Chromium from the compiled `packages/redteam-ui/lib/client.js` and `styles.js` bundles in `en-US` locale:

| Overview & Expandable Context Drawer (`Overview`) | Cluster Scheduling & Topology Tree (`Cluster -> Agents & Slots`) |
| :---: | :---: |
| ![Overview & Expandable Context Drawer](docs/assets/ui-overview-workbench-en.png) | ![Cluster Scheduling & Topology Tree](docs/assets/ui-agents-dag-en.png) |
| **Collaboration, Quick Demos & Scope Rollback (`Collab & Approval`)** | **Unified Settings & Dispatch Policy (`Settings`)** |
| ![Collaboration, Quick Demos & Scope Rollback](docs/assets/ui-assets-pg-en.png) | ![Unified Settings & Dispatch Policy](docs/assets/ui-report-v2-en.png) |

---

## 1. What Is New in `v1.0.0`

1. **Independent Coexistence Namespace (`dsh-lmtagent`) & Safe Migration**
   - Uses clean Cordis service and route identifiers (`lmtagent-mode`, `ctx.lmtagent`, `lmtagent-tools`, `lmtagent-ui`, `dsh-lmtagent-ui`, `POST /lmtagent/api`, `GET /lmtagent/events`, `preset-lmtagent*`, and `$DSH_HOME/lmtagent`) so installing LMTAgent alongside `dsh-redteam-mode` produces zero plugin, slot, route, or storage collisions.
   - Automatically performs a non-destructive first-run copy migration (`migrateLegacyRedteamDir`) if legacy data exists in `$DSH_HOME/redteam` and `$DSH_HOME/lmtagent` does not yet exist.
2. **Clean 12-Skill Engineering Pack & 12-Tool Catalog (`11,645` Bytes Schema)**
   - Ships strictly **12 engineering & workflow skills** (`eng-wish-spec`, `eng-ui-design-tokens`, `eng-api-contract-sharding`, `eng-fullstack-builder`, `eng-code-review-security`, `eng-test-verification-gate`, `eng-release-changelog`, `eng-git-recovery`, `campaign-planning`, `browser-automation`, `opsec-hygiene`, `supply-chain`) while excluding legacy pentest handbooks from the default distribution via `OMITTED_SKILLS` in `packages/redteam-bundle/tools/distribution.mjs`.
   - Consolidates legacy tools down to **12 lean `lmt_*` tools** (`lmt_workflow`, `lmt_agent_slot`, `lmt_engagement_open`, `lmt_session_bind`, `lmt_session_info`, `lmt_sessions`, `lmt_preflight`, `lmt_role_prompt`, `lmt_roles`, `lmt_artifact_record`, `lmt_artifact_query`, `lmt_report_export`), serializing to **`11,645` bytes** (`58%` smaller than the `28,000`-byte baseline) with explicit `additionalProperties: false` across all 26 object schema nodes.
3. **High-Performance Modular Core (`core.js` + `ui/lib/index.js`)**
   - Split store monolith (`packages/redteam-store/lib/core.js` reduced to `6,415` lines) into focused modules (`shard-policy.js`, `session-bindings.js`, `dag-workflow.js`, `settings.js`, `pg-engine.js`, `prompts.js`) with write-versioned read memoization (`_bumpWriteSeq`, SQLite `total_changes()`, `workflow-dag.json` `mtimeMs` checks).
   - Split UI host bridge (`packages/redteam-ui/lib/index.js` reduced from `7,504` to `3,538` lines) into `scope-rollback.js`, `dag-scheduler.js`, `settings-bridge.js`, `update-manager.js`, `telemetry-jsonl.js`, `dsh-dispatch.js`, and `llm-planner.js`.
4. **Pre/Post-Write `ShardLock` + Safe Git Scope Rollback**
   - `checkFileAgainstShardLocks` checks target paths before writes (`lmt_workflow({ action: "check_scope" })`), while post-write `auditWorkerScopeViolation` flags out-of-shard edits in the Approval Queue.
   - `rollbackScopeViolations` (`packages/redteam-ui/lib/scope-rollback.js`) uses `execFileSync('git', ...)` without shell interpolation, rejects path traversal and symlink escapes outside the repository root, and offers one-click rollback right inside the Collab Approval card.
5. **Budget Circuit Breaker, Auto-Retry & Experimental Speculative DAG Pipelining**
   - **Budget Circuit Breaker** (`evaluateWorkspaceBudgetGuard`): enforces `maxTokensPerWorkspace` and `maxCostPerWorkspace` caps with live Overview alerts and automatic pause on dispatch (overrideable explicitly per action).
   - **Exponential Backoff Auto-Retry** (`maxAutoRetries` `0-3`): automatically retries transient worker failures and injects prior failure context into the replacement worker prompt.
   - **Experimental Speculative DAG Pipelining** (`speculativeWaveDispatch` + `depends_on` + `detectDagCycles`): dispatches unblocked downstream workers whose `depends_on` dependencies and shard locks clear early without waiting for an entire wave barrier.
6. **Full Bilingual Web Console & 1-Minute Quick Demos**
   - Reactive `00b-i18n.js` localization (`lmt_ui_locale`, `zh-CN` / `en-US`, top-bar `ZH / EN` language toggle + Settings selector) with zero mixed-language leakage across tabs.
   - Added 1-Minute Demo Preset Chips (`OrderFlow-Demo` and `CliRefactor-Demo`) in `WishRefinerWizard` plus live `perfMetrics` drawers (`digestCompressionRatioPct`, `parallelismEfficiencyPct`, `schemaTokenSavedEstimate`, `scopeCompliancePct`).

---

## 2. 4-Wave Closed-Loop Engineering Pipeline

```text
[User Requirement / 1-Min Demo Preset]
      │
      ▼  Step 1: AI Clarification & File-Disjoint Sharding (clarifyWishWithAI / decomposeWishWithAI)
[Structured refined_prompt + 4-Wave non-overlapping files_owned shards + depends_on DAG]
      │
      ▼  Step 2: Budget Guard & Master-Worker Dispatch (evaluateWorkspaceBudgetGuard + ShardLock + startActivation)
[Wave 1..4 Concurrent Subagents (wave-barrier or experimental speculativeWaveDispatch)]
      │
      ▼  Step 3: Digest Compression & Scope Audit (submit_digest + auditWorkerScopeViolation)
[Compact what_was_done / files_touched / verification -> worker_digests + scope_ok / rollback option]
      │
      ▼  Step 4: Approval, Auto-Advance & Delivery Report (planApproveWorker / lmt_report_export)
[Human or Captain Approval -> Advance Downstream Ready Shards -> Reproducible Delivery Report]
```

---

## 3. 8 Role Presets (`maxDepth: 3`, default `thinking: low`)

| # | Role ID | Preset Name | Core Responsibility & Output Contract |
| :---: | :--- | :--- | :--- |
| 0 | `plan` | `lmtagent` (`LMTAgent Cluster`) | Master Orchestrator: decomposes wishes, schedules 4-Wave DAGs, approves digests |
| 1 | `recon` | `lmtagent-worker-recon` | CEO / Product & Discovery: maps repo modules, API contracts, and P0/P1 priorities |
| 2 | `designer` | `lmtagent-worker-designer` | Designer / UX & Visual: defines design tokens, component hierarchy, and UI states |
| 3 | `assess` | `lmtagent-worker-assess` | Eng Manager / Architecture: freezes schemas and allocates file-disjoint `shard_locks` |
| 4 | `vuln-scan` | `lmtagent-worker-vuln-scan` | Reviewer & CSO / Security: audits defects, concurrency safety, and security gates |
| 5 | `exploit` | `lmtagent-worker-exploit` | Builder / Full-Stack Dev: implements shards inside `files_owned` and submits digests |
| 6 | `qa` | `lmtagent-worker-qa` | QA Lead / Quality & Tests: runs full build, confidential, and regression suites |
| 7 | `internal` | `lmtagent-worker-internal` | Doc & Release / Delivery: updates docs, generates changelogs, and exports reports |

---

## 4. Host Slots, Storage & Real-Time Event Stream

- **6 Clean `lmtagent-*` Host Slots**: `lmtagent-console` (`shell.overlay`), `lmtagent-workbench` (`main`), `lmtagent-panellist` (`sidebar.panellist`), `lmtagent-view` (`conversation.view`), `lmtagent-header-toggle` (`conversation.session.header.utilities`), and `lmtagent-settings` (`settings.section`).
- **Incremental Telemetry & SSE**: Byte-offset `.jsonl` tailing (`packages/redteam-ui/lib/telemetry-jsonl.js`) plus `GET /lmtagent/events` SSE streaming and `POST /lmtagent/api` RPC bridge.
- **Dual-Mode Storage**: Connects to external PostgreSQL (Wire Protocol v3) when `LMTAGENT_PG_URL`, `REDTEAM_PG_URL`, `DSH_PG_URL`, `DATABASE_URL`, or `PGHOST` is set; otherwise runs local SQLite in WAL mode under `$DSH_HOME/lmtagent` with zero external runtime dependencies.

---

## 5. Installation

### CLI

```bash
dsh plugin add github:ECCVIK/LMTAgent
```

### DSH Desktop Plugin Market

Search for `dsh-lmtagent` / `LMTAgent` in the DSH Desktop Plugin Market or import `github:ECCVIK/LMTAgent` directly (`pre-built dsh-lmtagent-<version>.tgz` tarballs are published on GitHub Releases).

---

## 6. Build, Gates & Tests

```bash
# Assemble styles/client bundles and sync to packages/redteam-bundle & repo root
npm run build
node packages/redteam-bundle/tools/build.mjs --check
node packages/redteam-ui/tools/assemble-client.mjs --check
node packages/redteam-ui/tools/assemble-styles.mjs --check

# Confidential gate self-test & full repository scan (0 hits)
node scripts/check-no-confidential.mjs --selftest
node scripts/check-no-confidential.mjs --all

# Run all 22 zero-dependency test suites (22 files / 1,289 assertions passing)
npm test
```
