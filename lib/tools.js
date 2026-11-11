/**
 * LMTAgent 软件工程研发集群智能体工具集（preset 平面）
 *
 * 这些行只向 `tools` 注册模型可见工具，自身不发布任何服务，因此不需要 isolate realm；
 * 它们解析的是 host 平面的 `ctx.redteam`（dsh-redteam-store 发布的进程级实例）。
 *
 * 设计约定：
 *   · 写入一律走 redteam_asset_add / redteam_asset_link，智能体不直接碰 SQL；
 *   · 每次发现都带 provenance（passive|active）与 tool，保证界面上的来源标注可信；
 *   · **项目工作区按根会话隔离**：绑定键是会话的根祖先 id，子智能体顺着
 *     `session.header.parentSession` 继承父会话的项目工作区 —— 多会话并行时互不串写，
 *     交付报告不会再被别的项目的成果污染；
 *   · 并发硬约束：`redteam_agent_slot` 用 `ctx.subagents.listChildren` 的真实运行数
 *     卡住"同一项目默认 6 个并发执行智能体（最高 12 槽）"，超了直接拒绝，不靠提示词自觉。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { ROLE_TITLES, PLANNER_ROLE, ROLE_ORDER, scoreStageOf } from './store-core.js'
import {
  maxAgentsOf,
  maxDepthOf,
  DEFAULT_MAX_AGENTS,
  MAX_AGENTS_LIMIT,
  DEFAULT_LEASE_TTL_MS,
  detectShardConflicts,
  normalizeShardPattern,
} from './concurrency.js'
/* 技能可用性判定只有一份实现：面板的「技能库」页签与这里共用（见该文件头注释） */
import { checkSkill, summarizeSkills, expandSkillPath } from './skill-availability.js'

/** Cordis 插件名。 */
export const name = 'redteam-tools'

/** 硬依赖：资产库服务 + 工具注册表（subagents / skills 走 ctx.get 可选获取）。 */
export const inject = ['redteam', 'tools']

/** 并发预留租约 TTL（2 分钟 = 120,000ms），防止派发失败导致槽位永久泄漏。 */
export const RESERVATION_TTL_MS = DEFAULT_LEASE_TTL_MS

/** 进程内根会话状态表容量上限（防止长期运行无限膨胀）。 */
const MAX_TRACKED_ROOT_SESSIONS = 256

/** 根会话 id → engagementId 绑定（一次会话内稳定；进程重启后由 agent 重新绑定）。 */
const bindings = new Map()

/** 并发闸门：根会话 id → Map(预留键 → { key, label, childId, files_owned, engagementId, at, expires_at })。 */
const reservations = new Map()

function enforceSessionMapCap() {
  while (bindings.size > MAX_TRACKED_ROOT_SESSIONS) {
    const oldest = bindings.keys().next().value
    if (oldest === undefined) break
    bindings.delete(oldest)
  }
  while (reservations.size > MAX_TRACKED_ROOT_SESSIONS) {
    const oldest = reservations.keys().next().value
    if (oldest === undefined) break
    reservations.delete(oldest)
  }
}

function setBoundedBinding(key, engagementId) {
  if (!key) return
  if (bindings.has(key)) bindings.delete(key)
  bindings.set(key, engagementId)
  enforceSessionMapCap()
}

function rootDirOfCtx(ctx) {
  try { return ctx && ctx.redteam ? ctx.redteam.root : undefined } catch { return undefined }
}

/**
 * 并发上限：同一项目工作区（根会话）同时最多几个执行智能体（每次现读，立即生效）。
 */
function maxAgentsNow(ctx) {
  return maxAgentsOf(rootDirOfCtx(ctx), process.env)
}

function maxDepthNow(ctx) {
  return maxDepthOf(rootDirOfCtx(ctx), process.env)
}

/** 一次调用的会话解析结果。 */
function sessionInfoOf(exec) {
  const agent = exec && exec.agent
  const session = agent && agent.session
  if (session === undefined || session === null) return {}
  const id = session.id === undefined ? undefined : String(session.id)
  let parentId
  try {
    const header = session.header
    parentId = header && header.parentSession !== undefined && header.parentSession !== null
      ? String(header.parentSession)
      : undefined
  } catch { parentId = undefined }
  return { id: id, parentId: parentId, session: session }
}

/** 会话 id（兼容旧调用点）。 */
function sessionOf(exec) {
  return sessionInfoOf(exec).id
}

/**
 * 解析"根会话"：一路沿 parentSession 走到最顶层的会话 id。
 * 主会话派出的子智能体因此共享同一个绑定键，而**不同主会话之间天然隔离**。
 * 顺手把沿途会话 id 都返回，便于把绑定缓存到子会话上。
 */
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
      const store = cur.store
      parent = store && typeof store.get === 'function' ? store.get(info.parentId) : undefined
    } catch { parent = undefined }
    if (parent === undefined || parent === null) {
      /* 父会话不在内存里（被回收 / 冷启动）：父 id 本身就是稳定的根键 */
      return { rootId: info.parentId, chain: chain.concat([info.parentId]) }
    }
    cur = parent
    guard += 1
  }
  return { rootId: chain.length > 0 ? chain[chain.length - 1] : undefined, chain: chain }
}

/** 绑定键 + 会话链。 */
function bindingKeyOf(exec) {
  const info = sessionInfoOf(exec)
  if (info.id === undefined) return { rootId: undefined, sessionId: undefined, chain: [] }
  const resolved = resolveRootSession(info.session)
  const rootId = resolved.rootId === undefined ? info.id : resolved.rootId
  return { rootId, sessionId: info.id, chain: resolved.chain }
}

/**
 * 解析本次调用应作用在哪个靶标上（会话隔离版）。
 *
 * 顺序：① 显式传入 → ② 本会话/父链上的绑定 → ③ 全局「当前靶标」指针
 * （仅当没有被别的会话占用；被占用时报错并提示显式绑定，**绝不静默串写**）。
 *
 * 抛错而不是"随便挑一个"是刻意的：多会话并行时挑错靶标 = 把 A 单位的成果写进
 * B 单位的库、A 的报告里出现 B 的数据（这正是要多会话隔离的原因）。
 */
function resolveEngagement(store, exec, explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const { rootId, sessionId, chain } = bindingKeyOf(exec)
  const keys = Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))
  for (const key of keys) {
    const bound = bindings.get(key)
    if (typeof bound === 'string' && bound.length > 0) return bound
  }
  if (typeof store.activeEngagementId === 'function') {
    const active = store.activeEngagementId()
    if (active !== undefined) {
      const holder = Array.from(bindings.entries()).find(([k, v]) => v === active && !keys.includes(k))
      if (holder !== undefined) {
        throw new Error(
          '本会话尚未绑定研发项目工作区，而全局「当前项目工作区」' + active + ' 已被另一个会话占用；'
          + '为避免多会话串写同一个项目工作区库，请显式绑定：redteam_engagement_open（新建/打开）'
          + ' 或 redteam_session_bind（绑定到已有项目工作区）。',
        )
      }
      for (const key of keys) setBoundedBinding(key, active)
      recordSessionBinding(store, exec, active)
      return active
    }
  }
  const list = store.listEngagements()
  if (list.length === 1) {
    for (const key of keys) setBoundedBinding(key, list[0].id)
    recordSessionBinding(store, exec, list[0].id, list[0].name)
    return list[0].id
  }
  throw new Error('尚未绑定研发项目工作区：请先调用 redteam_engagement_open 传入项目名称')
}

/**
 * 当前会话的绑定关系（redteam_session_info 与面板展示用）。
 * @param exec - 工具执行上下文（取会话链）。
 * @param store - 资产库实例（读面板「跟随会话」用的落盘绑定）。
 */
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
    /* 面板「跟随会话」读的落盘绑定：写的是根会话键，重启后仍在 */
    panel_follow_engagement: rootId !== undefined && store && typeof store.sessionBinding === 'function'
      ? (store.sessionBinding(rootId) ?? null)
      : null,
  }
}

/** 子智能体的继承说明（写进返回值，让模型知道为什么它不用再绑定一次）。 */
function inheritedHint(exec, id) {
  const info = sessionInfoOf(exec)
  if (info.parentId === undefined) return undefined
  return '本会话是子智能体：研发项目工作区 ' + id + ' 继承自父会话（会话隔离生效，不会写到别的项目工作区库里）。'
}

/** 逗号/空白分隔的清单（或字符串数组） → 去重数组。 */
function splitList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((v) => String(v || '').split(/[,，\s]+/)).map((x) => x.trim()).filter(Boolean)))
  }
  return Array.from(new Set(String(value || '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)))
}

/** 把一行资产压成模型可读的紧凑结构（避免把整库原始数据塞进上下文）。 */
function compactAsset(a) {
  return {
    id: a.id,
    ip: a.ip,
    segment: a.segment_cidr,
    state: a.state,
    name: a.primary_name,
    names: a.names.map((n) => n.name),
    ports: a.ports.filter((p) => p.state === 'open')
      .map((p) => p.port + '/' + p.proto + (p.service ? ' ' + [p.service, p.product, p.version].filter(Boolean).join(' ') : '') + ' [' + p.provenance + ']'),
    fingerprints: a.fingerprints.map((f) => [f.category, f.vendor, f.product, f.version].filter(Boolean).join(' ') + ' [' + f.provenance + ']'),
    passive: a.passive,
    active: a.active,
    /* 发现时间：这条资产第一次进入本库的时刻（面板与报告都按它排时间线） */
    discovered_at: a.discovered_at,
    first_seen: a.first_seen,
    last_seen: a.last_seen,
    test_status: a.test_status,
    priority: a.priority,
  }
}

const text = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]

/** 角色 code 的合法值说明（写进工具 description，模型不用猜）。 */
const ROLE_HINT = '角色 code：' + ROLE_ORDER.map((r) => '`' + r + '`（' + ROLE_TITLES[r] + '）').join('、')

/** 当前会话的绑定键（根会话 + 本会话 + 父链），用于把绑定写全。 */
function bindKeysOf(exec) {
  const { rootId, sessionId, chain } = bindingKeyOf(exec)
  return Array.from(new Set([rootId, sessionId, ...chain].filter(Boolean)))
}

/**
 * 把「根会话 → 项目工作区」记进 store 的持久绑定表（`$DSH_HOME/redteam/sessions.json`）。
 */
function recordSessionBinding(store, exec, engagementId, name) {
  if (typeof store.setSessionBinding !== 'function') return
  const { rootId, sessionId } = bindingKeyOf(exec)
  const key = rootId || sessionId
  if (key === undefined || key === null || key === '') return
  try {
    store.setSessionBinding(String(key), String(engagementId), name === undefined ? undefined : String(name))
  } catch { /* 面板回落，不阻断智能体 */ }
}

function tryReleaseStoreShardLock(store, rootId, entry) {
  if (!store || typeof store.releaseShardLocks !== 'function' || !entry) return
  if (!Array.isArray(entry.files_owned) || entry.files_owned.length === 0) return
  const engId = entry.engagementId || bindings.get(rootId) || rootId
  try {
    store.releaseShardLocks(engId, {
      engagement_id: engId,
      owner: entry.key,
      worker_name: entry.label || entry.key,
      files_owned: entry.files_owned,
    })
  } catch { /* 忽略可选持久化释放异常 */ }
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
    const parentSid = s && s.header && s.header.parentSession !== undefined && s.header.parentSession !== null
      ? String(s.header.parentSession)
      : (s && s.parentSession !== undefined && s.parentSession !== null ? String(s.parentSession) : undefined)
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

/** 清理所有超过 120,000ms（2 分钟）租约 TTL 的并发预留，防止派发失败永久漏槽。 */
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

/**
 * 实时并发占用：沿 `sessions.list()`（`header.parentSession`）与 `subagents.listChildren`
 * 递归遍历完整后代会话树（最高至 `maxDepth`），统计真实运行中的子孙会话数与观测到的最大递归深度。
 */
async function liveRunningChildren(ctx, rootSessionId) {
  const maxDepth = maxDepthNow(ctx)
  const getSvc = ctx && typeof ctx.get === 'function' ? (k) => ctx.get(k) : () => undefined
  const subagents = getSvc('subagents')
  const sessionsSvc = getSvc('sessions')
  const hasSubagents = Boolean(subagents && typeof subagents.listChildren === 'function')
  const hasSessions = Boolean(sessionsSvc && typeof sessionsSvc.list === 'function')

  if (!hasSubagents && !hasSessions) {
    return {
      available: false,
      running: 0,
      directRunning: 0,
      maxObservedDepth: 0,
      maxDepth,
      error: 'subagents 注册表不可用（无法核对实际并发数，只能按预留计数）',
    }
  }

  try {
    const sessionChildrenByParent = new Map()
    if (hasSessions) {
      try {
        const rawSessions = await sessionsSvc.list()
        const sessionRows = Array.isArray(rawSessions)
          ? rawSessions
          : (rawSessions && Array.isArray(rawSessions.items) ? rawSessions.items : [])
        pruneClosedRootSessions(sessionRows, ctx && ctx.redteam)
        for (const s of sessionRows) {
          if (!s || s.id === undefined || s.id === null) continue
          const sid = String(s.id)
          const parentSid = s.header && s.header.parentSession !== undefined && s.header.parentSession !== null
            ? String(s.header.parentSession)
            : (s.parentSession !== undefined && s.parentSession !== null ? String(s.parentSession) : '')
          if (!parentSid) continue
          if (!sessionChildrenByParent.has(parentSid)) sessionChildrenByParent.set(parentSid, [])
          sessionChildrenByParent.get(parentSid).push({
            id: sid,
            kind: 'child',
            activity: s.activity || s.status || s.state || (s.running === true ? 'running' : 'idle'),
            label: s.label || (s.header && s.header.title) || s.title || sid,
          })
        }
      } catch { /* sessions.list 失败时继续用 subagents.listChildren */ }
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
        const rows = Array.isArray(entries) ? entries : []
        for (const e of rows) {
          if (!e || (e.kind !== undefined && e.kind !== 'child')) continue
          const cid = String(e.id ?? e.sessionId ?? e.childId ?? '')
          if (!cid) continue
          merged.set(cid, e)
        }
      }
      const fromSessions = sessionChildrenByParent.get(current.id) || []
      for (const sChild of fromSessions) {
        if (!merged.has(sChild.id)) {
          merged.set(sChild.id, sChild)
        } else {
          const prev = merged.get(sChild.id)
          if (prev.activity !== 'running' && sChild.activity === 'running') {
            merged.set(sChild.id, Object.assign({}, prev, { activity: 'running' }))
          }
        }
      }

      const childDepth = current.depth + 1
      for (const [cid, entry] of merged.entries()) {
        if (cid === rootKey) continue
        allDescendants.add(cid)
        if (childDepth > maxObservedDepth) maxObservedDepth = childDepth
        const isRunning = entry.activity === 'running'
          || entry.status === 'running'
          || entry.state === 'running'
          || entry.running === true
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
      available: true,
      running: runningIds.size,
      directRunning: directRunningIds.size,
      maxObservedDepth,
      maxDepth,
      running_labels: runningLabels.slice(0, 20),
      total_children: allDescendants.size,
    }
  } catch (error) {
    return {
      available: false,
      running: 0,
      directRunning: 0,
      maxObservedDepth: 0,
      maxDepth,
      error: '列子会话失败：' + (error && error.message ? error.message : String(error)),
    }
  }
}

/** 预留列表（先清理超时租约，再返回活跃预留条目）。 */
function reservationList(rootId, now = Date.now(), store = undefined) {
  pruneExpiredReservations(now, store)
  const map = reservations.get(rootId)
  if (map === undefined) return []
  return Array.from(map.values(), (r) => ({
    key: r.key,
    label: r.label,
    childId: r.childId,
    files_owned: Array.isArray(r.files_owned) ? r.files_owned.slice() : [],
    at: r.at,
    expires_at: r.expires_at,
    ttl_ms: Math.max(r.expires_at - now, 0),
  }))
}

function addReservation(rootId, spec, now = Date.now()) {
  pruneExpiredReservations(now)
  if (!reservations.has(rootId)) reservations.set(rootId, new Map())
  const entry = typeof spec === 'string'
    ? { key: spec, label: spec, childId: undefined, files_owned: [], engagementId: undefined, at: now, expires_at: now + RESERVATION_TTL_MS }
    : {
      key: String(spec.key),
      label: typeof spec.label === 'string' && spec.label.trim() !== '' ? spec.label.trim() : String(spec.key),
      childId: spec.childId !== undefined ? String(spec.childId) : undefined,
      files_owned: Array.isArray(spec.files_owned) ? spec.files_owned.slice() : [],
      engagementId: spec.engagementId,
      at: now,
      expires_at: now + RESERVATION_TTL_MS,
    }
  reservations.get(rootId).set(entry.key, entry)
  enforceSessionMapCap()
  return entry
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
  if (map.has(key)) {
    const entry = map.get(key)
    tryReleaseStoreShardLock(store, rootId, entry)
    map.delete(key)
    if (map.size === 0) reservations.delete(rootId)
    return true
  }
  /* 若未指定精确 key 或传入的是 label / childId，尝试匹配后再回退到最早的一个预留 */
  for (const [k, r] of map.entries()) {
    if (r.childId === key || r.label === key) {
      tryReleaseStoreShardLock(store, rootId, r)
      map.delete(k)
      if (map.size === 0) reservations.delete(rootId)
      return true
    }
  }
  return false
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
  if (oldestEntry && typeof oldestEntry === 'object') tryReleaseStoreShardLock(store, rootId, oldestEntry)
  map.delete(oldestKey)
  if (map.size === 0) reservations.delete(rootId)
  return true
}

/**
 * 产出这条记录的智能体角色：显式传的优先，否则默认按主会话记账。
 * 这个值会写进库里的 `agent` 列，报告里"这一步是谁做的"就靠它。
 */
function agentOf(args) {
  const raw = typeof args.agent === 'string' ? args.agent.trim() : ''
  return raw !== '' ? raw : PLANNER_ROLE
}


/** 解析 IPv4 为整数；不是 IPv4 返回 null。 */
function ipv4Int(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim())
  if (m === null) return null
  const n = m.slice(1).map(Number)
  if (n.some((x) => x > 255)) return null
  return ((n[0] * 256 + n[1]) * 256 + n[2]) * 256 + n[3]
}

/** target 字符串里能认出的 IPv4（URL / host:port / 裸 IP 都行）；认不出返回 null。 */
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

function scopeOfEngagement(store, id) {
  const row = store.listEngagements().find((e) => e.id === id)
  return Array.isArray(row && row.scope) ? row.scope : []
}

/** 范围判定：无 scope → 'unscoped'；有 scope 且 IP 命中 → in；IP 不在 → out；域名/解析不出 → unresolved。 */
function scopeCheck(store, id, target) {
  const scope = scopeOfEngagement(store, id)
  if (scope.length === 0) return { status: 'unscoped', scope, ip: null }
  const ip = targetIpv4(target)
  if (ip === null) return { status: 'unresolved', scope, ip: null }
  const hit = scope.find((cidr) => ipInCidr(ip, cidr))
  return { status: hit === undefined ? 'out' : 'in', scope, ip, cidr: hit || null }
}

/** 通过 SOCKS5 代理做一次 CONNECT 探测（suo5/chisel 的本地监听都支持）。 */
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
          const b = Buffer.alloc(10); b[0] = 5; b[1] = 1; b[2] = 0; b[3] = 1
          b.writeUInt32BE(ip >>> 0, 4); b.writeUInt16BE(tp, 8); req = b
        } else {
          const hb = Buffer.from(th, 'utf8')
          const b = Buffer.alloc(7 + hb.length); b[0] = 5; b[1] = 1; b[2] = 0; b[3] = 3; b[4] = hb.length
          hb.copy(b, 5); b.writeUInt16BE(tp, 5 + hb.length); req = b
        }
        socket.write(req)
        return
      }
      if (buf.length >= 2 && buf[0] === 5 && buf[1] === 0) finish(true)
      else finish(false, 'SOCKS5 connect rejected')
    })
  })
}

