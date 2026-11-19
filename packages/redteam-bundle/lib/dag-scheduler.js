/**
 * LMTAgent Host Bridge — 4-Wave DAG 调度、环路检测、工作区预算熔断与性能基准计算（零外部依赖）
 *
 * 注意：`from './shard-policy.js'` 会在 bundle 构建阶段由 `build.mjs`
 * 自动改写为同目录 `'./shard-policy.js'`。
 */
import { shardPatternsOverlap } from './shard-policy.js'

const QUEUEABLE_STATUSES = new Set(['queued', 'pending', 'planned', 'standby', ''])
const RUNNING_STATUSES = new Set(['running', 'run', 'active', 'in_progress'])
const ERROR_STATUSES = new Set(['error', 'failed', 'blocked', 'timeout', 'shard_violation'])

function parseArrayField(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean)
  }
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim()
    if (t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t)
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x || '').trim()).filter(Boolean)
        }
      } catch { /* fallback below */ }
    }
    return t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
  }
  return []
}

function parseWaveNumber(task, fallback = 1) {
  if (!task || typeof task !== 'object') return fallback
  const raw = task.wave_num ?? task.waveNum ?? task.wave ?? task.wave_key
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw)
  }
  const m = /(\d+)/.exec(String(raw || ''))
  if (m) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 1) return n
  }
  return fallback
}

function isTaskApproved(task) {
  if (!task || typeof task !== 'object') return false
  const ap = String(task.approval_state || task.approvalState || '').trim().toLowerCase()
  const st = String(task.status || '').trim().toLowerCase()
  if (ap === 'approved' || st === 'approved') return true
  if (ap === 'pending_approval' || ap === 'revision_required' || ap === 'rejected') return false
  if (ERROR_STATUSES.has(st)) return false
  return (st === 'completed' || st === 'done' || st === 'finished') && ap !== 'working' && ap !== 'in_progress'
}

function isTaskRunning(task) {
  if (!task || typeof task !== 'object') return false
  const st = String(task.status || '').trim().toLowerCase()
  const ap = String(task.approval_state || task.approvalState || '').trim().toLowerCase()
  if (ap === 'approved' || ERROR_STATUSES.has(st)) return false
  return RUNNING_STATUSES.has(st)
}

function isTaskQueueable(task) {
  if (!task || typeof task !== 'object') return false
  const st = String(task.status || 'queued').trim().toLowerCase()
  return QUEUEABLE_STATUSES.has(st)
}

function taskOwnedFiles(task) {
  if (!task || typeof task !== 'object') return []
  return parseArrayField(task.files_owned ?? task.filesOwned ?? task.files_owned_json)
}

function taskDependsOn(task) {
  if (!task || typeof task !== 'object') return []
  return parseArrayField(task.depends_on ?? task.dependsOn ?? task.depends_on_json)
}

function buildTaskLookup(tasks) {
  const refToIdx = new Map()
  const labelOf = (t, idx) => {
    if (t && t.id !== undefined && t.id !== null && String(t.id).trim() !== '') {
      return String(t.id).trim()
    }
    if (t && t.worker_name && String(t.worker_name).trim()) {
      return String(t.worker_name).trim()
    }
    return `task-${idx}`
  }

  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]
    if (!t || typeof t !== 'object') continue
    if (t.id !== undefined && t.id !== null && String(t.id).trim() !== '') {
      const idStr = String(t.id).trim()
      if (!refToIdx.has(idStr)) refToIdx.set(idStr, i)
      if (!idStr.startsWith('wt-') && !refToIdx.has(`wt-${idStr}`)) {
        refToIdx.set(`wt-${idStr}`, i)
      }
    }
  }
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]
    if (!t || typeof t !== 'object') continue
    const wName = String(t.worker_name || t.workerName || '').trim()
    if (wName && !refToIdx.has(wName)) refToIdx.set(wName, i)
  }

  return { refToIdx, labelOf }
}

