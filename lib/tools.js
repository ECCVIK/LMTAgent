/**
 * LMTAgent v1.0.0 智能体工具集（preset 平面，12 个正交 lmt_* 工具，零外部依赖）
 *
 * 解析 host 平面发布的 `ctx.lmtagent`（兼容旧测试桩 `ctx.redteam`）或 `config.store`；
 * 会话工作区按根祖先会话 id 1:1 隔离，并发槽与 File-Disjoint Sharding 锁联动落库。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { ROLE_TITLES, PLANNER_ROLE, ROLE_ORDER, scoreStageOf, checkFileAgainstShardLocks } from './store-core.js'
import {
  maxAgentsOf,
  maxDepthOf,
  thinkingEffortOf,
  DEFAULT_LEASE_TTL_MS,
  detectShardConflicts,
  normalizeShardPattern,
} from './settings.js'
import { checkSkill, summarizeSkills, expandSkillPath } from './skill-availability.js'

/** Cordis 插件名。 */
export const name = 'lmtagent-tools'

/** 硬依赖：资产库服务 + 工具注册表（subagents / skills / sessions 走 ctx.get 可选获取）。 */
export const inject = ['lmtagent', 'tools']

/** 并发预留租约 TTL（默认 120,000ms），防止派发失败导致槽位永久泄漏。 */
export const RESERVATION_TTL_MS = DEFAULT_LEASE_TTL_MS

/** 旧版 60 工具序列化 schema 基准字节数（用于瘦身与性能对比）。 */
export const TOOL_SCHEMA_BASELINE_LEGACY_BYTES = 28000

const MAX_TRACKED_ROOT_SESSIONS = 256
const ALL_ROLES = [PLANNER_ROLE, ...ROLE_ORDER]
const ROLE_WAVES = {
  plan: { wave: 0, wave_label: 'Wave 0 · 主控调度', preset: 'redteam' },
  recon: { wave: 1, wave_label: 'Wave 1 · 需求与数据源', preset: 'redteam-worker-recon' },
  designer: { wave: 1, wave_label: 'Wave 1 · 交互与令牌', preset: 'redteam-worker-designer' },
  assess: { wave: 2, wave_label: 'Wave 2 · 契约与分片', preset: 'redteam-worker-assess' },
  exploit: { wave: 3, wave_label: 'Wave 3 · 6 槽并发构建', preset: 'redteam-worker-exploit' },
  'vuln-scan': { wave: 4, wave_label: 'Wave 4 · 代码审查门禁', preset: 'redteam-worker-vuln-scan' },
  qa: { wave: 4, wave_label: 'Wave 4 · 测试回归门禁', preset: 'redteam-worker-qa' },
  internal: { wave: 4, wave_label: 'Wave 4 · 文档与发布', preset: 'redteam-worker-internal' },
}

const bindings = new Map()
const reservations = new Map()
export const sessionBindings = bindings
export const activeReservations = reservations

let slotSeq = 0

function enforceSessionMapCap() {
  for (const map of [bindings, reservations]) {
    while (map.size > MAX_TRACKED_ROOT_SESSIONS) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }
}

function setBoundedBinding(key, engagementId) {
  if (!key) return
  if (bindings.has(key)) bindings.delete(key)
  bindings.set(key, engagementId)
  enforceSessionMapCap()
}

function resolveStore(ctx, config) {
  return (ctx && (ctx.lmtagent || ctx.redteam)) || config?.store
}

function rootDirOfCtx(ctx, store) {
  try {
    return (store && store.root) || (ctx && ((ctx.lmtagent && ctx.lmtagent.root) || (ctx.redteam && ctx.redteam.root))) || undefined
  } catch {
    return undefined
  }
}

function sessionInfoOf(exec) {
  const session = exec && exec.agent && exec.agent.session
  if (session === undefined || session === null) return {}
  const id = session.id === undefined ? undefined : String(session.id)
  let parentId
  try {
    const header = session.header
    parentId = header && header.parentSession !== undefined && header.parentSession !== null
      ? String(header.parentSession)
      : undefined
  } catch {
    parentId = undefined
  }
  return { id, parentId, session }
}

/** 沿 parentSession 追溯根祖先会话 id，保证子智能体继承父会话隔离工作区。 */
function resolveRootSession(session) {
  const chain = []
  let cur = session
  let guard = 0
  while (cur !== undefined && cur !== null && guard < 64) {
    const info = sessionInfoOf({ agent: { session: cur } })
    if (info.id === undefined) break
    chain.push(info.id)
    if (info.parentId === undefined || info.parentId === '') break
    let parent
    try {
      const sStore = cur.store
      parent = sStore && typeof sStore.get === 'function' ? sStore.get(info.parentId) : undefined
    } catch {
      parent = undefined
    }
    if (parent === undefined || parent === null) {
      return { rootId: info.parentId, chain: chain.concat([info.parentId]) }
    }
    cur = parent
    guard += 1
  }
  return { rootId: chain.length > 0 ? chain[chain.length - 1] : undefined, chain }
}

function bindingKeyOf(exec) {
  const info = sessionInfoOf(exec)
  if (info.id === undefined) return { rootId: undefined, sessionId: undefined, chain: [] }
  const resolved = resolveRootSession(info.session)
  return { rootId: resolved.rootId === undefined ? info.id : resolved.rootId, sessionId: info.id, chain: resolved.chain }
}

function bindKeysOf(exec) {
  const { rootId, sessionId, chain } = bindingKeyOf(exec)
  return Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))
}

function parentSessionIdOf(entry) {
  if (!entry || typeof entry !== 'object') return undefined
  try {
    const raw = entry.header && entry.header.parentSession !== undefined && entry.header.parentSession !== null
      ? entry.header.parentSession
      : entry.parentSession
    return raw !== undefined && raw !== null ? String(raw) : undefined
  } catch {
    return undefined
  }
}

function recordSessionBinding(store, exec, engagementId, engName) {
  if (!store || typeof store.setSessionBinding !== 'function') return
  const { rootId, sessionId } = bindingKeyOf(exec)
  const key = rootId || sessionId
  if (!key) return
  try {
    store.setSessionBinding(String(key), String(engagementId), engName === undefined ? undefined : String(engName))
  } catch { /* ignore disk persistence failure */ }
}

function findEngagementIn(list, query) {
  if (!Array.isArray(list)) return undefined
  return list.find((e) => e.id === query)
    || list.find((e) => String(e.name) === query)
    || list.find((e) => String(e.name).includes(query))
}

function resolveEngagement(store, exec, explicit) {
  if (!store) throw new Error('lmtagent store unavailable')
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    const q = explicit.trim()
    const hit = typeof store.listEngagements === 'function' ? findEngagementIn(store.listEngagements(), q) : undefined
    return hit ? hit.id : q
  }
  const { rootId, sessionId, chain } = bindingKeyOf(exec)
  const keys = Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))
  for (const key of keys) {
    const bound = bindings.get(key)
    if (typeof bound === 'string' && bound.length > 0) return bound
  }
  if (typeof store.sessionBinding === 'function') {
    for (const key of keys) {
      const persisted = store.sessionBinding(key)
      if (typeof persisted === 'string' && persisted.length > 0) {
        for (const k of keys) setBoundedBinding(k, persisted)
        return persisted
      }
    }
  }
  if (typeof store.activeEngagementId === 'function') {
    const active = store.activeEngagementId()
    if (active !== undefined) {
      const memHolder = Array.from(bindings.entries()).find(([k, v]) => v === active && !keys.includes(k))
      const diskBindings = typeof store.sessionBindings === 'function' ? store.sessionBindings() : {}
      const diskHolder = Object.entries(diskBindings).find(([k, v]) => v && v.engagement === active && !keys.includes(k))
      if (memHolder !== undefined || diskHolder !== undefined) {
        throw new Error(
          '本会话尚未绑定项目工作区，而全局「当前项目工作区」' + active + ' 已被另一个会话占用；'
          + '请显式调用 lmt_engagement_open 或 lmt_session_bind 完成会话隔离绑定。',
        )
      }
      for (const key of keys) setBoundedBinding(key, active)
      recordSessionBinding(store, exec, active)
      return active
    }
  }
  const list = typeof store.listEngagements === 'function' ? store.listEngagements() : []
  if (list.length === 1) {
    for (const key of keys) setBoundedBinding(key, list[0].id)
    recordSessionBinding(store, exec, list[0].id, list[0].name)
    return list[0].id
  }
  throw new Error('尚未绑定项目工作区：请先调用 lmt_engagement_open 传入项目名称')
}

function bindingViewOf(exec, store) {
  const info = sessionInfoOf(exec)
  const { rootId, chain } = bindingKeyOf(exec)
  return {
    session_id: info.id ?? null,
    parent_session: info.parentId ?? null,
    root_session: rootId ?? null,
    session_chain: chain,
    is_subagent: info.parentId !== undefined,
    bound_engagement: rootId !== undefined ? (bindings.get(rootId) ?? null) : null,
    panel_follow_engagement: rootId !== undefined && store && typeof store.sessionBinding === 'function'
      ? (store.sessionBinding(rootId) ?? null)
      : null,
  }
}

function normalizeFilesOwned(files) {
  return Array.from(new Set(files.map(normalizeShardPattern).filter(Boolean)))
}

function splitList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((v) => String(v || '').split(/[,，\s]+/)).map((x) => x.trim()).filter(Boolean)))
  }
  return Array.from(new Set(String(value || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)))
}

function agentOf(args) {
  const raw = typeof args?.agent === 'string' ? args.agent.trim() : ''
  return raw !== '' ? raw : PLANNER_ROLE
}

function compactAsset(a) {
  return {
    id: a.id,
    ip: a.ip,
    segment: a.segment_cidr,
    state: a.state,
    name: a.primary_name,
    names: (a.names || []).map((n) => n.name),
    ports: (a.ports || []).filter((p) => p.state === 'open')
      .map((p) => p.port + '/' + p.proto + (p.service ? ' ' + [p.service, p.product, p.version].filter(Boolean).join(' ') : '') + ' [' + p.provenance + ']'),
    fingerprints: (a.fingerprints || []).map((f) => [f.category, f.vendor, f.product, f.version].filter(Boolean).join(' ') + ' [' + f.provenance + ']'),
    passive: a.passive,
    active: a.active,
    discovered_at: a.discovered_at,
    first_seen: a.first_seen,
    last_seen: a.last_seen,
    test_status: a.test_status,
    priority: a.priority,
  }
}

/* ── IPv4 / Scope / SOCKS5 探测辅助 ──────────────────────────────────────── */

function ipv4Int(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim())
  if (m === null) return null
  const n = m.slice(1).map(Number)
  if (n.some((x) => x > 255)) return null
  return ((n[0] * 256 + n[1]) * 256 + n[2]) * 256 + n[3]
}

function targetIpv4(target) {
  const m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(String(target || ''))
  return m === null ? null : m[1]
}