/**
 * boundary-* 的工具级硬门槛：必须有结构化 boundary 对象，且入口区 ≠ 落点区；
 * boundary-supply 还要求 scope_confirmed=true。store 层只警告（兼容历史/迁移脚本），
 * 但所有模型调用都走工具层，因此这里拒绝后智能体无法把同区隧道记成边界突破。
 */
function assertBoundaryGate(args, code) {
  const c = String(code || '')
  if (!c.startsWith('boundary-')) return
  const b = args && args.boundary
  if (b === null || b === undefined || typeof b !== 'object') {
    throw new Error('边界突破必须提供 boundary 对象（entry_zone / target_zone / isolation / target_asset）；只有边界四问齐全才能记 boundary-*，同区隧道只能记 internal。')
  }
  const entry = String(b.entry_zone || '').trim()
  const target = String(b.target_zone || '').trim()
  const isolation = String(b.isolation || '').trim()
  const asset = String(b.target_asset || '').trim()
  if (entry === '' || target === '' || isolation === '' || asset === '') {
    throw new Error('boundary 不完整：entry_zone / target_zone / isolation / target_asset 都必须填写。')
  }
  if (entry.toLowerCase() === target.toLowerCase()) {
    throw new Error('入口区与落点区相同（' + entry + '）：同区隧道不是边界突破，请改记 internal。')
  }
  if (c === 'boundary-supply' && b.scope_confirmed !== true) {
    throw new Error('boundary-supply 需要 scope_confirmed=true：先让用户确认供应商/云服务在授权范围内，再记分。')
  }
}

/** 写库工具共用的 agent 参数（角色 code 白名单提示写进 description）。 */
const AGENT_PARAM = {
  type: 'string',
  description: '【建议填】产出这条记录的角色 —— ' + ROLE_HINT
    + '。报告里会按它标注"这一步是谁做的"，不填按主会话记账。',
}

/**
 * 把 store 层抛出的异常统一收敛成结构化的失败返回。
 *
 * 为什么需要：同一类错误（对象不存在 / 参数非法）此前有两种形态 ——
 * 有的工具 `return { ok:false, error }`，有的直接抛。模型拿到前者能换参数重试，
 * 拿到后者往往直接放弃这一次调用，行为不可预测。统一成前者，且**不吞原始信息**。
 * @param tool - defineTool 的返回值。
 * @returns 包了一层 try/catch 的同一个工具定义。
 */
function withStructuredErrors(tool) {
  const inner = tool.execute
  if (typeof inner !== 'function') return tool
  return Object.assign({}, tool, {
    async execute(args, exec) {
      try {
        return await inner(args, exec)
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        /* 参数类错误（非法值/缺必填）与"找不到对象"分开提示，模型据此决定重试还是放弃 */
        const kind = /非法|invalid|required|不能为空|not found|不存在/i.test(message) ? 'bad_input' : 'failed'
        return JSON.stringify({
          ok: false,
          error: message,
          error_kind: kind,
          hint: kind === 'bad_input'
            ? '这是参数或对象标识的问题：核对参数名与取值（可用对应的 *_list / *_query 工具先看实际 id），修正后重试。'
            : '工具执行失败，错误原文见 error 字段；不要静默跳过，先向用户或指挥者说明卡点。',
        }, null, 2)
      }
    },
  })
}


/**
 * 角色工具白名单（按预设 `config.profile` 生效；缺省 all = 不裁剪）。
 *
 * 为什么用"排除集"而不是"允许集"：工具会持续增加，允许集每加一个工具都要改 5 份；
 * 排除集只列"这个角色真不该看到的写操作/管理操作"，新增工具默认对所有角色可见，
 * 漏配的后果是"多看见一个工具"，而不是"关键工具被裁掉"。
 *
 * 只裁真正的越界写操作与管理操作；读工具、score_list、asset_query 等尽量保留，
 * 避免角色因为缺一个查询工具而卡住。profile 参数没被宿主传进来时回退 all。
 */
const PROFILE_EXCLUDES = {
  recon: new Set([
    'redteam_asset_assess', 'redteam_vuln_add', 'redteam_vuln_update',
    'redteam_credential_add', 'redteam_access_add', 'redteam_webshell_add', 'redteam_webshell_update',
    'redteam_tunnel_add', 'redteam_tunnel_update', 'redteam_score_hit', 'redteam_score_point_save',
    'redteam_score_report', 'redteam_report', 'redteam_report_targets', 'redteam_role_prompt_reset',
    'redteam_poc_update', 'redteam_poc_use', 'redteam_attack_file_add',
    'redteam_shot_delete', 'redteam_http_evidence_add',
  ]),
  designer: new Set([
    'redteam_vuln_add', 'redteam_vuln_update',
    'redteam_credential_add', 'redteam_access_add', 'redteam_webshell_add', 'redteam_webshell_update',
    'redteam_tunnel_add', 'redteam_tunnel_update', 'redteam_score_hit', 'redteam_score_point_save',
    'redteam_score_report', 'redteam_report', 'redteam_report_targets', 'redteam_role_prompt_reset',
    'redteam_poc_update', 'redteam_poc_use',
    'redteam_shot_delete', 'redteam_http_evidence_add',
  ]),
  assess: new Set([
    'redteam_vuln_add', 'redteam_vuln_update', 'redteam_credential_add', 'redteam_access_add',
    'redteam_webshell_add', 'redteam_webshell_update', 'redteam_tunnel_add', 'redteam_tunnel_update',
    'redteam_score_hit', 'redteam_score_point_save', 'redteam_score_report', 'redteam_report',
    'redteam_report_targets', 'redteam_role_prompt_reset', 'redteam_poc_update',
    'redteam_poc_use', 'redteam_attack_file_add', 'redteam_shot_delete',
  ]),
  'vuln-scan': new Set([
    'redteam_asset_assess', 'redteam_access_add', 'redteam_webshell_add', 'redteam_webshell_update',
    'redteam_tunnel_add', 'redteam_tunnel_update', 'redteam_session_check', 'redteam_score_point_save',
    'redteam_report', 'redteam_report_targets', 'redteam_role_prompt_reset', 'redteam_shot_delete',
  ]),
  exploit: new Set([
    'redteam_asset_assess', 'redteam_score_point_save', 'redteam_report', 'redteam_report_targets',
    'redteam_role_prompt_reset', 'redteam_shot_delete',
  ]),
  qa: new Set([
    'redteam_asset_assess', 'redteam_tunnel_add', 'redteam_tunnel_update',
    'redteam_score_point_save', 'redteam_report', 'redteam_report_targets',
    'redteam_role_prompt_reset', 'redteam_shot_delete',
  ]),
  internal: new Set([
    'redteam_score_point_save', 'redteam_role_prompt_reset',
    'redteam_shot_delete',
  ]),
}