/**
 * 基于 Kahn 拓扑排序与三色 DFS 检测 `worker_tasks` 的 `depends_on` 依赖环路。
 *
 * @param {Array<object>} [tasks]
 * @returns {{ hasCycle: boolean, cycleNodes: string[] }}
 */
export function detectDagCycles(tasks = []) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t === 'object') : []
  if (list.length === 0) return { hasCycle: false, cycleNodes: [] }

  const { refToIdx, labelOf } = buildTaskLookup(list)
  const adj = Array.from({ length: list.length }, () => [])
  const inDegree = new Array(list.length).fill(0)

  for (let i = 0; i < list.length; i += 1) {
    const deps = taskDependsOn(list[i])
    const seenPred = new Set()
    for (const depRef of deps) {
      const predIdx = refToIdx.get(depRef)
      if (predIdx === undefined || seenPred.has(predIdx)) continue
      seenPred.add(predIdx)
      adj[predIdx].push(i)
      inDegree[i] += 1
    }
  }

  const queue = []
  for (let i = 0; i < list.length; i += 1) {
    if (inDegree[i] === 0) queue.push(i)
  }

  let visitedCount = 0
  let head = 0
  while (head < queue.length) {
    const u = queue[head++]
    visitedCount += 1
    for (const v of adj[u]) {
      inDegree[v] -= 1
      if (inDegree[v] === 0) queue.push(v)
    }
  }

  if (visitedCount === list.length) {
    return { hasCycle: false, cycleNodes: [] }
  }

  /* 通过三色 DFS 精准收集处于环中的节点标签 */
  const color = new Array(list.length).fill(0) // 0=unvisited, 1=visiting, 2=done
  const stack = []
  const cycleLabelSet = new Set()

  const dfs = (u) => {
    color[u] = 1
    stack.push(u)
    for (const v of adj[u]) {
      if (color[v] === 1) {
        const startPos = stack.lastIndexOf(v)
        if (startPos >= 0) {
          for (let k = startPos; k < stack.length; k += 1) {
            cycleLabelSet.add(labelOf(list[stack[k]], stack[k]))
          }
        } else {
          cycleLabelSet.add(labelOf(list[v], v))
        }
      } else if (color[v] === 0) {
        dfs(v)
      }
    }
    stack.pop()
    color[u] = 2
  }

  for (let i = 0; i < list.length; i += 1) {
    if (color[i] === 0) dfs(i)
  }
  if (cycleLabelSet.size === 0) {
    for (let i = 0; i < list.length; i += 1) {
      if (inDegree[i] > 0) cycleLabelSet.add(labelOf(list[i], i))
    }
  }

  return {
    hasCycle: true,
    cycleNodes: Array.from(cycleLabelSet),
  }
}

function hasAnyShardOverlap(patternsA, patternsB) {
  if (!patternsA.length || !patternsB.length) return false
  for (const a of patternsA) {
    for (const b of patternsB) {
      if (shardPatternsOverlap(a, b)) return true
    }
  }
  return false
}

/**
 * 计算当前 DAG 中可立即派发的下一批任务：
 *   - 默认（`!policy.speculativeWaveDispatch`）：经典 Wave Barrier，仅当前置波次全部 `approved` 时返回最低未完成波次的排队任务；
 *   - 实验性推测流水线（`policy.speculativeWaveDispatch === true`）：跨波次检查所有排队任务，只要其显式 `depends_on` 前驱均已 `approved`
 *     （或无 `depends_on` 且所属波次满足 `wave_num <= highestApprovedWave + 1` 且前置波次已全部 `approved`），
 *     且其 `files_owned` 与当前正在运行的任务（及同批已选任务）无任何 `shardPatternsOverlap` 冲突，即可立即并入 `readyTasks`！
 *
 * @param {object} [dag]
 * @param {object} [policy]
 */