function ipInCidr(ip, cidr) {
  const [base, bitsText] = String(cidr || '').split('/')
  const a = ipv4Int(ip)
  const b = ipv4Int(base)
  const bits = Number(bitsText)
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const mask = (0xFFFFFFFF << (32 - bits)) >>> 0
  return (a & mask) >>> 0 === (b & mask) >>> 0
}

function scopeCheck(store, id, target) {
  const row = store.listEngagements().find((e) => e.id === id)
  const scope = Array.isArray(row && row.scope) ? row.scope : []
  if (scope.length === 0) return { status: 'unscoped', scope, ip: null }
  const ip = targetIpv4(target)
  if (ip === null) return { status: 'unresolved', scope, ip: null }
  const hit = scope.find((cidr) => ipInCidr(ip, cidr))
  return { status: hit === undefined ? 'out' : 'in', scope, ip, cidr: hit || null }
}

function socks5Probe(listen, target, timeoutMs = 6000) {
  const proxy = String(listen || '').replace(/^socks5:\/\//, '').replace(/^https?:\/\//, '')
  const pi = proxy.lastIndexOf(':')
  const ph = pi > 0 ? proxy.slice(0, pi) : '127.0.0.1'
  const pp = Number(pi > 0 ? proxy.slice(pi + 1) : proxy)
  const ti = target.lastIndexOf(':')
  const th = ti > 0 ? target.slice(0, ti) : target
  const tp = Number(ti > 0 ? target.slice(ti + 1) : 0)
  if (!Number.isFinite(pp) || pp <= 0 || !Number.isFinite(tp) || tp <= 0) {
    return Promise.resolve({ ok: false, target, error: 'listen/target 端口无法解析' })
  }
  return new Promise((resolve) => {
    const started = Date.now()
    let done = false
    let stage = 'greeting'
    const socket = createConnection({ host: ph, port: pp })
    const finish = (ok, error) => {
      if (done) return
      done = true
      try { socket.destroy() } catch { /* ignore */ }
      resolve({ ok, target, listen, latency_ms: Date.now() - started, error: error || undefined })
    }
    socket.setTimeout(Math.min(Math.max(Number(timeoutMs) || 6000, 1000), 20000))
    socket.on('timeout', () => finish(false, 'timeout'))
    socket.on('error', (e) => finish(false, String((e && e.code) || (e && e.message) || e)))
    socket.on('connect', () => socket.write(Buffer.from([5, 1, 0])))
    socket.on('data', (buf) => {
      if (stage === 'greeting') {
        if (buf.length < 2 || buf[0] !== 5 || buf[1] !== 0) return finish(false, 'SOCKS5 greeting failed')
        stage = 'connect'
        const ip = ipv4Int(th)
        let req
        if (ip !== null) {
          const b = Buffer.alloc(10)
          b[0] = 5; b[1] = 1; b[2] = 0; b[3] = 1
          b.writeUInt32BE(ip >>> 0, 4); b.writeUInt16BE(tp, 8)
          req = b
        } else {
          const hb = Buffer.from(th, 'utf8')
          const b = Buffer.alloc(7 + hb.length)
          b[0] = 5; b[1] = 1; b[2] = 0; b[3] = 3; b[4] = hb.length
          hb.copy(b, 5); b.writeUInt16BE(tp, 5 + hb.length)
          req = b
        }
        socket.write(req)
        return
      }
      if (buf.length >= 2 && buf[0] === 5 && buf[1] === 0) finish(true)
      else finish(false, 'SOCKS5 connect rejected')
    })
  })
}

/* ── 规则防作弊校验与结构化错误包装 ──────────────────────────────────────── */

function assertBoundaryGate(args, code) {
  const c = String(code || '')
  if (!c.startsWith('boundary-')) return
  const b = args && args.boundary
  if (b === null || b === undefined || typeof b !== 'object') {
    throw new Error('边界突破必须提供 boundary 对象（entry_zone / target_zone / isolation / target_asset）；同区只能记 internal。')
  }
  const entry = String(b.entry_zone || '').trim()
  const target = String(b.target_zone || '').trim()
  const isolation = String(b.isolation || '').trim()
  const asset = String(b.target_asset || '').trim()
  if (!entry || !target || !isolation || !asset) {
    throw new Error('boundary 不完整：entry_zone / target_zone / isolation / target_asset 都必须填写。')
  }
  if (entry.toLowerCase() === target.toLowerCase()) {
    throw new Error('入口区与落点区相同（' + entry + '）：同区隧道不是边界突破，请改记 internal。')
  }
  if (c === 'boundary-supply' && b.scope_confirmed !== true) {
    throw new Error('boundary-supply 需要 scope_confirmed=true：先确认授权范围后再记分。')
  }
}

function addVulnWithEvidence(store, id, item, defaultAgent) {
  const result = store.addVuln(id, {
    ...item,
    engagement: undefined,
    agent: defaultAgent,
    found_by_agent: item.found_by_agent || item.agent || 'vuln-scan',
  })
  let httpEvidenceId = null
  const request = typeof item.request === 'string' ? item.request.trim() : ''
  if (request !== '') {
    try {
      const ev = store.addHttpEvidence(id, {
        vuln_id: result.id,
        asset_id: item.asset_id,
        label: item.title,
        method: item.method || 'GET',
        url: item.target,
        request,
        response: item.response,
        captured_by: defaultAgent,
      })
      httpEvidenceId = ev.id
    } catch { /* defect saved; non-blocking evidence */ }
  }
  return { result, httpEvidenceId }
}

export function withStructuredErrors(tool) {
  const inner = tool.execute
  if (typeof inner !== 'function') return tool
  return Object.assign({}, tool, {
    async execute(args, exec) {
      try {
        return await inner(args, exec)
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        const kind = /非法|invalid|required|不能为空|not found|不存在/i.test(message) ? 'bad_input' : 'failed'
        return JSON.stringify({
          ok: false,
          error: message,
          error_kind: kind,
          hint: kind === 'bad_input'
            ? '核对参数名与取值（可用 lmt_artifact_query 先查实际 id），修正后重试。'
            : '工具执行失败，请检查 error 说明并向主控/用户反馈。',
        }, null, 2)
      }
    },
  })
}

/* ── 并发槽与持久化 ShardLock 租约管理 ───────────────────────────────────── */

function tryReleaseStoreShardLock(store, rootId, entry) {
  if (!store || typeof store.releaseShardLocks !== 'function' || !entry) return
  const engId = entry.engagementId || bindings.get(rootId) || rootId
  try {
    store.releaseShardLocks(engId, {
      engagement_id: engId,
      owner: entry.key,
      worker_task_id: entry.workerTaskId || entry.key,
      worker_name: entry.label || entry.key,
      files_owned: Array.isArray(entry.files_owned) ? entry.files_owned : [],
    })
  } catch { /* ignore release failure */ }
}

function isClosedSessionEntry(s) {
  if (!s || typeof s !== 'object') return false
  return s.closed === true
    || s.status === 'closed'
    || s.state === 'closed'
    || s.activity === 'closed'
    || Boolean(s.closedAt || (s.header && s.header.closedAt))
}

function pruneClosedRootSessions(sessionEntries, store) {
  if (!Array.isArray(sessionEntries)) return
  for (const s of sessionEntries) {
    if (!isClosedSessionEntry(s)) continue
    const sid = s && s.id !== undefined ? String(s.id) : undefined
    const parentSid = parentSessionIdOf(s)
    if (sid !== undefined && !parentSid) {
      bindings.delete(sid)
      const map = reservations.get(sid)
      if (map !== undefined) {
        for (const entry of map.values()) tryReleaseStoreShardLock(store, sid, entry)
        reservations.delete(sid)
      }
    }
  }
  enforceSessionMapCap()
}

function pruneExpiredReservations(now = Date.now(), store = undefined) {
  for (const [rootId, map] of reservations.entries()) {
    for (const [key, raw] of map.entries()) {
      const at = typeof raw === 'number' ? raw : Number(raw && raw.at)
      const expiresAt = (raw && typeof raw === 'object' && Number.isFinite(raw.expires_at))
        ? raw.expires_at
        : (Number.isFinite(at) ? at + RESERVATION_TTL_MS : 0)
      if (now >= expiresAt) {
        if (raw && typeof raw === 'object') tryReleaseStoreShardLock(store, rootId, raw)
        map.delete(key)
      }
    }
    if (map.size === 0) reservations.delete(rootId)
  }
  enforceSessionMapCap()
}

function reservationList(rootId, now = Date.now(), store = undefined) {
  pruneExpiredReservations(now, store)
  const map = reservations.get(rootId)
  if (map === undefined) return []
  return Array.from(map.values(), (r) => ({
    key: r.key,
    label: r.label,
    childId: r.childId,
    worker_task_id: r.workerTaskId,
    wave: r.wave,
    files_owned: Array.isArray(r.files_owned) ? r.files_owned.slice() : [],
    at: r.at,
    expires_at: r.expires_at,
    ttl_ms: Math.max(r.expires_at - now, 0),
  }))
}

function addReservation(rootId, spec, now = Date.now()) {
  pruneExpiredReservations(now)
  if (!reservations.has(rootId)) reservations.set(rootId, new Map())
  const entry = {
    key: String(spec.key),
    label: typeof spec.label === 'string' && spec.label.trim() !== '' ? spec.label.trim() : String(spec.key),
    childId: spec.childId !== undefined ? String(spec.childId) : undefined,
    workerTaskId: spec.workerTaskId !== undefined ? String(spec.workerTaskId) : String(spec.key),
    wave: typeof spec.wave === 'string' && spec.wave.trim() !== '' ? spec.wave.trim() : 'wave-3',
    files_owned: Array.isArray(spec.files_owned) ? spec.files_owned.slice() : [],
    engagementId: spec.engagementId,
    at: now,
    expires_at: now + RESERVATION_TTL_MS,
  }
  reservations.get(rootId).set(entry.key, entry)
  enforceSessionMapCap()
  return entry
}

function findReservationEntry(map, wanted) {
  if (!map || !wanted) return null
  if (map.has(wanted)) return [wanted, map.get(wanted)]
  for (const [k, r] of map.entries()) {
    if (r.childId === wanted || r.label === wanted || r.workerTaskId === wanted) return [k, r]
  }
  return null
}

function dropReservation(rootId, key, store = undefined) {
  const map = reservations.get(rootId)
  if (map === undefined) return false
  if (key === undefined) {
    const n = map.size
    for (const entry of map.values()) tryReleaseStoreShardLock(store, rootId, entry)
    reservations.delete(rootId)
    return n > 0
  }
  const found = findReservationEntry(map, key)
  if (!found) return false
  tryReleaseStoreShardLock(store, rootId, found[1])
  map.delete(found[0])
  if (map.size === 0) reservations.delete(rootId)
  return true
}

function dropOldestReservation(rootId, store = undefined) {
  const map = reservations.get(rootId)
  if (map === undefined || map.size === 0) return false
  let oldestKey
  let oldestEntry
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [k, r] of map.entries()) {
    const at = typeof r === 'number' ? r : Number(r && r.at)
    if (at < oldestAt) {
      oldestAt = at
      oldestKey = k
      oldestEntry = r
    }
  }
  if (oldestKey === undefined) return false
  tryReleaseStoreShardLock(store, rootId, oldestEntry)
  map.delete(oldestKey)
  if (map.size === 0) reservations.delete(rootId)
  return true
}