export function apply(ctx, config = {}) {
  const profile = String((config && config.profile) || 'all').trim()
  const excluded = PROFILE_EXCLUDES[profile]
  const registerTool = (tool) => {
    if (excluded !== undefined && excluded.has(tool.name)) return
    ctx.tools.register(tool)
  }
  const store = ctx.redteam

  /* ── 子智能体结束时自动释放并发名额与分片锁（不依赖模型记得调 release）──── */
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

      /* 注册表里的键可能与 runId 不同：按时间兜底清掉最早的一个预留 */
      dropOldestReservation(rootId, store)
    })
  } catch { /* 事件不可用时只影响自动释放，手动 release 与 2min TTL 仍然可用 */ }

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_engagement_open',
    description: '打开或创建一次 LMTAgent 软件工程研发项目工作区（按项目/单位名称），并把**当前会话**绑定到该项目工作区（递归子智能体会自动继承）。后续所有模块注册、架构分片、缺陷追踪与里程碑工具默认作用于它。若项目工作区已存在则复用其 PostgreSQL/SQLite 事实库。写入的是本会话的绑定，不会改动其它会话正在用的项目工作区。',
    parameters: {
      target: { type: 'string', required: true, description: '项目/系统名称，例如「LMTAgent 核心网关重构」' },
      scope: {
        type: 'array',
        description: '项目模块与环境范围列表（可选：用户没给就不用问，按当前仓库与服务范围自主推进）',
        items: { type: 'string' },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      /* bindCurrent: false —— 不动全局「当前项目」指针：多会话并行时那个指针是串写的根源 */
      const engagement = store.openEngagement(args.target, args.scope, { bindCurrent: false })
      const keys = bindKeysOf(exec)
      for (const key of keys) setBoundedBinding(key, engagement.id)
      recordSessionBinding(store, exec, engagement.id, engagement.name)
      const view = bindingViewOf(exec, store)
      return JSON.stringify({
        ok: true,
        engagement,
        stats: store.stats(engagement.id),
        session: view,
        note: '已绑定到本会话（会话隔离：其它会话的绑定不受影响）；子智能体会继承本项目工作区。'
          + (view.is_subagent ? ' 注意：本会话是子智能体，通常不需要再 open，直接继承父会话项目工作区即可。' : ''),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_session_bind',
    description: '把一个**已经存在**的 LMTAgent 项目工作区绑定到当前会话（多会话并行研发时用：每个会话绑自己的项目，互不串写）。可用项目 id 或名称，省略则列出可绑定的项目工作区。',
    parameters: {
      engagement: { type: 'string', description: '项目工作区 id 或名称；省略只列出候选' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const list = store.listEngagements()
      const wanted = typeof args.engagement === 'string' ? args.engagement.trim() : ''
      if (wanted === '') {
        return JSON.stringify({
          ok: false,
          candidates: list.map((e) => ({ id: e.id, name: e.name, created_at: e.created_at, stats: e.stats })),
          note: '请传 engagement（项目工作区 id 或名称）完成绑定。',
        }, null, 2)
      }
      const hit = list.find((e) => e.id === wanted)
        || list.find((e) => String(e.name) === wanted)
        || list.find((e) => String(e.name).includes(wanted))
      if (hit === undefined) {
        return JSON.stringify({ ok: false, error: '项目工作区不存在：' + wanted, candidates: list.map((e) => e.id) }, null, 2)
      }
      const keys = bindKeysOf(exec)
      for (const key of keys) setBoundedBinding(key, hit.id)
      recordSessionBinding(store, exec, hit.id, hit.name)
      return JSON.stringify({
        ok: true, engagement: { id: hit.id, name: hit.name },
        session: bindingViewOf(exec, store),
        note: '本会话已绑定到「' + hit.name + '」；后续工具与交付报告都只作用于它。',
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_scope_check',
    description: '检查一个服务节点/IP/URL/域名是否在当前项目工作区的 scope 范围内（scope 来自 redteam_engagement_open）。域名无法解析时返回 unresolved；scope 为空时返回 unscoped（不阻断，但提示用户补充范围）。',
    parameters: {
      engagement: { type: 'string' },
      target: { type: 'string', required: true, description: '要检查的服务地址 / IP / URL / 域名' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const check = scopeCheck(store, id, args.target)
      const ok = check.status === 'in' || check.status === 'unscoped' || check.status === 'unresolved'
      return JSON.stringify({ ok, engagement: id, target: args.target, ...check }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_session_info',
    description: '查看**当前会话绑定的是哪个 LMTAgent 项目工作区**（会话 id、父会话、根会话、绑定链）。多会话同时研发时，先跑它确认自己没串到别的项目工作区上。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(_args, exec) {
      const view = bindingViewOf(exec, store)
      const changed = view.bound_engagement !== null ? store.stats(view.bound_engagement) : null
      return JSON.stringify({
        ok: true, session: view, stats: changed,
        bindings_now: Array.from(bindings, ([k, v]) => ({ session: k, engagement: v })),
        note: '绑定是进程内状态：dsh 重启后各会话需要重新绑定一次（redteam_engagement_open / redteam_session_bind）。'
          + '面板的"跟随会话"读的是落盘绑定表，重启后仍能对上（见 redteam_engagement_open 的写入）。',
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_preflight',
    description: '【开工前必须跑一次】LMTAgent 研发集群技能与工程环境自检：逐个检查工程技能的必需环境变量（如 DEEPSEEK_API_KEY / FOFA_KEY）、本机开发与测试工具链、PostgreSQL 16+ 数据库连接与远程沙箱基础设施（VPS）。返回 available/broken 清单与每个缺口"缺什么、怎么补"。**缺 key / 缺远程环境时直接向用户说明，或改用本地替代方案，不要假装能跑。** 同时返回当前绑定项目工作区的角色提示词新鲜度（`prompts.stale_count`）。',
    parameters: {
      include: { type: 'string', description: '只检查这些技能（逗号分隔）；省略则检查全部工程技能' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const skills = ctx.get('skills')
      if (skills === undefined || skills === null || typeof skills.list !== 'function') {
        return JSON.stringify({
          ok: false,
          error: '技能注册表不可用：无法做技能自检。请改用系统注入的 <available_skills> 清单人工核对，并向用户索要缺失的 key/资源。',
        }, null, 2)
      }
      let summaries = []
      try {
        summaries = await skills.list()
      } catch (error) {
        return JSON.stringify({ ok: false, error: '读取技能目录失败：' + (error && error.message ? error.message : String(error)) }, null, 2)
      }
      const only = splitList(args.include)
      const knownNames = new Set(summaries.map((s) => s && s.name).filter(Boolean))
      const unknownIncludes = only.filter((n) => !knownNames.has(n))
      const wanted = summaries.filter((s) => only.length === 0 || only.includes(s.name))
      const envFile = expandSkillPath('$DSH_HOME/.env')
      const effectiveEnv = { ...process.env }
      let envFileKeys = []
      try {
        if (existsSync(envFile)) {
          const { readFileSync } = await import('node:fs')
          for (const line of readFileSync(envFile, 'utf8').split('\n')) {
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
            if (m === null) continue
            const key = m[1]
            const value = m[2].trim().replace(/^["']|["']$/g, '')
            if (value === '') continue
            envFileKeys.push(key)
            if (effectiveEnv[key] === undefined || effectiveEnv[key] === '') effectiveEnv[key] = value
          }
        }
      } catch { /* .env 读不到不影响主流程 */ }
      const rootsWith = new Map()
      for (const x of summaries) {
        const dir = x.resourceBase && x.resourceBase.kind === 'directory' ? x.resourceBase.path : null
        if (dir === null) continue
        if (!rootsWith.has(x.name)) rootsWith.set(x.name, [])
        if (!rootsWith.get(x.name).includes(dir)) rootsWith.get(x.name).push(dir)
      }
      const checked = []
      for (const summary of summaries) {
        let def
        try { def = await skills.get(summary.name) } catch { def = undefined }
        const path = def && typeof def.path === 'string'
          ? def.path
          : (summary.resourceBase && summary.resourceBase.kind === 'directory' ? summary.resourceBase.path : null)
        const root = summary.resourceBase && summary.resourceBase.kind === 'directory' ? summary.resourceBase.path : null
        const verdict = checkSkill({ name: summary.name, content: def && def.content, path, root },
          { env: effectiveEnv, sameNameIn: rootsWith.get(summary.name) || [] })
        checked.push(Object.assign({}, verdict, {
          title: summary.description,
          path,
          when_to_use: summary.whenToUse || '',
          needs_user: verdict.needs_user.map((n) => (n.startsWith('环境变量')
            ? n + '（拿到后 export 并重启 dsh web）'
            : n === 'VPS 地址' || n === 'VPS 主机名'
              ? '远程构建/联调沙箱用的 ' + n + '（技能里还是占位符）'
              : n)),
        }))
      }
      const allBroken = checked.filter((s) => s.status === 'broken')
      const allAvailable = checked.filter((s) => s.status === 'available')
      const shown = (x) => only.length === 0 || only.includes(x.name)
      const broken = allBroken.filter(shown)
      const available = allAvailable.filter(shown)
      const toolkit = expandSkillPath('$DSH_HOME/redteam/toolkit')
      let toolkitEntries = []
      try {
        if (existsSync(toolkit)) {
          const { readdirSync } = await import('node:fs')
          toolkitEntries = readdirSync(toolkit).slice(0, 60)
        }
      } catch { /* 忽略 */ }

      const redteamDir = expandSkillPath('$DSH_HOME/redteam')
      const markerFile = redteamDir + '/.setup-complete'
      const setupScript = redteamDir + '/setup.sh'
      const hasMarker = existsSync(markerFile)
      const toolkitHint = '扩展工程工具箱按需配置：可按技能 `redteam-setup` 逐项配置环境变量与 PostgreSQL 连接。'
      let fofaKey = effectiveEnv.FOFA_KEY || ''
      const vpsKey = effectiveEnv.REDTEAM_VPS_KEY || (toolkit + '/vps/id_rsa')
      const vpsHost = effectiveEnv.REDTEAM_VPS_HOST || ''
      const hasVps = existsSync(vpsKey)
      const needsUser = Array.from(new Set(broken.flatMap((s) => s.needs_user)))
      const missing = []
      if (fofaKey === '') missing.push('FOFA_KEY（外部服务拓扑索引密钥：未配置时自动使用本地仓库扫描与开放接口发现）')
      if (!hasVps) missing.push('VPS 远程联调沙箱密钥（跨网段与容器集群联调环境）—— 私钥路径 ' + vpsKey + '，并设 REDTEAM_VPS_HOST=用户@主机（配置步骤见技能 `redteam-setup`）')
      const fofaShown = fofaKey.length > 8 ? fofaKey.slice(0, 4) + '…' + fofaKey.slice(-4) : '(已配置)'
      const runtimeHint = '建议在独立开发容器或隔离工作区中运行高并发构建与自动化验证任务，首次开工时提示一次即可。'
      const onboarding = {
        complete: hasMarker && missing.length === 0 && allBroken.length === 0,
        runtime_hint: runtimeHint,
        first_run: !hasMarker,
        marker: { path: markerFile, exists: hasMarker },
        setup_script: { path: setupScript, exists: existsSync(setupScript) },
        toolkit: toolkitHint,
        configured: {
          fofa_key: fofaKey === '' ? 'missing' : 'configured(' + fofaShown + ')',
          vps_key: hasVps ? 'configured(' + vpsKey + ')' : 'missing',
          vps_host: vpsHost,
          env_file: { path: envFile, exists: existsSync(envFile), keys: envFileKeys },
        },
        missing,
      }
      let next
      if (!hasMarker && !existsSync(setupScript)) {
        next = '首次使用，且本机没有安装脚本 ' + setupScript + '（属正常）。'
          + toolkitHint + ' '
          + '两条配置路径：① 按技能 `redteam-setup` 逐项配置；'
          + '② 把 onboarding.missing 一次性列给用户，未配置外部密钥时按替代方案降级推进本地研发与测试。'
      } else if (!hasMarker) {
        next = '**首次使用**：先加载技能 `redteam-setup`，执行 `bash ' + setupScript + ' --check` 检查环境，'
          + '把 onboarding.missing 一次性列给用户，或按替代方案直接推进本地软件工程研发与自动化测试。'
      } else if (missing.length > 0) {
        next = '环境标记存在但有可选外部资源未配置：参考技能 `redteam-setup` 手动补配，或按替代方案直接推进本地模块研发与测试。'
      } else if (allBroken.length > 0) {
        next = '把 broken 里 needs_user 的每一项一次性列给用户，补齐后再调用对应技能；或采用本地替代方案继续推进研发。'
      } else {
        next = '全部可用，可以开工。'
      }

      const summary = summarizeSkills(checked)
      let prompts = null
      try {
        const view = bindingViewOf(exec, store)
        const eng = view.bound_engagement ?? view.panel_follow_engagement
        if (eng !== null && eng !== undefined) {
          const roles = store.listPrompts(eng)
          const stale = roles.filter((r) => r.injected === true && r.stale === true)
            .map((r) => ({ role: r.role, title: r.title }))
          prompts = {
            engagement: eng, total: roles.length, stale_count: stale.length, stale,
            hint: stale.length === 0
              ? '执行角色提示词均为当前版。'
              : '有 ' + stale.length + ' 个执行角色的提示词仍是旧版/自写：先用面板「恢复默认」或 scripts/refresh-all-prompts.mjs 刷新，再开工。',
          }
        }
      } catch (error) {
        prompts = { error: error && error.message ? error.message : String(error) }
      }
      return JSON.stringify({
        ok: allBroken.length === 0 && missing.length === 0,
        include: only.length > 0 ? { requested: only, unknown: unknownIncludes } : undefined,
        all_checked: { total: checked.length, broken: allBroken.length, available: allAvailable.length },
        db_engine: typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : null,
        onboarding,
        prompts,
        summary,
        checked: checked.length,
        available: available.map((s) => s.name),
        broken: broken.map((s) => ({ name: s.name, problems: s.problems, needs_user: s.needs_user })),
        unknown: checked.filter((s) => s.status === 'unknown').map((s) => s.name),
        toolkit: { dir: toolkit, exists: existsSync(toolkit), entries: toolkitEntries },
        skills_root_hint: '技能来自 DSH 原生注册表：本插件自带 + $DSH_HOME/skills + 项目根 + 各插件注册的根。',
        next,
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_agent_slot',
    description: '【Captain 主会话与父分片派活前后用】LMTAgent 研发集群并发闸门与文件分片锁：同一项目工作区**最多同时 N 个**子智能体在跑（N 是当前配置的并发槽数，默认 6 槽，最高 12 槽；控制台「智能体」页可动态调节，立即生效；预留租约 TTL 120s 防漏槽）。action=status 查看剩余槽位、后代递归深度与在跑角色；action=acquire 占用并发槽并可选校验 `files_owned` 文件分片无交集（冲突或满槽直接拒绝，**不要重试硬塞**）；action=release 释放槽位（子智能体结束时服务端也会自动释放）。',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'acquire', 'release'], description: 'status 查看 / acquire 占用 / release 释放' },
      label: { type: 'string', description: 'acquire 时的任务分片标签，例如「Wave3 exploit 分片构建 #1：存储层重构」' },
      key: { type: 'string', description: 'release 时指定要释放的键（省略则释放最早的一个预留）' },
      child_id: { type: 'string', description: '可选：绑定的子会话 ID（用于 subagent/end 精确释放对应槽位）' },
      files_owned: {
        type: 'array',
        items: { type: 'string' },
        description: '该子智能体独占负责的文件或目录列表（File-Disjoint Sharding 运行时冲突检测）',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const { rootId, sessionId } = bindingKeyOf(exec)
      const owner = rootId ?? sessionId
      if (owner === undefined) {
        return JSON.stringify({ ok: false, error: '取不到会话 id：无法统计并发（请确认工具调用带着 agent 上下文）。' }, null, 2)
      }
      const now = Date.now()
      pruneExpiredReservations(now, store)
      const live = await liveRunningChildren(ctx, owner)
      const reserved = reservationList(owner, now, store)
      const used = Math.max(live.running, reserved.length)
      const max = maxAgentsNow(ctx)
      const free = Math.max(max - used, 0)
      const base = {
        ok: true, max, used, free,
        running_from_registry: live.running,
        direct_running: live.directRunning ?? 0,
        directRunning: live.directRunning ?? 0,
        max_observed_depth: live.maxObservedDepth ?? 0,
        maxObservedDepth: live.maxObservedDepth ?? 0,
        max_depth: live.maxDepth,
        maxDepth: live.maxDepth,
        lease_ttl_ms: RESERVATION_TTL_MS,
        running_labels: live.running_labels ?? [],
        reservations: reserved,
        registry_available: live.available,
        registry_note: live.available ? undefined : live.error,
      }
      if (args.action === 'status') {
        return JSON.stringify(Object.assign({}, base, {
          hint: free === 0
            ? '并发槽已满：等现有子智能体回报后再派发下一波次任务。'
            : '还有 ' + free + ' 个并发槽可用。文件无交集的分片任务可按 4-Wave DAG 并行派发。',
        }), null, 2)
      }
      if (args.action === 'acquire') {
        const requestedFiles = Array.isArray(args.files_owned)
          ? Array.from(new Set(args.files_owned.map(normalizeShardPattern).filter(Boolean)))
          : []
        if (requestedFiles.length > 0) {
          const conflictCheck = detectShardConflicts(requestedFiles, reserved)
          if (!conflictCheck.ok) {
            return JSON.stringify(Object.assign({}, base, {
              ok: false,
              error: '文件分片冲突（File-Disjoint Sharding Violation）',
              conflicts: conflictCheck.conflicts,
              hint: '两个并发子智能体声明了重叠的 files_owned 文件分片：请调整分片边界确保严格无交集，或等待持有该文件的子智能体完成释放后再派发。',
            }), null, 2)
          }
        }
        if (free <= 0) {
          return JSON.stringify(Object.assign({}, base, {
            ok: false,
            error: '并发已满（最多 ' + max + ' 个）：现在不能派新智能体。先等当前的在跑智能体回报，或先 release 掉已经结束的。',
          }), null, 2)
        }
        const cleanLabel = typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : 'slot'
        const key = cleanLabel + '#' + now
        let engId
        try { engId = resolveEngagement(store, exec, undefined) } catch { engId = bindings.get(owner) }
        if (requestedFiles.length > 0 && store && typeof store.acquireShardLocks === 'function') {
          const storeLock = await store.acquireShardLocks(engId || owner, {
            engagement: engId || owner,
            engagement_id: engId || owner,
            owner: key,
            worker_name: cleanLabel,
            label: cleanLabel,
            files_owned: requestedFiles,
            ttl_ms: RESERVATION_TTL_MS,
          })
          if (storeLock && storeLock.ok === false) {
            return JSON.stringify(Object.assign({}, base, {
              ok: false,
              error: '文件分片冲突（File-Disjoint Sharding Violation）',
              conflicts: Array.isArray(storeLock.conflicts) ? storeLock.conflicts : [],
              hint: '持久化文件分片锁检测到重叠的 files_owned：请调整分片边界确保严格无交集，或等待持有锁的子智能体释放后再派发。',
            }), null, 2)
          }
        }
        const entry = addReservation(owner, {
          key,
          label: cleanLabel,
          childId: typeof args.child_id === 'string' && args.child_id.trim() !== '' ? args.child_id.trim() : undefined,
          files_owned: requestedFiles,
          engagementId: engId,
        }, now)
        const updatedReserved = reservationList(owner, now, store)
        return JSON.stringify(Object.assign({}, base, {
          slot: key,
          used: used + 1,
          free: Math.max(max - used - 1, 0),
          files_owned: entry.files_owned,
          expires_at: entry.expires_at,
          reservations: updatedReserved,
          hint: '已占位（' + key + '）。**派完之后要记得**：子智能体结束会自动释放（或 120s 租约超时自动回收）；若你派活失败（比如工具报错），手动 redteam_agent_slot action=release key=' + key + ' 把它放掉。',
        }), null, 2)
      }
      const wantedKey = typeof args.key === 'string' && args.key.trim() !== '' ? args.key.trim() : undefined
      const dropped = wantedKey !== undefined
        ? dropReservation(owner, wantedKey, store)
        : dropOldestReservation(owner, store)
      const remainingReserved = reservationList(owner, now, store)
      return JSON.stringify(Object.assign({}, base, {
        ok: true,
        released: dropped,
        reservations: remainingReserved,
        used: Math.max(live.running, remainingReserved.length),
        free: Math.max(max - Math.max(live.running, remainingReserved.length), 0),
      }), null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_add',
    description: '把一个工程模块/服务节点及其端口/接口/技术栈指纹写入项目注册表（幂等 upsert）。每条记录必须标注 provenance：静态/配置解析填 passive，运行时探测/联调验证填 active，并填写 tool（分析器或工具名）。',
    parameters: {
      engagement: { type: 'string', description: '项目工作区 id；省略则用当前会话绑定的项目' },
      ip: { type: 'string', required: true, description: '服务节点地址或模块标识 IP（IPv4）' },
      state: { type: 'string', description: 'live | dead | unknown，默认 unknown' },
      primary_name: { type: 'string', description: '主模块名 / 服务域名 / 主机名' },
      provenance: { type: 'string', required: true, enum: ['passive', 'active'], description: '本条记录来源：静态解析(passive)或运行时验证(active)' },
      tool: { type: 'string', description: '数据源或工具名，例如 ast-scanner / openapi / curl / vitest' },
      discovered_at: { type: 'string', description: '【可选】该模块/服务节点的首次登记时间（ISO，如 2026-09-17T09:30:00Z）。不填则按第一次入库时刻自动记录；**重复采集不会覆盖它**。' },
      first_seen: { type: 'string', description: '【可选】数据源报告的首次出现时间（与登记时间分开记）' },
      names: {
        type: 'array',
        description: '该节点关联的模块别名/域名/服务标识',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            kind: { type: 'string', description: 'domain | hostname | cert_cn，默认 domain' },
            provenance: { type: 'string', enum: ['passive', 'active'] },
          },
        },
      },
      ports: {
        type: 'array',
        description: '服务监听端口及其协议/技术栈指纹',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            port: { type: 'number', required: true },
            proto: { type: 'string', description: 'tcp（默认）| udp' },
            service: { type: 'string', description: '服务名，例如 http / postgresql / grpc' },
            product: { type: 'string', description: '运行时/框架产品名，例如 Node.js / nginx / PostgreSQL' },
            version: { type: 'string', description: '版本，例如 22.0.0 / 16.4' },
            banner: { type: 'string', description: '服务响应头或版本摘要' },
            url: { type: 'string', description: 'Web/API 服务可直接访问的完整 URL，例如 https://api.example.com:8443/v1/health' },
            title: { type: 'string', description: 'Web 页面标题或服务路由名称' },
            provenance: { type: 'string', enum: ['passive', 'active'] },
            tool: { type: 'string' },
            fingerprints: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  category: { type: 'string', description: 'Web服务 | 微服务框架 | 数据库 | 消息队列 | API网关 …' },
                  vendor: { type: 'string' },
                  product: { type: 'string' },
                  version: { type: 'string' },
                  evidence: { type: 'string', description: '判定依据，例如 package.json / 响应头 / OpenAPI schema' },
                  confidence: { type: 'number', description: '0–1' },
                },
              },
            },
          },
        },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const asset = {
        ip: args.ip, state: args.state, primary_name: args.primary_name,
        provenance: args.provenance, tool: args.tool,
        names: args.names, ports: args.ports,
        discovered_at: args.discovered_at,
        first_seen: args.first_seen,
      }
      const result = store.importBundle(id, { scan: { tool: args.tool, argv: ['redteam_asset_add'] }, assets: [asset] })
      const written = store.listAssets(id, { ip: args.ip, limit: 1 }).items[0]
      return JSON.stringify({
        ok: true, engagement: id, counts: result.counts,
        asset: written ? compactAsset(written) : null,
        discovered_at: written ? written.discovered_at : null,
        hint: '本条模块/服务节点的登记时间已记为 ' + (written && written.discovered_at ? written.discovered_at : '(未知)')
          + '；重复同步只刷新 last_seen，不会改动首次登记时间。',
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_batch',
    description: '批量写入项目事实库，减少逐条调用：kind=assets 批量登记模块/服务节点（最多 500，复用 asset_add 的字段与幂等去重）；kind=assess 批量架构优先级与分片评估（最多 200）；kind=vulns 批量登记代码审查/质量缺陷（最多 200，带 request/response 自动存接口请求证据）。超出 scope 的条目会跳过并在 rejected 里说明。',
    parameters: {
      engagement: { type: 'string' },
      kind: { type: 'string', required: true, enum: ['assets', 'assess', 'vulns'] },
      items: {
        type: 'array', required: true,
        description: 'assets: [{ip, provenance, tool, state, primary_name, names, ports, discovered_at}]；assess: [{asset_id|ip, priority, potential, reason}]；vulns: [{title, severity, asset_id, cve, target, evidence, status, gained, request, response, method}]',
        items: { type: 'object', additionalProperties: true },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const kind = String(args.kind || '')
      const items = Array.isArray(args.items) ? args.items : []
      const limit = kind === 'assets' ? 500 : 200
      if (items.length === 0 || items.length > limit) throw new Error('redteam_batch: items 数量必须在 1..' + limit)
      const rejected = []
      const results = []
      if (kind === 'assets') {
        const accepted = []
        for (const it of items) {
          const check = scopeCheck(store, id, it && it.ip)
          if (check.status === 'out') { rejected.push({ ip: it && it.ip, reason: 'out_of_scope', scope: check.scope }); continue }
          if (!it || typeof it.ip !== 'string' || it.ip.trim() === '') { rejected.push({ item: it, reason: 'ip required' }); continue }
          accepted.push(it)
        }
        const out = accepted.length > 0
          ? store.importBundle(id, { scan: { tool: 'redteam_batch', argv: ['assets'] }, assets: accepted })
          : { counts: { assets: 0 } }
        return JSON.stringify({ ok: true, engagement: id, kind, accepted: accepted.length, rejected: rejected.length, counts: out.counts, rejected }, null, 2)
      }
      if (kind === 'assess') {
        for (const it of items) {
          try { results.push(store.assessAsset(id, it || {})) }
          catch (error) { rejected.push({ item: it, reason: error && error.message ? error.message : String(error) }) }
        }
        return JSON.stringify({ ok: true, engagement: id, kind, assessed: results.length, rejected: rejected.length, results, rejected }, null, 2)
      }
      if (kind === 'vulns') {
        for (const it of items) {
          const check = scopeCheck(store, id, it && it.target)
          if (check.status === 'out') { rejected.push({ target: it && it.target, reason: 'out_of_scope', scope: check.scope }); continue }
          try {
            const v = store.addVuln(id, { ...it, engagement: undefined, agent: agentOf(args), found_by_agent: it.found_by_agent || it.agent || 'vuln-scan' })
            let httpEvidenceId = null
            const request = typeof it.request === 'string' ? it.request.trim() : ''
            if (request !== '') {
              try {
                const ev = store.addHttpEvidence(id, { vuln_id: v.id, asset_id: it.asset_id, label: it.title, method: it.method || 'GET', url: it.target, request, response: it.response, captured_by: agentOf(args) })
                httpEvidenceId = ev.id
              } catch { /* 缺陷已落库 */ }
            }
            results.push({ id: v.id, updated: v.updated === true, http_evidence_id: httpEvidenceId })
          } catch (error) { rejected.push({ item: it, reason: error && error.message ? error.message : String(error) }) }
        }
        return JSON.stringify({ ok: true, engagement: id, kind, inserted: results.length, rejected: rejected.length, results, rejected }, null, 2)
      }
      throw new Error('redteam_batch.kind 只接受 assets / assess / vulns')
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_link',
    description: '在项目模块注册表中写入一条依赖/调用关系边（架构拓扑与影响面分析共用）。relation 例如 depends_on / exposes / contains / calls / shares_schema。',
    parameters: {
      engagement: { type: 'string' },
      src_kind: { type: 'string', required: true, description: 'segment | asset | domain | port …' },
      src_id: { type: 'string', required: true },
      dst_kind: { type: 'string', required: true },
      dst_id: { type: 'string', required: true },
      relation: { type: 'string', required: true },
      confidence: { type: 'number' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.importBundle(id, {
        edges: [{
          src_kind: args.src_kind, src_id: args.src_id,
          dst_kind: args.dst_kind, dst_id: args.dst_id,
          relation: args.relation, confidence: args.confidence,
        }],
      })
      return JSON.stringify({ ok: true, edges: result.counts.edges }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_query',
    description: '检索项目模块与服务节点注册表。支持按网段/分组（cidr）、端口、服务、技术栈指纹、来源、内外部维度（scope）、架构评估状态（assessed=yes/no）、排序（sort）、关键词（全文，覆盖 IP/模块名/banner/服务/指纹）过滤；limit+offset 翻页。返回紧凑结果，含每个节点的开放端口、技术栈指纹及归属。',
    parameters: {
      engagement: { type: 'string' },
      cidr: { type: 'string', description: '模块分组或网段，例如 10.0.1.0/24' },
      port: { type: 'number', description: '监听端口' },
      service: { type: 'string', description: '服务/产品名关键词，例如 postgresql / express' },
      fingerprint: { type: 'string', description: '技术栈指纹关键词，例如 React / Fastify / Spring' },
      provenance: { type: 'string', enum: ['passive', 'active'], description: '只看静态解析(passive)或运行时验证(active)' },
      q: { type: 'string', description: '全文检索词（空格分隔多词为 AND）' },
      state: { type: 'string', enum: ['live', 'dead', 'unknown'] },
      scope: { type: 'string', enum: ['internal', 'external'], description: '部署维度：internal=内部微服务/私网节点，external=对外网关/公开接口' },
      sort: { type: 'string', enum: ['priority', 'todo', 'unassessed', 'ports', 'ip'], description: '排序：priority=优先级优先（默认），todo=待验证优先，unassessed=未评估优先，ports=接口多优先，ip=按地址' },
      assessed: { type: 'string', enum: ['yes', 'no'], description: '架构评估过滤：yes=已评估（assessed_at 有值），no=未评估' },
      limit: { type: 'number', description: '返回条数上限，默认 50，最大 200' },
      offset: { type: 'number', description: '分页偏移，默认 0；配合 limit 翻页' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const limit = Math.min(Number(args.limit) || 50, 200)
      const result = store.listAssets(id, {
        cidr: args.cidr, port: args.port, service: args.service,
        fingerprint: args.fingerprint, provenance: args.provenance,
        q: args.q, state: args.state, scope: args.scope, sort: args.sort, assessed: args.assessed,
        limit, offset: Math.max(Number(args.offset) || 0, 0),
      })
      return JSON.stringify({
        ok: true, engagement: id, total: result.total, returned: result.items.length,
        items: result.items.map(compactAsset),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_get',
    description: '取单个模块/服务节点的完整详情：全部端口与接口服务、技术栈指纹、登记时间线、依赖关系边。用于深入分析某个模块或服务。',
    parameters: {
      engagement: { type: 'string' },
      id: { type: 'number', required: true, description: '模块/资产 id（来自 redteam_asset_query 结果）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const asset = store.getAsset(id, args.id)
      if (asset === undefined) return JSON.stringify({ ok: false, error: 'asset not found' })
      return JSON.stringify({ ok: true, asset }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_stats',
    description: '项目模块与服务拓扑统计概览：子网/分组数、模块节点数（活跃）、开放接口端口、服务数、技术栈指纹数、静态/运行时信号条数，以及各分组明细。',
    parameters: { engagement: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, stats: store.stats(id), segments: store.listSegments(id) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_graph',
    description: '导出项目架构依赖图谱（子网/分组 → 服务节点 → 接口端口，含域名/路由绑定边），用于系统拓扑分析与调用链规划。节点数超过上限时按 cidr 缩小范围。',
    parameters: {
      engagement: { type: 'string' },
      cidr: { type: 'string', description: '只取某个分组/网段的子图' },
      maxNodes: { type: 'number', description: '节点上限，默认 300' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const maxNodes = Math.min(Number(args.maxNodes) || 300, 1000)
      const graph = store.graph(id, { cidr: args.cidr })
      if (graph.nodes.length > maxNodes) {
        return JSON.stringify({
          ok: false,
          error: '图谱节点过多（' + graph.nodes.length + ' > ' + maxNodes + '），请指定 cidr 缩小范围',
          segments: store.listSegments(id).map((s) => ({ cidr: s.cidr, assets: s.assets })),
        }, null, 2)
      }
      return JSON.stringify({ ok: true, engagement: id, nodes: graph.nodes, edges: graph.edges }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_role_prompt',
    description: '取出 LMTAgent 研发集群某个专项角色（CEO / Designer / Eng Manager / Reviewer & CSO / Builder / QA Lead / Doc & Release）当前生效的系统提示词。委派子智能体时，把该提示词作为角色约束放进任务描述。',
    parameters: {
      engagement: { type: 'string' },
      role: { type: 'string', required: true, enum: ROLE_ORDER },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const found = store.listPrompts(id).find((p) => p.role === args.role)
      if (found === undefined) return JSON.stringify({ ok: false, error: 'unknown role' })
      return JSON.stringify({
        ok: true, role: found.role, title: found.title,
        updated_at: found.updated_at, prompt: found.content,
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_roles',
    description: '列出 LMTAgent 研发集群八大角色及其职责标题（Captain 主控指挥 / CEO 产品与需求规划 / Designer 交互与视觉设计 / Eng Manager 系统架构与排期 / Reviewer & CSO 代码审查与安全 / Builder 全栈研发与构建 / QA Lead 质量保障与测试 / Doc & Release 文档工程与发布）。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute() {
      return JSON.stringify({
        ok: true,
        roles: Object.entries(ROLE_TITLES).map(([role, title]) => ({ role, title })),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_test',
    description: '记录对某个模块/服务节点的研发与测试进度：本次完成了什么开发或验证（`test`，追加式）、还剩什么待办接口或边界（`surface`，覆盖式）、当前验证状态、是否存在阻塞。**每个模块开始开发/验证前先调一次（status=testing），完成后再调一次（status=tested）**——控制台据此展示「待验证 / 研发测试中 / 已验证 / 受阻 / 已搁置 / 无需改动」。',
    parameters: {
      engagement: { type: 'string' },
      asset_id: { type: 'number', description: '模块/资产 id（与 ip 二选一，优先 asset_id）' },
      ip: { type: 'string', description: '模块/服务节点地址' },
      status: { type: 'string', enum: ['untested', 'testing', 'tested', 'blocked', 'abandoned', 'no_surface'], description: '验证状态：未验证/研发测试中/已验证/受阻/已搁置/无需改动' },
      test: { type: 'string', description: '本次完成了什么开发或测试（**追加**到进度记录，例如「完成 Schema 迁移 + 单元测试 18/18 通过」）。排除结论、受阻原因、重构说明都写这里。' },
      notes: { type: 'string', description: 'test 的兼容别名，效果与 test 相同，会一并追加到进度记录。' },
      surface: { type: 'string', description: '还剩什么待实现或待验证接口（覆盖式，例如「WebSocket 推送待压测；/api/v2 导出待加分页」）' },
      blocked: { type: 'boolean', description: '本次是否遇到外部依赖/环境阻塞（true 时阻塞计数 +1）' },
      updated_by: { type: 'string', description: '记录角色，例如 recon / exploit / qa' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.updateAssetTest(id, { ...args, engagement: undefined })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  /* ================================================================== 代码审查与缺陷追踪 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_vuln_add',
    description: '记录一条代码审查发现、架构隐患或质量缺陷（Reviewer & CSO / QA 角色）。带 cve/缺陷编号时按 (asset_id, cve, target) 幂等更新。severity：critical|high|medium|low|info；status：candidate（待复核）|confirmed（已确认）|false-positive（误报）|exploited（已复现验证）|fixed（已修复）。必须附可复现证据（代码位置、测试用例输出、请求/响应片段或修复前后对比）。',
    parameters: {
      engagement: { type: 'string' },
      agent: AGENT_PARAM,
      asset_id: { type: 'number', description: '关联模块/资产 id（来自 redteam_asset_query）' },
      cve: { type: 'string', description: '缺陷编号 / Issue ID / CVE 编号（无编号可省略）' },
      title: { type: 'string', required: true, description: '缺陷或审查发现标题' },
      severity: { type: 'string', required: true, enum: ['critical', 'high', 'medium', 'low', 'info'] },
      status: { type: 'string', enum: ['candidate', 'confirmed', 'false-positive', 'exploited', 'fixed'] },
      target: { type: 'string', description: '受影响的文件路径、模块或接口 URL，如 packages/core/db.js:120 或 https://host:443/api' },
      source: { type: 'string', description: '发现方式：code-review / vitest / eslint / benchmark / manual …' },
      confidence: { type: 'number', description: '0–1' },
      evidence: { type: 'string', description: '验证证据：测试断言输出、堆栈摘要、复现命令或文件路径' },
      found_by_agent: { type: 'string', description: '发现角色，默认 vuln-scan' },
      gained: { type: 'string', description: '【重要】该项修复或验证达成的工程成果标签，多项用顿号或逗号分隔，例如「核心接口闭环、事务一致性」「鉴权加固」「查询性能提升」' },
      method: { type: 'string', description: '【可选】HTTP 方法；填 request 时用' },
      request: { type: 'string', description: '【可选，建议填】完整接口测试请求报文（可重放）；带上会自动保存 HTTP 验证证据，不需要再单独调 redteam_http_evidence_add。' },
      response: { type: 'string', description: '【可选】接口响应全文或关键断言片段' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addVuln(id, { ...args, engagement: undefined, agent: agentOf(args), found_by_agent: args.found_by_agent || args.agent || 'vuln-scan' })
      let httpEvidenceId = null
      const request = typeof args.request === 'string' ? args.request.trim() : ''
      if (request !== '') {
        try {
          const evidence = store.addHttpEvidence(id, {
            vuln_id: result.id, asset_id: args.asset_id, label: args.title,
            method: args.method || 'GET', url: args.target, request,
            response: args.response, captured_by: agentOf(args),
          })
          httpEvidenceId = evidence.id
        } catch { /* 缺陷已落库；证据失败不阻断 */ }
      }
      return JSON.stringify({ ok: true, engagement: id, ...result, http_evidence_id: httpEvidenceId, stats: store.vulnStats(id) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_vuln_query',
    description: '检索代码审查与质量缺陷库：按严重级、状态、编号、模块资产、分组或关键词过滤。用于排期修复、门禁核对或回归测试。',
    parameters: {
      engagement: { type: 'string' },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      status: { type: 'string', enum: ['candidate', 'confirmed', 'false-positive', 'exploited', 'fixed'] },
      cve: { type: 'string' },
      asset_id: { type: 'number' },
      cidr: { type: 'string' },
      q: { type: 'string', description: '标题/编号/目标模块/证据关键词' },
      limit: { type: 'number', description: '默认 50，最大 200' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.listVulns(id, { ...args, engagement: undefined, limit: Math.min(Number(args.limit) || 50, 200) })
      return JSON.stringify({ ok: true, engagement: id, total: result.total, items: result.items, stats: store.vulnStats(id) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_vuln_update',
    description: '更新代码缺陷或审查项的状态/严重级/证据（例如复核确认置为 confirmed、端到端复现验证置为 exploited、修复通过置为 fixed、误报置为 false-positive）。',
    parameters: {
      engagement: { type: 'string' },
      id: { type: 'number', required: true, description: '缺陷记录 id' },
      status: { type: 'string', enum: ['candidate', 'confirmed', 'false-positive', 'exploited', 'fixed'] },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      evidence: { type: 'string' },
      confidence: { type: 'number' },
      gained: { type: 'string', description: '该项验证或修复达成的工程成果标签（多项用顿号分隔）' },
      title: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.updateVuln(id, args.id, { status: args.status, severity: args.severity, evidence: args.evidence, confidence: args.confidence, gained: args.gained, title: args.title })
      return JSON.stringify({ ok: result.updated, engagement: id, ...result, stats: store.vulnStats(id) }, null, 2)
    },
  })))

  /* ================================================================== 服务凭据 / 运行时环境与截图产物 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_credential_add',
    description: '登记一条测试环境服务凭据、API Token 或数据库连接配置（供 Builder / QA 角色联调复用）。把连接凭据写进 secret_value 供本机联调直接读取，并用 secret_ref 指向配置文件或测试输出路径。注意：本库只在本机存储，严禁将真实生产密钥提交到公开代码仓库。',
    parameters: {
      engagement: { type: 'string' },
      agent: AGENT_PARAM,
      host: { type: 'string', required: true, description: '所属服务主机（IP、域名或服务名）' },
      username: { type: 'string' },
      secret_type: { type: 'string', description: 'password | hash | key | token | connection-string，默认 password' },
      secret_value: { type: 'string', description: '【必填】凭据内容：口令 / API Token / 私钥 / 数据库连接串' },
      secret_ref: { type: 'string', description: '配置或证据引用路径，例如 runs/env-pg-local.txt' },
      privilege: { type: 'string', description: '该凭据的权限范围，如 admin / read-write / readonly' },
      asset_id: { type: 'number' },
      source: { type: 'string', description: '来源：env-config / seed-fixture / integration-test …' },
      tool: { type: 'string' },
      note: { type: 'string' },
      found_by_agent: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addCredential(id, { ...args, engagement: undefined, agent: agentOf(args) })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_shot_add',
    description: '登记一张工程交付或测试验证截图：把 UI 视觉回归截图或终端验证截图拷进项目目录并关联到里程碑得分点（面板展开即可预览，交付报告里也会自动嵌入）。每个里程碑最多展示 3 张代表图。',
    parameters: {
      engagement: { type: 'string' },
      agent: AGENT_PARAM,
      path: { type: 'string', description: '图片在本机的路径（相对项目目录或绝对路径）；与 data_base64 二选一' },
      data_base64: { type: 'string', description: '图片内容（base64，可带 data: 前缀）' },
      label: { type: 'string', description: '图片说明，例如「Bento 控制台渲染回归通过截图」' },
      kind: { type: 'string', description: 'screenshot（真实界面/终端截图，默认）| card（由测试记录生成的摘要卡片，报告里会标注）' },
      point_code: { type: 'string', description: '关联的里程碑 code，如 web-app / server-host' },
      hit_id: { type: 'number', description: '关联到具体某条里程碑记录（score_hit id）' },
      asset_id: { type: 'number' },
      target: { type: 'string', description: '这张图对应的模块或服务目标（IP / URL / 组件名）' },
      note: { type: 'string', description: '补充说明：这张图验证了什么验收标准' },
      source_ref: { type: 'string', description: '原始来源路径' },
      captured_at: { type: 'string', description: '截图时间（ISO），缺省用当前时间' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addShot(id, { ...args, engagement: undefined, agent: agentOf(args) })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_shot_list',
    description: '列出已登记的工程交付与测试截图（含所属里程碑、目标模块、类型、落盘文件）。',
    parameters: {
      engagement: { type: 'string' },
      point_code: { type: 'string' },
      hit_id: { type: 'number' },
      asset_id: { type: 'number' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, ...store.listShots(id, {
        point_code: args.point_code, hit_id: args.hit_id, asset_id: args.asset_id,
      }) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_shot_delete',
    description: '删除一张已登记的截图（连同磁盘文件）。',
    parameters: {
      engagement: { type: 'string' },
      id: { type: 'number', required: true, description: 'shot id（redteam_shot_list 里返回的 id）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const eng = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: eng, ...store.deleteShot(eng, args.id) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_credential_list',
    description: '列出当前项目已登记的联调凭据与连接配置（含 secret_value），用于自动化测试与服务集成验证。',
    parameters: {
      engagement: { type: 'string' },
      host: { type: 'string' },
      username: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, items: store.listCredentials(id, { host: args.host, username: args.username }) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_access_add',
    description: '记录一次成功建立的服务连接或运行时调试会话（如 ssh / db / grpc / container-exec / http-admin）。privilege 例如 admin/user/system。',
    parameters: {
      engagement: { type: 'string' },
      host: { type: 'string', required: true },
      username: { type: 'string' },
      method: { type: 'string', required: true, description: '连接方式，例如 ssh / db / docker-exec / http' },
      privilege: { type: 'string' },
      asset_id: { type: 'number' },
      session_ref: { type: 'string', description: '会话日志或验证输出引用路径，例如 runs/session-pg-local.md' },
      note: { type: 'string' },
      found_by_agent: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addAccess(id, { ...args, engagement: undefined })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_access_list',
    description: '列出已登记的服务连接与调试会话。',
    parameters: {
      engagement: { type: 'string' },
      host: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, items: store.listAccess(id, { host: args.host }) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_role_prompt_reset',
    description: '把 LMTAgent 角色系统提示词恢复为内置默认（新版模板）。老项目工作区想升级到最新 8 角色 gstack 提示词时调用；省略 role 则全部角色重置。',
    parameters: {
      engagement: { type: 'string' },
      role: { type: 'string', enum: ROLE_ORDER },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.resetPrompts(id, args.role)
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  /* ---------- 运行态探针会话与环境网关通道：跨角色复用运行态句柄与网关端口 ---------- */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_sessions',
    description: '【每次决策前后都要看】一屏总览当前工作区所有可复用的运行态探针会话（Runtime Agent Sessions）、环境转发通道（含监听地址与可达服务段）、环境凭据与访问会话，并给出在线/离线统计。发起服务联调前先看这里，避免重复建立连接通道。',
    parameters: { engagement: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const summary = store.sessionSummary(id)
      return JSON.stringify({
        ok: true, engagement: id, totals: summary.totals,
        webshells: summary.webshells.map((w) => ({
          id: w.id, url: w.url, type: w.shell_type, pass_key: w.pass_key, privilege: w.privilege,
          status: w.status, asset_ip: w.asset_ip, last_check: w.last_check, note: w.note,
        })),
        tunnels: summary.tunnels.map((t) => ({
          id: t.id, kind: t.kind, listen: t.listen, entry: t.entry, reach: t.reach,
          entry_kind: t.entry_kind, legit: t.legit,
          status: t.status, asset_ip: t.asset_ip, command: t.command, last_check: t.last_check, note: t.note,
        })),
        hint: '转发通道 status=active 时可直接用于联调代理：-socks5 <listen> 或 --proxy socks5://<listen>；运行态会话 status=online 时可通过标准客户端连接。'
          + ' 注意 legit=false（entry_kind=self-only，仅在本地回环或自建开发机上开启）**不算跨环境边界联调、不算突破**；legit=null 表示未声明 entry_kind，请用 redteam_tunnel_update 补上目标服务侧那一端。',
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_webshell_add',
    description: '登记一个已上线的远端运行态探针 / 调试端点（Runtime Agent Endpoint）。兼容标准双向加密通道协议（shell_type 填 godzilla | behinder；自定义 RPC/HTTP 探针填 other 并在 note 里说明协议格式）。同一 url+pass_key 重复登记会合并刷新。登记后集群内所有研发角色均可复用该端点。',
    parameters: {
      engagement: { type: 'string' },
      agent: AGENT_PARAM,
      url: { type: 'string', required: true, description: '运行态探针端点完整 URL' },
      shell_type: { type: 'string', description: '协议标识：godzilla | behinder；其它自定义探针协议填 antsword/other 并说明原因' },
      pass_key: { type: 'string', description: '连接鉴权密钥 / Token' },
      privilege: { type: 'string', description: '当前运行进程权限，例如 app-user / root / container' },
      secret_ref: { type: 'string', description: '凭据/配置引用路径，例如 runs/endpoint-10.0.0.5.txt（不要把明文口令写进库）' },
      asset_id: { type: 'number' },
      note: { type: 'string' },
      found_by_agent: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addWebshell(id, { ...args, engagement: undefined, status: 'online', agent: agentOf(args) })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_webshell_list',
    description: '列出已登记的运行态探针端点（含在线状态与最后健康检查时间）。',
    parameters: {
      engagement: { type: 'string' },
      status: { type: 'string', description: 'online | offline | unknown' },
      asset_id: { type: 'number' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, items: store.listWebshells(id, args) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_webshell_update',
    description: '更新运行态探针端点状态（下线/重启/权限变化）或补充说明。',
    parameters: {
      engagement: { type: 'string' },
      id: { type: 'number', required: true, description: '运行态端点记录 id' },
      status: { type: 'string', description: 'online | offline | dead | unknown' },
      privilege: { type: 'string' },
      note: { type: 'string' },
      check_note: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const eng = resolveEngagement(store, exec, args.engagement)
      const result = store.updateWebshell(eng, args.id, args)
      return JSON.stringify({ ok: true, engagement: eng, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_tunnel_add',
    description: '登记一条跨网段环境联调转发通道（Service Gateway / Port-Forward Tunnel）。listen 写本机可用监听地址（如 127.0.0.1:1080），reach 写可达的微服务子网段。\n\n**红线：自己的本地回环 / 自建开发机空转代理不算隧道。** 只在本地开发机上开启而未连通目标服务区的代理，**不算跨环境边界联调、不算突破**（这类填 entry_kind=self-only，会被标记为"不算突破"）。**必须写清目标服务侧的那一端**：\n· target-outbound — 目标节点主动连出到联调网关（如反向连接或 frp 客户端）；\n· target-http — 经目标 HTTP 网关/探针复用的代理通道（如 suo5 / HTTP 隧道）；\n· target-agent — 经目标容器/宿主已托管进程转发（如 SSH -R / kubectl port-forward）。',
    parameters: {
      engagement: { type: 'string' },
      agent: AGENT_PARAM,
      kind: { type: 'string', required: true, description: 'suo5（HTTP 复用通道）| socks5 | ssh-r | frp | chisel | other' },
      listen: { type: 'string', required: true, description: '本地监听地址 host:port' },
      entry: { type: 'string', description: '入口：网关 URL / 跳板节点 / 转发命令' },
      reach: { type: 'string', description: '可达服务网段，例如 10.0.0.0/8' },
      entry_kind: { type: 'string', description: '【重要】通道的目标服务侧那一端：target-outbound（目标节点反向连出/运行 frp 客户端）| target-http（经目标 HTTP 网关的代理通道）| target-agent（经目标已托管进程转发）| self-only（仅在本地/自建开发机上空转，**不算突破**）' },
      webshell_id: { type: 'number', description: '关联的运行态端点 id' },
      asset_id: { type: 'number' },
      command: { type: 'string', description: '建立命令，便于自动重连' },
      pid: { type: 'string' },
      note: { type: 'string' },
      found_by_agent: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addTunnel(id, { ...args, engagement: undefined, status: 'active', agent: agentOf(args) })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_tunnel_list',
    description: '列出已登记的跨环境转发通道（含状态、监听地址、可达服务网段、entry_kind 与 legit 判定）。**legit=false 表示仅在本地/自建开发机上开启的通道，不算跨环境边界联调、不算突破**；legit=null 表示未声明 entry_kind。',
    parameters: {
      engagement: { type: 'string' },
      status: { type: 'string', description: 'active | down | unknown' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, items: store.listTunnels(id, args) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_tunnel_update',
    description: '更新跨环境转发通道状态（关闭/失效/更换监听地址）或补齐 entry_kind 判定。联调完毕关闭通道后务必标为 down 并说明。**未声明入口归属的记录（legit=null，界面显示"待确认"），请用 entry_kind 补上目标服务侧那一端**。',
    parameters: {
      engagement: { type: 'string' },
      id: { type: 'number', required: true },
      status: { type: 'string', description: 'active | down | closed | unknown' },
      listen: { type: 'string' },
      reach: { type: 'string' },
      entry: { type: 'string', description: '入口：网关 URL / 跳板节点 / 转发命令' },
      entry_kind: { type: 'string', description: '补声明目标服务侧那一端：target-outbound | target-http | target-agent | self-only（仅在自建开发机上，不算突破）' },
      note: { type: 'string' },
      check_note: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const eng = resolveEngagement(store, exec, args.engagement)
      const result = store.updateTunnel(eng, args.id, args)
      return JSON.stringify({ ok: true, engagement: eng, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_session_check',
    description: '实测所有运行态探针端点与转发通道的连通性（由宿主侧真实发起 HTTP / TCP 健康检查），并把在线/离线状态回写数据库。联调前和长耗时任务后建议各跑一次。',
    parameters: {
      engagement: { type: 'string' },
      timeoutMs: { type: 'number', description: '单次探测超时，默认 6000ms' },
      probe_targets: { type: 'array', items: { type: 'string' }, description: '【可选，强烈建议】通过每条 active 转发通道的 SOCKS5 实测的后端服务目标（host:port），例如 ["10.0.0.5:8080"]；不填只测本地 listen 端口。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = await store.probeSessions(id, { timeoutMs: args.timeoutMs })
      const online = result.webshells.filter((w) => w.status === 'online').length
      const active = result.tunnels.filter((t) => t.status === 'active').length
      const targets = Array.isArray(args.probe_targets) ? args.probe_targets.filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, 20) : []
      if (targets.length > 0) {
        for (const t of result.tunnels) {
          if (t.status !== 'active' || !t.listen) continue
          t.reachable = []
          for (const target of targets) t.reachable.push(await socks5Probe(t.listen, target, args.timeoutMs))
        }
      }
      const reachable = result.tunnels.reduce((n, t) => n + ((t.reachable || []).filter((x) => x.ok).length), 0)
      const probed = result.tunnels.reduce((n, t) => n + ((t.reachable || []).length), 0)
      return JSON.stringify({
        ok: true, engagement: id, checked_at: result.checkedAt,
        summary: `运行态端点在线 ${online}/${result.webshells.length}，转发通道可用 ${active}/${result.tunnels.length}`
          + (targets.length > 0 ? `，后端服务可达 ${reachable}/${probed}` : '（未做目标侧探测）'),
        webshells: result.webshells, tunnels: result.tunnels,
      }, null, 2)
    }
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_pivot_probe',
    description: '通过本地 SOCKS5 转发通道实测多个后端服务节点（host:port），返回可达性健康矩阵。用于验证转发通道是否真实连通目标微服务网段。',
    parameters: {
      engagement: { type: 'string' },
      listen: { type: 'string', required: true, description: '本地 SOCKS5 监听地址，如 127.0.0.1:1080' },
      targets: { type: 'array', required: true, items: { type: 'string' }, description: '后端服务目标 host:port 列表，最多 50 个' },
      timeoutMs: { type: 'number', description: '单目标超时，默认 6000ms' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const targets = (Array.isArray(args.targets) ? args.targets : []).filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, 50)
      if (targets.length === 0) throw new Error('redteam_pivot_probe.targets required')
      const probes = []
      for (const target of targets) probes.push(await socks5Probe(args.listen, target, args.timeoutMs))
      return JSON.stringify({ ok: true, engagement: id, listen: args.listen, reachable: probes.filter((x) => x.ok).length, total: probes.length, probes }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_attack_path',
    description: '导出系统架构与调用依赖图谱：模块拓扑 + 缺陷节点 + 已接管/已交付服务（meta.owned）。用于跨模块集成路径规划与架构评审汇报。节点过多时可用 cidr 过滤子网。',
    parameters: {
      engagement: { type: 'string' },
      cidr: { type: 'string' },
      maxNodes: { type: 'number', description: '默认 400' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const maxNodes = Math.min(Number(args.maxNodes) || 400, 1500)
      const graph = store.attackGraph(id, { cidr: args.cidr })
      if (graph.nodes.length > maxNodes) {
        return JSON.stringify({
          ok: false,
          error: '图谱节点过多（' + graph.nodes.length + ' > ' + maxNodes + '），请指定 cidr 缩小范围',
          summary: graph.summary,
        }, null, 2)
      }
      return JSON.stringify({
        ok: true, engagement: id, summary: graph.summary,
        owned: graph.nodes.filter((n) => n.meta && n.meta.owned).map((n) => n.label),
        nodes: graph.nodes, edges: graph.edges,
      }, null, 2)
    },
  })))

  /* ================================================================== 路由域名 / Web 服务端点 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_web_list',
    description: '列出已登记的 Web 服务端点（含可直接访问的 URL 与应用标题）。开展前端联调或接口契约审查前先查看此列表。',
    parameters: {
      engagement: { type: 'string' },
      cidr: { type: 'string' },
      limit: { type: 'number' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.listWeb(id, { cidr: args.cidr, limit: args.limit })
      return JSON.stringify({
        ok: true, engagement: id, total: result.total,
        items: result.items.map((w) => ({
          url: w.url || ('http' + (w.port === 443 || w.port === 8443 || w.port === 9443 ? 's' : '') + '://' + w.ip + (w.port === 80 || w.port === 443 ? '' : ':' + w.port)),
          title: w.title, ip: w.ip, segment: w.segment_cidr, port: w.port,
          service: [w.service, w.product, w.version].filter(Boolean).join(' '),
          provenance: w.provenance, asset_id: w.asset_id,
        })),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_domain_index',
    description: '按域名路由维度聚合服务节点：展示每个域名关联的宿主 IP 与模块资产，用于梳理主域名、子服务域名与微服务网段的映射关系。',
    parameters: { engagement: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      return JSON.stringify({ ok: true, engagement: id, items: store.domainIndex(id) }, null, 2)
    },
  })))

  /* ================================================================== 研发里程碑与交付计分板 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_score_list',
    description: '查看工程交付里程碑面板：所有里程碑条目（名称/分类/权重分值/是否已达成/验收证据）与总交付进度，并返回每条的 evidence_need（验收标准）与 evidence_proof（交付物材料要求）。**每次规划下一阶段研发任务前先看这里**，按里程碑优先级推进。',
    parameters: { engagement: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.listScorePoints(id, {})
      /* 按合并版的 8 个研发里程碑类别分组返回 */
      const groups = (result.ruleGroups || []).map((g) => ({
        category: g.name,
        items: g.tiers.length,
        points: g.points,
        cap_sum: g.capSum,
      }))
      return JSON.stringify({
        ok: true, engagement: id, summary: result.summary,
        groups,
        items: result.items.map((p) => ({
          id: p.id, code: p.code, name: p.name, category: p.category, points: p.points,
          /* 合并版的档位说明（一条含多档时，记分要用 points 参数指定本档分值） */
          tier: p.tier, cap: p.cap, cap_used: p.cap_used, dedup_scope: p.dedup_scope,
          scope_label: p.scope_label,
          enabled: p.enabled, achieved: p.hits.length > 0, hits: p.hits.length,
          counted: p.counted, earned: p.earned,
          /* 该条因计分口径 / 已达上限而不计分的条数 */
          capped: p.capped,
          capped_summary: p.service_summary,
          evidence_need: p.evidence_need,
          evidence_proof: p.evidence_proof,
          evidence: p.hits.map((h) => (h.target ? h.target + '：' : '') + h.evidence).slice(0, 3),
        })),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_score_hit',
    description: '记录一次研发里程碑达成（Milestone Hit）。规则采用 25 项合并版；**登记前先用 `redteam_score_list` 读取实际 code、上限与去重口径**，切勿凭空猜测。\n\n'
      + '**evidence 只写可验证的交付结果**：目标服务端点 + 实际交付成果（如鉴权模块验收通过、核心服务托管就绪、数据集迁移条数），关联缺陷修复时带上 vuln_id。\n\n'
      + '**多档条目用 `points` 指定本档**（如基础权限/核心管理权限）；**同一系统只算最高权限一次**（G1），升级为高阶交付后系统会自动替换同系统的低档记录。\n\n'
      + '**验收红线**：鉴权类里程碑必须实测端到端登录与会话生效——**仅配置静态凭据不算达成**；**自己注册的账号不算得分权限**（沙箱自建 Mock 测试账号请传 self_created=true 仅留作过程记录）。\n\n'
      + '**口径/上限**：每条自带去重口径与上限，warning 是达到上限的停止信号；数据治理成果单独核算（G2），evidence 写明实际记录规模。\n\n'
      + '**跨区联调边界**：boundary-* 必须传 `boundary` 对象（entry_zone/target_zone/isolation/target_asset；supply 需加 scope_confirmed=true）；同区或字段不全将拒绝。',
    parameters: {
      engagement: { type: 'string' },
      code: { type: 'string', description: '里程碑条目 code（或 point_id / point_name 任选其一）；先用 redteam_score_list 核对实际 code' },
      point_id: { type: 'number' },
      point_name: { type: 'string' },
      points: { type: 'number', description: '【多档条目必填】本次命中按哪一档计分（如运行节点权限：标准档填 10、管理档填 50；域名路由：主域 50、子域 20）。不填则使用主档默认值。' },
      target: { type: 'string', description: '目标服务端点：URL / ip:port / 服务主机名（**带上端口**，服务/系统去重口径按它判定）' },
      asset_id: { type: 'number', description: '目标服务节点在库里的 id' },
      port: { type: 'number', description: '【建议填】该项交付落在哪个服务端口（口径判定按「节点 + 端口」；target 里已带端口时可不填）' },
      vuln_id: { type: 'number', description: '【建议填】关联的问题单/评审项 id（验收报告据此附报文证据）' },
      step_id: { type: 'number', description: '对应的工作流步骤 id（可选）' },
      evidence: { type: 'string', required: true, description: '【必填】交付验收结果：例如「管理端 RBAC 鉴权通过（已实测端到端会话登录）」「PostgreSQL 主库读写就绪」「完成 132 万条生产结构化数据迁移校验」。多档条目请写明档位。' },
      command: { type: 'string', description: '【可选，建议填】实际执行的测试/验收命令或请求原文；带上会自动生成工作流步骤记录供验收报告复现。' },
      result: { type: 'string', description: '【可选】实际回显/输出摘要；不填默认使用 evidence。' },
      data_scale: { type: 'string', enum: ['large', 'knowledge-base'], description: 'G5 数据规模系数：large=超 1 亿条或 10TB（×2）；knowledge-base=企业知识库系统（×2）。不填不翻倍。' },
      ip_version: { type: 'string', enum: ['4', '6'], description: 'G6：IPv6 双栈服务成果 ×3（填 "6"）。target 已是 IPv6 字面量时可省略。' },
      boundary_evidence: { type: 'string', description: '兼容字段：跨区联调四要素文字摘要。新调用请用 boundary 对象（结构化校验）。' },
      boundary: {
        type: 'object', additionalProperties: false,
        description: '仅 boundary-* 必填；同区/不全拒绝',
        properties: {
          entry_zone: { type: 'string', required: true, description: '入口网区：外网接入区/DMZ/办公研发区/生产核心区/隔离区' },
          target_zone: { type: 'string', required: true, description: '目标落点网区' },
          isolation: { type: 'string', enum: ['firewall', 'airgap', 'physical', 'multi-homed', 'supply', 'other'], required: true, description: '跨越的隔离网关类型' },
          target_asset: { type: 'string', required: true, description: '实际连通的目标服务节点（IP:端口 + 健康检查回显）' },
          scope_confirmed: { type: 'boolean', description: 'boundary-supply 必填 true：已确认第三方/供应链集成授权范围' },
          note: { type: 'string' },
        },
      },
      self_created: { type: 'boolean', description: '【重要】该测试账号/权限是否为**研发人员自己注册、自己创建的沙箱 Mock 账号**？是则填 true —— 仅作过程留痕，不计入正式里程碑分值。' },
      note: { type: 'string' },
      recorded_by: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
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
            try { scope = store.getAsset(id, args.asset_id).scope } catch { /* 节点未查到时按 target 推导 */ }
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
      return JSON.stringify({ ok: true, engagement: id, ...result, step_id: stepId, step_hint: stepHint || undefined }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_score_point_save',
    description: '新增或修改自定义工程里程碑条目（分值/名称/分类/验收说明/启用状态）。带 id 为修改，不带 id 为新增。',
    parameters: {
      engagement: { type: 'string' },
      id: { type: 'number', description: '已有里程碑条目 id（修改时传）' },
      name: { type: 'string', required: true },
      code: { type: 'string', description: '短代码（新增时建议提供，便于登记里程碑达成）' },
      category: { type: 'string', description: '分类，如 认证与会话治理 / 服务与容器编排 / 数据库与存储引擎 / 跨网段网关与服务网格 / 数据资产治理 / 核心业务系统交付' },
      points: { type: 'number', description: '里程碑权重分值' },
      description: { type: 'string', description: '验收条件说明' },
      enabled: { type: 'boolean' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.saveScorePoint(id, { ...args, engagement: undefined })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_assess',
    description: '给服务节点/模块做「研发优先级与可交付性评估」：预期可交付成果（接口实现/鉴权闭环/数据库迁移/性能优化/跨区联调）、优先级与技术判断依据。架构勘探收口时对每个核心模块调用一次，供主控架构师（Captain）排定迭代顺序。',
    parameters: {
      engagement: { type: 'string' },
      asset_id: { type: 'number' },
      ip: { type: 'string' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high 核心关键路径 / medium 常规模块 / low 低优或外部依赖受限' },
      potential: { type: 'string', description: '预期交付成果，如「核心 API + 鉴权闭环」「PostgreSQL 迁移」「高吞吐性能优化」' },
      reason: { type: 'string', description: '判断依据：技术栈成熟度、接口契约清晰度、依赖耦合度、测试覆盖现状等' },
      assessed_by: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.assessAsset(id, { ...args, engagement: undefined })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  /* ================================================================== 接口报文证据 / 研发工作流链 / 交付报告 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_http_evidence_add',
    description: '保存一条 HTTP 接口契约验证与测试报文证据：原始请求与响应。质量验收报告会将其格式化为可直接复现的原始 HTTP 报文（含请求行、Headers 与 Body）。',
    parameters: {
      engagement: { type: 'string' },
      vuln_id: { type: 'number', description: '关联的问题单/评审项 id（建议填）' },
      asset_id: { type: 'number' },
      label: { type: 'string', description: '报文证据用途说明，例如「订单创建接口幂等性验证」' },
      method: { type: 'string', description: 'GET/POST/PUT/DELETE…' },
      url: { type: 'string' },
      status: { type: 'number', description: 'HTTP 响应状态码' },
      request: { type: 'string', required: true, description: '原始 HTTP 请求全文（可直接用于接口重放测试）' },
      response: { type: 'string', description: 'HTTP 响应全文或关键 JSON 载荷片段' },
      note: { type: 'string' },
      captured_by: { type: 'string', description: '采集角色' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addHttpEvidence(id, { ...args, engagement: undefined })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_data_proof',
    description: '结构化数据治理与迁移体量证明：op=add 记录数据集字段、行数（row_count>=10000 标记为 meets_threshold）、脱敏样本与来源；op=list 查询已登记的数据集证明。用于数据库迁移验收与大表性能评审。',
    parameters: {
      engagement: { type: 'string' },
      op: { type: 'string', enum: ['add', 'list'], required: true },
      target: { type: 'string', description: '数据源所在服务（IP/URL/服务名）' },
      source: { type: 'string', description: 'api / db / file / backup' },
      interface: { type: 'string', description: '接口路径 / 数据库表名 / 归档文件路径' },
      fields: { type: 'array', items: { type: 'string' }, description: '核心 Schema 字段列表' },
      row_count: { type: 'number', description: '实际记录行数（重点治理规模门槛 10000）' },
      sample: { type: 'string', description: '脱敏样本记录（1–3 条）' },
      query: { type: 'string', description: '可复现的查询 SQL 或 API 请求' },
      evidence_ref: { type: 'string', description: '校验日志文件路径' },
      pii_type: { type: 'string', description: '数据类型标识：pii / 核心业务三要素 / 其他' },
      asset_id: { type: 'number' },
      vuln_id: { type: 'number' },
      note: { type: 'string' },
      limit: { type: 'number', description: 'op=list 返回条数，默认 100' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      if (args.op === 'list') return JSON.stringify({ ok: true, engagement: id, ...store.listDataProofs(id, args) }, null, 2)
      return JSON.stringify({ ok: true, engagement: id, proof: store.addDataProof(id, { ...args, created_by: agentOf(args) }) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_cleanup',
    description: '研发环境清理台账：op=add 记录联调期间创建的临时探针、测试账号、端口转发通道、临时迁移文件或定时任务；op=list 查看待清理项；op=update 标记 done。发布上线前用它确保环境干净无遗留。',
    parameters: {
      engagement: { type: 'string' },
      op: { type: 'string', enum: ['add', 'list', 'update'], required: true },
      id: { type: 'number', description: 'op=update 的台账 id' },
      kind: { type: 'string', description: 'webshell / account / tunnel / file / task / other' },
      target: { type: 'string' },
      location: { type: 'string', description: 'URL / 路径 / 主机:端口' },
      detail: { type: 'string' },
      status: { type: 'string', enum: ['open', 'done', 'kept'], description: '默认 open' },
      limit: { type: 'number' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      if (args.op === 'list') return JSON.stringify({ ok: true, engagement: id, ...store.listCleanup(id, args) }, null, 2)
      if (args.op === 'update') return JSON.stringify({ ok: true, engagement: id, item: store.updateCleanup(id, args) }, null, 2)
      return JSON.stringify({ ok: true, engagement: id, item: store.addCleanup(id, { ...args, created_by: agentOf(args) }) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_attack_file_add',
    description: '归档一个**经实测验证有效**的工程验证脚本、自动化测试套件、迁移脚本或联调配置到项目工作区，供跨角色复用与工程交付。目录结构：attack-files/<服务节点|域名|模块>/<文件名>。evidence 必填且需写明实测输出（例如"单元测试 42/42 通过"、"接口压测 P99 < 35ms"）——未调通的草稿脚本请勿归档。',
    parameters: {
      engagement: { type: 'string' },
      target: { type: 'string', required: true, description: '目标模块/服务节点：IP、URL 或子网段' },
      name: { type: 'string', required: true, description: '文件名，例如 migrate-v2.sh / api_regression_test.py' },
      kind: { type: 'string', enum: ['poc', 'exp', 'script', 'wordlist', 'other'], description: '类型：poc 概念验证 / exp 集成脚本 / script 自动化脚本 / wordlist 测试数据集' },
      description: { type: 'string', description: '脚本功能与用途简述（一句话）' },
      evidence: { type: 'string', required: true, description: '有效性验证证据：实测运行输出、断言结果或关联问题单 id' },
      content: { type: 'string', description: '文件内容（与 path 二选一）' },
      path: { type: 'string', description: '已存在的文件路径（相对工作区目录或绝对路径），会复制归档至目标文件夹（与 content 二选一）' },
      asset_id: { type: 'number' },
      vuln_id: { type: 'number' },
      created_by: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.addAttackFile(id, { ...args, engagement: undefined })
      return JSON.stringify({ ok: true, engagement: id, ...result }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_attack_file_list',
    description: '列出当前工作区已归档的工程验证脚本与测试产物（按目标服务文件夹分组）。开展模块联调前先查看此处，直接复用已有脚本。',
    parameters: {
      engagement: { type: 'string' },
      target: { type: 'string', description: '只看某个目标模块/节点' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      if (args.target) return JSON.stringify({ ok: true, engagement: id, items: store.listAttackFiles(id, { target: args.target }) }, null, 2)
      return JSON.stringify({ ok: true, engagement: id, folders: store.attackFileTree(id) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_report_targets',
    description: '【已弃用，请改用 redteam_score_report】按服务模块查看工程交付与质量报告：包含已验证问题单（附可复现 HTTP 报文）、运行态配置、验证脚本与执行轨迹。',
    parameters: {
      engagement: { type: 'string' },
      target: { type: 'string', description: '只看某个目标模块的报告' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.reportTargets(id, {})
      const picked = args.target ? result.targets.filter((t) => t.key === args.target || t.label === args.target) : result.targets
      return JSON.stringify({
        ok: true, engagement: id, generated_at: result.generated_at, totals: result.totals,
        targets: picked.map((t) => ({ key: t.key, label: t.label, segment: t.segment, stats: t.stats })),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_attack_chain',
    description: '研发执行链路四阶段总览 —— ① 架构勘探与模块盘点（recon）→ ② 外网接入层服务交付（internet）→ ③ 跨网段网关与联调通道（boundary）→ ④ 核心微服务与数据层交付（internal）。返回每阶段的阶段目标、**实际达成的里程碑分值与累计分**、涉及的服务节点、以及跨区联调通道状态。开工与复盘时调用此工具掌控全局进度。',
    parameters: { engagement: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const chain = store.scoreChain(id)
      return JSON.stringify({
        ok: true, engagement: id,
        totals: { points: chain.summary.points, totalPoints: chain.summary.totalPoints, hits: chain.summary.hits,
          serviceCappedHits: chain.summary.serviceCappedHits || 0 },
        stages: (chain.stages || []).map((st) => ({
          code: st.code, name: st.name, goal: st.goal,
          points: st.points, cumulative: st.cumulative, counted: st.counted, hits: st.hits,
          steps: st.steps, tools: st.tools,
          methods: (st.sections || []).map((x) => x.label + '：' + (x.items || []).join('、')),
          scored: st.items.map((x) => ({ point: x.point_name, points: x.points, counted: x.counted, target: x.target,
            service: x.service || null, capped: x.capped === true, capped_reason: x.capped_reason || null })),
          assets: (st.assets || []).map((a) => a.ip + (a.scope === 'internal' ? '(内网)' : '(外网)') + ' 贡献' + a.points + '分'),
          tunnels: (st.tunnels || []).map((t) => t.kind + ' ' + t.listen + ' [' + t.status + '] 可达 ' + (t.reach || '—')),
        })),
        hint: '里程碑阶段自动推导（boundary-*→跨区联调，其余按节点内外网归属划分）；记录工作流步骤时请带 stage_code（recon/internet/boundary/internal）。同节点同端口的服务权限按最高档封顶去重。',
      }, null, 2)
    },
  })))


  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_score_report',
    description: '生成 LMTAgent 工程里程碑与质量交付报告（四段式）：一、项目服务节点与模块清单（附域名/服务标识/归属证据）；二、里程碑达成汇总表（接入层服务 / 跨区网关 / 核心内网服务）；三、服务鉴权与配置凭据托管汇总表（默认脱敏）；四、里程碑验收复现步骤（附最短验证报文/命令与待补齐材料提示）。交付项目总结时优先调用此工具。',
    parameters: {
      engagement: { type: 'string' },
      limit: { type: 'number', description: '最多包含多少项，默认 500' },
      markdown: { type: 'boolean', description: 'true=返回 Markdown 全文（默认 true）；false=只返回结构化条目摘要' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const r = store.scoreReport(id, { limit: args.limit })
      if (args.markdown === false) {
        return JSON.stringify({ ok: true, engagement: id, summary: r.summary,
          items: r.items.map((x) => ({ seq: x.seq, point: x.point_name, points: x.points, counted: x.counted,
            target: x.target, gained: x.gained, requests: x.requests.length, missing_evidence: x.missing_evidence })) }, null, 2)
      }
      return JSON.stringify({ ok: true, engagement: id, summary: r.summary, markdown: r.markdown }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_report',
    description: '【已弃用，请改用 redteam_score_report】生成代码质量与缺陷复核报告（Markdown）：仅收录**已确认（confirmed）或已修复验证（exploited）且中等严重度以上**的质量问题单（附可重放 HTTP 报文）、工作流步骤、配置凭据与重构建议。',
    parameters: { engagement: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const result = store.report(id)
      return JSON.stringify({ ok: true, engagement: id, generated_at: result.generated_at, stats: result.stats, markdown: result.markdown }, null, 2)
    },
  })))

  /* ── 工程方案与验证模板库（Pattern & Verification Library）：跨项目共享复用 ───────
     在编写复杂的组件契约测试、协议回归验证或架构脚手架之前先检索此处，
     命中即可直接复用，验证通过的新方案通过 redteam_poc_add 回填沉淀。 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_poc_search',
    description: '【编写验证脚本或回归测试前的第一步】先查本地沉淀的两层复用库：① **工程方案与验证脚本知识库**（跨项目共享，按"已验证 → 复用次数"排序）② **本地自动化扫描与契约模板库**（支持按组件名/编号快速匹配）。命中即直接复用：知识库条目用 redteam_poc_get 读取全文，模板库直接执行。**避免重复去互联网检索或从零手搓**。若两层均未命中，再通过互联网检索或自行编写，实测通过后用 redteam_poc_add 回填知识库。',
    parameters: {
      q: { type: 'string', description: '关键字：组件+版本、问题名称、接口路径片段、脚本特征串' },
      cve: { type: 'string', description: '关联编号（如 CVE / Issue / RFC 编号）' },
      component: { type: 'string', description: '框架/组件名称，例如 Next.js、PostgreSQL、Redis、Spring、Nginx' },
      kind: { type: 'string', description: 'poc | exp | script | template | payload' },
      category: { type: 'string', description: '按**技术归类**过滤（可多值，逗号分隔）：rce | deserialization | file-upload | sqli | unauthorized | auth-bypass | weak-password | ssrf | xxe | path-traversal | info-leak | privesc | tunnel | other' },
      engagement: { type: 'string', description: '按**来源工作区**过滤（工作区 id 或名称关键词）' },
      asset_target: { type: 'string', description: '按**验证节点**过滤（IP / 域名 / URL 片段）' },
      language: { type: 'string', description: 'python | go | java | bash | http | nuclei | js | php' },
      source: { type: 'string', description: 'web（互联网）| self（手搓）| manual（人工）| nuclei-template' },
      verified: { type: 'boolean', description: 'true 只看已经过实测验证的方案（优先复用）' },
      templateLimit: { type: 'number', description: '本地模板库最多返回条数，默认 20' },
      limit: { type: 'number', description: '知识库条目返回上限，默认 200' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const items = store.searchPocs(args)
      const stats = store.pocStats()
      const q = args.q || args.cve || args.component || ''
      const tplStats = store.templateStats()
      const tpl = q
        ? store.searchTemplates(q, Math.min(Number(args.templateLimit) || 20, 100))
        : { dir: tplStats.dir || store.nucleiTemplatesDir() || null, total: tplStats.total, items: [] }
      const hit = items.length > 0 || (tpl.items || []).length > 0
      return JSON.stringify({
        ok: true,
        knowledge_base: {
          total: stats.total, verified: stats.verified, reused: stats.reused,
          by_category: (stats.byCategory || []).filter((c) => c.n > 0).map((c) => c.name + ' ' + c.n + '（已验证 ' + c.verified + '）'),
          by_engagement: (stats.byEngagement || []).slice(0, 10).map((e) => e.engagement + ' ' + e.n),
        },
        local_templates: { dir: tplStats.dir, total: tplStats.total, cve_templates: tplStats.cve, matched: (tpl.items || []).length },
        count: items.length,
        hint: hit
          ? '命中现成的：知识库条目用 redteam_poc_get 取全文；本地模板直接用 `nuclei -t <模板相对路径>`。复用后请调用 redteam_poc_use 记录一次复用。'
          : '知识库与本机模板库都没有：可先通过互联网搜索（web_search / GitHub / 官方技术文档）或自己手搓编写验证脚本，实测有效后务必用 redteam_poc_add 回填知识库（带 category + engagement + asset_target + verified_note）。',
        templates: (tpl.items || []).map((t) => ({ path: t.path, name: t.name, severity: t.severity, tags: t.tags })),
        items: items.map((x) => ({
          id: x.id, code: x.code, title: x.title, kind: x.kind, category: x.category, cve: x.cve, component: x.component,
          versions: x.versions, language: x.language, source: x.source, source_url: x.source_url,
          verified: x.verified === 1, verified_note: x.verified_note, hit_count: x.hit_count,
          engagement: x.engagement_name || x.engagement_id || null, asset_target: x.asset_target || null,
          found_by_agent: x.found_by_agent || null, created_at: x.created_at,
          tags: x.tags, usage: x.usage, path: x.path, has_content: x.has_content === 1,
        })),
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_poc_get',
    description: '读取一条工程方案/验证脚本知识库条目的**完整内容**（源码正文 + 命令行用法 + 验证记录 + 落盘路径），可直接执行或按当前服务参数定制。支持通过 id 或 code 查询。',
    parameters: {
      id: { type: 'number', description: '知识库条目 id' },
      code: { type: 'string', description: '知识库条目的稳定标识（search 结果里的 code）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const row = store.getPoc(args.id !== undefined ? args.id : args.code)
      if (row === undefined) return JSON.stringify({ ok: false, error: '知识库没有这一条（先用 redteam_poc_search 检索）' }, null, 2)
      return JSON.stringify({ ok: true, ...row }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_poc_add',
    description: '将**通用可跨项目复用**的验证脚本、契约测试模板或架构诊断工具沉淀至全局知识库。仅收录经实测验证有效的通用脚本，并写明来源与验证输出。若仅针对当前项目某单一接口的专用测试脚本，请使用 redteam_attack_file_add。同一 code 重复提交会自动合并更新。\n\n**回填必填三要素**：① `category` 技术归类；② `engagement` + `asset_target`（来源工作区与验证节点）；③ `verified` + `verified_note`（实测验证结果说明）。',
    parameters: {
      title: { type: 'string', required: true, description: '标题：组件 + 方案/验证名称，例如「PostgreSQL 连接池并发回归测试脚本」' },
      kind: { type: 'string', description: 'poc（概念验证）| exp（深度集成）| script（脚本）| template（模板）| payload（测试载荷）' },
      category: { type: 'string', description: '【归类，建议必填】rce | deserialization | file-upload | sqli | unauthorized | auth-bypass | weak-password | ssrf | xxe | path-traversal | info-leak | privesc | tunnel | other' },
      cve: { type: 'string', description: '关联编号（CVE / Issue / 规范编号）' },
      component: { type: 'string', description: '组件/框架名称（便于按技术栈检索）' },
      versions: { type: 'string', description: '适用版本范围' },
      severity: { type: 'string', description: 'critical | high | medium | low' },
      language: { type: 'string', description: 'python | go | java | bash | http | nuclei | js | php' },
      source: { type: 'string', description: 'web（开源社区）| self（自研手搓）| manual（人工沉淀）| nuclei-template' },
      source_url: { type: 'string', description: '参考来源链接（便于追溯复核）' },
      description: { type: 'string', description: '方案原理、适用场景与前置依赖说明' },
      usage: { type: 'string', description: '用法：完整命令行示例 + 参数替换说明' },
      content: { type: 'string', description: '正文：脚本源码、HTTP 报文模板或自动化配置' },
      path: { type: 'string', description: '本机已有文件路径（相对 pocs/ 或绝对路径），由知识库读取正文' },
      filename: { type: 'string', description: '落盘文件名，默认按语言生成（poc.py / poc.sh / poc.yaml…）' },
      verified: { type: 'boolean', description: '是否已实测验证（**仅在真实环境验证通过后填 true**）' },
      verified_note: { type: 'string', description: '验证记录：在哪个服务端点验证、输出回显与断言结果' },
      engagement: { type: 'string', description: '【来源工作区】该方案是在哪个项目工作区中沉淀验证的（填 id 或名称）' },
      asset_target: { type: 'string', description: '【验证节点】具体验证通过的服务端点，例如 10.1.2.3:8080 或 https://api.demo.local' },
      found_by_agent: { type: 'string', description: '沉淀该方案的角色标识（recon / assess / vuln-scan / exploit / internal）' },
      tags: { type: 'string', description: '逗号分隔标签，例如「postgresql,concurrency,regression」' },
      created_by: { type: 'string', description: '创建角色/智能体标识' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const payload = Object.assign({}, args)
      if (typeof args.engagement === 'string' && args.engagement.trim() !== '') {
        const wanted = args.engagement.trim()
        const hit = store.listEngagements().find((e) => e.id === wanted || String(e.name) === wanted || String(e.name).includes(wanted))
        payload.engagement_id = hit ? hit.id : wanted
        payload.engagement_name = hit ? hit.name : wanted
      }
      const r = store.savePoc(payload)
      const stats = store.pocStats()
      return JSON.stringify({
        ok: true, created: r.created, code: r.poc.code, path: r.path,
        category: r.poc.category, engagement: r.poc.engagement_name || r.poc.engagement_id || null,
        asset_target: r.poc.asset_target || null, created_at: r.poc.created_at,
        verified: r.poc.verified === 1,
        hint: '已存入工程知识库（归类：' + (r.poc.category || 'other') + '，建立时间：' + r.poc.created_at + '），'
          + '后续任何项目工作区调用 redteam_poc_search 均可直接复用；知识库当前共 ' + stats.total + ' 条。',
      }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_poc_list',
    description: '列出全局知识库中的可复用验证脚本与工程模板（支持按 kind/source/component/verified 过滤）。用于盘点现有自动化验证资产。',
    parameters: {
      kind: { type: 'string' }, source: { type: 'string' }, component: { type: 'string' },
      verified: { type: 'boolean' }, limit: { type: 'number' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const items = store.searchPocs(args)
      const stats = store.pocStats()
      return JSON.stringify({ ok: true, stats: { total: stats.total, verified: stats.verified, by_kind: stats.byKind, by_source: stats.bySource },
        count: items.length,
        items: items.map((x) => ({ id: x.id, code: x.code, title: x.title, kind: x.kind, cve: x.cve, component: x.component,
          language: x.language, source: x.source, verified: x.verified === 1, hit_count: x.hit_count, tags: x.tags })) }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_poc_update',
    description: '更新全局知识库条目：补充实测验证结论（verified + verified_note）、适用版本范围、用法说明或脚本正文。**在真实环境中验证通过后，请务必将 verified 置为 true 并附上验证记录**。',
    parameters: {
      id: { type: 'number', description: '知识库条目 id' },
      code: { type: 'string', description: '或使用 code 指定条目' },
      patch: {
        type: 'object', additionalProperties: true,
        description: '{ verified, verified_note, versions, usage, description, content, tags, severity, component, cve, source, source_url, language }',
      },
      verified: { type: 'boolean', description: '便捷参数：直接传 verified' },
      verified_note: { type: 'string', description: '便捷参数：直接传验证说明' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const patch = Object.assign({}, args.patch || {})
      if (args.verified !== undefined) patch.verified = args.verified
      if (args.verified_note !== undefined) patch.verified_note = args.verified_note
      const row = store.updatePoc(args.id !== undefined ? args.id : args.code, patch)
      return JSON.stringify({ ok: true, id: row.id, code: row.code, verified: row.verified === 1, verified_note: row.verified_note, updated_at: row.updated_at }, null, 2)
    },
  })))

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_poc_use',
    description: '登记一次全局知识库条目的跨项目复用（记录应用在哪个工作区/服务端点）。复用频次高的条目会在检索时优先排序。',
    parameters: {
      id: { type: 'number' },
      code: { type: 'string' },
      used_on: { type: 'string', description: '复用目标：项目工作区名称 / 服务端点 IP / URL' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args) {
      const r = store.markPocUsed(args.id !== undefined ? args.id : args.code, args.used_on)
      return JSON.stringify(r, null, 2)
    },
  })))

  /* ================================================================== 服务节点纳管时间线 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_asset_timeline',
    description: '服务节点与模块「首次纳管时间」视图：按天聚合新增纳管的服务节点数量（区分内网服务区/外网接入区），并列出最近登记的节点。用于追溯架构盘点进度与增量变更。',
    parameters: {
      engagement: { type: 'string' },
      limit: { type: 'number', description: '最近节点条数，默认 50' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const id = resolveEngagement(store, exec, args.engagement)
      const data = store.discoveryTimeline(id, { limit: args.limit })
      return JSON.stringify({
        ok: true, engagement: id,
        span: data.span,
        days: data.days,
        recent: data.recent.map((a) => ({
          id: a.id, ip: a.ip, scope: a.scope, state: a.state, name: a.primary_name,
          discovered_at: a.discovered_at, last_seen: a.last_seen, open_ports: a.open_ports, priority: a.priority,
        })),
        hint: '纳管时间 = 该服务节点**首次登记入库**的时间戳；后续重复扫描仅刷新 last_seen。',
      }, null, 2)
    },
  })))

  /* ================================================================== lmtex（1 Plan + N Workers）4-Wave DAG 闭环工作流编排 */

  registerTool(withStructuredErrors(defineTool({
    name: 'redteam_workflow',
    description: 'LMTAgent 软件工程 4-Wave DAG 与 `lmtex`（`1 Plan + N Workers`）闭环工作流编排工具：支持 `decompose` / `refine_wish`（拿到 User Prompt 即刻拆分为结构化 `plan_goals` 与无交集 `worker_tasks` 或细化许愿需求）、`submit_digest`（Worker 完成分片后将执行过程压缩 80%+ 写回 `worker_digest`）、`approve_worker`（主控 Plan 审批 Worker 摘要并下达 `next_goal`）、`update_goal` / `add_worker` / `retry_worker`（动态更新分片目标、追加自定义 Worker、断点重试 Worker）、`sync_workers`（同步宿主活跃 Worker 与 `ui_priority` 状态到 PostgreSQL 事实库），以及 `status` / `advance` / `seed` / `reset` 波次状态机管理。',
    parameters: {
      engagement: { type: 'string', description: '项目工作区 id；省略则用当前会话绑定的项目' },
      engagement_id: { type: 'string', description: '项目工作区 id（engagement 的兼容别名）' },
      action: {
        type: 'string',
        required: true,
        enum: [
          'status',
          'advance',
          'seed',
          'reset',
          'decompose',
          'submit_digest',
          'approve_worker',
          'sync_workers',
          'refine_wish',
          'update_goal',
          'add_worker',
          'retry_worker',
        ],
        description: '工作流动作：status | advance | seed | reset | decompose | submit_digest | approve_worker | sync_workers | refine_wish | update_goal | add_worker | retry_worker',
      },
      wave: { type: 'number', description: '波次编号（1..4，用于 status / advance / seed / add_worker）' },
      user_prompt: { type: 'string', description: '用户原始软件工程需求提示词（action=decompose / refine_wish 时传入）' },
      goals: {
        type: 'array',
        description: '拆分出的结构化目标与 Worker 任务分片列表（action=decompose / refine_wish 时传入）',
        items: { type: 'object', additionalProperties: true },
      },
      worker_name: { type: 'string', description: 'Worker 子智能体名称，如 Wave3 exploit 分片构建 #1（action=submit_digest / approve_worker / update_goal / add_worker / retry_worker 时传入）' },
      worker_task_id: { type: 'string', description: '关联的 Worker 任务 ID（action=submit_digest / approve_worker / update_goal / retry_worker 时传入）' },
      role: { type: 'string', description: 'Worker 角色标识（recon / designer / assess / exploit / vuln-scan / qa / internal）' },
      assigned_goal: { type: 'string', description: '分配或调整后的 Worker 具体分片目标（action=update_goal / add_worker / retry_worker 时传入）' },
      files_owned: {
        type: 'array',
        items: { type: 'string' },
        description: '该 Worker 独占负责的文件或目录列表（File-Disjoint Sharding，action=update_goal / add_worker / retry_worker 时传入）',
      },
      reason: { type: 'string', description: '目标变更、追加分片或断点重试的原因说明（action=refine_wish / update_goal / add_worker / retry_worker 时传入）' },
      what_was_done: { type: 'string', description: 'Worker 完成工作的核心结构化摘要（action=submit_digest 时传入，实现约 80%+ 上下文压缩）' },
      files_touched: {
        type: 'array',
        items: { type: 'string' },
        description: 'Worker 在本分片实际修改或验证的文件路径列表（action=submit_digest 时传入）',
      },
      key_decisions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Worker 在本分片做出的关键技术决策（action=submit_digest 时传入）',
      },
      verification: { type: 'string', description: '构建门禁与单元测试实测验证回显（action=submit_digest 时传入）' },
      raw_tokens_estimate: { type: 'number', description: '原始执行上下文估算 Token 数（可选）' },
      digest_tokens_estimate: { type: 'number', description: '压缩后摘要估算 Token 数（可选）' },
      decision: {
        type: 'string',
        enum: ['approved', 'revision_requested', 'rejected'],
        description: '主控 Plan 对 Worker 压缩摘要的审批结论（action=approve_worker 时传入，默认 approved）',
      },
      next_goal: { type: 'string', description: '主控 Plan 审批通过后下达的新阶段目标或后续波次任务（action=approve_worker 时传入）' },
      review_note: { type: 'string', description: '主控 Plan 审批备注说明（可选）' },
      ui_priority: {
        type: 'string',
        enum: ['P0', 'P1', 'P2', 'P3'],
        description: '工作台 UI 渲染优先级标签：P0（阻塞焦点/待审批）、P1（活跃并发分片）、P2（已审批压缩归档）、P3（历史基准）',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '领域标签列表，如 ["#core-arch", "#ui-canvas", "#pg-store", "#qa-gate"]',
      },
      workers: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: '宿主活跃 Worker 列表（action=sync_workers 时传入）',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    async execute(args, exec) {
      const rawAction = String(args.action || 'status').trim()
      let engagementId = args.engagement_id || args.engagement
      if (!engagementId) {
        try {
          engagementId = resolveEngagement(store, exec, undefined)
        } catch {
          engagementId = undefined
        }
      }
      const normalizedFilesOwned = Array.isArray(args.files_owned)
        ? Array.from(new Set(args.files_owned.map(normalizeShardPattern).filter(Boolean)))
        : undefined
      const payload = Object.assign(
        {},
        args,
        normalizedFilesOwned !== undefined ? { files_owned: normalizedFilesOwned } : {},
        engagementId ? { engagement: engagementId, engagement_id: engagementId } : {},
      )
      const callStoreMethod = async (fn, p = payload) => {
        const src = Function.prototype.toString.call(fn)
        const firstParam = (src.match(/^[^(]*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1] || ''
        const expectsIdFirst = /^(id|engId|engagementId|engagement)$/i.test(firstParam)
          && !new RegExp('typeof\\s+' + firstParam + '\\s*===\\s*[\'"]object[\'"]').test(src)
        return expectsIdFirst ? await fn.call(store, engagementId, p) : await fn.call(store, p)
      }
      let out
      if (rawAction === 'decompose') {
        if (typeof store.decomposeUserPrompt === 'function') {
          out = await callStoreMethod(store.decomposeUserPrompt, payload)
        } else if (typeof store.workflowAction === 'function') {
          out = await store.workflowAction(Object.assign({}, payload, { action: 'decompose' }))
        }
      } else if (rawAction === 'refine_wish') {
        if (typeof store.refineUserWish === 'function') {
          out = await callStoreMethod(store.refineUserWish, payload)
        } else if (typeof store.decomposeUserPrompt === 'function') {
          out = await callStoreMethod(store.decomposeUserPrompt, Object.assign({}, payload, { action: 'refine_wish', refine: true }))
        } else if (typeof store.workflowAction === 'function') {
          out = await store.workflowAction(Object.assign({}, payload, { action: 'refine_wish' }))
        }
      } else if (rawAction === 'submit_digest') {
        if (typeof store.submitWorkerDigest === 'function') {
          out = await callStoreMethod(store.submitWorkerDigest, payload)
        } else if (typeof store.workflowAction === 'function') {
          out = await store.workflowAction(Object.assign({}, payload, { action: 'submit_digest' }))
        }
      } else if (rawAction === 'approve_worker') {
        if (typeof store.approveWorkerAndDispatchNext === 'function') {
          out = await callStoreMethod(store.approveWorkerAndDispatchNext, payload)
        } else if (typeof store.workflowAction === 'function') {
          out = await store.workflowAction(Object.assign({}, payload, { action: 'approve_worker' }))
        }
      } else if (rawAction === 'update_goal') {
        if (typeof store.updateWorkerGoal === 'function') {
          out = await callStoreMethod(store.updateWorkerGoal, payload)
        } else if (typeof store.workflowAction === 'function') {
          try {
            out = await store.workflowAction(Object.assign({}, payload, { action: 'update_goal' }))
          } catch {
            out = { ok: true, action: 'update_goal', worker_task_id: payload.worker_task_id ?? null, worker_name: payload.worker_name ?? null, assigned_goal: payload.assigned_goal ?? null, files_owned: payload.files_owned ?? [], reason: payload.reason ?? null }
          }
        }
      } else if (rawAction === 'add_worker') {
        if (typeof store.addCustomWorkerTask === 'function') {
          out = await callStoreMethod(store.addCustomWorkerTask, payload)
        } else if (typeof store.workflowAction === 'function') {
          try {
            out = await store.workflowAction(Object.assign({}, payload, { action: 'add_worker' }))
          } catch {
            out = { ok: true, action: 'add_worker', worker_name: payload.worker_name ?? null, role: payload.role ?? 'exploit', assigned_goal: payload.assigned_goal ?? null, files_owned: payload.files_owned ?? [], reason: payload.reason ?? null }
          }
        }
      } else if (rawAction === 'retry_worker') {
        if (typeof store.retryWorkerTask === 'function') {
          out = await callStoreMethod(store.retryWorkerTask, payload)
        } else if (typeof store.workflowAction === 'function') {
          try {
            out = await store.workflowAction(Object.assign({}, payload, { action: 'retry_worker' }))
          } catch {
            out = await store.workflowAction(Object.assign({}, payload, {
              action: 'retryNode',
              nodeId: payload.role || payload.worker_task_id || payload.worker_name || 'exploit',
            }))
          }
        }
      } else if (rawAction === 'sync_workers') {
        if (typeof store.syncHostWorkersToPg === 'function') {
          out = await store.syncHostWorkersToPg(payload.engagement_id, payload.workers || [], payload)
        } else if (typeof store.workflowAction === 'function') {
          out = await store.workflowAction(Object.assign({}, payload, { action: 'sync_workers' }))
        }
      } else if (typeof store.workflowAction === 'function') {
        out = await store.workflowAction(Object.assign({}, payload, { action: rawAction }))
      } else if (rawAction === 'status' && typeof store.getWorkflowBoard === 'function') {
        out = await store.getWorkflowBoard(engagementId, payload)
      } else if (rawAction === 'advance' && typeof store.advanceWorkflow === 'function') {
        out = await store.advanceWorkflow(engagementId, payload)
      } else if (rawAction === 'seed' && typeof store.seedWorkflow === 'function') {
        out = await store.seedWorkflow(engagementId, payload)
      } else if (rawAction === 'reset' && typeof store.resetWorkflow === 'function') {
        out = await store.resetWorkflow(engagementId, payload)
      }
      if (out === undefined) {
        out = { ok: true, action: rawAction, engagement_id: engagementId ?? null }
      }
      if (typeof out === 'string') return out
      return JSON.stringify(Object.assign({ ok: true, action: rawAction, engagement: engagementId ?? null }, out), null, 2)
    },
  })))
}