export function computeReadyTasksForPipeline(dag = {}, policy = {}) {
  const rawTasks = Array.isArray(dag && dag.worker_tasks)
    ? dag.worker_tasks
    : (Array.isArray(dag) ? dag : [])
  const tasks = rawTasks.filter((t) => t && typeof t === 'object')
  const speculative = Boolean(policy && policy.speculativeWaveDispatch)
  const mode = speculative ? 'speculative' : 'barrier'

  const cycleCheck = detectDagCycles(tasks)
  if (cycleCheck.hasCycle) {
    return {
      readyTasks: [],
      blockedByDeps: [],
      blockedByShardLock: [],
      cycleDetected: true,
      cycleNodes: cycleCheck.cycleNodes,
      mode,
    }
  }

  if (tasks.length === 0) {
    return {
      readyTasks: [],
      blockedByDeps: [],
      blockedByShardLock: [],
      cycleDetected: false,
      mode,
    }
  }

  const { refToIdx } = buildTaskLookup(tasks)
  const runningTasks = tasks.filter((t) => isTaskRunning(t))
  const waveByIdx = tasks.map((t) => parseWaveNumber(t, 1))
  const tasksByWave = new Map()
  for (let i = 0; i < tasks.length; i += 1) {
    const w = waveByIdx[i]
    if (!tasksByWave.has(w)) tasksByWave.set(w, [])
    tasksByWave.get(w).push(tasks[i])
  }
  const sortedWaves = Array.from(tasksByWave.keys()).sort((a, b) => a - b)

  const highestApprovedWave = tasks.reduce((maxW, t, i) => (
    isTaskApproved(t) ? Math.max(maxW, waveByIdx[i]) : maxW
  ), 0)

  const arePrecedingWavesApproved = (targetWave) => {
    for (const w of sortedWaves) {
      if (w >= targetWave) break
      const wTasks = tasksByWave.get(w) || []
      if (wTasks.some((wt) => !isTaskApproved(wt))) return false
    }
    return true
  }

  const areExplicitDepsApproved = (task) => {
    const deps = taskDependsOn(task)
    if (deps.length === 0) return { hasDeps: false, satisfied: true }
    for (const depRef of deps) {
      const predIdx = refToIdx.get(depRef)
      if (predIdx === undefined) return { hasDeps: true, satisfied: false }
      if (!isTaskApproved(tasks[predIdx])) return { hasDeps: true, satisfied: false }
    }
    return { hasDeps: true, satisfied: true }
  }

  const readyTasks = []
  const blockedByDeps = []
  const blockedByShardLock = []

  const slotCapRaw = policy && policy.availableSlots !== undefined && policy.availableSlots !== null
    ? Number(policy.availableSlots)
    : (policy && policy.maxAgents !== undefined && policy.maxAgents !== null
      ? Math.max(0, Number(policy.maxAgents) - runningTasks.length)
      : Infinity)
  const availableSlots = Number.isFinite(slotCapRaw) ? Math.max(0, Math.floor(slotCapRaw)) : Infinity

  if (!speculative) {
    const lowestIncompleteWave = sortedWaves.find((w) => (tasksByWave.get(w) || []).some((t) => !isTaskApproved(t)))
    if (lowestIncompleteWave === undefined) {
      return {
        readyTasks: [],
        blockedByDeps: [],
        blockedByShardLock: [],
        cycleDetected: false,
        mode,
      }
    }

    const activeShards = runningTasks.map((rt) => taskOwnedFiles(rt))
    for (let i = 0; i < tasks.length; i += 1) {
      const t = tasks[i]
      if (!isTaskQueueable(t)) continue
      const w = waveByIdx[i]
      if (w > lowestIncompleteWave) {
        blockedByDeps.push(t)
        continue
      }
      const depCheck = areExplicitDepsApproved(t)
      if (!depCheck.satisfied) {
        blockedByDeps.push(t)
        continue
      }
      const owned = taskOwnedFiles(t)
      if (activeShards.some((sh) => hasAnyShardOverlap(owned, sh))) {
        blockedByShardLock.push(t)
        continue
      }
      if (readyTasks.length < availableSlots) {
        readyTasks.push(t)
        if (owned.length > 0) activeShards.push(owned)
      }
    }

    return {
      readyTasks,
      blockedByDeps,
      blockedByShardLock,
      cycleDetected: false,
      mode,
    }
  }

  /* Speculative DAG Pipelining 模式 */
  const activeShards = runningTasks.map((rt) => taskOwnedFiles(rt))
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]
    if (!isTaskQueueable(t)) continue
    const w = waveByIdx[i]
    const depCheck = areExplicitDepsApproved(t)
    let depsReady = false
    if (depCheck.hasDeps) {
      depsReady = depCheck.satisfied
    } else {
      depsReady = w <= (highestApprovedWave + 1) && arePrecedingWavesApproved(w)
    }

    if (!depsReady) {
      blockedByDeps.push(t)
      continue
    }

    const owned = taskOwnedFiles(t)
    if (activeShards.some((sh) => hasAnyShardOverlap(owned, sh))) {
      blockedByShardLock.push(t)
      continue
    }

    if (readyTasks.length < availableSlots) {
      readyTasks.push(t)
      if (owned.length > 0) activeShards.push(owned)
    }
  }

  return {
    readyTasks,
    blockedByDeps,
    blockedByShardLock,
    cycleDetected: false,
    mode,
  }
}

