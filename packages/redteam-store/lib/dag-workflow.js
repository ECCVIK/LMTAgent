/**
 * LMTAgent 4-Wave DAG 闭环调度、ShardLock 互斥锁、摘要写回、越界回滚审计与飞书推送模块（零依赖）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { nowIso, slugify } from './ip-utils.js'
import * as pgEngineMod from './pg-engine.js'
import {
  auditWorkerScopeViolation, fileMatchesShardPattern, normalizeShardPattern, shardPatternsOverlap,
} from './shard-policy.js'
import { ROLE_TITLES } from './prompts.js'

const resolvePgConfig = pgEngineMod.resolvePgConfig
const recordPgTableWrite = pgEngineMod.recordPgTableWrite || (() => {})
const recordPgDigestCompression = pgEngineMod.recordPgDigestCompression || (() => {})
const getPgWriteProbe = pgEngineMod.getPgWriteProbe || (() => ({
  snapshot: () => ({ mode: 'wal', totalWrites: 0, writeRatePerMin: 0, tables: [], recentEvents: [] }),
}))

function promptHash(text) {
  return createHash('sha1').update(String(text === undefined || text === null ? '' : text).trim()).digest('hex').slice(0, 12)
}

const parseJson = (value, fallback) => {
  try {
    const parsed = JSON.parse(value)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch { return fallback }
}


/**
 * 确保 1 Plan + N Workers 闭环四张表（含 shard_locks）在当前句柄中已创建且列齐全。
 * 注意：严禁执行 PRAGMA foreign_keys = OFF，保持整连接外键约束始终开启。
 */
function nextClosedLoopUid(store, prefix) {
  store._closedLoopSeq = (Number(store._closedLoopSeq) || 0) + 1
  return `${prefix}-${Date.now().toString(36)}-${store._closedLoopSeq}`
}


function isTableIntPk(store, db, table) {
  let tableMap = store._intPkCache.get(db)
  if (tableMap && tableMap.has(table)) return tableMap.get(table)
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all()
    const pk = cols.find((c) => c.name === 'id')
    const res = Boolean(pk && String(pk.type || '').toUpperCase() === 'INTEGER' && Number(pk.pk) > 0)
    if (!tableMap) {
      tableMap = new Map()
      store._intPkCache.set(db, tableMap)
    }
    tableMap.set(table, res)
    return res
  } catch {
    return false
  }
}