async function liveRunningChildren(ctx, rootSessionId, store) {
  const maxDepth = maxDepthOf(rootDirOfCtx(ctx, store), process.env)
  const getSvc = ctx && typeof ctx.get === 'function' ? (k) => ctx.get(k) : () => undefined
  const subagents = getSvc('subagents')
  const sessionsSvc = getSvc('sessions')
  const hasSubagents = Boolean(subagents && typeof subagents.listChildren === 'function')
  const hasSessions = Boolean(sessionsSvc && typeof sessionsSvc.list === 'function')

  if (!hasSubagents && !hasSessions) {
    return {
      available: false, running: 0, directRunning: 0, maxObservedDepth: 0, maxDepth,
      error: 'subagents 注册表不可用（按内存租约计数）',
    }
  }
  try {
    const sessionChildrenByParent = new Map()
    if (hasSessions) {
      try {
        const rawSessions = await sessionsSvc.list()
        const rows = Array.isArray(rawSessions) ? rawSessions : (rawSessions && Array.isArray(rawSessions.items) ? rawSessions.items : [])
        pruneClosedRootSessions(rows, store)
        for (const s of rows) {
          if (!s || s.id === undefined || s.id === null) continue
          const parentSid = parentSessionIdOf(s)
          if (!parentSid) continue
          if (!sessionChildrenByParent.has(parentSid)) sessionChildrenByParent.set(parentSid, [])
          sessionChildrenByParent.get(parentSid).push({
            id: String(s.id), kind: 'child',
            activity: s.activity || s.status || s.state || (s.running === true ? 'running' : 'idle'),
            label: s.label || (s.header && s.header.title) || s.title || String(s.id),
          })
        }
      } catch { /* fallback to subagents.listChildren */ }
    }
    const rootKey = String(rootSessionId)
    const visited = new Set([rootKey])
    const queue = [{ id: rootKey, depth: 0 }]
    const runningIds = new Set()
    const directRunningIds = new Set()
    const runningLabels = []
    const allDescendants = new Set()
    let maxObservedDepth = 0

    while (queue.length > 0) {
      const current = queue.shift()
      if (current.depth >= maxDepth) continue
      const merged = new Map()
      if (hasSubagents) {
        const entries = await subagents.listChildren(current.id)
        for (const e of (Array.isArray(entries) ? entries : [])) {
          if (!e || (e.kind !== undefined && e.kind !== 'child')) continue
          const cid = String(e.id ?? e.sessionId ?? e.childId ?? '')
          if (cid) merged.set(cid, e)
        }
      }
      for (const sc of (sessionChildrenByParent.get(current.id) || [])) {
        if (!merged.has(sc.id)) merged.set(sc.id, sc)
        else if (merged.get(sc.id).activity !== 'running' && sc.activity === 'running') {
          merged.set(sc.id, Object.assign({}, merged.get(sc.id), { activity: 'running' }))
        }
      }
      const childDepth = current.depth + 1
      for (const [cid, entry] of merged.entries()) {
        if (cid === rootKey) continue
        allDescendants.add(cid)
        if (childDepth > maxObservedDepth) maxObservedDepth = childDepth
        const isRunning = entry.activity === 'running' || entry.status === 'running' || entry.state === 'running' || entry.running === true
        if (isRunning && !runningIds.has(cid)) {
          runningIds.add(cid)
          if (childDepth === 1) directRunningIds.add(cid)
          runningLabels.push(entry.label || entry.title || cid)
        }
        if (!visited.has(cid) && childDepth < maxDepth) {
          visited.add(cid)
          queue.push({ id: cid, depth: childDepth })
        }
      }
    }
    return {
      available: true, running: runningIds.size, directRunning: directRunningIds.size,
      maxObservedDepth, maxDepth, running_labels: runningLabels.slice(0, 20), total_children: allDescendants.size,
    }
  } catch (error) {
    return {
      available: false, running: 0, directRunning: 0, maxObservedDepth: 0, maxDepth,
      error: '列子会话失败：' + (error && error.message ? error.message : String(error)),
    }
  }
}

/* ── 12 工具业务逻辑辅助 ─────────────────────────────────────────────────── */