/**
 * 汇总工作区真实 Token 与费用消耗（优先显式 `extra.usage`，否则在 DAG telemetry / worker_tasks / worker_digests / hostSessions 间取权威极大值）。
 */
export function computeWorkspaceUsage(dag = {}, hostSessions = [], extra = {}) {
  if (extra && extra.usage && typeof extra.usage === 'object') {
    const explicitTok = Number(extra.usage.totalTokens ?? extra.usage.tokens ?? 0) || 0
    const explicitCostRaw = extra.usage.totalCost ?? extra.usage.costYuan ?? extra.usage.cost
    const explicitCost = explicitCostRaw !== undefined && explicitCostRaw !== null
      ? (Number(explicitCostRaw) || 0)
      : (explicitTok > 0 ? Number(((explicitTok / 1_000_000) * 1.8).toFixed(4)) : 0)
    return { totalTokens: explicitTok, totalCost: explicitCost }
  }

  const d = dag && typeof dag === 'object' ? dag : {}
  const tasks = Array.isArray(d.worker_tasks) ? d.worker_tasks : []
  const digests = Array.isArray(d.worker_digests) ? d.worker_digests : []
  const dagTokens = Number(d.telemetry && d.telemetry.total_tokens) || 0
  const taskTokens = tasks.reduce((acc, t) => acc + (Number(t && t.tokens) || 0), 0)
  const digestTokens = digests.reduce((acc, dg) => acc + (Number(dg && dg.raw_tokens) || 0), 0)

  let hostTokens = 0
  let hostCost = 0
  if (Array.isArray(hostSessions)) {
    for (const hs of hostSessions) {
      if (!hs || typeof hs !== 'object') continue
      hostTokens += Number(hs.tokens) || 0
      hostCost += Number(hs.costYuan ?? hs.cost ?? 0) || 0
      if (Array.isArray(hs.children)) {
        for (const ch of hs.children) {
          hostTokens += Number(ch && ch.tokens) || 0
          hostCost += Number((ch && (ch.costYuan ?? ch.cost)) || 0) || 0
        }
      }
    }
  }

  const meterTokens = Number(extra && extra.meterTokens) || 0
  const meterCost = Number(extra && extra.meterCost) || 0
  const totalTokens = Math.max(dagTokens, taskTokens, digestTokens, hostTokens, meterTokens)
  const explicitCost = Number(d.telemetry && (d.telemetry.total_cost ?? d.telemetry.cost_yuan)) || 0
  const totalCost = Math.max(
    explicitCost,
    hostCost,
    meterCost,
    totalTokens > 0 ? Number(((totalTokens / 1_000_000) * 1.8).toFixed(4)) : 0,
  )
  return { totalTokens, totalCost }
}