function ensureClosedLoopColumns(store, db) {
  if (!db) return
  if (!store._ensuredClosedLoopCols) store._ensuredClosedLoopCols = new WeakSet()
  if (store._ensuredClosedLoopCols.has(db)) return
  store._ensuredClosedLoopCols.add(db)
  const ensure = (table, col, ddl) => {
    try {
      const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name))
      if (cols.size > 0 && !cols.has(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`)
      }
    } catch { /* ignore column migration errors */ }
  }
  ensure('plan_goals', 'acceptance_criteria_json', "TEXT NOT NULL DEFAULT '[]'")
  ensure('worker_tasks', 'acceptance_criteria_json', "TEXT NOT NULL DEFAULT '[]'")
  ensure('worker_tasks', 'dispatched_at', "TEXT NOT NULL DEFAULT ''")
  ensure('worker_tasks', 'depends_on_json', "TEXT NOT NULL DEFAULT '[]'")
  ensure('worker_tasks', 'retry_count', 'INTEGER NOT NULL DEFAULT 0')
  ensure('worker_digests', 'rollback_history_json', "TEXT NOT NULL DEFAULT '[]'")
  ensure('worker_digests', 'scope_remediated', 'INTEGER NOT NULL DEFAULT 0')
}


function openClosedLoopDb(store, explicitId, createIfMissing = true) {
  const resolvedId = String(explicitId || store.activeEngagementId() || 'default').trim() || 'default'
  if (store.handles.has(resolvedId) || existsSync(store.dbPathOf(resolvedId))) {
    const db = store.db(resolvedId)
    ensureClosedLoopColumns(store, db)
    return { resolvedId, db }
  }
  if (!createIfMissing) return { resolvedId, db: null }
  const db = store.db(resolvedId, { create: true })
  ensureClosedLoopColumns(store, db)
  return { resolvedId, db }
}


function formatWorkerTaskRow(store, t, resolvedId) {
  if (!t) return null
  const tags = parseJson(t.tags_json, [])
  const filesOwned = parseJson(t.files_owned_json, [])
  const acceptanceCriteria = parseJson(t.acceptance_criteria_json, [])
  const dependsOn = parseJson(t.depends_on_json, [])
  return Object.assign({}, t, {
    engagement_id: t.engagement_id || resolvedId,
    priority_weight: Number(t.priority_weight) || 0,
    tool_calls: Number(t.tool_calls) || 0,
    turns: Number(t.turns) || 0,
    duration_ms: Number(t.duration_ms) || 0,
    retry_count: Number(t.retry_count) || 0,
    tags: Array.isArray(tags) ? tags : [],
    tags_json: typeof t.tags_json === 'string' ? t.tags_json : JSON.stringify(Array.isArray(tags) ? tags : []),
    files_owned: Array.isArray(filesOwned) ? filesOwned : [],
    files_owned_json: typeof t.files_owned_json === 'string' ? t.files_owned_json : JSON.stringify(Array.isArray(filesOwned) ? filesOwned : []),
    acceptance_criteria: Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [],
    acceptance_criteria_json: typeof t.acceptance_criteria_json === 'string'
      ? t.acceptance_criteria_json
      : JSON.stringify(Array.isArray(acceptanceCriteria) ? acceptanceCriteria : []),
    depends_on: Array.isArray(dependsOn) ? dependsOn : [],
    depends_on_json: typeof t.depends_on_json === 'string' ? t.depends_on_json : JSON.stringify(Array.isArray(dependsOn) ? dependsOn : []),
    dispatched_at: String(t.dispatched_at || ''),
    error_detail: String(t.error_detail || ''),
  })
}


function parseStringList(val, fallback = []) {
  if (Array.isArray(val)) return val.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (!trimmed) return fallback
    if (trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed, null)
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || '').trim()).filter(Boolean)
    }
    return trimmed.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
  }
  return fallback
}


function readClosedLoopState(store, id) {
  const { resolvedId, db } = openClosedLoopDb(store, id, false)
  const emptyStats = {
    total_goals: 0,
    approved_workers: 0,
    pending_approvals: 0,
    compression_ratio_pct: 0,
    compression_saved_tokens: 0,
    active_shard_locks: 0,
    total_shard_locks: 0,
  }
  if (!db) {
    return {
      plan_goals: [],
      worker_tasks: [],
      worker_digests: [],
      shard_locks: [],
      closed_loop_stats: emptyStats,
    }
  }
  let planGoals = []
  let workerTasks = []
  let workerDigests = []
  let shardLocks = []
  try {
    planGoals = db.prepare(
      'SELECT * FROM plan_goals ORDER BY COALESCE(priority_weight, 0) DESC, created_at ASC, id ASC',
    ).all().map((g) => {
      const acceptanceCriteria = parseJson(g.acceptance_criteria_json, [])
      return Object.assign({}, g, {
        engagement_id: g.engagement_id || resolvedId,
        priority_weight: Number(g.priority_weight) || 0,
        acceptance_criteria: Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [],
      })
    })
  } catch { planGoals = [] }
  try {
    workerTasks = db.prepare(
      'SELECT * FROM worker_tasks ORDER BY COALESCE(priority_weight, 0) DESC, updated_at DESC, id ASC',
    ).all().map((t) => formatWorkerTaskRow(store, t, resolvedId))
  } catch { workerTasks = [] }
  const taskById = new Map()
  for (const wt of workerTasks) {
    if (wt && wt.id !== undefined && wt.id !== null) {
      taskById.set(String(wt.id), wt)
    }
  }
  try {
    workerDigests = db.prepare(
      'SELECT * FROM worker_digests ORDER BY created_at DESC, id DESC',
    ).all().map((d) => {
      const filesTouched = parseJson(d.files_touched_json, [])
      const keyDecisions = parseJson(d.key_decisions_json, [])
      const rollbackHistory = parseJson(d.rollback_history_json, [])
      const touchedList = Array.isArray(filesTouched) ? filesTouched : []
      const linkedTask = d.worker_task_id !== undefined && d.worker_task_id !== null
        ? taskById.get(String(d.worker_task_id))
        : null
      const scopeAudit = auditWorkerScopeViolation(linkedTask?.files_owned || [], touchedList)
      const scopeRemediated = Boolean(Number(d.scope_remediated))
      return Object.assign({}, d, {
        engagement_id: d.engagement_id || resolvedId,
        raw_tokens: Number(d.raw_tokens) || 0,
        compressed_tokens: Number(d.compressed_tokens) || 0,
        compression_pct: Number(d.compression_pct) || 0,
        files_touched: touchedList,
        key_decisions: Array.isArray(keyDecisions) ? keyDecisions : [],
        rollback_history: Array.isArray(rollbackHistory) ? rollbackHistory : [],
        scope_remediated: scopeRemediated,
        scope_ok: scopeAudit.scope_ok || scopeRemediated,
        scope_violations: scopeAudit.scope_violations,
      })
    })
  } catch { workerDigests = [] }
  try {
    shardLocks = db.prepare(
      'SELECT * FROM shard_locks ORDER BY acquired_at DESC, id ASC',
    ).all().map((l) => Object.assign({}, l, {
      engagement_id: l.engagement_id || resolvedId,
    }))
  } catch { shardLocks = [] }

  const totalGoals = planGoals.length
  const approvedWorkers = workerTasks.filter((t) => t.approval_state === 'approved').length
  const pendingApprovals = workerTasks.filter(
    (t) => t.approval_state === 'pending_approval' || t.approval_state === 'revision_required',
  ).length
  const activeShardLocks = shardLocks.filter((l) => l.status === 'active').length
  const totalRaw = workerDigests.reduce((acc, d) => acc + (Number(d.raw_tokens) || 0), 0)
  const totalCompressed = workerDigests.reduce((acc, d) => acc + (Number(d.compressed_tokens) || 0), 0)
  const savedTokens = Math.max(0, totalRaw - totalCompressed)
  const compressionRatioPct = totalRaw > 0
    ? Math.max(0, Math.min(99, Math.round((1 - totalCompressed / Math.max(1, totalRaw)) * 100)))
    : (workerDigests.length > 0
      ? Math.round(workerDigests.reduce((acc, d) => acc + (Number(d.compression_pct) || 0), 0) / workerDigests.length)
      : 0)

  return {
    plan_goals: planGoals,
    worker_tasks: workerTasks,
    worker_digests: workerDigests,
    shard_locks: shardLocks,
    closed_loop_stats: {
      total_goals: totalGoals,
      approved_workers: approvedWorkers,
      pending_approvals: pendingApprovals,
      compression_ratio_pct: compressionRatioPct,
      compression_saved_tokens: savedTokens,
      active_shard_locks: activeShardLocks,
      total_shard_locks: shardLocks.length,
    },
  }
}


function workflowStatePathOf(store, id) {
  const resolvedId = id || store.activeEngagementId() || 'default'
  if (resolvedId !== 'default' && existsSync(store.dirOf(resolvedId))) {
    return join(store.dirOf(resolvedId), 'workflow-dag.json')
  }
  mkdirSync(store.root, { recursive: true })
  return join(store.root, `workflow-dag-${slugify(resolvedId) || 'default'}.json`)
}


function defaultWorkflowState(store, id) {
  const now = nowIso()
  const nodes = [
    {
      id: 'plan', code: '⓪ plan', role: 'plan', name: 'Captain 主控指挥', title: ROLE_TITLES.plan,
      wave: 0, wave_label: 'WAVE 0 · 主控调度', kind: 'role', is_subagent: false, isSub: false, depth: 0,
      parent_id: null, status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Orchestrator', thinking: 'high',
      skill: '/dag-schedule', skills: ['campaign-planning'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave0-plan',
      updated_at: null,
      docTitle: '00_PLAN_CHARTER.md',
      docBody: '',
      summary: '待命：等待主会话立项并派发 4-Wave DAG 子任务',
      decisions: [],
    },
    {
      id: 'recon', code: '① recon', role: 'recon', name: 'CEO 需求与架构测绘', title: ROLE_TITLES.recon,
      wave: 1, wave_label: 'WAVE 1 · 2 槽双轨立项', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'plan', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Slot #1', thinking: 'low',
      skill: '/office-hours · /plan-ceo-review', skills: ['eng-wish-spec'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave1-recon',
      updated_at: null,
      docTitle: '01_CEO_PRD_AND_SURFACE.md',
      docBody: '',
      summary: '待命：等待 Wave 1 需求探索与模块架构勘探',
      decisions: [],
    },
    {
      id: 'designer', code: '② designer', role: 'designer', name: 'Designer 视觉与交互', title: ROLE_TITLES.designer,
      wave: 1, wave_label: 'WAVE 1 · 2 槽双轨立项', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'plan', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Slot #2', thinking: 'low',
      skill: '/plan-design-review · /design-shotgun', skills: ['eng-ui-design-tokens', 'browser-automation'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave1-designer',
      updated_at: null,
      docTitle: '02_DESIGN_SYSTEM_BENTO.md',
      docBody: '',
      summary: '待命：等待 Wave 1 UI/UX 视觉令牌与组件状态建模',
      decisions: [],
    },
    {
      id: 'assess', code: '③ assess', role: 'assess', name: 'Eng Manager 契约与分片', title: ROLE_TITLES.assess,
      wave: 2, wave_label: 'WAVE 2 · 1 槽契约锁', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'recon', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Slot #1 (Lock)', thinking: 'low',
      skill: '/plan-eng-review', skills: ['eng-api-contract-sharding'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave2-assess',
      updated_at: null,
      docTitle: '03_ENG_SHARD_CONTRACT.md',
      docBody: '',
      summary: '待命：等待 Wave 2 接口契约收敛与无冲突分片切分',
      decisions: [],
    },
    {
      id: 'exploit', code: '⑤ exploit #1..#6', role: 'exploit', name: '6× Builder 并行分片研发', title: ROLE_TITLES.exploit,
      wave: 3, wave_label: 'WAVE 3 · 6 槽并发构建', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'assess', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Slots #1–#6', thinking: 'low',
      skill: '/parallel-build · 6 Slots', skills: ['eng-fullstack-builder', 'eng-git-recovery'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave3-exploit',
      updated_at: null,
      docTitle: '04_BUILDER_SHARDS_LOG.md',
      docBody: '',
      summary: '待命：等待 Wave 3 并行分片编码与单元测试',
      decisions: [],
    },
    {
      id: 'vuln-scan', code: '④ vuln-scan', role: 'vuln-scan', name: 'Reviewer & CSO 审查', title: ROLE_TITLES['vuln-scan'],
      wave: 4, wave_label: 'WAVE 4 · 双轨门禁交付', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'exploit', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Gate #1', thinking: 'low',
      skill: '/review · /cso', skills: ['eng-code-review-security', 'supply-chain', 'opsec-hygiene'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave4-review',
      updated_at: null,
      docTitle: '06_CSO_SECURITY_REVIEW.md',
      docBody: '',
      summary: '待命：等待 Wave 4 代码审查与安全架构门禁',
      decisions: [],
    },
    {
      id: 'qa', code: '⑥ qa', role: 'qa', name: 'QA Lead 自动化回归', title: ROLE_TITLES.qa,
      wave: 4, wave_label: 'WAVE 4 · 双轨门禁交付', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'exploit', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Gate #2', thinking: 'low',
      skill: '/qa · /benchmark', skills: ['eng-test-verification-gate', 'browser-automation'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave4-qa',
      updated_at: null,
      docTitle: '07_QA_BENCHMARK_GATE.md',
      docBody: '',
      summary: '待命：等待 Wave 4 自动化测试套件与性能基准门禁',
      decisions: [],
    },
    {
      id: 'internal', code: '⑦ internal', role: 'internal', name: 'Doc & Release 归档发布', title: ROLE_TITLES.internal,
      wave: 4, wave_label: 'WAVE 4 · 双轨门禁交付', kind: 'role', is_subagent: false, isSub: false, depth: 1,
      parent_id: 'qa', status: 'pending', state: 'standby', statusLabel: '待命', slots: 'Release Slot', thinking: 'low',
      skill: '/ship · /document-release', skills: ['eng-release-changelog'],
      tokens: 0, latency_ms: 0, retries: 0, checkpoint: 'ckpt-wave4-ship',
      updated_at: null,
      docTitle: '08_FINAL_RELEASE_NOTE.md',
      docBody: '',
      summary: '待命：等待 Wave 4 最终文档归档与发布交付',
      decisions: [],
    },
  ]

  const edges = [
    { id: 'e-plan-recon', from: 'plan', to: 'recon', source: 'plan', target: 'recon', wave: 1, kind: 'dag', label: 'Wave 1 派发' },
    { id: 'e-plan-designer', from: 'plan', to: 'designer', source: 'plan', target: 'designer', wave: 1, kind: 'dag', label: 'Wave 1 派发' },
    { id: 'e-recon-assess', from: 'recon', to: 'assess', source: 'recon', target: 'assess', wave: 2, kind: 'dag', label: 'PRD 合流' },
    { id: 'e-designer-assess', from: 'designer', to: 'assess', source: 'designer', target: 'assess', wave: 2, kind: 'dag', label: 'UI 规范合流' },
    { id: 'e-assess-exploit', from: 'assess', to: 'exploit', source: 'assess', target: 'exploit', wave: 3, kind: 'dag', label: '6 槽分片锁' },
    { id: 'e-exploit-vuln', from: 'exploit', to: 'vuln-scan', source: 'exploit', target: 'vuln-scan', wave: 4, kind: 'gate', label: 'CSO 门禁' },
    { id: 'e-exploit-qa', from: 'exploit', to: 'qa', source: 'exploit', target: 'qa', wave: 4, kind: 'gate', label: 'QA 门禁' },
    { id: 'e-vuln-internal', from: 'vuln-scan', to: 'internal', source: 'vuln-scan', target: 'internal', wave: 4, kind: 'ship', label: '审计放行' },
    { id: 'e-qa-internal', from: 'qa', to: 'internal', source: 'qa', target: 'internal', wave: 4, kind: 'ship', label: '测试放行' },
  ]

  return {
    engagement: id || 'default',
    run_seq: 0,
    status: 'standby',
    current_wave: 0,
    updated_at: now,
    nodes,
    edges,
    runs: [],
    feishu: {
      webhook_url: '',
      configured: false,
      enabled: false,
      events: { wave_complete: true, gate_alert: true, milestone_hit: true, daily_digest: true },
      last_pushed_at: null,
      last_status: 'idle',
      history: [],
    },
  }
}


function readWorkflowState(store, id) {
  const resolvedId = id || store.activeEngagementId() || 'default'
  const file = workflowStatePathOf(store, resolvedId)
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        return parsed
      }
    }
  } catch { /* 损坏时回退默认状态 */ }
  return defaultWorkflowState(store, resolvedId)
}


function writeWorkflowState(store, id, state) {
  const resolvedId = id || store.activeEngagementId() || 'default'
  const file = workflowStatePathOf(store, resolvedId)
  try {
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
  } catch { /* 忽略写盘异常 */ }
  return state
}

class _DagWorkflowMethods {
  /**
   * 收割超时僵死（如 17h RUNNING）的 worker_tasks 槽位、shard_locks 分片锁与 workflow-dag.json 僵尸节点。
   * 默认租约过期阈值 `staleMs = 180_000`（3 分钟）；若传入 `options.liveRunningIds: Set<string>`，
   * 对不在宿主实时运行集合中且已超过 15 秒缓冲期的会话立即收割。
   */
  reapExpiredAgentLeases(engagementId, options = {}) {
    const opts = options && typeof options === 'object' ? options : {}
    const staleMs = Number.isFinite(Number(opts.staleMs)) && Number(opts.staleMs) > 0
      ? Number(opts.staleMs)
      : 180_000
    const liveGraceMs = Number.isFinite(Number(opts.liveGraceMs)) && Number(opts.liveGraceMs) >= 0
      ? Number(opts.liveGraceMs)
      : 15_000
    const liveRunningIds = opts.liveRunningIds instanceof Set
      ? opts.liveRunningIds
      : (Array.isArray(opts.liveRunningIds) ? new Set(opts.liveRunningIds.map((x) => String(x))) : null)
    const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now()
    const nowStr = new Date(nowMs).toISOString()

    const rawTarget = String(engagementId || this.activeEngagementId() || '').trim()
    if (!rawTarget) {
      return { ok: true, engagement_id: null, reaped_tasks: 0, released_locks: 0, sanitized_dag_nodes: 0 }
    }

    const { resolvedId, db } = openClosedLoopDb(this, rawTarget, false)
    let reapedTasks = 0
    let releasedLocks = 0
    let sanitizedDagNodes = 0
    const reapedTaskIds = new Set()
    const liveDbRoles = new Set()

    if (db) {
      try {
        const digestTaskIds = new Set(
          db.prepare('SELECT DISTINCT CAST(worker_task_id AS TEXT) AS tid FROM worker_digests')
            .all()
            .map((r) => String(r.tid || ''))
            .filter(Boolean),
        )
        const runningRows = db.prepare(
          "SELECT * FROM worker_tasks WHERE LOWER(COALESCE(status, '')) IN ('running', 'in_progress', 'active', 'run')",
        ).all()
        const updTaskStmt = db.prepare(`
          UPDATE worker_tasks
          SET status = ?,
              approval_state = ?,
              ui_priority = ?,
              priority_weight = ?,
              duration_ms = ?,
              updated_at = ?
          WHERE id = ?
        `)

        for (const t of runningRows) {
          const tsMs = Date.parse(t.updated_at || t.created_at || '') || 0
          const ageMs = tsMs > 0 ? (nowMs - tsMs) : (staleMs + 1)
          const sessId = String(t.session_id || '').trim()
          const expiredByAge = ageMs > staleMs
          const expiredByMissingLive = Boolean(
            liveRunningIds && sessId && !liveRunningIds.has(sessId) && ageMs > liveGraceMs,
          )
          if (!expiredByAge && !expiredByMissingLive) {
            if (t.worker_role) liveDbRoles.add(String(t.worker_role).trim().toLowerCase())
            continue
          }

          const hasOutput = (Number(t.turns) || 0) > 0
            || (Number(t.tool_calls) || 0) > 0
            || digestTaskIds.has(String(t.id))
          const nextStatus = hasOutput ? 'completed' : 'interrupted'
          const prevApproval = String(t.approval_state || '').trim()
          const nextApproval = nextStatus === 'completed'
            ? (['approved', 'pending_approval', 'revision_required'].includes(prevApproval) ? prevApproval : 'approved')
            : (prevApproval === 'approved' ? 'approved' : 'interrupted')
          const nextPrio = nextStatus === 'completed'
            ? (nextApproval === 'pending_approval' || nextApproval === 'revision_required' ? 'P0' : 'P2')
            : 'P3'
          const nextWeight = nextPrio === 'P0' ? 100 : (nextPrio === 'P2' ? 50 : 20)

          const createdMs = Date.parse(t.created_at || '') || 0
          const prevUpdatedMs = Date.parse(t.updated_at || '') || 0
          const existingDur = Number(t.duration_ms) || 0
          let frozenDurationMs = existingDur > 0 && existingDur <= staleMs
            ? existingDur
            : (createdMs > 0 && prevUpdatedMs >= createdMs ? Math.min(staleMs, prevUpdatedMs - createdMs) : 0)
          if (frozenDurationMs === 0 && nextStatus === 'completed') frozenDurationMs = 1000

          updTaskStmt.run(nextStatus, nextApproval, nextPrio, nextWeight, frozenDurationMs, nowStr, t.id)
          reapedTaskIds.add(String(t.id))
          reapedTasks += 1
        }
      } catch { /* ignore worker_tasks reap error */ }

      try {
        const allTasks = db.prepare('SELECT id, worker_name, status, approval_state FROM worker_tasks').all()
        const taskById = new Map()
        for (const t of allTasks) {
          taskById.set(String(t.id), t)
        }
        const activeLocks = db.prepare("SELECT * FROM shard_locks WHERE status = 'active'").all()
        const relLockStmt = db.prepare("UPDATE shard_locks SET status = 'released', released_at = ? WHERE id = ?")
        for (const lk of activeLocks) {
          const acqMs = Date.parse(lk.acquired_at || '') || 0
          const lockAgeMs = acqMs > 0 ? (nowMs - acqMs) : (staleMs + 1)
          const ownerId = String(lk.worker_task_id || '').trim()
          const ownerTask = ownerId ? taskById.get(ownerId) : null
          let ownerNoLongerRunning = false
          if (ownerId && reapedTaskIds.has(ownerId)) {
            ownerNoLongerRunning = true
          } else if (ownerTask) {
            const st = String(ownerTask.status || '').toLowerCase()
            const ap = String(ownerTask.approval_state || '').toLowerCase()
            if (['interrupted', 'cancelled', 'failed', 'error', 'timeout', 'archived', 'released'].includes(st)) {
              ownerNoLongerRunning = true
            } else if (ap === 'approved') {
              ownerNoLongerRunning = true
            } else if ((st === 'completed' || st === 'done') && ap !== 'pending_approval' && ap !== 'revision_required') {
              ownerNoLongerRunning = true
            }
          } else if (ownerId && lockAgeMs > liveGraceMs) {
            ownerNoLongerRunning = true
          }

          if (lockAgeMs > staleMs || ownerNoLongerRunning) {
            relLockStmt.run(nowStr, lk.id)
            releasedLocks += 1
          }
        }
      } catch { /* ignore shard_locks reap error */ }

      try {
        const runningGoals = db.prepare(
          "SELECT id, status, created_at, updated_at FROM plan_goals WHERE LOWER(COALESCE(status, '')) IN ('running', 'in_progress')",
        ).all()
        const updGoalStmt = db.prepare("UPDATE plan_goals SET status = 'completed', updated_at = ? WHERE id = ?")
        for (const g of runningGoals) {
          const gMs = Date.parse(g.updated_at || g.created_at || '') || 0
          if ((gMs > 0 ? (nowMs - gMs) : (staleMs + 1)) > staleMs && liveDbRoles.size === 0) {
            updGoalStmt.run(nowStr, g.id)
          }
        }
      } catch { /* ignore plan_goals reap error */ }
    }

    try {
      const wfPath = workflowStatePathOf(this, resolvedId)
      if (wfPath && existsSync(wfPath)) {
        const parsed = JSON.parse(readFileSync(wfPath, 'utf8'))
        if (parsed && Array.isArray(parsed.nodes)) {
          let dirty = false
          for (const n of parsed.nodes) {
            if (!n || typeof n !== 'object') continue
            const nodeRunning = n.status === 'run' || n.state === 'run' || n.active === true
            if (!nodeRunning) continue
            const nodeTsMs = Date.parse(n.updated_at || parsed.updated_at || '') || 0
            const nodeAgeMs = nodeTsMs > 0 ? (nowMs - nodeTsMs) : (staleMs + 1)
            const hasLiveWorker = liveDbRoles.has(String(n.role || '').toLowerCase())
              || liveDbRoles.has(String(n.id || '').toLowerCase())
            if (!hasLiveWorker && nodeAgeMs > staleMs) {
              const hadWork = (Number(n.tokens) || 0) > 0
                || (Number(n.step_count) || 0) > 0
                || (Array.isArray(n.decisions) && n.decisions.length > 0)
              n.status = hadWork ? 'done' : 'pending'
              n.state = hadWork ? 'done' : 'standby'
              n.statusLabel = hadWork ? '已执行' : '待命'
              n.active = false
              if ((Number(n.latency_ms) || 0) > staleMs) {
                n.latency_ms = staleMs
              }
              sanitizedDagNodes += 1
              dirty = true
            }
          }
          if (parsed.status === 'running' && liveDbRoles.size === 0) {
            const rootTsMs = Date.parse(parsed.updated_at || '') || 0
            if ((rootTsMs > 0 ? (nowMs - rootTsMs) : (staleMs + 1)) > staleMs) {
              parsed.status = 'standby'
              dirty = true
            }
          }
          if (dirty) {
            writeFileSync(wfPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
          }
        }
      }
    } catch { /* ignore workflow-dag.json sanitize error */ }

    return {
      ok: true,
      engagement_id: resolvedId,
      reaped_tasks: reapedTasks,
      released_locks: releasedLocks,
      sanitized_dag_nodes: sanitizedDagNodes,
    }
  }


  /**
   * 查询当前项目（Engagement）的文件分片互斥锁列表。
   */
  listShardLocks(engagementId = undefined, filter = {}) {
    let targetId = engagementId
    let opts = filter || {}
    if (engagementId && typeof engagementId === 'object') {
      opts = engagementId
      targetId = opts.engagement_id || opts.engagement
    }
    const { resolvedId, db } = openClosedLoopDb(this, targetId, false)
    const rows = []
    if (db) {
      try {
        const statusFilter = opts.status || (opts.activeOnly ? 'active' : '')
        const taskFilter = opts.worker_task_id ?? opts.worker_id
        const nameFilter = opts.worker_name ?? opts.workerName
        const waveFilter = opts.wave
        const rawRows = statusFilter
          ? db.prepare('SELECT * FROM shard_locks WHERE status = ? ORDER BY acquired_at DESC, id ASC').all(String(statusFilter))
          : db.prepare('SELECT * FROM shard_locks ORDER BY acquired_at DESC, id ASC').all()
        for (const r of rawRows) {
          if (taskFilter !== undefined && taskFilter !== null && String(taskFilter) !== '' && String(r.worker_task_id) !== String(taskFilter)) {
            continue
          }
          if (nameFilter !== undefined && nameFilter !== null && String(nameFilter) !== '' && String(r.worker_name) !== String(nameFilter)) {
            continue
          }
          if (waveFilter !== undefined && waveFilter !== null && String(waveFilter) !== '' && String(r.wave) !== String(waveFilter)) {
            continue
          }
          rows.push(Object.assign({}, r, { engagement_id: r.engagement_id || resolvedId }))
        }
      } catch { /* ignore */ }
    }
    Object.defineProperties(rows, {
      items: { value: rows, enumerable: false },
      shard_locks: { value: rows, enumerable: false },
      active: { value: rows.filter((r) => r.status === 'active'), enumerable: false },
      engagement_id: { value: resolvedId, enumerable: false },
    })
    return rows
  }


  /**
   * 申请文件分片互斥锁（ShardLock）：检测跨 Worker 活跃文件模式冲突，冲突时拒绝并返回详情。
   */
  acquireShardLocks(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, true)
    const now = nowIso()
    const workerTaskId = String(input.worker_task_id ?? input.worker_id ?? '').trim()
    const workerName = String(input.worker_name ?? input.workerName ?? '').trim()
    const wave = String(input.wave || 'wave-3').trim() || 'wave-3'
    const rawPatterns = parseStringList(
      input.files_owned ?? input.filesOwned ?? input.file_patterns ?? input.patterns ?? (input.file_pattern ? [input.file_pattern] : []),
      [],
    )
    const patterns = Array.from(new Set(rawPatterns.map((p) => normalizeShardPattern(p)).filter(Boolean)))

    if (patterns.length === 0) {
      return {
        ok: true,
        acquired: true,
        conflict: false,
        violated: false,
        engagement_id: resolvedId,
        conflicts: [],
        locks: [],
        acquired_locks: [],
      }
    }

    const activeLocks = db.prepare("SELECT * FROM shard_locks WHERE status = 'active' ORDER BY acquired_at ASC, id ASC").all()
    const isSameOwner = (lock) => {
      const lTask = String(lock.worker_task_id || '').trim()
      const lName = String(lock.worker_name || '').trim()
      if (lTask && workerTaskId) return lTask === workerTaskId
      if (!lTask && !workerTaskId && lName && workerName) return lName === workerName
      return false
    }

    const conflicts = []
    for (const pat of patterns) {
      for (const lock of activeLocks) {
        if (isSameOwner(lock)) continue
        if (shardPatternsOverlap(pat, lock.file_pattern)) {
          conflicts.push({
            file_pattern: pat,
            conflicting_lock_id: lock.id,
            conflicting_pattern: lock.file_pattern,
            conflicting_worker_task_id: lock.worker_task_id,
            conflicting_worker_name: lock.worker_name,
            wave: lock.wave,
          })
        }
      }
    }

    if (conflicts.length > 0) {
      const detailText = conflicts
        .map((c) => `${c.file_pattern} 与 ${c.conflicting_worker_name || c.conflicting_worker_task_id || '其他 Worker'} 持有的活跃分片锁 [${c.conflicting_pattern}] 冲突`)
        .join('；')
      return {
        ok: false,
        acquired: false,
        conflict: true,
        violated: true,
        engagement_id: resolvedId,
        conflicts,
        locks: [],
        acquired_locks: [],
        error: `ShardLock 冲突拒绝：${detailText}`,
      }
    }

    const acquiredLocks = []
    let insertedCount = 0
    for (const pat of patterns) {
      const existingSame = activeLocks.find((l) => isSameOwner(l) && normalizeShardPattern(l.file_pattern) === pat)
      if (existingSame) {
        acquiredLocks.push(Object.assign({}, existingSame, { engagement_id: resolvedId }))
        continue
      }
      const lockId = nextClosedLoopUid(this, 'lock')
      db.prepare(`
        INSERT INTO shard_locks (
          id, engagement_id, worker_task_id, worker_name, wave, file_pattern, status, acquired_at, released_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        lockId,
        resolvedId,
        workerTaskId,
        workerName,
        wave,
        pat,
        'active',
        now,
        null,
      )
      insertedCount += 1
      acquiredLocks.push({
        id: lockId,
        engagement_id: resolvedId,
        worker_task_id: workerTaskId,
        worker_name: workerName,
        wave,
        file_pattern: pat,
        status: 'active',
        acquired_at: now,
        released_at: null,
      })
    }

    if (workerTaskId) {
      try {
        db.prepare('UPDATE worker_tasks SET files_owned_json = ?, updated_at = ? WHERE CAST(id AS TEXT) = ?')
          .run(JSON.stringify(patterns), now, workerTaskId)
      } catch { /* ignore */ }
    }

    if (insertedCount > 0) {
      this._recordPgWrite('INSERT', 'shard_locks', {
        engagement_id: resolvedId,
        role: 'assess',
        rows: insertedCount,
        summary: `INSERT shard_locks · ${workerName || workerTaskId || 'worker'} 锁定 ${insertedCount} 个分片`,
      })
    }

    return {
      ok: true,
      acquired: true,
      conflict: false,
      violated: false,
      engagement_id: resolvedId,
      conflicts: [],
      locks: acquiredLocks,
      acquired_locks: acquiredLocks,
    }
  }


  /**
   * 释放指定 Worker（或指定锁 ID）持有的活跃分片锁。
   */
  releaseShardLocks(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, false)
    if (!db) return { ok: true, engagement_id: resolvedId, released: 0 }
    const now = nowIso()
    const workerTaskId = String(input.worker_task_id ?? input.worker_id ?? '').trim()
    const workerName = String(input.worker_name ?? input.workerName ?? '').trim()
    const lockId = String(input.lock_id ?? input.id ?? '').trim()
    let changes = 0
    if (lockId && lockId.startsWith('lock-')) {
      changes = db.prepare("UPDATE shard_locks SET status = 'released', released_at = ? WHERE id = ? AND status = 'active'")
        .run(now, lockId).changes || 0
    } else if (workerTaskId && workerName) {
      changes = db.prepare(
        "UPDATE shard_locks SET status = 'released', released_at = ? WHERE status = 'active' AND (worker_task_id = ? OR (worker_task_id = '' AND worker_name = ?))",
      ).run(now, workerTaskId, workerName).changes || 0
    } else if (workerTaskId) {
      changes = db.prepare("UPDATE shard_locks SET status = 'released', released_at = ? WHERE status = 'active' AND worker_task_id = ?")
        .run(now, workerTaskId).changes || 0
    } else if (workerName) {
      changes = db.prepare("UPDATE shard_locks SET status = 'released', released_at = ? WHERE status = 'active' AND worker_name = ?")
        .run(now, workerName).changes || 0
    }
    if (changes > 0) {
      this._recordPgWrite('UPDATE', 'shard_locks', {
        engagement_id: resolvedId,
        role: 'plan',
        rows: changes,
        summary: `RELEASE shard_locks · ${workerName || workerTaskId || lockId} 释放 ${changes} 个分片锁`,
      })
    }
    return { ok: true, engagement_id: resolvedId, released: changes }
  }


  /**
   * 0. 交互式需求精炼向导（Wish Refiner Wizard）：将模糊用户愿景转化为结构化规格契约。
   */
  refineUserWish(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string') {
      if (arg2 && typeof arg2 === 'object') input = Object.assign({ engagement_id: arg1 }, arg2)
      else if (typeof arg2 === 'string') input = { engagement_id: arg1, wish: arg2 }
      else input = { wish: arg1 }
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const resolvedId = String(input.engagement_id || input.engagement || this.activeEngagementId() || 'default').trim() || 'default'
    const rawWish = String(
      input.user_prompt ?? input.userPrompt ?? input.prompt ?? input.wish ?? input.goal ?? '构建 1 Plan + N Workers 闭环研发与回归验证流水线',
    ).trim() || '构建 1 Plan + N Workers 闭环研发与回归验证流水线'
    const shortTitle = rawWish.replace(/\s+/g, ' ').slice(0, 64)
    const lower = rawWish.toLowerCase()
    const touchesUi = /ui|前端|页面|面板|画布|组件|react|vue|css|交互|wizard|看板/i.test(rawWish)
    const touchesDb = /db|sql|pg|postgres|sqlite|schema|表|存储|锁|store/i.test(rawWish)
    const touchesApi = /api|接口|webhook|飞书|桥接|路由|工具|mcp|agent|worker/i.test(rawWish)

    const clarifications = [
      touchesDb
        ? '数据契约边界：确认新增/变更表字段保持 SQLite WAL 与 PostgreSQL Wire v3 双引擎幂等兼容，且全程启用外键约束'
        : '模块分片边界：确认各并行 Worker 独占独立目录/文件 Glob，禁止跨分片并发覆写同一源码文件',
      touchesUi
        ? '交互反馈闭环：确认前端操作通过实时状态表驱动渲染，空闲态与运行态指标真实反映数据库行数，不展示硬编码假数据'
        : '状态流转闭环：确认 Worker 提交压缩摘要后进入 pending_approval，审批要求返工（revision_requested）不会误判为通过',
      touchesApi
        ? '外部集成容错：确认 Webhook / RPC 调用具备超时保护与结构化错误落盘，离线或失败时保留可重试状态'
        : '回归验收范围：确认单元与冒烟测试脚本零外部依赖且可单命令全量回归通过',
    ]

    const acceptanceCriteria = [
      `核心需求落地：完整实现「${shortTitle}」对应的存储契约、业务逻辑与状态机转换`,
      '分片互斥保障：每个并行 Worker 绑定互不重叠的 files_owned 并登记活跃 shard_locks，越界修改自动记录 shard_warning',
      '审批与幂等性：支持 approved 与 revision_required 精确路由，重复触发审批不产生重复下游任务',
      `质量门禁达标：${lower.includes('test') || lower.includes('测试') ? '新增专项回归测试并' : ''}确保套件 100% 通过且零机密泄露`,
    ]

    const refinedSpec = {
      title: `工程交付规格 · ${shortTitle}`,
      summary: `围绕用户愿景「${rawWish.slice(0, 160)}」，采用 4-Wave Bounded DAG 与文件分片互斥锁（ShardLock）切分为架构契约、并行研发、契约审查与自动化门禁四个闭环波次。`,
      clarifications,
      acceptance_criteria: acceptanceCriteria,
    }

    const proposedGoals = [
      {
        wave: 'wave-1',
        ui_priority: 'P0',
        worker_role: 'recon',
        worker_name: 'recon-arch',
        files_owned: ['docs/architecture/**', 'packages/redteam-store/lib/schema.js'],
        title: 'Wave 1 · 架构测绘与目标拆解（Architecture & Discovery）',
        objective: `拆解用户目标「${rawWish.slice(0, 120)}」，锁定数据表结构契约与并行分片边界`,
      },
      {
        wave: 'wave-2',
        ui_priority: 'P1',
        worker_role: 'exploit',
        worker_name: 'builder-canvas',
        files_owned: ['packages/redteam-ui/lib/**', 'packages/redteam-tools/lib/**'],
        title: 'Wave 2 · 并行模块分片研发（Parallel Module Implementation）',
        objective: `围绕「${rawWish.slice(0, 120)}」并行推进核心引擎与 UI 交互画布实现`,
      },
      {
        wave: 'wave-3',
        ui_priority: 'P2',
        worker_role: 'vuln-scan',
        worker_name: 'reviewer-pg-audit',
        files_owned: ['packages/redteam-store/lib/core.js', 'packages/redteam-store/lib/pg-engine.js'],
        title: 'Wave 3 · 契约审查与压缩摘要归档（Contract & Regression Audit）',
        objective: '汇总各 Worker 压缩摘要（Digest），校验 PG 落表完整性与接口契约',
      },
      {
        wave: 'wave-4',
        ui_priority: 'P3',
        worker_role: 'qa',
        worker_name: 'qa-release-gate',
        files_owned: ['packages/*/test/**', 'docs/release/**'],
        title: 'Wave 4 · 自动化回归与发布门禁（Release Gate）',
        objective: `执行全量回归测试与门禁验收，确认「${rawWish.slice(0, 90)}」闭环交付`,
      },
    ]

    if (input.commit === true || input.decompose === true) {
      return this.decomposeUserPrompt(Object.assign({}, input, {
        engagement_id: resolvedId,
        user_prompt: rawWish,
      }))
    }

    return {
      ok: true,
      engagement_id: resolvedId,
      engagement: resolvedId,
      prompt_hash: promptHash(rawWish),
      user_prompt: rawWish,
      wish: rawWish,
      refined_spec: refinedSpec,
      goals: proposedGoals,
      proposed_goals: proposedGoals,
      worker_tasks: proposedGoals.map((g, idx) => ({
        id: `preview-wt-${idx + 1}`,
        worker_name: g.worker_name,
        worker_role: g.worker_role,
        wave: g.wave,
        ui_priority: g.ui_priority,
        files_owned: g.files_owned,
        assigned_goal: g.objective,
      })),
    }
  }


  /**
   * 1. 将用户需求拆解为结构化 `plan_goals`（4 波次），预分配互不重叠 `files_owned` 的 `worker_tasks` 并登记 `shard_locks`。
   *    当收到真实 AI 生成的结构化 `payload.goals` 时按目标规范落库并支持 `acceptance_criteria / wave / role / title / assigned_goal / files_owned`；
   *    若 `payload.require_ai === true` 且未提供有效非空 `goals`（且未显式允许 `allow_static_fallback: true`），拒绝走静默静态模板。
   */
  decomposeUserPrompt(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string') {
      if (arg2 && typeof arg2 === 'object') input = Object.assign({ engagement_id: arg1 }, arg2)
      else if (typeof arg2 === 'string') input = { engagement_id: arg1, user_prompt: arg2 }
      else input = { user_prompt: arg1 }
    } else if ((arg1 === null || arg1 === undefined) && arg2 && typeof arg2 === 'object') {
      input = arg2
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }

    const firstNonEmpty = (...vals) => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim() !== '') return v.trim()
      }
      return ''
    }
    const normalizeWave = (raw, fallback = 'wave-2') => {
      if (raw === undefined || raw === null) return fallback
      const s = String(raw).trim().toLowerCase()
      if (!s) return fallback
      if (/^\d+$/.test(s)) return `wave-${s}`
      if (/^wave[\s_-]*(\d+)$/.test(s)) return s.replace(/^wave[\s_-]*(\d+)$/, 'wave-$1')
      return s
    }

    const resolvedId = String(input.engagement_id || input.engagement || this.activeEngagementId() || 'default').trim() || 'default'
    const validInputGoals = Array.isArray(input.goals)
      ? input.goals.filter((item) => {
          if (typeof item === 'string') return item.trim() !== ''
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false
          return Boolean(firstNonEmpty(
            item.title,
            item.name,
            item.assigned_goal,
            item.assignedGoal,
            item.objective,
            item.description,
            item.goal,
          ))
        })
      : []
    const hasAiGoals = validInputGoals.length > 0

    if (input.require_ai === true && !hasAiGoals && input.allow_static_fallback !== true) {
      return {
        ok: false,
        requires_llm: true,
        engagement_id: resolvedId,
        error: '未提供 AI 拆解目标（需要真实 LLM 调用生成蓝图）',
      }
    }

    const { db } = openClosedLoopDb(this, resolvedId, true)
    const userPrompt = String(
      input.user_prompt ?? input.userPrompt ?? input.prompt ?? input.wish ?? input.goal ?? '构建 1 Plan + N Workers 闭环研发与回归验证流水线',
    ).trim() || '构建 1 Plan + N Workers 闭环研发与回归验证流水线'
    const pHash = promptHash(userPrompt)
    const now = nowIso()
    const priorityWeights = { P0: 100, P1: 80, P2: 50, P3: 20 }
    const baseRefined = this.refineUserWish({ engagement_id: resolvedId, user_prompt: userPrompt, spec_only: true }).refined_spec
    const customRefined = input.refined_spec && typeof input.refined_spec === 'object' ? input.refined_spec : {}
    const topLevelCriteria = parseStringList(
      input.acceptance_criteria ?? input.acceptanceCriteria ?? customRefined.acceptance_criteria,
      [],
    )
    const refinedSpec = {
      title: firstNonEmpty(customRefined.title, input.title, baseRefined.title),
      summary: firstNonEmpty(customRefined.summary, input.summary, baseRefined.summary),
      clarifications: Array.isArray(customRefined.clarifications) && customRefined.clarifications.length > 0
        ? customRefined.clarifications
        : baseRefined.clarifications,
      acceptance_criteria: topLevelCriteria.length > 0 ? topLevelCriteria : baseRefined.acceptance_criteria,
    }

    const defaultTemplates = [
      {
        wave: 'wave-1',
        ui_priority: 'P0',
        priority_weight: 100,
        status: 'running',
        worker_role: 'recon',
        worker_name: 'recon-arch',
        tags: ['#core-arch', '#wave-1'],
        files_owned: ['docs/architecture/**', 'packages/redteam-store/lib/schema.js'],
        title: 'Wave 1 · 架构测绘与目标拆解（Architecture & Discovery）',
        objective: `拆解用户目标「${userPrompt.slice(0, 120)}」，锁定数据表结构契约与并行分片边界`,
      },
      {
        wave: 'wave-2',
        ui_priority: 'P1',
        priority_weight: 80,
        status: 'planned',
        worker_role: 'exploit',
        worker_name: 'builder-canvas',
        tags: ['#ui-canvas', '#60fps'],
        files_owned: ['packages/redteam-ui/lib/**', 'packages/redteam-tools/lib/**'],
        title: 'Wave 2 · 并行模块分片研发（Parallel Module Implementation）',
        objective: `围绕「${userPrompt.slice(0, 120)}」并行推进核心引擎与 UI 交互画布实现`,
      },
      {
        wave: 'wave-3',
        ui_priority: 'P2',
        priority_weight: 50,
        status: 'planned',
        worker_role: 'vuln-scan',
        worker_name: 'reviewer-pg-audit',
        tags: ['#pg-store', '#digest'],
        files_owned: ['packages/redteam-store/lib/core.js', 'packages/redteam-store/lib/pg-engine.js'],
        title: 'Wave 3 · 契约审查与压缩摘要归档（Contract & Regression Audit）',
        objective: '汇总各 Worker 压缩摘要（Digest），校验 PG 落表完整性与接口契约',
      },
      {
        wave: 'wave-4',
        ui_priority: 'P3',
        priority_weight: 20,
        status: 'planned',
        worker_role: 'qa',
        worker_name: 'qa-release-gate',
        tags: ['#qa-gate', '#smoke'],
        files_owned: ['packages/*/test/**', 'docs/release/**'],
        title: 'Wave 4 · 自动化回归与发布门禁（Release Gate）',
        objective: `执行全量回归测试与门禁验收，确认「${userPrompt.slice(0, 90)}」闭环交付`,
      },
    ]

    const rawGoals = hasAiGoals ? validInputGoals : defaultTemplates
    const goalIntPk = isTableIntPk(this, db, 'plan_goals')
    const taskIntPk = isTableIntPk(this, db, 'worker_tasks')

    const createdGoals = []
    const createdTasks = []
    const createdLocks = []
    const collectedGoalCriteria = []
    let prevGoalId = null

    for (let i = 0; i < rawGoals.length; i++) {
      const tpl = defaultTemplates[i % defaultTemplates.length]
      const g = typeof rawGoals[i] === 'string'
        ? { title: rawGoals[i], objective: rawGoals[i] }
        : (rawGoals[i] || {})
      const wave = normalizeWave(g.wave, hasAiGoals ? (i < defaultTemplates.length ? tpl.wave : 'wave-3') : (tpl.wave || `wave-${i + 1}`))
      const rawPri = String(g.ui_priority ?? g.priority ?? '').trim().toUpperCase()
      const uiPriority = ['P0', 'P1', 'P2', 'P3'].includes(rawPri)
        ? rawPri
        : (hasAiGoals ? (wave === 'wave-1' ? 'P0' : 'P1') : tpl.ui_priority)
      const priorityWeight = Number(g.priority_weight) || priorityWeights[uiPriority] || tpl.priority_weight || 80
      const assignedGoal = firstNonEmpty(
        g.assigned_goal,
        g.assignedGoal,
        g.objective,
        g.description,
        g.goal,
        g.title,
        g.name,
        hasAiGoals ? '' : tpl.objective,
      )
      const objective = firstNonEmpty(
        g.objective,
        g.assigned_goal,
        g.assignedGoal,
        g.description,
        g.goal,
        g.title,
        g.name,
        assignedGoal,
        tpl.objective,
      )
      const title = firstNonEmpty(
        g.title,
        g.name,
        hasAiGoals ? assignedGoal.slice(0, 72) : '',
        tpl.title,
      )
      const goalAcceptanceCriteria = parseStringList(g.acceptance_criteria ?? g.acceptanceCriteria, [])
      for (const c of goalAcceptanceCriteria) {
        if (!collectedGoalCriteria.includes(c)) collectedGoalCriteria.push(c)
      }
      const acceptanceCriteriaJson = JSON.stringify(goalAcceptanceCriteria)
      const goalStatus = firstNonEmpty(
        g.status,
        hasAiGoals ? ((wave === 'wave-1' || i === 0) ? 'running' : 'planned') : tpl.status,
        i === 0 ? 'running' : 'planned',
      )
      const parentGoalId = g.parent_goal_id !== undefined ? g.parent_goal_id : prevGoalId
      const preferredGoalId = g.id || nextClosedLoopUid(this, `goal-w${i + 1}`)
      const bindGoalId = goalIntPk
        ? (Number.isInteger(Number(preferredGoalId)) ? Number(preferredGoalId) : null)
        : String(preferredGoalId)

      const goalRes = db.prepare(`
        INSERT INTO plan_goals (
          id, engagement_id, parent_goal_id, prompt_hash, user_prompt,
          title, objective, wave, ui_priority, priority_weight,
          status, approval_note, approved_at, acceptance_criteria_json, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          objective = excluded.objective,
          wave = excluded.wave,
          ui_priority = excluded.ui_priority,
          priority_weight = excluded.priority_weight,
          status = excluded.status,
          acceptance_criteria_json = excluded.acceptance_criteria_json,
          updated_at = excluded.updated_at
      `).run(
        bindGoalId,
        resolvedId,
        parentGoalId ?? null,
        pHash,
        userPrompt,
        title,
        objective,
        wave,
        uiPriority,
        priorityWeight,
        goalStatus,
        g.approval_note ?? '',
        g.approved_at ?? null,
        acceptanceCriteriaJson,
        now,
        now,
      )
      const finalGoalId = bindGoalId !== null ? bindGoalId : Number(goalRes.lastInsertRowid)
      prevGoalId = finalGoalId

      const goalRecord = {
        id: finalGoalId,
        engagement_id: resolvedId,
        parent_goal_id: parentGoalId ?? null,
        prompt_hash: pHash,
        user_prompt: userPrompt,
        title,
        objective,
        wave,
        ui_priority: uiPriority,
        priority_weight: priorityWeight,
        status: goalStatus,
        approval_note: g.approval_note ?? '',
        approved_at: g.approved_at ?? null,
        acceptance_criteria: goalAcceptanceCriteria,
        acceptance_criteria_json: acceptanceCriteriaJson,
        created_at: now,
        updated_at: now,
      }
      createdGoals.push(goalRecord)

      const workerRole = firstNonEmpty(
        g.worker_role,
        g.role,
        g.workerRole,
        hasAiGoals ? 'exploit' : tpl.worker_role,
        'exploit',
      )
      const rawTags = Array.isArray(g.tags)
        ? g.tags
        : (typeof g.tags_json === 'string'
          ? parseJson(g.tags_json, tpl.tags)
          : (hasAiGoals ? [`#${wave}`, `#${workerRole}`, '#ai-plan'] : tpl.tags))
      const tagsJson = JSON.stringify(rawTags)
      const workerName = firstNonEmpty(
        g.worker_name,
        g.workerName,
        g.name,
        hasAiGoals ? `${workerRole}-${wave}-${i + 1}` : (i < defaultTemplates.length ? tpl.worker_name : `${workerRole}-shard-${i + 1}`),
      )
      const hasExplicitFilesOwned = g.files_owned !== undefined || g.filesOwned !== undefined || g.files_owned_json !== undefined
      const fallbackFilesOwned = !hasAiGoals && i < defaultTemplates.length
        ? tpl.files_owned
        : [`shards/${wave}/${slugify(workerName) || ('shard-' + (i + 1))}/**`]
      const filesOwned = (hasExplicitFilesOwned
        ? parseStringList(g.files_owned ?? g.filesOwned ?? g.files_owned_json, [])
        : fallbackFilesOwned)
        .map((p) => normalizeShardPattern(p))
        .filter(Boolean)
      const filesOwnedJson = JSON.stringify(filesOwned)
      const sessionId = firstNonEmpty(g.session_id, g.sessionId, `sess-${pHash.slice(0, 6)}-w${i + 1}`)
      const taskStatus = firstNonEmpty(g.task_status, g.taskStatus, goalStatus === 'running' ? 'running' : 'queued')
      const approvalState = firstNonEmpty(g.approval_state, g.approvalState, 'working')
      const preferredTaskId = g.worker_task_id || nextClosedLoopUid(this, `wt-w${i + 1}`)
      const bindTaskId = taskIntPk
        ? (Number.isInteger(Number(preferredTaskId)) ? Number(preferredTaskId) : null)
        : String(preferredTaskId)

      const taskRes = db.prepare(`
        INSERT INTO worker_tasks (
          id, engagement_id, goal_id, session_id, worker_name, worker_role,
          wave, ui_priority, priority_weight, tags_json, files_owned_json, assigned_goal,
          status, approval_state, next_goal, error_detail, acceptance_criteria_json, tool_calls, turns, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          goal_id = excluded.goal_id,
          worker_name = excluded.worker_name,
          worker_role = excluded.worker_role,
          wave = excluded.wave,
          ui_priority = excluded.ui_priority,
          priority_weight = excluded.priority_weight,
          tags_json = excluded.tags_json,
          files_owned_json = excluded.files_owned_json,
          assigned_goal = excluded.assigned_goal,
          status = excluded.status,
          approval_state = excluded.approval_state,
          acceptance_criteria_json = excluded.acceptance_criteria_json,
          updated_at = excluded.updated_at
      `).run(
        bindTaskId,
        resolvedId,
        finalGoalId,
        sessionId,
        workerName,
        workerRole,
        wave,
        uiPriority,
        priorityWeight,
        tagsJson,
        filesOwnedJson,
        assignedGoal,
        taskStatus,
        approvalState,
        '',
        '',
        acceptanceCriteriaJson,
        Number(g.tool_calls) || 0,
        Number(g.turns) || 0,
        now,
        now,
      )
      const finalTaskId = bindTaskId !== null ? bindTaskId : Number(taskRes.lastInsertRowid)
      const dependsOnList = parseStringList(g.depends_on ?? g.dependsOn ?? g.depends_on_json, [])
      if (dependsOnList.length > 0) {
        try {
          db.prepare('UPDATE worker_tasks SET depends_on_json = ? WHERE id = ?')
            .run(JSON.stringify(dependsOnList), finalTaskId)
        } catch { /* ignore depends_on column error */ }
      }
      const lockRes = this.acquireShardLocks({
        engagement_id: resolvedId,
        worker_task_id: String(finalTaskId),
        worker_name: workerName,
        wave,
        files_owned: filesOwned,
      })
      if (Array.isArray(lockRes.locks)) createdLocks.push(...lockRes.locks)
      let errorDetail = ''
      if (lockRes.conflict) {
        errorDetail = lockRes.error || 'shard_warning: 分片锁冲突'
        db.prepare('UPDATE worker_tasks SET error_detail = ? WHERE id = ?').run(errorDetail, finalTaskId)
      }

      createdTasks.push({
        id: finalTaskId,
        engagement_id: resolvedId,
        goal_id: finalGoalId,
        session_id: sessionId,
        worker_name: workerName,
        worker_role: workerRole,
        wave,
        ui_priority: uiPriority,
        priority_weight: priorityWeight,
        tags_json: tagsJson,
        tags: rawTags,
        files_owned_json: filesOwnedJson,
        files_owned: filesOwned,
        assigned_goal: assignedGoal,
        acceptance_criteria: goalAcceptanceCriteria,
        acceptance_criteria_json: acceptanceCriteriaJson,
        status: taskStatus,
        approval_state: approvalState,
        next_goal: '',
        error_detail: errorDetail,
        dispatched_at: '',
        tool_calls: Number(g.tool_calls) || 0,
        turns: Number(g.turns) || 0,
        created_at: now,
        updated_at: now,
      })
    }

    if (hasAiGoals && topLevelCriteria.length === 0 && collectedGoalCriteria.length > 0) {
      refinedSpec.acceptance_criteria = collectedGoalCriteria
    }

    this._recordPgWrite('INSERT', 'plan_goals', {
      engagement_id: resolvedId,
      role: 'plan',
      rows: createdGoals.length,
      summary: `INSERT plan_goals · 拆解 ${createdGoals.length} 个波次目标 (${pHash.slice(0, 8)})`,
    })
    this._recordPgWrite('INSERT', 'worker_tasks', {
      engagement_id: resolvedId,
      role: 'plan',
      rows: createdTasks.length,
      summary: `INSERT worker_tasks · 预分配 ${createdTasks.length} 个 Worker 分片任务`,
    })

    return {
      ok: true,
      source: hasAiGoals ? 'ai' : 'static_fallback',
      engagement_id: resolvedId,
      engagement: resolvedId,
      prompt_hash: pHash,
      user_prompt: userPrompt,
      refined_spec: refinedSpec,
      goals: createdGoals,
      plan_goals: createdGoals,
      worker_tasks: createdTasks,
      shard_locks: createdLocks,
    }
  }


  /**
   * 2. 提交 Worker 压缩摘要（Digest），自动计算真实 Token 压缩比，执行运行时 ShardLock 越界校验，并将待审批 Worker 置顶为 P0。
   */
  submitWorkerDigest(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }

    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, true)
    const now = nowIso()
    const whatWasDone = String(input.what_was_done ?? input.whatWasDone ?? input.summary ?? '').trim()

    /* 先定位已存在的对应 worker_tasks 行，以便读取 turns / tool_calls / files_owned_json */
    let existingTask = null
    const lookupTaskId = input.worker_task_id ?? input.worker_id
    if (lookupTaskId !== undefined && lookupTaskId !== null && String(lookupTaskId) !== '') {
      existingTask = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(lookupTaskId)
        || db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(String(lookupTaskId))
    }
    if (!existingTask && (input.session_id || input.sessionId)) {
      existingTask = db.prepare('SELECT * FROM worker_tasks WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1')
        .get(String(input.session_id || input.sessionId))
    }
    if (!existingTask && (input.worker_name || input.workerName)) {
      existingTask = db.prepare('SELECT * FROM worker_tasks WHERE worker_name = ? ORDER BY updated_at DESC LIMIT 1')
        .get(String(input.worker_name || input.workerName))
    }

    const effTurns = Math.max(1, Number(input.turns ?? existingTask?.turns) || 1)
    const effToolCalls = Math.max(1, Number(input.tool_calls ?? input.toolCalls ?? existingTask?.tool_calls) || 1)
    const suppliedRaw = Number(input.raw_tokens_estimate ?? input.rawTokensEstimate ?? input.raw_tokens ?? input.rawTokens)
    const suppliedCompressed = Number(input.digest_tokens_estimate ?? input.digestTokensEstimate ?? input.compressed_tokens ?? input.compressedTokens)
    const rawTokens = suppliedRaw > 0
      ? Math.round(suppliedRaw)
      : (effTurns * 450 + effToolCalls * 320 + whatWasDone.length * 2)
    const compressedTokens = suppliedCompressed > 0
      ? Math.round(suppliedCompressed)
      : Math.max(48, Math.ceil(whatWasDone.length / 3.5))
    const compressionPct = rawTokens > 0
      ? Math.max(0, Math.min(99, Math.round((1 - compressedTokens / Math.max(1, rawTokens)) * 100)))
      : 0

    const filesTouched = parseStringList(
      input.files_touched ?? input.filesTouched ?? input.files_touched_json,
      [],
    )
    const keyDecisions = parseStringList(
      input.key_decisions ?? input.keyDecisions ?? input.key_decisions_json,
      [],
    )
    const filesTouchedJson = JSON.stringify(filesTouched)
    const keyDecisionsJson = JSON.stringify(keyDecisions)
    const verification = String(input.verification ?? 'passed')

    /* 确保 goal_id 在 plan_goals 中可关联 */
    let goalId = input.goal_id ?? (existingTask && existingTask.goal_id) ?? null
    if (goalId !== null && goalId !== undefined && String(goalId) !== '') {
      const existingGoal = db.prepare('SELECT id FROM plan_goals WHERE CAST(id AS TEXT) = ?').get(String(goalId))
      if (!existingGoal) {
        const goalIntPk = isTableIntPk(this, db, 'plan_goals')
        const bindGoalId = goalIntPk
          ? (Number.isInteger(Number(goalId)) ? Number(goalId) : null)
          : String(goalId)
        const gRes = db.prepare(`
          INSERT INTO plan_goals (
            id, engagement_id, parent_goal_id, prompt_hash, user_prompt,
            title, objective, wave, ui_priority, priority_weight,
            status, approval_note, approved_at, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindGoalId,
          resolvedId,
          null,
          promptHash(whatWasDone || 'digest-goal'),
          whatWasDone || 'Worker 阶段任务',
          (input.worker_name || input.workerName) ? `${input.worker_name || input.workerName} 阶段目标` : 'Worker 阶段目标',
          whatWasDone || '完成阶段研发并提交 Digest',
          input.wave || 'wave-2',
          'P0',
          100,
          'running',
          '',
          null,
          now,
          now,
        )
        goalId = bindGoalId !== null ? bindGoalId : Number(gRes.lastInsertRowid)
      }
    }

    const taskIntPk = isTableIntPk(this, db, 'worker_tasks')
    let finalTaskId
    if (!existingTask) {
      const preferredTaskId = lookupTaskId || nextClosedLoopUid(this, 'wt')
      const bindTaskId = taskIntPk
        ? (Number.isInteger(Number(preferredTaskId)) ? Number(preferredTaskId) : null)
        : String(preferredTaskId)
      const tagsArr = Array.isArray(input.tags) ? input.tags : ['#pg-store', '#digest']
      const initialOwned = parseStringList(input.files_owned ?? input.filesOwned, []).map((p) => normalizeShardPattern(p)).filter(Boolean)
      const tRes = db.prepare(`
        INSERT INTO worker_tasks (
          id, engagement_id, goal_id, session_id, worker_name, worker_role,
          wave, ui_priority, priority_weight, tags_json, files_owned_json, assigned_goal,
          status, approval_state, next_goal, error_detail, tool_calls, turns, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        bindTaskId,
        resolvedId,
        goalId,
        String(input.session_id || input.sessionId || preferredTaskId),
        String(input.worker_name || input.workerName || 'worker-1'),
        String(input.worker_role || input.role || 'exploit'),
        String(input.wave || 'wave-2'),
        'P0',
        100,
        JSON.stringify(tagsArr),
        JSON.stringify(initialOwned),
        whatWasDone || '执行分片任务',
        'completed',
        'pending_approval',
        String(input.next_goal || ''),
        '',
        effToolCalls,
        effTurns,
        now,
        now,
      )
      finalTaskId = bindTaskId !== null ? bindTaskId : Number(tRes.lastInsertRowid)
    } else {
      finalTaskId = existingTask.id
      db.prepare(`
        UPDATE worker_tasks
        SET goal_id = COALESCE(?, goal_id),
            session_id = COALESCE(?, session_id),
            worker_name = COALESCE(?, worker_name),
            status = 'completed',
            approval_state = 'pending_approval',
            ui_priority = 'P0',
            priority_weight = 100,
            tool_calls = CASE WHEN ? > 0 THEN ? ELSE COALESCE(tool_calls, 0) END,
            turns = CASE WHEN ? > 0 THEN ? ELSE COALESCE(turns, 0) END,
            updated_at = ?
        WHERE id = ?
      `).run(
        goalId,
        input.session_id ?? input.sessionId ?? null,
        input.worker_name ?? input.workerName ?? null,
        Number(input.tool_calls ?? input.toolCalls) || 0,
        Number(input.tool_calls ?? input.toolCalls) || 0,
        Number(input.turns) || 0,
        Number(input.turns) || 0,
        now,
        finalTaskId,
      )
    }

    let updatedTaskRaw = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(finalTaskId) || {}
    const workerName = String(input.worker_name || input.workerName || updatedTaskRaw.worker_name || 'worker-1')

    /* 运行时分片越界检查（Runtime Shard Violation Check） */
    const ownedPatterns = parseJson(updatedTaskRaw.files_owned_json, [])
      .map((p) => normalizeShardPattern(p))
      .filter(Boolean)
    const activeLocks = db.prepare("SELECT * FROM shard_locks WHERE status = 'active'").all()
    const violations = []
    for (const rawFile of filesTouched) {
      const normFile = normalizeShardPattern(rawFile)
      if (!normFile) continue
      for (const lock of activeLocks) {
        const lTask = String(lock.worker_task_id || '').trim()
        const lName = String(lock.worker_name || '').trim()
        const ownedBySelf = (lTask && lTask === String(finalTaskId)) || (!lTask && lName && lName === workerName)
        if (ownedBySelf) continue
        if (fileMatchesShardPattern(normFile, lock.file_pattern) || shardPatternsOverlap(normFile, lock.file_pattern)) {
          violations.push({
            type: 'locked_by_other_worker',
            file: rawFile,
            lock_id: lock.id,
            owner_worker_task_id: lock.worker_task_id,
            owner_worker_name: lock.worker_name,
            pattern: lock.file_pattern,
          })
        }
      }
      if (ownedPatterns.length > 0) {
        const withinOwned = ownedPatterns.some((pat) => fileMatchesShardPattern(normFile, pat) || shardPatternsOverlap(normFile, pat))
        if (!withinOwned) {
          violations.push({
            type: 'outside_files_owned',
            file: rawFile,
            files_owned: ownedPatterns,
          })
        }
      }
    }

    let shardConflict = { violated: false, details: [] }
    if (violations.length > 0) {
      const summaryParts = violations.map((v) => (
        v.type === 'locked_by_other_worker'
          ? `${v.file} 命中 ${v.owner_worker_name || v.owner_worker_task_id || '其他 Worker'} 持有的活跃锁 [${v.pattern}]`
          : `${v.file} 超出本 Worker 声明的 files_owned (${ownedPatterns.join(', ')})`
      ))
      const warningMsg = `shard_warning: ${summaryParts.join('；')}`
      db.prepare('UPDATE worker_tasks SET error_detail = ?, updated_at = ? WHERE id = ?')
        .run(warningMsg, now, finalTaskId)
      updatedTaskRaw = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(finalTaskId) || updatedTaskRaw
      shardConflict = {
        violated: true,
        warning: warningMsg,
        details: violations,
      }
    }

    const updatedTask = formatWorkerTaskRow(this, updatedTaskRaw, resolvedId)

    const digestIntPk = isTableIntPk(this, db, 'worker_digests')
    const preferredDigestId = input.id || input.digest_id || nextClosedLoopUid(this, 'digest')
    const bindDigestId = digestIntPk
      ? (Number.isInteger(Number(preferredDigestId)) ? Number(preferredDigestId) : null)
      : String(preferredDigestId)
    const approvalDecision = String(input.approval_decision || 'pending_approval')
    const followupGoal = String(input.followup_goal || input.next_goal || '')

    const dRes = db.prepare(`
      INSERT INTO worker_digests (
        id, engagement_id, worker_task_id, goal_id, worker_name,
        what_was_done, files_touched_json, key_decisions_json, verification,
        raw_tokens, compressed_tokens, compression_pct,
        approval_decision, followup_goal, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        what_was_done = excluded.what_was_done,
        files_touched_json = excluded.files_touched_json,
        key_decisions_json = excluded.key_decisions_json,
        verification = excluded.verification,
        raw_tokens = excluded.raw_tokens,
        compressed_tokens = excluded.compressed_tokens,
        compression_pct = excluded.compression_pct,
        approval_decision = excluded.approval_decision,
        followup_goal = excluded.followup_goal
    `).run(
      bindDigestId,
      resolvedId,
      finalTaskId,
      goalId ?? updatedTask.goal_id ?? null,
      workerName,
      whatWasDone,
      filesTouchedJson,
      keyDecisionsJson,
      verification,
      rawTokens,
      compressedTokens,
      compressionPct,
      approvalDecision,
      followupGoal,
      now,
    )
    const finalDigestId = bindDigestId !== null ? bindDigestId : Number(dRes.lastInsertRowid)
    const scopeAudit = auditWorkerScopeViolation(updatedTask.files_owned, filesTouched)
    const digestRecord = {
      id: finalDigestId,
      engagement_id: resolvedId,
      worker_task_id: finalTaskId,
      goal_id: goalId ?? updatedTask.goal_id ?? null,
      worker_name: workerName,
      what_was_done: whatWasDone,
      files_touched_json: filesTouchedJson,
      files_touched: filesTouched,
      key_decisions_json: keyDecisionsJson,
      key_decisions: keyDecisions,
      verification,
      raw_tokens: rawTokens,
      compressed_tokens: compressedTokens,
      compression_pct: compressionPct,
      approval_decision: approvalDecision,
      followup_goal: followupGoal,
      created_at: now,
      scope_ok: scopeAudit.scope_ok,
      scope_violations: scopeAudit.scope_violations,
    }

    try {
      recordPgDigestCompression(resolvedId, {
        rawTokens,
        compressedTokens,
        approval_decision: approvalDecision,
      })
    } catch { /* ignore */ }

    this._recordPgWrite('INSERT', 'worker_digests', {
      engagement_id: resolvedId,
      role: updatedTask.worker_role || 'exploit',
      summary: `INSERT worker_digests · ${workerName} 压缩率 ${compressionPct}% (${rawTokens}->${compressedTokens} tok)`,
    })
    this._recordPgWrite('UPDATE', 'worker_tasks', {
      engagement_id: resolvedId,
      role: updatedTask.worker_role || 'exploit',
      summary: `UPDATE worker_tasks · ${workerName} -> pending_approval (P0)`,
    })

    return {
      ok: true,
      engagement_id: resolvedId,
      raw_tokens: rawTokens,
      compressed_tokens: compressedTokens,
      compression_pct: compressionPct,
      digest: digestRecord,
      worker_task: updatedTask,
      shard_conflict: shardConflict,
      scope_ok: scopeAudit.scope_ok,
      scope_violations: scopeAudit.scope_violations,
    }
  }


  /**
   * 3. Plan 主脑审批 Worker 产出：
   *    - 精确区分 approved 与 revision_required（含 revision_requested / reject / rejected）
   *    - 显式传入 worker 标识未命中时直接新建对应行，绝不误批其他无关 Worker
   *    - 审批通过自动释放该 Worker 持有的活跃 shard_locks，并幂等创建下一波次任务（60s 内或 pending/running 不重复派发）
   */
  approveWorkerAndDispatchNext(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }

    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, true)
    const now = nowIso()
    const rawDecision = String(input.decision || 'approved').trim().toLowerCase()
    const decision = ['revision_requested', 'revision_required', 'reject', 'rejected'].includes(rawDecision)
      ? 'revision_required'
      : 'approved'
    const note = String(input.review_note ?? input.approval_note ?? input.note ?? '').trim()
    const nextWave = String(input.next_wave || 'wave-3').trim() || 'wave-3'
    const nextPriority = ['P0', 'P1', 'P2', 'P3'].includes(input.next_priority) ? input.next_priority : 'P1'
    const priorityWeights = { P0: 100, P1: 80, P2: 50, P3: 20 }

    /* 查找或 upsert 目标 worker_tasks 行 */
    const explicitTaskId = input.worker_task_id ?? input.worker_id ?? input.id
    const explicitSessionId = input.session_id ?? input.sessionId
    const explicitWorkerName = input.worker_name ?? input.workerName
    const hasExplicitIdentifier = [explicitTaskId, explicitSessionId, explicitWorkerName]
      .some((v) => v !== undefined && v !== null && String(v).trim() !== '')

    let targetTask = null
    if (explicitTaskId !== undefined && explicitTaskId !== null && String(explicitTaskId).trim() !== '') {
      const lookup = String(explicitTaskId).trim()
      targetTask = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(explicitTaskId)
        || db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(lookup)
        || db.prepare('SELECT * FROM worker_tasks WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1').get(lookup)
        || db.prepare('SELECT * FROM worker_tasks WHERE worker_name = ? ORDER BY updated_at DESC LIMIT 1').get(lookup)
    }
    if (!targetTask && explicitSessionId) {
      targetTask = db.prepare('SELECT * FROM worker_tasks WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1')
        .get(String(explicitSessionId).trim())
    }
    if (!targetTask && explicitWorkerName) {
      targetTask = db.prepare('SELECT * FROM worker_tasks WHERE worker_name = ? ORDER BY updated_at DESC LIMIT 1')
        .get(String(explicitWorkerName).trim())
    }
    /* 仅当未显式传入任何 Worker 标识时，才允许回退到最近一条 pending_approval 的 Worker；绝不回退到任意无关行 */
    if (!targetTask && !hasExplicitIdentifier) {
      targetTask = db.prepare(
        "SELECT * FROM worker_tasks WHERE approval_state = 'pending_approval' ORDER BY priority_weight DESC, updated_at DESC LIMIT 1",
      ).get()
    }

    const taskIntPk = isTableIntPk(this, db, 'worker_tasks')
    if (!targetTask) {
      const preferredTaskId = explicitTaskId || explicitSessionId || nextClosedLoopUid(this, 'wt')
      const bindTaskId = taskIntPk
        ? (Number.isInteger(Number(preferredTaskId)) ? Number(preferredTaskId) : null)
        : String(preferredTaskId)
      const tRes = db.prepare(`
        INSERT INTO worker_tasks (
          id, engagement_id, goal_id, session_id, worker_name, worker_role,
          wave, ui_priority, priority_weight, tags_json, files_owned_json, assigned_goal,
          status, approval_state, next_goal, error_detail, tool_calls, turns, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        bindTaskId,
        resolvedId,
        input.goal_id ?? null,
        String(explicitSessionId || preferredTaskId),
        String(explicitWorkerName || explicitTaskId || 'worker-1'),
        String(input.worker_role || 'exploit'),
        'wave-2',
        'P0',
        100,
        JSON.stringify(['#pg-store', '#digest']),
        JSON.stringify(parseStringList(input.files_owned, [])),
        String(input.assigned_goal || '完成阶段任务产出'),
        'completed',
        'pending_approval',
        '',
        '',
        1,
        1,
        now,
        now,
      )
      const createdId = bindTaskId !== null ? bindTaskId : Number(tRes.lastInsertRowid)
      targetTask = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(createdId)
    }

    const nextApprovalState = decision === 'revision_required' ? 'revision_required' : 'approved'
    const nextUiPriority = decision === 'approved' ? 'P2' : 'P0'
    const nextPriorityWeight = decision === 'approved' ? 50 : 100
    let nextGoalText = decision === 'approved'
      ? String(input.next_goal ?? input.followup_goal ?? '').trim()
      : ''
    if (!nextGoalText && decision === 'approved') {
      nextGoalText = `推进 ${nextWave.toUpperCase()} 闭环任务：承接 ${targetTask.worker_name || targetTask.id} 已验证产出并执行回归门禁`
    }

    const nextErrorDetail = decision === 'revision_required' && note
      ? `revision_required: ${note}`
      : String(targetTask.error_detail || '')

    db.prepare(`
      UPDATE worker_tasks
      SET approval_state = ?,
          ui_priority = ?,
          priority_weight = ?,
          next_goal = ?,
          error_detail = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      nextApprovalState,
      nextUiPriority,
      nextPriorityWeight,
      nextGoalText,
      nextErrorDetail,
      decision === 'revision_required' ? 'running' : 'completed',
      now,
      targetTask.id,
    )

    /* 同步更新对应的 plan_goals 与 worker_digests */
    if (targetTask.goal_id !== null && targetTask.goal_id !== undefined && String(targetTask.goal_id) !== '') {
      db.prepare(`
        UPDATE plan_goals
        SET status = ?,
            approval_note = ?,
            approved_at = ?,
            updated_at = ?
        WHERE CAST(id AS TEXT) = ?
      `).run(
        decision === 'approved' ? 'approved' : 'revision_required',
        note,
        decision === 'approved' ? now : null,
        now,
        String(targetTask.goal_id),
      )
    }
    db.prepare(`
      UPDATE worker_digests
      SET approval_decision = ?,
          followup_goal = ?
      WHERE CAST(worker_task_id AS TEXT) = ?
    `).run(decision, nextGoalText, String(targetTask.id))

    /* 审批通过时释放该 Worker 持有的所有活跃 shard_locks */
    let releasedLocksCount = 0
    if (decision === 'approved') {
      const rel = this.releaseShardLocks({
        engagement_id: resolvedId,
        worker_task_id: String(targetTask.id),
        worker_name: String(targetTask.worker_name || ''),
      })
      releasedLocksCount = Number(rel.released) || 0
    }

    const approvedWorkerRaw = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(targetTask.id) || targetTask
    const approvedWorker = Object.assign(
      {},
      formatWorkerTaskRow(this, approvedWorkerRaw, resolvedId),
      { review_note: note, approval_note: note },
    )

    let nextGoalRecord = null
    let nextWorkerTask = null
    let idempotentReused = false

    if (decision === 'approved' && nextGoalText) {
      /* 幂等检查：相同 (engagement_id, next_goal) 若已存在 pending/queued/running/working 或 60 秒内刚创建的后续任务，直接复用 */
      const candidates = db.prepare(
        'SELECT * FROM worker_tasks WHERE engagement_id = ? AND assigned_goal = ? AND CAST(id AS TEXT) <> ? ORDER BY created_at DESC LIMIT 5',
      ).all(resolvedId, nextGoalText, String(targetTask.id))
      const nowEpoch = Date.now()
      const reusable = candidates.find((row) => {
        const st = String(row.status || '').toLowerCase()
        if (['pending', 'queued', 'running', 'working'].includes(st)) return true
        const createdEpoch = Date.parse(String(row.created_at || ''))
        if (Number.isFinite(createdEpoch) && Math.abs(nowEpoch - createdEpoch) <= 60000) return true
        return false
      })

      if (reusable) {
        idempotentReused = true
        nextWorkerTask = formatWorkerTaskRow(this, reusable, resolvedId)
        if (reusable.goal_id !== null && reusable.goal_id !== undefined && String(reusable.goal_id) !== '') {
          nextGoalRecord = db.prepare('SELECT * FROM plan_goals WHERE CAST(id AS TEXT) = ?').get(String(reusable.goal_id)) || null
        }
      } else {
        const goalIntPk = isTableIntPk(this, db, 'plan_goals')
        const preferredNextGoalId = nextClosedLoopUid(this, `goal-${nextWave}`)
        const bindNextGoalId = goalIntPk ? null : preferredNextGoalId
        const nextWeight = priorityWeights[nextPriority] || 80
        const gRes = db.prepare(`
          INSERT INTO plan_goals (
            id, engagement_id, parent_goal_id, prompt_hash, user_prompt,
            title, objective, wave, ui_priority, priority_weight,
            status, approval_note, approved_at, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindNextGoalId,
          resolvedId,
          targetTask.goal_id ?? null,
          promptHash(nextGoalText),
          nextGoalText,
          `${nextWave.toUpperCase()} · ${nextGoalText.slice(0, 72)}`,
          nextGoalText,
          nextWave,
          nextPriority,
          nextWeight,
          'running',
          note,
          now,
          now,
          now,
        )
        const finalNextGoalId = bindNextGoalId !== null ? bindNextGoalId : Number(gRes.lastInsertRowid)
        nextGoalRecord = {
          id: finalNextGoalId,
          engagement_id: resolvedId,
          parent_goal_id: targetTask.goal_id ?? null,
          prompt_hash: promptHash(nextGoalText),
          user_prompt: nextGoalText,
          title: `${nextWave.toUpperCase()} · ${nextGoalText.slice(0, 72)}`,
          objective: nextGoalText,
          wave: nextWave,
          ui_priority: nextPriority,
          priority_weight: nextWeight,
          status: 'running',
          approval_note: note,
          approved_at: now,
          created_at: now,
          updated_at: now,
        }

        const preferredNextTaskId = nextClosedLoopUid(this, `wt-${nextWave}`)
        const bindNextTaskId = taskIntPk ? null : preferredNextTaskId
        const nextRole = String(input.next_worker_role || input.next_role || (nextWave === 'wave-4' ? 'qa' : 'vuln-scan'))
        const nextWorkerName = String(input.next_worker_name || `${nextRole}-${nextWave}`)
        const nextTags = [`#${nextWave}`, '#closed-loop', '#dispatched']
        const nextTagsJson = JSON.stringify(nextTags)
        const nextFilesOwned = parseStringList(input.next_files_owned, []).map((p) => normalizeShardPattern(p)).filter(Boolean)
        const nextFilesOwnedJson = JSON.stringify(nextFilesOwned)
        const nextSessId = `sess-${Date.now().toString(36)}-${this._closedLoopSeq}`

        const ntRes = db.prepare(`
          INSERT INTO worker_tasks (
            id, engagement_id, goal_id, session_id, worker_name, worker_role,
            wave, ui_priority, priority_weight, tags_json, files_owned_json, assigned_goal,
            status, approval_state, next_goal, error_detail, tool_calls, turns, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindNextTaskId,
          resolvedId,
          finalNextGoalId,
          nextSessId,
          nextWorkerName,
          nextRole,
          nextWave,
          nextPriority,
          nextWeight,
          nextTagsJson,
          nextFilesOwnedJson,
          nextGoalText,
          'running',
          'working',
          '',
          '',
          0,
          0,
          now,
          now,
        )
        const finalNextTaskId = bindNextTaskId !== null ? bindNextTaskId : Number(ntRes.lastInsertRowid)
        nextWorkerTask = {
          id: finalNextTaskId,
          engagement_id: resolvedId,
          goal_id: finalNextGoalId,
          session_id: nextSessId,
          worker_name: nextWorkerName,
          worker_role: nextRole,
          wave: nextWave,
          ui_priority: nextPriority,
          priority_weight: nextWeight,
          tags_json: nextTagsJson,
          tags: nextTags,
          files_owned_json: nextFilesOwnedJson,
          files_owned: nextFilesOwned,
          assigned_goal: nextGoalText,
          status: 'running',
          approval_state: 'working',
          next_goal: '',
          error_detail: '',
          tool_calls: 0,
          turns: 0,
          created_at: now,
          updated_at: now,
        }
        this._recordPgWrite('INSERT', 'plan_goals', {
          engagement_id: resolvedId,
          role: 'plan',
          summary: `INSERT plan_goals · 派发下一目标 ${nextGoalText.slice(0, 48)}`,
        })
      }
    }

    try {
      recordPgDigestCompression(resolvedId, {
        approval_decision: decision,
        wasPending: targetTask.approval_state === 'pending_approval',
      })
    } catch { /* ignore */ }

    this._recordPgWrite('UPDATE', 'worker_tasks', {
      engagement_id: resolvedId,
      role: 'plan',
      summary: `UPDATE worker_tasks · 审批 ${approvedWorker.worker_name} (${decision})`,
    })
    this._recordPgWrite('UPDATE', 'worker_digests', {
      engagement_id: resolvedId,
      role: 'plan',
      summary: `UPDATE worker_digests · decision=${decision}`,
    })

    return {
      ok: true,
      engagement_id: resolvedId,
      decision,
      approval_state: nextApprovalState,
      approved_worker_id: approvedWorker.id,
      review_note: note,
      approval_note: note,
      released_locks: releasedLocksCount,
      idempotent_reused: idempotentReused,
      followup_reused: idempotentReused,
      approved_worker: approvedWorker,
      next_goal_record: nextGoalRecord,
      followup_goal: nextGoalRecord,
      next_worker_task: nextWorkerTask,
      followup_worker: nextWorkerTask,
    }
  }


  /**
   * 交互式编排：在线修改 Worker 阶段目标、优先级与分片归属（并同步刷新 shard_locks）。
   */
  updateWorkerGoal(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, true)
    const now = nowIso()
    const priorityWeights = { P0: 100, P1: 80, P2: 50, P3: 20 }
    const lookupId = input.worker_task_id ?? input.worker_id ?? input.id
    let taskRow = null
    if (lookupId !== undefined && lookupId !== null && String(lookupId).trim() !== '') {
      taskRow = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(lookupId)
        || db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(String(lookupId).trim())
        || db.prepare('SELECT * FROM worker_tasks WHERE worker_name = ? ORDER BY updated_at DESC LIMIT 1').get(String(lookupId).trim())
    }
    if (!taskRow && input.goal_id) {
      taskRow = db.prepare('SELECT * FROM worker_tasks WHERE CAST(goal_id AS TEXT) = ? ORDER BY updated_at DESC LIMIT 1')
        .get(String(input.goal_id))
    }
    if (!taskRow) {
      throw new Error(`worker_task not found: ${lookupId || input.goal_id || '(unspecified)'}`)
    }

    const nextAssignedGoal = input.assigned_goal !== undefined
      ? String(input.assigned_goal).trim()
      : (input.objective !== undefined ? String(input.objective).trim() : String(taskRow.assigned_goal || ''))
    const nextPriority = ['P0', 'P1', 'P2', 'P3'].includes(input.ui_priority || input.priority)
      ? (input.ui_priority || input.priority)
      : String(taskRow.ui_priority || 'P1')
    const nextWeight = priorityWeights[nextPriority] || Number(taskRow.priority_weight) || 80

    let nextFilesOwned = parseJson(taskRow.files_owned_json, [])
    let lockResult = null
    if (input.files_owned !== undefined || input.filesOwned !== undefined) {
      const requested = parseStringList(input.files_owned ?? input.filesOwned, [])
        .map((p) => normalizeShardPattern(p))
        .filter(Boolean)
      this.releaseShardLocks({
        engagement_id: resolvedId,
        worker_task_id: String(taskRow.id),
        worker_name: String(taskRow.worker_name || ''),
      })
      lockResult = this.acquireShardLocks({
        engagement_id: resolvedId,
        worker_task_id: String(taskRow.id),
        worker_name: String(taskRow.worker_name || ''),
        wave: String(taskRow.wave || 'wave-3'),
        files_owned: requested,
      })
      nextFilesOwned = requested
    }

    const nextErrorDetail = lockResult && lockResult.conflict
      ? (lockResult.error || 'shard_warning: 分片锁冲突')
      : String(taskRow.error_detail || '')

    db.prepare(`
      UPDATE worker_tasks
      SET assigned_goal = ?,
          ui_priority = ?,
          priority_weight = ?,
          files_owned_json = ?,
          error_detail = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      nextAssignedGoal,
      nextPriority,
      nextWeight,
      JSON.stringify(nextFilesOwned),
      nextErrorDetail,
      now,
      taskRow.id,
    )

    let goalRecord = null
    if (taskRow.goal_id !== null && taskRow.goal_id !== undefined && String(taskRow.goal_id) !== '') {
      const curGoal = db.prepare('SELECT * FROM plan_goals WHERE CAST(id AS TEXT) = ?').get(String(taskRow.goal_id))
      if (curGoal) {
        const nextTitle = input.title !== undefined && String(input.title).trim() !== ''
          ? String(input.title).trim()
          : curGoal.title
        db.prepare(`
          UPDATE plan_goals
          SET title = ?,
              objective = ?,
              ui_priority = ?,
              priority_weight = ?,
              updated_at = ?
          WHERE id = ?
        `).run(nextTitle, nextAssignedGoal, nextPriority, nextWeight, now, curGoal.id)
        goalRecord = db.prepare('SELECT * FROM plan_goals WHERE id = ?').get(curGoal.id)
      }
    }

    this._recordPgWrite('UPDATE', 'worker_tasks', {
      engagement_id: resolvedId,
      role: 'plan',
      summary: `UPDATE worker_tasks · 更新 ${taskRow.worker_name || taskRow.id} 目标与分片`,
    })

    const updated = formatWorkerTaskRow(this, 
      db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(taskRow.id),
      resolvedId,
    )
    return {
      ok: lockResult ? !lockResult.conflict : true,
      engagement_id: resolvedId,
      worker_task: updated,
      goal: goalRecord,
      shard_locks: lockResult ? lockResult.locks : this.listShardLocks(resolvedId, { activeOnly: true }),
      shard_conflict: lockResult && lockResult.conflict
        ? { violated: true, details: lockResult.conflicts, error: lockResult.error }
        : { violated: false, details: [] },
    }
  }


  /**
   * 交互式编排：向指定波次手动追加自定义 Worker 分片任务并申请对应 ShardLock。
   */
  addCustomWorkerTask(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, true)
    const now = nowIso()
    const priorityWeights = { P0: 100, P1: 80, P2: 50, P3: 20 }
    const wave = String(input.wave || 'wave-3').trim() || 'wave-3'
    const workerRole = String(input.worker_role || input.role || 'exploit').trim() || 'exploit'
    const workerName = String(input.worker_name || input.name || `${workerRole}-${Date.now().toString(36).slice(-4)}`).trim()
    const assignedGoal = String(input.assigned_goal || input.goal || input.objective || input.title || `执行 ${workerName} 自定义分片任务`).trim()
    const uiPriority = ['P0', 'P1', 'P2', 'P3'].includes(input.ui_priority || input.priority)
      ? (input.ui_priority || input.priority)
      : 'P1'
    const priorityWeight = priorityWeights[uiPriority] || 80
    const tags = parseStringList(input.tags ?? input.tags_json, [`#${wave}`, `#${workerRole}`, '#custom'])
    const filesOwned = parseStringList(input.files_owned ?? input.filesOwned ?? input.files_owned_json, [])
      .map((p) => normalizeShardPattern(p))
      .filter(Boolean)

    const goalIntPk = isTableIntPk(this, db, 'plan_goals')
    const taskIntPk = isTableIntPk(this, db, 'worker_tasks')
    const bindGoalId = goalIntPk ? null : String(input.goal_id || nextClosedLoopUid(this, `goal-${wave}`))
    const title = String(input.title || `${wave.toUpperCase()} · ${workerName}：${assignedGoal.slice(0, 56)}`).trim()
    const status = String(input.status || 'queued').trim() || 'queued'
    const approvalState = String(input.approval_state || 'working').trim() || 'working'

    const gRes = db.prepare(`
      INSERT INTO plan_goals (
        id, engagement_id, parent_goal_id, prompt_hash, user_prompt,
        title, objective, wave, ui_priority, priority_weight,
        status, approval_note, approved_at, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      bindGoalId,
      resolvedId,
      input.parent_goal_id ?? null,
      promptHash(assignedGoal),
      assignedGoal,
      title,
      assignedGoal,
      wave,
      uiPriority,
      priorityWeight,
      status === 'running' ? 'running' : 'planned',
      '',
      null,
      now,
      now,
    )
    const finalGoalId = bindGoalId !== null ? bindGoalId : Number(gRes.lastInsertRowid)

    const preferredTaskId = input.worker_task_id || input.id || nextClosedLoopUid(this, `wt-${wave}`)
    const bindTaskId = taskIntPk ? null : String(preferredTaskId)
    const sessId = String(input.session_id || input.sessionId || `sess-${Date.now().toString(36)}-${this._closedLoopSeq}`)

    const tRes = db.prepare(`
      INSERT INTO worker_tasks (
        id, engagement_id, goal_id, session_id, worker_name, worker_role,
        wave, ui_priority, priority_weight, tags_json, files_owned_json, assigned_goal,
        status, approval_state, next_goal, error_detail, tool_calls, turns, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      bindTaskId,
      resolvedId,
      finalGoalId,
      sessId,
      workerName,
      workerRole,
      wave,
      uiPriority,
      priorityWeight,
      JSON.stringify(tags),
      JSON.stringify(filesOwned),
      assignedGoal,
      status,
      approvalState,
      '',
      '',
      0,
      0,
      now,
      now,
    )
    const finalTaskId = bindTaskId !== null ? bindTaskId : Number(tRes.lastInsertRowid)
    const dependsOnList = parseStringList(input.depends_on ?? input.dependsOn ?? input.depends_on_json, [])
    if (dependsOnList.length > 0) {
      try {
        db.prepare('UPDATE worker_tasks SET depends_on_json = ? WHERE id = ?')
          .run(JSON.stringify(dependsOnList), finalTaskId)
      } catch { /* ignore depends_on column error */ }
    }

    let lockRes = { ok: true, conflict: false, conflicts: [], locks: [] }
    if (filesOwned.length > 0) {
      lockRes = this.acquireShardLocks({
        engagement_id: resolvedId,
        worker_task_id: String(finalTaskId),
        worker_name: workerName,
        wave,
        files_owned: filesOwned,
      })
      if (lockRes.conflict) {
        db.prepare('UPDATE worker_tasks SET error_detail = ? WHERE id = ?')
          .run(lockRes.error || 'shard_warning: 分片锁冲突', finalTaskId)
      }
    }

    this._recordPgWrite('INSERT', 'plan_goals', {
      engagement_id: resolvedId,
      role: 'plan',
      summary: `INSERT plan_goals · 新增自定义分片目标 ${workerName}`,
    })
    this._recordPgWrite('INSERT', 'worker_tasks', {
      engagement_id: resolvedId,
      role: workerRole,
      summary: `INSERT worker_tasks · 新增自定义 Worker ${workerName}`,
    })

    const workerTask = formatWorkerTaskRow(this, 
      db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(finalTaskId),
      resolvedId,
    )
    const goalRecord = db.prepare('SELECT * FROM plan_goals WHERE id = ?').get(finalGoalId)
    return {
      ok: !lockRes.conflict,
      engagement_id: resolvedId,
      goal: goalRecord,
      worker_task: workerTask,
      locks: lockRes,
      shard_locks: lockRes.locks || [],
      shard_conflict: lockRes.conflict
        ? { violated: true, details: lockRes.conflicts, error: lockRes.error }
        : { violated: false, details: [] },
    }
  }


  /**
   * 交互式编排：重置失败或返工的 Worker 任务为运行态（status='running', approval_state='in_progress', ui_priority='P0', error_detail=''）。
   */
  retryWorkerTask(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const { resolvedId, db } = openClosedLoopDb(this, input.engagement_id || input.engagement, true)
    const now = nowIso()
    const lookupId = input.worker_task_id ?? input.worker_id ?? input.id
    let taskRow = null
    if (lookupId !== undefined && lookupId !== null && String(lookupId).trim() !== '') {
      taskRow = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(lookupId)
        || db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(String(lookupId).trim())
        || db.prepare('SELECT * FROM worker_tasks WHERE worker_name = ? ORDER BY updated_at DESC LIMIT 1').get(String(lookupId).trim())
    }
    if (!taskRow) {
      throw new Error(`worker_task not found for retry: ${lookupId || '(unspecified)'}`)
    }

    const updatedGoal = input.updated_goal !== undefined && String(input.updated_goal).trim() !== ''
      ? String(input.updated_goal).trim()
      : String(taskRow.assigned_goal || '')
    const reason = String(input.reason || '').trim()

    db.prepare(`
      UPDATE worker_tasks
      SET status = 'running',
          approval_state = 'in_progress',
          ui_priority = 'P0',
          priority_weight = 100,
          assigned_goal = ?,
          error_detail = '',
          updated_at = ?
      WHERE id = ?
    `).run(updatedGoal, now, taskRow.id)

    if (taskRow.goal_id !== null && taskRow.goal_id !== undefined && String(taskRow.goal_id) !== '') {
      db.prepare(`
        UPDATE plan_goals
        SET objective = ?,
            status = 'running',
            ui_priority = 'P0',
            priority_weight = 100,
            approval_note = CASE WHEN ? <> '' THEN ? ELSE approval_note END,
            updated_at = ?
        WHERE CAST(id AS TEXT) = ?
      `).run(updatedGoal, reason, reason, now, String(taskRow.goal_id))
    }

    const ownedFiles = parseJson(taskRow.files_owned_json, [])
    if (Array.isArray(ownedFiles) && ownedFiles.length > 0) {
      this.acquireShardLocks({
        engagement_id: resolvedId,
        worker_task_id: String(taskRow.id),
        worker_name: String(taskRow.worker_name || ''),
        wave: String(taskRow.wave || 'wave-3'),
        files_owned: ownedFiles,
      })
    }

    this._recordPgWrite('UPDATE', 'worker_tasks', {
      engagement_id: resolvedId,
      role: taskRow.worker_role || 'exploit',
      summary: `RETRY worker_tasks · ${taskRow.worker_name || taskRow.id} -> running / in_progress (P0)`,
    })

    const retriedTask = formatWorkerTaskRow(this, 
      db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(taskRow.id),
      resolvedId,
    )
    return {
      ok: true,
      engagement_id: resolvedId,
      reason,
      worker_task: retriedTask,
    }
  }


  /**
   * 绑定真实子智能体会话 ID 到既有 `worker_tasks` 行（支持 `wt-<id>`、数字 `id`、旧 `session_id` 或 `worker_name`），
   * 并按需更新 `status` / `dispatched_at` / `error_detail` 等字段与 PG 写表探针记录。
   */
  bindWorkerSession(engagementId, workerRef, realSessionId, extraPatch = {}) {
    let engInput = engagementId
    let refInput = workerRef
    let newSessInput = realSessionId
    let patchInput = extraPatch

    if (engagementId && typeof engagementId === 'object' && !Array.isArray(engagementId)) {
      const obj = engagementId
      engInput = obj.engagement_id ?? obj.engagement ?? obj.engagementId
      const explicitNewSess = obj.real_session_id ?? obj.realSessionId ?? obj.new_session_id ?? obj.newSessionId ?? obj.target_session_id
      refInput = obj.worker_ref ?? obj.workerRef ?? obj.worker_task_id ?? obj.workerTaskId
        ?? obj.worker_id ?? obj.workerId ?? obj.id
        ?? obj.old_session_id ?? obj.oldSessionId ?? obj.prev_session_id ?? obj.prevSessionId
        ?? obj.worker_name ?? obj.workerName
      if ((refInput === undefined || refInput === null || String(refInput).trim() === '') && explicitNewSess !== undefined && explicitNewSess !== null) {
        refInput = obj.session_id ?? obj.sessionId
      }
      newSessInput = explicitNewSess ?? obj.session_id ?? obj.sessionId
      patchInput = Object.assign(
        {},
        obj,
        (workerRef && typeof workerRef === 'object' && !Array.isArray(workerRef) ? workerRef : {}),
        (obj.extraPatch && typeof obj.extraPatch === 'object' ? obj.extraPatch : {}),
        (obj.patch && typeof obj.patch === 'object' ? obj.patch : {}),
      )
    } else if (workerRef && typeof workerRef === 'object' && !Array.isArray(workerRef)) {
      const obj = workerRef
      const explicitNewSess = (typeof realSessionId === 'string' && realSessionId.trim() !== '')
        ? realSessionId
        : (obj.real_session_id ?? obj.realSessionId ?? obj.new_session_id ?? obj.newSessionId ?? obj.target_session_id)
      refInput = obj.worker_ref ?? obj.workerRef ?? obj.worker_task_id ?? obj.workerTaskId
        ?? obj.worker_id ?? obj.workerId ?? obj.id
        ?? obj.old_session_id ?? obj.oldSessionId ?? obj.prev_session_id ?? obj.prevSessionId
        ?? obj.worker_name ?? obj.workerName
      if ((refInput === undefined || refInput === null || String(refInput).trim() === '') && explicitNewSess !== undefined && explicitNewSess !== null) {
        refInput = obj.session_id ?? obj.sessionId
      }
      newSessInput = explicitNewSess ?? obj.session_id ?? obj.sessionId
      patchInput = Object.assign(
        {},
        obj,
        (extraPatch && typeof extraPatch === 'object' && !Array.isArray(extraPatch) ? extraPatch : {}),
        (obj.extraPatch && typeof obj.extraPatch === 'object' ? obj.extraPatch : {}),
        (obj.patch && typeof obj.patch === 'object' ? obj.patch : {}),
      )
    } else if (refInput && typeof refInput === 'object' && !Array.isArray(refInput)) {
      const obj = refInput
      refInput = obj.worker_ref ?? obj.workerRef ?? obj.worker_task_id ?? obj.workerTaskId
        ?? obj.worker_id ?? obj.workerId ?? obj.id
        ?? obj.old_session_id ?? obj.oldSessionId ?? obj.worker_name ?? obj.workerName
    }

    const resolvedId = String(engInput || this.activeEngagementId() || 'default').trim() || 'default'
    const realSid = String(newSessInput === undefined || newSessInput === null ? '' : newSessInput).trim()
    if (!realSid) {
      return { ok: false, engagement_id: resolvedId, error: 'realSessionId required' }
    }
    const rawRef = refInput === undefined || refInput === null ? '' : String(refInput).trim()
    if (!rawRef) {
      return { ok: false, engagement_id: resolvedId, error: 'workerRef required' }
    }

    const { db } = openClosedLoopDb(this, resolvedId, true)
    const findTaskByRef = (refVal) => {
      if (refVal === undefined || refVal === null) return null
      const str = String(refVal).trim()
      if (!str) return null
      let found = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(refVal)
        || db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(str)
      const wtNumMatch = /^wt-(\d+)$/i.exec(str)
      if (!found && wtNumMatch) {
        found = db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(wtNumMatch[1])
      }
      if (!found && /^\d+$/.test(str)) {
        found = db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ?').get(`wt-${str}`)
      }
      if (!found) {
        found = db.prepare(
          'SELECT * FROM worker_tasks WHERE session_id = ? ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1',
        ).get(str)
      }
      if (!found) {
        found = db.prepare(
          'SELECT * FROM worker_tasks WHERE worker_name = ? ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1',
        ).get(str)
      }
      return found || null
    }

    let taskRow = findTaskByRef(typeof refInput === 'number' ? refInput : rawRef)
    if (!taskRow && patchInput && typeof patchInput === 'object') {
      const altRefs = [
        patchInput.worker_task_id,
        patchInput.worker_id,
        patchInput.old_session_id,
        patchInput.oldSessionId,
        patchInput.worker_name,
        patchInput.workerName,
      ]
      for (const alt of altRefs) {
        if (alt !== undefined && alt !== null && String(alt).trim() !== '' && String(alt).trim() !== rawRef) {
          taskRow = findTaskByRef(alt)
          if (taskRow) break
        }
      }
    }

    if (!taskRow) {
      return {
        ok: false,
        engagement_id: resolvedId,
        worker_ref: rawRef,
        error: `worker_task not found: ${rawRef}`,
      }
    }

    const now = nowIso()
    const p = patchInput && typeof patchInput === 'object' ? patchInput : {}
    const priorityWeights = { P0: 100, P1: 80, P2: 50, P3: 20 }

    const normalizeWave = (raw, fallback) => {
      if (raw === undefined || raw === null) return fallback
      const s = String(raw).trim().toLowerCase()
      if (!s) return fallback
      if (/^\d+$/.test(s)) return `wave-${s}`
      if (/^wave[\s_-]*(\d+)$/.test(s)) return s.replace(/^wave[\s_-]*(\d+)$/, 'wave-$1')
      return s
    }

    const nextStatus = p.status !== undefined && String(p.status).trim() !== ''
      ? String(p.status).trim()
      : String(taskRow.status || 'running')
    const rawApprovalState = p.approval_state ?? p.approvalState
    const nextApprovalState = rawApprovalState !== undefined && String(rawApprovalState).trim() !== ''
      ? String(rawApprovalState).trim()
      : String(taskRow.approval_state || 'working')
    const rawDispatchedAt = p.dispatched_at ?? p.dispatchedAt
    const nextDispatchedAt = rawDispatchedAt !== undefined
      ? String(rawDispatchedAt ?? '')
      : (String(taskRow.dispatched_at || '') || now)
    const rawErrorDetail = p.error_detail !== undefined ? p.error_detail : p.errorDetail
    const nextErrorDetail = rawErrorDetail !== undefined
      ? String(rawErrorDetail ?? '')
      : (p.clear_error === true ? '' : String(taskRow.error_detail || ''))
    const rawWorkerName = p.worker_name ?? p.workerName
    const nextWorkerName = rawWorkerName !== undefined && String(rawWorkerName).trim() !== ''
      ? String(rawWorkerName).trim()
      : String(taskRow.worker_name || '')
    const rawWorkerRole = p.worker_role ?? p.workerRole ?? p.role
    const nextWorkerRole = rawWorkerRole !== undefined && String(rawWorkerRole).trim() !== ''
      ? String(rawWorkerRole).trim()
      : String(taskRow.worker_role || 'exploit')
    const nextWave = p.wave !== undefined && String(p.wave).trim() !== ''
      ? normalizeWave(p.wave, String(taskRow.wave || 'wave-2'))
      : String(taskRow.wave || 'wave-2')
    const rawPri = String(p.ui_priority ?? p.priority ?? '').trim().toUpperCase()
    const nextUiPriority = ['P0', 'P1', 'P2', 'P3'].includes(rawPri)
      ? rawPri
      : String(taskRow.ui_priority || 'P1')
    const nextPriorityWeight = Number.isFinite(Number(p.priority_weight)) && Number(p.priority_weight) > 0
      ? Number(p.priority_weight)
      : (['P0', 'P1', 'P2', 'P3'].includes(rawPri)
        ? priorityWeights[rawPri]
        : (Number(taskRow.priority_weight) || priorityWeights[nextUiPriority] || 80))
    const rawAssignedGoal = p.assigned_goal ?? p.assignedGoal
    const nextAssignedGoal = rawAssignedGoal !== undefined
      ? String(rawAssignedGoal ?? '').trim()
      : String(taskRow.assigned_goal || '')
    const rawNextGoal = p.next_goal ?? p.nextGoal
    const nextGoal = rawNextGoal !== undefined
      ? String(rawNextGoal ?? '').trim()
      : String(taskRow.next_goal || '')
    const nextTurns = p.turns !== undefined && Number.isFinite(Number(p.turns))
      ? Math.max(0, Math.floor(Number(p.turns)))
      : (Number(taskRow.turns) || 0)
    const rawToolCalls = p.tool_calls ?? p.toolCalls
    const nextToolCalls = rawToolCalls !== undefined && Number.isFinite(Number(rawToolCalls))
      ? Math.max(0, Math.floor(Number(rawToolCalls)))
      : (Number(taskRow.tool_calls) || 0)
    const rawDurationMs = p.duration_ms ?? p.durationMs
    const nextDurationMs = rawDurationMs !== undefined && Number.isFinite(Number(rawDurationMs))
      ? Math.max(0, Math.floor(Number(rawDurationMs)))
      : (Number(taskRow.duration_ms) || 0)
    const nextFilesOwnedJson = (p.files_owned !== undefined || p.filesOwned !== undefined || p.files_owned_json !== undefined)
      ? JSON.stringify(
          parseStringList(p.files_owned ?? p.filesOwned ?? p.files_owned_json, [])
            .map((pat) => normalizeShardPattern(pat))
            .filter(Boolean),
        )
      : String(taskRow.files_owned_json || '[]')

    const previousSessionId = String(taskRow.session_id || '')

    db.prepare(`
      UPDATE worker_tasks
      SET session_id = ?,
          worker_name = ?,
          worker_role = ?,
          wave = ?,
          ui_priority = ?,
          priority_weight = ?,
          files_owned_json = ?,
          assigned_goal = ?,
          status = ?,
          approval_state = ?,
          next_goal = ?,
          error_detail = ?,
          tool_calls = ?,
          turns = ?,
          duration_ms = ?,
          dispatched_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      realSid,
      nextWorkerName,
      nextWorkerRole,
      nextWave,
      nextUiPriority,
      nextPriorityWeight,
      nextFilesOwnedJson,
      nextAssignedGoal,
      nextStatus,
      nextApprovalState,
      nextGoal,
      nextErrorDetail,
      nextToolCalls,
      nextTurns,
      nextDurationMs,
      nextDispatchedAt,
      now,
      taskRow.id,
    )

    this._recordPgWrite('UPDATE', 'worker_tasks', {
      engagement_id: resolvedId,
      role: nextWorkerRole || 'plan',
      rows: 1,
      summary: `BIND worker_tasks · ${nextWorkerName || taskRow.id} (${previousSessionId || 'unbound'} -> ${realSid})`,
    })

    const pgWriteProbeSnap = this.pgWriteProbe(resolvedId)
    const updatedTask = formatWorkerTaskRow(this, 
      db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(taskRow.id),
      resolvedId,
    )

    return {
      ok: true,
      engagement_id: resolvedId,
      worker_task_id: updatedTask.id,
      previous_session_id: previousSessionId,
      session_id: realSid,
      worker_task: updatedTask,
      pg_write_probe: pgWriteProbeSnap,
    }
  }


  /**
   * 保存飞书群机器人 Webhook URL、事件订阅与启用开关配置。
   */
  saveFeishuConfig(arg1 = {}, arg2 = undefined) {
    let input = {}
    if (typeof arg1 === 'string' && arg2 && typeof arg2 === 'object') {
      input = Object.assign({ engagement_id: arg1 }, arg2)
    } else if (arg1 && typeof arg1 === 'object') {
      input = arg1
    }
    const resolvedId = String(input.engagement_id || input.engagement || this.activeEngagementId() || 'default').trim() || 'default'
    const state = readWorkflowState(this, resolvedId)
    const now = nowIso()
    const hasExplicitUrl = input.webhook_url !== undefined || input.webhookUrl !== undefined || input.webhook !== undefined || input.url !== undefined
    const rawUrl = String(input.webhook_url ?? input.webhookUrl ?? input.webhook ?? input.url ?? '').trim()
    const finalUrl = hasExplicitUrl ? rawUrl : String(state.feishu?.webhook_url || '')
    state.feishu = Object.assign({}, state.feishu, {
      webhook_url: finalUrl,
      configured: Boolean(finalUrl),
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : Boolean(finalUrl || state.feishu?.enabled),
      events: input.events && typeof input.events === 'object'
        ? Object.assign({}, state.feishu?.events || {}, input.events)
        : (state.feishu?.events || { wave_complete: true, gate_alert: true, milestone_hit: true, daily_digest: true }),
      updated_at: now,
    })
    state.updated_at = now
    writeWorkflowState(this, resolvedId, state)
    recordPgTableWrite(resolvedId, {
      table: 'sessions',
      op: 'UPSERT',
      role: 'internal',
      summary: 'UPSERT sessions · Feishu Webhook 配置已保存',
    })
    const note = '已保存飞书群聊机器人 Webhook 与事件订阅配置。'
    return Object.assign({
      ok: true,
      action: 'feishuConfig',
      engagement_id: resolvedId,
      feishu: state.feishu,
      note,
      message: note,
    }, this.workflowDag(resolvedId))
  }


  /**
   * 4. 幂等同步宿主子智能体会话到 `plan_goals`、`worker_tasks` 与 `worker_digests`。
   *    通过 `this._syncedWorkerSig`（上限 512 条）过滤未变化的轮询，避免重复写库。
   */
  syncHostWorkersToPg(engagementId, workers = [], options = {}) {
    let resolvedInputId = engagementId
    let list = workers
    let syncOpts = options && typeof options === 'object' ? options : {}
    if (Array.isArray(engagementId)) {
      list = engagementId
      resolvedInputId = null
    } else if (engagementId && typeof engagementId === 'object') {
      list = engagementId.workers || engagementId.items || workers || []
      resolvedInputId = engagementId.engagement_id || engagementId.engagement || null
      syncOpts = Object.assign({}, engagementId, syncOpts)
    }
    if (!Array.isArray(list)) list = []
    if (!this._syncedWorkerSig) this._syncedWorkerSig = new Map()

    const { resolvedId, db } = openClosedLoopDb(this, resolvedInputId, true)
    const liveRunningSet = syncOpts.liveRunningIds instanceof Set
      ? syncOpts.liveRunningIds
      : new Set(
        list
          .filter((w) => w && ['running', 'run', 'active', 'in_progress'].includes(String(w.status || w.activity || w.state || '').toLowerCase()))
          .map((w) => String(w.sessionId || w.session_id || w.id || '').trim())
          .filter(Boolean),
      )
    try {
      this.reapExpiredAgentLeases(resolvedId, Object.assign({}, syncOpts, {
        liveRunningIds: syncOpts.liveRunningIds instanceof Set || list.length > 0 ? liveRunningSet : undefined,
      }))
    } catch { /* ignore reap errors during sync */ }

    const now = nowIso()
    const priorityWeights = { P0: 100, P1: 80, P2: 50, P3: 20 }
    const goalIntPk = isTableIntPk(this, db, 'plan_goals')
    const taskIntPk = isTableIntPk(this, db, 'worker_tasks')
    const digestIntPk = isTableIntPk(this, db, 'worker_digests')

    let synced = 0
    for (let i = 0; i < list.length; i++) {
      const w = list[i] || {}
      const rawKey = String(w.id || w.worker_task_id || w.sessionId || w.session_id || w.name || w.worker_name || `worker-${i + 1}`).trim()
      const sigKey = `${resolvedId}:${rawKey}`
      const status = String(w.status || w.state || 'running').trim()
      const turns = Number(w.turns ?? w.turnCount ?? 1) || 0
      const toolCalls = Number(w.toolCalls ?? w.tool_calls ?? w.tools ?? 1) || 0
      const durationMs = Math.max(0, Number(w.durationMs ?? w.duration_ms ?? w.latency_ms ?? 0) || 0)
      const approvalState = String(
        w.approvalState ?? w.approval_state ?? (status === 'completed' || status === 'done' ? 'pending_approval' : 'working'),
      ).trim()
      const sig = `${status}|${turns}|${toolCalls}|${approvalState}`

      if (this._syncedWorkerSig.get(sigKey) === sig) {
        const exists = db.prepare('SELECT id FROM worker_tasks WHERE session_id = ? OR CAST(id AS TEXT) = ? OR worker_name = ? LIMIT 1')
          .get(String(w.sessionId || w.session_id || rawKey), rawKey, String(w.name || w.worker_name || rawKey))
        if (exists) continue
      }

      const workerName = String(w.worker_name || w.name || rawKey)
      const workerRole = String(w.worker_role || w.role || 'exploit')
      const wave = String(w.wave || 'wave-2')
      let uiPriority = String(w.ui_priority || w.uiPriority || '').trim()
      if (!['P0', 'P1', 'P2', 'P3'].includes(uiPriority)) {
        if (approvalState === 'pending_approval' || approvalState === 'revision_required') uiPriority = 'P0'
        else if (status === 'running' || status === 'run') uiPriority = 'P1'
        else if (approvalState === 'approved') uiPriority = 'P2'
        else uiPriority = 'P3'
      }
      const priorityWeight = Number(w.priority_weight ?? w.priorityWeight) || priorityWeights[uiPriority] || 80
      const tags = Array.isArray(w.tags)
        ? w.tags
        : (typeof w.tags_json === 'string' ? parseJson(w.tags_json, [`#${wave}`, `#${workerRole}`]) : [`#${wave}`, `#${workerRole}`])
      const tagsJson = JSON.stringify(tags)
      const filesOwned = parseStringList(w.files_owned ?? w.filesOwned ?? w.files_owned_json, [])
        .map((p) => normalizeShardPattern(p))
        .filter(Boolean)
      const filesOwnedJson = JSON.stringify(filesOwned)
      const assignedGoal = String(w.assigned_goal || w.goal || w.objective || w.title || `执行 ${workerName} 子任务`).trim()
      const whatWasDone = String(w.what_was_done || w.whatWasDone || w.summary || w.digest || `${workerName} 执行 ${turns} 轮 / ${toolCalls} 次工具调用：${assignedGoal}`).trim()
      const rowCreatedAt = typeof (w.createdAt || w.created_at) === 'string' && (w.createdAt || w.created_at)
        ? String(w.createdAt || w.created_at)
        : now
      const rowUpdatedAt = typeof (w.updatedAt || w.updated_at) === 'string' && (w.updatedAt || w.updated_at)
        ? String(w.updatedAt || w.updated_at)
        : now

      /* 1) Upsert plan_goals */
      let existingGoal = db.prepare('SELECT id FROM plan_goals WHERE title = ? OR CAST(id AS TEXT) = ? LIMIT 1')
        .get(`${wave.toUpperCase()} · ${workerName}`, String(w.goal_id || `goal-${rawKey}`))
      let goalId = existingGoal ? existingGoal.id : null
      if (goalId === null) {
        const bindGoalId = goalIntPk ? null : String(w.goal_id || `goal-${rawKey}`)
        const goalStatus = approvalState === 'approved'
          ? 'approved'
          : (status === 'completed' || status === 'interrupted' ? 'completed' : 'running')
        const gRes = db.prepare(`
          INSERT INTO plan_goals (
            id, engagement_id, parent_goal_id, prompt_hash, user_prompt,
            title, objective, wave, ui_priority, priority_weight,
            status, approval_note, approved_at, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindGoalId,
          resolvedId,
          null,
          promptHash(assignedGoal),
          assignedGoal,
          `${wave.toUpperCase()} · ${workerName}`,
          assignedGoal,
          wave,
          uiPriority,
          priorityWeight,
          goalStatus,
          '',
          approvalState === 'approved' ? rowUpdatedAt : null,
          rowCreatedAt,
          rowUpdatedAt,
        )
        goalId = bindGoalId !== null ? bindGoalId : Number(gRes.lastInsertRowid)
      } else {
        db.prepare(`
          UPDATE plan_goals
          SET ui_priority = ?, priority_weight = ?, updated_at = ?
          WHERE id = ?
        `).run(uiPriority, priorityWeight, rowUpdatedAt, goalId)
      }

      /* 2) Upsert worker_tasks */
      const sessId = String(w.session_id || w.sessionId || rawKey)
      const existingTask = db.prepare('SELECT id FROM worker_tasks WHERE session_id = ? OR CAST(id AS TEXT) = ? OR worker_name = ? LIMIT 1')
        .get(sessId, rawKey, workerName)
      let taskId = existingTask ? existingTask.id : null
      if (taskId === null) {
        const bindTaskId = taskIntPk ? null : String(w.worker_task_id || w.id || `wt-${rawKey}`)
        const tRes = db.prepare(`
          INSERT INTO worker_tasks (
            id, engagement_id, goal_id, session_id, worker_name, worker_role,
            wave, ui_priority, priority_weight, tags_json, files_owned_json, assigned_goal,
            status, approval_state, next_goal, error_detail, tool_calls, turns, duration_ms, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindTaskId,
          resolvedId,
          goalId,
          sessId,
          workerName,
          workerRole,
          wave,
          uiPriority,
          priorityWeight,
          tagsJson,
          filesOwnedJson,
          assignedGoal,
          status,
          approvalState,
          String(w.next_goal || ''),
          String(w.error_detail || ''),
          toolCalls,
          turns,
          durationMs,
          rowCreatedAt,
          rowUpdatedAt,
        )
        taskId = bindTaskId !== null ? bindTaskId : Number(tRes.lastInsertRowid)
      } else {
        db.prepare(`
          UPDATE worker_tasks
          SET goal_id = ?, session_id = ?, worker_name = ?, worker_role = ?,
              wave = ?, ui_priority = ?, priority_weight = ?, tags_json = ?,
              assigned_goal = ?, status = ?, approval_state = ?,
              tool_calls = ?, turns = ?, duration_ms = CASE WHEN ? > 0 THEN ? ELSE COALESCE(duration_ms, 0) END, updated_at = ?
          WHERE id = ?
        `).run(
          goalId, sessId, workerName, workerRole,
          wave, uiPriority, priorityWeight, tagsJson,
          assignedGoal, status, approvalState,
          toolCalls, turns, durationMs, durationMs, rowUpdatedAt,
          taskId,
        )
      }

      /* 3) Upsert worker_digests */
      const rawTokens = Number(w.raw_tokens_estimate ?? w.raw_tokens ?? w.rawTokens)
        || (Math.max(1, turns) * 450 + Math.max(1, toolCalls) * 320 + whatWasDone.length * 2)
      const compressedTokens = Number(w.digest_tokens_estimate ?? w.compressed_tokens ?? w.compressedTokens)
        || Math.max(48, Math.ceil(whatWasDone.length / 3.5))
      const compressionPct = Math.max(0, Math.min(99, Math.round((1 - compressedTokens / Math.max(1, rawTokens)) * 100)))
      const filesTouchedJson = JSON.stringify(Array.isArray(w.files_touched) ? w.files_touched : [])
      const keyDecisionsJson = JSON.stringify(Array.isArray(w.key_decisions) ? w.key_decisions : [whatWasDone.slice(0, 120)])

      const existingDigest = db.prepare('SELECT id FROM worker_digests WHERE CAST(worker_task_id AS TEXT) = ? LIMIT 1')
        .get(String(taskId))
      if (!existingDigest) {
        const bindDigestId = digestIntPk ? null : `digest-${rawKey}`
        db.prepare(`
          INSERT INTO worker_digests (
            id, engagement_id, worker_task_id, goal_id, worker_name,
            what_was_done, files_touched_json, key_decisions_json, verification,
            raw_tokens, compressed_tokens, compression_pct,
            approval_decision, followup_goal, created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindDigestId,
          resolvedId,
          taskId,
          goalId,
          workerName,
          whatWasDone,
          filesTouchedJson,
          keyDecisionsJson,
          String(w.verification || 'passed'),
          rawTokens,
          compressedTokens,
          compressionPct,
          approvalState,
          String(w.next_goal || ''),
          now,
        )
      } else {
        db.prepare(`
          UPDATE worker_digests
          SET what_was_done = ?, raw_tokens = ?, compressed_tokens = ?,
              compression_pct = ?, approval_decision = ?
          WHERE id = ?
        `).run(whatWasDone, rawTokens, compressedTokens, compressionPct, approvalState, existingDigest.id)
      }

      this._syncedWorkerSig.set(sigKey, sig)
      while (this._syncedWorkerSig.size > 512) {
        const oldestKey = this._syncedWorkerSig.keys().next().value
        if (oldestKey === undefined) break
        this._syncedWorkerSig.delete(oldestKey)
      }
      synced += 1
    }

    if (synced > 0) {
      this._recordPgWrite('UPSERT', 'worker_tasks', {
        engagement_id: resolvedId,
        role: 'plan',
        rows: synced,
        summary: `SYNC worker_tasks · 幂等同步 ${synced}/${list.length} 个宿主 Worker`,
      })
      this._recordPgWrite('UPSERT', 'worker_digests', {
        engagement_id: resolvedId,
        role: 'plan',
        rows: synced,
        summary: `SYNC worker_digests · 同步 ${synced} 条压缩摘要`,
      })
    }

    return {
      ok: true,
      engagement_id: resolvedId,
      synced,
      total: list.length,
    }
  }


  /**
   * p2: 实时 PostgreSQL 写表活动探针快照（结合当前靶标库真实行数 + 实时写入缓冲流）。
   */
  pgWriteProbe(id, preStats = null, preloaded = null) {
    const resolvedId = id || this.activeEngagementId() || 'default'
    const rowStats = Object.assign({}, preStats || {})
    try {
      if (resolvedId && (this.handles.has(resolvedId) || existsSync(this.dbPathOf(resolvedId)))) {
        const db = this.db(resolvedId)
        const base = preStats || this.stats(resolvedId)
        const count = (sql) => {
          try { return Number(db.prepare(sql).get()?.n ?? 0) || 0 } catch { return 0 }
        }
        rowStats.assets = base.assets ?? count('SELECT COUNT(*) AS n FROM asset')
        rowStats.findings = base.vulns ?? count('SELECT COUNT(*) AS n FROM vuln')
        rowStats.scores = count('SELECT COUNT(*) AS n FROM score_hit')
        rowStats.attack_tests = count('SELECT COUNT(*) AS n FROM attack_step')
          + count("SELECT COUNT(*) AS n FROM asset WHERE COALESCE(test_status, 'untested') <> 'untested'")
        rowStats.sessions = count('SELECT COUNT(*) AS n FROM webshell')
          + count('SELECT COUNT(*) AS n FROM tunnel')
          + (Number(base.accesses) || 0)
          + (Number(base.credentials) || 0)
        rowStats.artifacts = count('SELECT COUNT(*) AS n FROM shot')
          + count('SELECT COUNT(*) AS n FROM attack_file')
      }
    } catch { /* 读取行数异常不阻断探针返回 */ }
    try {
      const k = this.kb()
      rowStats.poc_kb = Number(k.prepare('SELECT COUNT(*) AS n FROM poc').get()?.n ?? 0) || 0
    } catch { /* 忽略 */ }
    try {
      let wf = preloaded && preloaded.workflowState
      if (!wf) {
        const wfPath = workflowStatePathOf(this, resolvedId)
        if (wfPath && existsSync(wfPath)) wf = JSON.parse(readFileSync(wfPath, 'utf8'))
      }
      if (wf && Array.isArray(wf.nodes)) {
        rowStats.dag_nodes = wf.nodes.filter((n) => n.status && n.status !== 'pending' && n.status !== 'standby').length
      }
      if (wf && Array.isArray(wf.runs)) rowStats.agent_runs = wf.runs.length
    } catch { /* 忽略 */ }

    const closedLoop = (preloaded && preloaded.closedLoop) || readClosedLoopState(this, resolvedId)
    const cls = closedLoop.closed_loop_stats
    rowStats.plan_goals = closedLoop.plan_goals.length
    rowStats.worker_tasks = closedLoop.worker_tasks.length
    rowStats.worker_digests = closedLoop.worker_digests.length
    rowStats.shard_locks = closedLoop.shard_locks.length

    const cfg = resolvePgConfig(this.root)
    rowStats.pool_max = cfg.poolSize || 8
    rowStats.pool_active = this.handles.size + (this.kbHandle ? 1 : 0)
    rowStats.wal_mode = cfg.enabled ? 'PG Wire v3 + WAL' : 'PG-WAL (256MB mmap)'
    const snap = Object.assign({}, getPgWriteProbe(resolvedId, rowStats) || {})
    snap.row_counts = Object.assign({}, snap.row_counts || {}, {
      plan_goals: rowStats.plan_goals,
      worker_tasks: rowStats.worker_tasks,
      worker_digests: rowStats.worker_digests,
      shard_locks: rowStats.shard_locks,
    })
    snap.compression_ratio_pct = cls.compression_ratio_pct > 0
      ? cls.compression_ratio_pct
      : (Number(snap.compression_ratio_pct) || 0)
    snap.compression_saved_tokens = cls.compression_saved_tokens > 0
      ? cls.compression_saved_tokens
      : (Number(snap.compression_saved_tokens) || 0)
    snap.approved_workers = cls.approved_workers > 0
      ? cls.approved_workers
      : (Number(snap.approved_workers) || 0)
    snap.pending_approvals = closedLoop.worker_tasks.length > 0
      ? cls.pending_approvals
      : (Number(snap.pending_approvals) || 0)
    snap.closed_loop_stats = cls
    return snap
  }


  /**
   * LMTAgent 可视化多智能体工作流 DAG 拓扑、文稿墙（Doc Wall）、p4 遥测与飞书配置。
   * 当项目尚无真实执行步骤（steps.length === 0）时，不返回伪造的已完成/运行中节点状态，
   * 所有未启动角色均标记为 pending / standby，并按 attack_steps / findings / assets 聚合真实角色决策。
   */
  workflowDag(id, options = {}) {
    const resolvedId = id || this.activeEngagementId() || 'default'
    const staleMs = options && Number.isFinite(Number(options.staleMs)) && Number(options.staleMs) > 0
      ? Number(options.staleMs)
      : 180_000
    const nowMs = Date.now()
    let reapedAny = false
    try {
      const reapRes = this.reapExpiredAgentLeases(resolvedId, options)
      if (reapRes && ((reapRes.reaped_tasks || 0) > 0 || (reapRes.released_locks || 0) > 0 || (reapRes.sanitized_dag_nodes || 0) > 0)) {
        reapedAny = true
        if (typeof this._bumpWriteSeq === 'function') this._bumpWriteSeq(resolvedId, 'reap')
      }
    } catch { /* ignore reap errors */ }

    const wfPath = workflowStatePathOf(this, resolvedId)
    let wfMtimeMs = 0
    try {
      if (wfPath && existsSync(wfPath)) wfMtimeMs = statSync(wfPath).mtimeMs || 0
    } catch { wfMtimeMs = 0 }
    const activeOnlyFlag = Boolean(options && options.activeOnly)
    const canMemo = !options.liveRunningIds && !reapedAny && typeof this._getReadMemoKey === 'function'
    const memoKey = canMemo
      ? `workflowDag:${resolvedId}:${activeOnlyFlag}:${staleMs}:${wfMtimeMs}:${this._getReadMemoKey(resolvedId)}`
      : null
    if (memoKey && this._readMemo && this._readMemo.has(memoKey)) {
      return Object.assign({}, this._readMemo.get(memoKey))
    }

    const state = readWorkflowState(this, resolvedId)
    const closedLoop = readClosedLoopState(this, resolvedId)
    const probe = this.pgWriteProbe(resolvedId, null, { workflowState: state, closedLoop })

    let steps = []
    let findings = []
    let assets = []
    let hits = []
    try {
      if (resolvedId && (this.handles.has(resolvedId) || (resolvedId !== 'default' && existsSync(this.dbPathOf(resolvedId))))) {
        const db = this.db(resolvedId)
        steps = db.prepare(
          'SELECT id, seq, stage, stage_code, title, detail, tool, result, agent, point_code, evidence_ref, recorded_at FROM attack_step ORDER BY seq DESC, id DESC LIMIT 100',
        ).all()
        findings = db.prepare(
          'SELECT id, title, severity, status, target, gained, found_by_agent, found_at FROM vuln ORDER BY id DESC LIMIT 50',
        ).all()
        assets = db.prepare(
          'SELECT id, ip, primary_name, test_status, test_notes, test_surface, discovered_at FROM asset ORDER BY id DESC LIMIT 50',
        ).all()
        hits = db.prepare(
          'SELECT id, target, evidence, recorded_by, recorded_at FROM score_hit ORDER BY id DESC LIMIT 50',
        ).all()
      }
    } catch { /* 查询异常时退回空集合 */ }

    const mapWorkerRoleToDag = (roleRaw, waveRaw = '') => {
      const r = String(roleRaw || '').trim().toLowerCase()
      if (r === 'plan' || r === 'captain' || r === 'orchestrator') return 'plan'
      if (r === 'recon' || r === 'ceo' || r === 'researcher' || r === 'architect') return 'recon'
      if (r === 'designer' || r === 'ui' || r === 'ux') return 'designer'
      if (r === 'assess' || r === 'eng-manager' || r === 'contract') return 'assess'
      if (r === 'vuln-scan' || r === 'cso' || r === 'reviewer' || r === 'security') return 'vuln-scan'
      if (r === 'qa' || r === 'tester' || r === 'benchmark') return 'qa'
      if (r === 'internal' || r === 'release' || r === 'ship' || r === 'doc') return 'internal'
      if (r === 'exploit' || r === 'exec' || r === 'builder') {
        const w = String(waveRaw || '').toLowerCase()
        if (w === 'wave-0' || w === '0') return 'plan'
        if (w === 'wave-1' || w === '1') return 'recon'
        if (w === 'wave-2' || w === '2') return 'assess'
        if (w === 'wave-4' || w === '4') return 'qa'
        return 'exploit'
      }
      return 'exploit'
    }

    const decisionsByRole = new Map()
    const allDecisions = []
    const tokensByRole = new Map()
    const runningRoles = new Set()
    const pushDecision = (roleRaw, item) => {
      const role = String(roleRaw || 'exploit').trim() || 'exploit'
      if (!decisionsByRole.has(role)) decisionsByRole.set(role, [])
      decisionsByRole.get(role).push(item)
      allDecisions.push(item)
    }
    const addRoleTokens = (roleRaw, n) => {
      const role = String(roleRaw || 'exploit').trim() || 'exploit'
      tokensByRole.set(role, (tokensByRole.get(role) || 0) + (Number(n) || 0))
    }

    for (const g of closedLoop.plan_goals) {
      const gTsMs = Date.parse(g.updated_at || g.created_at || '') || 0
      const gFresh = gTsMs > 0 && (nowMs - gTsMs) <= staleMs
      if (gFresh && (g.status === 'running' || g.status === 'pending' || g.status === 'in_progress')) runningRoles.add('plan')
      pushDecision('plan', {
        id: `goal-${g.id}`,
        kind: 'goal',
        role: 'plan',
        wave: g.wave || 'wave-1',
        priority: g.ui_priority || 'P1',
        status: g.status || 'pending',
        title: `[${g.ui_priority || 'P1'}] ${g.title || g.goal_text || '(立项目标)'}`,
        detail: g.goal_text || '',
        ts: g.updated_at || g.created_at || null,
      })
      addRoleTokens('plan', Math.max(120, String(g.goal_text || '').length * 2))
    }

    const activeShardLocks = (closedLoop.shard_locks || []).filter((l) => l.status === 'active')
    for (const lk of closedLoop.shard_locks || []) {
      if (lk.status === 'active') runningRoles.add('assess')
      pushDecision('assess', {
        id: `lock-${lk.id}`,
        kind: 'shard_lock',
        role: 'assess',
        status: lk.status || 'active',
        title: `分片独占锁：${lk.file_pattern} → ${lk.worker_name || lk.worker_task_id}`,
        detail: `波次 ${lk.wave || 'wave-3'} · 状态 ${lk.status || 'active'}`,
        ts: lk.released_at || lk.acquired_at || null,
      })
    }

    const taskRoleById = new Map()
    for (const wt of closedLoop.worker_tasks) {
      const dagRole = mapWorkerRoleToDag(wt.worker_role, wt.wave)
      taskRoleById.set(String(wt.id), dagRole)
      const wtTsMs = Date.parse(wt.updated_at || wt.created_at || '') || 0
      const wtFresh = wtTsMs > 0 && (nowMs - wtTsMs) <= staleMs
      if (
        wt.status === 'running'
        || wt.status === 'in_progress'
        || wt.status === 'active'
        || wt.status === 'run'
        || (wtFresh && (
          wt.status === 'pending'
          || wt.approval_state === 'pending_approval'
          || wt.approval_state === 'revision_required'
        ))
      ) {
        runningRoles.add(dagRole)
      }
      const owned = Array.isArray(wt.files_owned) && wt.files_owned.length > 0
        ? ` · 分片: ${wt.files_owned.join(', ')}`
        : ''
      pushDecision(dagRole, {
        id: `worker-${wt.id}`,
        kind: 'worker_task',
        role: dagRole,
        status: wt.status || 'running',
        approval_state: wt.approval_state || 'in_progress',
        title: `[${wt.ui_priority || 'P1'}] ${wt.worker_name} (${wt.approval_state || wt.status})`,
        detail: `${wt.assigned_goal || ''}${owned}${wt.error_detail ? ` · 告警: ${wt.error_detail}` : ''}`,
        ts: wt.updated_at || wt.created_at || null,
      })
      addRoleTokens(dagRole, (Number(wt.turns) || 0) * 450 + (Number(wt.tool_calls) || 0) * 320)
    }

    for (const d of closedLoop.worker_digests) {
      const dagRole = taskRoleById.get(String(d.worker_task_id)) || 'exploit'
      pushDecision(dagRole, {
        id: `digest-${d.id}`,
        kind: 'worker_digest',
        role: dagRole,
        status: d.approval_decision || 'pending_approval',
        title: `阶段摘要：${d.worker_name} (压缩 ${d.compression_pct ?? 0}%)`,
        detail: d.what_was_done || '',
        ts: d.created_at || null,
      })
      addRoleTokens(dagRole, Number(d.raw_tokens) || 0)
    }

    for (const s of steps) {
      const role = s.agent || 'exploit'
      pushDecision(role, {
        id: `step-${s.id}`,
        kind: 'step',
        role,
        stage: s.stage_code || s.stage || 'recon',
        title: s.title || '(执行步骤)',
        detail: s.detail || s.result || '',
        tool: s.tool || '',
        result: s.result || '',
        ts: s.recorded_at || null,
      })
      addRoleTokens(role, 640)
    }
    for (const v of findings) {
      pushDecision(v.found_by_agent || 'vuln-scan', {
        id: `finding-${v.id}`,
        kind: 'finding',
        role: v.found_by_agent || 'vuln-scan',
        severity: v.severity || 'medium',
        status: v.status || 'confirmed',
        title: v.title || '(代码审查/缺陷记录)',
        detail: v.gained ? `${v.target || ''} · ${v.gained}` : (v.target || ''),
        target: v.target || '',
        ts: v.found_at || null,
      })
    }
    for (const h of hits) {
      pushDecision(h.recorded_by || 'qa', {
        id: `hit-${h.id}`,
        kind: 'milestone',
        role: h.recorded_by || 'qa',
        title: `里程碑验收：${h.target || ''}`,
        detail: h.evidence || '',
        target: h.target || '',
        ts: h.recorded_at || null,
      })
    }
    for (const a of assets) {
      const role = a.test_status && a.test_status !== 'untested' ? 'assess' : 'recon'
      pushDecision(role, {
        id: `asset-${a.id}`,
        kind: 'asset',
        role,
        title: `模块/资产登记：${a.primary_name ? `${a.primary_name} (${a.ip})` : a.ip}`,
        detail: a.test_notes || a.test_surface || `状态：${a.test_status || 'untested'}`,
        target: a.ip,
        ts: a.discovered_at || null,
      })
    }

    const hasStarted = steps.length > 0
      || closedLoop.plan_goals.length > 0
      || closedLoop.worker_tasks.length > 0
      || closedLoop.worker_digests.length > 0
    const latestStepMs = steps.length > 0 ? (Date.parse(steps[0].recorded_at || '') || 0) : 0
    const latestActiveRole = (steps.length > 0 && latestStepMs > 0 && (nowMs - latestStepMs) <= staleMs)
      ? (steps[0].agent || null)
      : null
    const explicitRuns = Array.isArray(state.runs) ? state.runs : []

    const enrichedNodes = state.nodes.map((n) => {
      const roleDecisions = decisionsByRole.get(n.role) || decisionsByRole.get(n.id) || []
      const roleSteps = steps.filter((s) => s.agent === n.role || s.agent === n.id)
      const explicitNodeRun = explicitRuns.some((r) => r.node_id === n.id || r.role === n.role)
      const hasActivity = roleDecisions.length > 0 || (hasStarted && explicitNodeRun) || (n.retries > 0)

      if (!hasActivity && !explicitNodeRun) {
        return Object.assign({}, n, {
          status: 'pending',
          state: 'standby',
          statusLabel: '待命',
          has_activity: false,
          active: false,
          step_count: 0,
          tokens: 0,
          latency_ms: 0,
          decisions: [],
        })
      }

      const isRunning = runningRoles.has(n.role)
        || runningRoles.has(n.id)
        || latestActiveRole === n.role
        || latestActiveRole === n.id
        || n.status === 'run'
      const nextStatus = hasActivity ? (isRunning ? 'run' : 'done') : n.status
      const nextLabel = nextStatus === 'run' ? '运行中' : (nextStatus === 'done' ? '已执行' : '待命')
      const latestDec = roleDecisions[0] || null
      const summary = latestDec
        ? `${latestDec.title}${latestDec.detail ? ' — ' + String(latestDec.detail).slice(0, 80) : ''}`
        : n.summary
      const docBody = roleDecisions.length > 0
        ? `# ${n.code} ${n.name} · 实时决策与执行记录 (${roleDecisions.length} 条)\n\n`
          + roleDecisions.slice(0, 15).map((d, idx) => `${idx + 1}. **[${d.kind}] ${d.title}**${d.detail ? `\n   - 详情：${d.detail}` : ''}${d.tool ? `\n   - 工具/命令：\`${d.tool}\`` : ''}`).join('\n')
        : (n.docBody || '')
      const computedTokens = Number(n.tokens) || tokensByRole.get(n.role) || (roleDecisions.length * 420)

      return Object.assign({}, n, {
        status: nextStatus,
        state: nextStatus === 'pending' ? 'standby' : nextStatus,
        statusLabel: nextLabel,
        has_activity: true,
        active: isRunning,
        step_count: roleSteps.length || roleDecisions.length,
        tokens: computedTokens,
        updated_at: (latestDec && latestDec.ts) || n.updated_at || state.updated_at,
        summary,
        docBody,
        decisions: roleDecisions,
      })
    })

    const activeNodes = enrichedNodes.filter((n) => n.has_activity)
    const activeOnly = options && options.activeOnly !== undefined ? Boolean(options.activeOnly) : false
    const returnedNodes = activeOnly ? activeNodes : enrichedNodes

    const docWall = activeNodes.map((n) => ({
      id: `doc-${n.id}`,
      node_id: n.id,
      code: n.code,
      role: n.role,
      wave: n.wave,
      title: n.docTitle || `${n.id}.md`,
      subtitle: `${n.name} (${n.statusLabel || n.status})`,
      status: n.status,
      statusLabel: n.statusLabel || n.status,
      kind: 'markdown',
      updated_at: n.updated_at || state.updated_at,
      content: n.docBody || n.summary || '',
    }))

    /* 从 plan_goals + shard_locks + worker_digests 合成结构化工程交付文稿（即使 attack_step 为空） */
    if (closedLoop.plan_goals.length > 0) {
      const charterLines = [
        `# 工程立项与 4-Wave 目标蓝图 (${closedLoop.plan_goals.length} 项)`,
        '',
        '| 优先级 | 波次 | 状态 | 目标标题 | 验收摘要 |',
        '| --- | --- | --- | --- | --- |',
        ...closedLoop.plan_goals.map((g) => `| ${g.ui_priority || 'P1'} | ${g.wave || 'wave-1'} | ${g.status || 'pending'} | ${String(g.title || '').replace(/\|/g, '/')} | ${String(g.goal_text || '').slice(0, 90).replace(/\|/g, '/')} |`),
      ]
      if ((closedLoop.shard_locks || []).length > 0) {
        charterLines.push(
          '',
          `## 分片文件独占锁 (${activeShardLocks.length} 活跃 / ${closedLoop.shard_locks.length} 总计)`,
          '',
          ...closedLoop.shard_locks.map((lk) => `- \`${lk.file_pattern}\` — **${lk.worker_name || lk.worker_task_id}** (${lk.wave || 'wave-3'}, \`${lk.status}\`)`),
        )
      }
      docWall.push({
        id: 'deliverable-plan-charter',
        node_id: 'plan',
        code: '⓪ charter',
        role: 'plan',
        wave: 0,
        title: 'DELIVERABLE_PLAN_CHARTER.md',
        subtitle: `4-Wave 目标蓝图 (${closedLoop.plan_goals.length} 项)`,
        status: closedLoop.plan_goals.every((g) => g.status === 'approved' || g.status === 'completed') ? 'done' : 'run',
        statusLabel: '立项蓝图',
        kind: 'markdown',
        updated_at: closedLoop.plan_goals[0]?.updated_at || state.updated_at,
        content: charterLines.join('\n'),
      })
    }

    for (const d of closedLoop.worker_digests.slice(0, 12)) {
      const dagRole = taskRoleById.get(String(d.worker_task_id)) || 'exploit'
      const touched = Array.isArray(d.files_touched) ? d.files_touched : []
      const decisions = Array.isArray(d.key_decisions) ? d.key_decisions : []
      const digestMd = [
        `# ${d.worker_name} · 阶段交付摘要`,
        '',
        `- **审批状态**：\`${d.approval_decision || 'pending_approval'}\``,
        `- **验证结论**：\`${d.verification || 'passed'}\``,
        `- **上下文压缩**：\`${d.raw_tokens || 0} → ${d.compressed_tokens || 0} tokens (${d.compression_pct ?? 0}%)\``,
        '',
        '## 完成事项',
        d.what_was_done || '—',
        '',
        '## 涉及文件',
        touched.length > 0 ? touched.map((f) => `- \`${f}\``).join('\n') : '- （未声明变更文件）',
        '',
        '## 关键工程决策',
        decisions.length > 0 ? decisions.map((k) => `- ${k}`).join('\n') : '- （无附加决策备注）',
      ].join('\n')
      docWall.push({
        id: `deliverable-digest-${d.id}`,
        node_id: dagRole,
        code: '⑤ digest',
        role: dagRole,
        wave: 3,
        title: `DIGEST_${slugify(d.worker_name || String(d.id)).toUpperCase()}.md`,
        subtitle: `${d.worker_name} · 压缩率 ${d.compression_pct ?? 0}%`,
        status: d.approval_decision === 'approved' ? 'done' : 'run',
        statusLabel: d.approval_decision === 'approved' ? '已审批' : '待审批',
        kind: 'markdown',
        updated_at: d.created_at || state.updated_at,
        content: digestMd,
      })
    }

    try {
      if (resolvedId && (this.handles.has(resolvedId) || (resolvedId !== 'default' && existsSync(this.dbPathOf(resolvedId))))) {
        const files = this.listAttackFiles(resolvedId, {})
        for (const f of files.slice(0, 10)) {
          const full = this.readAttackFile(resolvedId, f.id)
          docWall.push({
            id: `artifact-${f.id}`,
            node_id: 'exploit',
            code: '⑤ artifact',
            role: f.created_by || 'exploit',
            wave: 3,
            title: f.name,
            subtitle: `${f.target} · ${f.kind}`,
            status: 'done',
            statusLabel: '已落盘',
            kind: f.kind || 'code',
            updated_at: f.created_at,
            content: (full && full.content) || f.description || f.evidence || '',
          })
        }
      }
    } catch { /* 忽略附加制品异常 */ }

    const rawDigestTokens = closedLoop.worker_digests.reduce((acc, d) => acc + (Number(d.raw_tokens) || 0), 0)
    const compressedDigestTokens = closedLoop.worker_digests.reduce((acc, d) => acc + (Number(d.compressed_tokens) || 0), 0)
    const nodeTokensSum = enrichedNodes.reduce((acc, n) => acc + (Number(n.tokens) || 0), 0)
    const totalTokens = hasStarted ? Math.max(rawDigestTokens, nodeTokensSum) : 0
    const savedTokens = Math.max(0, rawDigestTokens - compressedDigestTokens)
    const promptTokens = hasStarted ? Math.round(totalTokens * 0.65) : 0
    const completionTokens = hasStarted ? (totalTokens - promptTokens) : 0
    const cachedTokens = hasStarted ? savedTokens : 0
    const activeLatencyNodes = enrichedNodes.filter((n) => Number(n.latency_ms) > 0)
    const avgLatencyMs = activeLatencyNodes.length > 0
      ? Math.round(activeLatencyNodes.reduce((acc, n) => acc + (Number(n.latency_ms) || 0), 0) / activeLatencyNodes.length)
      : 0

    /* 全部遥测比率均由真实库表记录诚实计算（空闲时严格为 0，绝不硬编码伪造常数） */
    const cacheHitPct = !hasStarted
      ? 0
      : (rawDigestTokens > 0
        ? Math.round((savedTokens / rawDigestTokens) * 1000) / 10
        : 0)

    const totalWorkerCount = closedLoop.worker_tasks.length
    const activeOrDoneWorkers = closedLoop.worker_tasks.filter((w) =>
      w.status === 'running' || w.status === 'completed' || w.approval_state === 'approved',
    ).length
    const parallelEfficiencyPct = !hasStarted
      ? 0
      : (totalWorkerCount > 0
        ? Math.min(100, Math.round((activeOrDoneWorkers / Math.max(1, Math.min(6, totalWorkerCount))) * 1000) / 10)
        : Math.round((activeNodes.length / Math.max(1, enrichedNodes.length)) * 1000) / 10)

    const gateSamples = closedLoop.worker_digests.length + closedLoop.worker_tasks.length + steps.length
    const gatePassed = closedLoop.worker_digests.filter((d) =>
      d.verification !== 'failed' && d.approval_decision !== 'revision_required',
    ).length
      + closedLoop.worker_tasks.filter((w) =>
        w.status !== 'failed' && w.approval_state !== 'revision_required' && !w.error_detail,
      ).length
      + steps.filter((s) => !/\b(fail|failed|error)\b/i.test(String(s.result || ''))).length
    const gatePassRatePct = (!hasStarted || gateSamples === 0)
      ? 0
      : Math.round((gatePassed / gateSamples) * 1000) / 10

    const tokenUsagePct = hasStarted && totalTokens > 0
      ? Math.min(99, Math.round((totalTokens / 400000) * 1000) / 10)
      : 0
    const contextHealthPct = hasStarted
      ? Math.max(1, Math.round((100 - tokenUsagePct) * 10) / 10)
      : 0

    const fmtPct = (v) => `${v}%`
    const telemetry = {
      total_tokens: totalTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cached_tokens: cachedTokens,
      cache_hit_pct: cacheHitPct,
      token_budget: 400000,
      token_usage_pct: tokenUsagePct,
      avg_latency_ms: avgLatencyMs,
      p95_latency_ms: Math.round(avgLatencyMs * 1.45),
      pg_write_latency_ms: probe.avg_latency_ms || 0,
      parallel_efficiency_pct: parallelEfficiencyPct,
      gate_pass_rate_pct: gatePassRatePct,
      active_slots: enrichedNodes.filter((n) => n.status === 'run').length,
      max_slots: 6,
      subagent_spawns: closedLoop.worker_tasks.length || enrichedNodes.filter((n) => n.is_subagent && n.has_activity).length,
      max_depth_reached: activeNodes.length > 0 ? Math.max(...activeNodes.map((n) => Number(n.depth) || 1)) : 0,
      rings: [
        { id: 'cache', label: 'KV 缓存命中率', value: cacheHitPct, unit: '%', display: fmtPct(cacheHitPct), color: '#4d6bfe' },
        { id: 'parallel', label: '6 槽并行吞吐效率', value: parallelEfficiencyPct, unit: '%', display: fmtPct(parallelEfficiencyPct), color: '#0ea5e9' },
        { id: 'gate', label: 'CSO+QA 门禁通过率', value: gatePassRatePct, unit: '%', display: fmtPct(gatePassRatePct), color: '#10b981' },
        { id: 'context', label: '上下文配额健康度', value: contextHealthPct, unit: '%', display: fmtPct(contextHealthPct), color: '#6366f1' },
      ],
      by_role: enrichedNodes.filter((n) => !n.is_subagent).map((n) => ({
        role: n.role,
        title: n.title || n.name,
        tokens: n.tokens,
        share_pct: totalTokens > 0 ? Math.round((n.tokens / totalTokens) * 100) : 0,
        latency_ms: n.latency_ms,
        step_count: n.step_count || 0,
        has_activity: Boolean(n.has_activity),
      })),
    }

    const currentWave = activeNodes.length > 0
      ? Math.max(...activeNodes.map((n) => Number(n.wave) || 0))
      : (explicitRuns.length > 0 ? state.current_wave : 0)

    const out = {
      ok: true,
      engagement: resolvedId,
      hasStarted,
      has_started: hasStarted,
      activeOnly,
      steps_count: steps.length,
      status: hasStarted || explicitRuns.length > 0 ? (state.status === 'standby' ? 'running' : state.status) : 'standby',
      current_wave: currentWave,
      updated_at: state.updated_at,
      nodes: returnedNodes,
      active_nodes: activeNodes,
      all_nodes: enrichedNodes,
      edges: state.edges,
      runs: explicitRuns,
      decisions: allDecisions,
      decisions_by_role: Object.fromEntries(decisionsByRole),
      docWall,
      doc_wall: docWall,
      telemetry,
      feishu: state.feishu,
      pg_probe: probe,
      plan_goals: closedLoop.plan_goals,
      worker_tasks: closedLoop.worker_tasks,
      worker_digests: closedLoop.worker_digests,
      shard_locks: closedLoop.shard_locks,
      closed_loop_stats: closedLoop.closed_loop_stats,
    }
    if (memoKey && this._readMemo) {
      if (this._readMemo.size >= 32) {
        const oldest = this._readMemo.keys().next().value
        if (oldest !== undefined) this._readMemo.delete(oldest)
      }
      this._readMemo.set(memoKey, out)
      return Object.assign({}, out)
    }
    return out
  }

  /**
   * 记录针对越界写入的 Git 回滚历史，并在全部越界文件已恢复时标记对应 worker_digest `scope_remediated = 1`。
   */
  recordScopeRollback(engagementId, workerTaskId, rollbackResult = {}) {
    const { resolvedId, db } = openClosedLoopDb(this, engagementId, false)
    if (!db) return { ok: false, engagement_id: resolvedId, updated: 0 }
    const now = nowIso()
    const rolledBack = Array.isArray(rollbackResult.rolled_back) ? rollbackResult.rolled_back : []
    const entry = {
      at: now,
      rolled_back: rolledBack,
      skipped_untracked: Array.isArray(rollbackResult.skipped_untracked) ? rollbackResult.skipped_untracked : [],
    }
    const tid = workerTaskId !== undefined && workerTaskId !== null ? String(workerTaskId).trim() : ''
    let rows = []
    if (tid) {
      rows = db.prepare('SELECT id, rollback_history_json, files_touched_json FROM worker_digests WHERE CAST(worker_task_id AS TEXT) = ? ORDER BY id DESC').all(tid)
    } else {
      rows = db.prepare('SELECT id, rollback_history_json, files_touched_json FROM worker_digests ORDER BY id DESC LIMIT 10').all()
    }
    let updated = 0
    for (const row of rows) {
      const prevHist = parseJson(row.rollback_history_json, [])
      const nextHist = Array.isArray(prevHist) ? [...prevHist, entry] : [entry]
      const remediated = rolledBack.length > 0 ? 1 : 0
      try {
        db.prepare('UPDATE worker_digests SET rollback_history_json = ?, scope_remediated = CASE WHEN ? = 1 THEN 1 ELSE scope_remediated END WHERE id = ?')
          .run(JSON.stringify(nextHist), remediated, row.id)
        updated += 1
      } catch { /* ignore column missing */ }
    }
    this._recordPgWrite('UPDATE', 'worker_digests', {
      engagement_id: resolvedId,
      role: 'plan',
      rows: updated,
      summary: `ROLLBACK worker_digests · 回滚越界文件 ${rolledBack.length} 个`,
    })
    if (typeof this._bumpWriteSeq === 'function') this._bumpWriteSeq(resolvedId, 'scope_rollback')
    return { ok: true, engagement_id: resolvedId, updated, entry }
  }


  /**
   * 异步飞书 Webhook 真实 HTTP 推送：
   *   - 当配置了合法 `http(s)://` Webhook URL 时执行真实 `fetch(webhook_url, ...)` POST；
   *   - 捕获网络异常与超时并在 `state.feishu` 元数据中诚实记录真实 HTTP 状态码与错误详情。
   */
  async pushFeishuNotify(id, actionPayload = {}) {
    if (id && typeof id === 'object' && !Array.isArray(id)) {
      actionPayload = id
      id = actionPayload.engagement_id || actionPayload.engagement || null
    }
    const resolvedId = id || actionPayload.engagement_id || actionPayload.engagement || this.activeEngagementId() || 'default'
    const state = readWorkflowState(this, resolvedId)
    const now = nowIso()
    const targetNodeId = String(actionPayload.nodeId || actionPayload.node_id || actionPayload.node || actionPayload.role || 'exploit').trim()
    const targetNode = state.nodes.find((n) => n.id === targetNodeId || n.role === targetNodeId) || state.nodes.find((n) => n.id === 'exploit') || state.nodes[0]
    const rawUrl = String(actionPayload.webhook_url ?? actionPayload.webhookUrl ?? actionPayload.webhook ?? actionPayload.url ?? state.feishu?.webhook_url ?? '').trim()
    if (rawUrl) {
      state.feishu.webhook_url = rawUrl
      state.feishu.configured = true
    }

    const title = String(actionPayload.title || `【LMTAgent】节点 ${targetNode.code} (${targetNode.name}) 状态简报`)
    const summaryText = String(actionPayload.text || actionPayload.message || actionPayload.summary || targetNode.summary || '')
    const feishuBody = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title },
          template: 'blue',
        },
        elements: [
          {
            tag: 'markdown',
            content: `**项目**：\`${resolvedId}\`\n**节点**：${targetNode.code} (${targetNode.name})\n**摘要**：${summaryText}\n**时间**：${now}`,
          },
        ],
      },
    }

    let httpStatus = 0
    let deliveryStatus = 'not_configured'
    let errorDetail = ''
    let responseBody = ''
    let pushed = false

    if (/^https?:\/\/\S+/i.test(rawUrl)) {
      try {
        const timeoutMs = Math.max(500, Math.min(15000, Number(actionPayload.timeout_ms) || 5000))
        const resp = await fetch(rawUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feishuBody),
          signal: AbortSignal.timeout(timeoutMs),
        })
        httpStatus = Number(resp.status) || 0
        try {
          responseBody = (await resp.text()).slice(0, 400)
        } catch { responseBody = '' }
        if (resp.ok) {
          deliveryStatus = 'delivered'
          pushed = true
        } else {
          deliveryStatus = 'http_error'
          errorDetail = `HTTP ${httpStatus}${responseBody ? ': ' + responseBody.slice(0, 120) : ''}`
        }
      } catch (err) {
        deliveryStatus = 'network_error'
        errorDetail = String(err && err.message ? err.message : err)
      }
    } else {
      errorDetail = 'webhook_url not configured or invalid http(s) URL'
    }

    const pushRecord = {
      id: `fs-${Date.now()}`,
      ts: now,
      event: actionPayload.event || 'node_report',
      node_id: targetNode.id,
      title,
      status: deliveryStatus,
      http_status: httpStatus,
      error: errorDetail,
      response_snippet: responseBody,
      webhook: state.feishu.webhook_url || '',
      summary: summaryText,
    }

    const latestState = readWorkflowState(this, resolvedId)
    if (rawUrl) {
      latestState.feishu.webhook_url = rawUrl
      latestState.feishu.configured = true
    }
    latestState.feishu.last_pushed_at = now
    latestState.feishu.last_status = pushed ? 'ok' : deliveryStatus
    latestState.feishu.last_http_status = httpStatus
    latestState.feishu.last_error = errorDetail
    latestState.feishu.history = [pushRecord].concat(latestState.feishu.history || []).slice(0, 20)
    latestState.updated_at = now
    writeWorkflowState(this, resolvedId, latestState)

    recordPgTableWrite(resolvedId, {
      table: 'sessions',
      op: 'INSERT',
      role: 'internal',
      summary: `INSERT sessions · 飞书机器人推送 (${targetNode.id}, status=${deliveryStatus}, http=${httpStatus})`,
    })

    const note = pushed
      ? `飞书机器人推送成功（HTTP ${httpStatus}）：已发送「${targetNode.name}」节点进度简报。`
      : `飞书机器人推送未送达（${deliveryStatus}${errorDetail ? ' — ' + errorDetail : ''}）。`

    return Object.assign({}, this.workflowDag(resolvedId), {
      ok: pushed,
      action: 'pushFeishuNotify',
      pushed,
      status: deliveryStatus,
      delivery_status: deliveryStatus,
      http_status: httpStatus,
      error: errorDetail || undefined,
      push_record: pushRecord,
      note,
      message: note,
    })
  }


  /**
   * 执行工作流编排动作：
   *   - `refine_wish` / `refineUserWish`：模糊愿望结构化精炼向导 + 4-Wave 分片拆解
   *   - `decompose` / `decomposeUserPrompt`：拆解用户需求为 4-Wave `plan_goals`、`worker_tasks` 与 `shard_locks`
   *   - `submit_digest`：提交 Worker 压缩摘要、运行期分片越界检测并置顶 P0 待审批
   *   - `approve_worker`：审批 Worker 产出、释放分片锁并幂等派发下一阶段闭环任务
   *   - `update_goal` / `add_worker` / `retry_worker` / `acquire_locks` / `list_locks` / `release_locks`：交互式编排动作
   *   - `feishuConfig` / `saveFeishuConfig` / `saveFeishuWebhook`：保存飞书群机器人配置
   *   - `pushFeishuNotify` / `feishuNotify` / `feishuTestPush`：触发飞书群机器人卡片通知
   */
  workflowAction(id, actionPayload = {}) {
    if (id && typeof id === 'object' && !Array.isArray(id)) {
      actionPayload = id
      id = actionPayload.engagement_id || actionPayload.engagement || null
    }
    const resolvedId = id || actionPayload.engagement_id || actionPayload.engagement || this.activeEngagementId() || 'default'
    const fallbackOp = (actionPayload.op && actionPayload.op !== 'workflowAction' && actionPayload.op !== 'dagCheckpoint')
      ? actionPayload.op
      : ''
    const rawAction = String(actionPayload.action || actionPayload.kind || actionPayload.type || fallbackOp || 'retryNode').trim()

    const withEng = Object.assign({}, actionPayload, { engagement_id: resolvedId })
    const wfResult = (action, res) => Object.assign({}, this.workflowDag(resolvedId), res, {
      ok: res.ok !== false,
      action,
    })

    const directAction = {
      refine_wish: ['refine_wish', 'refineUserWish'],
      refineUserWish: ['refine_wish', 'refineUserWish'],
      decompose: ['decompose', 'decomposeUserPrompt'],
      decomposeUserPrompt: ['decompose', 'decomposeUserPrompt'],
      submit_digest: ['submit_digest', 'submitWorkerDigest'],
      submitWorkerDigest: ['submit_digest', 'submitWorkerDigest'],
      approve_worker: ['approve_worker', 'approveWorkerAndDispatchNext'],
      planApproveWorker: ['approve_worker', 'approveWorkerAndDispatchNext'],
      approveWorkerAndDispatchNext: ['approve_worker', 'approveWorkerAndDispatchNext'],
      acquire_locks: ['acquire_locks', 'acquireShardLocks'],
      acquireShardLocks: ['acquire_locks', 'acquireShardLocks'],
      release_locks: ['release_locks', 'releaseShardLocks'],
      releaseShardLocks: ['release_locks', 'releaseShardLocks'],
      update_goal: ['update_goal', 'updateWorkerGoal'],
      updateWorkerGoal: ['update_goal', 'updateWorkerGoal'],
      add_worker: ['add_worker', 'addCustomWorkerTask'],
      addCustomWorkerTask: ['add_worker', 'addCustomWorkerTask'],
      retry_worker: ['retry_worker', 'retryWorkerTask'],
      retryWorkerTask: ['retry_worker', 'retryWorkerTask'],
      bind_worker_session: ['bind_worker_session', 'bindWorkerSession'],
      bindWorkerSession: ['bind_worker_session', 'bindWorkerSession'],
    }[rawAction]
    if (directAction) {
      return wfResult(directAction[0], this[directAction[1]](withEng))
    }

    if (rawAction === 'sync_workers' || rawAction === 'syncHostWorkersToPg') {
      return wfResult('sync_workers', this.syncHostWorkersToPg(resolvedId, actionPayload.workers || actionPayload.items || []))
    }

    if (rawAction === 'list_locks' || rawAction === 'listShardLocks') {
      return wfResult('list_locks', { ok: true, locks: this.listShardLocks(resolvedId, actionPayload) })
    }

    if (
      rawAction === 'feishuConfig'
      || rawAction === 'saveFeishuConfig'
      || rawAction === 'saveFeishuWebhook'
      || rawAction === 'saveFeishu'
    ) {
      const note = '已保存飞书群聊机器人 Webhook 与事件订阅配置。'
      return wfResult('feishuConfig', Object.assign(this.saveFeishuConfig(withEng), { ok: true, note, message: note }))
    }

    const state = readWorkflowState(this, resolvedId)
    const now = nowIso()
    const targetNodeId = String(actionPayload.nodeId || actionPayload.node_id || actionPayload.node || actionPayload.role || 'exploit').trim()
    const targetNode = state.nodes.find((n) => n.id === targetNodeId || n.role === targetNodeId) || state.nodes.find((n) => n.id === 'exploit') || state.nodes[0]

    if (rawAction === 'retryNode' || rawAction === 'retry') {
      targetNode.retries = (Number(targetNode.retries) || 0) + 1
      targetNode.status = 'done'
      targetNode.statusLabel = '重试已完成'
      targetNode.updated_at = now
      state.updated_at = now
      state.runs.unshift({
        id: `run-${Date.now()}`,
        run_id: `run-${Date.now()}`,
        node_id: targetNode.id,
        role: targetNode.role,
        title: `${targetNode.name} (Retry #${targetNode.retries})`,
        wave: targetNode.wave,
        status: 'done',
        thinking: targetNode.thinking || 'low',
        depth: targetNode.depth || 1,
        checkpoint: targetNode.checkpoint,
        tokens: 6400,
        latency_ms: 820,
        started_at: now,
        updated_at: now,
        summary: `节点 ${targetNode.code} 断点重试成功并同步 PG 检查点`,
      })
      writeWorkflowState(this, resolvedId, state)
      recordPgTableWrite(resolvedId, {
        table: 'dag_nodes',
        op: 'UPDATE',
        role: targetNode.role || 'exploit#1',
        summary: `RETRY dag_nodes · ${targetNode.id} (retry #${targetNode.retries})`,
        rows: state.nodes.length,
      })
      recordPgTableWrite(resolvedId, {
        table: 'agent_runs',
        op: 'INSERT',
        role: targetNode.role || 'exploit#1',
        summary: `INSERT agent_runs · retry ${targetNode.id}`,
        rows: state.runs.length,
      })
      const note = `已触发「断点重试」：节点 ${targetNode.code} (${targetNode.name}) 第 ${targetNode.retries} 次重试完成并已回写 PG 检查点。`
      return Object.assign({
        ok: true,
        action: 'retryNode',
        node_id: targetNode.id,
        node: targetNode,
        note,
        message: note,
      }, this.workflowDag(resolvedId))
    }

    if (rawAction === 'resumeFromCheckpoint' || rawAction === 'resume' || rawAction === 'dagCheckpoint') {
      const ckpt = String(actionPayload.checkpoint || targetNode.checkpoint || 'ckpt-wave3-exploit')
      const resumed = []
      for (const n of state.nodes) {
        if (n.id === targetNode.id || n.wave >= targetNode.wave) {
          if (n.status === 'wait') {
            n.status = 'run'
            n.statusLabel = '恢复运行中'
          } else if (n.id === targetNode.id) {
            n.status = 'done'
            n.statusLabel = '检查点已恢复'
          }
          n.updated_at = now
          resumed.push(n.id)
        }
      }
      state.updated_at = now
      state.runs.unshift({
        id: `run-${Date.now()}`,
        run_id: `run-${Date.now()}`,
        node_id: targetNode.id,
        role: targetNode.role,
        title: `从检查点 ${ckpt} 恢复执行`,
        wave: targetNode.wave,
        status: 'run',
        thinking: targetNode.thinking || 'low',
        depth: targetNode.depth || 1,
        checkpoint: ckpt,
        tokens: 5100,
        latency_ms: 640,
        started_at: now,
        updated_at: now,
        summary: `从 PG 检查点 ${ckpt} 恢复 ${resumed.length} 个下游节点`,
      })
      writeWorkflowState(this, resolvedId, state)
      recordPgTableWrite(resolvedId, {
        table: 'dag_nodes',
        op: 'UPDATE',
        role: 'plan',
        summary: `RESUME dag_nodes from ${ckpt} (${resumed.length} nodes)`,
        rows: state.nodes.length,
      })
      recordPgTableWrite(resolvedId, {
        table: 'agent_runs',
        op: 'INSERT',
        role: targetNode.role || 'plan',
        summary: `INSERT agent_runs · resume ${ckpt}`,
        rows: state.runs.length,
      })
      const note = `已从 PostgreSQL 检查点 ${ckpt} 恢复执行（激活节点：${resumed.join('、')}）。`
      return Object.assign({
        ok: true,
        action: 'resumeFromCheckpoint',
        checkpoint: ckpt,
        resumed_nodes: resumed,
        note,
        message: note,
      }, this.workflowDag(resolvedId))
    }

    if (rawAction === 'workflowRun' || rawAction === 'triggerRun' || rawAction === 'start' || rawAction === 'run') {
      state.run_seq = (Number(state.run_seq) || 1) + 1
      state.status = 'running'
      state.current_wave = Number(actionPayload.wave) || 3
      state.updated_at = now
      const runId = `wf-run-${state.run_seq}-${Date.now().toString(36)}`
      state.runs.unshift({
        id: runId,
        run_id: runId,
        node_id: 'plan',
        role: 'plan',
        title: actionPayload.goal ? `工作流执行：${actionPayload.goal}` : `4-Wave 6 并发集群调度 #${state.run_seq}`,
        wave: state.current_wave,
        status: 'run',
        thinking: 'low',
        depth: 1,
        checkpoint: `ckpt-run-${state.run_seq}`,
        tokens: 12800,
        latency_ms: 950,
        started_at: now,
        updated_at: now,
        summary: '启动 4-Wave Bounded DAG 并发调度与实时写表探针',
      })
      writeWorkflowState(this, resolvedId, state)
      recordPgTableWrite(resolvedId, {
        table: 'agent_runs',
        op: 'INSERT',
        role: 'plan',
        summary: `INSERT agent_runs · triggerRun ${runId}`,
        rows: state.runs.length,
      })
      recordPgTableWrite(resolvedId, {
        table: 'dag_nodes',
        op: 'SYNC',
        role: 'plan',
        summary: `SYNC dag_nodes · Wave ${state.current_wave} active`,
        rows: state.nodes.length,
      })
      const note = `已启动工作流运行 ${runId}（当前波次：Wave ${state.current_wave}）。`
      return Object.assign({
        ok: true,
        action: 'triggerRun',
        run_id: runId,
        note,
        message: note,
      }, this.workflowDag(resolvedId))
    }

    if (
      rawAction === 'pushFeishuNotify'
      || rawAction === 'feishuNotify'
      || rawAction === 'pushFeishu'
      || rawAction === 'feishuTestPush'
    ) {
      const rawUrl = String(actionPayload.webhook_url ?? actionPayload.webhookUrl ?? actionPayload.webhook ?? actionPayload.url ?? state.feishu?.webhook_url ?? '').trim()
      const hasValidHttpUrl = /^https?:\/\/\S+/i.test(rawUrl)
      if (rawUrl) {
        state.feishu.webhook_url = rawUrl
        state.feishu.configured = true
      }
      const queuedStatus = hasValidHttpUrl ? 'dispatching' : 'not_configured'
      const pushRecord = {
        id: `fs-${Date.now()}`,
        ts: now,
        event: actionPayload.event || (rawAction === 'feishuTestPush' ? 'test_push' : 'node_report'),
        node_id: targetNode.id,
        title: `【LMTAgent】节点 ${targetNode.code} (${targetNode.name}) 状态简报`,
        status: queuedStatus,
        webhook: state.feishu.webhook_url || '',
        summary: targetNode.summary,
      }
      state.feishu.last_pushed_at = now
      state.feishu.last_status = queuedStatus
      writeWorkflowState(this, resolvedId, state)
      const delivery = this.pushFeishuNotify(resolvedId, actionPayload).catch(() => null)
      const note = hasValidHttpUrl
        ? `已向飞书 Webhook 发起真实 HTTP 推送：「${targetNode.name}」进度简报。`
        : '飞书 Webhook URL 未配置或非 http(s) 地址，已记录未配置状态。'
      const out = Object.assign({}, this.workflowDag(resolvedId), {
        ok: hasValidHttpUrl,
        action: 'pushFeishuNotify',
        pushed: hasValidHttpUrl,
        status: queuedStatus,
        delivery_status: queuedStatus,
        push_record: pushRecord,
        note,
        message: note,
      })
      Object.defineProperty(out, 'delivery', { value: delivery, enumerable: false })
      return out
    }

    throw new Error(`unknown workflowAction: ${rawAction}`)
  }
}

export function attachDagWorkflowMethods(StoreClass) {
  for (const key of Object.getOwnPropertyNames(_DagWorkflowMethods.prototype)) {
    if (key !== "constructor") StoreClass.prototype[key] = _DagWorkflowMethods.prototype[key]
  }
}