async function callStoreMethod(store, fn, engagementId, payload) {
  const src = Function.prototype.toString.call(fn)
  const firstParam = (src.match(/^[^(]*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1] || ''
  const expectsIdFirst = /^(id|engId|engagementId|engagement)$/i.test(firstParam)
    && !new RegExp('typeof\\s+' + firstParam + '\\s*===\\s*[\'"]object[\'"]').test(src)
  return expectsIdFirst ? await fn.call(store, engagementId, payload) : await fn.call(store, payload)
}

function handleCheckScope(store, engagementId, args) {
  const candidates = Array.from(new Set([
    args.candidate_path,
    args.path,
    args.file,
    ...(Array.isArray(args.files_touched) ? args.files_touched : []),
    ...(Array.isArray(args.files) ? args.files : []),
  ].filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())))
  if (candidates.length === 0) {
    return { ok: false, action: 'check_scope', engagement: engagementId ?? null, allowed: false, reason: 'empty_path', error: 'candidate_path (or path/file/files_touched) required' }
  }
  const activeLocks = engagementId && typeof store.listShardLocks === 'function'
    ? store.listShardLocks(engagementId, { status: 'active' })
    : []
  let filesOwned = Array.isArray(args.files_owned) && args.files_owned.length > 0
    ? normalizeFilesOwned(args.files_owned)
    : []
  let workerName = String(args.worker_name || args.label || '').trim()
  if (filesOwned.length === 0 && engagementId && typeof store.workflowDag === 'function') {
    try {
      const dag = store.workflowDag(engagementId)
      const tasks = Array.isArray(dag && dag.worker_tasks) ? dag.worker_tasks : []
      const taskId = args.worker_task_id !== undefined && args.worker_task_id !== null ? String(args.worker_task_id).trim() : ''
      const matched = tasks.find((t) => (taskId && String(t.id) === taskId) || (workerName && t.worker_name === workerName))
      if (matched) {
        if (Array.isArray(matched.files_owned)) filesOwned = normalizeFilesOwned(matched.files_owned)
        if (!workerName && matched.worker_name) workerName = matched.worker_name
      }
    } catch { /* ignore */ }
  }
  const results = candidates.map((c) => checkFileAgainstShardLocks(filesOwned, activeLocks, workerName, c))
  const blocked = results.filter((r) => !r.allowed)
  const allowed = blocked.length === 0
  const first = blocked[0] || results[0]
  return {
    ok: allowed,
    action: 'check_scope',
    engagement: engagementId ?? null,
    allowed,
    reason: first.reason,
    candidate_path: first.candidate_path,
    conflicting_lock: first.conflicting_lock,
    files_owned: filesOwned,
    results,
    blocked,
  }
}

function recordScoreHitArtifact(store, id, args) {
  assertBoundaryGate(args, args.code)
  const result = store.addScoreHit(id, { ...args, engagement: undefined })
  let stepId = null
  let stepHint = null
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  if (command !== '') {
    try {
      const point = (store.listScorePoints(id).items || []).find((p) => Number(p.id) === Number(result.point_id))
      let scope
      if (args.asset_id !== undefined && args.asset_id !== null) {
        try { scope = store.getAsset(id, args.asset_id).scope } catch { /* infer from target */ }
      }
      const stageCode = scoreStageOf({ code: point && point.code, target: args.target }, scope)
      const step = store.addChainStep(id, {
        stage: 'exploit', stage_code: stageCode,
        title: (point && point.name) || '里程碑达成动作',
        tool: command,
        result: args.result || args.evidence,
        asset_id: args.asset_id, vuln_id: args.vuln_id,
        agent: agentOf(args), recorded_by: args.recorded_by || args.agent,
      })
      stepId = step.id
      store.linkScoreHitStep(id, result.id, stepId)
    } catch (error) {
      stepHint = '里程碑已记录，但自动关联工作流步骤失败：' + (error && error.message ? error.message : String(error))
    }
  }
  return { ok: true, engagement: id, ...result, step_id: stepId, step_hint: stepHint || undefined }
}

function recordPatternArtifact(store, args) {
  const act = String(args.action || '').trim()
  if (act === 'use' || (args.used_on && !args.title && !args.patch)) {
    return store.markPocUsed(args.id !== undefined ? args.id : args.code, args.used_on || args.target)
  }
  if (act === 'update' || (!args.title && (args.id !== undefined || args.code) && (args.patch || args.verified !== undefined || args.verified_note !== undefined))) {
    const patch = Object.assign({}, args.patch || {})
    if (args.verified !== undefined) patch.verified = args.verified
    if (args.verified_note !== undefined) patch.verified_note = args.verified_note
    if (args.content !== undefined) patch.content = args.content
    if (args.usage !== undefined) patch.usage = args.usage
    if (args.description !== undefined) patch.description = args.description
    const row = store.updatePoc(args.id !== undefined ? args.id : args.code, patch)
    return { ok: true, id: row.id, code: row.code, verified: row.verified === 1, verified_note: row.verified_note, updated_at: row.updated_at }
  }
  const payload = Object.assign({}, args, {
    kind: args.poc_kind || args.subkind || 'poc',
    asset_target: args.asset_target || args.target,
    found_by_agent: args.found_by_agent || args.agent,
    created_by: args.created_by || args.agent,
  })
  if (typeof args.engagement === 'string' && args.engagement.trim() !== '') {
    const wanted = args.engagement.trim()
    const hit = findEngagementIn(store.listEngagements(), wanted)
    payload.engagement_id = hit ? hit.id : wanted
    payload.engagement_name = hit ? hit.name : wanted
  }
  const r = store.savePoc(payload)
  const stats = store.pocStats()
  return {
    ok: true, created: r.created, code: r.poc.code, path: r.path,
    category: r.poc.category, engagement: r.poc.engagement_name || r.poc.engagement_id || null,
    asset_target: r.poc.asset_target || null, created_at: r.poc.created_at,
    verified: r.poc.verified === 1, total: stats.total,
  }
}

function recordBatchArtifacts(store, id, batchKind, args) {
  const items = Array.isArray(args.items) ? args.items : []
  const limit = batchKind === 'assets' ? 500 : 200
  if (items.length === 0 || items.length > limit) throw new Error(`items 数量必须在 1..${limit}`)
  const rejected = []
  const results = []
  if (batchKind === 'assets') {
    const accepted = []
    for (const it of items) {
      const check = scopeCheck(store, id, it && it.ip)
      if (check.status === 'out') { rejected.push({ ip: it && it.ip, reason: 'out_of_scope', scope: check.scope }); continue }
      if (!it || typeof it.ip !== 'string' || it.ip.trim() === '') { rejected.push({ item: it, reason: 'ip required' }); continue }
      accepted.push(it)
    }
    const out = accepted.length > 0
      ? store.importBundle(id, { scan: { tool: 'lmt_artifact_record', argv: ['assets'] }, assets: accepted })
      : { counts: { assets: 0 } }
    return { ok: true, engagement: id, kind: batchKind, accepted: accepted.length, rejected: rejected.length, counts: out.counts, rejected }
  }
  if (batchKind === 'assess') {
    for (const it of items) {
      try { results.push(store.assessAsset(id, it || {})) }
      catch (error) { rejected.push({ item: it, reason: error && error.message ? error.message : String(error) }) }
    }
    return { ok: true, engagement: id, kind: batchKind, assessed: results.length, rejected: rejected.length, results, rejected }
  }
  for (const it of items) {
    const check = scopeCheck(store, id, it && it.target)
    if (check.status === 'out') { rejected.push({ target: it && it.target, reason: 'out_of_scope', scope: check.scope }); continue }
    try {
      const { result: v, httpEvidenceId } = addVulnWithEvidence(store, id, it, agentOf(args))
      results.push({ id: v.id, updated: v.updated === true, http_evidence_id: httpEvidenceId })
    } catch (error) { rejected.push({ item: it, reason: error && error.message ? error.message : String(error) }) }
  }
  return { ok: true, engagement: id, kind: batchKind, inserted: results.length, rejected: rejected.length, results, rejected }
}

function recordArtifact(store, exec, args) {
  const kind = String(args.kind || '').trim()
  if (kind === 'pattern') return recordPatternArtifact(store, args)

  const id = resolveEngagement(store, exec, args.engagement)
  if (kind === 'assets' || kind === 'assess' || kind === 'vulns') {
    if (kind === 'assess' && !Array.isArray(args.items)) {
      return { ok: true, engagement: id, ...store.assessAsset(id, { ...args, engagement: undefined }) }
    }
    return recordBatchArtifacts(store, id, kind, args)
  }
  if (kind === 'module') {
    if (Array.isArray(args.items)) {
      return recordBatchArtifacts(store, id, args.action === 'assess' ? 'assess' : 'assets', args)
    }
    if (args.src_kind && args.dst_kind && args.relation) {
      const r = store.importBundle(id, { edges: [{ src_kind: args.src_kind, src_id: args.src_id, dst_kind: args.dst_kind, dst_id: args.dst_id, relation: args.relation, confidence: args.confidence }] })
      return { ok: true, engagement: id, edges: r.counts.edges }
    }
    if (args.ip && (args.ports || args.names || args.provenance || args.discovered_at || args.first_seen || args.primary_name || (!args.status && !args.test && !args.notes && !args.priority))) {
      const assetObj = {
        ip: args.ip, state: args.state, primary_name: args.primary_name,
        provenance: args.provenance || 'active', tool: args.tool,
        names: args.names, ports: args.ports,
        discovered_at: args.discovered_at, first_seen: args.first_seen,
      }
      const counts = (args.ports || args.names || args.provenance)
        ? store.importBundle(id, { scan: { tool: args.tool, argv: ['lmt_artifact_record'] }, assets: [assetObj] }).counts
        : (store.upsertAsset(id, assetObj), { assets: 1 })
      if (args.status || args.test || args.notes || args.surface !== undefined || args.blocked !== undefined) {
        store.updateAssetTest(id, { ...args, engagement: undefined })
      }
      if (args.priority || args.potential || args.reason) {
        store.assessAsset(id, { ...args, engagement: undefined })
      }
      const written = store.listAssets(id, { ip: args.ip, limit: 1 }).items[0]
      return { ok: true, engagement: id, counts, asset: written ? compactAsset(written) : null, discovered_at: written ? written.discovered_at : null }
    }
    if (args.asset_id !== undefined || args.ip) {
      if ((args.priority || args.potential || args.reason) && !args.status && !args.test && !args.notes && args.surface === undefined) {
        return { ok: true, engagement: id, ...store.assessAsset(id, { ...args, engagement: undefined }) }
      }
      return { ok: true, engagement: id, ...store.updateAssetTest(id, { ...args, engagement: undefined }) }
    }
    throw new Error('module 写入需提供 ip 或 asset_id')
  }
  if (kind === 'finding') {
    if (Array.isArray(args.items)) return recordBatchArtifacts(store, id, 'vulns', args)
    if (args.action === 'update' || (args.id !== undefined && !args.title)) {
      const res = store.updateVuln(id, args.id, { status: args.status, severity: args.severity, evidence: args.evidence, confidence: args.confidence, gained: args.gained, title: args.title, agent: agentOf(args) })
      return { ok: res.updated, engagement: id, ...res, stats: store.vulnStats(id) }
    }
    const evText = [args.evidence, args.recommendation].filter((x) => typeof x === 'string' && x.trim() !== '').join('\n建议：')
    const { result, httpEvidenceId } = addVulnWithEvidence(store, id, { ...args, evidence: evText || args.description }, agentOf(args))
    return { ok: true, engagement: id, ...result, http_evidence_id: httpEvidenceId, stats: store.vulnStats(id) }
  }
  if (kind === 'milestone' || (kind === 'evidence' && (args.code || args.point_id !== undefined || args.point_name))) {
    return recordScoreHitArtifact(store, id, args)
  }
  if (kind === 'tunnel' || (kind === 'contract' && (args.listen || args.tunnel_kind || args.entry_kind !== undefined))) {
    if (args.action === 'update' || args.id !== undefined) {
      return { ok: true, engagement: id, ...store.updateTunnel(id, args.id, args) }
    }
    return { ok: true, engagement: id, ...store.addTunnel(id, { ...args, kind: args.tunnel_kind || args.subkind || 'socks5', engagement: undefined, status: args.status || 'active', agent: agentOf(args) }) }
  }
  if (kind === 'data_proof' || (kind === 'evidence' && (args.fields || args.row_count !== undefined))) {
    return { ok: true, engagement: id, proof: store.addDataProof(id, { ...args, created_by: agentOf(args) }) }
  }
  if (kind === 'cleanup' || (kind === 'contract' && (args.cleanup_kind || args.location))) {
    if (args.action === 'update' || args.id !== undefined) {
      return { ok: true, engagement: id, item: store.updateCleanup(id, args) }
    }
    return { ok: true, engagement: id, item: store.addCleanup(id, { ...args, kind: args.cleanup_kind || args.subkind || 'other', created_by: agentOf(args) }) }
  }
  if (kind === 'contract') {
    if (args.src_kind && args.dst_kind && args.relation) {
      const r = store.importBundle(id, { edges: [{ src_kind: args.src_kind, src_id: args.src_id, dst_kind: args.dst_kind, dst_id: args.dst_id, relation: args.relation, confidence: args.confidence }] })
      return { ok: true, engagement: id, edges: r.counts.edges }
    }
    if (args.priority || args.potential || args.reason) {
      return { ok: true, engagement: id, ...store.assessAsset(id, { ...args, engagement: undefined }) }
    }
    if (args.name && (args.content || args.path)) {
      return { ok: true, engagement: id, ...store.addAttackFile(id, { ...args, kind: args.poc_kind || args.subkind || 'other', target: args.target || 'contracts', evidence: args.evidence || args.summary || args.description || 'contract frozen' }) }
    }
    return {
      ok: true, engagement: id,
      ...store.addChainStep(id, {
        stage: 'recon', stage_code: args.stage_code || 'recon',
        title: args.title || '契约冻结', detail: args.summary || args.evidence || args.description,
        evidence_ref: args.target, tool: args.command || args.tool, result: args.result, agent: agentOf(args),
      }),
    }
  }
  if (kind === 'spec') {
    return {
      ok: true, engagement: id,
      ...store.addChainStep(id, {
        stage: 'recon', stage_code: 'recon',
        title: args.title || '规格定义', detail: args.summary || args.evidence || args.description,
        evidence_ref: args.target, agent: agentOf(args),
      }),
    }
  }
  /* kind === 'evidence' (shot | attack_file | http_evidence | chain_step) */
  if ((args.path || args.data_base64) && !args.name) {
    return { ok: true, engagement: id, ...store.addShot(id, { ...args, kind: args.subkind === 'card' ? 'card' : 'screenshot', engagement: undefined, agent: agentOf(args) }) }
  }
  if (args.name && (args.content || args.path)) {
    return { ok: true, engagement: id, ...store.addAttackFile(id, { ...args, kind: args.poc_kind || args.subkind || 'script', engagement: undefined }) }
  }
  if (args.request) {
    return { ok: true, engagement: id, ...store.addHttpEvidence(id, { ...args, engagement: undefined }) }
  }
  return {
    ok: true, engagement: id,
    ...store.addChainStep(id, {
      stage: 'exploit', stage_code: args.stage_code || 'internal',
      title: args.title || args.label || '验证证据',
      detail: args.evidence || args.summary || args.description,
      tool: args.command || args.tool, result: args.result || args.evidence,
      asset_id: args.asset_id, vuln_id: args.vuln_id, agent: agentOf(args),
    }),
  }
}

function queryPatternArtifacts(store, args) {
  if (args.id !== undefined || (typeof args.code === 'string' && args.code.trim() !== '' && !args.q && !args.category && !args.verified)) {
    const row = store.getPoc(args.id !== undefined ? args.id : args.code)
    if (row === undefined) return { ok: false, error: '知识库没有这一条' }
    return { ok: true, ...row }
  }
  /* 外层 kind='pattern' 只用于分发工具，不能透传成 searchPocs 的 poc.kind 过滤条件 */
  const pocFilter = Object.assign({}, args, { kind: args.subkind || undefined })
  const items = store.searchPocs(pocFilter)
  const stats = store.pocStats()
  const q = args.q || args.cve || args.component || ''
  const tplStats = store.templateStats()
  const tpl = q
    ? store.searchTemplates(q, Math.min(Number(args.templateLimit) || 20, 100))
    : { dir: tplStats.dir || store.nucleiTemplatesDir() || null, total: tplStats.total, items: [] }
  const hit = items.length > 0 || (tpl.items || []).length > 0
  return {
    ok: true,
    knowledge_base: {
      total: stats.total, verified: stats.verified, reused: stats.reused,
      by_category: (stats.byCategory || []).filter((c) => c.n > 0).map((c) => c.name + ' ' + c.n + '（已验证 ' + c.verified + '）'),
      by_engagement: (stats.byEngagement || []).slice(0, 10).map((e) => e.engagement + ' ' + e.n),
    },
    local_templates: { dir: tplStats.dir, total: tplStats.total, cve_templates: tplStats.cve, matched: (tpl.items || []).length },
    count: items.length,
    hint: hit
      ? '命中现成的：可用 lmt_artifact_query(kind=pattern, code=...) 取全文；本地模板直接用 `nuclei -t <path>`。复用后用 lmt_artifact_record(kind=pattern, action=use) 记录。'
      : '知识库与本机模板库都没有：可先通过互联网搜索或自行编写验证脚本，实测有效后用 lmt_artifact_record(kind=pattern) 回填。',
    templates: (tpl.items || []).map((t) => ({ path: t.path, name: t.name, severity: t.severity, tags: t.tags })),
    items: items.map((x) => ({
      id: x.id, code: x.code, title: x.title, kind: x.kind, category: x.category, cve: x.cve, component: x.component,
      versions: x.versions, language: x.language, source: x.source, source_url: x.source_url,
      verified: x.verified === 1, verified_note: x.verified_note, hit_count: x.hit_count,
      engagement: x.engagement_name || x.engagement_id || null, asset_target: x.asset_target || null,
      found_by_agent: x.found_by_agent || null, created_at: x.created_at,
      tags: x.tags, usage: x.usage, path: x.path, has_content: x.has_content === 1,
    })),
  }
}

function queryArtifacts(store, exec, args) {
  const kind = String(args.kind || '').trim()
  if (kind === 'pattern') return queryPatternArtifacts(store, args)

  const id = resolveEngagement(store, exec, args.engagement)
  if (kind === 'module') {
    if (args.id !== undefined) {
      const asset = store.getAsset(id, args.id)
      return asset === undefined ? { ok: false, error: 'asset not found' } : { ok: true, engagement: id, asset }
    }
    const limit = Math.min(Number(args.limit) || 50, 200)
    const result = store.listAssets(id, {
      cidr: args.cidr, port: args.port, service: args.service, fingerprint: args.fingerprint,
      provenance: args.provenance, q: args.q, state: args.state, scope: args.scope,
      sort: args.sort, assessed: args.assessed, limit, offset: Math.max(Number(args.offset) || 0, 0),
    })
    return { ok: true, engagement: id, total: result.total, returned: result.items.length, items: result.items.map(compactAsset) }
  }
  const listOpts = Object.assign({}, args, { engagement: undefined, kind: args.subkind || undefined })
  if (kind === 'finding') {
    const result = store.listVulns(id, { ...listOpts, limit: Math.min(Number(args.limit) || 50, 200) })
    return { ok: true, engagement: id, total: result.total, items: result.items, stats: store.vulnStats(id) }
  }
  if (kind === 'timeline') {
    const data = store.discoveryTimeline(id, { limit: args.limit })
    return {
      ok: true, engagement: id, span: data.span, days: data.days,
      recent: data.recent.map((a) => ({
        id: a.id, ip: a.ip, scope: a.scope, state: a.state, name: a.primary_name,
        discovered_at: a.discovered_at, last_seen: a.last_seen, open_ports: a.open_ports, priority: a.priority,
      })),
    }
  }
  if (kind === 'stats' || kind === 'scores') {
    const board = store.listScorePoints(id, {})
    const groups = (board.ruleGroups || []).map((g) => ({ category: g.name, items: g.tiers.length, points: g.points, cap_sum: g.capSum }))
    const items = board.items.map((p) => ({
      id: p.id, code: p.code, name: p.name, category: p.category, points: p.points,
      tier: p.tier, cap: p.cap, cap_used: p.cap_used, dedup_scope: p.dedup_scope, scope_label: p.scope_label,
      enabled: p.enabled, achieved: p.hits.length > 0, hits: p.hits.length, counted: p.counted, earned: p.earned,
      capped: p.capped, capped_summary: p.service_summary, evidence_need: p.evidence_need, evidence_proof: p.evidence_proof,
      evidence: p.hits.map((h) => (h.target ? h.target + '：' : '') + h.evidence).slice(0, 3),
    }))
    if (kind === 'scores') return { ok: true, engagement: id, summary: board.summary, groups, items }
    return {
      ok: true, engagement: id,
      stats: store.stats(id), segments: store.listSegments(id),
      vulns: store.vulnStats(id), tests: store.testStats(id),
      summary: board.summary, groups, items,
    }
  }
  if (kind === 'chain') {
    const chain = store.scoreChain(id)
    return {
      ok: true, engagement: id,
      totals: {
        points: chain.summary.points, totalPoints: chain.summary.totalPoints,
        hits: chain.summary.hits, serviceCappedHits: chain.summary.serviceCappedHits || 0,
      },
      stages: (chain.stages || []).map((st) => ({
        code: st.code, name: st.name, goal: st.goal,
        points: st.points, cumulative: st.cumulative, counted: st.counted, hits: st.hits,
        steps: st.steps, tools: st.tools,
        scored: st.items.map((x) => ({
          point: x.point_name, points: x.points, counted: x.counted, target: x.target,
          service: x.service || null, capped: x.capped === true, capped_reason: x.capped_reason || null,
        })),
      })),
      steps: store.listChain(id),
    }
  }
  if (kind === 'graph') {
    const maxNodes = Math.min(Number(args.limit) || 400, 1500)
    const graph = store.attackGraph(id, { cidr: args.cidr })
    if (graph.nodes.length > maxNodes) {
      return { ok: false, error: `图谱节点过多（${graph.nodes.length} > ${maxNodes}），请指定 cidr 缩小范围`, summary: graph.summary }
    }
    return {
      ok: true, engagement: id, summary: graph.summary,
      owned: graph.nodes.filter((n) => n.meta && n.meta.owned).map((n) => n.label),
      nodes: graph.nodes, edges: graph.edges,
    }
  }
  if (kind === 'tunnels') return { ok: true, engagement: id, items: store.listTunnels(id, listOpts) }
  if (kind === 'shots') return { ok: true, engagement: id, ...store.listShots(id, listOpts) }
  if (kind === 'data_proofs') return { ok: true, engagement: id, ...store.listDataProofs(id, listOpts) }
  if (kind === 'cleanup') return { ok: true, engagement: id, ...store.listCleanup(id, listOpts) }
  if (kind === 'files') return { ok: true, engagement: id, items: store.listAttackFiles(id, listOpts), folders: store.attackFileTree(id) }
  throw new Error('unsupported artifact query kind: ' + kind)
}

/* ── 角色工具裁剪（profile 缺省 all 不裁剪）───────────────────────────────── */

const WORKER_EXCLUDES = new Set(['lmt_engagement_open', 'lmt_session_bind', 'lmt_report_export'])
const PROFILE_EXCLUDES = {
  recon: WORKER_EXCLUDES,
  designer: WORKER_EXCLUDES,
  assess: WORKER_EXCLUDES,
  'vuln-scan': WORKER_EXCLUDES,
  exploit: WORKER_EXCLUDES,
  qa: WORKER_EXCLUDES,
  internal: new Set(['lmt_engagement_open', 'lmt_session_bind']),
}

/* ── 插件主入口：注册 12 个精简 lmt_* 工具 ───────────────────────────────── */

export function apply(ctx, config = {}) {
  const store = resolveStore(ctx, config)
  const profile = String((config && config.profile) || 'all').trim()
  const excluded = PROFILE_EXCLUDES[profile]
  const registerTool = (tool) => {
    if (excluded !== undefined && excluded.has(tool.name)) return
    ctx.tools.register(tool)
  }
  const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  const DEFAULT_OUTPUT = { schema: { type: 'string' }, render: (_args, value) => text(value) }
  const formatToolResult = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  const regTool = (spec, withEngagement = false) => {
    const { execute, ...def } = spec
    registerTool(withStructuredErrors(defineTool({
      ...def,
      output: spec.output || DEFAULT_OUTPUT,
      async execute(args, exec) {
        const res = withEngagement
          ? await execute(args || {}, resolveEngagement(store, exec, args && args.engagement), exec)
          : await execute(args || {}, exec)
        return formatToolResult(res)
      },
    })))
  }
  const regEngTool = (spec) => regTool(spec, true)

  /* 子智能体结束时自动回收并发槽与 ShardLock */
  try {
    ctx.on('subagent/end', (info, parent) => {
      pruneExpiredReservations(Date.now(), store)
      try {
        const sessionsSvc = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
        if (sessionsSvc && typeof sessionsSvc.list === 'function') {
          const maybeList = sessionsSvc.list()
          if (Array.isArray(maybeList)) pruneClosedRootSessions(maybeList, store)
          else if (maybeList && typeof maybeList.then === 'function') {
            maybeList.then((rows) => pruneClosedRootSessions(Array.isArray(rows) ? rows : (rows && rows.items), store)).catch(() => {})
          }
        }
      } catch { /* ignore */ }

      const parentSessionObj = (parent && parent.session)
        ?? (info && info.parentSession && typeof info.parentSession === 'object' ? info.parentSession : undefined)
      const { rootId: resolvedRoot } = bindingKeyOf({ agent: { session: parentSessionObj } })
      const rawParentId = info && info.parentSession !== undefined && info.parentSession !== null
        ? (typeof info.parentSession === 'object' ? info.parentSession.id : info.parentSession)
        : (info && info.parentId !== undefined && info.parentId !== null ? info.parentId : undefined)
      const rootId = resolvedRoot ?? (rawParentId !== undefined && rawParentId !== null ? String(rawParentId) : undefined)
      if (rootId === undefined) return

      const map = reservations.get(rootId)
      if (map === undefined || map.size === 0) return

      const childObj = info && info.childSession && typeof info.childSession === 'object' ? info.childSession : info
      const rawChildId = (childObj && (childObj.id ?? childObj.sessionId ?? childObj.childId))
        ?? (info && (info.id ?? info.sessionId ?? info.childId))
      const childId = rawChildId !== undefined && rawChildId !== null ? String(rawChildId) : undefined
      const rawLabel = (childObj && (childObj.label ?? childObj.name)) ?? (info && (info.label ?? info.name))
      const childLabel = typeof rawLabel === 'string' && rawLabel.trim() !== '' ? rawLabel.trim() : undefined
      const rawTitle = (childObj && (childObj.title ?? (childObj.header && childObj.header.title)))
        ?? (info && (info.title ?? (info.header && info.header.title)))
      const childTitle = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : undefined

      for (const [k, r] of map.entries()) {
        const matched = (childId !== undefined && (r.childId === childId || r.key === childId))
          || (childLabel !== undefined && Boolean(r.label) && r.label === childLabel)
          || (Boolean(childTitle) && Boolean(r.label) && childTitle.includes(r.label))
        if (matched) {
          tryReleaseStoreShardLock(store, rootId, r)
          map.delete(k)
          if (map.size === 0) reservations.delete(rootId)
          return
        }
      }
      dropOldestReservation(rootId, store)
    })
  } catch { /* ignore when event bus unavailable */ }

  /* 1. lmt_workflow */
  regTool({
    name: 'lmt_workflow',
    description: '4-Wave DAG orchestrator: refine_wish, decompose, submit_digest, approve_worker, update_goal, add_worker, retry_worker, sync_workers, check_scope, rollback_scope, dag, status.',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['refine_wish', 'decompose', 'submit_digest', 'approve_worker', 'update_goal', 'add_worker', 'retry_worker', 'sync_workers', 'check_scope', 'rollback_scope', 'dag', 'status'],
      },
      engagement: { type: 'string' },
      wave: { type: 'string' },
      user_prompt: { type: 'string' },
      commit: { type: 'boolean' },
      require_ai: { type: 'boolean' },
      allow_static_fallback: { type: 'boolean' },
      goals: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string' }, wave: { type: 'string' }, role: { type: 'string' },
            worker_name: { type: 'string' }, title: { type: 'string' }, assigned_goal: { type: 'string' },
            ui_priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
            files_owned: { type: 'array', items: { type: 'string' } },
            depends_on: { type: 'array', items: { type: 'string' } },
            acceptance_criteria: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      worker_name: { type: 'string' },
      worker_task_id: { type: 'string' },
      role: { type: 'string' },
      title: { type: 'string' },
      assigned_goal: { type: 'string' },
      files_owned: { type: 'array', items: { type: 'string' } },
      depends_on: { type: 'array', items: { type: 'string' } },
      candidate_path: { type: 'string' },
      path: { type: 'string' },
      file: { type: 'string' },
      files_touched: { type: 'array', items: { type: 'string' } },
      files_to_rollback: { type: 'array', items: { type: 'string' } },
      what_was_done: { type: 'string' },
      key_decisions: { type: 'array', items: { type: 'string' } },
      verification: { type: 'string' },
      raw_tokens_estimate: { type: 'number' },
      digest_tokens_estimate: { type: 'number' },
      decision: { type: 'string', enum: ['approved', 'revision_requested', 'rejected'] },
      next_goal: { type: 'string' },
      next_wave: { type: 'string' },
      next_role: { type: 'string' },
      review_note: { type: 'string' },
      reason: { type: 'string' },
      ui_priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      tags: { type: 'array', items: { type: 'string' } },
      workers: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string' }, session_id: { type: 'string' }, worker_name: { type: 'string' },
            role: { type: 'string' }, wave: { type: 'string' }, status: { type: 'string' },
            ui_priority: { type: 'string' }, assigned_goal: { type: 'string' },
            files_owned: { type: 'array', items: { type: 'string' } },
            turns: { type: 'number' }, tool_calls: { type: 'number' },
          },
        },
      },
    },
    async execute(args, exec) {
      const rawAction = String(args.action || 'status').trim()
      let engagementId = args.engagement_id || args.engagement
      if (!engagementId) {
        try { engagementId = resolveEngagement(store, exec, undefined) } catch { engagementId = undefined }
      }
      if (rawAction === 'check_scope') return handleCheckScope(store, engagementId, args)
      if (rawAction === 'status' || rawAction === 'dag') {
        if (typeof store?.workflowDag === 'function') {
          return Object.assign({ ok: true, action: rawAction }, store.workflowDag(engagementId))
        }
        return { ok: true, action: rawAction, engagement: engagementId ?? null, hasStarted: false, nodes: [], edges: [] }
      }
      if (rawAction === 'rollback_scope') {
        if (typeof store?.recordScopeRollback === 'function') {
          return Object.assign({ action: 'rollback_scope' }, store.recordScopeRollback(engagementId, args.worker_task_id || args.worker_name, {
            rolled_back: args.files_to_rollback || [],
            skipped_untracked: [],
          }))
        }
        return { ok: true, action: 'rollback_scope', engagement_id: engagementId ?? null }
      }

      const normalizedFilesOwned = Array.isArray(args.files_owned) ? normalizeFilesOwned(args.files_owned) : undefined
      const payload = Object.assign(
        {},
        args,
        normalizedFilesOwned !== undefined ? { files_owned: normalizedFilesOwned } : {},
        engagementId ? { engagement: engagementId, engagement_id: engagementId } : {},
      )
      const directMethods = {
        refine_wish: 'refineUserWish',
        decompose: 'decomposeUserPrompt',
        submit_digest: 'submitWorkerDigest',
        approve_worker: 'approveWorkerAndDispatchNext',
        update_goal: 'updateWorkerGoal',
        add_worker: 'addCustomWorkerTask',
        retry_worker: 'retryWorkerTask',
      }
      const methodName = directMethods[rawAction]
      let out
      if (rawAction === 'sync_workers') {
        if (typeof store?.syncHostWorkersToPg === 'function') {
          out = await store.syncHostWorkersToPg(engagementId, payload.workers || [], payload)
        } else if (typeof store?.workflowAction === 'function') {
          out = await store.workflowAction(engagementId, Object.assign({}, payload, { action: 'sync_workers' }))
        }
      } else if (methodName && typeof store?.[methodName] === 'function') {
        out = await callStoreMethod(store, store[methodName], engagementId, payload)
      } else if (typeof store?.workflowAction === 'function') {
        out = await store.workflowAction(engagementId, Object.assign({}, payload, { action: rawAction }))
      }
      if (out === undefined) out = { ok: true, action: rawAction, engagement_id: engagementId ?? null }
      if (typeof out === 'string') return out
      return Object.assign({ ok: true, action: rawAction, engagement: engagementId ?? null }, out)
    },
  })

  /* 2. lmt_agent_slot */
  regTool({
    name: 'lmt_agent_slot',
    description: 'Concurrency lease & ShardLock gate: status, acquire, heartbeat, release, list_locks.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'acquire', 'heartbeat', 'release', 'list_locks'] },
      label: { type: 'string' },
      key: { type: 'string' },
      child_id: { type: 'string' },
      worker_task_id: { type: 'string' },
      wave: { type: 'string' },
      files_owned: { type: 'array', items: { type: 'string' } },
    },
    async execute(args, exec) {
      const { rootId, sessionId } = bindingKeyOf(exec)
      const owner = rootId ?? sessionId
      if (owner === undefined) {
        return { ok: false, error: '取不到会话 id：无法统计并发（请携带 agent.session 上下文）。' }
      }
      const now = Date.now()
      pruneExpiredReservations(now, store)
      const live = await liveRunningChildren(ctx, owner, store)
      const reserved = reservationList(owner, now, store)
      const used = Math.max(live.running, reserved.length)
      const max = maxAgentsOf(rootDirOfCtx(ctx, store), process.env)
      const free = Math.max(max - used, 0)
      let engId
      try { engId = resolveEngagement(store, exec, undefined) } catch { engId = bindings.get(owner) }

      const base = {
        ok: true, max, used, free,
        running_from_registry: live.running,
        direct_running: live.directRunning ?? 0,
        max_observed_depth: live.maxObservedDepth ?? 0,
        max_depth: live.maxDepth,
        lease_ttl_ms: RESERVATION_TTL_MS,
        running_labels: live.running_labels ?? [],
        reservations: reserved,
        registry_available: live.available,
      }
      if (args.action === 'status') {
        return Object.assign({}, base, {
          hint: free === 0 ? '并发槽已满：等待在跑子智能体释放后再派发。' : `还有 ${free} 个并发槽可用。`,
        })
      }
      if (args.action === 'list_locks') {
        const locks = engId && typeof store?.listShardLocks === 'function'
          ? store.listShardLocks(engId, { status: 'active' })
          : []
        return Object.assign({}, base, { engagement: engId ?? null, shard_locks: locks, count: locks.length })
      }
      if (args.action === 'acquire') {
        const requestedFiles = Array.isArray(args.files_owned) ? normalizeFilesOwned(args.files_owned) : []
        if (requestedFiles.length > 0) {
          const conflictCheck = detectShardConflicts(requestedFiles, reserved)
          if (!conflictCheck.ok) {
            return Object.assign({}, base, {
              ok: false, error: '文件分片冲突（File-Disjoint Sharding Violation）', conflicts: conflictCheck.conflicts,
            })
          }
        }
        if (free <= 0) {
          return Object.assign({}, base, { ok: false, error: `并发已满（最多 ${max} 个）：请等待释放后再派新任务。` })
        }
        slotSeq += 1
        const cleanLabel = typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : 'slot'
        const key = `${cleanLabel}#${now}-${slotSeq}`
        const workerTaskId = typeof args.worker_task_id === 'string' && args.worker_task_id.trim() !== '' ? args.worker_task_id.trim() : key
        const wave = typeof args.wave === 'string' && args.wave.trim() !== '' ? args.wave.trim() : 'wave-3'
        if (requestedFiles.length > 0 && store && typeof store.acquireShardLocks === 'function') {
          const storeLock = await store.acquireShardLocks(engId || owner, {
            engagement: engId || owner,
            engagement_id: engId || owner,
            owner: key,
            worker_task_id: workerTaskId,
            worker_name: cleanLabel,
            wave,
            files_owned: requestedFiles,
            ttl_ms: RESERVATION_TTL_MS,
          })
          if (storeLock && storeLock.ok === false) {
            return Object.assign({}, base, {
              ok: false, error: '持久化文件分片锁冲突（File-Disjoint Sharding Violation）',
              conflicts: Array.isArray(storeLock.conflicts) ? storeLock.conflicts : [],
            })
          }
        }
        const entry = addReservation(owner, {
          key, label: cleanLabel,
          childId: typeof args.child_id === 'string' && args.child_id.trim() !== '' ? args.child_id.trim() : undefined,
          workerTaskId, wave, files_owned: requestedFiles, engagementId: engId,
        }, now)
        return Object.assign({}, base, {
          slot: key, key, used: used + 1, free: Math.max(max - used - 1, 0),
          files_owned: entry.files_owned, expires_at: entry.expires_at,
          reservations: reservationList(owner, now, store),
        })
      }
      if (args.action === 'heartbeat') {
        const map = reservations.get(owner)
        const wanted = String(args.key || args.child_id || args.worker_task_id || args.label || '').trim()
        const found = findReservationEntry(map, wanted)
        if (!found) {
          return Object.assign({}, base, { ok: false, renewed: false, error: '未找到匹配的活跃并发槽：' + (wanted || '(unspecified)') })
        }
        found[1].at = now
        found[1].expires_at = now + RESERVATION_TTL_MS
        return Object.assign({}, base, {
          ok: true, renewed: true, slot: found[1].key, expires_at: found[1].expires_at,
          reservations: reservationList(owner, now, store),
        })
      }
      const wantedKey = String(args.key || args.child_id || args.worker_task_id || args.label || '').trim()
      const dropped = wantedKey !== '' ? dropReservation(owner, wantedKey, store) : dropOldestReservation(owner, store)
      const remaining = reservationList(owner, now, store)
      return Object.assign({}, base, {
        ok: true, released: dropped, reservations: remaining,
        used: Math.max(live.running, remaining.length),
        free: Math.max(max - Math.max(live.running, remaining.length), 0),
      })
    },
  })

  /* 3. lmt_engagement_open */
  regTool({
    name: 'lmt_engagement_open',
    description: 'Open or create a session-isolated workspace (root session 1:1 bound; bind_current defaults false when session exists).',
    parameters: {
      name: { type: 'string', description: 'Workspace name' },
      target: { type: 'string' },
      scope: { type: 'array', items: { type: 'string' } },
      bind_current: { type: 'boolean' },
    },
    async execute(args, exec) {
      const targetName = String(args.name || args.target || '').trim()
      if (!targetName) throw new Error('name required')
      const { rootId, sessionId } = bindingKeyOf(exec)
      const hasSession = Boolean(rootId || sessionId)
      const bindCurrent = args.bind_current !== undefined ? Boolean(args.bind_current) : !hasSession
      const engagement = store.openEngagement(targetName, args.scope, { bindCurrent })
      for (const key of bindKeysOf(exec)) setBoundedBinding(key, engagement.id)
      recordSessionBinding(store, exec, engagement.id, engagement.name)
      return {
        ok: true, engagement, stats: store.stats(engagement.id),
        session: bindingViewOf(exec, store), bind_current: bindCurrent,
      }
    },
  })

  /* 4. lmt_session_bind */
  regTool({
    name: 'lmt_session_bind',
    description: 'Bind, unbind, skip, or reopen an existing workspace for the active root session.',
    parameters: {
      engagement: { type: 'string' },
      action: { type: 'string', enum: ['bind', 'skip', 'reopen', 'unbind'] },
    },
    async execute(args, exec) {
      const action = String(args.action || 'bind').trim().toLowerCase()
      const keys = bindKeysOf(exec)
      const { rootId, sessionId } = bindingKeyOf(exec)
      const rootKey = rootId || sessionId
      const list = store.listEngagements()
      const wanted = typeof args.engagement === 'string' ? args.engagement.trim() : ''
      const hit = wanted ? findEngagementIn(list, wanted) : undefined

      if (action === 'unbind') {
        for (const k of keys) bindings.delete(k)
        if (rootKey && typeof store.setSessionOnboarding === 'function') store.setSessionOnboarding(rootKey, { action: 'unbind' })
        return { ok: true, action: 'unbind', session: bindingViewOf(exec, store) }
      }
      if (action === 'skip' || action === 'reopen') {
        if (action === 'reopen') for (const k of keys) bindings.delete(k)
        if (rootKey && typeof store.setSessionOnboarding === 'function') {
          store.setSessionOnboarding(rootKey, { action, engagement: hit && hit.id, name: hit && hit.name })
        }
        return { ok: true, action, engagement: hit ? { id: hit.id, name: hit.name } : null, session: bindingViewOf(exec, store) }
      }
      if (!wanted) {
        return {
          ok: false,
          candidates: list.map((e) => ({ id: e.id, name: e.name, created_at: e.created_at, stats: e.stats })),
          note: '请传 engagement 完成绑定。',
        }
      }
      if (!hit) return { ok: false, error: '项目工作区不存在：' + wanted, candidates: list.map((e) => e.id) }
      for (const k of keys) setBoundedBinding(k, hit.id)
      recordSessionBinding(store, exec, hit.id, hit.name)
      return { ok: true, action: 'bind', engagement: { id: hit.id, name: hit.name }, session: bindingViewOf(exec, store) }
    },
  })

  /* 5. lmt_session_info */
  regTool({
    name: 'lmt_session_info',
    description: 'Return active session binding, root session id, engagement id and stats.',
    parameters: {},
    async execute(_args, exec) {
      const view = bindingViewOf(exec, store)
      const engId = view.bound_engagement ?? view.panel_follow_engagement ?? null
      const stats = engId !== null ? store.stats(engId) : null
      const state = view.root_session && typeof store.getSessionState === 'function' ? store.getSessionState(view.root_session) : null
      return {
        ok: true, engagement_id: engId, root_session: view.root_session,
        session: view, state, stats,
        bindings_now: Array.from(bindings, ([k, v]) => ({ session: k, engagement: v })),
      }
    },
  })

  /* 6. lmt_sessions */
  regTool({
    name: 'lmt_sessions',
    description: 'List engagements, sessions.json states, and active runtime endpoints/tunnels.',
    parameters: {
      engagement: { type: 'string' },
    },
    async execute(args, exec) {
      const engagements = typeof store.listEngagements === 'function' ? store.listEngagements() : []
      const sessionStates = typeof store.sessionStates === 'function' ? store.sessionStates() : {}
      let engId = null
      try { engId = resolveEngagement(store, exec, args.engagement) } catch { engId = null }
      if (!engId || typeof store.sessionSummary !== 'function') {
        return {
          ok: true, engagement: null, engagements, session_states: sessionStates,
          totals: null, webshells: [], tunnels: [],
        }
      }
      const summary = store.sessionSummary(engId)
      return {
        ok: true, engagement: engId, engagements, session_states: sessionStates,
        totals: summary.totals,
        webshells: summary.webshells.map((w) => ({
          id: w.id, url: w.url, type: w.shell_type, pass_key: w.pass_key, privilege: w.privilege,
          status: w.status, asset_ip: w.asset_ip, last_check: w.last_check, note: w.note,
        })),
        tunnels: summary.tunnels.map((t) => ({
          id: t.id, kind: t.kind, listen: t.listen, entry: t.entry, reach: t.reach,
          entry_kind: t.entry_kind, legit: t.legit, status: t.status, asset_ip: t.asset_ip, command: t.command,
        })),
        hint: '注意 legit=false（entry_kind=self-only）不算跨环境边界联调、不算突破。',
      }
    },
  })

  /* 7. lmt_preflight */
  regTool({
    name: 'lmt_preflight',
    description: 'Preflight check: workspace root, DB engine, maxAgents/maxDepth/thinkingEffort, skill availability, optional host scope & tunnel probe.',
    parameters: {
      include: { type: 'string' },
      check_host: { type: 'string' },
      target: { type: 'string' },
      listen: { type: 'string' },
      probe_targets: { type: 'array', items: { type: 'string' } },
      timeoutMs: { type: 'number' },
    },
    async execute(args, exec) {
      const wsRoot = rootDirOfCtx(ctx, store) || null
      const dbEngine = typeof store?.dbEngineInfo === 'function' ? store.dbEngineInfo() : null
      const maxAgents = maxAgentsOf(wsRoot, process.env)
      const maxDepth = maxDepthOf(wsRoot, process.env)
      const thinkingEffort = thinkingEffortOf(wsRoot, process.env)

      const view = bindingViewOf(exec, store)
      let engId = view.bound_engagement ?? view.panel_follow_engagement
      if (!engId) { try { engId = resolveEngagement(store, exec, undefined) } catch { engId = null } }

      const hostTarget = args.check_host || args.target
      let scopeRes = null
      if (hostTarget && engId) {
        const sc = scopeCheck(store, engId, hostTarget)
        scopeRes = { ok: sc.status !== 'out', target: hostTarget, ...sc }
      }

      let probeRes = null
      const probeTargets = Array.isArray(args.probe_targets) ? args.probe_targets.filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, 50) : []
      if (probeTargets.length > 0 && typeof args.listen === 'string' && args.listen.trim() !== '') {
        const probes = []
        for (const pt of probeTargets) probes.push(await socks5Probe(args.listen.trim(), pt, args.timeoutMs))
        probeRes = { ok: true, listen: args.listen.trim(), reachable: probes.filter((x) => x.ok).length, total: probes.length, probes }
      } else if (probeTargets.length > 0 && engId && typeof store?.probeSessions === 'function') {
        const probed = await store.probeSessions(engId, { timeoutMs: args.timeoutMs })
        for (const t of probed.tunnels) {
          if (t.status !== 'active' || !t.listen) continue
          t.reachable = []
          for (const pt of probeTargets) t.reachable.push(await socks5Probe(t.listen, pt, args.timeoutMs))
        }
        probeRes = probed
      }

      const skills = ctx && typeof ctx.get === 'function' ? ctx.get('skills') : undefined
      if (skills === undefined || skills === null || typeof skills.list !== 'function') {
        return {
          ok: false,
          workspace_root: wsRoot,
          db_engine: dbEngine,
          maxAgents, maxDepth, thinkingEffort,
          skills_available: 0, skills_broken: 0, skills_total: 0,
          scope_check: scopeRes || undefined,
          probe: probeRes || undefined,
          error: '技能注册表不可用：无法做技能自检。请参考 <available_skills> 人工核对。',
        }
      }

      let summaries = []
      try { summaries = await skills.list() } catch (error) {
        return { ok: false, error: '读取技能目录失败：' + (error && error.message ? error.message : String(error)) }
      }
      const only = splitList(args.include)
      const envFile = expandSkillPath('$DSH_HOME/.env')
      const effectiveEnv = { ...process.env }
      const envFileKeys = []
      try {
        if (existsSync(envFile)) {
          for (const line of readFileSync(envFile, 'utf8').split('\n')) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
            if (m === null) continue
            const val = m[2].trim().replace(/^["']|["']$/g, '')
            if (val === '') continue
            envFileKeys.push(m[1])
            if (!effectiveEnv[m[1]]) effectiveEnv[m[1]] = val
          }
        }
      } catch { /* ignore .env read errors */ }

      const rootsWith = new Map()
      for (const x of summaries) {
        const dir = x.resourceBase && x.resourceBase.kind === 'directory' ? x.resourceBase.path : null
        if (dir === null) continue
        if (!rootsWith.has(x.name)) rootsWith.set(x.name, [])
        if (!rootsWith.get(x.name).includes(dir)) rootsWith.get(x.name).push(dir)
      }
      const checked = []
      for (const s of summaries) {
        let def
        try { def = await skills.get(s.name) } catch { def = undefined }
        const path = def && typeof def.path === 'string' ? def.path : (s.resourceBase && s.resourceBase.kind === 'directory' ? s.resourceBase.path : null)
        const root = s.resourceBase && s.resourceBase.kind === 'directory' ? s.resourceBase.path : null
        const verdict = checkSkill({ name: s.name, content: def && def.content, path, root }, { env: effectiveEnv, sameNameIn: rootsWith.get(s.name) || [] })
        checked.push(Object.assign({}, verdict, {
          title: s.description, path,
          needs_user: verdict.needs_user.map((n) => (n.startsWith('环境变量') ? n + '（配置后重启生效）' : n)),
        }))
      }
      const allBroken = checked.filter((s) => s.status === 'broken')
      const allAvailable = checked.filter((s) => s.status === 'available')
      const shown = (x) => only.length === 0 || only.includes(x.name)
      const summary = summarizeSkills(checked)

      const lmtMarker = expandSkillPath('$DSH_HOME/lmtagent/.setup-complete')
      const legacyMarker = expandSkillPath('$DSH_HOME/redteam/.setup-complete')
      const storeMarker = wsRoot ? join(wsRoot, '.setup-complete') : ''
      const hasMarker = existsSync(lmtMarker) || existsSync(legacyMarker) || (storeMarker !== '' && existsSync(storeMarker))
      const fofaKey = effectiveEnv.FOFA_KEY || ''
      const vpsKey = effectiveEnv.REDTEAM_VPS_KEY || expandSkillPath('$DSH_HOME/redteam/toolkit/vps/id_rsa')
      const hasVps = existsSync(vpsKey)
      const missing = []
      if (fofaKey === '') missing.push('FOFA_KEY（未配置时自动降级本地扫描）')
      if (!hasVps) missing.push('VPS（可选远程联调沙箱密钥）')

      const onboarding = {
        complete: hasMarker && missing.length === 0 && allBroken.length === 0,
        first_run: !hasMarker,
        configured: {
          fofa_key: fofaKey === '' ? 'missing' : 'configured(' + (fofaKey.length > 8 ? fofaKey.slice(0, 4) + '…' + fofaKey.slice(-4) : 'ok') + ')',
          vps_key: hasVps ? 'configured' : 'missing',
          env_file: { path: envFile, exists: existsSync(envFile), keys: envFileKeys },
        },
        missing,
      }
      let prompts = null
      if (engId && typeof store?.listPrompts === 'function') {
        try {
          const roles = store.listPrompts(engId)
          const stale = roles.filter((r) => r.injected === true && r.stale === true).map((r) => ({ role: r.role, title: r.title }))
          prompts = { engagement: engId, total: roles.length, stale_count: stale.length, stale }
        } catch { prompts = null }
      }
      const next = allBroken.length > 0 || missing.length > 0
        ? '缺少可选外部配置时可参考 redteam-setup 补齐，或采用本地替代方案继续推进。'
        : '全部可用，可以开工。'
      return {
        ok: allBroken.length === 0 && missing.length === 0 && (scopeRes ? scopeRes.ok : true),
        workspace_root: wsRoot,
        db_engine: dbEngine,
        maxAgents, maxDepth, thinkingEffort,
        skills_available: summary.available,
        skills_broken: summary.broken,
        skills_total: summary.total,
        summary,
        available: allAvailable.filter(shown).map((s) => s.name),
        broken: allBroken.filter(shown).map((s) => ({ name: s.name, problems: s.problems, needs_user: s.needs_user })),
        unknown: checked.filter((s) => s.status === 'unknown').map((s) => s.name),
        onboarding,
        prompts,
        scope_check: scopeRes || undefined,
        probe: probeRes || undefined,
        next,
      }
    },
  })

  /* 8. lmt_role_prompt */
  regEngTool({
    name: 'lmt_role_prompt',
    description: 'Read or reset role contract prompt (reset=true resets specified role or all).',
    parameters: {
      engagement: { type: 'string' },
      role: { type: 'string', enum: ALL_ROLES },
      reset: { type: 'boolean' },
    },
    async execute(args, id) {
      if (args.reset === true) return { ok: true, engagement: id, ...store.resetPrompts(id, args.role) }
      if (!args.role) return { ok: false, error: 'role required', roles: ALL_ROLES }
      const found = store.listPrompts(id).find((p) => p.role === args.role)
      if (found === undefined) return { ok: false, error: 'unknown role' }
      return { ok: true, role: found.role, title: found.title, updated_at: found.updated_at, prompt: found.content }
    },
  })

  /* 9. lmt_roles */
  regTool({
    name: 'lmt_roles',
    description: 'List all 8 role presets and wave ownership.',
    parameters: {},
    async execute() {
      return {
        ok: true,
        roles: ALL_ROLES.map((role) => ({
          role,
          title: ROLE_TITLES[role] || role,
          ...(ROLE_WAVES[role] || { wave: 3, wave_label: 'Wave 3', preset: 'redteam-worker' }),
        })),
      }
    },
  })

  /* 10. lmt_artifact_record */
  regTool({
    name: 'lmt_artifact_record',
    description: '统一产物落库（module/contract/finding/evidence/pattern）。milestone 必填 code+evidence：同一系统只算最高权限一次、自己注册的账号不算得分权限（self_created=true 仅留痕），boundary-* 须完整 boundary；tunnel 自己 VPS 不算隧道（self-only）。',
    parameters: {
      kind: {
        type: 'string', required: true,
        enum: ['module', 'contract', 'finding', 'evidence', 'pattern', 'spec', 'assets', 'assess', 'vulns', 'milestone', 'tunnel', 'data_proof', 'cleanup'],
      },
      action: { type: 'string', enum: ['add', 'update', 'use', 'assess', 'test', 'link'] },
      engagement: { type: 'string' },
      id: { type: 'number' },
      code: { type: 'string' },
      agent: { type: 'string' },
      target: { type: 'string' },
      title: { type: 'string' },
      evidence: { type: 'string' },
      ip: { type: 'string' },
      primary_name: { type: 'string' },
      state: { type: 'string', enum: ['live', 'dead', 'unknown'] },
      provenance: { type: 'string', enum: ['passive', 'active'] },
      tool: { type: 'string' },
      discovered_at: { type: 'string' },
      names: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', required: true }, kind: { type: 'string' }, provenance: { type: 'string', enum: ['passive', 'active'] } } },
      },
      ports: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            port: { type: 'number', required: true }, proto: { type: 'string' }, service: { type: 'string' },
            product: { type: 'string' }, version: { type: 'string' }, banner: { type: 'string' },
            url: { type: 'string' }, title: { type: 'string' }, provenance: { type: 'string', enum: ['passive', 'active'] },
          },
        },
      },
      asset_id: { type: 'number' },
      vuln_id: { type: 'number' },
      step_id: { type: 'number' },
      status: { type: 'string' },
      test: { type: 'string' },
      surface: { type: 'string' },
      blocked: { type: 'boolean' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      potential: { type: 'string' },
      reason: { type: 'string' },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      cve: { type: 'string' },
      source: { type: 'string' },
      confidence: { type: 'number' },
      gained: { type: 'string' },
      method: { type: 'string' },
      request: { type: 'string' },
      response: { type: 'string' },
      points: { type: 'number' },
      port: { type: 'number' },
      command: { type: 'string' },
      result: { type: 'string' },
      self_created: { type: 'boolean' },
      data_scale: { type: 'string', enum: ['large', 'knowledge-base'] },
      ip_version: { type: 'string', enum: ['4', '6'] },
      boundary_evidence: { type: 'string' },
      boundary: {
        type: 'object', additionalProperties: false,
        properties: {
          entry_zone: { type: 'string', required: true },
          target_zone: { type: 'string', required: true },
          isolation: { type: 'string', enum: ['firewall', 'airgap', 'physical', 'multi-homed', 'supply', 'other'], required: true },
          target_asset: { type: 'string', required: true },
          scope_confirmed: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
      stage_code: { type: 'string', enum: ['recon', 'internet', 'boundary', 'internal'] },
      path: { type: 'string' },
      data_base64: { type: 'string' },
      label: { type: 'string' },
      content: { type: 'string' },
      name: { type: 'string' },
      subkind: { type: 'string' },
      category: { type: 'string' },
      component: { type: 'string' },
      versions: { type: 'string' },
      language: { type: 'string' },
      usage: { type: 'string' },
      description: { type: 'string' },
      summary: { type: 'string' },
      recommendation: { type: 'string' },
      tags: { type: 'string' },
      verified: { type: 'boolean' },
      verified_note: { type: 'string' },
      asset_target: { type: 'string' },
      used_on: { type: 'string' },
      listen: { type: 'string' },
      entry: { type: 'string' },
      reach: { type: 'string' },
      entry_kind: { type: 'string', enum: ['target-outbound', 'target-http', 'target-agent', 'self-only'] },
      fields: { type: 'array', items: { type: 'string' } },
      row_count: { type: 'number' },
      sample: { type: 'string' },
      interface: { type: 'string' },
      location: { type: 'string' },
      note: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            ip: { type: 'string' }, state: { type: 'string' }, primary_name: { type: 'string' }, provenance: { type: 'string' }, tool: { type: 'string' },
            asset_id: { type: 'number' }, priority: { type: 'string' }, potential: { type: 'string' }, reason: { type: 'string' },
            title: { type: 'string' }, severity: { type: 'string' }, status: { type: 'string' }, cve: { type: 'string' }, target: { type: 'string' },
            evidence: { type: 'string' }, gained: { type: 'string' }, method: { type: 'string' }, request: { type: 'string' }, response: { type: 'string' },
            ports: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { port: { type: 'number', required: true }, service: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' } } } },
          },
        },
      },
    },
    async execute(args, exec) {
      return recordArtifact(store, exec, args)
    },
  })

  /* 11. lmt_artifact_query */
  regTool({
    name: 'lmt_artifact_query',
    description: 'Query artifacts: module, finding, pattern, timeline, stats, chain, graph, scores, tunnels, shots, data_proofs, cleanup, files.',
    parameters: {
      kind: {
        type: 'string', required: true,
        enum: ['module', 'finding', 'pattern', 'timeline', 'stats', 'chain', 'graph', 'scores', 'tunnels', 'shots', 'data_proofs', 'cleanup', 'files'],
      },
      subkind: { type: 'string' },
      engagement: { type: 'string' },
      id: { type: 'number' },
      code: { type: 'string' },
      q: { type: 'string' },
      category: { type: 'string' },
      scope: { type: 'string', enum: ['internal', 'external'] },
      assessed: { type: 'string', enum: ['yes', 'no'] },
      sort: { type: 'string', enum: ['priority', 'todo', 'unassessed', 'ports', 'ip'] },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      status: { type: 'string' },
      cidr: { type: 'string' },
      cve: { type: 'string' },
      component: { type: 'string' },
      asset_target: { type: 'string' },
      verified: { type: 'boolean' },
      asset_id: { type: 'number' },
      target: { type: 'string' },
      limit: { type: 'number' },
      offset: { type: 'number' },
    },
    async execute(args, exec) {
      return queryArtifacts(store, exec, args)
    },
  })

  /* 12. lmt_report_export */
  regEngTool({
    name: 'lmt_report_export',
    description: 'Compile structured Markdown/JSON delivery report with optional Feishu webhook notification.',
    parameters: {
      engagement: { type: 'string' },
      format: { type: 'string', enum: ['markdown', 'json'] },
      push_feishu: { type: 'boolean' },
      webhook_url: { type: 'string' },
      summary: { type: 'string' },
      limit: { type: 'number' },
    },
    async execute(args, id) {
      const format = args.format === 'json' ? 'json' : 'markdown'
      const scoreRep = typeof store.scoreReport === 'function' ? store.scoreReport(id, { limit: args.limit }) : null
      const vulnRep = typeof store.report === 'function' ? store.report(id) : null
      let feishu = null
      if (args.push_feishu === true && typeof store.pushFeishuNotify === 'function') {
        feishu = await store.pushFeishuNotify(id, {
          webhook_url: args.webhook_url,
          summary: args.summary || '工程交付报告已生成',
        })
      }
      if (format === 'json') {
        return {
          ok: true, engagement: id, format,
          generated_at: (vulnRep && vulnRep.generated_at) || new Date().toISOString(),
          summary: scoreRep ? scoreRep.summary : null,
          stats: vulnRep ? vulnRep.stats : null,
          items: scoreRep ? scoreRep.items.map((x) => ({
            seq: x.seq, point: x.point_name, points: x.points, counted: x.counted,
            target: x.target, gained: x.gained, requests: x.requests.length, missing_evidence: x.missing_evidence,
          })) : [],
          feishu: feishu || undefined,
        }
      }
      const md = (scoreRep && Array.isArray(scoreRep.items) && scoreRep.items.length > 0)
        ? scoreRep.markdown
        : ((vulnRep && vulnRep.markdown) || (scoreRep && scoreRep.markdown) || '')
      return {
        ok: true, engagement: id, format,
        generated_at: (vulnRep && vulnRep.generated_at) || new Date().toISOString(),
        summary: scoreRep ? scoreRep.summary : null,
        stats: vulnRep ? vulnRep.stats : null,
        markdown: md,
        feishu: feishu || undefined,
      }
    },
  })
}