/**
 * 评估工作区级 Token / 费用预算熔断守卫。
 *
 * @param {object} [usage]
 * @param {object} [policy]
 */
export function evaluateWorkspaceBudgetGuard(usage = {}, policy = {}) {
  const u = usage && typeof usage === 'object' ? usage : {}
  const p = policy && typeof policy === 'object' ? policy : {}

  const totalTokens = Math.max(0, Number(u.totalTokens ?? u.tokens ?? 0) || 0)
  const totalCost = Math.max(0, Number(u.totalCost ?? u.costYuan ?? u.cost ?? 0) || 0)
  const maxTokens = Math.max(0, Number(p.maxTokensPerWorkspace ?? p.max_tokens_per_workspace ?? 0) || 0)
  const maxCost = Math.max(0, Number(p.maxCostPerWorkspace ?? p.max_cost_per_workspace ?? 0) || 0)

  const tokenExceeded = maxTokens > 0 && totalTokens >= maxTokens
  const costExceeded = maxCost > 0 && totalCost >= maxCost
  const tripped = tokenExceeded || costExceeded

  const tokenNear = maxTokens > 0 && totalTokens >= maxTokens * 0.85
  const costNear = maxCost > 0 && totalCost >= maxCost * 0.85
  const warnNearLimit = !tripped && (tokenNear || costNear)

  const tokenRatioPct = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 1000) / 10 : 0
  const costRatioPct = maxCost > 0 ? Math.round((totalCost / maxCost) * 1000) / 10 : 0

  let reason = ''
  if (tokenExceeded && costExceeded) {
    reason = `工作区 Token（${totalTokens}/${maxTokens}）与费用（${totalCost}/${maxCost}）均已达到熔断上限`
  } else if (tokenExceeded) {
    reason = `工作区 Token 用量已达上限（${totalTokens} / ${maxTokens}）`
  } else if (costExceeded) {
    reason = `工作区费用已达上限（${totalCost} / ${maxCost}）`
  } else if (warnNearLimit) {
    reason = '工作区预算使用率已达 85% 警戒线'
  }

  return {
    tripped,
    warnNearLimit,
    reason,
    totalTokens,
    maxTokens,
    totalCost,
    maxCost,
    tokenRatioPct,
    costRatioPct,
  }
}

/**
 * 基于真实工作区库表（`worker_tasks` / `worker_digests`）与宿主会话遥测计算性能基准指标。
 *
 * @param {object} [dag]
 * @param {Array<object>} [hostSessions]
 * @param {object} [options]
 */
export function computeWorkspacePerfMetrics(dag = {}, hostSessions = [], options = {}) {
  const d = dag && typeof dag === 'object' ? dag : {}
  const opts = options && typeof options === 'object' ? options : {}
  const tasks = Array.isArray(d.worker_tasks) ? d.worker_tasks.filter(Boolean) : []
  const digests = Array.isArray(d.worker_digests) ? d.worker_digests.filter(Boolean) : []

  const totalTasks = tasks.length
  const approvedTasks = tasks.filter((t) => isTaskApproved(t)).length

  const maxSlots = Math.max(1, Number(opts.maxAgents) || 6)
  const activeOrDoneCount = tasks.filter((t) => (
    isTaskApproved(t)
    || isTaskRunning(t)
    || ['completed', 'done', 'finished'].includes(String(t.status || '').trim().toLowerCase())
  )).length
  const parallelismEfficiencyPct = totalTasks > 0
    ? Math.min(100, Math.round((activeOrDoneCount / Math.max(1, Math.min(maxSlots, totalTasks))) * 1000) / 10)
    : 0

  const rawTokensSum = digests.reduce((acc, dg) => acc + Math.max(0, Number(dg.raw_tokens ?? dg.rawTokens ?? 0) || 0), 0)
  const compressedTokensSum = digests.reduce((acc, dg) => acc + Math.max(0, Number(dg.compressed_tokens ?? dg.compressedTokens ?? 0) || 0), 0)
  const digestCompressionRatioPct = rawTokensSum > 0
    ? Math.max(0, Math.min(100, Math.round(((rawTokensSum - compressedTokensSum) / rawTokensSum) * 1000) / 10))
    : 0

  const schemaLegacyBytes = Number(opts.schemaLegacyBytes ?? 28000) || 28000
  const schemaCurrentBytes = Number(opts.schemaCurrentBytes ?? 10500) || 10500
  let hostWorkerCount = 0
  if (Array.isArray(hostSessions)) {
    for (const hs of hostSessions) {
      if (!hs || typeof hs !== 'object') continue
      hostWorkerCount += 1 + (Array.isArray(hs.children) ? hs.children.length : 0)
    }
  }
  const agentCallFactor = Math.max(1, totalTasks, hostWorkerCount)
  const schemaTokenSavedEstimate = Math.max(0, Math.round(((schemaLegacyBytes - schemaCurrentBytes) / 4) * agentCallFactor))

  const violatedTaskKeys = new Set()
  const remediatedTaskKeys = new Set()
  for (const dg of digests) {
    const tid = String(dg.worker_task_id ?? dg.worker_name ?? '').trim()
    if (Number(dg.scope_remediated) === 1) {
      if (tid) remediatedTaskKeys.add(tid)
    }
    const sv = parseArrayField(dg.scope_violations ?? dg.scope_violations_json)
    if (sv.length > 0 && Number(dg.scope_remediated) !== 1 && tid) {
      violatedTaskKeys.add(tid)
    }
  }
  for (const t of tasks) {
    const tid = String(t.id ?? t.worker_name ?? '').trim()
    if (tid && remediatedTaskKeys.has(tid)) continue
    const st = String(t.status || '').trim().toLowerCase()
    const err = String(t.error_detail || t.errorDetail || '')
    if (st === 'shard_violation' || /越界|shard_violation|scope_violation/i.test(err)) {
      violatedTaskKeys.add(tid || `idx-${tasks.indexOf(t)}`)
    }
  }
  const sampleCount = Math.max(totalTasks, digests.length)
  const scopeCompliancePct = sampleCount > 0
    ? Math.max(0, Math.round(((sampleCount - Math.min(sampleCount, violatedTaskKeys.size)) / sampleCount) * 1000) / 10)
    : 100

  const latencies = []
  for (const t of tasks) {
    const ms = Number(t.duration_ms ?? t.latency_ms ?? t.durationMs ?? 0) || 0
    if (ms > 0) latencies.push(ms)
  }
  if (latencies.length === 0 && Array.isArray(hostSessions)) {
    for (const hs of hostSessions) {
      for (const ch of (Array.isArray(hs && hs.children) ? hs.children : [])) {
        const ms = Number(ch && (ch.durationMs ?? ch.duration_ms ?? 0)) || 0
        if (ms > 0) latencies.push(ms)
      }
    }
  }
  const avgTaskLatencyMs = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0

  const specPlan = computeReadyTasksForPipeline(d, { speculativeWaveDispatch: true })
  const speculativeReadyCount = specPlan.readyTasks.length

  return {
    parallelismEfficiencyPct,
    digestCompressionRatioPct,
    schemaTokenSavedEstimate,
    scopeCompliancePct,
    avgTaskLatencyMs,
    speculativeReadyCount,
    totalTasks,
    approvedTasks,
  }
}
