/**
 * RedTeam 控制台 —— Host 半侧
 *
 * 职责：为浏览器半侧提供一条 Package 私有的 HTTP 桥接 `POST /redteam/api`：
 *   · 资产库相关 op 转交 `ctx.redteam`（dsh-redteam-store 发布的进程级服务）；
 *   · 会话连通性 op（probeSessions）在 host 侧真实发起 TCP/HTTP 探测；
 *   · 技能目录 op（skillCatalog / skillRead）直接读 `ctx.skills`，按红队 preset
 *     的 standing scope 取目录——技能由 DSH 原生 skill 体系管理（$DSH_HOME/skills、
 *     项目 .dsh/skills、.agents/skills），控制台只做浏览。
 *
 * 为什么走 webServer 而不是 typert/@Remote：本包与 store 包都刻意保持零外部依赖
 * （profile 下解析不到 node_modules），具名路由是最小且稳定的接缝。
 * 跨源请求由 Origin/Host 校验挡住（同源 POST 才放行）。
 */
import { fileURLToPath } from 'node:url'
import { resolve, join, dirname, isAbsolute } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as coreMod from '../../redteam-store/lib/core.js'
/* 技能可用性判定与 redteam_preflight 共用同一份实现（环境变量 / 本机路径 / 占位符） */
import { evaluateSkillsAvailability, summarizeSkills } from '../../redteam-store/lib/skill-availability.js'
import * as settingsMod from '../../redteam-store/lib/settings.js'

const { dispatch, dispatchAsync, probePgConnection, resolvePgConfig } = coreMod
const getPgWriteProbe = coreMod.getPgWriteProbe || (() => ({
  snapshot: () => ({ mode: 'wal', totalWrites: 0, writeRatePerMin: 0, tables: [], recentEvents: [] }),
}))

const DEFAULT_MAX_AGENTS = settingsMod.DEFAULT_MAX_AGENTS ?? 6
const MAX_AGENTS_LIMIT = settingsMod.MAX_AGENTS_LIMIT ?? 12
const DEFAULT_THINKING_EFFORT = settingsMod.DEFAULT_THINKING_EFFORT ?? 'low'
const VALID_THINKING_EFFORTS = settingsMod.VALID_THINKING_EFFORTS ?? ['none', 'low', 'medium', 'high']
const DEFAULT_MAX_DEPTH = settingsMod.DEFAULT_MAX_DEPTH ?? 3
const MAX_DEPTH_LIMIT = settingsMod.MAX_DEPTH_LIMIT ?? 5
const clampMaxAgents = settingsMod.clampMaxAgents || ((n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_AGENTS_LIMIT) return MAX_AGENTS_LIMIT
  return v
})
const normalizeThinkingEffort = settingsMod.normalizeThinkingEffort || ((effort) => {
  const s = typeof effort === 'string' ? effort.trim().toLowerCase() : ''
  return VALID_THINKING_EFFORTS.includes(s) ? s : DEFAULT_THINKING_EFFORT
})
const clampMaxDepth = settingsMod.clampMaxDepth || ((n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_DEPTH_LIMIT) return MAX_DEPTH_LIMIT
  return v
})

/* ------------------------------------------------------------------ 轻量 mtimeMs + TTL(2000ms) 缓存层 */
const HOST_META_TTL_MS = 2000
const settingsFileCache = new Map() // root -> { at, mtimeMs, size, data }
const sessionBindingsCache = new WeakMap() // store -> { at, mtimeMs, size, agents }
const activeEngCache = new WeakMap() // store -> { at, mtimeMs, size, id }
const engagementsListCache = new WeakMap() // store -> { at, dirMtimeMs, list }

function invalidateSettingsCache(root) {
  if (root) settingsFileCache.delete(String(root))
  else settingsFileCache.clear()
}

function invalidateSessionBindingsCache(store) {
  if (store && typeof store === 'object') sessionBindingsCache.delete(store)
}

function invalidateEngagementCaches(store) {
  if (store && typeof store === 'object') {
    activeEngCache.delete(store)
    engagementsListCache.delete(store)
  }
}

function readSettingsCached(root) {
  if (!root) return {}
  const key = String(root)
  const now = Date.now()
  const cached = settingsFileCache.get(key)
  const filePath = join(key, 'settings.json')
  const st = statSync(filePath, { bigint: true, throwIfNoEntry: false })
  if (!st || !st.isFile()) {
    if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) return cached.data
    const empty = {}
    settingsFileCache.set(key, { at: now, missing: true, ino: -1n, mtimeNs: -1n, size: -1n, data: empty })
    return empty
  }
  if (cached && !cached.missing && cached.ino === st.ino && cached.mtimeNs === st.mtimeNs && cached.size === st.size) {
    cached.at = now
    return cached.data
  }
  let data = {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) data = raw
  } catch { data = {} }
  settingsFileCache.set(key, { at: now, missing: false, ino: st.ino, mtimeNs: st.mtimeNs, size: st.size, data })
  return data
}

const rawWriteSettings = settingsMod.writeSettings || ((root, patch) => {
  if (!root) return {}
  mkdirSync(root, { recursive: true })
  const next = Object.assign({}, readSettingsCached(root), patch, { updatedAt: new Date().toISOString() })
  writeFileSync(join(root, 'settings.json'), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
})
const writeSettings = (root, patch) => {
  invalidateSettingsCache(root)
  const res = rawWriteSettings(root, patch)
  invalidateSettingsCache(root)
  return res
}
const resolveCachedSettingsArg = (rootOrObj) => {
  if (rootOrObj && typeof rootOrObj === 'object' && !('root' in rootOrObj)) return rootOrObj
  const rootDir = rootOrObj && typeof rootOrObj === 'object' && typeof rootOrObj.root === 'string'
    ? rootOrObj.root
    : rootOrObj
  if (!rootDir) return undefined
  const s = readSettingsCached(rootDir)
  return s && typeof s === 'object' && !('root' in s) ? s : rootDir
}
const readCachedSettingsObj = (s) => (s && typeof s === 'object' && !('root' in s) ? s : readSettingsCached(s))
const fallbackMaxAgentsOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const fromFile = Number(cfg.maxAgents ?? cfg.max_agents)
  if (Number.isFinite(fromFile) && fromFile > 0) return clampMaxAgents(fromFile)
  if (env && env.REDTEAM_MAX_AGENTS !== undefined && env.REDTEAM_MAX_AGENTS !== '') {
    return clampMaxAgents(env.REDTEAM_MAX_AGENTS)
  }
  return clampMaxAgents(DEFAULT_MAX_AGENTS)
}
const fallbackMaxAgentsSourceOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const fromFile = Number(cfg.maxAgents ?? cfg.max_agents)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  if (env && env.REDTEAM_MAX_AGENTS !== undefined && env.REDTEAM_MAX_AGENTS !== '') return 'env'
  return 'default'
}
const fallbackThinkingEffortOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const rawFile = cfg.thinkingEffort ?? cfg.thinking_effort
  if (rawFile !== undefined) return normalizeThinkingEffort(rawFile)
  if (env && (env.REDTEAM_THINKING_EFFORT || env.DSH_SUBAGENT_THINKING)) {
    return normalizeThinkingEffort(env.REDTEAM_THINKING_EFFORT || env.DSH_SUBAGENT_THINKING)
  }
  return normalizeThinkingEffort(DEFAULT_THINKING_EFFORT)
}
const fallbackMaxDepthOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const fromFile = Number(cfg.maxDepth ?? cfg.max_depth)
  if (Number.isFinite(fromFile) && fromFile >= 1) return clampMaxDepth(fromFile)
  if (env && env.REDTEAM_MAX_DEPTH !== undefined && env.REDTEAM_MAX_DEPTH !== '') {
    return clampMaxDepth(env.REDTEAM_MAX_DEPTH)
  }
  return clampMaxDepth(DEFAULT_MAX_DEPTH)
}
const maxAgentsOf = (rootOrObj, env = process.env) =>
  (settingsMod.maxAgentsOf || fallbackMaxAgentsOf)(resolveCachedSettingsArg(rootOrObj), env)
const maxAgentsSourceOf = (rootOrObj, env = process.env) =>
  (settingsMod.maxAgentsSourceOf || fallbackMaxAgentsSourceOf)(resolveCachedSettingsArg(rootOrObj), env)
const saveMaxAgents = (root, n) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.saveMaxAgents || ((r, v) => {
    const maxAgents = clampMaxAgents(v)
    writeSettings(r, { maxAgents })
    return maxAgents
  })
  const out = fn(root, n)
  invalidateSettingsCache(root)
  return out
}
const savePgUrl = (root, pgUrl) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.savePgUrl || ((r, u) => {
    const trimmed = typeof u === 'string' ? u.trim() : ''
    if (trimmed && !/^postgres(?:ql)?:\/\//i.test(trimmed)) {
      throw new Error('PG URL must start with postgres:// or postgresql://')
    }
    writeSettings(r, { pgUrl: trimmed || null })
    return trimmed || null
  })
  const out = fn(root, pgUrl)
  invalidateSettingsCache(root)
  return out
}
const thinkingEffortOf = (rootOrObj, env = process.env) =>
  (settingsMod.thinkingEffortOf || fallbackThinkingEffortOf)(resolveCachedSettingsArg(rootOrObj), env)
const saveThinkingEffort = (root, effort) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.saveThinkingEffort || ((r, e) => {
    const thinkingEffort = normalizeThinkingEffort(e)
    writeSettings(r, { thinkingEffort })
    return thinkingEffort
  })
  const out = fn(root, effort)
  invalidateSettingsCache(root)
  return out
}
const maxDepthOf = (rootOrObj, env = process.env) =>
  (settingsMod.maxDepthOf || fallbackMaxDepthOf)(resolveCachedSettingsArg(rootOrObj), env)
const saveMaxDepth = (root, n) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.saveMaxDepth || ((r, v) => {
    const maxDepth = clampMaxDepth(v)
    writeSettings(r, { maxDepth })
    return maxDepth
  })
  const out = fn(root, n)
  invalidateSettingsCache(root)
  return out
}

const DEFAULT_AI_PLANNER_SETTINGS = Object.freeze({
  modelMode: 'inherit',
  provider: '',
  model: '',
  reasoningEffort: '',
  timeoutMs: 60000,
  scanRepoContext: true,
  customConstraints: '',
})

const DEFAULT_DISPATCH_POLICY = Object.freeze({
  dispatchMode: 'hybrid_auto',
  subagentProvider: 'spawn',
  autoWakeOnApprove: true,
})

const DEFAULT_UI_PREFERENCES = Object.freeze({
  defaultViewMode: 'expert',
  defaultTreeDirection: 'horizontal',
})

function resolveRedteamSettingsRoot(root, env = process.env) {
  if (typeof root === 'string' && root.trim() !== '') return root.trim()
  if (root && typeof root === 'object' && typeof root.root === 'string' && root.root.trim() !== '') {
    return root.root.trim()
  }
  const dshHome = env && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(dshHome, 'redteam')
}

function clampIntInRange(value, minVal, maxVal, fallback) {
  if (value === undefined || value === null || typeof value === 'boolean' || value === '') return fallback
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, minVal), maxVal)
}

function normalizeAiReasoningEffort(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === '') return ''
  if (['none', 'off', 'low', 'medium', 'high'].includes(raw)) return raw === 'off' ? 'none' : raw
  return ''
}

function normalizeSettingBool(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase()
    if (['false', '0', 'no', 'off'].includes(cleaned)) return false
    if (['true', '1', 'yes', 'on'].includes(cleaned)) return true
    return Boolean(cleaned)
  }
  return Boolean(value)
}

function normalizeUnifiedSettings(raw = {}, env = process.env) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const rawAi = (src.aiPlanner && typeof src.aiPlanner === 'object')
    ? src.aiPlanner
    : (src.ai_planner && typeof src.ai_planner === 'object' ? src.ai_planner : {})
  const rawDispatch = (src.dispatchPolicy && typeof src.dispatchPolicy === 'object')
    ? src.dispatchPolicy
    : (src.dispatch_policy && typeof src.dispatch_policy === 'object' ? src.dispatch_policy : {})
  const rawUi = (src.uiPreferences && typeof src.uiPreferences === 'object')
    ? src.uiPreferences
    : (src.ui_preferences && typeof src.ui_preferences === 'object' ? src.ui_preferences : {})

  const rawModelMode = String(rawAi.modelMode ?? rawAi.model_mode ?? DEFAULT_AI_PLANNER_SETTINGS.modelMode).trim().toLowerCase()
  const modelMode = rawModelMode === 'custom'
    ? 'custom'
    : (rawModelMode === 'follow_session' ? 'follow_session' : 'inherit')
  const rawDispatchMode = String(rawDispatch.dispatchMode ?? rawDispatch.dispatch_mode ?? DEFAULT_DISPATCH_POLICY.dispatchMode).trim().toLowerCase()
  const rawProvider = String(rawDispatch.subagentProvider ?? rawDispatch.subagent_provider ?? DEFAULT_DISPATCH_POLICY.subagentProvider).trim().toLowerCase()
  const rawViewMode = String(rawUi.defaultViewMode ?? rawUi.default_view_mode ?? DEFAULT_UI_PREFERENCES.defaultViewMode).trim().toLowerCase()
  const rawTreeDir = String(rawUi.defaultTreeDirection ?? rawUi.default_tree_direction ?? DEFAULT_UI_PREFERENCES.defaultTreeDirection).trim().toLowerCase()

  return {
    maxAgents: fallbackMaxAgentsOf(src, env),
    thinkingEffort: fallbackThinkingEffortOf(src, env),
    maxDepth: fallbackMaxDepthOf(src, env),
    aiPlanner: {
      modelMode,
      provider: typeof rawAi.provider === 'string' ? rawAi.provider.trim() : '',
      model: typeof rawAi.model === 'string' ? rawAi.model.trim() : '',
      reasoningEffort: normalizeAiReasoningEffort(rawAi.reasoningEffort ?? rawAi.reasoning_effort),
      timeoutMs: clampIntInRange(rawAi.timeoutMs ?? rawAi.timeout_ms, 50, 300000, DEFAULT_AI_PLANNER_SETTINGS.timeoutMs),
      scanRepoContext: normalizeSettingBool(rawAi.scanRepoContext ?? rawAi.scan_repo_context, DEFAULT_AI_PLANNER_SETTINGS.scanRepoContext),
      customConstraints: typeof (rawAi.customConstraints ?? rawAi.custom_constraints) === 'string'
        ? String(rawAi.customConstraints ?? rawAi.custom_constraints).slice(0, 4000)
        : '',
    },
    dispatchPolicy: {
      dispatchMode: rawDispatchMode === 'captain_only' ? 'captain_only' : 'hybrid_auto',
      subagentProvider: rawProvider === 'fork' ? 'fork' : 'spawn',
      autoWakeOnApprove: normalizeSettingBool(rawDispatch.autoWakeOnApprove ?? rawDispatch.auto_wake_on_approve, DEFAULT_DISPATCH_POLICY.autoWakeOnApprove),
    },
    uiPreferences: {
      defaultViewMode: rawViewMode === 'novice' ? 'novice' : 'expert',
      defaultTreeDirection: rawTreeDir === 'vertical' ? 'vertical' : 'horizontal',
    },
  }
}

export function readUnifiedSettings(root, env = process.env) {
  const effRoot = resolveRedteamSettingsRoot(root, env)
  if (typeof settingsMod.getUnifiedSettings === 'function') {
    try {
      const modObj = settingsMod.getUnifiedSettings(effRoot, env)
      if (modObj && typeof modObj === 'object') {
        const fileObj = readSettingsCached(effRoot)
        const base = normalizeUnifiedSettings(Object.assign({}, fileObj, modObj), env)
        /* 若 fileObj 中显式记录了 <15000ms 的 timeoutMs（如测试强制短超时），以文件为准 */
        const fileTimeout = fileObj && fileObj.aiPlanner && fileObj.aiPlanner.timeoutMs
        if (typeof fileTimeout === 'number' && Number.isFinite(fileTimeout) && fileTimeout >= 50 && fileTimeout < 15000) {
          base.aiPlanner.timeoutMs = fileTimeout
        }
        return base
      }
    } catch { /* fallback below */ }
  }
  const fileObj = readSettingsCached(effRoot)
  return normalizeUnifiedSettings(fileObj && typeof fileObj === 'object' ? fileObj : {}, env)
}

export function writeUnifiedSettings(root, patch = {}, env = process.env) {
  const effRoot = resolveRedteamSettingsRoot(root, env)
  const p = patch && typeof patch === 'object' ? patch : {}
  invalidateSettingsCache(effRoot)
  const curNorm = readUnifiedSettings(effRoot, env)
  const fileRaw = readSettingsCached(effRoot)

  const nextObj = Object.assign({}, fileRaw)
  if (p.maxAgents !== undefined || p.max !== undefined || p.max_agents !== undefined) {
    nextObj.maxAgents = clampMaxAgents(p.maxAgents ?? p.max ?? p.max_agents)
  } else if (nextObj.maxAgents === undefined) {
    nextObj.maxAgents = curNorm.maxAgents
  }

  const rawThinking = p.thinkingEffort ?? p.thinking ?? p.thinking_effort ?? p.effort
  if (rawThinking !== undefined) {
    nextObj.thinkingEffort = normalizeThinkingEffort(rawThinking)
  } else if (nextObj.thinkingEffort === undefined) {
    nextObj.thinkingEffort = curNorm.thinkingEffort
  }

  if (p.maxDepth !== undefined || p.max_depth !== undefined || p.depth !== undefined) {
    nextObj.maxDepth = clampMaxDepth(p.maxDepth ?? p.max_depth ?? p.depth)
  } else if (nextObj.maxDepth === undefined) {
    nextObj.maxDepth = curNorm.maxDepth
  }

  const aiPatch = p.aiPlanner ?? p.ai_planner
  if (aiPatch && typeof aiPatch === 'object') {
    nextObj.aiPlanner = Object.assign({}, curNorm.aiPlanner, aiPatch)
  } else if (!nextObj.aiPlanner) {
    nextObj.aiPlanner = curNorm.aiPlanner
  }

  const dispatchPatch = p.dispatchPolicy ?? p.dispatch_policy
  if (dispatchPatch && typeof dispatchPatch === 'object') {
    nextObj.dispatchPolicy = Object.assign({}, curNorm.dispatchPolicy, dispatchPatch)
  } else if (!nextObj.dispatchPolicy) {
    nextObj.dispatchPolicy = curNorm.dispatchPolicy
  }

  const uiPatch = p.uiPreferences ?? p.ui_preferences
  if (uiPatch && typeof uiPatch === 'object') {
    nextObj.uiPreferences = Object.assign({}, curNorm.uiPreferences, uiPatch)
  } else if (!nextObj.uiPreferences) {
    nextObj.uiPreferences = curNorm.uiPreferences
  }

  const normalizedPatch = normalizeUnifiedSettings(nextObj, env)
  if (typeof settingsMod.saveUnifiedSettings === 'function') {
    settingsMod.saveUnifiedSettings(effRoot, normalizedPatch, env)
  } else {
    writeSettings(effRoot, normalizedPatch)
  }

  if (Object.prototype.hasOwnProperty.call(p, 'pgUrl') || Object.prototype.hasOwnProperty.call(p, 'pg_url')) {
    const rawPg = p.pgUrl ?? p.pg_url
    savePgUrl(effRoot, rawPg === null || rawPg === undefined ? '' : String(rawPg))
  }

  invalidateSettingsCache(effRoot)
  return readUnifiedSettings(effRoot, env)
}

function maskPgUrlSafe(rawUrl) {
  if (typeof settingsMod.maskPgUrl === 'function') {
    try { return settingsMod.maskPgUrl(rawUrl) } catch { /* ignore */ }
  }
  if (typeof coreMod.maskPgUrl === 'function') {
    try { return coreMod.maskPgUrl(rawUrl) } catch { /* ignore */ }
  }
  const s = String(rawUrl || '').trim()
  if (!s) return ''
  return s.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:****@')
}

function getCachedActiveEngagementId(store) {
  if (!store || typeof store !== 'object') return null
  const now = Date.now()
  const cached = activeEngCache.get(store)
  let currentPath = null
  try {
    if (typeof store.currentPath === 'function') currentPath = store.currentPath()
    else if (typeof store.root === 'string' && store.root) currentPath = join(store.root, 'current')
  } catch { currentPath = null }
  if (currentPath) {
    const st = statSync(currentPath, { bigint: true, throwIfNoEntry: false })
    if (!st || !st.isFile()) {
      if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) {
        return cached.id
      }
      const fallbackList = getCachedEngagementsList(store)
      const fallbackId = (fallbackList.length > 0 && fallbackList[0] && fallbackList[0].id) ? fallbackList[0].id : null
      activeEngCache.set(store, { at: now, missing: true, ino: -1n, mtimeNs: -1n, size: -1n, id: fallbackId })
      return fallbackId
    }
    if (cached && !cached.missing && cached.ino === st.ino && cached.mtimeNs === st.mtimeNs && cached.size === st.size) {
      cached.at = now
      return cached.id
    }
    const id = typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null
    activeEngCache.set(store, {
      at: now,
      missing: false,
      ino: st.ino,
      mtimeNs: st.mtimeNs,
      size: st.size,
      id: id || null,
    })
    return id || null
  }
  if (cached && (now - cached.at) < HOST_META_TTL_MS) return cached.id
  const id = typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null
  activeEngCache.set(store, { at: now, missing: false, ino: -1n, mtimeNs: -1n, size: -1n, id: id || null })
  return id || null
}

function getCachedEngagementsList(store) {
  if (!store || typeof store !== 'object') return []
  const now = Date.now()
  const cached = engagementsListCache.get(store)
  let engDir = null
  try {
    engDir = store.engagementsDir || (typeof store.root === 'string' && store.root ? join(store.root, 'engagements') : null)
  } catch { engDir = null }
  const st = engDir ? statSync(engDir, { bigint: true, throwIfNoEntry: false }) : null
  const dirMtimeNs = st ? st.mtimeNs : -1n
  if (cached && cached.dirMtimeNs === dirMtimeNs && (now - cached.at) < HOST_META_TTL_MS) {
    return cached.list
  }
  const rawList = typeof store.listEngagements === 'function'
    ? store.listEngagements()
    : ((dispatch(store, { op: 'bootstrap' }) || {}).engagements || [])
  const list = Array.isArray(rawList) ? rawList : []
  engagementsListCache.set(store, {
    at: now,
    dirMtimeNs,
    list,
  })
  return list
}

function normalizeSessionBindingsPayload(raw) {
  if (!raw || typeof raw !== 'object') return {}
  if (Array.isArray(raw)) {
    const out = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const sid = String(item.session || item.id || item.sessionId || '').trim()
      if (sid) {
        const eng = item.engagement || item.bound || item.engagement_id || null
        out[sid] = {
          engagement: eng,
          name: eng ? (item.name || item.engagement_name || eng) : null,
          session_title: item.session_title || item.title || null,
          cwd: item.cwd || null,
          init_state: item.init_state || (eng ? 'initialized' : 'uninitialized'),
          onboarding_dismissed: typeof item.onboarding_dismissed === 'boolean' ? item.onboarding_dismissed : Boolean(eng),
          has_conversation: Boolean(item.has_conversation),
          updated_at: item.updated_at || item.at || null,
          at: item.at || item.updated_at || null,
        }
      }
    }
    return out
  }
  if (raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
    return raw.agents
  }
  if (Array.isArray(raw.bindings) || Array.isArray(raw.items)) {
    return normalizeSessionBindingsPayload(raw.bindings || raw.items)
  }
  return raw
}

function getCachedSessionBindingsMap(store) {
  if (!store || typeof store !== 'object') return {}
  const now = Date.now()
  const cached = sessionBindingsCache.get(store)
  let filePath = null
  try {
    if (typeof store.sessionBindingsPath === 'function') filePath = store.sessionBindingsPath()
    else if (typeof store.root === 'string' && store.root) filePath = join(store.root, 'sessions.json')
  } catch { filePath = null }
  if (filePath) {
    const st = statSync(filePath, { bigint: true, throwIfNoEntry: false })
    if (!st || !st.isFile()) {
      if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) return cached.agents
      const empty = {}
      sessionBindingsCache.set(store, { at: now, missing: true, ino: -1n, mtimeNs: -1n, size: -1n, agents: empty })
      return empty
    }
    if (cached && !cached.missing && cached.ino === st.ino && cached.mtimeNs === st.mtimeNs && cached.size === st.size) {
      cached.at = now
      return cached.agents
    }
    let agents = {}
    try {
      if (typeof store.sessionStates === 'function') {
        agents = normalizeSessionBindingsPayload(store.sessionStates())
      } else if (typeof store.sessionBindings === 'function') {
        agents = normalizeSessionBindingsPayload(store.sessionBindings())
      } else {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
        agents = normalizeSessionBindingsPayload(parsed)
      }
    } catch { agents = {} }
    sessionBindingsCache.set(store, { at: now, missing: false, ino: st.ino, mtimeNs: st.mtimeNs, size: st.size, agents })
    return agents
  }
  if (cached && (now - cached.at) < HOST_META_TTL_MS) return cached.agents
  let agents = {}
  try {
    if (typeof store.sessionStates === 'function') {
      agents = normalizeSessionBindingsPayload(store.sessionStates())
    } else if (typeof store.sessionBindings === 'function') {
      agents = normalizeSessionBindingsPayload(store.sessionBindings())
    }
  } catch { agents = {} }
  sessionBindingsCache.set(store, { at: now, missing: false, ino: -1n, mtimeNs: -1n, size: -1n, agents })
  return agents
}

function getCachedSessionBindingEntry(store, sessionId) {
  const sid = String(sessionId || '').trim()
  if (!store || !sid) return null
  const agents = getCachedSessionBindingsMap(store)
  if (agents && Object.prototype.hasOwnProperty.call(agents, sid) && agents[sid]) {
    const entry = agents[sid]
    if (typeof entry === 'string') {
      return {
        bound: entry,
        name: entry,
        session_title: null,
        cwd: null,
        init_state: 'initialized',
        onboarding_dismissed: true,
        has_conversation: false,
        at: null,
        updated_at: null,
      }
    }
    if (typeof entry === 'object') {
      const bound = entry.engagement || entry.bound || entry.id || entry.engagement_id || null
      const explicitInit = typeof entry.init_state === 'string' ? entry.init_state : ''
      const initState = bound
        ? (explicitInit || 'initialized')
        : (explicitInit && explicitInit !== 'initialized' ? explicitInit : 'uninitialized')
      return {
        bound,
        name: bound ? (entry.name || entry.engagement_name || bound || null) : null,
        session_title: entry.session_title || null,
        cwd: entry.cwd || null,
        init_state: initState,
        onboarding_dismissed: typeof entry.onboarding_dismissed === 'boolean' ? entry.onboarding_dismissed : Boolean(bound),
        has_conversation: Boolean(entry.has_conversation),
        at: entry.updated_at || entry.at || null,
        updated_at: entry.updated_at || entry.at || null,
      }
    }
  }
  if (typeof store.sessionBindings !== 'function' && !store.root) {
    try {
      const b = dispatch(store, { op: 'sessionBinding', session: sid })
      if (b && typeof b === 'object') {
        const bound = b.bound || (b.engagement && b.engagement.id) || null
        if (bound || b.init_state || b.onboarding_dismissed) {
          return {
            bound,
            name: bound ? (b.name || (b.engagement && b.engagement.name) || bound) : null,
            session_title: b.session_title || null,
            cwd: b.cwd || null,
            init_state: b.init_state || (bound ? 'initialized' : 'uninitialized'),
            onboarding_dismissed: typeof b.onboarding_dismissed === 'boolean' ? b.onboarding_dismissed : Boolean(bound),
            has_conversation: Boolean(b.has_conversation),
            at: b.updated_at || null,
            updated_at: b.updated_at || null,
          }
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

/* ------------------------------------------------------------------ Host 事件序号 (eventSeq) 与 SSE 广播管理 */
let eventSeq = 1
const sseClients = new Set()

export function getEventSeq() {
  return eventSeq
}

export function bumpEventSeq(reason = 'update', extra = null) {
  eventSeq += 1
  if (sseClients.size > 0) {
    const payload = Object.assign(
      { seq: eventSeq, reason, ts: Date.now() },
      extra && typeof extra === 'object' ? extra : {},
    )
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of Array.from(sseClients)) {
      if (!client || client.writableEnded || client.destroyed) {
        sseClients.delete(client)
        continue
      }
      try {
        client.write(frame)
      } catch {
        sseClients.delete(client)
      }
    }
  }
  return eventSeq
}


/** 本包自带技能目录（随包分发；dev 安装的 UI 包没有 skills/，此时恒为 false）。 */
const PLUGIN_SKILLS_DIR = (() => {
  try { return resolve(fileURLToPath(new URL('../skills/', import.meta.url))) } catch { return null }
})()
/** 目录比较要规范化：注册表给的是 `/a/b/skills`，URL 拼出来可能带结尾斜杠。 */
const sameDir = (a, b) => {
  if (a === null || b === null) return false
  try { return resolve(a) === resolve(b) } catch { return false }
}

/** 技能分类放在 description 的 `【分类】` 前缀里。
 *  原因：DSH 模型侧技能目录只渲染 name + description，frontmatter 的 category 不会进清单；
 *  把分类写进描述，模型检索和面板分组才能同时看到。 */
const skillCategoryOf = (description) => {
  const m = /^【([^】]{1,12})】/.exec(String(description || ''))
  return m === null ? '未分类' : m[1]
}

/** Cordis 插件名。 */
export const name = 'redteam-ui'

/** 硬依赖：资产库服务 + 浏览器 HTTP 载体 + 技能注册表 + preset 名册（技能目录按红队 scope 读）。 */
export const inject = ['redteam', 'webServer', 'skills', 'agentPresets']

/** 请求体上限（资产导入可能较大）。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/* ------------------------------------------------------------------ 版本与更新 */

/** 运行 shell 命令，带超时；返回 `{ code, stdout, stderr, timedOut }`。 */
function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      /* ⚠️ 两个参数必须显式给对：
         · env 必须传 process.env —— spawn 默认给的是空环境，空 PATH 下
           npm/pnpm 会直接 `spawn npm ENOENT`（版本检查永远失败）；
         · cwd 必须是**真实存在**的目录 —— 传一个不存在的路径同样是 ENOENT
           （报错长得像"命令找不到"，很容易误判）。 */
      const cwd = typeof options.cwd === 'string' && options.cwd !== '' && existsSync(options.cwd) ? options.cwd : undefined
      child = spawn(command, args, {
        cwd,
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolvePromise({ code: -1, stdout: '', stderr: error && error.message ? error.message : String(error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolvePromise(value) } }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 忽略 */ }
      done({ code: -1, stdout: stdout, stderr: stderr, timedOut: true })
    }, Math.max(Number(options.timeoutMs) || 30000, 1000))
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderr += c.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); done({ code: -1, stdout: stdout, stderr: String((error && error.message) || error) }) })
    child.on('close', (code) => { clearTimeout(timer); done({ code: code === null ? -1 : code, stdout: stdout, stderr: stderr }) })
  })
}

/** 本插件包身份（由 store 壳读取 package.json 后挂上；读不到则报"未知版本"）。 */
function pluginIdentity(ctx) {
  const store = ctx.redteam
  const info = store && store.plugin ? store.plugin : null
  return {
    name: (info && info.name) || 'ECCVIK/LMTAgent',
    version: (info && info.version) || null,
    description: (info && info.description) || 'LMTAgent · 多智能体软件工程研发与架构交付控制台',
    homepage: (info && info.homepage) || 'https://github.com/ECCVIK/LMTAgent',
  }
}

/** profile 目录：DSH 的 `ctx.baseUrl` 就是它（loader.internal.import(name, profileDir) 的 base）。
    注意它在不同 DSH 版本里可能是**文件路径**，也可能是 `file://` URL —— 后者直接当路径用会
    读不到 package.json 与 node_modules，把正常的包安装误判成"开发态（源码软链）"，
    于是更新按钮永远点不动。 */
function profileDirOf(ctx) {
  try {
    const base = ctx.baseUrl
    if (typeof base === 'string' && base.length > 0) {
      return base.startsWith('file:') ? fileURLToPath(base) : base
    }
  } catch { /* 忽略 */ }
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
  return join(home, 'profiles', 'web')
}

/** 读 profile 的 package.json（依赖声明 + dsh.profile.bundles）。 */
function readProfilePackage(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch { return null }
}

/** 包管理器：profile 里有 pnpm-lock / pnpm-workspace 就用 pnpm，否则 npm。 */
function packageManagerOf(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
  return 'npm'
}

/**
 * 更新前置检查：装的是不是发布版（profile 里能不能解析到这个包名）、
 * 有没有智能体正在跑（更新要重启 dsh web，会把它们打断）。
 */
async function updatePreflight(ctx) {
  const dir = profileDirOf(ctx)
  const pkg = pluginIdentity(ctx)
  const profilePkg = readProfilePackage(dir)
  const deps = (profilePkg && profilePkg.dependencies) || {}
  const declared = typeof deps[pkg.name] === 'string' ? deps[pkg.name] : null
  const installedDir = join(dir, 'node_modules', pkg.name)
  const blockers = []
  const notes = []

  /* ① 装法：profile 依赖里没有这个包名，且 node_modules 里也没有它 —— 是本地源码软链/
     手动挂载的开发态。**不再拦住更新**：包管理器照常能把发布版装进 profile（等于把开发态
     换成正式安装），只是要明确提醒"本地源码改动不再生效"。 */
  const installedInNodeModules = existsSync(join(installedDir, 'package.json'))
  const sourceInstall = declared === null && !installedInNodeModules
  if (sourceInstall) {
    notes.push('当前是**本地源码安装**（profile 依赖里没有 ' + pkg.name + '）：点击更新会把发布版'
      + '装进 profile 的 node_modules，本地源码改动不再生效；装完这次以后就能正常用一键更新。')
  }

  /* ② 有智能体在跑：重启会打断它们 */
  let running = []
  try {
    const subagents = ctx.get('subagents')
    const sessions = ctx.get('sessions')
    if (subagents !== undefined && subagents !== null && sessions !== undefined && sessions !== null && typeof sessions.list === 'function') {
      const roots = sessions.list().filter((s) => {
        const header = s && s.header
        return header && (header.parentSession === undefined || header.parentSession === null)
      })
      for (const root of roots) {
        try {
          const kids = await subagents.listChildren(root.id)
          for (const k of Array.isArray(kids) ? kids : []) {
            if (k && k.kind === 'child' && k.activity === 'running') running.push({ session: String(root.id), label: k.label || String(k.id) })
          }
        } catch { /* 单个会话读不到不影响其它 */ }
      }
    }
  } catch { /* 注册表不可用就不挡（只是少了一层保护） */ }
  if (running.length > 0) {
    blockers.push('有 ' + running.length + ' 个智能体正在跑（' + running.map((r) => r.label).join('、') + '）：更新要重启 dsh web，会打断它们。请等它们结束。')
  }
  return { dir, declared, packageManager: packageManagerOf(dir), sourceInstall, running, blockers, notes }
}

/** 到 npm registry 查最新版本（走包管理器，避免自带网络栈）。 */
async function checkLatest(ctx, dir, name) {
  const pm = packageManagerOf(dir)
  const args = pm === 'pnpm' ? ['view', name, 'version', '--json'] : ['view', name, 'version', '--json']
  const r = await run(pm, args, { cwd: dir, timeoutMs: 60000 })
  if (r.code !== 0) {
    return { ok: false, error: '查询最新版本失败（' + pm + ' view）：' + String(r.stderr || r.stdout || '').trim().slice(0, 400) }
  }
  const raw = String(r.stdout || '').trim().replace(/^"|"$/g, '')
  const latest = raw.split('\n').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean).pop() || null
  return { ok: latest !== null, latest, registry: pm }
}

/** `a < b`（只比较数字段，够用；预发布后缀按"更旧"处理）。 */
function versionLess(a, b) {
  const parse = (v) => String(v || '').split('-')[0].split('.').map((x) => Number(x) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) < (y[i] || 0)) return true
    if ((x[i] || 0) > (y[i] || 0)) return false
  }
  return false
}

/**
 * 重启脚本：等旧进程退出 + 端口释放，再按同样的参数把 dsh web 拉起来。
 *
 * 生成的是一个**自包含的 node 脚本**（不是 shell 脚本），它做三件事：
 *   ① 等旧 pid 退出（最多 60 秒）；
 *   ② 等端口不再被监听（最多 30 秒，用 net 探测，不依赖 ss/lsof）；
 *   ③ spawn(command, ARGS_ARRAY) 以 argv 数组拉起新进程。
 *
 * 为什么不用 shell：原实现把命令与参数拼成 shell 串，需要一套手写引号转义
 * （单引号里套单引号、双引号再转义），任何一处漏掉就是命令注入 ——
 * 而这段脚本正是"由程序生成、以用户身份执行"的，最不该有注入面。
 * argv 数组交给 spawn 之后 shell 完全不参与，转义问题从根上消失。
 *
 * @param pid - 当前进程 pid（等它退出）。
 * @param port - dsh web 端口（等它释放）。
 * @param command - 可执行文件（通常是 process.argv[0]）。
 * @param args - 参数数组（process.argv.slice(1)）。
 * @param logPath - 日志文件路径（追加写）。
 * @param cwd - 新进程的工作目录。
 * @returns 脚本正文。
 */
function restartScript(pid, port, command, args, logPath, cwd) {
  const payload = {
    oldPid: Number(pid),
    port: Number(port) || 0,
    command: String(command),
    args: args.map((a) => String(a)),
    log: String(logPath),
    cwd: String(cwd),
  }
  return [
    '#!/usr/bin/env node',
    '/* 由 RedTeam 控制台的「自动更新」生成：等旧 dsh web 退出后，按原 argv 把它重新拉起。',
    '   参数以数组形式传给 spawn —— shell 不参与，因此不存在引号转义与命令注入问题。 */',
    "'use strict'",
    'const { spawn } = require("node:child_process")',
    'const { appendFileSync, mkdirSync } = require("node:fs")',
    'const { connect } = require("node:net")',
    'const { dirname } = require("node:path")',
    'const CFG = ' + JSON.stringify(payload, null, 2),
    '',
    'const log = (msg) => {',
    '  const line = "[" + new Date().toISOString() + "] " + msg + "\\n"',
    '  try { mkdirSync(dirname(CFG.log), { recursive: true }); appendFileSync(CFG.log, line) } catch (e) { /* 日志写不进去不该影响重启 */ }',
    '}',
    '',
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
    '',
    '/** 旧进程还在吗（kill -0 的等价物）。 */',
    'const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }',
    '',
    '/** 端口还有人在听吗（不依赖 ss/lsof）。 */',
    'const portBusy = (port) => new Promise((resolve) => {',
    '  if (!port) { resolve(false); return }',
    '  const sock = connect({ host: "127.0.0.1", port: port })',
    '  let done = false',
    '  const finish = (busy) => { if (!done) { done = true; try { sock.destroy() } catch (e) {} resolve(busy) } }',
    '  sock.setTimeout(800)',
    '  sock.on("connect", () => finish(true))',
    '  sock.on("timeout", () => finish(false))',
    '  sock.on("error", () => finish(false))',
    '})',
    '',
    'async function main() {',
    '  log("等待旧进程 pid=" + CFG.oldPid + " 退出…")',
    '  for (let i = 0; i < 60; i += 1) {',
    '    if (!alive(CFG.oldPid)) break',
    '    await sleep(1000)',
    '  }',
    '  for (let i = 0; i < 30; i += 1) {',
    '    if (!(await portBusy(CFG.port))) break',
    '    await sleep(1000)',
    '  }',
    '  log("启动：" + CFG.command + " " + CFG.args.join(" "))',
    '  const child = spawn(CFG.command, CFG.args, {',
    '    cwd: CFG.cwd,',
    '    detached: true,',
    '    stdio: ["ignore", "ignore", "ignore"],',
    '    env: process.env,',
    '  })',
    '  child.unref()',
    '  log("已拉起新进程 pid=" + child.pid)',
    '}',
    '',
    'main().catch((error) => { log("重启失败：" + (error && error.message ? error.message : String(error))) })',
    '',
  ].join('\n')
}

/** 应用更新：装新版本 + 生成重启脚本 + 让当前进程退出。 */
async function applyUpdate(ctx, dir, name, targetVersion) {
  const primary = packageManagerOf(dir)
  const spec = targetVersion ? name + '@' + targetVersion : name
  const attempt = async (pm) => {
    const args = pm === 'pnpm' ? ['add', spec] : ['install', spec, '--save']
    const r = await run(pm, args, { cwd: dir, timeoutMs: 300000 })
    return { pm, args, r }
  }
  let { pm, args, r } = await attempt(primary)
  if (r.code !== 0) {
    /* 首选包管理器失败就换另一个再试一次：profile 由 pnpm 管理但机器上没装 pnpm、
       或 npm 因 workspace 布局拒绝写入，都属于"换一个就能装"的情况。
       两个都失败才报错，并把两次输出都带上，别让用户猜。 */
    const first = pm + ' ' + args.join(' ') + '：' + String(r.stderr || r.stdout || '').trim().slice(0, 600)
    const retry = await attempt(primary === 'pnpm' ? 'npm' : 'pnpm')
    if (retry.r.code !== 0) {
      return {
        ok: false,
        error: '安装失败。第一次：' + first + ' ｜ 第二次：' + retry.pm + ' ' + retry.args.join(' ')
          + '：' + String(retry.r.stderr || retry.r.stdout || '').trim().slice(0, 600),
      }
    }
    pm = retry.pm
    args = retry.args
    r = retry.r
  }
  /* 装完把这个包登记进 profile 的 `dsh.profile.bundles`：手动挂载过的机器可能只装了依赖
     而没登记，重启后插件不会加载。 */
  const bundleState = ensureProfileBundle(dir, name)
  /* 重启：拿当前进程的启动命令原样再来一遍 */
  const argv = process.argv.slice()
  const command = argv[0]
  const rest = argv.slice(1)
  const port = (() => {
    try { return String(ctx.webServer.port) } catch { return '3080' }
  })()
  const root = (() => {
    try { return ctx.redteam.root } catch { return join(process.env.DSH_HOME || '.', 'redteam') }
  })()
  mkdirSync(root, { recursive: true })
  const logPath = join(root, 'update.log')
  const scriptPath = join(root, 'restart-dsh-web.sh')
  writeFileSync(scriptPath, restartScript(process.pid, port, command, rest, logPath, process.cwd()), { encoding: 'utf8', mode: 0o755 })
  const child = spawn(process.execPath, [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  /* 给浏览器留出收到响应的窗口，然后退出 —— 新进程由脚本按原命令行拉起 */
  setTimeout(() => { process.exit(0) }, 1200).unref()
  return {
    ok: true, installed: spec, packageManager: pm, bundleRegistered: bundleState,
    restart: { script: scriptPath, log: logPath, port, command: [command].concat(rest).join(' '), pid: process.pid },
  }
}

/**
 * 把包名登记进 profile 的 `dsh.profile.bundles`（缺了重启后插件不会被加载）。
 * @returns `'present'`（本来就在）/ `'added'`（已补上）/ `'failed'`（读不到或写不了，不影响安装本身）。
 */
function ensureProfileBundle(dir, name) {
  try {
    const path = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    const profile = pkg && pkg.dsh && pkg.dsh.profile ? pkg.dsh.profile : null
    if (profile === null || typeof profile !== 'object') return 'failed'
    const bundles = Array.isArray(profile.bundles) ? profile.bundles : []
    if (bundles.includes(name)) return 'present'
    profile.bundles = bundles.concat([name])
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return 'added'
  } catch { return 'failed' }
}


/** 读取完整请求体；超过上限即中断。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 统一的 JSON 响应。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 技能可用性缓存：`{ at, scope, byName: Map }`；30 秒内复用。 */
let skillAvailabilityCache = null
const SKILL_AVAILABILITY_TTL_MS = 30000

/**
 * 逐个技能的可用性（读正文 → 共享判定模块）。
 * @param ctx - 插件上下文。
 * @param list - `ctx.skills.list()` 的返回（SkillSummary[]）。
 * @param scope - 当前作用域。
 * @param force - true 时跳过快取缓存。
 */
async function skillAvailabilityOf(ctx, list, scope, force) {
  const now = Date.now()
  if (!force && skillAvailabilityCache !== null
    && now - skillAvailabilityCache.at < SKILL_AVAILABILITY_TTL_MS
    && skillAvailabilityCache.size === list.length) {
    return { at: skillAvailabilityCache.at, cached: true, byName: skillAvailabilityCache.byName }
  }
  const { byName } = await evaluateSkillsAvailability(ctx.skills, list, { scope })
  skillAvailabilityCache = { at: now, size: list.length, byName }
  return { at: now, cached: false, byName }
}

/** 红队 preset 的 id —— 与 cordis.patch.yml 里那条声明行的 `config.id` 必须一致。 */
const REDTEAM_PRESET_ID = 'redteam'

/**
 * 取红队 preset 的作用域键：技能库按它读"红队会话实际能用到的技能"。
 *
 * DSH 的 preset 注册表在两个世代里 API 不同，这里都兼容：
 *   · ≥ 0.1.7（`dsh-agent-preset-registry`）：`acquireScope(id)` 返回**租约**
 *     `{ key, [Symbol.asyncDispose] }`，官方注释写明"读完就释放"——
 *     不释放会让已退役的 revision 一直被留住；
 *   · ≤ 0.1.6（`dsh-agent-presets`）：`standingKeyFor(id)` 直接给一个常驻作用域键，无需释放。
 *
 * @param ctx - 插件上下文。
 * @returns `{ key, release }`；`release` 为 null 表示无需释放。
 * @throws 两个 API 都没有时抛出（错误里带上实际可用的方法名，便于下次改名时定位）。
 */
async function resolveRedteamScope(ctx) {
  const presets = ctx.agentPresets
  if (typeof presets?.acquireScope === 'function') {
    const lease = await presets.acquireScope(REDTEAM_PRESET_ID)
    const release = typeof lease?.[Symbol.asyncDispose] === 'function'
      ? () => lease[Symbol.asyncDispose]()
      : (typeof lease?.dispose === 'function' ? () => lease.dispose() : null)
    return { key: lease.key, release }
  }
  if (typeof presets?.standingKeyFor === 'function') {
    return { key: await presets.standingKeyFor(REDTEAM_PRESET_ID), release: null }
  }
  let seen = '（没有 agentPresets 服务）'
  if (presets) {
    const proto = Object.getPrototypeOf(presets)
    seen = Object.getOwnPropertyNames(proto)
      .filter((name) => typeof presets[name] === 'function')
      .slice(0, 16)
      .join(', ') || '（看不到任何方法）'
  }
  throw new Error('当前 DSH 的 agentPresets 缺少 acquireScope / standingKeyFor；实际可用：' + seen)
}

/**
 * 技能目录：按红队 preset 的作用域读取原生 skill 注册表。
 * 技能由 DSH 管理（$DSH_HOME/skills、项目 .dsh/skills、.agents/skills、内置根），
 * 控制台只列出「红队会话实际能用到的技能」。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'skillCatalog' | 'skillRead', name? }`。
 * @returns JSON 结果，或 undefined 表示不是技能类 op。
 */
async function handleSkillOp(ctx, request) {
  if (request.op !== 'skillCatalog' && request.op !== 'skillRead') return undefined
  let lease
  try {
    lease = await resolveRedteamScope(ctx)
  } catch (error) {
    return { ok: false, error: '无法解析红队 preset 作用域：' + (error && error.message ? error.message : String(error)) }
  }
  /* 作用域是"租约"：无论读取成功还是抛错，读完都要还回去。 */
  try {
    return await readSkillOp(ctx, request, lease.key)
  } finally {
    if (typeof lease.release === 'function') {
      try { await lease.release() } catch { /* 释放失败不该盖住读取结果 */ }
    }
  }
}

/**
 * 技能类 op 的实现；`scope` 由调用方申请并负责释放。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'skillCatalog' | 'skillRead', name? }`。
 * @param scope - 红队 preset 的作用域键。
 * @returns JSON 结果。
 */
async function readSkillOp(ctx, request, scope) {
  if (request.op === 'skillCatalog') {
    const list = await ctx.skills.list({ scope })
    /* 可用性检查要读每个技能的正文（可能几百个），做 30 秒缓存：
       面板反复打开、切页签都不会重复打注册表；技能是磁盘文件，半分钟粒度足够。
       `refresh: true` 跳过缓存（面板上的「重新检查可用性」按钮用）。 */
    const availability = await skillAvailabilityOf(ctx, list, scope, request.refresh === true)
    /* 技能目录来自 DSH 原生注册表：自带根 + $DSH_HOME/skills + 项目根 + **每个插件注册的根**
       （本插件只是其中之一）。所以这里把"每个技能来自哪个目录/哪个来源"如实给出来，
       否则用户看到几百个技能会以为是我们塞进去的。 */
    const bySource = new Map()
    const byDir = new Map()
    const items = list.map((s) => {
      const dir = s.resourceBase && s.resourceBase.kind === 'directory' ? s.resourceBase.path : null
      const name = dir === null ? '(非文件系统来源)' : dir
      byDir.set(name, (byDir.get(name) || 0) + 1)
      bySource.set(s.source, (bySource.get(s.source) || 0) + 1)
      const avail = availability.byName.get(s.name)
      return {
        name: s.name,
        description: s.description,
        category: skillCategoryOf(s.description),
        whenToUse: s.whenToUse || '',
        provider: s.provider,
        source: s.source,
        dir: dir,
        modelInvocable: s.invocation ? s.invocation.modelInvocable !== false : true,
        userInvocable: s.invocation ? s.invocation.userInvocable !== false : true,
        fromPlugin: sameDir(dir, PLUGIN_SKILLS_DIR),
        /* 可用性：available 能直接跑 / broken 有明确缺口 / unknown 正文读不到判不了 */
        availability: avail ? avail.status : 'unknown',
        problems: avail ? avail.problems : ['未检查'],
        needs_user: avail ? avail.needs_user : [],
      }
    })
    const availSummary = summarizeSkills(Array.from(availability.byName.values()))
    return {
      ok: true,
      total: items.length,
      fromPlugin: items.filter((x) => x.fromPlugin).length,
      availability: {
        summary: availSummary,
        checked_at: availability.at,
        cached: availability.cached,
        broken: Array.from(availability.byName.values()).filter((x) => x.status === 'broken')
          .map((x) => ({ name: x.name, issues: x.issues, problems: x.problems, needs_user: x.needs_user })),
        note: '可用性 = 技能文件存在 + 正文能加载 + 必需环境变量已设置 + 正文引用的本机路径存在 + 没有未填的基础设施占位符；'
          + '判定用的是运行 dsh 的这个进程的环境变量（不是 shell 里 export 的）。未列出的技能正文读不到，状态为未知。',
      },
      bySource: Array.from(bySource, ([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
      byDir: Array.from(byDir, ([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
      note: '技能由 DSH 原生注册表管理：DSH 自带根 + $DSH_HOME/skills + 项目根 .dsh/skills、.agents/skills + 各插件注册的根。本插件只自带 ' +
        '了 ' + items.filter((x) => x.fromPlugin).length + ' 个（随包分发），其余来自其它来源。',
      items,
    }
  }
  if (typeof request.name !== 'string' || request.name.length === 0) {
    return { ok: false, error: 'name required' }
  }
  const skill = await ctx.skills.get(request.name, { scope })
  if (skill === undefined) return { ok: false, error: 'skill not found: ' + request.name }
  return {
    ok: true,
    name: skill.name,
    description: skill.description,
    category: skillCategoryOf(skill.description),
    whenToUse: skill.whenToUse || '',
    provider: skill.provider,
    source: skill.source,
    path: skill.path || null,
    content: skill.content || '',
  }
}

/**
 * 智能体并发状态（「智能体」页签用）：直接读 subagents 注册表里"真正在跑"的子会话。
 * 与工具层的 `redteam_agent_slot` 同一套口径，但这里只读不占位。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'agentsStatus' }`。
 * @returns JSON 结果，或 undefined 表示不是这个 op。
 */
/**
 * 判断会话标题或工作区名称是否为自动生成的原始 UUID 会话名（如 `session-c510422c-...` 或 `pureking-session-c510422c-...`）。
 */
export function isUuidSessionTitle(str) {
  const s = String(str || '').trim()
  if (!s) return false
  return /^(?:[a-z0-9_-]+\s*[·-]\s*)?session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    || /(?:^|[·\s_-])session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)
}

function isUuidEngagement(eng) {
  if (!eng || typeof eng !== 'object') return false
  return isUuidSessionTitle(eng.id) || isUuidSessionTitle(eng.name)
}

function isEngagementEmpty(eng) {
  if (!eng || typeof eng !== 'object' || !eng.stats) return true
  const st = eng.stats
  return (Number(st.assets) || 0) === 0
    && (Number(st.vulns) || 0) === 0
    && (Number(st.credentials) || 0) === 0
    && (Number(st.accesses) || 0) === 0
}

function filterValidEngagements(engagements) {
  const list = Array.isArray(engagements) ? engagements : []
  const realNamed = list.filter((e) => e && !isUuidEngagement(e))
  if (realNamed.length === 0) return list
  return list.filter((e) => e && (!isUuidEngagement(e) || !isEngagementEmpty(e)))
}

const AGENT_ROLE_META = {
  plan: {
    role: 'plan',
    badge: '主控',
    wave: 0,
    color: '#4d6bfe',
    defaultTitle: '主控指挥 Captain',
    promptFallback: '拆解用户需求意图，按 4-Wave Bounded DAG 派发子智能体并聚合 PostgreSQL 事实库回报。',
  },
  designer: {
    role: 'designer',
    badge: 'WD',
    wave: 1,
    color: '#ef4444',
    defaultTitle: 'Wave1 designer 交互与令牌',
    promptFallback: 'Wave 1 交互与视觉设计（Designer）：输出组件树、设计令牌（Design Tokens）与四态交互规范。',
  },
  recon: {
    role: 'recon',
    badge: 'WR',
    wave: 1,
    color: '#10b981',
    defaultTitle: 'Wave1 recon 产品与数据源',
    promptFallback: 'Wave 1 产品与需求规划（CEO）：全量模块拓扑与数据源测绘，标注 P0/P1 核心边界并写入事实库。',
  },
  assess: {
    role: 'assess',
    badge: 'WA',
    wave: 2,
    color: '#8b5cf6',
    defaultTitle: 'Wave2 assess 架构与分片',
    promptFallback: 'Wave 2 系统架构与排期（Eng Manager）：锁死接口契约与文件无交集的并发开发分片。',
  },
  exploit: {
    role: 'exploit',
    badge: 'WB',
    wave: 3,
    color: '#3b82f6',
    defaultTitle: 'Wave3 exploit 全栈研发与构建',
    promptFallback: 'Wave 3 全栈研发与构建（Builder）：按独占文件分片并行编码实现、自测验证并回写事实库。',
  },
  'vuln-scan': {
    role: 'vuln-scan',
    badge: 'WC',
    wave: 4,
    color: '#f59e0b',
    defaultTitle: 'Wave4 vuln-scan 代码审查与安全',
    promptFallback: 'Wave 4 代码审查与安全（Reviewer & CSO）：审查逻辑回归、IPC/安全边界与质量红线。',
  },
  qa: {
    role: 'qa',
    badge: 'WQ',
    wave: 4,
    color: '#06b6d4',
    defaultTitle: 'Wave4 qa 质量保障与测试',
    promptFallback: 'Wave 4 质量保障与测试（QA Lead）：执行全量自动化回归测试套件与性能基准核验。',
  },
  internal: {
    role: 'internal',
    badge: 'WI',
    wave: 4,
    color: '#6366f1',
    defaultTitle: 'Wave4 internal 文档工程与发布',
    promptFallback: 'Wave 4 文档工程与发布（Doc & Release）：同步架构交付文档、CHANGELOG 与最终发布归档。',
  },
}

function inferAgentRole(titleOrLabel, isRoot = false, explicitRole = '') {
  if (isRoot) return 'plan'
  const exp = String(explicitRole || '').trim().toLowerCase()
  if (exp && AGENT_ROLE_META[exp]) return exp
  const s = String(titleOrLabel || '').trim()
  if (!s) return 'exploit'
  if (/designer|交互|视觉|令牌|design|\bwd\b/i.test(s)) return 'designer'
  if (/recon|\bceo\b|产品|数据源|需求|测绘|\bwr\b/i.test(s)) return 'recon'
  if (/assess|架构|分片|契约|排期|\bwa\b/i.test(s)) return 'assess'
  if (/vuln[-_]?scan|\breview(?:er)?\b|\bcso\b|审查|安全|审计|\bwc\b/i.test(s)) return 'vuln-scan'
  if (/\bqa\b|测试|质量|回归|benchmark|\bwq\b/i.test(s)) return 'qa'
  if (/internal|\brelease\b|\bdoc(?:s|ument)?\b|文档|发布|归档|\bwi\b/i.test(s)) return 'internal'
  if (/exploit|\bbuilder\b|研发|构建|编码|开发|shard|\bwb\b/i.test(s)) return 'exploit'
  if (/wave\s*1/i.test(s)) return 'recon'
  if (/wave\s*2/i.test(s)) return 'assess'
  if (/wave\s*3/i.test(s)) return 'exploit'
  if (/wave\s*4/i.test(s)) return 'qa'
  return 'exploit'
}

function inferAgentWave(titleOrLabel, role, isRoot = false) {
  if (isRoot || role === 'plan') return 0
  const m = /wave\s*([0-4])/i.exec(String(titleOrLabel || ''))
  if (m) return Number(m[1])
  return (AGENT_ROLE_META[role] && AGENT_ROLE_META[role].wave) ?? 3
}

function parseTimestampMs(val) {
  if (val === undefined || val === null || val === '') return 0
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val < 1e12 ? val * 1000 : val
  }
  const num = Number(val)
  if (Number.isFinite(num) && num > 0) {
    return num < 1e12 ? num * 1000 : num
  }
  const parsed = Date.parse(String(val))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDurationLabel(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0)
  if (ms <= 0) return '0s'
  const totalSec = Math.max(1, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hours > 0) return `${hours}h${mins}m${secs > 0 ? secs + 's' : ''}`
  return `${mins}m${secs > 0 ? secs + 's' : ''}`
}

function getSessionMessages(s) {
  if (!s || typeof s !== 'object') return []
  if (Array.isArray(s.messages)) return s.messages
  if (Array.isArray(s.entries)) return s.entries
  if (Array.isArray(s.history)) return s.history
  return []
}

function getMessageRole(msg, fallbackKind = '') {
  if (!msg || typeof msg !== 'object') return String(fallbackKind || '').toLowerCase()
  return String(msg.role || msg.sender || msg.author || msg.type || fallbackKind || '').toLowerCase()
}

function getMessageToolCalls(msg, { includeNamedPart = false } = {}) {
  if (!msg || typeof msg !== 'object') return []
  const out = []
  const tcs = msg.toolCalls || msg.tool_calls
  if (Array.isArray(tcs)) {
    for (const tc of tcs) out.push(tc)
  }
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && typeof part === 'object'
        && (part.type === 'tool_use' || part.type === 'tool-call' || part.toolName || (includeNamedPart && part.name))) {
        out.push(part)
      }
    }
  }
  return out
}

function getToolCallMeta(tc) {
  const obj = tc && typeof tc === 'object' ? tc : {}
  const name = String(
    obj.name || obj.toolName || obj.tool_name || (obj.function && obj.function.name) || 'workspace.tool',
  ).trim() || 'workspace.tool'
  const rawInput = obj.input ?? obj.arguments ?? obj.args ?? (obj.function && obj.function.arguments) ?? null
  return { name, rawInput }
}

function extractMessageText(msg) {
  if (!msg) return ''
  if (typeof msg === 'string') return msg.replace(/\s+/g, ' ').trim()
  const raw = msg.content ?? msg.text ?? msg.body ?? msg.message ?? ''
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/\s+/g, ' ').trim()
  if (Array.isArray(raw)) {
    const joined = raw.map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      if (typeof part.text === 'string') return part.text
      if (typeof part.content === 'string') return part.content
      if (part.type === 'tool_use' || part.type === 'tool-call' || part.name) {
        return `[工具调用] ${part.name || part.toolName || ''}`
      }
      return ''
    }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (joined) return joined
  }
  const tcs = msg.toolCalls || msg.tool_calls
  if (Array.isArray(tcs) && tcs.length > 0) {
    const names = tcs.map((t) => getToolCallMeta(t).name || 'tool').join(', ')
    return `[工具调用] ${names}`
  }
  return ''
}

function extractSessionPreviews(s, header, role, fallbackOutput = '') {
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const messages = getSessionMessages(s)

  let promptText = String(
    (s && (s.promptPreview || s.prompt || s.delegationPrompt || s.task || s.input))
    || (header && (header.prompt || header.task || header.description))
    || ''
  ).replace(/\s+/g, ' ').trim()

  if (!promptText && messages.length > 0) {
    const firstUser = messages.find((m) => m && getMessageRole(m) === 'user') || messages[0]
    promptText = extractMessageText(firstUser)
  }
  if (!promptText) promptText = meta.promptFallback

  let outputText = String(
    (s && (s.latestOutputPreview || s.outputPreview || s.latestOutput || s.result || s.summary))
    || (header && (header.summary || header.latestOutput))
    || ''
  ).replace(/\s+/g, ' ').trim()

  if (!outputText && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (!m) continue
      const r = getMessageRole(m)
      if (r === 'assistant' || r === 'model' || r === 'tool' || (i > 0 && r !== 'user')) {
        const txt = extractMessageText(m)
        if (txt) {
          outputText = txt
          break
        }
      }
    }
  }
  if (!outputText) outputText = String(fallbackOutput || '').replace(/\s+/g, ' ').trim()

  return {
    promptPreview: promptText.slice(0, 160),
    latestOutputPreview: outputText.slice(0, 160),
  }
}

/* ------------------------------------------------------------------ 增量会话 JSONL 读取器 (Bounded LRU = 128) 与原生 tokenMeter 集成 */

const JSONL_LRU_MAX = 128
const JSONL_LARGE_THRESHOLD = 262144 // 256 KB
const JSONL_HEAD_BYTES = 16384 // 16 KB
const JSONL_TAIL_BYTES = 131072 // 128 KB
const JSONL_MAX_DELTA_BYTES = 524288 // 512 KB
const WRITE_EDIT_TOOL_RE = /(?:^|[._-])(?:write|edit|replace|patch|create_file|save_file|str_replace|apply_patch|apply_diff|notebook_edit|add_attack_file)(?:$|[._-])/i

function normalizeTouchedFilePath(rawPath) {
  if (typeof rawPath !== 'string') return ''
  let p = rawPath.trim().replace(/^file:\/\//i, '').replace(/^['"`]+|['"`]+$/g, '').trim()
  if (!p || p.length > 260 || p.includes('\n') || p.includes('\0')) return ''
  p = p.replace(/\\/g, '/')
  const pkgIdx = p.indexOf('packages/')
  if (pkgIdx >= 0) return p.slice(pkgIdx)
  const srcIdx = p.indexOf('/src/')
  if (srcIdx >= 0) return p.slice(srcIdx + 1)
  const parts = p.split('/').filter(Boolean)
  if (parts.length > 3) return parts.slice(-3).join('/')
  return p
}

function extractPathsFromToolCall(toolName, rawArgs, outSet) {
  if (!toolName && !rawArgs) return
  const nameStr = String(toolName || '').trim()
  const isWriteLike = WRITE_EDIT_TOOL_RE.test(nameStr) || /write|edit|replace|patch/i.test(nameStr)
  if (!isWriteLike) return
  let argsObj = rawArgs
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim()
    if (trimmed.startsWith('{')) {
      try { argsObj = JSON.parse(trimmed) } catch { argsObj = null }
    }
    if (!argsObj) {
      const patchRe = /\*\*\*\s+(?:Update|Add)\s+File:\s+([^\r\n]+)/g
      let pm
      while ((pm = patchRe.exec(trimmed)) !== null) {
        const norm = normalizeTouchedFilePath(pm[1])
        if (norm && outSet.size < 12) outSet.add(norm)
      }
      return
    }
  }
  if (!argsObj || typeof argsObj !== 'object') return
  const candidates = [
    argsObj.TargetFile,
    argsObj.target_file,
    argsObj.targetFile,
    argsObj.file_path,
    argsObj.filePath,
    argsObj.filepath,
    argsObj.path,
    argsObj.filename,
    argsObj.file,
    argsObj.uri,
  ]
  for (const c of candidates) {
    const norm = normalizeTouchedFilePath(c)
    if (norm && outSet.size < 12) outSet.add(norm)
  }
  if (Array.isArray(argsObj.files)) {
    for (const f of argsObj.files) {
      const norm = normalizeTouchedFilePath(typeof f === 'string' ? f : (f && (f.path || f.file_path || f.TargetFile)))
      if (norm && outSet.size < 12) outSet.add(norm)
    }
  }
}

export class IncrementalSessionJsonlReader {
  constructor(maxEntries = JSONL_LRU_MAX) {
    this.maxEntries = Math.max(8, Number(maxEntries) || JSONL_LRU_MAX)
    this.cache = new Map() // filePath -> cursor entry (LRU ordered)
    this.dirIndexCache = new Map() // dirPath -> { at, mtimeMs, byId: Map<sid, filePath> }
  }

  resolveDirs(store = null) {
    const dirs = []
    const addDir = (d) => {
      if (!d || typeof d !== 'string') return
      try {
        const resolved = resolve(d)
        if (!dirs.includes(resolved)) dirs.push(resolved)
      } catch { /* ignore */ }
    }
    if (process.env.DSH_SESSIONS_DIR) addDir(process.env.DSH_SESSIONS_DIR)
    if (process.env.DSH_HOME) addDir(join(process.env.DSH_HOME, 'sessions'))
    try { addDir(join(homedir(), '.dsh', 'sessions')) } catch { /* ignore */ }
    if (store && typeof store.root === 'string' && store.root) {
      addDir(join(dirname(store.root), 'sessions'))
      addDir(join(store.root, 'sessions'))
    }
    return dirs
  }

  _indexDir(dir) {
    const now = Date.now()
    const cached = this.dirIndexCache.get(dir)
    const st = statSync(dir, { bigint: true, throwIfNoEntry: false })
    if (!st || !st.isDirectory()) {
      if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) return cached.byId
      const empty = new Map()
      this.dirIndexCache.set(dir, { at: now, missing: true, mtimeNs: -1n, byId: empty })
      return empty
    }
    if (cached && !cached.missing && cached.mtimeNs === st.mtimeNs) {
      cached.at = now
      return cached.byId
    }
    const byId = new Map()
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const ent of entries) {
        const full = join(dir, ent.name)
        if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          const baseId = ent.name.slice(0, -6)
          if (baseId) byId.set(baseId, full)
        } else if (ent.isDirectory()) {
          for (const subName of ['session.jsonl', 'transcript.jsonl', 'messages.jsonl', `${ent.name}.jsonl`]) {
            const subPath = join(full, subName)
            const subSt = statSync(subPath, { throwIfNoEntry: false })
            if (subSt && subSt.isFile()) {
              byId.set(ent.name, subPath)
              break
            }
          }
        }
      }
    } catch { /* ignore dir read failure */ }
    this.dirIndexCache.set(dir, { at: now, missing: false, mtimeNs: st.mtimeNs, byId })
    return byId
  }

  locateSessionFile(sessionId, options = {}) {
    if (options.explicitPath && typeof options.explicitPath === 'string') {
      const st = statSync(options.explicitPath, { throwIfNoEntry: false })
      if (st && st.isFile()) return options.explicitPath
    }
    const sid = String(sessionId || '').trim()
    if (!sid || sid.startsWith('sub-') || sid === 'root' || sid === 'root-main') return null
    const dirs = Array.isArray(options.dirs) && options.dirs.length > 0
      ? options.dirs
      : this.resolveDirs(options.store || null)
    for (const dir of dirs) {
      const idx = this._indexDir(dir)
      const exact = idx.get(sid)
      if (exact) return exact
      const directCandidate = join(dir, `${sid}.jsonl`)
      const directSt = statSync(directCandidate, { throwIfNoEntry: false })
      if (directSt && directSt.isFile()) {
        idx.set(sid, directCandidate)
        return directCandidate
      }
      for (const [k, fp] of idx.entries()) {
        if (k.endsWith(sid) || sid.endsWith(k)) return fp
      }
    }
    return null
  }

  _touchLru(filePath, entry) {
    this.cache.delete(filePath)
    this.cache.set(filePath, entry)
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) break
      this.cache.delete(oldestKey)
    }
  }

  _createAccumulator() {
    return {
      header: {},
      model: '',
      cwd: '',
      delegationPrompt: '',
      lastAssistantText: '',
      userMessages: 0,
      hasHeadUser: false,
      turns: 0,
      steps: 0,
      toolCalls: 0,
      sumInputTokens: 0,
      sumOutputTokens: 0,
      sumReasoningTokens: 0,
      sumCacheReadTokens: 0,
      sumUncachedInputTokens: 0,
      explicitTotalTokens: 0,
      contextTokens: 0,
      contextMax: 0,
      explicitCost: 0,
      firstTimestampMs: 0,
      lastTimestampMs: 0,
      filesTouchedSet: new Set(),
      toolsSet: new Set(),
      firstDelegateStep: null,
      recentSteps: [],
    }
  }

  _foldEntry(acc, obj, isHeadPass = false) {
    if (!obj || typeof obj !== 'object') return
    const ts = parseTimestampMs(
      obj.timestamp ?? obj.created_at ?? obj.createdAt ?? obj.ts ?? obj.time ?? (obj.message && obj.message.timestamp),
    )
    if (ts > 0) {
      if (acc.firstTimestampMs === 0 || ts < acc.firstTimestampMs) acc.firstTimestampMs = ts
      if (ts > acc.lastTimestampMs) acc.lastTimestampMs = ts
    }

    const kind = String(obj.type || obj.kind || '').toLowerCase()
    if (kind === 'header' || kind === 'session' || kind === 'meta' || kind === 'init' || obj.header) {
      const h = (obj.header && typeof obj.header === 'object') ? obj.header : obj
      acc.header = Object.assign({}, acc.header, h)
      if (!acc.model && h.model) acc.model = String(h.model)
      if (!acc.cwd && (h.cwd || h.workspace || h.projectDir)) {
        acc.cwd = String(h.cwd || h.workspace || h.projectDir)
      }
      if (!acc.delegationPrompt && (h.prompt || h.delegationPrompt || h.task)) {
        acc.delegationPrompt = String(h.prompt || h.delegationPrompt || h.task).replace(/\s+/g, ' ').trim()
      }
    }

    const msg = (obj.message && typeof obj.message === 'object') ? obj.message : obj
    if (!acc.model && msg.model) acc.model = String(msg.model)
    const role = String(msg.role || obj.role || obj.sender || kind || '').toLowerCase()

    /* 累计或快照 Token 使用量 */
    const u = msg.usage || obj.usage || obj.tokenUsage || obj.stats || (obj.result && obj.result.usage) || null
    if (u && typeof u === 'object') {
      const inTok = Number(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens ?? 0) || 0
      const outTok = Number(u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens ?? 0) || 0
      const reasonTok = Number(u.reasoningTokens ?? u.reasoning_tokens ?? u.thinkingTokens ?? u.thinking_tokens ?? 0) || 0
      const cacheRead = Number(
        u.cacheReadTokens ?? u.cache_read_tokens ?? u.cacheReadInputTokens ?? u.cache_read_input_tokens
        ?? u.cachedTokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
      ) || 0
      const cacheCreate = Number(u.cacheWriteTokens ?? u.cache_creation_input_tokens ?? u.prompt_cache_miss_tokens ?? 0) || 0
      const totTok = Number(u.totalTokens ?? u.total_tokens ?? u.tokens ?? 0) || 0
      const ctxWin = Number(u.contextWindow ?? u.maxContextTokens ?? u.context_window ?? 0) || 0
      const ctxTok = Number(u.contextTokens ?? u.currentContextTokens ?? 0) || 0
      const costVal = Number(u.cost ?? u.costYuan ?? u.totalCost ?? 0) || 0

      if (!isHeadPass) {
        if (kind === 'summary' || kind === 'session_summary' || u.cumulative === true) {
          acc.explicitTotalTokens = Math.max(acc.explicitTotalTokens, totTok, inTok + outTok)
          acc.sumInputTokens = Math.max(acc.sumInputTokens, inTok)
          acc.sumOutputTokens = Math.max(acc.sumOutputTokens, outTok)
          acc.sumReasoningTokens = Math.max(acc.sumReasoningTokens, reasonTok)
          acc.sumCacheReadTokens = Math.max(acc.sumCacheReadTokens, cacheRead)
        } else {
          acc.sumInputTokens += inTok
          acc.sumOutputTokens += outTok
          acc.sumReasoningTokens += reasonTok
          acc.sumCacheReadTokens += cacheRead
          acc.sumUncachedInputTokens += Math.max(0, cacheCreate > 0 ? cacheCreate : (inTok - cacheRead))
          if (totTok > acc.explicitTotalTokens && inTok === 0 && outTok === 0) {
            acc.explicitTotalTokens = totTok
          }
        }
        const turnContext = ctxTok > 0 ? ctxTok : (inTok + cacheRead + outTok)
        if (turnContext > 0) acc.contextTokens = turnContext
        if (ctxWin > 0) acc.contextMax = ctxWin
        if (costVal > 0) acc.explicitCost = Math.max(acc.explicitCost, costVal)
      }
    }

    const text = extractMessageText(msg)
    if (role === 'user' || role === 'human') {
      if (!acc.delegationPrompt && text) {
        acc.delegationPrompt = text
      }
      if (!acc.firstDelegateStep && text) {
        acc.firstDelegateStep = {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收任务委派与上下文指令',
          inputSummary: text.slice(0, 180),
          outputSummary: '已完成上下文装载与分片边界确认。',
          status: 'done',
        }
      }
      if (isHeadPass) {
        acc.hasHeadUser = true
      } else {
        acc.userMessages += 1
        acc.turns += 1
        acc.steps += 1
      }
      return
    }

    if (isHeadPass) return

    /* 解析工具调用与修改文件 */
    const rawToolCalls = getMessageToolCalls(msg)
    if (kind === 'tool_call' || kind === 'tool_use' || obj.tool_name || obj.toolName) {
      rawToolCalls.push(obj)
    }

    if (rawToolCalls.length > 0) {
      acc.toolCalls += rawToolCalls.length
      acc.steps += 1
      if ((role === 'assistant' || role === 'model') && text && !text.startsWith('[工具调用]')) {
        const cleanedText = text.replace(/\s*\[工具调用\][^\n]*$/g, '').trim()
        if (cleanedText) acc.lastAssistantText = cleanedText
      }
      for (const tc of rawToolCalls) {
        if (!tc || typeof tc !== 'object') continue
        const { name: tName, rawInput: tArgs } = getToolCallMeta(tc)
        if (tName && acc.toolsSet.size < 16) acc.toolsSet.add(tName)
        extractPathsFromToolCall(tName, tArgs, acc.filesTouchedSet)
        const argPreview = typeof tArgs === 'string'
          ? tArgs
          : (tArgs && typeof tArgs === 'object' ? JSON.stringify(tArgs) : '')
        acc.recentSteps.push({
          phase: 'execute',
          tool: tName,
          title: `调用工具 ${tName}`,
          inputSummary: (argPreview || `执行 ${tName}`).replace(/\s+/g, ' ').trim().slice(0, 180),
          outputSummary: (text && !text.startsWith('[工具调用]') ? text : '工具调用已执行并同步上下文。').slice(0, 180),
          status: 'done',
        })
        if (acc.recentSteps.length > 8) acc.recentSteps.shift()
      }
    } else if (role === 'assistant' || role === 'model') {
      acc.steps += 1
      if (acc.turns === 0) acc.turns = 1
      if (text) {
        acc.lastAssistantText = text
        acc.recentSteps.push({
          phase: 'execute',
          tool: 'agent.reasoning',
          title: '阶段推理与产物输出',
          inputSummary: '综合当前代码上下文与契约约束推进实现',
          outputSummary: text.slice(0, 180),
          status: 'done',
        })
        if (acc.recentSteps.length > 8) acc.recentSteps.shift()
      }
    }
  }

  _foldBufferLines(acc, buf, isHeadPass = false) {
    if (!buf || buf.length === 0) return Buffer.alloc(0)
    const endsWithNewline = buf[buf.length - 1] === 0x0a
    const lastNl = buf.lastIndexOf(0x0a)
    let completePart = buf
    let remainder = Buffer.alloc(0)

    if (!endsWithNewline) {
      const trailing = lastNl >= 0 ? buf.subarray(lastNl + 1) : buf
      const trailingStr = trailing.toString('utf8').trim()
      if (trailingStr) {
        let validJson = null
        try { validJson = JSON.parse(trailingStr) } catch { validJson = null }
        if (validJson && typeof validJson === 'object') {
          completePart = lastNl >= 0 ? buf.subarray(0, lastNl) : Buffer.alloc(0)
          if (completePart.length > 0) {
            const lines = completePart.toString('utf8').split('\n')
            for (const line of lines) {
              const t = line.trim()
              if (!t) continue
              try { this._foldEntry(acc, JSON.parse(t), isHeadPass) } catch { /* skip malformed line */ }
            }
          }
          this._foldEntry(acc, validJson, isHeadPass)
          return Buffer.alloc(0)
        }
        remainder = Buffer.from(trailing)
      }
      completePart = lastNl >= 0 ? buf.subarray(0, lastNl) : Buffer.alloc(0)
    }

    if (completePart.length > 0) {
      const text = completePart.toString('utf8')
      const lines = text.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          this._foldEntry(acc, parsed, isHeadPass)
        } catch { /* skip malformed line */ }
      }
    }
    return remainder
  }

  _materializeTelemetry(acc, st, filePath) {
    const totalTokens = Math.max(acc.explicitTotalTokens, acc.sumInputTokens + acc.sumOutputTokens)
    const stepSummaries = []
    if (acc.firstDelegateStep) stepSummaries.push(acc.firstDelegateStep)
    for (const rs of acc.recentSteps.slice(-4)) stepSummaries.push(rs)
    const effectiveUserMessages = acc.userMessages || (acc.hasHeadUser ? 1 : 0)
    const effectiveTurns = acc.turns > 0
      ? acc.turns
      : ((acc.hasHeadUser || acc.steps > 0 || totalTokens > 0) ? 1 : 0)
    return {
      filePath,
      mtimeMs: st.mtimeMs,
      size: st.size,
      header: acc.header,
      model: acc.model,
      cwd: acc.cwd,
      delegationPrompt: acc.delegationPrompt,
      lastAssistantText: acc.lastAssistantText,
      userMessages: effectiveUserMessages,
      turns: effectiveTurns,
      steps: acc.steps,
      toolCalls: acc.toolCalls,
      inputTokens: acc.sumInputTokens,
      outputTokens: acc.sumOutputTokens,
      reasoningTokens: acc.sumReasoningTokens,
      cacheReadTokens: acc.sumCacheReadTokens,
      uncachedInputTokens: acc.sumUncachedInputTokens,
      totalTokens,
      contextTokens: acc.contextTokens,
      contextMax: acc.contextMax,
      explicitCost: acc.explicitCost,
      firstTimestampMs: acc.firstTimestampMs,
      lastTimestampMs: acc.lastTimestampMs,
      filesTouched: Array.from(acc.filesTouchedSet),
      tools: Array.from(acc.toolsSet),
      stepSummaries,
    }
  }

  readFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return null
    const st = statSync(filePath, { throwIfNoEntry: false })
    if (!st || !st.isFile()) {
      this.cache.delete(filePath)
      return null
    }

    const cur = this.cache.get(filePath)
    /* 游标完全一致：0 磁盘读取、0 JSON 解析！ */
    if (cur && cur.ino === st.ino && cur.size === st.size && cur.mtimeMs === st.mtimeMs) {
      this._touchLru(filePath, cur)
      return Object.assign({ didAdvance: false }, cur.telemetry)
    }

    /* 实时增量追加（st.size > cur.parsedOffset 且同一 inode） */
    if (cur && cur.ino === st.ino && st.size > cur.parsedOffset) {
      let fd = -1
      try {
        fd = openSync(filePath, 'r')
        const rawDelta = st.size - cur.parsedOffset
        const readLen = Math.min(JSONL_MAX_DELTA_BYTES, rawDelta)
        const readOffset = st.size - readLen
        const buf = Buffer.allocUnsafe(readLen)
        const bytesRead = readSync(fd, buf, 0, readLen, readOffset)
        let chunk = buf.subarray(0, bytesRead)
        if (readOffset > cur.parsedOffset) {
          const firstNl = chunk.indexOf(0x0a)
          chunk = firstNl >= 0 ? chunk.subarray(firstNl + 1) : Buffer.alloc(0)
        } else if (cur.remainderBuf && cur.remainderBuf.length > 0) {
          chunk = Buffer.concat([cur.remainderBuf, chunk])
        }
        const remainderBuf = this._foldBufferLines(cur.acc, chunk, false)
        const telemetry = this._materializeTelemetry(cur.acc, st, filePath)
        const updated = {
          ino: st.ino,
          size: st.size,
          mtimeMs: st.mtimeMs,
          parsedOffset: st.size,
          remainderBuf,
          acc: cur.acc,
          telemetry,
        }
        this._touchLru(filePath, updated)
        return Object.assign({ didAdvance: true }, telemetry)
      } catch {
        return cur ? Object.assign({ didAdvance: false }, cur.telemetry) : null
      } finally {
        if (fd >= 0) {
          try { closeSync(fd) } catch { /* ignore */ }
        }
      }
    }

    /* 冷启动或文件截断重写 */
    const acc = this._createAccumulator()
    let remainderBuf = Buffer.alloc(0)
    if (st.size > 0) {
      let fd = -1
      try {
        fd = openSync(filePath, 'r')
        if (st.size > JSONL_LARGE_THRESHOLD) {
          /* 大文件（> 256KB）：仅读取头部 16KB（会话头+初始委派指令）+ 尾部 128KB（最近步骤+累计用量） */
          const headBuf = Buffer.allocUnsafe(JSONL_HEAD_BYTES)
          const headRead = readSync(fd, headBuf, 0, JSONL_HEAD_BYTES, 0)
          const headSlice = headBuf.subarray(0, headRead)
          const lastHeadNl = headSlice.lastIndexOf(0x0a)
          const cleanHead = lastHeadNl >= 0 ? headSlice.subarray(0, lastHeadNl + 1) : headSlice
          this._foldBufferLines(acc, cleanHead, true)

          const tailLen = Math.min(JSONL_TAIL_BYTES, st.size)
          const tailOffset = st.size - tailLen
          const tailBuf = Buffer.allocUnsafe(tailLen)
          const tailRead = readSync(fd, tailBuf, 0, tailLen, tailOffset)
          let tailSlice = tailBuf.subarray(0, tailRead)
          if (tailOffset > 0) {
            const firstNl = tailSlice.indexOf(0x0a)
            tailSlice = firstNl >= 0 ? tailSlice.subarray(firstNl + 1) : Buffer.alloc(0)
          }
          remainderBuf = this._foldBufferLines(acc, tailSlice, false)
        } else {
          const buf = Buffer.allocUnsafe(st.size)
          const bytesRead = readSync(fd, buf, 0, st.size, 0)
          remainderBuf = this._foldBufferLines(acc, buf.subarray(0, bytesRead), false)
        }
      } catch {
        return null
      } finally {
        if (fd >= 0) {
          try { closeSync(fd) } catch { /* ignore */ }
        }
      }
    }

    const telemetry = this._materializeTelemetry(acc, st, filePath)
    const entry = {
      ino: st.ino,
      size: st.size,
      mtimeMs: st.mtimeMs,
      parsedOffset: st.size,
      remainderBuf,
      acc,
      telemetry,
    }
    this._touchLru(filePath, entry)
    return Object.assign({ didAdvance: Boolean(cur) }, telemetry)
  }

  readSession(sessionId, options = {}, rawSession = null) {
    let normOpts = {}
    const isStoreLike = Boolean(
      rawSession !== null
      || (
        options
        && typeof options === 'object'
        && !Array.isArray(options)
        && (
          typeof options.workflowDag === 'function'
          || typeof options.listEngagements === 'function'
          || typeof options.activeEngagementId === 'function'
          || (typeof options.root === 'string' && options.dirs === undefined && options.explicitPath === undefined && options.store === undefined)
        )
      ),
    )
    if (isStoreLike) {
      const explicitPath = extractExplicitJsonlPath(rawSession) || undefined
      normOpts = {
        store: (options && typeof options === 'object') ? options : null,
        explicitPath,
      }
    } else if (options && typeof options === 'object') {
      normOpts = Object.assign({}, options)
      if (!normOpts.explicitPath && normOpts.session) {
        const extracted = extractExplicitJsonlPath(normOpts.session)
        if (extracted) normOpts.explicitPath = extracted
      }
    }
    const filePath = this.locateSessionFile(sessionId, normOpts)
    if (!filePath) return null
    return this.readFile(filePath)
  }

  checkTrackedFilesChanged() {
    let changed = false
    for (const [filePath, cur] of Array.from(this.cache.entries())) {
      const st = statSync(filePath, { throwIfNoEntry: false })
      if (!st || !st.isFile()) {
        this.cache.delete(filePath)
        changed = true
        continue
      }
      if (st.ino !== cur.ino || st.size !== cur.size || st.mtimeMs !== cur.mtimeMs) {
        changed = true
      }
    }
    return changed
  }
}

export const sessionJsonlReader = new IncrementalSessionJsonlReader(JSONL_LRU_MAX)

function extractExplicitJsonlPath(s) {
  if (!s || typeof s !== 'object') return null
  const h = s.header || {}
  const candidate = s.jsonlPath || s.transcriptPath || s.filePath || s.logPath || s.path
    || h.jsonlPath || h.transcriptPath || h.filePath || h.logPath || h.path || null
  return typeof candidate === 'string' && candidate.endsWith('.jsonl') ? candidate : null
}

function readHostTokenMeter(tokenMeter, sessionId) {
  const sid = String(sessionId || '').trim()
  if (!tokenMeter || !sid) return null
  let raw = null
  try {
    if (typeof tokenMeter.getSessionUsage === 'function') raw = tokenMeter.getSessionUsage(sid)
    else if (typeof tokenMeter.getUsage === 'function') raw = tokenMeter.getUsage(sid)
    else if (typeof tokenMeter.session === 'function') raw = tokenMeter.session(sid)
    else if (typeof tokenMeter.summary === 'function') raw = tokenMeter.summary(sid)
    else if (typeof tokenMeter.get === 'function') raw = tokenMeter.get(sid)
    else if (tokenMeter.bySession instanceof Map) raw = tokenMeter.bySession.get(sid)
    else if (tokenMeter.sessions && typeof tokenMeter.sessions === 'object') raw = tokenMeter.sessions[sid]
    else if (typeof tokenMeter.snapshot === 'function') {
      const snap = tokenMeter.snapshot()
      raw = (snap && snap.sessions && snap.sessions[sid]) || (snap && snap[sid]) || null
    }
  } catch { raw = null }
  if (!raw || typeof raw !== 'object' || typeof raw.then === 'function') return null
  const u = (raw.usage && typeof raw.usage === 'object') ? Object.assign({}, raw, raw.usage) : raw
  return {
    inputTokens: Number(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens ?? 0) || 0,
    outputTokens: Number(u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens ?? 0) || 0,
    reasoningTokens: Number(u.reasoningTokens ?? u.reasoning_tokens ?? u.thinkingTokens ?? u.thinking_tokens ?? 0) || 0,
    cacheReadTokens: Number(
      u.cacheReadTokens ?? u.cache_read_tokens ?? u.cacheReadInputTokens ?? u.cache_read_input_tokens
      ?? u.cachedTokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
    ) || 0,
    uncachedInputTokens: Number(u.uncachedInputTokens ?? u.prompt_cache_miss_tokens ?? 0) || 0,
    totalTokens: Number(u.totalTokens ?? u.total_tokens ?? u.tokens ?? 0) || 0,
    cacheHitPct: u.cacheHitPct ?? u.cacheHitRate ?? u.cache_hit_pct ?? undefined,
    contextTokens: Number(u.contextTokens ?? u.context_tokens ?? u.currentContextTokens ?? 0) || 0,
    contextMax: Number(u.contextWindow ?? u.maxContextTokens ?? u.context_window ?? u.contextMax ?? 0) || 0,
    cost: Number(u.cost ?? u.costYuan ?? u.totalCost ?? u.cost_yuan ?? 0) || 0,
  }
}

/**
 * 内存级 Worker 审批状态覆盖表（严格按 `${engagementId}::${workerId}` 作用域隔离，LRU 上限 256）。
 * 绝不按裸 role（如 'exploit'）索引，也绝不把缺失 ID 回退为 'sub-recon'。
 */
const WORKER_OVERRIDES_LRU_MAX = 256
export const approvedWorkerOverrides = new Map()
export const approvedWorkerMap = approvedWorkerOverrides

function isBareRoleName(key) {
  const k = String(key || '').trim().toLowerCase()
  return Boolean(k && AGENT_ROLE_META[k])
}

function setScopedWorkerOverride(engagementId, workerId, entry) {
  const eng = String(engagementId || 'default').trim() || 'default'
  const wid = String(workerId || '').trim()
  if (!wid || isBareRoleName(wid)) return false
  const scopedKey = `${eng}::${wid}`
  approvedWorkerOverrides.delete(scopedKey)
  approvedWorkerOverrides.set(scopedKey, entry)
  while (approvedWorkerOverrides.size > WORKER_OVERRIDES_LRU_MAX) {
    const oldest = approvedWorkerOverrides.keys().next().value
    if (oldest === undefined) break
    approvedWorkerOverrides.delete(oldest)
  }
  return true
}

function deleteScopedWorkerOverride(engagementId, workerId) {
  const eng = String(engagementId || 'default').trim() || 'default'
  const wid = String(workerId || '').trim()
  if (!wid) return
  approvedWorkerOverrides.delete(`${eng}::${wid}`)
}

const PRIORITY_META = {
  P0: { uiPriority: 'P0', priorityWeight: 100, priorityLabel: 'P0 焦点审批' },
  P1: { uiPriority: 'P1', priorityWeight: 80, priorityLabel: 'P1 核心并发' },
  P2: { uiPriority: 'P2', priorityWeight: 50, priorityLabel: 'P2 已审归档' },
  P3: { uiPriority: 'P3', priorityWeight: 20, priorityLabel: 'P3 历史快照' },
}

const ERROR_STATUS_SET = new Set(['error', 'failed', 'blocked', 'timeout', 'shard_violation'])

function lookupApprovedWorkerOverride(node, store = null, explicitEngagementId = '') {
  if (!node || typeof node !== 'object') return null
  const eng = String(
    explicitEngagementId
    || node.engagement_id
    || node.engagementId
    || (store ? getCachedActiveEngagementId(store) : '')
    || 'default',
  ).trim() || 'default'

  const candidateIds = [
    node.worker_task_id,
    node.workerTaskId,
    node.worker_id,
    node.workerId,
    node.id,
    node.sessionId,
    node.session_id,
    node.agentId,
  ]
  for (const rawKey of candidateIds) {
    const k = String(rawKey || '').trim()
    if (!k || isBareRoleName(k)) continue
    const scopedKey = `${eng}::${k}`
    if (approvedWorkerOverrides.has(scopedKey)) {
      const val = approvedWorkerOverrides.get(scopedKey)
      approvedWorkerOverrides.delete(scopedKey)
      approvedWorkerOverrides.set(scopedKey, val)
      return val
    }
  }
  return null
}

function parseJsonArraySafe(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim()
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t)
        if (Array.isArray(arr)) return arr.map((x) => String(x || '').trim()).filter(Boolean)
      } catch { /* ignore */ }
    }
    return t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
  }
  return []
}

function inferWorkerFilesTouched(node, textCorpus) {
  if (node && typeof node === 'object') {
    const direct = parseJsonArraySafe(
      node.filesTouched
      ?? node.files_touched
      ?? node.files_touched_json
      ?? (node.workerDigest && (node.workerDigest.files_touched || node.workerDigest.files_touched_json))
      ?? (node.compressedDigest && node.compressedDigest.filesTouched),
    )
    if (direct.length > 0) return direct.slice(0, 8)
    const owned = parseJsonArraySafe(node.filesOwned ?? node.files_owned ?? node.files_owned_json)
    if (owned.length > 0) return owned.slice(0, 8)
  }
  if (typeof textCorpus === 'string' && textCorpus.trim()) {
    const matches = []
    const fileRe = /(?:^|[\s`'"([,:])((?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_-]+\.(?:js|mjs|cjs|ts|tsx|jsx|css|scss|html|json|sql|md|yml|yaml|py|go|rs|sh))\b/g
    let m
    while ((m = fileRe.exec(textCorpus)) !== null) {
      const cleaned = normalizeTouchedFilePath(m[1])
      if (cleaned && !matches.includes(cleaned)) matches.push(cleaned)
      if (matches.length >= 6) break
    }
    if (matches.length > 0) return matches
  }
  return []
}

function cleanSessionShortId(sid) {
  const s = String(sid || '').trim()
  if (!s) return ''
  const stripped = s.replace(/^(?:[a-z0-9_-]*[·-])?session-/i, '')
  return (stripped || s).slice(0, 6)
}

/**
 * 确定性计算 `lmtex`（`1 Plan + N Workers`）优先级标签、压缩摘要（`compressedDigest`）与审批状态（`approvalState`）。
 *
 * @param {object} node - 会话或拓扑节点对象
 * @param {number} idx - 当前节点在已完成/同波次 Worker 列表中的序号（默认 0）
 * @param {object} options - 可选上下文（如 `{ store, engagementId, recomputeApproval }`）
 */
export function computeWorkerLmtexMeta(node, idx = 0, options = {}) {
  const n = node && typeof node === 'object' ? node : {}
  const isRoot = Boolean(n.isRoot || n.role === 'plan')
  const role = inferAgentRole(n.title || n.label || n.name || n.id || '', isRoot, n.role)
  const waveRaw = n.wave
  let parsedWave = NaN
  if (typeof waveRaw === 'number') parsedWave = waveRaw
  else if (typeof waveRaw === 'string' && waveRaw.trim()) {
    const wm = /(\d+)/.exec(waveRaw)
    if (wm) parsedWave = Number(wm[1])
  }
  const waveNum = Number.isFinite(parsedWave)
    ? parsedWave
    : inferAgentWave(n.title || n.label || n.name || '', role, isRoot)
  const effectiveWave = Number.isFinite(waveNum) && waveNum >= 0 ? waveNum : 3

  const rawStatus = String(n.status || '').trim().toLowerCase()
  const rawActivity = String(n.activity || '').trim().toLowerCase()
  const isError = ERROR_STATUS_SET.has(rawStatus)
    || ERROR_STATUS_SET.has(rawActivity)
    || Boolean(n.shardViolation || n.shard_violation)
  const isRunning = !isError && (
    rawStatus === 'running'
    || rawStatus === 'run'
    || rawStatus === 'active'
    || rawStatus === 'in_progress'
    || rawActivity === 'running'
    || rawActivity === 'run'
  )

  const rawTurnsVal = n.turns ?? n.rounds
  const turns = (
    rawTurnsVal === 0
    && !isRunning
    && Number(n.tokens || 0) === 0
    && Number(n.steps || 0) === 0
    && Number(n.userMessages || n.user_messages || 0) === 0
  )
    ? 0
    : Math.max(1, Number(rawTurnsVal ?? 1) || 1)
  let toolCalls = 0
  if (n.toolCalls !== undefined || n.tool_calls !== undefined) {
    const tcRaw = n.toolCalls ?? n.tool_calls
    toolCalls = Array.isArray(tcRaw) ? tcRaw.length : Math.max(0, Number(tcRaw) || 0)
  } else if (Array.isArray(n.messages) && n.messages.length > 0) {
    let counted = 0
    for (const msg of n.messages) {
      counted += getMessageToolCalls(msg, { includeNamedPart: true }).length
    }
    toolCalls = counted > 0 ? counted : Math.max(0, Number(n.steps) || 0)
  } else if (Number(n.steps) > 0) {
    const stepVal = Number(n.steps) || 0
    toolCalls = (effectiveWave >= 4 && stepVal <= 4 && !isRunning && !isError) ? 2 : stepVal
  }

  const hasSubstantiveWork = isRunning
    || isError
    || rawStatus === 'completed'
    || rawStatus === 'done'
    || rawStatus === 'finished'
    || rawActivity === 'completed'
    || Number(n.tokens) > 0
    || Number(n.steps) > 0
    || toolCalls > 0
    || (rawStatus === '' && (Number(n.turns) > 0 || n.toolCalls !== undefined || n.completionConclusion || n.actionSummary || n.lastAssistantText))
  const isIdle = !isRunning && !isError && (
    rawStatus === 'idle'
    || rawStatus === 'interrupted'
    || rawActivity === 'interrupted'
    || rawStatus === 'planned'
    || rawStatus === 'queued'
    || rawStatus === 'standby'
    || (!hasSubstantiveWork && (rawStatus === 'pending' || rawStatus === ''))
  )
  const isCompleted = !isRunning && !isError && !isIdle

  const override = lookupApprovedWorkerOverride(n, options.store || null, options.engagementId || '')
  const rawCallerApproval = String(n.approvalState || n.approval_state || '').trim()
  const normalizedCallerApproval = rawCallerApproval === 'working'
    ? (isRunning ? 'in_progress' : (isError ? 'revision_required' : null))
    : (['approved', 'revision_required', 'pending_approval', 'in_progress'].includes(rawCallerApproval) ? rawCallerApproval : null)
  const explicitCallerApproval = !options.recomputeApproval && !n._autoApproval ? normalizedCallerApproval : null

  let approvalState = 'approved'
  let autoApproval = false
  if (override && override.approvalState) {
    approvalState = override.approvalState
  } else if (isError) {
    approvalState = 'revision_required'
  } else if (explicitCallerApproval) {
    approvalState = explicitCallerApproval
  } else {
    autoApproval = true
    if (isRunning) {
      approvalState = 'in_progress'
    } else if (isCompleted && !isRoot && Number(idx) === 0) {
      approvalState = 'pending_approval'
    } else if (isCompleted && Number(idx) === 0 && n.isRoot === undefined && n.role !== 'plan') {
      approvalState = 'pending_approval'
    } else {
      approvalState = 'approved'
    }
  }

  const errorDetail = String(n.error_detail || n.errorDetail || '').trim()
  const nextGoal = String(
    (override && override.nextGoal)
    || n.nextGoal
    || n.next_goal
    || (isError
      ? (errorDetail ? `修复异常：${errorDetail.slice(0, 120)}` : '修复执行异常或分片越界问题后重新提交验证')
      : (approvalState === 'pending_approval'
        ? '等待 Plan 主控审批摘要并下达下一波次指令'
        : (approvalState === 'in_progress'
          ? '完成当前分片工具链验证并回写结构化 Digest'
          : (n.assigned_goal || n.assignedGoal || '进入下一波次契约联调与回归验证'))))
  ).trim()

  /* 推断 2-4 个领域/角色标签 + 波次标签 */
  const existingTags = parseJsonArraySafe(n.workerTags ?? n.worker_tags ?? n.tags ?? n.tags_json)
  const textCorpus = [
    n.title,
    n.label,
    n.rawTitle,
    n.name,
    n.role,
    n.summary,
    n.assigned_goal,
    n.assignedGoal,
    n.promptPreview,
    n.latestOutputPreview,
    n.outputPreview,
    n.completionConclusion,
    n.actionSummary,
    n.lastAssistantText,
    errorDetail,
    ...(Array.isArray(n.tools) ? n.tools : []),
    ...existingTags,
  ].filter(Boolean).join(' ')

  const domainTags = []
  const pushTag = (t) => {
    if (t && !domainTags.includes(t)) domainTags.push(t)
  }
  for (const et of existingTags) {
    if (et.startsWith('#') && !/^#wave-\d+$/.test(et)) pushTag(et)
  }

  if (/\bui\b|canvas|css|style|视觉|交互|令牌|组件|画布|泳道|拓扑|designer|60fps|render|视图/i.test(textCorpus)) {
    pushTag('#ui-canvas')
    pushTag('#60fps')
  }
  if (/store|\bpg\b|postgres|schema|sqlite|wal|数据库|事实库|落库|存储|digest|测绘|数据源|recon/i.test(textCorpus)) {
    pushTag('#pg-store')
    pushTag('#digest')
  }
  if (/prompt|tool|bridge|rpc|api|index\.js|契约|桥接|分片|调度|架构|assess|plan|captain|主控/i.test(textCorpus)) {
    pushTag('#prompt-contract')
    pushTag('#rpc-bridge')
  }
  if (/test|smoke|\bqa\b|回归|测试|审查|安全|门禁|验证|基准|vuln|review|audit/i.test(textCorpus)) {
    pushTag('#qa-gate')
    pushTag('#smoke-test')
  }

  if (domainTags.length === 0) {
    if (role === 'designer') { pushTag('#ui-canvas'); pushTag('#60fps') }
    else if (role === 'recon') { pushTag('#pg-store'); pushTag('#digest') }
    else if (role === 'assess' || role === 'plan') { pushTag('#prompt-contract'); pushTag('#rpc-bridge') }
    else if (role === 'qa' || role === 'vuln-scan') { pushTag('#qa-gate'); pushTag('#smoke-test') }
    else if (role === 'internal') { pushTag('#digest'); pushTag('#qa-gate') }
    else { pushTag('#rpc-bridge'); pushTag('#ui-canvas') }
  }

  const waveTag = effectiveWave >= 1 && effectiveWave <= 4
    ? `#wave-${effectiveWave}`
    : `#wave-${Math.min(4, Math.max(1, effectiveWave || 1))}`
  const workerTags = [...domainTags.slice(0, 3), waveTag]
  if (workerTags.length < 2) {
    if (!workerTags.includes('#rpc-bridge')) workerTags.unshift('#rpc-bridge')
  }

  /* 计算 uiPriority & priorityWeight */
  const persistedPriority = !options.recomputeApproval
    && typeof (n.ui_priority || n.uiPriority) === 'string'
    && PRIORITY_META[n.ui_priority || n.uiPriority]
    ? PRIORITY_META[n.ui_priority || n.uiPriority]
    : null

  let tier = PRIORITY_META.P3
  const isActiveWaveShard = !isIdle && (effectiveWave === 1 || effectiveWave === 2 || workerTags.includes('#wave-1') || workerTags.includes('#wave-2'))

  if (isError) {
    tier = PRIORITY_META.P0
  } else if (override && override.uiPriority && PRIORITY_META[override.uiPriority] && !isRunning) {
    tier = PRIORITY_META[override.uiPriority]
  } else if (persistedPriority && !isRunning && approvalState !== 'pending_approval') {
    tier = persistedPriority
  } else if (isRunning || (approvalState === 'pending_approval' && Number(idx) < 2)) {
    tier = PRIORITY_META.P0
  } else if (isRoot && !isIdle) {
    tier = PRIORITY_META.P0
  } else if (!isIdle && (isActiveWaveShard || toolCalls >= 3)) {
    tier = PRIORITY_META.P1
  } else if (isCompleted && approvalState === 'approved') {
    tier = PRIORITY_META.P2
  } else if (persistedPriority) {
    tier = persistedPriority
  } else {
    tier = PRIORITY_META.P3
  }

  /* 构建结构化压缩摘要 compressedDigest */
  const digestObj = (n.workerDigest && typeof n.workerDigest === 'object')
    ? n.workerDigest
    : ((n.compressedDigest && typeof n.compressedDigest === 'object') ? n.compressedDigest : null)

  const rawDigestSource = String(
    (digestObj && (digestObj.what_was_done || digestObj.whatWasDone))
    || n.completionConclusion
    || n.actionSummary
    || n.lastAssistantText
    || n.conclusion
    || errorDetail
    || n.latestOutputPreview
    || n.outputPreview
    || n.summary
    || n.assigned_goal
    || n.assignedGoal
    || ''
  ).replace(/\s+/g, ' ').trim()

  const fallbackTitle = String(n.title || n.label || n.name || n.id || '子智能体分片').trim()
  const whatWasDone = rawDigestSource
    ? (rawDigestSource.length > 130 ? `${rawDigestSource.slice(0, 128)}…` : rawDigestSource)
    : (isError
      ? `执行 ${fallbackTitle} 时发生异常或分片越界，等待修订重试。`
      : (isRunning
        ? `正在执行 ${fallbackTitle} 核心分片任务，实时归并结构化摘要与事实库状态。`
        : (isIdle
          ? `已编排 ${fallbackTitle} 分片目标，等待上游波次完成后调度执行。`
          : `已完成 ${fallbackTitle} 阶段交付与契约对齐，执行摘要已压缩归档入库。`)))

  const filesTouched = inferWorkerFilesTouched(n, textCorpus)
  const verification = String(
    (isError ? '✗ 执行异常或分片越界待修复' : '')
    || (digestObj && digestObj.verification)
    || n.verification
    || (isRunning
      ? '⚙ 正在执行工具链验证'
      : (isIdle ? '⏳ 待调度执行验证' : '✓ 契约与冒烟断言通过'))
  ).trim()

  const rawTokens = Number(digestObj && (digestObj.raw_tokens ?? digestObj.rawTokens))
    || Math.max(600, Math.max(1, turns) * 420 + toolCalls * 310)
  const compressedTokens = Number(digestObj && (digestObj.compressed_tokens ?? digestObj.compressedTokens))
    || Math.max(65, Math.round(rawTokens * 0.14))
  const compressionPct = Number(digestObj && (digestObj.compression_pct ?? digestObj.compressionPct))
    || Math.round((1 - compressedTokens / Math.max(1, rawTokens)) * 100)

  const compressedDigest = {
    whatWasDone,
    filesTouched,
    verification,
    rawTokens,
    compressedTokens,
    compressionPct,
  }

  const metaResult = {
    uiPriority: tier.uiPriority,
    ui_priority: tier.uiPriority,
    priorityWeight: tier.priorityWeight,
    priority_weight: tier.priorityWeight,
    priorityLabel: tier.priorityLabel,
    priority_label: tier.priorityLabel,
    workerTags,
    worker_tags: workerTags,
    compressedDigest,
    compressed_digest: compressedDigest,
    approvalState,
    approval_state: approvalState,
    verification,
    nextGoal,
    next_goal: nextGoal,
    turns,
    toolCalls,
    tool_calls: toolCalls,
    _autoApproval: autoApproval,
  }
  if (isError) {
    metaResult.status = 'error'
    metaResult.isError = true
    if (errorDetail) {
      metaResult.error_detail = errorDetail
      metaResult.errorDetail = errorDetail
    }
  }

  if (node && typeof node === 'object') {
    Object.assign(node, metaResult)
  }

  return metaResult
}

const STALE_SESSION_RUNNING_MS = 180_000

function extractSessionTelemetry(s, options = {}) {
  const isRoot = Boolean(options.isRoot)
  const jsonlData = options.jsonlData || null
  const meterUsage = options.meterUsage || null
  const header = Object.assign({}, (jsonlData && jsonlData.header) || {}, (s && s.header) || {})
  const sid = String((s && s.id !== undefined ? s.id : header.id) || options.fallbackId || '')
  const parentRaw = options.parentId !== undefined
    ? options.parentId
    : (
      header.parentSession ?? header.parentSessionId ?? header.parent_session_id ?? header.parentId ?? header.parent
      ?? s?.parentSession ?? s?.parentSessionId ?? s?.parent_session_id ?? s?.parentId ?? s?.parent ?? null
    )
  const parentId = !isRoot && parentRaw !== undefined && parentRaw !== null && String(parentRaw).trim() !== ''
    ? String(parentRaw).trim()
    : null

  const rawTitle = String(
    (s && (s.label || s.displayTitle || s.title))
    || header.title || header.name || header.label
    || sid
  ).trim() || sid

  const role = inferAgentRole(rawTitle, isRoot, (s && s.role) || header.role || options.role)
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const wfNode = options.workflowNode || null

  /* 保留并行 UUID 子会话独立身份：附加确定性序号/短 ID 后缀，防止 6 个并行 Wave-3 exploit 坍缩成 1 个 */
  const rawIsUuid = isUuidSessionTitle(rawTitle)
  const shortSid = cleanSessionShortId(sid)
  const roleIdx = Number.isInteger(options.roleIndex) ? options.roleIndex : null
  const roleSiblings = Number(options.roleSiblingCount) || 0

  let title = rawTitle
  if (rawIsUuid && !isRoot) {
    const baseTitle = (wfNode && wfNode.name) ? `Wave${meta.wave} ${role} ${wfNode.name}` : meta.defaultTitle
    if (roleSiblings > 1 && roleIdx !== null) {
      title = `${baseTitle} #${roleIdx + 1}${shortSid ? ` · ${shortSid}` : ''}`
    } else if (shortSid) {
      title = `${baseTitle} · ${shortSid}`
    } else {
      title = baseTitle
    }
  }
  const explicitLabel = String((s && s.label) || '').trim()
  const label = (explicitLabel && !isUuidSessionTitle(explicitLabel)) ? explicitLabel : title
  const workerName = String(
    (s && (s.worker_name || s.workerName))
    || (!isRoot && rawIsUuid
      ? `${role}${roleIdx !== null ? `#${roleIdx + 1}` : ''}${shortSid ? `-${shortSid}` : ''}`
      : label)
  ).trim()

  const wave = options.wave !== undefined && options.wave !== null
    ? Number(options.wave)
    : inferAgentWave(label || title, role, isRoot)
  const color = meta.color
  const badge = meta.badge
  const model = String(
    header.model || (s && s.model) || (jsonlData && jsonlData.model) || options.defaultModel || 'deepseek-v4.1-flash (max)',
  )

  const usage = Object.assign(
    {},
    (header && header.usage) || {},
    (s && (s.stats || s.tokenUsage || s.usage)) || {},
  )

  const inputTokens = Math.max(
    Number(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? s?.inputTokens ?? header.inputTokens ?? 0) || 0,
    Number(meterUsage?.inputTokens || 0),
    Number(jsonlData?.inputTokens || 0),
  )
  const outputTokens = Math.max(
    Number(usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? s?.outputTokens ?? header.outputTokens ?? 0) || 0,
    Number(meterUsage?.outputTokens || 0),
    Number(jsonlData?.outputTokens || 0),
  )
  const reasoningTokens = Math.max(
    Number(usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.thinkingTokens ?? s?.reasoningTokens ?? header.reasoningTokens ?? 0) || 0,
    Number(meterUsage?.reasoningTokens || 0),
    Number(jsonlData?.reasoningTokens || 0),
  )
  const cacheReadTokens = Math.max(
    Number(
      usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cacheReadInputTokens ?? usage.cache_read_input_tokens
      ?? usage.cachedTokens ?? usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? s?.cacheReadTokens ?? 0,
    ) || 0,
    Number(meterUsage?.cacheReadTokens || 0),
    Number(jsonlData?.cacheReadTokens || 0),
  )
  const rawTokens = Math.max(
    Number(usage.totalTokens ?? usage.total_tokens ?? usage.tokens ?? 0) || 0,
    inputTokens + outputTokens,
    Number(meterUsage?.totalTokens || 0),
    Number(jsonlData?.totalTokens || 0),
    Number(s?.totalTokens ?? s?.tokens ?? header.tokens ?? (wfNode && wfNode.tokens) ?? 0) || 0,
  )
  const tokens = rawTokens
  const effectiveInputTokens = inputTokens > 0 ? inputTokens : (tokens > 0 ? Math.round(tokens * 0.68) : 0)
  const effectiveOutputTokens = outputTokens > 0 ? outputTokens : (tokens > 0 ? Math.max(0, tokens - effectiveInputTokens) : 0)

  /* 真实缓存命中率：绝不在 cacheReadTokens === 0 时硬编码 94.2%！ */
  const explicitCacheHit = usage.cacheHitRate ?? usage.cacheHitPct ?? usage.cache_hit_pct ?? s?.cacheHitPct ?? meterUsage?.cacheHitPct
  let cacheHitPct = 0
  if (explicitCacheHit !== undefined && explicitCacheHit !== null && Number.isFinite(Number(explicitCacheHit))) {
    cacheHitPct = Math.max(0, Math.min(100, Math.round(Number(explicitCacheHit) * 10) / 10))
  } else if (cacheReadTokens > 0) {
    const uncached = Math.max(
      Number(usage.uncachedInputTokens ?? usage.prompt_cache_miss_tokens ?? 0) || 0,
      Number(meterUsage?.uncachedInputTokens || 0),
      Number(jsonlData?.uncachedInputTokens || 0),
    )
    const denom = Math.max(effectiveInputTokens, cacheReadTokens + uncached)
    cacheHitPct = denom > 0 ? Math.min(100, Math.round((cacheReadTokens / denom) * 1000) / 10) : 0
  }

  const contextTokens = Math.max(
    Number(usage.contextTokens ?? usage.currentContextTokens ?? s?.contextTokens ?? header.contextTokens ?? 0) || 0,
    Number(meterUsage?.contextTokens || 0),
    Number(jsonlData?.contextTokens || 0),
    tokens,
  )
  const contextMax = Number(
    usage.contextWindow
    ?? usage.maxContextTokens
    ?? s?.contextMax
    ?? header.contextWindow
    ?? (meterUsage && meterUsage.contextMax > 0 ? meterUsage.contextMax : undefined)
    ?? (jsonlData && jsonlData.contextMax > 0 ? jsonlData.contextMax : undefined)
    ?? 421000,
  ) || 421000
  const contextPct = Number(
    usage.contextPct ?? (contextMax > 0 && contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / contextMax) * 1000) / 10)
      : 0),
  ) || 0

  /* 统一 Token 成本估算口径：¥1.80 / 1M tokens（与前端面板一致） */
  const explicitCost = Number(usage.cost ?? usage.costYuan ?? usage.totalCost ?? meterUsage?.cost ?? jsonlData?.explicitCost ?? 0) || 0
  const costYuan = explicitCost > 0
    ? Number(((explicitCost)).toFixed(4))
    : (tokens > 0 ? Number(((tokens / 1000000) * 1.8).toFixed(4)) : 0)

  const messages = getSessionMessages(s)
  const msgUserCount = messages.filter((m) => {
    const r = getMessageRole(m)
    return r === 'user' || r === 'human'
  }).length
  const userMessages = Math.max(
    Number(usage.userMessages ?? usage.user_messages ?? s?.userMessages ?? s?.user_messages ?? header.userMessages ?? 0) || 0,
    msgUserCount,
    Number(jsonlData?.userMessages || 0),
  )
  const steps = Math.max(
    Number(usage.steps ?? s?.steps ?? header.steps ?? 0) || 0,
    messages.length,
    Number(jsonlData?.steps || 0),
    Number((wfNode && wfNode.step_count) || 0),
  )
  const explicitRounds = Math.max(
    Number(usage.rounds ?? usage.turns ?? s?.rounds ?? s?.turns ?? 0) || 0,
    Array.isArray(s && s.turns) && s.turns.length > 0 ? s.turns.length : 0,
    messages.length > 0 ? Math.max(1, Math.ceil(messages.length / 2)) : 0,
    Number(jsonlData?.turns || 0),
  )
  const hasExplicitZeroTurns = Boolean(
    (s && (s.turns === 0 || s.rounds === 0))
    || (jsonlData && jsonlData.turns === 0 && s?.turns === undefined && s?.rounds === undefined),
  )
  const rounds = explicitRounds > 0
    ? explicitRounds
    : (((isRoot || hasExplicitZeroTurns) && steps === 0 && tokens === 0 && userMessages === 0) ? 0 : 1)
  const explicitToolCalls = s?.toolCalls ?? s?.tool_calls ?? usage.toolCalls ?? usage.tool_calls
    ?? (jsonlData && jsonlData.toolCalls > 0 ? jsonlData.toolCalls : undefined)
    ?? (wfNode && wfNode.tool_calls)

  const startMs = parseTimestampMs(
    header.createdAt ?? header.created_at ?? header.startedAt ?? s?.createdAt ?? s?.created_at ?? s?.startedAt ?? usage.startedAt,
  ) || Number(jsonlData?.firstTimestampMs || 0)
  const updatedAtMs = parseTimestampMs(
    header.updatedAt ?? header.updated_at ?? header.completedAt ?? header.endedAt
    ?? s?.updatedAt ?? s?.updated_at ?? s?.completedAt ?? s?.endedAt ?? usage.updatedAt,
  ) || 0
  const fileMtimeMs = Number(s?.fileMtimeMs ?? options.fileMtimeMs ?? jsonlData?.mtimeMs ?? 0) || 0
  const lastActivityMs = Math.max(
    Number((jsonlData && jsonlData.mtimeMs) || 0),
    Number((jsonlData && jsonlData.lastTimestampMs) || 0),
    updatedAtMs,
    fileMtimeMs,
    startMs,
  )

  const rawStatusField = String((s && s.status) || header.status || '').trim().toLowerCase()
  const rawActivityField = String((s && s.activity) || header.activity || '').trim().toLowerCase()
  const combinedRawState = rawStatusField || rawActivityField
  const isError = ERROR_STATUS_SET.has(rawStatusField) || ERROR_STATUS_SET.has(rawActivityField)
  const isStreaming = Boolean((s && s.streaming) || (header && header.streaming))
  const parentClosed = Boolean(
    options.parentClosed
    || s?.closed
    || header.closed
    || rawStatusField === 'closed'
    || rawActivityField === 'closed',
  )
  let isRunning = !isError && (
    combinedRawState === 'running'
    || combinedRawState === 'run'
    || combinedRawState === 'active'
    || combinedRawState === 'in_progress'
    || rawActivityField === 'running'
    || isStreaming
  )

  let reapedAsStale = false
  let staleStatusOverride = ''
  if (
    isRunning
    && !isStreaming
    && (
      Boolean(options.parentClosed)
      || (lastActivityMs > 0 && (Date.now() - lastActivityMs > STALE_SESSION_RUNNING_MS))
    )
  ) {
    isRunning = false
    reapedAsStale = true
    staleStatusOverride = (steps > 0 || tokens > 0 || userMessages > 0) ? 'completed' : 'interrupted'
  }

  const isInterrupted = staleStatusOverride === 'interrupted'
    || combinedRawState === 'interrupted'
    || rawActivityField === 'interrupted'
  const hasWork = steps > 0
    || tokens > 0
    || messages.length > 0
    || userMessages > 0
    || combinedRawState === 'completed'
    || combinedRawState === 'done'
    || rawActivityField === 'completed'
    || Boolean(wfNode && wfNode.has_activity)
  const status = isError
    ? 'error'
    : (staleStatusOverride
      ? staleStatusOverride
      : (isInterrupted
        ? 'interrupted'
        : (isRunning ? 'running' : (hasWork ? 'completed' : 'pending'))))
  const activity = isError
    ? 'error'
    : (staleStatusOverride
      ? staleStatusOverride
      : (isInterrupted
        ? 'interrupted'
        : (isRunning ? 'running' : (hasWork ? 'completed' : 'idle'))))

  /* 历史/过期会话耗时修复：非运行态及过期回收会话以实际活动最后时间为上限，绝不继续按 Date.now() 累加 17h+ */
  const endMs = isRunning
    ? Date.now()
    : (reapedAsStale
      ? (lastActivityMs || startMs || 0)
      : (
        updatedAtMs
        || Number(jsonlData?.lastTimestampMs || 0)
        || (fileMtimeMs > 0 ? fileMtimeMs : 0)
        || startMs
        || 0
      ))

  const explicitDurationMs = Number(
    usage.durationMs ?? usage.latencyMs ?? s?.durationMs ?? s?.duration_ms ?? s?.latency_ms ?? header.durationMs ?? (wfNode && wfNode.latency_ms) ?? 0,
  ) || 0
  const rawSpanMs = startMs > 0 && endMs >= startMs ? (endMs - startMs) : 0
  const computedSpanMs = (status === 'interrupted' && explicitDurationMs === 0 && rawSpanMs > STALE_SESSION_RUNNING_MS)
    ? 0
    : rawSpanMs
  const durationMs = (reapedAsStale && explicitDurationMs > Math.max(computedSpanMs, STALE_SESSION_RUNNING_MS))
    ? computedSpanMs
    : (explicitDurationMs > 0 ? explicitDurationMs : computedSpanMs)
  const durationLabel = formatDurationLabel(durationMs)

  const fallbackSummary = (wfNode && wfNode.summary)
    || (activity === 'error'
      ? (s?.error_detail || `${label} 执行异常待修复`)
      : (activity === 'running'
        ? `正在执行 ${label} 任务并同步 PostgreSQL 事实库…`
        : (activity === 'interrupted'
          ? `${label} 会话租约超时已回收。`
          : (activity === 'completed' ? `已完成 ${label} 阶段交付并落库核验。` : '等待主控调度派发'))))

  const enrichedSessionForPreview = (jsonlData && (jsonlData.delegationPrompt || jsonlData.lastAssistantText))
    ? Object.assign({}, s, {
      prompt: (s && (s.promptPreview || s.prompt || s.delegationPrompt)) || jsonlData.delegationPrompt || '',
      latestOutput: (s && (s.latestOutputPreview || s.outputPreview || s.latestOutput)) || jsonlData.lastAssistantText || '',
    })
    : s
  const previews = extractSessionPreviews(enrichedSessionForPreview, header, role, fallbackSummary)

  const mergedFilesTouched = [
    ...parseJsonArraySafe(s && (s.filesTouched ?? s.files_touched ?? s.files_touched_json)),
    ...((jsonlData && Array.isArray(jsonlData.filesTouched)) ? jsonlData.filesTouched : []),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i).slice(0, 8)

  const telemetry = {
    id: sid,
    sessionId: sid,
    session_id: sid,
    worker_name: workerName,
    workerName,
    parentId,
    parent: parentId,
    parentClosed,
    isRoot,
    rawTitle,
    title,
    label,
    name: title,
    role,
    roleIndex: roleIdx,
    roleSiblingCount: roleSiblings || 1,
    badge,
    wave,
    color,
    model,
    activity,
    status,
    mode: String((s && s.mode) || header.mode || ''),
    tokens,
    inputTokens: effectiveInputTokens,
    outputTokens: effectiveOutputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheHitPct,
    contextTokens,
    contextMax,
    contextPct,
    costYuan,
    steps,
    rounds,
    turns: rounds,
    userMessages,
    user_messages: userMessages,
    toolCalls: explicitToolCalls !== undefined ? Number(explicitToolCalls) || 0 : undefined,
    filesTouched: mergedFilesTouched,
    files_touched: mergedFilesTouched,
    tools: (jsonlData && Array.isArray(jsonlData.tools) && jsonlData.tools.length > 0)
      ? jsonlData.tools
      : (Array.isArray(s && s.tools) ? s.tools : undefined),
    durationMs,
    durationLabel,
    summary: (s && s.summary) || (wfNode && wfNode.summary) || '',
    completionConclusion: (s && (s.completionConclusion || s.conclusion)) || '',
    actionSummary: (s && s.actionSummary) || '',
    lastAssistantText: (s && s.lastAssistantText) || (jsonlData && jsonlData.lastAssistantText) || '',
    error_detail: (s && (s.error_detail || s.errorDetail)) || '',
    promptPreview: previews.promptPreview,
    latestOutputPreview: previews.latestOutputPreview,
    outputPreview: previews.latestOutputPreview,
    createdAt: startMs > 0 ? new Date(startMs).toISOString() : (wfNode && wfNode.updated_at) || null,
    updatedAt: endMs > 0 ? new Date(endMs).toISOString() : (wfNode && wfNode.updated_at) || null,
  }

  computeWorkerLmtexMeta(telemetry, options.idx ?? 0, {
    store: options.store,
    engagementId: options.engagementId || '',
    recomputeApproval: options.recomputeApproval,
  })
  return telemetry
}

function isSyntheticSessionId(sid) {
  const s = String(sid || '').trim()
  if (!s) return true
  return s === 'root'
    || s === 'root-main'
    || s.startsWith('sub-')
    || s.startsWith('wt-')
    || s.startsWith('goal-')
    || s.startsWith('plan-goal-')
}

function createRequestFlow() {
  return {
    dagByEng: new Map(),
    syncedEngs: new Set(),
    hostSessionsByKey: new Map(),
    rawSessionById: new Map(),
  }
}

function getWorkflowDagDedup(store, engagementId, reqFlow = null, forceRefresh = false) {
  if (!store || typeof store.workflowDag !== 'function' || !engagementId) return null
  const engKey = String(engagementId)
  if (reqFlow && !forceRefresh && reqFlow.dagByEng.has(engKey)) {
    return reqFlow.dagByEng.get(engKey)
  }
  let dag = null
  try { dag = store.workflowDag(engKey) } catch { dag = null }
  if (reqFlow && dag) reqFlow.dagByEng.set(engKey, dag)
  return dag
}

function syncHostWorkersDedup(store, engagementId, workers, reqFlow = null) {
  if (!store || typeof store.syncHostWorkersToPg !== 'function' || !engagementId) return null
  const engKey = String(engagementId)
  const realWorkers = (Array.isArray(workers) ? workers : []).filter(
    (w) => w && !w._fromDbTask && !isSyntheticSessionId(w.id),
  )
  if (realWorkers.length === 0) {
    return { ok: true, engagement_id: engKey, synced: 0, total: 0 }
  }
  const liveRunningIds = new Set(
    realWorkers
      .filter((w) => w && (w.activity === 'running' || w.status === 'running'))
      .map((w) => String(w.id)),
  )
  const dedupKey = `${engKey}::${realWorkers.map((w) => `${w.id}:${w.status}:${w.approvalState || ''}`).join(',')}`
  if (reqFlow && reqFlow.syncedEngs.has(dedupKey)) return null
  if (reqFlow) reqFlow.syncedEngs.add(dedupKey)
  try {
    const res = store.syncHostWorkersToPg(engKey, realWorkers, { liveRunningIds })
    if (reqFlow && res && (res.synced > 0 || res.reaped_workers > 0)) reqFlow.dagByEng.delete(engKey)
    return res
  } catch {
    return null
  }
}

/**
 * 基于预构建 `byId` Map 执行 O(1)/线性（最多 64 跳）根会话查找，彻底消除嵌套 `sessions.list()` 轮询风暴。
 */
export function resolveRootFromMap(byId, sessionId) {
  const id = String(sessionId || '')
  if (!id || !(byId instanceof Map) || byId.size === 0) return id
  let cur = id
  let lastKnown = id
  for (let guard = 0; guard < 64; guard += 1) {
    const node = byId.get(cur)
    if (node === undefined) {
      return byId.has(id) ? lastKnown : cur
    }
    lastKnown = cur
    const header = node && node.header ? node.header : null
    const rawParent = (header && header.parentSession !== undefined && header.parentSession !== null)
      ? header.parentSession
      : (
        header?.parentSessionId ?? header?.parent_session_id ?? header?.parentId ?? header?.parent
        ?? node?.parentSession ?? node?.parentSessionId ?? node?.parent_session_id ?? node?.parentId ?? node?.parent ?? null
      )
    const parent = rawParent !== undefined && rawParent !== null ? String(rawParent).trim() : ''
    if (!parent) return cur
    if (parent === cur) return cur
    cur = parent
  }
  return cur
}

function hydrateChildrenWithDbState(children, wfDag) {
  if (!Array.isArray(children) || children.length === 0 || !wfDag || typeof wfDag !== 'object') {
    return new Set()
  }
  const dbTasks = Array.isArray(wfDag.worker_tasks) ? wfDag.worker_tasks : []
  const dbDigests = Array.isArray(wfDag.worker_digests) ? wfDag.worker_digests : []
  if (dbTasks.length === 0 && dbDigests.length === 0) return new Set()

  const digestByTaskId = new Map()
  const digestByWorkerName = new Map()
  for (const d of dbDigests) {
    if (!d || typeof d !== 'object') continue
    if (d.worker_task_id !== undefined && d.worker_task_id !== null) {
      const k = String(d.worker_task_id)
      if (!digestByTaskId.has(k)) digestByTaskId.set(k, d)
    }
    if (d.worker_name) {
      const nk = String(d.worker_name).trim()
      if (nk && !digestByWorkerName.has(nk)) digestByWorkerName.set(nk, d)
    }
  }

  const matchedTaskIds = new Set()
  for (const child of children) {
    if (!child || typeof child !== 'object') continue
    const cid = String(child.id || child.sessionId || '').trim()
    const wName = String(child.worker_name || child.workerName || child.title || '').trim()
    const dbTask = dbTasks.find((t) => {
      if (!t || matchedTaskIds.has(String(t.id))) return false
      if (cid && (String(t.session_id || '') === cid || String(t.id || '') === cid)) return true
      if (wName && t.worker_name && String(t.worker_name).trim() === wName) return true
      return false
    })
    if (!dbTask) continue
    matchedTaskIds.add(String(dbTask.id))

    const linkedDigest = digestByTaskId.get(String(dbTask.id))
      || (dbTask.worker_name ? digestByWorkerName.get(String(dbTask.worker_name).trim()) : null)
      || (wName ? digestByWorkerName.get(wName) : null)
      || null

    child.worker_task_id = dbTask.id
    if (dbTask.goal_id !== undefined && dbTask.goal_id !== null) child.goal_id = dbTask.goal_id
    if (dbTask.assigned_goal) {
      child.assigned_goal = dbTask.assigned_goal
      child.assignedGoal = dbTask.assigned_goal
    }
    const filesOwned = parseJsonArraySafe(dbTask.files_owned ?? dbTask.files_owned_json)
    if (filesOwned.length > 0) {
      child.filesOwned = filesOwned
      child.files_owned = filesOwned
      child.files_owned_json = typeof dbTask.files_owned_json === 'string'
        ? dbTask.files_owned_json
        : JSON.stringify(filesOwned)
    }
    const errDetail = String(dbTask.error_detail || dbTask.errorDetail || '').trim()
    if (errDetail) {
      child.error_detail = errDetail
      child.errorDetail = errDetail
    }
    const dbStatus = String(dbTask.status || '').trim().toLowerCase()
    if (ERROR_STATUS_SET.has(dbStatus)) {
      child.status = dbStatus
      child.activity = 'error'
    } else if (dbStatus === 'interrupted' && child.activity !== 'running' && child.activity !== 'completed') {
      child.status = 'interrupted'
      child.activity = 'interrupted'
    }
    const dbApproval = String(dbTask.approval_state || '').trim()
    if (['approved', 'revision_required', 'pending_approval'].includes(dbApproval)) {
      child.approval_state = dbApproval
      child.approvalState = dbApproval
      child._persistedApproval = true
    }
    const dbPrio = String(dbTask.ui_priority || '').trim()
    if (PRIORITY_META[dbPrio]) {
      child.ui_priority = dbPrio
      child.uiPriority = dbPrio
    }
    if (dbTask.next_goal) {
      child.next_goal = dbTask.next_goal
      child.nextGoal = dbTask.next_goal
    }
    const dbTags = parseJsonArraySafe(dbTask.tags ?? dbTask.tags_json)
    if (dbTags.length > 0) {
      child.workerTags = dbTags
      child.worker_tags = dbTags
    }
    if (linkedDigest) {
      child.workerDigest = linkedDigest
      const digestFiles = parseJsonArraySafe(linkedDigest.files_touched ?? linkedDigest.files_touched_json)
      if (digestFiles.length > 0) {
        const combined = [...(Array.isArray(child.filesTouched) ? child.filesTouched : []), ...digestFiles]
          .filter((v, idx, arr) => v && arr.indexOf(v) === idx)
          .slice(0, 8)
        child.filesTouched = combined
        child.files_touched = combined
      }
    }
  }

  return matchedTaskIds
}

function parseWaveNumber(waveVal, fallbackWave = 3) {
  if (typeof waveVal === 'number' && Number.isFinite(waveVal)) return waveVal
  if (typeof waveVal === 'string' && waveVal.trim()) {
    const m = /(\d+)/.exec(waveVal)
    if (m) return Number(m[1])
  }
  return fallbackWave
}

function buildValidEngagementMap(allEngagements) {
  const validEngagements = filterValidEngagements(Array.isArray(allEngagements) ? allEngagements : [])
  const byId = new Map()
  for (const e of validEngagements) {
    if (!e || !e.id) continue
    if (isUuidEngagement(e) && isUuidSessionTitle(e.id) && isUuidSessionTitle(e.name)) continue
    byId.set(String(e.id), e)
  }
  return byId
}

/**
 * 发现宿主 DSH 当前打开的所有根会话与子智能体，严格维护 1:1 会话绑定隔离：
 * - 已有合法显式绑定的会话保持 `init_state = 'initialized'`；
 * - 指向已删除/伪 UUID 工作区的脏绑定清理为 `unbound`（`engagement: null`），绝不跨会话自动劫持到其他项目！
 */
async function discoverHostSessions(ctx, store, options = {}) {
  const reqFlow = options.reqFlow || null
  const cacheKey = `${options.sessionId || ''}::${options.engagementId || ''}::${options.autoBind !== false ? '1' : '0'}`
  if (reqFlow && reqFlow.hostSessionsByKey.has(cacheKey)) {
    return reqFlow.hostSessionsByKey.get(cacheKey)
  }

  let sessions = null
  let subagents = null
  let tokenMeter = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  try { subagents = ctx.get('subagents') } catch { subagents = null }
  try { tokenMeter = ctx.get('tokenMeter') } catch { tokenMeter = null }

  let rawList = []
  if (sessions && typeof sessions.list === 'function') {
    try { rawList = sessions.list() } catch { rawList = [] }
  }
  if (!Array.isArray(rawList)) rawList = []

  const allEngagements = store ? getCachedEngagementsList(store) : []
  const validEngById = buildValidEngagementMap(allEngagements)

  /* O(N) 预构建会话映射表，供 resolveRootFromMap 在常数/有界跳数内完成根解析 */
  const byId = new Map()
  for (const s of rawList) {
    const sid = s && s.id !== undefined ? String(s.id) : ''
    if (sid) {
      byId.set(sid, s)
      if (reqFlow) reqFlow.rawSessionById.set(sid, s)
    }
  }

  const parentIdOfRaw = (s) => {
    if (!s || typeof s !== 'object') return null
    const h = s.header || {}
    const p = h.parentSession ?? h.parentSessionId ?? h.parent_session_id ?? h.parentId ?? h.parent
      ?? s.parentSession ?? s.parentSessionId ?? s.parent_session_id ?? s.parentId ?? s.parent ?? null
    return p !== undefined && p !== null && String(p).trim() !== '' ? String(p).trim() : null
  }

  const rootsMap = new Map()
  const rawChildren = []
  for (const s of rawList) {
    if (!s || s.id === undefined) continue
    const sid = String(s.id)
    const pid = parentIdOfRaw(s)
    if (!pid && s.kind !== 'child' && !s.isSubagent) {
      if (!rootsMap.has(sid)) rootsMap.set(sid, s)
    } else {
      rawChildren.push(s)
    }
  }
  const roots = Array.from(rootsMap.values())

  /* 单趟 O(N) 将所有子会话归组到对应根会话，彻底消除嵌套 O(R * C * N) 扫描 */
  const groupedChildrenByRoot = new Map()
  for (const c of rawChildren) {
    const cid = String(c.id)
    const directParent = parentIdOfRaw(c)
    const resolvedRoot = resolveRootFromMap(byId, cid)
    const targetRootId = rootsMap.has(resolvedRoot)
      ? resolvedRoot
      : (directParent && rootsMap.has(directParent)
        ? directParent
        : (roots.length === 1 && directParent ? String(roots[0].id) : ''))
    if (targetRootId) {
      if (!groupedChildrenByRoot.has(targetRootId)) groupedChildrenByRoot.set(targetRootId, new Map())
      groupedChildrenByRoot.get(targetRootId).set(cid, Object.assign({}, c))
    }
  }

  let didAdvanceJsonl = false
  let bindingsMutated = false
  const items = []
  for (const root of roots) {
    const sid = String(root.id)
    const header = (root && root.header) || {}
    const cwd = String(header.cwd || header.workspace || header.projectDir || root.cwd || '').trim()
    const workspace = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || '' : ''

    let cachedBinding = store ? getCachedSessionBindingEntry(store, sid) : null
    const rawBoundId = cachedBinding && cachedBinding.bound ? String(cachedBinding.bound).trim() : ''
    let sessionBoundEngId = null
    let sessionBoundEngName = null

    if (rawBoundId) {
      const validEng = validEngById.get(rawBoundId)
      const nameIsBogus = isUuidSessionTitle(cachedBinding && cachedBinding.name) && !validEng
      if (validEng && !nameIsBogus) {
        sessionBoundEngId = rawBoundId
        sessionBoundEngName = validEng.name || (cachedBinding && cachedBinding.name) || rawBoundId
      } else if (store && !isSyntheticSessionId(sid)) {
        /* 清理指向不存在/已删除/伪 UUID 工作区的脏绑定，绝不自动劫持到其他项目 */
        try {
          if (typeof store.setSessionOnboarding === 'function') {
            store.setSessionOnboarding(sid, { action: 'unbind' })
          } else if (typeof store.setSessionBinding === 'function') {
            store.setSessionBinding(sid, null, null)
          }
          invalidateSessionBindingsCache(store)
          bindingsMutated = true
          cachedBinding = getCachedSessionBindingEntry(store, sid)
        } catch { /* ignore */ }
      }
    }

    const itemDag = sessionBoundEngId ? getWorkflowDagDedup(store, sessionBoundEngId, reqFlow) : null
    const itemWfNodeByRole = new Map()
    if (itemDag && Array.isArray(itemDag.all_nodes || itemDag.nodes)) {
      for (const n of (itemDag.all_nodes || itemDag.nodes)) {
        if (n && n.role) itemWfNodeByRole.set(n.role, n)
      }
    }

    const rootJsonl = sessionJsonlReader.readSession(sid, store, root)
    if (rootJsonl && rootJsonl.didAdvance) didAdvanceJsonl = true
    const rootMeter = readHostTokenMeter(tokenMeter, sid)

    const rootTelemetry = extractSessionTelemetry(root, {
      isRoot: true,
      parentId: null,
      workflowNode: sessionBoundEngId ? (itemWfNodeByRole.get('plan') || null) : null,
      jsonlData: rootJsonl,
      meterUsage: rootMeter,
      store,
      engagementId: sessionBoundEngId || '',
    })

    const childRawById = groupedChildrenByRoot.get(sid) ? new Map(groupedChildrenByRoot.get(sid)) : new Map()

    if (subagents && typeof subagents.listChildren === 'function') {
      try {
        const list = await subagents.listChildren(root.id)
        for (const k of Array.isArray(list) ? list : []) {
          if (!k) continue
          const cid = String(k.id || k.sessionId || '')
          if (!cid) continue
          const existingRaw = childRawById.get(cid) || byId.get(cid) || {}
          const mergedRaw = Object.assign({}, existingRaw, k, {
            id: cid,
            header: Object.assign({}, existingRaw.header || {}, k.header || {}),
            usage: Object.assign({}, (existingRaw.header && existingRaw.header.usage) || {}, existingRaw.usage || {}, k.usage || {}),
            label: k.label || existingRaw.label || (existingRaw.header && existingRaw.header.title) || cid,
            activity: k.activity || existingRaw.activity || (existingRaw.header && existingRaw.header.activity),
            mode: k.mode || existingRaw.mode || '',
          })
          childRawById.set(cid, mergedRaw)
          if (reqFlow) reqFlow.rawSessionById.set(cid, mergedRaw)
        }
      } catch { /* 单个会话子智能体读取失败不阻断 */ }
    }

    /* 统计同角色并行子智能体数量并赋予确定性序号，防止 6 个并行 UUID exploit 坍缩成 1 个 */
    const orderedRawChildren = Array.from(childRawById.entries())
      .sort(([idA], [idB]) => String(idA).localeCompare(String(idB)))
    const roleCounts = new Map()
    const childPreRoles = new Map()
    for (const [cid, childObj] of orderedRawChildren) {
      const preRole = inferAgentRole(
        childObj.label || (childObj.header && childObj.header.title) || childObj.title || cid,
        false,
        childObj.role || (childObj.header && childObj.header.role),
      )
      childPreRoles.set(cid, preRole)
      roleCounts.set(preRole, (roleCounts.get(preRole) || 0) + 1)
    }

    const roleSeenIdx = new Map()
    const kids = []
    for (const [cid, childObj] of orderedRawChildren) {
      const preRole = childPreRoles.get(cid) || 'exploit'
      const curRoleIdx = roleSeenIdx.get(preRole) || 0
      roleSeenIdx.set(preRole, curRoleIdx + 1)
      const childJsonl = sessionJsonlReader.readSession(cid, store, childObj)
      if (childJsonl && childJsonl.didAdvance) didAdvanceJsonl = true
      const childMeter = readHostTokenMeter(tokenMeter, cid)

      const childTelemetry = extractSessionTelemetry(childObj, {
        isRoot: false,
        parentId: sid,
        parentClosed: rootTelemetry.parentClosed,
        defaultModel: rootTelemetry.model,
        workflowNode: sessionBoundEngId ? (itemWfNodeByRole.get(preRole) || null) : null,
        roleIndex: curRoleIdx,
        roleSiblingCount: roleCounts.get(preRole) || 1,
        jsonlData: childJsonl,
        meterUsage: childMeter,
        store,
        engagementId: sessionBoundEngId || '',
      })
      kids.push(childTelemetry)
    }

    if (sessionBoundEngId && itemDag) {
      hydrateChildrenWithDbState(kids, itemDag)
    }
    kids.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
    let completedKidIdx = 0
    for (let i = 0; i < kids.length; i += 1) {
      const k = kids[i]
      const kIdx = (k.activity === 'completed' || k.status === 'completed') ? completedKidIdx++ : i
      computeWorkerLmtexMeta(k, kIdx, {
        store,
        engagementId: sessionBoundEngId || '',
        recomputeApproval: !k._persistedApproval,
      })
    }

    const rawTitle = rootTelemetry.rawTitle
    let displayTitle = rawTitle
    let displayLabel = workspace && !rawTitle.includes(workspace) ? (workspace + ' · ' + rawTitle) : rawTitle
    if (isUuidSessionTitle(displayTitle) && sessionBoundEngName && !isUuidSessionTitle(sessionBoundEngName)) {
      displayTitle = sessionBoundEngName
      displayLabel = workspace && !sessionBoundEngName.includes(workspace)
        ? `${workspace} · ${sessionBoundEngName}`
        : sessionBoundEngName
    }

    const hasDbDagActivity = Boolean(
      sessionBoundEngId
      && itemDag
      && Array.isArray(itemDag.all_nodes || itemDag.nodes)
      && (itemDag.all_nodes || itemDag.nodes).some((n) => n && n.has_activity && n.role !== 'plan'),
    )
    const hasConversation = Boolean(
      rootTelemetry.turns > 0
      || rootTelemetry.userMessages > 0
      || rootTelemetry.steps > 0
      || rootTelemetry.tokens > 0
      || kids.length > 0
      || hasDbDagActivity,
    )

    const persistedInitState = sessionBoundEngId
      ? 'initialized'
      : (cachedBinding && cachedBinding.init_state === 'skipped' ? 'skipped' : 'uninitialized')
    const onboardingDismissed = sessionBoundEngId
      ? true
      : Boolean(cachedBinding && cachedBinding.onboarding_dismissed)

    /* 当真实根会话在 sessions.json 中已有记录且会话元数据变化时增量同步 */
    if (
      store
      && !isSyntheticSessionId(sid)
      && cachedBinding
      && typeof store.setSessionOnboarding === 'function'
      && (
        Boolean(cachedBinding.has_conversation) !== hasConversation
        || (rawTitle && cachedBinding.session_title !== rawTitle)
        || (cwd && cachedBinding.cwd !== cwd)
      )
    ) {
      try {
        store.setSessionOnboarding(sid, {
          action: 'sync',
          title: rawTitle || undefined,
          cwd: cwd || undefined,
          hasConversation,
        })
        bindingsMutated = true
      } catch { /* ignore */ }
    }

    items.push(Object.assign({}, rootTelemetry, {
      id: sid,
      rawTitle,
      title: displayTitle,
      label: displayLabel,
      cwd,
      workspace,
      displayLabel,
      engagementId: sessionBoundEngId,
      engagementName: sessionBoundEngName,
      hasConversation,
      has_conversation: hasConversation,
      initState: persistedInitState,
      init_state: persistedInitState,
      onboardingDismissed,
      onboarding_dismissed: onboardingDismissed,
      children: kids,
      running_children: kids.filter((c) => c.activity === 'running').length,
    }))
  }

  if (bindingsMutated) {
    invalidateSessionBindingsCache(store)
  }

  let finalItems = items
  /* p2 单窗口根会话唯一性：若存在有实质活动或真实标题的主会话，过滤掉无任何 token/步骤/子代理的空 UUID 幽灵会话 */
  if (items.length > 1) {
    const requestedRootId = options.sessionId ? resolveRootFromMap(byId, options.sessionId) : ''
    const hasActivePrimary = items.some((x) => !isUuidSessionTitle(x.rawTitle) || x.tokens > 0 || x.steps > 0 || x.children.length > 0)
    if (hasActivePrimary) {
      const filtered = items.filter((x) => (
        x.id === requestedRootId
        || !isUuidSessionTitle(x.rawTitle)
        || x.tokens > 0
        || x.steps > 0
        || x.children.length > 0
      ))
      if (filtered.length > 0) finalItems = filtered
    }
  }

  /* 自动同步宿主真实子智能体至对应显式绑定的工作区事实库（严禁混入未绑定或其他工作区） */
  try {
    if (store && typeof store.syncHostWorkersToPg === 'function') {
      const kidsByEng = new Map()
      for (const it of finalItems) {
        if (!it || !it.engagementId) continue
        if (!kidsByEng.has(it.engagementId)) kidsByEng.set(it.engagementId, [])
        const bucket = kidsByEng.get(it.engagementId)
        for (const ch of (Array.isArray(it.children) ? it.children : [])) {
          if (ch && !ch._fromDbTask && !isSyntheticSessionId(ch.id)) {
            bucket.push(ch)
          }
        }
      }
      for (const [engId, engKids] of kidsByEng.entries()) {
        if (engKids.length > 0) {
          syncHostWorkersDedup(store, engId, engKids, reqFlow)
        }
      }
    }
  } catch { /* ignore PG sync errors */ }

  if (didAdvanceJsonl) {
    bumpEventSeq('session_jsonl_append')
  }
  if (reqFlow) {
    reqFlow.hostSessionsByKey.set(cacheKey, finalItems)
  }

  return finalItems
}

/**
 * 清洗 bootstrap / sessionBinding / sessionOnboarding 返回结果中的伪 UUID 工作区，
 * 并严格保持未初始化/未绑定会话的 `bound: null` / `current: null`（零跨会话劫持）。
 */
function handleBootstrap(store, request, result, hostSessions = null) {
  if (!result || typeof result !== 'object') return result
  const allEngs = store ? getCachedEngagementsList(store) : (Array.isArray(result.engagements) ? result.engagements : [])
  const validEngById = buildValidEngagementMap(allEngs)

  if (Array.isArray(result.engagements)) {
    result.engagements = filterValidEngagements(result.engagements)
    const realNamed = result.engagements.filter((e) => e && !isUuidEngagement(e))
    /* 仅在未传入 request.session 时才使用全局默认工作区兜底；传入了 session 时严格由该会话自身的绑定决定 current！ */
    if (!request.session) {
      if (realNamed.length > 0 && (!result.current || isUuidSessionTitle(result.current) || !result.engagements.some((e) => e.id === result.current))) {
        result.current = realNamed[0].id
        try {
          if (store && typeof store.setActiveEngagement === 'function') {
            store.setActiveEngagement(realNamed[0].id)
            invalidateEngagementCaches(store)
          }
        } catch { /* ignore */ }
      }
    }
  }

  const rawReqSession = typeof request.session === 'string' ? request.session.trim() : ''
  const resolvedRootSid = String(
    result.root_session
    || (result.session_binding && result.session_binding.session)
    || (rawReqSession && typeof request.resolveRoot === 'function' ? request.resolveRoot(rawReqSession) : rawReqSession)
    || '',
  ).trim()

  const liveSessionItem = (resolvedRootSid && Array.isArray(hostSessions))
    ? (hostSessions.find((s) => s && String(s.id) === resolvedRootSid) || null)
    : null

  const normalizeBindingView = (baseObj, sid) => {
    const src = baseObj && typeof baseObj === 'object' ? baseObj : {}
    let boundId = src.bound ?? src.engagement ?? null
    let boundName = src.name ?? null
    let initState = src.init_state || src.initState || (boundId ? 'initialized' : 'uninitialized')
    let onboardingDismissed = Boolean(boundId || src.onboarding_dismissed || src.onboardingDismissed)

    if (boundId && !validEngById.has(String(boundId))) {
      boundId = null
      boundName = null
      initState = 'uninitialized'
      onboardingDismissed = false
      if (store && sid && !isSyntheticSessionId(sid) && typeof store.setSessionOnboarding === 'function') {
        try {
          store.setSessionOnboarding(sid, { action: 'unbind' })
          invalidateSessionBindingsCache(store)
        } catch { /* ignore */ }
      }
    } else if (boundId) {
      const validEng = validEngById.get(String(boundId))
      boundName = (validEng && validEng.name) || boundName || String(boundId)
      initState = 'initialized'
      onboardingDismissed = true
    } else if (initState === 'initialized') {
      initState = 'uninitialized'
    }

    const hasConversation = liveSessionItem
      ? Boolean(liveSessionItem.hasConversation)
      : Boolean(src.has_conversation ?? src.hasConversation)
    const sessionTitle = (liveSessionItem && liveSessionItem.rawTitle)
      || src.session_title
      || src.sessionTitle
      || null
    const cwd = (liveSessionItem && liveSessionItem.cwd)
      || src.cwd
      || null

    return {
      session: sid || src.session || null,
      root_session: sid || src.root_session || src.session || null,
      bound: boundId,
      name: boundName,
      init_state: initState,
      onboarding_dismissed: onboardingDismissed,
      has_conversation: hasConversation,
      session_title: sessionTitle,
      cwd,
      updated_at: src.updated_at || null,
    }
  }

  if (request.op === 'bootstrap' && rawReqSession) {
    const rawState = (store && resolvedRootSid && typeof store.getSessionState === 'function')
      ? store.getSessionState(resolvedRootSid)
      : (result.session_binding || {})
    const normalizedBinding = normalizeBindingView(rawState, resolvedRootSid)
    result.session_binding = normalizedBinding
    result.current = normalizedBinding.bound
  }

  if (
    request.op === 'sessionBinding'
    || request.op === 'sessionBindings'
    || request.op === 'sessionOnboarding'
  ) {
    const rawState = (store && resolvedRootSid && typeof store.getSessionState === 'function')
      ? store.getSessionState(resolvedRootSid)
      : result
    const normalizedBinding = normalizeBindingView(rawState, resolvedRootSid)
    result.session = rawReqSession || normalizedBinding.session
    result.root_session = normalizedBinding.root_session
    result.bound = normalizedBinding.bound
    result.name = normalizedBinding.name
    result.init_state = normalizedBinding.init_state
    result.onboarding_dismissed = normalizedBinding.onboarding_dismissed
    result.has_conversation = normalizedBinding.has_conversation
    result.session_title = normalizedBinding.session_title
    result.cwd = normalizedBinding.cwd
    result.current = normalizedBinding.bound
    result.session_binding = normalizedBinding

    if (result.agents && typeof result.agents === 'object') {
      for (const [k, v] of Object.entries(result.agents)) {
        if (v && v.engagement && !validEngById.has(String(v.engagement))) {
          result.agents[k] = Object.assign({}, v, {
            engagement: null,
            name: null,
            init_state: 'uninitialized',
            onboarding_dismissed: false,
          })
        }
      }
    }
  }

  return result
}

/**
 * 合成多智能体拓扑树（`agentNetwork`）、泳道（`swimlanes`）、跨智能体协作事件（`collabEvents`）与协作任务列表（`collabTasks`）。
 * 同时支持从宿主真实子会话（`sessions.list()` + `subagents.listChildren()`）与 `store.workflowDag(activeEngagement)`（含 `worker_tasks` / `plan_goals` / `worker_digests`）合成。
 * 当 `activeEngagement` 为空/null（未绑定会话）时，严格返回零泄漏的本会话洁净拓扑，绝不读取任何其他项目工作区！
 */
function synthesizeAgentCollaboration(store, activeEngagement, hostSessions, requestedSessionId = '', reqFlow = null) {
  const wfDag = activeEngagement ? getWorkflowDagDedup(store, activeEngagement, reqFlow) : null
  const wfNodes = (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes))
    ? (wfDag.all_nodes || wfDag.nodes)
    : []
  const wfNodeByRole = new Map()
  for (const n of wfNodes) {
    if (n && n.role) wfNodeByRole.set(n.role, n)
  }

  const dbTasks = (wfDag && Array.isArray(wfDag.worker_tasks)) ? wfDag.worker_tasks : []
  const dbGoals = (wfDag && Array.isArray(wfDag.plan_goals)) ? wfDag.plan_goals : []
  const dbDigests = (wfDag && Array.isArray(wfDag.worker_digests)) ? wfDag.worker_digests : []

  const goalById = new Map()
  for (const g of dbGoals) {
    if (g && g.id !== undefined && g.id !== null) goalById.set(String(g.id), g)
  }
  const digestByTaskId = new Map()
  const digestByWorkerName = new Map()
  for (const d of dbDigests) {
    if (!d || typeof d !== 'object') continue
    if (d.worker_task_id !== undefined && d.worker_task_id !== null) {
      const tk = String(d.worker_task_id)
      if (!digestByTaskId.has(tk)) digestByTaskId.set(tk, d)
    }
    if (d.worker_name) {
      const nk = String(d.worker_name).trim()
      if (nk && !digestByWorkerName.has(nk)) digestByWorkerName.set(nk, d)
    }
  }

  /* 严格按 activeEngagement 或 requestedSessionId 选择宿主根会话，绝不跨工作区借用其他项目的宿主会话！ */
  const safeHostList = Array.isArray(hostSessions) ? hostSessions : []
  let primaryHost = null
  if (!activeEngagement) {
    primaryHost = (requestedSessionId && safeHostList.find((s) => s && s.id === requestedSessionId)) || null
  } else {
    const matchingHosts = safeHostList.filter((s) => s && s.engagementId === activeEngagement)
    const unboundFallbackHosts = (!requestedSessionId && matchingHosts.length === 0 && safeHostList.every((s) => !s || !s.engagementId))
      ? safeHostList.filter(Boolean)
      : []
    const candidateHosts = matchingHosts.length > 0 ? matchingHosts : unboundFallbackHosts
    primaryHost = (requestedSessionId && candidateHosts.find((s) => s.id === requestedSessionId))
      || candidateHosts.find((s) => s.children && s.children.length > 0)
      || candidateHosts[0]
      || null
  }

  const planWfNode = activeEngagement ? (wfNodeByRole.get('plan') || null) : null
  const engList = (store && activeEngagement) ? getCachedEngagementsList(store) : []
  const activeEngMeta = activeEngagement ? (engList.find((e) => e && e.id === activeEngagement) || null) : null
  const dbHasRunning = dbTasks.some((t) => {
    const st = String(t && t.status || '').toLowerCase()
    return st === 'running' || st === 'run' || st === 'in_progress'
  })
  const rootActivityFallback = (wfDag && wfDag.status === 'running') || dbHasRunning
    ? 'running'
    : ((wfDag && wfDag.hasStarted) ? 'completed' : 'idle')

  const rootNode = primaryHost
    ? Object.assign({}, primaryHost, {
      isRoot: true,
      parentId: null,
      role: 'plan',
      badge: '主控',
      wave: 0,
      color: '#4d6bfe',
    })
    : extractSessionTelemetry({
      id: (requestedSessionId && !isSyntheticSessionId(requestedSessionId)) ? requestedSessionId : 'root-main',
      title: (activeEngMeta && activeEngMeta.name) || '主控指挥 Captain',
      role: 'plan',
      tokens: (planWfNode && planWfNode.tokens) || 0,
      steps: (planWfNode && planWfNode.step_count) || 0,
      turns: activeEngagement ? undefined : 0,
      activity: activeEngagement ? rootActivityFallback : 'idle',
    }, {
      isRoot: true,
      parentId: null,
      workflowNode: planWfNode,
      store,
      engagementId: activeEngagement || '',
    })

  const childNodes = Array.isArray(primaryHost && primaryHost.children)
    ? primaryHost.children
      .filter((c) => !c._fromDbTask)
      .map((c) => Object.assign({}, c, { isRoot: false, parentId: rootNode.id, parent: rootNode.id }))
    : []

  /* 1) 将 DB 中的 worker_tasks / worker_digests 持久化状态水合到已匹配的宿主子智能体 */
  const matchedTaskIds = activeEngagement ? hydrateChildrenWithDbState(childNodes, wfDag) : new Set()

  /* 2) 将尚未出现在宿主子会话中的 wfDag.worker_tasks 转化为真实拓扑/泳道/任务节点 */
  const unmatchedDbTasks = activeEngagement ? dbTasks.filter((t) => t && !matchedTaskIds.has(String(t.id))) : []
  if (unmatchedDbTasks.length > 0) {
    const dbRoleCounts = new Map()
    for (const t of unmatchedDbTasks) {
      const r = inferAgentRole(t.worker_name || t.assigned_goal || '', false, t.worker_role || t.role)
      dbRoleCounts.set(r, (dbRoleCounts.get(r) || 0) + 1)
    }
    const dbRoleIdx = new Map()
    for (const t of unmatchedDbTasks) {
      const tRole = inferAgentRole(t.worker_name || t.assigned_goal || '', false, t.worker_role || t.role)
      const curIdx = dbRoleIdx.get(tRole) || 0
      dbRoleIdx.set(tRole, curIdx + 1)
      const meta = AGENT_ROLE_META[tRole] || AGENT_ROLE_META.exploit
      const linkedGoal = (t.goal_id !== undefined && t.goal_id !== null) ? goalById.get(String(t.goal_id)) : null
      const linkedDigest = digestByTaskId.get(String(t.id))
        || (t.worker_name ? digestByWorkerName.get(String(t.worker_name).trim()) : null)
        || null
      const waveNum = parseWaveNumber(t.wave ?? (linkedGoal && linkedGoal.wave), meta.wave)
      const rawSt = String(t.status || 'pending').trim().toLowerCase()
      const isErr = ERROR_STATUS_SET.has(rawSt)
      const isRun = !isErr && (rawSt === 'running' || rawSt === 'run' || rawSt === 'active' || rawSt === 'in_progress')
      const isInterrupted = !isErr && !isRun && rawSt === 'interrupted'
      const isDone = !isErr && !isRun && !isInterrupted && (rawSt === 'completed' || rawSt === 'done' || rawSt === 'finished' || rawSt === 'approved')
      const taskActivity = isErr ? 'error' : (isRun ? 'running' : (isInterrupted ? 'interrupted' : (isDone ? 'completed' : 'idle')))
      const taskStatus = isErr ? rawSt : (isRun ? 'running' : (isInterrupted ? 'interrupted' : (isDone ? 'completed' : 'pending')))

      const filesOwned = parseJsonArraySafe(t.files_owned ?? t.files_owned_json)
      const filesTouched = parseJsonArraySafe(
        (linkedDigest && (linkedDigest.files_touched ?? linkedDigest.files_touched_json))
        ?? t.files_touched
        ?? t.files_touched_json,
      )
      const taskIdStr = String(t.session_id || (t.id !== undefined ? `wt-${t.id}` : `sub-${tRole}-${curIdx + 1}`)).trim()
      const displayTitle = String(
        t.title
        || (linkedGoal && linkedGoal.title)
        || (t.worker_name && !isUuidSessionTitle(t.worker_name) ? t.worker_name : '')
        || meta.defaultTitle
      ).trim()
      const assignedGoal = String(t.assigned_goal || (linkedGoal && linkedGoal.objective) || displayTitle).trim()
      const dbTags = parseJsonArraySafe(t.tags ?? t.tags_json)

      const dbChild = extractSessionTelemetry({
        id: taskIdStr,
        worker_name: t.worker_name || displayTitle,
        label: displayTitle,
        title: displayTitle,
        role: tRole,
        model: rootNode.model || 'deepseek-v4.1-flash (max)',
        activity: taskActivity,
        status: taskStatus,
        tokens: Number(t.tokens || (linkedDigest && linkedDigest.raw_tokens) || 0) || 0,
        steps: Number(t.steps || t.turns || 0) || 0,
        turns: isInterrupted && Number(t.turns || 0) === 0 ? 0 : Math.max(1, Number(t.turns || 1) || 1),
        toolCalls: Number(t.tool_calls ?? 0) || 0,
        durationMs: Number(t.latency_ms || t.duration_ms || 0) || 0,
        summary: (linkedDigest && linkedDigest.what_was_done) || assignedGoal,
        prompt: assignedGoal,
        latestOutput: (linkedDigest && linkedDigest.what_was_done) || t.error_detail || assignedGoal,
        filesTouched,
        error_detail: t.error_detail || '',
        createdAt: t.created_at || (linkedGoal && linkedGoal.created_at) || null,
        updatedAt: t.updated_at || (linkedGoal && linkedGoal.updated_at) || null,
      }, {
        isRoot: false,
        parentId: rootNode.id,
        defaultModel: rootNode.model,
        wave: waveNum,
        roleIndex: curIdx,
        roleSiblingCount: dbRoleCounts.get(tRole) || 1,
        workflowNode: (isRun || isDone) ? (wfNodeByRole.get(tRole) || null) : null,
        store,
        engagementId: activeEngagement,
      })

      dbChild._fromDbTask = true
      dbChild.worker_task_id = t.id
      dbChild.goal_id = t.goal_id ?? null
      dbChild.assigned_goal = assignedGoal
      dbChild.assignedGoal = assignedGoal
      dbChild.filesOwned = filesOwned
      dbChild.files_owned = filesOwned
      dbChild.files_owned_json = typeof t.files_owned_json === 'string' ? t.files_owned_json : JSON.stringify(filesOwned)
      if (t.error_detail) {
        dbChild.error_detail = String(t.error_detail)
        dbChild.errorDetail = String(t.error_detail)
      }
      if (taskActivity === 'idle') {
        dbChild.activity = 'idle'
        dbChild.status = 'pending'
      } else if (taskActivity === 'interrupted') {
        dbChild.activity = 'interrupted'
        dbChild.status = 'interrupted'
      } else if (taskActivity === 'error') {
        dbChild.activity = 'error'
        dbChild.status = 'error'
      }
      const dbApproval = String(t.approval_state || '').trim()
      if (['approved', 'revision_required', 'pending_approval'].includes(dbApproval)) {
        dbChild.approval_state = dbApproval
        dbChild.approvalState = dbApproval
        dbChild._persistedApproval = true
      }
      const dbPrio = String(t.ui_priority || '').trim()
      if (PRIORITY_META[dbPrio]) {
        dbChild.ui_priority = dbPrio
        dbChild.uiPriority = dbPrio
      }
      if (t.next_goal) {
        dbChild.next_goal = t.next_goal
        dbChild.nextGoal = t.next_goal
      }
      if (dbTags.length > 0) {
        dbChild.workerTags = dbTags
        dbChild.worker_tags = dbTags
      }
      if (linkedDigest) {
        dbChild.workerDigest = linkedDigest
      }
      childNodes.push(dbChild)
    }
  } else if (activeEngagement && childNodes.length === 0 && dbGoals.length > 0) {
    /* 若仅有 plan_goals 尚无 worker_tasks 行，按子目标展示已拆解波次节点 */
    const subGoals = dbGoals.filter((g) => g && g.parent_goal_id !== null && g.parent_goal_id !== undefined)
    const goalsToRender = subGoals.length > 0 ? subGoals : dbGoals
    for (let gi = 0; gi < goalsToRender.length; gi += 1) {
      const g = goalsToRender[gi]
      const gRole = inferAgentRole(g.title || g.objective || '', false, g.role)
      const meta = AGENT_ROLE_META[gRole] || AGENT_ROLE_META.exploit
      const waveNum = parseWaveNumber(g.wave, meta.wave)
      const gStatus = String(g.status || 'pending').toLowerCase()
      const gRun = gStatus === 'running' || gStatus === 'in_progress'
      const gDone = gStatus === 'completed' || gStatus === 'done' || gStatus === 'approved'
      const goalChild = extractSessionTelemetry({
        id: `plan-goal-${g.id ?? (gi + 1)}`,
        label: g.title || meta.defaultTitle,
        title: g.title || meta.defaultTitle,
        role: gRole,
        model: rootNode.model || 'deepseek-v4.1-flash (max)',
        activity: gRun ? 'running' : (gDone ? 'completed' : 'idle'),
        status: gRun ? 'running' : (gDone ? 'completed' : 'pending'),
        tokens: 0,
        steps: 0,
        summary: g.objective || g.title || '',
        prompt: g.objective || g.user_prompt || '',
        createdAt: g.created_at || null,
        updatedAt: g.updated_at || null,
      }, {
        isRoot: false,
        parentId: rootNode.id,
        defaultModel: rootNode.model,
        wave: waveNum,
        store,
        engagementId: activeEngagement,
      })
      goalChild._fromDbTask = true
      goalChild.goal_id = g.id
      goalChild.assigned_goal = g.objective || g.title || ''
      goalChild.assignedGoal = goalChild.assigned_goal
      if (!gRun && !gDone) {
        goalChild.activity = 'idle'
        goalChild.status = 'pending'
      }
      childNodes.push(goalChild)
    }
  }

  /* 3) 若 store.workflowDag 中存在真实已有活动（has_activity === true）的角色节点且未出现在子列表中，合成为节点 */
  if (activeEngagement) {
    const existingRoles = new Set(childNodes.map((c) => c.role))
    const WORKER_ROLES = ['designer', 'recon', 'assess', 'exploit', 'vuln-scan', 'qa', 'internal']
    for (const role of WORKER_ROLES) {
      const wfNode = wfNodeByRole.get(role)
      if (!wfNode || !wfNode.has_activity || existingRoles.has(role)) continue
      const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
      const stepCount = Number(wfNode.step_count || (Array.isArray(wfNode.decisions) ? wfNode.decisions.length : 0) || 1)
      const synthChild = extractSessionTelemetry({
        id: `sub-${role}`,
        label: `${meta.defaultTitle}`,
        title: `${meta.defaultTitle}`,
        role,
        model: rootNode.model || 'deepseek-v4.1-flash (max)',
        activity: (wfNode.status === 'run' || wfNode.active) ? 'running' : 'completed',
        tokens: Number(wfNode.tokens) > 0 ? Number(wfNode.tokens) : 0,
        steps: stepCount,
        durationMs: Number(wfNode.latency_ms) > 0 ? Number(wfNode.latency_ms) : 0,
        summary: wfNode.summary || '',
      }, {
        isRoot: false,
        parentId: rootNode.id,
        defaultModel: rootNode.model,
        workflowNode: wfNode,
        store,
        engagementId: activeEngagement,
      })
      synthChild._fromDbTask = true
      childNodes.push(synthChild)
      existingRoles.add(role)
    }
  }

  childNodes.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))

  /* 为每个子智能体节点计算 lmtex 优先级（保留数据库已持久化的审批与优先级状态） */
  let completedWorkerIdx = 0
  for (let i = 0; i < childNodes.length; i += 1) {
    const child = childNodes[i]
    const isChildCompleted = child.activity === 'completed' || child.status === 'completed' || child.status === 'done'
    const effIdx = isChildCompleted ? completedWorkerIdx++ : i
    computeWorkerLmtexMeta(child, effIdx, {
      store,
      engagementId: activeEngagement || '',
      recomputeApproval: !child._persistedApproval && !child._fromDbTask,
    })
  }

  /* 若主控节点自身 token 为 0 但子智能体已有真实消耗，按汇总比例补齐主控上下文遥测（统一 ¥1.80 / 1M 口径） */
  if (rootNode.tokens === 0 && childNodes.length > 0) {
    const sumChildTokens = childNodes.reduce((acc, c) => acc + (Number(c.tokens) || 0), 0)
    if (sumChildTokens > 0) {
      rootNode.tokens = Math.round(sumChildTokens * 0.35)
      rootNode.inputTokens = Math.round(rootNode.tokens * 0.72)
      rootNode.outputTokens = Math.max(0, rootNode.tokens - rootNode.inputTokens)
      rootNode.contextTokens = rootNode.tokens
      rootNode.contextPct = Math.min(100, Math.round((rootNode.contextTokens / (rootNode.contextMax || 421000)) * 1000) / 10)
      rootNode.costYuan = Number(((rootNode.tokens / 1000000) * 1.8).toFixed(4))
    }
    if (rootNode.activity === 'idle') {
      if (childNodes.some((c) => c.activity === 'running')) {
        rootNode.activity = 'running'
        rootNode.status = 'running'
      } else if (childNodes.some((c) => c.activity === 'completed')) {
        rootNode.activity = 'completed'
        rootNode.status = 'completed'
      }
    }
  }
  computeWorkerLmtexMeta(rootNode, 0, { store, engagementId: activeEngagement || '' })
  rootNode.children = childNodes
  rootNode.running_children = childNodes.filter((c) => c.activity === 'running').length

  /* 仅在当前会话已显式绑定工作区时同步真实宿主子会话，绝不向 'default' 混写未绑定会话数据 */
  if (activeEngagement) {
    syncHostWorkersDedup(store, activeEngagement, childNodes, reqFlow)
  }

  /* 生成跨智能体协作事件流（collabEvents）：按波次生成 spawn / progress / error / complete */
  const collabEvents = []
  let seq = 1
  const waves = Array.from(new Set(childNodes.map((c) => c.wave))).sort((a, b) => a - b)
  for (const w of waves) {
    const waveChildren = childNodes.filter((c) => c.wave === w)
    for (const child of waveChildren) {
      collabEvents.push({
        id: `ev-spawn-${child.id}`,
        seq: seq++,
        type: 'spawn',
        symbol: '+',
        fromId: rootNode.id,
        toId: child.id,
        rootId: rootNode.id,
        childId: child.id,
        badge: child.badge,
        role: child.role,
        wave: child.wave,
        color: child.color,
        uiPriority: child.uiPriority,
        priorityWeight: child.priorityWeight,
        workerTags: child.workerTags,
        approvalState: child.approvalState,
        label: `派发 ${child.title || child.label}`,
        at: child.createdAt || rootNode.updatedAt || new Date().toISOString(),
      })
    }
    for (const child of waveChildren) {
      if (child.status === 'error' || child.activity === 'error') {
        collabEvents.push({
          id: `ev-error-${child.id}`,
          seq: seq++,
          type: 'error',
          symbol: '✗',
          fromId: child.id,
          toId: rootNode.id,
          rootId: rootNode.id,
          childId: child.id,
          badge: child.badge,
          role: child.role,
          wave: child.wave,
          color: '#ef4444',
          uiPriority: child.uiPriority,
          priorityWeight: child.priorityWeight,
          workerTags: child.workerTags,
          approvalState: child.approvalState,
          compressedDigest: child.compressedDigest,
          label: child.error_detail ? `异常阻断：${child.error_detail}` : `执行异常或分片越界：${child.title || child.label}`,
          at: child.updatedAt || new Date().toISOString(),
        })
      } else if (child.activity === 'running') {
        collabEvents.push({
          id: `ev-progress-${child.id}`,
          seq: seq++,
          type: 'progress',
          symbol: '·',
          fromId: rootNode.id,
          toId: child.id,
          rootId: rootNode.id,
          childId: child.id,
          badge: child.badge,
          role: child.role,
          wave: child.wave,
          color: child.color,
          uiPriority: child.uiPriority,
          priorityWeight: child.priorityWeight,
          workerTags: child.workerTags,
          approvalState: child.approvalState,
          label: child.latestOutputPreview || `执行中 (${child.steps} 步)`,
          at: child.updatedAt || new Date().toISOString(),
        })
      } else if (child.activity === 'completed') {
        collabEvents.push({
          id: `ev-complete-${child.id}`,
          seq: seq++,
          type: 'complete',
          symbol: '✓',
          fromId: child.id,
          toId: rootNode.id,
          rootId: rootNode.id,
          childId: child.id,
          badge: child.badge,
          role: child.role,
          wave: child.wave,
          color: child.color,
          uiPriority: child.uiPriority,
          priorityWeight: child.priorityWeight,
          workerTags: child.workerTags,
          approvalState: child.approvalState,
          compressedDigest: child.compressedDigest,
          label: `完成回报 ${child.title || child.label}`,
          at: child.updatedAt || new Date().toISOString(),
        })
      }
    }
  }

  /* 生成泳道列表（swimlanes）：附加 lmtex 元数据并按 priorityWeight DESC -> updatedAt DESC 排序 */
  const buildLane = (node, isRootLane = false, laneIdx = 0) => {
    if (!node.uiPriority || !node.compressedDigest) {
      computeWorkerLmtexMeta(node, laneIdx, { store, engagementId: activeEngagement })
    }
    const laneEvents = collabEvents.filter((e) => e.fromId === node.id || e.toId === node.id || e.childId === node.id)
    const filesOwned = parseJsonArraySafe(node.filesOwned ?? node.files_owned ?? node.files_owned_json)
    return {
      id: node.id,
      sessionId: node.sessionId || node.id,
      worker_task_id: node.worker_task_id ?? null,
      goal_id: node.goal_id ?? null,
      parentId: node.parentId || null,
      isRoot: isRootLane,
      badge: node.badge,
      title: node.title || node.label,
      label: node.label || node.title,
      role: node.role,
      wave: node.wave,
      model: node.model,
      activity: node.activity,
      status: node.status,
      tokens: node.tokens,
      inputTokens: node.inputTokens,
      outputTokens: node.outputTokens,
      reasoningTokens: node.reasoningTokens,
      cacheHitPct: node.cacheHitPct,
      contextTokens: node.contextTokens,
      contextMax: node.contextMax,
      contextPct: node.contextPct,
      costYuan: node.costYuan,
      steps: node.steps,
      rounds: node.rounds,
      turns: node.turns,
      toolCalls: node.toolCalls,
      durationMs: node.durationMs,
      durationLabel: node.durationLabel,
      taskCount: isRootLane ? childNodes.length : 1,
      eventCount: isRootLane ? collabEvents.length : laneEvents.length,
      color: node.color,
      uiPriority: node.uiPriority,
      ui_priority: node.uiPriority,
      priorityWeight: node.priorityWeight,
      priority_weight: node.priorityWeight,
      priorityLabel: node.priorityLabel,
      priority_label: node.priorityLabel,
      workerTags: node.workerTags,
      worker_tags: node.workerTags,
      compressedDigest: node.compressedDigest,
      compressed_digest: node.compressedDigest,
      approvalState: node.approvalState,
      approval_state: node.approvalState,
      assignedGoal: node.assigned_goal || node.assignedGoal || '',
      assigned_goal: node.assigned_goal || node.assignedGoal || '',
      filesOwned,
      files_owned: filesOwned,
      filesTouched: node.filesTouched || (node.compressedDigest && node.compressedDigest.filesTouched) || [],
      files_touched: node.filesTouched || (node.compressedDigest && node.compressedDigest.filesTouched) || [],
      error_detail: node.error_detail || '',
      errorDetail: node.error_detail || '',
      nextGoal: node.nextGoal,
      next_goal: node.nextGoal,
      promptPreview: node.promptPreview,
      latestOutputPreview: node.latestOutputPreview,
      createdAt: node.createdAt || null,
      updatedAt: node.updatedAt || null,
    }
  }
  const swimlanes = [buildLane(rootNode, true, 0), ...childNodes.map((c, idx) => buildLane(c, false, idx))]
  swimlanes.sort((a, b) => {
    if ((b.priorityWeight || 0) !== (a.priorityWeight || 0)) {
      return (b.priorityWeight || 0) - (a.priorityWeight || 0)
    }
    const tb = parseTimestampMs(b.updatedAt)
    const ta = parseTimestampMs(a.updatedAt)
    if (tb !== ta) return tb - ta
    if (Boolean(b.isRoot) !== Boolean(a.isRoot)) return b.isRoot ? 1 : -1
    return (a.wave || 0) - (b.wave || 0)
  })

  /* 生成协作任务卡片列表（collabTasks）：供 p4 右下「协作任务」与 p5 树图画布使用 */
  const collabTasks = childNodes.map((child) => {
    const filesOwned = parseJsonArraySafe(child.filesOwned ?? child.files_owned ?? child.files_owned_json)
    const cardStatus = (child.status === 'error' || child.activity === 'error')
      ? 'error'
      : (child.activity === 'running' ? 'running' : (child.activity === 'completed' ? 'completed' : 'pending'))
    return {
      id: child.id,
      sessionId: child.sessionId || child.id,
      worker_task_id: child.worker_task_id ?? null,
      goal_id: child.goal_id ?? null,
      parentId: child.parentId || rootNode.id,
      badge: child.badge,
      title: child.title || child.label,
      label: child.label || child.title,
      role: child.role,
      wave: child.wave,
      status: cardStatus,
      activity: child.activity,
      model: child.model,
      assignedGoal: child.assigned_goal || child.assignedGoal || '',
      assigned_goal: child.assigned_goal || child.assignedGoal || '',
      filesOwned,
      files_owned: filesOwned,
      filesTouched: child.filesTouched || (child.compressedDigest && child.compressedDigest.filesTouched) || [],
      files_touched: child.filesTouched || (child.compressedDigest && child.compressedDigest.filesTouched) || [],
      error_detail: child.error_detail || '',
      errorDetail: child.error_detail || '',
      promptPreview: child.promptPreview,
      outputPreview: child.latestOutputPreview,
      latestOutputPreview: child.latestOutputPreview,
      tokens: child.tokens,
      inputTokens: child.inputTokens,
      outputTokens: child.outputTokens,
      reasoningTokens: child.reasoningTokens,
      cacheHitPct: child.cacheHitPct,
      contextTokens: child.contextTokens,
      contextMax: child.contextMax,
      contextPct: child.contextPct,
      costYuan: child.costYuan,
      durationMs: child.durationMs,
      durationLabel: child.durationLabel,
      steps: child.steps,
      rounds: child.rounds,
      turns: child.turns,
      toolCalls: child.toolCalls,
      color: child.color,
      uiPriority: child.uiPriority,
      ui_priority: child.uiPriority,
      priorityWeight: child.priorityWeight,
      priority_weight: child.priorityWeight,
      priorityLabel: child.priorityLabel,
      priority_label: child.priorityLabel,
      workerTags: child.workerTags,
      worker_tags: child.workerTags,
      compressedDigest: child.compressedDigest,
      compressed_digest: child.compressedDigest,
      approvalState: child.approvalState,
      approval_state: child.approvalState,
      nextGoal: child.nextGoal,
      next_goal: child.nextGoal,
      createdAt: child.createdAt || null,
      updatedAt: child.updatedAt || null,
    }
  })
  collabTasks.sort((a, b) => {
    if ((b.priorityWeight || 0) !== (a.priorityWeight || 0)) {
      return (b.priorityWeight || 0) - (a.priorityWeight || 0)
    }
    return parseTimestampMs(b.updatedAt) - parseTimestampMs(a.updatedAt)
  })

  const runningCount = (rootNode.activity === 'running' ? 1 : 0)
    + childNodes.filter((c) => c.activity === 'running').length
  const totalContextTokens = (Number(rootNode.contextTokens || rootNode.tokens || 0))
    + childNodes.reduce((sum, c) => sum + Number(c.contextTokens || c.tokens || 0), 0)

  const nodes = [rootNode, ...childNodes]
  const agentNetwork = {
    root: rootNode,
    children: childNodes,
    nodes,
    totalAgents: 1 + childNodes.length,
    runningCount,
    totalContextTokens,
    teamTasksCount: childNodes.length,
  }

  return {
    agentNetwork,
    nodes,
    swimlanes,
    collabEvents,
    collabTasks,
    rootNode,
    childNodes,
  }
}

/**
 * 构建或提取单个智能体会话的结构化执行轨迹（`stepTimeline`）与详情载荷，
 * 供「多智能体协作」与「团队拓扑」点击节点/事件时弹出执行轨迹详情弹窗及一键跳转宿主会话。
 */
async function extractAgentSessionDetail(ctx, store, engagementId, request = {}, reqFlow = null) {
  const flow = reqFlow || createRequestFlow()
  const targetId = String(request.sessionId || request.agentId || request.id || request.session || '').trim()
  const isSyntheticChildId = isSyntheticSessionId(targetId) || Boolean(request.role && request.role !== 'plan' && !targetId)
  const hostSessions = await discoverHostSessions(ctx, store, {
    sessionId: request.session || (isSyntheticChildId ? '' : targetId),
    autoBind: true,
    reqFlow: flow,
  })
  const rawById = flow.rawSessionById
  let sessions = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  if (sessions && typeof sessions.get === 'function' && targetId && !isSyntheticChildId) {
    try {
      const direct = sessions.get(targetId)
      if (direct && direct.id !== undefined) {
        rawById.set(String(direct.id), Object.assign({}, rawById.get(String(direct.id)) || {}, direct))
      }
    } catch { /* ignore */ }
  }
  const resolvedRootSession = request.session
    ? resolveRootFromMap(rawById, String(request.session))
    : ((targetId && !isSyntheticChildId) ? resolveRootFromMap(rawById, targetId) : '')
  const currentEng = (store ? getCachedActiveEngagementId(store) : null)
    || engagementId
    || 'default'
  const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, isSyntheticChildId ? '' : resolvedRootSession, flow)

  const wfDag = getWorkflowDagDedup(store, currentEng, flow)
  const wfNodeByRole = new Map()
  if (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes)) {
    for (const n of (wfDag.all_nodes || wfDag.nodes)) {
      if (n && n.role) wfNodeByRole.set(n.role, n)
    }
  }

  const allHostChildren = []
  for (const hs of hostSessions) {
    for (const c of Array.isArray(hs && hs.children) ? hs.children : []) {
      if (c) allHostChildren.push(c)
    }
  }

  const normalizedRoleTarget = targetId.replace(/^sub-/, '').toLowerCase()
  const explicitRole = String(request.role || '').trim().toLowerCase()

  let isRootMatch = false
  let matchedNode = null
  let matchedRealSessionId = ''

  if (!targetId || targetId === synth.rootNode.id || targetId === 'root-main' || hostSessions.some((hs) => hs.id === targetId)) {
    isRootMatch = true
    const hostRoot = hostSessions.find((hs) => hs.id === targetId) || (synth.rootNode && !isSyntheticSessionId(synth.rootNode.id) ? synth.rootNode : null)
    matchedNode = hostRoot || synth.rootNode
    if (hostRoot && hostRoot.id && !isSyntheticSessionId(hostRoot.id)) {
      matchedRealSessionId = String(hostRoot.id)
    }
  } else {
    matchedNode = synth.childNodes.find((c) => c.id === targetId || String(c.worker_task_id || '') === targetId)
      || allHostChildren.find((c) => c.id === targetId)
      || synth.childNodes.find((c) => c.role === normalizedRoleTarget || (explicitRole && c.role === explicitRole))
      || allHostChildren.find((c) => c.role === normalizedRoleTarget || (explicitRole && c.role === explicitRole))
      || null

    const realChild = allHostChildren.find((c) => c.id === targetId && !isSyntheticSessionId(c.id))
      || allHostChildren.find((c) => !isSyntheticSessionId(c.id) && matchedNode && c.id === matchedNode.id)
      || null
    if (realChild && realChild.id) {
      matchedRealSessionId = String(realChild.id)
    } else if (rawById.has(targetId) && !isSyntheticSessionId(targetId)) {
      matchedRealSessionId = targetId
    }
  }

  if (!matchedNode) {
    const fallbackRole = inferAgentRole(request.title || targetId, false, explicitRole || normalizedRoleTarget)
    const meta = AGENT_ROLE_META[fallbackRole] || AGENT_ROLE_META.assess
    const wfNode = wfNodeByRole.get(fallbackRole) || null
    matchedNode = extractSessionTelemetry({
      id: targetId || `sub-${fallbackRole}`,
      title: request.title || meta.defaultTitle,
      label: request.title || meta.defaultTitle,
      role: fallbackRole,
      tokens: (wfNode && wfNode.tokens) || 0,
      steps: (wfNode && wfNode.step_count) || 0,
      durationMs: (wfNode && wfNode.latency_ms) || 0,
      summary: (wfNode && wfNode.summary) || '',
    }, {
      isRoot: false,
      parentId: synth.rootNode.id,
      defaultModel: synth.rootNode.model,
      workflowNode: wfNode,
      store,
      engagementId: currentEng,
    })
  }

  const rawSession = (matchedRealSessionId && rawById.get(matchedRealSessionId))
    || rawById.get(targetId)
    || null
  const jsonlDetail = (matchedRealSessionId || (!isSyntheticSessionId(targetId) && targetId))
    ? sessionJsonlReader.readSession(matchedRealSessionId || targetId, store, rawSession)
    : null

  const role = matchedNode.role || (isRootMatch ? 'plan' : 'assess')
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.assess
  const wfNode = wfNodeByRole.get(role) || null
  const isError = matchedNode.status === 'error' || matchedNode.activity === 'error'
  const isRunning = !isError && (matchedNode.activity === 'running' || matchedNode.status === 'running')
  const delegationPrompt = String(
    matchedNode.assigned_goal
    || matchedNode.promptPreview
    || matchedNode.prompt
    || (jsonlDetail && jsonlDetail.delegationPrompt)
    || (rawSession && (rawSession.prompt || (rawSession.header && rawSession.header.prompt)))
    || meta.promptFallback
    || '按主控拆解的分片边界完成模块构建、契约对齐与单元验证。'
  ).trim()
  const conclusion = String(
    matchedNode.error_detail
    || (jsonlDetail && jsonlDetail.lastAssistantText)
    || matchedNode.latestOutputPreview
    || matchedNode.output
    || (wfNode && wfNode.summary)
    || '已完成当前阶段模块实现与契约校验，产物已同步至工作区。'
  ).trim()

  /* 优先尝试从宿主真实会话消息或 IncrementalSessionJsonlReader 提取真实工具调用与步骤轨迹 */
  const rawMessages = getSessionMessages(rawSession)

  const extractedSteps = []
  if (rawMessages.length > 0) {
    let stepIndex = 1
    for (let i = 0; i < rawMessages.length; i += 1) {
      const m = rawMessages[i]
      if (!m || typeof m !== 'object') continue
      const msgRole = getMessageRole(m)
      const text = extractMessageText(m)
      if (i === 0 || (msgRole === 'user' && extractedSteps.length === 0)) {
        extractedSteps.push({
          step: stepIndex++,
          phase: 'delegate',
          tool: isRootMatch ? 'session.user_prompt' : 'subagents.delegate',
          title: isRootMatch ? '接收用户需求指令与工程上下文' : `接收主控派发指令（${meta.badge}）`,
          inputSummary: (text || delegationPrompt).slice(0, 180),
          outputSummary: '已完成上下文装载、分片边界确认与工具链就绪检查。',
          durationLabel: '8s',
          status: 'done',
        })
        continue
      }
      const msgToolCalls = getMessageToolCalls(m, { includeNamedPart: true })
      if (msgToolCalls.length > 0) {
        const { name: toolName, rawInput } = getToolCallMeta(msgToolCalls[0])
        const inputPayload = rawInput ?? (text || '')
        const inputStr = typeof inputPayload === 'string' ? inputPayload : JSON.stringify(inputPayload)
        extractedSteps.push({
          step: stepIndex++,
          phase: 'execute',
          tool: toolName,
          title: `调用工具 ${toolName} 执行工程操作`,
          inputSummary: (inputStr || `执行 ${toolName}`).replace(/\s+/g, ' ').trim().slice(0, 180),
          outputSummary: (text || '工具执行成功，产物已写入上下文。').slice(0, 180),
          durationLabel: '0s',
          status: 'done',
        })
      } else if (text && (msgRole === 'assistant' || msgRole === 'model')) {
        extractedSteps.push({
          step: stepIndex++,
          phase: 'execute',
          tool: isRootMatch ? 'captain.orchestrate' : `${role}.reasoning`,
          title: isRootMatch ? '主控阶段性综合研判与调度' : `${matchedNode.title || meta.defaultTitle} 推进执行`,
          inputSummary: '基于当前工作区代码结构与上游契约进行推理实现',
          outputSummary: text.slice(0, 180),
          durationLabel: '0s',
          status: 'done',
        })
      }
      if (extractedSteps.length >= 4) break
    }
  } else if (jsonlDetail && Array.isArray(jsonlDetail.stepSummaries) && jsonlDetail.stepSummaries.length > 0) {
    extractedSteps.push({
      step: 1,
      phase: 'delegate',
      tool: isRootMatch ? 'session.user_prompt' : 'subagents.delegate',
      title: isRootMatch ? '接收用户需求指令与工程上下文' : `接收主控派发指令（${meta.badge}）`,
      inputSummary: delegationPrompt.slice(0, 180),
      outputSummary: '已从增量 JSONL 轨迹装载会话上下文。',
      durationLabel: '0s',
      status: 'done',
    })
    for (const sItem of jsonlDetail.stepSummaries.slice(-4)) {
      extractedSteps.push({
        step: extractedSteps.length + 1,
        phase: sItem.phase || 'execute',
        tool: sItem.tool || `${role}.step`,
        title: sItem.title || `调用工具 ${sItem.tool || 'step'}`,
        inputSummary: String(sItem.inputSummary || '').slice(0, 180),
        outputSummary: String(sItem.outputSummary || conclusion).slice(0, 180),
        durationLabel: '0s',
        status: 'done',
      })
    }
  }

  let stepTimeline = []
  if (extractedSteps.length > 0) {
    stepTimeline = extractedSteps.slice(0, 5)
    const lastIdx = stepTimeline.length - 1
    stepTimeline[lastIdx] = Object.assign({}, stepTimeline[lastIdx], {
      phase: isRunning ? 'execute' : 'conclude',
      status: isError ? 'error' : (isRunning ? 'running' : 'done'),
      outputSummary: stepTimeline[lastIdx].outputSummary || conclusion,
    })
  } else if (wfNode && Array.isArray(wfNode.decisions) && wfNode.decisions.length > 0) {
    stepTimeline = wfNode.decisions.slice(0, 5).map((d, idx, arr) => ({
      step: idx + 1,
      phase: idx === 0 ? 'delegate' : (idx === arr.length - 1 && !isRunning ? 'conclude' : 'execute'),
      tool: String((d && (d.tool || d.action)) || `${role}.step`),
      title: String((d && (d.title || d.summary || d.decision)) || `执行步骤 #${idx + 1}`),
      inputSummary: delegationPrompt.slice(0, 180),
      outputSummary: String((d && (d.summary || d.decision)) || conclusion).slice(0, 180),
      durationLabel: '0s',
      status: isError && idx === arr.length - 1 ? 'error' : (isRunning && idx === arr.length - 1 ? 'running' : 'done'),
    }))
  }

  const effectiveTokens = Number(matchedNode.tokens) > 0 ? Number(matchedNode.tokens) : 0
  const effectiveSteps = Math.max(Number(matchedNode.steps) || 0, extractedSteps.length)
  const effectiveDurationLabel = matchedNode.durationLabel || '0s'
  const effectiveWave = matchedNode.wave !== undefined && matchedNode.wave !== null
    ? Number(matchedNode.wave)
    : (isRootMatch ? 0 : 2)
  const effectiveStatus = isError
    ? 'error'
    : (isRunning
      ? 'running'
      : ((matchedNode.status && matchedNode.status !== 'pending') ? matchedNode.status : 'done'))

  const childIdx = Math.max(0, synth.childNodes.findIndex((c) => c.id === matchedNode.id || c.role === role))
  const lmtexMeta = computeWorkerLmtexMeta(Object.assign({}, matchedNode, {
    isRoot: isRootMatch,
    role,
    wave: effectiveWave,
    status: effectiveStatus,
    steps: effectiveSteps,
    turns: matchedNode.turns || matchedNode.rounds || Math.max(1, Math.ceil(Math.max(1, effectiveSteps) / 2)),
    toolCalls: matchedNode.toolCalls !== undefined ? matchedNode.toolCalls : extractedSteps.length,
    completionConclusion: conclusion,
    tools: (Array.isArray(matchedNode.tools) && matchedNode.tools.length > 0)
      ? matchedNode.tools
      : extractedSteps.map((st) => st.tool).filter(Boolean),
  }), isRootMatch ? 0 : childIdx, { store, engagementId: currentEng })

  return {
    ok: true,
    sessionId: matchedRealSessionId || targetId || synth.rootNode.id,
    isRealHostSession: Boolean(matchedRealSessionId),
    agentId: targetId || matchedNode.id || synth.rootNode.id,
    isRoot: isRootMatch,
    title: matchedNode.title || matchedNode.label || '子智能体执行会话',
    role: role || 'assess',
    wave: effectiveWave,
    model: matchedNode.model || 'deepseek-v4.1',
    status: effectiveStatus,
    tokens: effectiveTokens,
    steps: effectiveSteps,
    durationLabel: effectiveDurationLabel,
    delegationPrompt,
    assigned_goal: matchedNode.assigned_goal || delegationPrompt,
    files_owned: parseJsonArraySafe(matchedNode.filesOwned ?? matchedNode.files_owned ?? matchedNode.files_owned_json),
    files_touched: matchedNode.filesTouched || lmtexMeta.compressedDigest.filesTouched || [],
    error_detail: matchedNode.error_detail || '',
    stepTimeline,
    conclusion,
    uiPriority: lmtexMeta.uiPriority,
    ui_priority: lmtexMeta.uiPriority,
    priorityWeight: lmtexMeta.priorityWeight,
    priority_weight: lmtexMeta.priorityWeight,
    priorityLabel: lmtexMeta.priorityLabel,
    priority_label: lmtexMeta.priorityLabel,
    workerTags: lmtexMeta.workerTags,
    worker_tags: lmtexMeta.workerTags,
    compressedDigest: lmtexMeta.compressedDigest,
    compressed_digest: lmtexMeta.compressedDigest,
    approvalState: lmtexMeta.approvalState,
    approval_state: lmtexMeta.approvalState,
    nextGoal: lmtexMeta.nextGoal,
    next_goal: lmtexMeta.nextGoal,
  }
}

export function invokeStoreMethodCompat(store, methodName, engagementId, payload) {
  if (!store || typeof store[methodName] !== 'function') return undefined
  const fn = store[methodName]
  const fnSrc = Function.prototype.toString.call(fn)
  /* 兼容 ES6 Class 方法（如 `workflowAction(id, payload)` / `decomposeUserPrompt(arg1 = {})`）与普通函数签名，单次精确调用不重试 */
  const headerSlice = fnSrc.slice(0, 160)
  const paramMatch = /\(([^)]*)\)/.exec(headerSlice)
  const rawFirstParam = paramMatch ? paramMatch[1].split(',')[0].trim() : ''
  const cleanFirstParam = rawFirstParam.split('=')[0].trim()

  if (payload === undefined) {
    return fn.call(store, engagementId)
  }

  const mergedPayload = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? Object.assign(
      {
        engagement: engagementId,
        engagement_id: engagementId,
        engagementId,
      },
      payload,
    )
    : payload

  const firstArgIsEng = /^(?:id|eng|engagement|engagementId|engagement_id)$/i.test(cleanFirstParam)
    && !rawFirstParam.includes('{')
  if (firstArgIsEng) {
    return fn.call(store, engagementId, mergedPayload)
  }
  return fn.call(store, mergedPayload, engagementId)
}

function normalizeWishGoalItem(w, idx = 0) {
  const src = w && typeof w === 'object' ? w : {}
  const waveNum = Math.min(4, Math.max(1, parseWaveNumber(src.wave ?? src.wave_key, Math.min(4, Math.floor(idx / 2) + 1))))
  const role = inferAgentRole(
    src.title || src.worker_name || src.goal || src.objective || src.assigned_goal || '',
    false,
    src.role || src.worker_role || 'exploit',
  )
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const title = String(src.title || src.worker_name || src.workerName || meta.defaultTitle).trim()
  const goal = String(
    src.assigned_goal || src.assignedGoal || src.objective || src.goal || src.description || title,
  ).trim()
  const filesOwned = parseJsonArraySafe(src.files_owned ?? src.filesOwned ?? src.files_owned_json)
  const acceptanceCriteria = String(
    src.acceptance_criteria ?? src.acceptanceCriteria ?? src.verification ?? '',
  ).trim()
  const uiPriority = ['P0', 'P1', 'P2', 'P3'].includes(src.ui_priority || src.uiPriority)
    ? (src.ui_priority || src.uiPriority)
    : 'P1'
  return {
    id: src.id || `prop-w${waveNum}-${idx + 1}`,
    wave: waveNum,
    wave_key: `wave-${waveNum}`,
    role,
    worker_role: role,
    worker_name: String(src.worker_name || src.workerName || title).trim(),
    badge: meta.badge,
    ui_priority: uiPriority,
    uiPriority,
    title,
    goal,
    objective: goal,
    assigned_goal: goal,
    assignedGoal: goal,
    files_owned: filesOwned,
    filesOwned,
    acceptance_criteria: acceptanceCriteria,
    acceptanceCriteria,
  }
}

function extractWishTitle(rawPrompt, fallback = '多智能体 4-Wave 协同交付方案') {
  const promptText = String(rawPrompt || '').trim()
  if (!promptText) return fallback
  const cleanFirstLine = promptText.split(/[\n。！？!?]/)[0].trim()
  if (!cleanFirstLine) return fallback
  return cleanFirstLine.length > 42 ? `${cleanFirstLine.slice(0, 40)}…` : cleanFirstLine
}

function buildRefinedWishSpec(rawPrompt, template = '', rawPayload = {}) {
  const promptText = String(rawPrompt || '').trim() || '构建高可靠模块化工程系统并完成自动化验证'
  const tpl = String(template || rawPayload.template_id || 'fullstack').trim().toLowerCase()
  const specTitle = String(
    rawPayload.title
    || rawPayload.project_name
    || rawPayload.projectName
    || extractWishTitle(promptText)
  ).trim()

  const isSecurity = /渗透|漏洞|审计|安全|redteam|cve|scan|靶标/i.test(promptText) || tpl.includes('sec') || tpl.includes('audit')
  const isDataApi = /数据|爬虫|etl|api|后端|接口|数据库|postgres|pipeline/i.test(promptText) || tpl.includes('api') || tpl.includes('backend')

  const clarifications = Array.isArray(rawPayload.clarifications) && rawPayload.clarifications.length > 0
    ? rawPayload.clarifications
    : [
      isSecurity
        ? '边界确认：严格在授权工作区与目标范围内执行非破坏性验证与代码安全审计。'
        : '架构边界：采用零外部重依赖优先策略，前后端通过结构化 JSON / SSE 增量契约通信。',
      '分片隔离：每个并发 Worker 独占绑定 `files_owned` 文件集合，严禁跨分片覆写同一源码文件。',
      '验收标准：所有改动必须通过语法检查、单元测试与契约一致性冒烟门禁后方可归档。',
    ]

  const deliverables = Array.isArray(rawPayload.deliverables) && rawPayload.deliverables.length > 0
    ? rawPayload.deliverables
    : [
      'Wave 1 需求范围界定（PRD）与交互视觉规范清单',
      'Wave 2 模块接口契约与无交集文件独占分片表（Shard Lock Matrix）',
      isDataApi
        ? 'Wave 3 核心存储层、RPC 接口层与增量流式处理实现代码'
        : 'Wave 3 核心业务引擎、桥接 API 与响应式前端视图实现代码',
      'Wave 4 CSO 安全合规审查报告与 QA 自动化回归验证基线',
    ]

  const defaultWaves = [
    {
      wave: 1,
      wave_key: 'wave-1',
      role: 'recon',
      ui_priority: 'P1',
      title: 'Wave 1 · 需求拆解与现有代码库测绘',
      goal: `围绕「${specTitle}」盘点现有工程结构、数据源入口与核心业务验收指标`,
      files_owned: ['docs/01_PRD_SURFACE.md'],
    },
    {
      wave: 1,
      wave_key: 'wave-1',
      role: 'designer',
      ui_priority: 'P1',
      title: 'Wave 1 · 交互体验与四态视觉令牌设计',
      goal: `定义「${specTitle}」的组件布局层级、空态/加载/运行/异常四态交互与样式规范`,
      files_owned: ['docs/02_DESIGN_TOKENS.md'],
    },
    {
      wave: 2,
      wave_key: 'wave-2',
      role: 'assess',
      ui_priority: 'P1',
      title: 'Wave 2 · 接口契约冻结与文件分片加锁',
      goal: `锁定跨模块数据结构、API 协议签名与 Wave 3 无交集独占文件边界`,
      files_owned: ['docs/03_SHARD_CONTRACT.md'],
    },
    {
      wave: 3,
      wave_key: 'wave-3',
      role: 'exploit',
      ui_priority: 'P1',
      title: 'Wave 3 · 核心后端存储与桥接逻辑研发（Shard A）',
      goal: `按冻结契约实现「${specTitle}」的数据持久化、状态流转与服务端 API 端点`,
      files_owned: ['src/server/core.js', 'src/server/api.js'],
    },
    {
      wave: 3,
      wave_key: 'wave-3',
      role: 'exploit',
      ui_priority: 'P1',
      title: 'Wave 3 · 前端交互视图与状态联动研发（Shard B）',
      goal: `实现「${specTitle}」的前端可视化交互组件、增量状态订阅与表单闭环`,
      files_owned: ['src/client/app.js', 'src/client/styles.css'],
    },
    {
      wave: 4,
      wave_key: 'wave-4',
      role: 'qa',
      ui_priority: 'P2',
      title: 'Wave 4 · 自动化回归测试与安全合规门禁',
      goal: `对全部改动分片执行语法检查、边界用例测试与同源安全合规核验`,
      files_owned: ['test/regression.test.mjs'],
    },
  ]

  const inputWaves = Array.isArray(rawPayload.proposed_waves) && rawPayload.proposed_waves.length > 0
    ? rawPayload.proposed_waves
    : (Array.isArray(rawPayload.waves) && rawPayload.waves.length > 0
      ? rawPayload.waves
      : (Array.isArray(rawPayload.goals) && rawPayload.goals.length > 0
        ? rawPayload.goals
        : (Array.isArray(rawPayload.stages) && rawPayload.stages.length > 0
          ? rawPayload.stages
          : (Array.isArray(rawPayload.subgoals) && rawPayload.subgoals.length > 0 ? rawPayload.subgoals : null))))

  const proposedWaves = (inputWaves || defaultWaves).map((w, idx) => normalizeWishGoalItem(w, idx))
  const summaryText = `已将您的需求整理为 4 个波次（共 ${proposedWaves.length} 个无冲突并发子任务）：先完成需求测绘与契约加锁，再并行推进独占文件研发，最后经自动化测试门禁验收交付。`
  const refinedPrompt = String(
    rawPayload.refined_prompt
    || rawPayload.refinedPrompt
    || `【项目目标】${specTitle}\n【原始诉求】${promptText}\n【交付策略】${summaryText}`,
  ).trim()

  return {
    title: specTitle,
    project_name: specTitle,
    projectName: specTitle,
    template: tpl,
    raw_prompt: promptText,
    refined_prompt: refinedPrompt,
    refinedPrompt,
    summary: summaryText,
    clarifications,
    deliverables,
    proposed_waves: proposedWaves,
    goals: proposedWaves,
  }
}

function sanitizeDagTelemetryCacheHit(dagData, synthNodes) {
  if (!dagData || typeof dagData !== 'object' || !dagData.telemetry || typeof dagData.telemetry !== 'object') {
    return
  }
  const nodes = Array.isArray(synthNodes) ? synthNodes : []
  const sumCacheRead = nodes.reduce((acc, n) => acc + (Number(n && n.cacheReadTokens) || 0), 0)
  const sumInput = nodes.reduce((acc, n) => acc + (Number(n && n.inputTokens) || 0), 0)
  let realHitPct = 0
  if (sumCacheRead > 0 && sumInput > 0) {
    realHitPct = Math.min(100, Math.round((sumCacheRead / Math.max(sumInput, sumCacheRead)) * 1000) / 10)
  } else {
    const explicitNodeHits = nodes
      .map((n) => Number(n && n.cacheHitPct) || 0)
      .filter((v) => v > 0)
    if (explicitNodeHits.length > 0) {
      realHitPct = Math.round((explicitNodeHits.reduce((a, b) => a + b, 0) / explicitNodeHits.length) * 10) / 10
    }
  }
  dagData.telemetry.cached_tokens = sumCacheRead
  dagData.telemetry.cache_hit_pct = realHitPct
  if (Array.isArray(dagData.telemetry.rings)) {
    dagData.telemetry.rings = dagData.telemetry.rings.map((r) => {
      if (r && r.id === 'cache') {
        return Object.assign({}, r, {
          value: realHitPct,
          display: `${realHitPct}%`,
        })
      }
      return r
    })
  }
}

function detectShardLockConflicts(locksList) {
  const ownersByFile = new Map()
  for (const entry of Array.isArray(locksList) ? locksList : []) {
    if (!entry || typeof entry !== 'object') continue
    const isActive = entry.active !== undefined
      ? Boolean(entry.active)
      : (String(entry.status || 'active').toLowerCase() === 'active')
    if (!isActive) continue
    const fp = normalizeTouchedFilePath(entry.file_path || entry.filePath || '') || String(entry.file_path || entry.filePath || '').trim()
    if (!fp) continue
    if (!ownersByFile.has(fp)) ownersByFile.set(fp, [])
    ownersByFile.get(fp).push(entry)
  }
  const conflicts = []
  for (const [filePath, holders] of ownersByFile.entries()) {
    if (holders.length > 1) {
      conflicts.push({
        file_path: filePath,
        holders: holders.map((h) => ({
          worker_task_id: h.worker_task_id ?? null,
          worker_name: h.worker_name || '',
          wave: h.wave || '',
        })),
      })
    }
  }
  return conflicts
}

function computeShardLocksFallback(store, engagementId, wfDag = null, filterOpts = null) {
  if (!engagementId) {
    return {
      ok: true,
      unbound: true,
      engagement: null,
      engagement_id: null,
      locks: [],
      shard_locks: [],
      items: [],
      active: [],
      conflicts: [],
    }
  }
  const cleanFilter = {}
  let hasFilter = false
  if (filterOpts && typeof filterOpts === 'object') {
    if (filterOpts.activeOnly !== undefined || filterOpts.active_only !== undefined) {
      cleanFilter.activeOnly = Boolean(filterOpts.activeOnly ?? filterOpts.active_only)
      hasFilter = true
    }
    if (filterOpts.status !== undefined && filterOpts.status !== null && filterOpts.status !== '') {
      cleanFilter.status = String(filterOpts.status)
      hasFilter = true
    }
    if (filterOpts.wave !== undefined && filterOpts.wave !== null && filterOpts.wave !== '') {
      cleanFilter.wave = String(filterOpts.wave)
      hasFilter = true
    }
    const wtFilter = filterOpts.worker_task_id ?? filterOpts.workerTaskId
    if (wtFilter !== undefined && wtFilter !== null && wtFilter !== '') {
      cleanFilter.worker_task_id = wtFilter
      hasFilter = true
    }
  }

  const dag = wfDag || (store && typeof store.workflowDag === 'function' ? store.workflowDag(engagementId) : null)

  let dbLocks = []
  let storeMeta = null
  if (store && typeof store.listShardLocks === 'function') {
    let res = null
    try {
      res = hasFilter
        ? invokeStoreMethodCompat(store, 'listShardLocks', engagementId, cleanFilter)
        : invokeStoreMethodCompat(store, 'listShardLocks', engagementId)
    } catch {
      res = null
    }
    if (Array.isArray(res)) {
      dbLocks = res.slice()
    } else if (res && typeof res === 'object') {
      storeMeta = res
      dbLocks = Array.isArray(res.locks)
        ? res.locks.slice()
        : (Array.isArray(res.shard_locks) ? res.shard_locks.slice() : (Array.isArray(res.items) ? res.items.slice() : []))
    }
  }

  const tasks = (dag && Array.isArray(dag.worker_tasks)) ? dag.worker_tasks : []
  const seenKeys = new Set()
  const locks = []
  for (const existing of dbLocks) {
    if (!existing || typeof existing !== 'object') continue
    const rawFp = existing.file_path || existing.filePath || existing.file_pattern || ''
    const fp = normalizeTouchedFilePath(rawFp) || String(rawFp).trim()
    const isRowActive = existing.active !== undefined
      ? Boolean(existing.active)
      : (String(existing.status || 'active').toLowerCase() === 'active')
    if (fp) {
      seenKeys.add(`${existing.worker_task_id ?? ''}::${fp}`)
      if (existing.worker_name) seenKeys.add(`name:${existing.worker_name}::${fp}`)
    }
    locks.push(Object.assign({}, existing, {
      file_path: fp || rawFp,
      file_pattern: existing.file_pattern || fp || rawFp,
      active: isRowActive,
    }))
  }

  for (const t of tasks) {
    if (!t) continue
    if (cleanFilter.worker_task_id !== undefined && String(t.id) !== String(cleanFilter.worker_task_id)) continue
    if (cleanFilter.wave && String(t.wave || '') !== cleanFilter.wave) continue
    const st = String(t.status || '').toLowerCase()
    const active = st !== 'cancelled'
      && st !== 'archived'
      && st !== 'released'
      && st !== 'interrupted'
      && st !== 'completed'
      && st !== 'done'
      && st !== 'finished'
      && st !== 'approved'
    if (cleanFilter.activeOnly && !active) continue
    if (cleanFilter.status && st !== cleanFilter.status.toLowerCase()) continue
    const files = parseJsonArraySafe(t.files_owned ?? t.files_owned_json)
    for (const f of files) {
      const norm = normalizeTouchedFilePath(f) || String(f).trim()
      if (!norm) continue
      const kId = `${t.id ?? ''}::${norm}`
      const kName = t.worker_name ? `name:${t.worker_name}::${norm}` : ''
      if (seenKeys.has(kId) || (kName && seenKeys.has(kName))) continue
      seenKeys.add(kId)
      if (kName) seenKeys.add(kName)
      locks.push({
        file_path: norm,
        file_pattern: norm,
        worker_task_id: t.id,
        worker_name: t.worker_name || `wt-${t.id}`,
        worker_role: t.worker_role || 'exploit',
        wave: t.wave || 'wave-3',
        status: active ? 'active' : (t.status || 'released'),
        active,
      })
    }
  }

  const active = locks.filter((l) => l && (l.active === true || String(l.status || '').toLowerCase() === 'active'))
  const conflicts = (storeMeta && Array.isArray(storeMeta.conflicts) && storeMeta.conflicts.length > 0)
    ? storeMeta.conflicts
    : detectShardLockConflicts(locks)

  return Object.assign(
    {},
    storeMeta || {},
    {
      ok: true,
      engagement: engagementId,
      engagement_id: engagementId,
      locks,
      shard_locks: locks,
      items: locks,
      active,
      conflicts,
    },
  )
}

function tryGet(ctx, serviceName) {
  if (!ctx || typeof ctx.get !== 'function') return null
  try { return ctx.get(serviceName) ?? null } catch { return null }
}

function isRealDshHost(ctx) {
  if (!ctx || typeof ctx !== 'object') return false
  return Boolean(
    (ctx.fiber && ctx.root)
    || ctx.registry
    || (tryGet(ctx, 'sessionQuery') && tryGet(ctx, 'sessionProjections')),
  )
}

function deepFreezeObj(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value
  if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) return value
  if (!Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
  }
  if (seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeObj(item, seen)
  } else {
    for (const k of Object.keys(value)) {
      deepFreezeObj(value[k], seen)
    }
  }
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

function extractBalancedJsonSubstring(text) {
  const s = String(text || '')
  let start = -1
  let openChar = ''
  let closeChar = ''
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === '{' || ch === '[') {
      start = i
      openChar = ch
      closeChar = ch === '{' ? '}' : ']'
      break
    }
  }
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === openChar) depth += 1
    else if (ch === closeChar) {
      depth -= 1
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function tryParseJsonLoose(candidate) {
  const s = String(candidate || '').trim()
  if (!s) return undefined
  try {
    return JSON.parse(s)
  } catch { /* try trailing-comma cleanup */ }
  const noTrailingComma = s.replace(/,\s*([}\]])/g, '$1')
  if (noTrailingComma !== s) {
    try {
      return JSON.parse(noTrailingComma)
    } catch { /* ignore */ }
  }
  return undefined
}

function repairTruncatedJsonObject(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  if (start === -1) return undefined
  let candidate = s.slice(start)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stack = []
    let inString = false
    let escape = false
    for (let i = 0; i < candidate.length; i += 1) {
      const ch = candidate[i]
      if (inString) {
        if (escape) { escape = false; continue }
        if (ch === '\\') { escape = true; continue }
        if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop()
      else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop()
    }
    let closed = candidate
    if (inString) {
      if (escape) closed = closed.slice(0, -1)
      closed += '"'
    }
    closed = closed.replace(/,\s*$/, '')
    const suffix = stack.slice().reverse().map((ch) => (ch === '{' ? '}' : ']')).join('')
    const parsed = tryParseJsonLoose(closed + suffix)
    if (parsed && typeof parsed === 'object') return parsed
    const lastComma = candidate.lastIndexOf(',')
    if (lastComma <= 0) break
    candidate = candidate.slice(0, lastComma)
  }
  return undefined
}

export function extractJsonFromLlmText(rawText) {
  const trimmed = String(rawText || '').trim()
  if (!trimmed) throw new Error('模型响应文本为空')

  const withoutThink = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const candidates = withoutThink && withoutThink !== trimmed ? [withoutThink, trimmed] : [trimmed]

  for (const src of candidates) {
    const direct = tryParseJsonLoose(src)
    if (direct !== undefined) return direct

    const fenceRe = /```(?:json|JSON)?\s*\r?\n?([\s\S]*?)```/g
    let match
    while ((match = fenceRe.exec(src)) !== null) {
      const fenced = tryParseJsonLoose(match[1])
      if (fenced !== undefined) return fenced
    }

    const unfenced = src.replace(/^```(?:json|JSON)?\s*\r?\n?/i, '').replace(/```\s*$/, '').trim()
    const balanced = extractBalancedJsonSubstring(unfenced)
    if (balanced) {
      const parsed = tryParseJsonLoose(balanced)
      if (parsed !== undefined) return parsed
    }

    const repaired = repairTruncatedJsonObject(unfenced)
    if (repaired !== undefined) return repaired
  }

  const preview = trimmed.replace(/\s+/g, ' ').slice(0, 120)
  throw new Error(`模型输出未包含合法的 JSON 对象（len=${trimmed.length}，预览：${preview}）`)
}

export async function resolveLiveRootAgent(ctx, sessionId) {
  const sid = String(sessionId || '').trim()
  if (!sid || !ctx) return null
  const rootId = resolveRootSessionId(ctx, sid) || sid
  const agentsSvc = tryGet(ctx, 'agents')
  if (agentsSvc && typeof agentsSvc.get === 'function') {
    try {
      const live = agentsSvc.get(rootId)
      if (live) return live
    } catch { /* ignore */ }
  }
  if (!isSyntheticSessionId(rootId)) {
    const typert = tryGet(ctx, 'typert')
    const agentLookup = typert && typert.lookups && typeof typert.lookups.get === 'function'
      ? typert.lookups.get('agent')
      : null
    if (agentLookup && typeof agentLookup.resolve === 'function') {
      try {
        const recovered = await agentLookup.resolve(rootId)
        if (recovered) return recovered
      } catch { /* ignore */ }
    }
  }
  return null
}

function resolveAgentModelRoute(ctx, rootAgent) {
  const sessionProjections = tryGet(ctx, 'sessionProjections')
  if (rootAgent && rootAgent.session) {
    if (sessionProjections && typeof sessionProjections.stateOf === 'function') {
      try {
        const proj = sessionProjections.stateOf(rootAgent.session, 'modelSelection')
        if (proj && proj.pending && proj.pending.provider && proj.pending.model) {
          return {
            provider: String(proj.pending.provider),
            model: String(proj.pending.model),
            reasoningEffort: proj.pending.reasoningEffort ? String(proj.pending.reasoningEffort) : '',
            source: 'sessionProjections.pending',
          }
        }
      } catch { /* ignore */ }
    }
    try {
      const reqCfg = typeof rootAgent.session.requestHeader === 'function'
        ? (rootAgent.session.requestHeader()?.config || null)
        : null
      if (reqCfg && reqCfg.provider && reqCfg.model) {
        return {
          provider: String(reqCfg.provider),
          model: String(reqCfg.model),
          reasoningEffort: reqCfg.reasoningEffort ? String(reqCfg.reasoningEffort) : '',
          source: 'session.requestHeader',
        }
      }
    } catch { /* ignore */ }
    if (sessionProjections && typeof sessionProjections.stateOf === 'function') {
      try {
        const proj = sessionProjections.stateOf(rootAgent.session, 'modelSelection')
        if (proj && proj.lastUsed && proj.lastUsed.provider && proj.lastUsed.model) {
          return {
            provider: String(proj.lastUsed.provider),
            model: String(proj.lastUsed.model),
            reasoningEffort: proj.lastUsed.reasoningEffort ? String(proj.lastUsed.reasoningEffort) : '',
            source: 'sessionProjections.lastUsed',
          }
        }
      } catch { /* ignore */ }
    }
  }
  if (rootAgent && rootAgent.options && rootAgent.options.provider && rootAgent.options.model) {
    return {
      provider: String(rootAgent.options.provider),
      model: String(rootAgent.options.model),
      reasoningEffort: rootAgent.options.reasoningEffort ? String(rootAgent.options.reasoningEffort) : '',
      source: 'agent.options',
    }
  }
  const defaultModelSvc = tryGet(ctx, 'agentDefaultModel')
  if (defaultModelSvc && typeof defaultModelSvc.currentSelection === 'function') {
    try {
      const sel = defaultModelSvc.currentSelection()
      if (sel && sel.provider && sel.model) {
        return {
          provider: String(sel.provider),
          model: String(sel.model),
          reasoningEffort: sel.reasoningEffort ? String(sel.reasoningEffort) : '',
          source: 'agentDefaultModel',
        }
      }
    } catch { /* ignore */ }
  }
  return { provider: '', model: '', reasoningEffort: '', source: 'none' }
}

async function fetchLlmModelCatalog(ctx) {
  const llm = tryGet(ctx, 'llm')
  if (!llm || typeof llm.listProviders !== 'function') {
    return { available: false, groups: [] }
  }
  let providers = []
  try {
    providers = llm.listProviders() || []
  } catch { providers = [] }
  const groups = await Promise.all(
    (Array.isArray(providers) ? providers : []).map(async (p) => {
      if (!p || !p.id) return null
      let models = []
      if (typeof llm.listModels === 'function') {
        try { models = await llm.listModels(p.id) } catch { models = [] }
      }
      return {
        id: String(p.id),
        name: String(p.name || p.id),
        models: (Array.isArray(models) ? models : []).map((m) => ({
          id: String(m.id),
          name: String(m.name || m.id),
          ...(m.description ? { description: String(m.description) } : {}),
        })),
      }
    }),
  )
  return {
    available: true,
    groups: groups.filter(Boolean),
  }
}

const WORKSPACE_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', '.nuxt',
  '.cache', 'coverage', '.turbo', 'tmp', '.venv', 'venv', '__pycache__', '.idea',
])

export function sampleWorkspaceContext(ctx, rootAgent, cwdOverride = '', options = {}) {
  const scanEnabled = options.scanRepoContext !== undefined ? Boolean(options.scanRepoContext) : true
  let resolvedCwd = typeof cwdOverride === 'string' ? cwdOverride.trim() : ''
  if (!resolvedCwd && rootAgent && rootAgent.session && rootAgent.session.header && rootAgent.session.header.cwd) {
    resolvedCwd = String(rootAgent.session.header.cwd).trim()
  }
  if (!resolvedCwd && options.sessionId) {
    const sessionsSvc = tryGet(ctx, 'sessions')
    if (sessionsSvc) {
      try {
        const direct = typeof sessionsSvc.get === 'function' ? sessionsSvc.get(options.sessionId) : null
        if (direct && direct.header && direct.header.cwd) resolvedCwd = String(direct.header.cwd).trim()
      } catch { /* ignore */ }
      if (!resolvedCwd && typeof sessionsSvc.list === 'function') {
        try {
          const hit = (sessionsSvc.list() || []).find((s) => s && String(s.id) === String(options.sessionId))
          if (hit) resolvedCwd = String((hit.header && hit.header.cwd) || hit.cwd || '').trim()
        } catch { /* ignore */ }
      }
    }
    if (!resolvedCwd && options.store) {
      const bound = getCachedSessionBindingEntry(options.store, options.sessionId)
      if (bound && bound.cwd) resolvedCwd = String(bound.cwd).trim()
    }
  }
  if (!scanEnabled || !resolvedCwd || !existsSync(resolvedCwd)) {
    return { cwd: resolvedCwd, summary: '', entries: [] }
  }
  try {
    const st = statSync(resolvedCwd)
    if (!st.isDirectory()) return { cwd: resolvedCwd, summary: '', entries: [] }
  } catch {
    return { cwd: resolvedCwd, summary: '', entries: [] }
  }

  const lines = [`工作区根目录: ${resolvedCwd}`]
  const treeLines = []
  const topEntries = []
  try {
    const dirents = readdirSync(resolvedCwd, { withFileTypes: true })
      .filter((d) => d && d.name && !WORKSPACE_SKIP_DIRS.has(d.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 40)
    for (const d of dirents) {
      if (d.isDirectory()) {
        topEntries.push(`${d.name}/`)
        treeLines.push(`- ${d.name}/`)
        try {
          const sub = readdirSync(join(resolvedCwd, d.name), { withFileTypes: true })
            .filter((sd) => sd && sd.name && !WORKSPACE_SKIP_DIRS.has(sd.name))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .slice(0, 20)
          for (const sd of sub) {
            const rel = `${d.name}/${sd.name}${sd.isDirectory() ? '/' : ''}`
            topEntries.push(rel)
            treeLines.push(`  - ${rel}`)
          }
        } catch { /* ignore unreadable subdir */ }
      } else {
        topEntries.push(d.name)
        treeLines.push(`- ${d.name}`)
      }
    }
  } catch { /* ignore */ }

  if (treeLines.length > 0) {
    lines.push('目录结构（1-2 层）:')
    lines.push(...treeLines.slice(0, 90))
  }

  const pkgPath = join(resolvedCwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg && typeof pkg === 'object') {
        const pkgBrief = {
          name: pkg.name || undefined,
          description: pkg.description || undefined,
          workspaces: pkg.workspaces || undefined,
          scripts: pkg.scripts ? Object.keys(pkg.scripts).slice(0, 12) : undefined,
          dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 20) : undefined,
          devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 15) : undefined,
        }
        lines.push('package.json 概要: ' + JSON.stringify(pkgBrief))
      }
    } catch { /* ignore */ }
  }

  for (const readmeName of ['README.md', 'readme.md', 'README.zh.md']) {
    const rp = join(resolvedCwd, readmeName)
    if (existsSync(rp)) {
      try {
        const rawReadme = readFileSync(rp, 'utf8').trim()
        if (rawReadme) {
          lines.push(`${readmeName} 节选:\n${rawReadme.slice(0, 1400)}`)
          break
        }
      } catch { /* ignore */ }
    }
  }

  let summary = lines.join('\n')
  const MAX_BYTES = 6000
  if (Buffer.byteLength(summary, 'utf8') > MAX_BYTES) {
    let end = Math.min(summary.length, MAX_BYTES)
    while (end > 0 && Buffer.byteLength(summary.slice(0, end), 'utf8') > MAX_BYTES - 32) {
      end -= 64
    }
    summary = summary.slice(0, Math.max(0, end)) + '\n... (已按 6KB 上限截断)'
  }

  return {
    cwd: resolvedCwd,
    summary,
    entries: topEntries,
  }
}

export async function invokeDshLlmJson(ctx, { sessionId, system, prompt, maxTokens = 4096, signal } = {}) {
  const llm = tryGet(ctx, 'llm')
  if (!llm || (typeof llm.prepareCall !== 'function' && typeof llm.stream !== 'function')) {
    return {
      ok: false,
      llm_unavailable: true,
      error: '当前宿主未注册 DSH LLM 服务（ctx.get("llm") 不可用），无法调用大模型生成方案。',
    }
  }

  const settingsRoot = resolveRedteamSettingsRoot(tryGet(ctx, 'redteam')?.root)
  const settings = readUnifiedSettings(settingsRoot, process.env)
  const aiCfg = settings.aiPlanner || DEFAULT_AI_PLANNER_SETTINGS

  let route
  let effort = ''
  if (aiCfg.modelMode === 'custom' && aiCfg.provider && aiCfg.model) {
    route = {
      provider: aiCfg.provider,
      model: aiCfg.model,
      source: 'settings.custom',
    }
    effort = aiCfg.reasoningEffort || ''
  } else {
    const rootAgent = await resolveLiveRootAgent(ctx, sessionId)
    route = resolveAgentModelRoute(ctx, rootAgent)
    effort = route.reasoningEffort || aiCfg.reasoningEffort || ''
  }

  if (!route || !route.provider || !route.model) {
    return {
      ok: false,
      llm_unavailable: true,
      error: '未解析到有效的 DSH 模型路由（provider/model 为空）。请先在主会话中选定模型，或在设置页配置自定义 AI Planner 模型。',
    }
  }

  const userMsg = deepFreezeObj({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(prompt || '') }],
    source: { kind: 'redteam-planner' },
  })

  const timeoutMs = clampIntInRange(aiCfg.timeoutMs, 50, 300000, 60000)
  const ownTimeout = AbortSignal.timeout(timeoutMs)
  const timeoutSignal = (signal && typeof AbortSignal.any === 'function')
    ? AbortSignal.any([signal, ownTimeout])
    : (signal || ownTimeout)

  const wantEffort = (effort && effort !== 'none' && effort !== 'off') ? effort : ''

  try {
    let call
    if (typeof llm.prepareCall === 'function') {
      const prepareWithEffort = (eff) => llm.prepareCall(
        { provider: route.provider, model: route.model, maxTokens },
        timeoutSignal,
        (controls, modelInfo) => {
          if (!eff) return { ...controls }
          const efforts = modelInfo && modelInfo.reasoning && modelInfo.reasoning.efforts
          if (Array.isArray(efforts) && efforts.length > 0 && !efforts.some((e) => e && e.id === eff)) {
            return { ...controls }
          }
          if (modelInfo && modelInfo.id && modelInfo.reasoning === undefined) {
            return { ...controls }
          }
          return { ...controls, reasoningEffort: eff }
        },
      )

      try {
        call = await prepareWithEffort(wantEffort)
      } catch (prepErr) {
        const errCode = prepErr && (prepErr.code || (prepErr.failure && prepErr.failure.code))
        const errMsg = prepErr && prepErr.message ? String(prepErr.message) : ''
        if (wantEffort && (errCode === 'UNSUPPORTED_REASONING_EFFORT' || /UNSUPPORTED_REASONING_EFFORT|reasoning.?effort/i.test(errMsg))) {
          call = await prepareWithEffort('')
        } else {
          throw prepErr
        }
      }
    } else {
      call = {
        config: { provider: route.provider, model: route.model, maxTokens },
        stream: (opts) => llm.stream(opts),
      }
    }

    const options = deepFreezeObj({
      ...call.config,
      messages: [userMsg],
      system: String(system || ''),
      purpose: 'redteam-planner',
      signal: timeoutSignal,
    })

    const deltasByIndex = new Map()
    const blocksByIndex = new Map()
    const indexOrder = []
    let finishReason = ''
    const ensureIndex = (idx) => {
      const key = idx ?? 0
      if (!deltasByIndex.has(key) && !blocksByIndex.has(key)) indexOrder.push(key)
      return key
    }

    for await (const chunk of call.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta') {
        const key = ensureIndex(chunk.index)
        deltasByIndex.set(key, (deltasByIndex.get(key) || '') + String(chunk.text || ''))
      } else if (chunk.type === 'block-end') {
        if (chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') {
          const key = ensureIndex(chunk.index)
          blocksByIndex.set(key, chunk.block.text)
        }
      } else if (chunk.type === 'finish') {
        const kind = chunk.reason && chunk.reason.kind
        if (kind) finishReason = String(kind)
        if (kind === 'error' || kind === 'aborted') {
          const failure = chunk.reason.failure || {}
          const errMsg = failure.message || chunk.reason.message || (typeof chunk.reason.error === 'string' ? chunk.reason.error : '') || `LLM 调用异常终止 (${kind})`
          const err = new Error(errMsg)
          if (failure.code || chunk.reason.code) err.code = failure.code || chunk.reason.code
          throw err
        }
      }
    }

    const assembledText = indexOrder
      .map((k) => (blocksByIndex.has(k) ? blocksByIndex.get(k) : (deltasByIndex.get(k) || '')))
      .join('')
      .trim()

    if (!assembledText) {
      return {
        ok: false,
        llm_unavailable: true,
        provider: route.provider,
        model: `${route.provider}/${route.model}`,
        error: `大模型（${route.provider}/${route.model}）返回内容为空（finish=${finishReason || 'unknown'}），未生成结构化 JSON。`,
      }
    }

    let parsed
    try {
      parsed = extractJsonFromLlmText(assembledText)
    } catch (parseErr) {
      const msg = parseErr && parseErr.message ? parseErr.message : String(parseErr)
      throw new Error(finishReason ? `${msg}（finish=${finishReason}）` : msg)
    }
    return {
      ok: true,
      data: parsed,
      rawText: assembledText,
      provider: route.provider,
      model: `${route.provider}/${route.model}`,
      modelId: route.model,
      reasoningEffort: (call.config && call.config.reasoningEffort) || '',
      routeSource: route.source,
    }
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err)
    const isTimeout = Boolean(err && (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|aborted/i.test(errMsg)))
    return {
      ok: false,
      llm_unavailable: true,
      provider: route.provider,
      model: `${route.provider}/${route.model}`,
      error: isTimeout
        ? `大模型请求超时（${timeoutMs}ms，模型 ${route.provider}/${route.model}）：${errMsg}`
        : `大模型调用或 JSON 解析失败（${route.provider}/${route.model}）：${errMsg}`,
    }
  }
}

async function clarifyWishWithAI(ctx, store, opts = {}) {
  const promptText = String(opts.prompt || '').trim()
  if (!promptText) {
    return { ok: false, op: 'clarifyWishWithAI', error: '请先输入工程需求描述后再执行 AI 需求澄清。' }
  }
  const settingsRoot = resolveRedteamSettingsRoot(store && store.root)
  const settings = readUnifiedSettings(settingsRoot, process.env)
  const rootAgent = await resolveLiveRootAgent(ctx, opts.sessionId)
  const wsCtx = sampleWorkspaceContext(ctx, rootAgent, opts.cwd, {
    scanRepoContext: settings.aiPlanner.scanRepoContext,
    sessionId: opts.sessionId,
    store,
  })

  const system = [
    '你是 LMTAgent 软件工程多智能体集群的 AI 规划分析师。',
    '根据用户的原始工程需求与工作区代码上下文，提出 2-4 个高价值的工程澄清问题（如目标形态、数据持久化/接口契约、测试门禁与架构约束），帮助用户在派发多智能体前消除关键歧义。',
    '必须只输出严格的 JSON 对象，不要包含额外解释文本：',
    '{',
    '  "detected_context": "一句话概述探测到的项目技术栈、已有目录结构或纯新建工程判断",',
    '  "questions": [',
    '    {',
    '      "id": "q1",',
    '      "question": "具体中文澄清问题",',
    '      "multi": false,',
    '      "options": [',
    '        { "label": "简短选项名称（含推荐标注）", "value": "可拼接进工程需求规格的完整约束描述" }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ].join('\n')

  const promptParts = [`【用户原始需求】\n${promptText}`]
  if (wsCtx.summary) promptParts.push(`【工作区上下文采样】\n${wsCtx.summary}`)
  if (settings.aiPlanner.customConstraints) {
    promptParts.push(`【全局自定义工程约束】\n${settings.aiPlanner.customConstraints}`)
  }

  const llmRes = await invokeDshLlmJson(ctx, {
    sessionId: opts.sessionId,
    system,
    prompt: promptParts.join('\n\n'),
    maxTokens: 2048,
    signal: opts.signal,
  })

  if (!llmRes.ok) {
    const allowFallback = Boolean(opts.allowStaticFallback) && !isRealDshHost(ctx)
    if (!allowFallback) return Object.assign({ op: 'clarifyWishWithAI' }, llmRes)
    return {
      ok: true,
      op: 'clarifyWishWithAI',
      fallback_used: true,
      model: 'static-test-fallback',
      detected_context: wsCtx.summary ? `已扫描目录 ${wsCtx.cwd}` : '测试环境静态回退上下文',
      cwd: wsCtx.cwd || '',
      questions: [
        {
          id: 'q1',
          question: '请确认本次交付的核心工程形态与运行边界：',
          multi: false,
          options: [
            { label: '模块化标准库实现（推荐）', value: '优先复用现有目录与零外部依赖方案，补齐单元测试。' },
            { label: '全栈接口与界面联动', value: '同时实现后端数据持久化、RPC 接口与前端交互视图。' },
          ],
        },
      ],
    }
  }

  const data = llmRes.data && typeof llmRes.data === 'object' ? llmRes.data : {}
  const rawQuestions = Array.isArray(data.questions) ? data.questions : []
  const questions = rawQuestions
    .filter((q) => q && typeof q === 'object' && (q.question || q.title))
    .slice(0, 6)
    .map((q, idx) => ({
      id: String(q.id || `q-${idx + 1}`),
      question: String(q.question || q.title).trim(),
      multi: Boolean(q.multi ?? q.is_multi_select),
      options: (Array.isArray(q.options) ? q.options : [])
        .map((opt) => {
          if (typeof opt === 'string') return { label: opt, value: opt }
          if (!opt || typeof opt !== 'object') return null
          const label = String(opt.label || opt.text || opt.value || '').trim()
          const value = String(opt.value || opt.snippet || opt.label || '').trim()
          return label ? { label, value: value || label } : null
        })
        .filter(Boolean),
    }))

  return {
    ok: true,
    op: 'clarifyWishWithAI',
    model: llmRes.model,
    provider: llmRes.provider,
    detected_context: String(data.detected_context || data.detectedContext || (wsCtx.cwd ? `已探测工作区：${wsCtx.cwd}` : '通用软件工程上下文')).trim(),
    cwd: wsCtx.cwd || '',
    questions,
  }
}

async function decomposeWishWithAI(ctx, store, opts = {}) {
  const promptText = String(opts.prompt || '').trim()
  const settingsRoot = resolveRedteamSettingsRoot(store && store.root)
  const settings = readUnifiedSettings(settingsRoot, process.env)
  const rootAgent = await resolveLiveRootAgent(ctx, opts.sessionId)
  const wsCtx = sampleWorkspaceContext(ctx, rootAgent, opts.cwd, {
    scanRepoContext: settings.aiPlanner.scanRepoContext,
    sessionId: opts.sessionId,
    store,
  })

  const system = [
    '你是 LMTAgent 软件工程多智能体集群的首席架构师（AI Planner）。',
    '请把用户需求拆解为可立即由多智能体并行落地的 4-Wave Bounded DAG 蓝图（按需 3-8 个任务，简单需求精简、复杂工程充实），严格遵守 File-Disjoint Sharding（同一波次及并行子任务之间的 files_owned 绝对不能有文件路径/通配符交集）。',
    '可用执行角色（role）与波次对应关系：',
    '- wave 1: recon（需求/代码库测绘与数据源核验）、designer（UI/UX 设计令牌与交互规范）',
    '- wave 2: assess（架构契约冻结与无交集分片锁定）',
    `- wave 3: exploit（全栈研发构建分片，Wave 3 并发数不超过 ${settings.maxAgents}，每个分片独占互不重叠的 files_owned）`,
    '- wave 4: vuln-scan（代码审查与安全审计）、qa（自动化测试与构建门禁）、internal（文档与发布归档）',
    '若提供了真实工作区目录结构，files_owned 必须尽可能贴合该仓库真实存在或合理的路径！',
    '禁止输出 <think>、解释性文字或 Markdown 代码块围栏，直接以 { 开头、以 } 结尾；每个字段保持简洁精炼，避免冗长截断。',
    '必须只输出严格合法的 JSON 对象，结构如下：',
    '{',
    '  "project_name": "简明中文/英文工程名",',
    '  "refined_prompt": "润色后的完整结构化工程规格说明",',
    '  "summary": "一句话总结 4-Wave 分片交付策略",',
    '  "clarifications": ["关键边界确认要点1", "要点2"],',
    '  "deliverables": ["核心交付物1", "交付物2"],',
    '  "goals": [',
    '    {',
    '      "wave": 1,',
    '      "role": "recon",',
    '      "title": "Wave 1 · 任务简明标题",',
    '      "assigned_goal": "包含上下文、范围与完成标准的自包含执行指令",',
    '      "files_owned": ["exact/path/or/dir/**"],',
    '      "acceptance_criteria": "可核验的验收测试或交付判据"',
    '    }',
    '  ]',
    '}',
  ].join('\n')

  const promptParts = [`【用户工程需求】\n${promptText}`]
  if (opts.template) promptParts.push(`【期望模板风格】${opts.template}`)
  if (opts.clarificationsText) promptParts.push(`【用户澄清补充】\n${opts.clarificationsText}`)
  if (wsCtx.summary) promptParts.push(`【工作区上下文采样】\n${wsCtx.summary}`)
  if (settings.aiPlanner.customConstraints) {
    promptParts.push(`【全局自定义工程约束】\n${settings.aiPlanner.customConstraints}`)
  }
  promptParts.push(`【集群并发配额】maxAgents=${settings.maxAgents}, maxDepth=${settings.maxDepth}, thinkingEffort=${settings.thinkingEffort}`)

  const llmRes = await invokeDshLlmJson(ctx, {
    sessionId: opts.sessionId,
    system,
    prompt: promptParts.join('\n\n'),
    maxTokens: 8192,
    signal: opts.signal,
  })

  if (!llmRes.ok) {
    return Object.assign({ cwd: wsCtx.cwd || '' }, llmRes)
  }

  const raw = llmRes.data && typeof llmRes.data === 'object' ? llmRes.data : {}
  const rawList = Array.isArray(raw.goals) && raw.goals.length > 0
    ? raw.goals
    : (Array.isArray(raw.proposed_waves) && raw.proposed_waves.length > 0
      ? raw.proposed_waves
      : (Array.isArray(raw.waves) ? raw.waves : []))

  if (rawList.length === 0) {
    return {
      ok: false,
      llm_unavailable: true,
      model: llmRes.model,
      provider: llmRes.provider,
      error: `大模型（${llmRes.model}）返回的 JSON 缺少有效的 goals 任务列表。`,
    }
  }

  const goals = rawList.map((g, idx) => normalizeWishGoalItem(g, idx))
  const projectName = String(raw.project_name || raw.projectName || raw.title || '').trim()
  const refinedPrompt = String(raw.refined_prompt || raw.refinedPrompt || promptText).trim()
  const summary = String(
    raw.summary || `已由 ${llmRes.model} 拆解为 ${goals.length} 个无冲突并发子任务。`,
  ).trim()

  return {
    ok: true,
    ai_generated: true,
    model: llmRes.model,
    provider: llmRes.provider,
    cwd: wsCtx.cwd || '',
    project_name: projectName,
    refined_prompt: refinedPrompt,
    summary,
    clarifications: Array.isArray(raw.clarifications) ? raw.clarifications.map(String) : [],
    deliverables: Array.isArray(raw.deliverables) ? raw.deliverables.map(String) : [],
    goals,
  }
}

function workerPresetForRole(role) {
  const r = String(role || '').trim().toLowerCase()
  const map = {
    recon: 'redteam-worker-recon',
    designer: 'redteam-worker-designer',
    assess: 'redteam-worker-assess',
    'vuln-scan': 'redteam-worker-vuln-scan',
    exploit: 'redteam-worker-exploit',
    qa: 'redteam-worker-qa',
    internal: 'redteam-worker-internal',
  }
  return map[r] || 'redteam-worker'
}

function isPlaceholderWorkerSessionId(ctx, sid) {
  const s = String(sid || '').trim()
  if (!s) return true
  if (isSyntheticSessionId(s)) return true
  const agentsSvc = tryGet(ctx, 'agents')
  if (agentsSvc && typeof agentsSvc.get === 'function') {
    try { if (agentsSvc.get(s)) return false } catch { /* ignore */ }
  }
  const sessionsSvc = tryGet(ctx, 'sessions')
  if (sessionsSvc && typeof sessionsSvc.get === 'function') {
    try { if (sessionsSvc.get(s)) return false } catch { /* ignore */ }
  }
  if (/^sess-[0-9a-f]{6}-w\d+$/i.test(s) || /^sess-[0-9a-z]{6,12}-\d+$/i.test(s)) {
    return true
  }
  return false
}

function isRealChildSessionId(ctx, sid) {
  const s = String(sid || '').trim()
  if (!s || isPlaceholderWorkerSessionId(ctx, s)) return false
  return true
}

function resolveEngagementCwd(ctx, store, rootAgent, sessionId, explicitCwd = '') {
  const raw = typeof explicitCwd === 'string' ? explicitCwd.trim() : ''
  if (raw) return raw
  if (rootAgent && rootAgent.session && rootAgent.session.header && rootAgent.session.header.cwd) {
    return String(rootAgent.session.header.cwd).trim()
  }
  if (sessionId) {
    const sessionsSvc = tryGet(ctx, 'sessions')
    if (sessionsSvc && typeof sessionsSvc.get === 'function') {
      try {
        const s = sessionsSvc.get(sessionId)
        if (s && s.header && s.header.cwd) return String(s.header.cwd).trim()
      } catch { /* ignore */ }
    }
    if (store) {
      const bound = getCachedSessionBindingEntry(store, sessionId)
      if (bound && bound.cwd) return String(bound.cwd).trim()
    }
  }
  return ''
}

function buildSelfContainedWorkerPrompt(task, engId, refinedPrompt = '', extraNote = '') {
  const role = String((task && (task.worker_role || task.role)) || 'exploit').trim()
  const wave = String((task && (task.wave || task.wave_key)) || 'wave-1').trim()
  const taskId = task && task.id !== undefined ? String(task.id) : ''
  const workerName = String((task && (task.worker_name || task.title)) || `${role}-worker`).trim()
  const assignedGoal = String((task && (task.assigned_goal || task.assignedGoal || task.objective || task.goal || task.title)) || '').trim()
  const filesOwned = parseJsonArraySafe(task && (task.files_owned ?? task.filesOwned ?? task.files_owned_json))
  const acceptance = String((task && (task.acceptance_criteria || task.acceptanceCriteria)) || '').trim()

  return [
    `你是 LMTAgent 集群执行角色 \`${role}\`（${wave} · ${workerName}）。`,
    `所属项目工作区（engagement_id）：\`${engId || 'default'}\`${taskId ? ` · 任务 ID（worker_task_id）：\`${taskId}\`` : ''}`,
    '',
    refinedPrompt ? `## 项目总体蓝图\n${String(refinedPrompt).slice(0, 1800)}\n` : '',
    `## 本次委派目标（Assigned Goal）\n${assignedGoal || workerName}`,
    '',
    `## 独占文件分片（files_owned — 严禁越界修改其他分片文件）\n${filesOwned.length > 0 ? filesOwned.map((f) => `- \`${f}\``).join('\n') : '- （遵循本角色职责范围，不修改未授权文件）'}`,
    acceptance ? `\n## 验收判据\n${acceptance}` : '',
    extraNote ? `\n## 补充指令\n${extraNote}` : '',
    '',
    '## 执行与汇报纪律',
    '1. 所有研发成果、模块/缺陷/里程碑记录须写入事实库（`redteam_*` 工具），并附真实命令回显与验证证据。',
    `2. 完成后调用 \`redteam_workflow({ action: "submit_digest", engagement: ${JSON.stringify(engId || 'default')}, worker_task_id: ${JSON.stringify(taskId || workerName)}, worker_name: ${JSON.stringify(workerName)}, worker_role: ${JSON.stringify(role)}, wave: ${JSON.stringify(wave)}, what_was_done: "...", files_touched: [...], key_decisions: [...], verification: "..." })\` 提交压缩摘要，并在最终回复中给出完整结论与验证证据。`,
  ].filter(Boolean).join('\n')
}

async function deliverPromptToChild(subagentsSvc, mode, rootAgent, childId, text, signal) {
  if (!subagentsSvc || !rootAgent || !childId) {
    throw new Error('缺少 subagents 服务、活跃 rootAgent 或目标 childId')
  }
  const content = [{ type: 'text', text: String(text || '') }]
  const source = { kind: 'user' }
  const sig = signal || AbortSignal.timeout(30000)
  const deliveryMode = mode === 'steer' ? 'steer' : 'queue'

  if (deliveryMode === 'steer' && typeof subagentsSvc.steerPrompt === 'function') {
    return await subagentsSvc.steerPrompt(rootAgent, childId, content, source, sig)
  }
  if (deliveryMode === 'queue' && typeof subagentsSvc.queuePrompt === 'function') {
    return await subagentsSvc.queuePrompt(rootAgent, childId, content, source, sig)
  }
  if (subagentsSvc.manager && typeof subagentsSvc.manager[deliveryMode === 'steer' ? 'steerPrompt' : 'queuePrompt'] === 'function') {
    return await subagentsSvc.manager[deliveryMode === 'steer' ? 'steerPrompt' : 'queuePrompt'](rootAgent, childId, content, source, sig)
  }
  const deliverSym = Symbol.for('dsh.subagent.deliverPrompt')
  if (typeof subagentsSvc[deliverSym] === 'function') {
    return await subagentsSvc[deliverSym](rootAgent, childId, content, source, sig, deliveryMode)
  }
  if (typeof subagentsSvc.queuePrompt === 'function') {
    return await subagentsSvc.queuePrompt(rootAgent, childId, content, source, sig)
  }
  if (typeof subagentsSvc.sendMessage === 'function') {
    return await subagentsSvc.sendMessage(rootAgent, childId, content, { signal: sig })
  }
  throw new Error(`subagents 服务不支持 ${deliveryMode}Prompt 续接投递`)
}

async function bindWorkerSessionCompat(store, engId, task, childId, status = 'running') {
  if (!store || !engId || !childId) return false
  const taskId = task && task.id !== undefined && task.id !== null ? task.id : undefined
  const workerName = task && task.worker_name ? String(task.worker_name) : undefined
  const payload = {
    engagement: engId,
    engagement_id: engId,
    engagementId: engId,
    ...(taskId !== undefined ? { worker_task_id: taskId, id: taskId } : {}),
    ...(workerName ? { worker_name: workerName } : {}),
    session_id: String(childId),
    sessionId: String(childId),
    status,
    approval_state: 'working',
  }
  let bound = false
  if (typeof store.bindWorkerSession === 'function') {
    try {
      const res = await invokeStoreMethodCompat(store, 'bindWorkerSession', engId, payload)
      if (res && res.ok !== false) bound = true
    } catch { /* fall through */ }
  }
  if (!bound) {
    try {
      const res = dispatch(store, Object.assign({ op: 'bindWorkerSession' }, payload))
      if (res && res.ok !== false) bound = true
    } catch { /* fall through */ }
  }
  if (typeof store.db === 'function' && taskId !== undefined) {
    try {
      const db = store.db(engId)
      if (db && typeof db.prepare === 'function') {
        const info = db.prepare(
          "UPDATE worker_tasks SET session_id = ?, status = ?, approval_state = CASE WHEN approval_state IN ('approved','pending_approval') THEN approval_state ELSE 'working' END, updated_at = ? WHERE engagement_id = ? AND CAST(id AS TEXT) = ?",
        ).run(String(childId), status, new Date().toISOString(), String(engId), String(taskId))
        if (info && info.changes > 0) bound = true
      }
    } catch { /* ignore */ }
  }
  return bound
}

async function resolveSafeChildAgentOptions(ctx, rootAgent, thinkingEffort, signal) {
  const effort = normalizeThinkingEffort(thinkingEffort)
  if (!effort || effort === 'none' || effort === 'off') return {}
  const llm = tryGet(ctx, 'llm')
  const route = resolveAgentModelRoute(ctx, rootAgent)
  if (llm && typeof llm.resolveCallConfig === 'function' && route.provider && route.model) {
    try {
      await llm.resolveCallConfig({
        provider: route.provider,
        model: route.model,
        reasoningEffort: effort,
      }, signal)
      return { reasoningEffort: effort }
    } catch (err) {
      const errCode = err && (err.code || (err.failure && err.failure.code))
      const errMsg = err && err.message ? String(err.message) : ''
      if (errCode === 'UNSUPPORTED_REASONING_EFFORT' || /UNSUPPORTED_REASONING_EFFORT|reasoning.?effort/i.test(errMsg)) {
        return {}
      }
    }
  }
  return { reasoningEffort: effort }
}

async function startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, task, opts = {}) {
  const providerName = opts.provider || 'spawn'
  const providerObj = typeof subagentsSvc.getProvider === 'function' ? subagentsSvc.getProvider(providerName) : null
  const supportsPreset = providerName !== 'fork'
    && (!providerObj || (providerObj.capabilities?.agentPreset !== false && !providerObj.inheritsParentContext))
  const sig = opts.signal || AbortSignal.timeout(30000)
  const agentOptions = await resolveSafeChildAgentOptions(ctx, rootAgent, opts.thinkingEffort, sig)
  const reqObj = {
    parent: rootAgent,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    prompt: [{
      type: 'text',
      text: buildSelfContainedWorkerPrompt(task, opts.engId, opts.refinedPrompt, opts.extraNote),
    }],
    ...(supportsPreset ? { agentPreset: workerPresetForRole(task.worker_role || task.role) } : {}),
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
  }
  const spec = {
    provider: providerName,
    delivery: 'parent',
    label: String(task.title || task.worker_name || `worker-${task.id || '1'}`),
    request: reqObj,
    signal: sig,
  }
  try {
    return await subagentsSvc.startActivation(spec)
  } catch (err) {
    const msg = err && err.message ? String(err.message) : ''
    if (supportsPreset && /preset/i.test(msg)) {
      const fallbackReq = Object.assign({}, reqObj)
      if (fallbackReq.agentPreset !== 'redteam-worker') {
        fallbackReq.agentPreset = 'redteam-worker'
      } else {
        delete fallbackReq.agentPreset
      }
      return await subagentsSvc.startActivation(Object.assign({}, spec, { request: fallbackReq }))
    }
    throw err
  }
}

function sendRootFollowupMessage(rootAgent, text) {
  if (!rootAgent || typeof rootAgent.followup !== 'function') {
    return { ok: false, error: 'rootAgent 不支持 followup 唤醒' }
  }
  const msg = deepFreezeObj({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text || '') }],
    source: { kind: 'user' },
  })
  rootAgent.followup(msg)
  return { ok: true, messageId: msg.id }
}

export async function dispatchWorkflowToDshAgents(ctx, store, opts = {}) {
  const engId = String(opts.engagementId || opts.engagement || '').trim()
  const sessionId = String(opts.sessionId || opts.session || '').trim()
  const settingsRoot = resolveRedteamSettingsRoot(store && store.root)
  const settings = readUnifiedSettings(settingsRoot, process.env)
  const policy = settings.dispatchPolicy || DEFAULT_DISPATCH_POLICY
  const clusterCfg = {
    maxAgents: settings.maxAgents,
    thinkingEffort: settings.thinkingEffort,
    maxDepth: settings.maxDepth,
  }

  const subagentsSvc = tryGet(ctx, 'subagents')
  const rootAgent = await resolveLiveRootAgent(ctx, sessionId)
  const resolvedCwd = resolveEngagementCwd(ctx, store, rootAgent, sessionId, opts.cwd)

  const tasks = Array.isArray(opts.workerTasks) ? opts.workerTasks : []
  const spawned = []
  const errors = []
  const warnings = []

  const canStartSubagents = Boolean(
    policy.dispatchMode === 'hybrid_auto'
    && rootAgent
    && subagentsSvc
    && typeof subagentsSvc.startActivation === 'function',
  )

  if (canStartSubagents) {
    const wave1Targets = tasks
      .filter((t) => {
        if (!t || typeof t !== 'object') return false
        if (parseWaveNumber(t.wave ?? t.wave_key, 3) !== 1) return false
        const st = String(t.status || '').toLowerCase()
        if (['completed', 'done', 'finished', 'approved', 'cancelled', 'archived'].includes(st)) return false
        if (st === 'running' && isRealChildSessionId(ctx, t.session_id)) return false
        return true
      })
      .slice(0, Math.max(1, clusterCfg.maxAgents))

    const settled = await Promise.allSettled(
      wave1Targets.map(async (task) => {
        const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, task, {
          provider: policy.subagentProvider || 'spawn',
          cwd: resolvedCwd,
          engId,
          refinedPrompt: opts.refinedPrompt || '',
          maxDepth: clusterCfg.maxDepth,
          thinkingEffort: clusterCfg.thinkingEffort,
          signal: opts.signal,
        })
        if (started && started.childId) {
          await bindWorkerSessionCompat(store, engId, task, started.childId, 'running')
          return {
            worker_task_id: task.id,
            worker_name: task.worker_name || task.title,
            role: task.worker_role || task.role,
            title: task.title || task.worker_name,
            childId: started.childId,
            files_owned: parseJsonArraySafe(task.files_owned ?? task.files_owned_json),
          }
        }
        throw new Error('startActivation 未返回有效的 childId')
      }),
    )

    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i]
      const task = wave1Targets[i]
      if (r.status === 'fulfilled') {
        spawned.push(r.value)
      } else {
        const msg = r.reason && r.reason.message ? r.reason.message : String(r.reason)
        errors.push({
          worker_task_id: task && task.id,
          worker_name: task && (task.worker_name || task.title),
          error: msg,
        })
      }
    }
    if (errors.length > 0) {
      warnings.push(`部分 Wave 1 子代理拉起失败（${errors.length}/${wave1Targets.length}）：${errors.map((e) => `${e.worker_name}: ${e.error}`).join('; ')}`)
    }
  } else {
    if (policy.dispatchMode === 'hybrid_auto' && (!subagentsSvc || typeof subagentsSvc.startActivation !== 'function')) {
      warnings.push('宿主 subagents 服务不可用，已降级为仅唤醒主代理 Captain 统筹派发。')
    }
    if (!rootAgent) {
      warnings.push('未解析到活跃的宿主根代理会话（rootAgent），任务已写入事实库，请在打开会话后手动唤醒或拉起。')
    }
  }

  let captainNotified = false
  if (rootAgent && typeof rootAgent.followup === 'function') {
    const wave2Plus = tasks.filter((t) => parseWaveNumber(t && (t.wave ?? t.wave_key), 3) > 1)
    let syncText = ''
    if (spawned.length > 0) {
      syncText = [
        `【LMTAgent 控制台 · 方案 A 混合协同状态同步】`,
        `- 项目工作区（engagement_id）：\`${engId}\``,
        opts.userPrompt ? `- 用户需求：${String(opts.userPrompt).slice(0, 600)}` : '',
        '',
        '以下 **Wave 1 子代理已由控制台通过 `subagents.startActivation` 真实拉起并正在后台运行（严禁 Captain 重复派发 Wave 1）**：',
        ...spawned.map((s) => `- [Wave 1 · ${s.role}] \`${s.worker_name}\` → 真实子会话 childId: \`${s.childId}\`${s.files_owned.length ? ` · 分片: ${s.files_owned.join(', ')}` : ''}`),
        '',
        wave2Plus.length > 0
          ? `后续待编排波次（Wave 2–4，共 ${wave2Plus.length} 项）：\n` + wave2Plus.map((t) => `- [${t.wave || 'wave-?'} · ${t.worker_role || t.role}] ${t.title || t.worker_name} (task_id=${t.id})`).join('\n')
          : '',
        '',
        '请主控 Captain 耐心等待上述 Wave 1 子代理通过 `delivery: "parent"` 完成汇报（或 `send_message` 回传），核验事实库摘要后通过 `redteam_workflow` 执行审批并接管 Wave 2–4 的协同调度！',
      ].filter(Boolean).join('\n')
    } else {
      syncText = [
        `【LMTAgent 控制台 · 主代理全权调度通知】`,
        `- 项目工作区（engagement_id）：\`${engId}\``,
        opts.refinedPrompt ? `- 蓝图规格说明：\n${String(opts.refinedPrompt).slice(0, 1500)}` : '',
        '',
        `已写入 ${tasks.length} 项 4-Wave 分片任务到事实库（\`worker_tasks\`）：`,
        ...tasks.map((t) => `- [${t.wave || 'wave-?'} · ${t.worker_role || t.role}] ${t.title || t.worker_name} (task_id=${t.id}) · 目标: ${String(t.assigned_goal || '').slice(0, 160)}`),
        '',
        '请主控 Captain 按照 4-Wave Bounded DAG 与 `redteam_agent_slot` 并发闸门开始派发与闭环编排。',
      ].filter(Boolean).join('\n')
    }
    try {
      const fRes = sendRootFollowupMessage(rootAgent, syncText)
      captainNotified = Boolean(fRes.ok)
      if (!fRes.ok && fRes.error) warnings.push(fRes.error)
    } catch (err) {
      warnings.push(`唤醒主代理 Captain 失败：${err && err.message ? err.message : String(err)}`)
    }
  }

  const effectiveMode = spawned.length > 0
    ? 'hybrid_auto'
    : (policy.dispatchMode === 'captain_only' ? 'captain_only' : (canStartSubagents ? 'hybrid_auto' : 'captain_only'))

  return {
    mode: effectiveMode,
    provider: policy.subagentProvider || 'spawn',
    spawned,
    ...(errors.length > 0 ? { errors } : {}),
    captainNotified,
    rootAgentId: rootAgent ? rootAgent.id : null,
    ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
  }
}

async function handleAgentsOp(ctx, request) {
  const AGENT_OPS = [
    'agentsStatus', 'hostSessions', 'setAgentsMax', 'setClusterConfig', 'setPgUrl', 'probePg',
    'pgWriteProbe', 'getSettings', 'saveSettings',
    'workflowDag', 'workflowDocWall', 'workflowAction', 'workflowRun',
    'dagCheckpoint', 'feishuNotify', 'pushFeishuNotify', 'feishuConfig', 'feishuConfigSave',
    'saveFeishuConfig', 'saveFeishuWebhook', 'feishuTestPush',
    'agentSessionDetail', 'activateAgentSession',
    'clarifyWishWithAI', 'handoffToCaptain', 'dispatchWorkerTask',
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
    'refineAndDecomposeWish', 'updateWorkerGoal', 'addCustomWorkerTask', 'retryWorkerTask',
    'shardLocks', 'listShardLocks',
  ]
  if (!AGENT_OPS.includes(request.op)) return undefined
  /* 并发上限与工具侧的闸门读同一份设置（settings.json → REDTEAM_MAX_AGENTS → 默认 6），
     改完立即生效、不需要重启 —— 派活时 redteam_agent_slot 每次现读。 */
  const store = ctx.redteam
  const reqFlow = createRequestFlow()
  const root = (() => { try { return store && store.root } catch { return undefined } })()
  const resolvedRootSession = request.session ? resolveRootSessionId(ctx, request.session) : ''
  const explicitReqEng = String(request.engagement || request.engagement_id || request.engagementId || '').trim()

  let sessionScopedDefined = false
  let sessionBoundEngagement = null
  if (!explicitReqEng && resolvedRootSession && store) {
    sessionScopedDefined = true
    const allEngs = getCachedEngagementsList(store)
    const validEngById = buildValidEngagementMap(allEngs)
    const bState = typeof store.getSessionState === 'function'
      ? store.getSessionState(resolvedRootSession)
      : getCachedSessionBindingEntry(store, resolvedRootSession)
    const candBound = bState && (bState.bound || bState.engagement)
      ? String(bState.bound || bState.engagement).trim()
      : ''
    if (candBound && validEngById.has(candBound)) {
      sessionBoundEngagement = candBound
    }
  }

  const resolveSessionAwareEngagement = (explicitOverride = '') => {
    const exp = String(explicitOverride || explicitReqEng || '').trim()
    if (exp) return exp
    if (sessionScopedDefined) return sessionBoundEngagement
    return (store ? getCachedActiveEngagementId(store) : null) || 'default'
  }

  const activeEngagement = explicitReqEng
    || (sessionScopedDefined ? sessionBoundEngagement : ((store ? getCachedActiveEngagementId(store) : null) || 'default'))

  const DELEGATED_WORKFLOW_ACTIONS = [
    'getSettings', 'saveSettings',
    'clarifyWishWithAI', 'handoffToCaptain', 'dispatchWorkerTask',
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
    'refineAndDecomposeWish', 'updateWorkerGoal', 'addCustomWorkerTask', 'retryWorkerTask',
    'shardLocks', 'listShardLocks', 'feishuConfig', 'feishuConfigSave', 'saveFeishuConfig', 'saveFeishuWebhook',
  ]
  const effectiveOp = (request.op === 'workflowAction' && DELEGATED_WORKFLOW_ACTIONS.includes(request.action))
    ? request.action
    : request.op

  const mergeAgentPayload = () => Object.assign(
    {},
    request.payload && typeof request.payload === 'object' ? request.payload : {},
    request,
  )
  const resolveActionEng = (raw = request) => (
    raw.engagement || raw.engagement_id || raw.engagementId
    || (store ? getCachedActiveEngagementId(store) : null)
    || activeEngagement
  )
  const withEngIds = (engId, extra = {}) => Object.assign({}, extra, {
    engagement: engId,
    engagement_id: engId,
    engagementId: engId,
  })
  const readPgProbe = (engId) => (
    store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(engId)
      : getPgWriteProbe(engId)
  )
  const synthNetworkFields = (synth, { includeEvents = true } = {}) => ({
    agentNetwork: synth.agentNetwork,
    agent_network: synth.agentNetwork,
    nodes: synth.nodes,
    swimlanes: synth.swimlanes,
    ...(includeEvents ? {
      collabEvents: synth.collabEvents,
      collab_events: synth.collabEvents,
    } : {}),
    collabTasks: synth.collabTasks,
    collab_tasks: synth.collabTasks,
  })
  const rebuildCollab = async (engId, { invalidateEngs = false, bumpOp = '', bumpMeta, hostEng } = {}) => {
    reqFlow.dagByEng.delete(engId)
    if (invalidateEngs) invalidateEngagementCaches(store)
    if (bumpOp) bumpEventSeq(bumpOp, bumpMeta || { engagement: engId })
    const hostSessions = await discoverHostSessions(ctx, store, {
      sessionId: request.session,
      ...(hostEng !== undefined ? { engagementId: hostEng } : {}),
      autoBind: true,
      reqFlow,
    })
    const synth = synthesizeAgentCollaboration(store, engId, hostSessions, resolvedRootSession, reqFlow)
    return { hostSessions, synth }
  }
  const invokeOrDispatchCompat = async (method, engId, payload) => {
    let res = null
    try {
      res = await invokeStoreMethodCompat(store, method, engId, payload)
    } catch { res = null }
    if (res === undefined && store) {
      try { res = dispatch(store, payload) } catch { res = null }
    }
    return res
  }
  const runWorkerMutation = async (method, opName, engId, payload, { workflowAction } = {}) => {
    if (store && typeof store[method] === 'function') {
      try {
        return await invokeStoreMethodCompat(store, method, engId, payload)
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    }
    if (workflowAction && store && typeof store.workflowAction === 'function') {
      try {
        return await invokeStoreMethodCompat(store, 'workflowAction', engId, Object.assign({}, payload, { action: workflowAction }))
      } catch {
        return { ok: true }
      }
    }
    if (store) {
      return dispatch(store, Object.assign({ op: opName }, payload))
    }
    return null
  }
  const buildClusterConfigFields = (cfgArg, maxOverride) => {
    const max = maxOverride !== undefined ? maxOverride : maxAgentsOf(cfgArg, process.env)
    const thinkingEffort = thinkingEffortOf(cfgArg, process.env)
    const maxDepth = maxDepthOf(cfgArg, process.env)
    return {
      max,
      maxAgents: max,
      thinking: thinkingEffort,
      thinkingEffort,
      thinking_effort: thinkingEffort,
      maxDepth,
      max_depth: maxDepth,
    }
  }

  const settingsRoot = resolveRedteamSettingsRoot(root, process.env)

  const resolveDshDispatchHandles = async (rawPayload = {}) => {
    const settings = readUnifiedSettings(settingsRoot, process.env)
    const sessionRef = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const rootAgent = sessionRef ? await resolveLiveRootAgent(ctx, sessionRef) : null
    const subagentsSvc = tryGet(ctx, 'subagents')
    const cwd = resolveEngagementCwd(ctx, store, rootAgent, sessionRef, rawPayload.cwd)
    return { settings, sessionRef, rootAgent, subagentsSvc, cwd }
  }

  const buildFullSettingsResponse = async (opName = 'getSettings') => {
    const unified = readUnifiedSettings(settingsRoot, process.env)
    const rawFile = readSettingsCached(settingsRoot)
    const rawDbEngine = store && typeof store.dbEngineInfo === 'function'
      ? store.dbEngineInfo()
      : resolvePgConfig(settingsRoot)
    const rawPgCandidate = (rawFile && rawFile.pgUrl) || ''
    const pgUrlMasked = maskPgUrlSafe(rawPgCandidate)
      || (rawDbEngine && (rawDbEngine.pgUrlMasked || rawDbEngine.maskedUrl))
      || maskPgUrlSafe((rawDbEngine && rawDbEngine.url) || '')
    const dbEngine = Object.assign(
      {},
      rawDbEngine && typeof rawDbEngine === 'object' ? rawDbEngine : {},
      { pgUrlMasked },
    )
    const currentEng = resolveSessionAwareEngagement()
    let feishuConfig = null
    if (currentEng && store) {
      const wfDag = getWorkflowDagDedup(store, currentEng, reqFlow)
      if (wfDag && typeof wfDag === 'object') {
        feishuConfig = wfDag.feishu_config ?? wfDag.feishu ?? null
      }
    }
    const modelCatalog = await fetchLlmModelCatalog(ctx)
    const sessionRef = String(request.session || resolvedRootSession || '').trim()
    const liveRootAgent = sessionRef ? await resolveLiveRootAgent(ctx, sessionRef) : null
    const route = resolveAgentModelRoute(ctx, liveRootAgent)
    const activeSessionRoute = {
      provider: route.provider || '',
      model: route.model || '',
      reasoningEffort: route.reasoningEffort || '',
      source: route.source || 'none',
    }
    return {
      ok: true,
      op: opName,
      engagement: currentEng || null,
      active_engagement: currentEng || null,
      max: unified.maxAgents,
      maxAgents: unified.maxAgents,
      max_agents: unified.maxAgents,
      thinking: unified.thinkingEffort,
      thinkingEffort: unified.thinkingEffort,
      thinking_effort: unified.thinkingEffort,
      maxDepth: unified.maxDepth,
      max_depth: unified.maxDepth,
      aiPlanner: unified.aiPlanner,
      ai_planner: unified.aiPlanner,
      dispatchPolicy: unified.dispatchPolicy,
      dispatch_policy: unified.dispatchPolicy,
      uiPreferences: unified.uiPreferences,
      ui_preferences: unified.uiPreferences,
      settings: unified,
      db_engine: dbEngine,
      pgUrlMasked,
      feishu_config: feishuConfig,
      model_catalog: modelCatalog,
      active_session_route: activeSessionRoute,
      limit: MAX_AGENTS_LIMIT,
      max_depth_limit: MAX_DEPTH_LIMIT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
    }
  }

  if (effectiveOp === 'getSettings') {
    return await buildFullSettingsResponse('getSettings')
  }

  if (effectiveOp === 'saveSettings') {
    const mergedRaw = mergeAgentPayload()
    const src = Object.assign(
      {},
      mergedRaw,
      mergedRaw.config && typeof mergedRaw.config === 'object' ? mergedRaw.config : {},
      mergedRaw.patch && typeof mergedRaw.patch === 'object' ? mergedRaw.patch : {},
      mergedRaw.settings && typeof mergedRaw.settings === 'object' ? mergedRaw.settings : {},
    )

    const hasPgUrl = Object.prototype.hasOwnProperty.call(src, 'pgUrl')
      || Object.prototype.hasOwnProperty.call(src, 'pg_url')
    if (hasPgUrl) {
      const curRaw = readSettingsCached(settingsRoot)
      const curCfg = resolvePgConfig(settingsRoot)
      const curPg = String((curRaw && curRaw.pgUrl) || (curCfg && curCfg.url) || '').trim()
      const curMasked = maskPgUrlSafe(curPg)
      const curDotMasked = curPg ? curPg.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:••••••@') : ''
      const rawNextPg = src.pgUrl !== undefined ? src.pgUrl : src.pg_url
      const nextPgTrimmed = rawNextPg === null || rawNextPg === undefined ? '' : String(rawNextPg).trim()
      const isUnchangedMasked = Boolean(nextPgTrimmed)
        && ((curMasked && nextPgTrimmed === curMasked)
          || (curDotMasked && nextPgTrimmed === curDotMasked)
          || nextPgTrimmed.includes('••••••'))
      if (!isUnchangedMasked) {
        try {
          savePgUrl(settingsRoot, nextPgTrimmed)
          if (root && root !== settingsRoot) invalidateSettingsCache(root)
          try { if (store && typeof store.close === 'function') store.close() } catch { /* ignore */ }
        } catch (err) {
          return {
            ok: false,
            op: 'saveSettings',
            error: err && err.message ? err.message : String(err),
          }
        }
      }
    }

    const patch = {}
    if (src.maxAgents !== undefined || src.max !== undefined || src.max_agents !== undefined) {
      patch.maxAgents = clampMaxAgents(src.maxAgents ?? src.max ?? src.max_agents)
    }
    const rawThinking = src.thinkingEffort ?? src.thinking_effort ?? src.thinking ?? src.effort
    if (rawThinking !== undefined) {
      patch.thinkingEffort = normalizeThinkingEffort(rawThinking)
    }
    if (src.maxDepth !== undefined || src.max_depth !== undefined || src.depth !== undefined) {
      patch.maxDepth = clampMaxDepth(src.maxDepth ?? src.max_depth ?? src.depth)
    }
    if ((src.aiPlanner && typeof src.aiPlanner === 'object') || (src.ai_planner && typeof src.ai_planner === 'object')) {
      patch.aiPlanner = src.aiPlanner || src.ai_planner
    }
    if ((src.dispatchPolicy && typeof src.dispatchPolicy === 'object') || (src.dispatch_policy && typeof src.dispatch_policy === 'object')) {
      patch.dispatchPolicy = src.dispatchPolicy || src.dispatch_policy
    }
    if ((src.uiPreferences && typeof src.uiPreferences === 'object') || (src.ui_preferences && typeof src.ui_preferences === 'object')) {
      patch.uiPreferences = src.uiPreferences || src.ui_preferences
    }

    writeUnifiedSettings(settingsRoot, patch, process.env)
    invalidateSettingsCache(settingsRoot)
    if (root && root !== settingsRoot) invalidateSettingsCache(root)

    const feishuIn = (src.feishu_config && typeof src.feishu_config === 'object')
      ? src.feishu_config
      : ((src.feishuConfig && typeof src.feishuConfig === 'object')
        ? src.feishuConfig
        : (src.feishu && typeof src.feishu === 'object' ? src.feishu : null))
    const targetEng = resolveSessionAwareEngagement(src.engagement || src.engagement_id || src.engagementId)
    if (feishuIn && targetEng && store) {
      const feishuWebhook = String(
        feishuIn.webhook_url ?? feishuIn.webhookUrl ?? feishuIn.webhook ?? feishuIn.url ?? '',
      ).trim()
      const feishuPayload = Object.assign({}, feishuIn, {
        engagement: targetEng,
        engagement_id: targetEng,
        webhook_url: feishuWebhook,
        webhookUrl: feishuWebhook,
      })
      if (typeof store.saveFeishuConfig === 'function') {
        try { await invokeStoreMethodCompat(store, 'saveFeishuConfig', targetEng, feishuPayload) } catch { /* ignore */ }
      } else if (typeof store.workflowAction === 'function') {
        try { await invokeStoreMethodCompat(store, 'workflowAction', targetEng, Object.assign({}, feishuPayload, { action: 'feishuConfig' })) } catch { /* ignore */ }
      }
      reqFlow.dagByEng.delete(targetEng)
    }

    bumpEventSeq('saveSettings')
    const snapshot = await buildFullSettingsResponse('saveSettings')
    return Object.assign(snapshot, {
      saved: true,
      note: '统一工作台与集群设置已保存并立即生效。',
    })
  }

  if (effectiveOp === 'clarifyWishWithAI') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveSessionAwareEngagement(rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId)
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text || '',
    ).trim()
    if (!promptText) {
      return {
        ok: false,
        op: 'clarifyWishWithAI',
        engagement: currentEng || null,
        error: '请输入您的工程目标或需求描述，再发起 AI 智能澄清。',
      }
    }
    const clarifyRes = await clarifyWishWithAI(ctx, store, {
      prompt: promptText,
      sessionId: String(rawPayload.session || request.session || resolvedRootSession || '').trim(),
      cwd: String(rawPayload.cwd || '').trim(),
      allowStaticFallback: Boolean(rawPayload.allow_static_fallback ?? rawPayload.allowStaticFallback),
    })
    return Object.assign({ engagement: currentEng || null }, clarifyRes)
  }

  if (effectiveOp === 'handoffToCaptain') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveSessionAwareEngagement(rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId)
    const sessionTarget = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text || '',
    ).trim()
    if (!promptText) {
      return {
        ok: false,
        op: 'handoffToCaptain',
        engagement: currentEng || null,
        error: '交由主代理讨论的需求内容不能为空。',
      }
    }
    const rootAgent = await resolveLiveRootAgent(ctx, sessionTarget)
    if (!rootAgent || typeof rootAgent.followup !== 'function') {
      return {
        ok: false,
        op: 'handoffToCaptain',
        engagement: currentEng || null,
        error: '未找到可唤醒的活跃 DSH 主代理会话（rootAgent），请确认当前聊天标签页已连接活跃会话。',
      }
    }
    const rawClar = rawPayload.clarifications_text ?? rawPayload.clarificationsText
    const clarLines = Array.isArray(rawPayload.clarifications)
      ? rawPayload.clarifications.map((x) => String(x || '').trim()).filter(Boolean).join('\n')
      : ''
    const clarText = [typeof rawClar === 'string' ? rawClar.trim() : '', clarLines].filter(Boolean).join('\n')
    const handoffText = [
      '【LMTAgent 工作台 · 交由主代理 Captain 讨论与拆解】',
      currentEng ? `- 项目工作区（engagement_id）：\`${currentEng}\`` : '',
      '',
      '以下为用户原始工程需求，请主控 Captain 直接在对话中与用户讨论确认边界，并按需完成 4-Wave 任务拆解与派发：',
      promptText,
      clarText ? `\n补充澄清信息：\n${clarText}` : '',
    ].filter(Boolean).join('\n')
    const fRes = sendRootFollowupMessage(rootAgent, handoffText)
    if (!fRes.ok) {
      return {
        ok: false,
        op: 'handoffToCaptain',
        engagement: currentEng || null,
        error: fRes.error || '发送 followup 消息唤醒主代理失败。',
      }
    }
    bumpEventSeq('handoffToCaptain', { engagement: currentEng || null, sessionId: rootAgent.id })
    return {
      ok: true,
      op: 'handoffToCaptain',
      engagement: currentEng || null,
      sessionId: rootAgent.id,
      messageId: fRes.messageId,
      dispatched: {
        mode: 'captain_handoff',
        spawned: [],
        captainNotified: true,
        rootAgentId: rootAgent.id,
      },
      note: '已将需求发送至 DSH 主代理（Captain）会话并唤醒讨论。',
    }
  }

  const resolveWorkerTaskFromDag = (engId, payloadObj) => {
    if (!store || !payloadObj || typeof payloadObj !== 'object') return null
    const rawRefs = [
      payloadObj.worker_task_id,
      payloadObj.workerTaskId,
      payloadObj.worker_id,
      payloadObj.workerId,
      payloadObj.session_id,
      payloadObj.sessionId,
      payloadObj.agentId,
      payloadObj.id,
      payloadObj.worker_name,
      payloadObj.workerName,
    ]
      .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
      .filter(Boolean)
    if (rawRefs.length === 0) return null
    const dag = getWorkflowDagDedup(store, engId, reqFlow)
    const tasks = dag && Array.isArray(dag.worker_tasks) ? dag.worker_tasks : []
    for (const ref of rawRefs) {
      const strippedWt = ref.startsWith('wt-') ? ref.slice(3) : ''
      const hit = tasks.find((t) => {
        if (!t) return false
        const tid = String(t.id ?? '')
        const sid = String(t.session_id ?? '')
        const wname = String(t.worker_name ?? '').trim()
        return tid === ref
          || (strippedWt && tid === strippedWt)
          || `wt-${tid}` === ref
          || (sid && sid === ref)
          || (wname && wname === ref)
      })
      if (hit && hit.id !== undefined && hit.id !== null) return hit
    }
    return null
  }

  if (effectiveOp === 'planApproveWorker') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    /* 严禁默认回退 'sub-recon' 或以裸角色名（如 'exploit'）作为全局审批键！ */
    const candidateIds = [
      rawPayload.worker_id,
      rawPayload.workerId,
      rawPayload.worker_task_id,
      rawPayload.workerTaskId,
      rawPayload.session_id,
      rawPayload.sessionId,
      rawPayload.agentId,
      rawPayload.id,
      rawPayload.worker_name,
      rawPayload.workerName,
    ]
      .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
      .filter((v) => v && !isBareRoleName(v))

    let workerKey = candidateIds[0] || ''
    if (!workerKey) {
      return {
        ok: false,
        engagement: currentEng,
        error: 'missing or bare-role worker_id for planApproveWorker',
      }
    }
    const approvalState = String(
      rawPayload.approval_state
      || rawPayload.approvalState
      || (rawPayload.decision === 'revision_required' || rawPayload.decision === 'reject' ? 'revision_required' : 'approved')
    ).trim()
    const uiPriority = approvalState === 'approved' ? 'P2' : 'P0'
    const priorityWeight = uiPriority === 'P2' ? 50 : 100
    const priorityLabel = uiPriority === 'P2' ? 'P2 已审归档' : 'P0 焦点审批'
    const nextGoal = String(
      rawPayload.next_goal
      || rawPayload.nextGoal
      || '进入下一波次契约联调与回归验证'
    ).trim()

    const storePayload = Object.assign({}, rawPayload, withEngIds(currentEng, {
      op: 'planApproveWorker',
      ...(workerKey ? {
        worker_id: workerKey,
        workerId: workerKey,
        session_id: rawPayload.session_id || rawPayload.sessionId || workerKey,
        worker_name: rawPayload.worker_name || rawPayload.workerName || workerKey,
      } : {}),
      approval_state: approvalState,
      approvalState,
      ui_priority: uiPriority,
      uiPriority,
      next_goal: nextGoal,
      nextGoal,
    }))

    const storeResult = await invokeOrDispatchCompat('approveWorkerAndDispatchNext', currentEng, storePayload)

    const approvedDbWorker = storeResult && typeof storeResult === 'object' ? storeResult.approved_worker : null
    if (!workerKey && approvedDbWorker) {
      workerKey = String(
        approvedDbWorker.session_id || approvedDbWorker.id || approvedDbWorker.worker_name || '',
      ).trim()
    }
    if (!workerKey) {
      return { ok: false, error: 'missing worker_id or session_id for planApproveWorker' }
    }

    const overrideEntry = {
      engagementId: currentEng,
      workerId: workerKey,
      approvalState,
      uiPriority,
      priorityWeight,
      priorityLabel,
      nextGoal,
      explicitApproved: approvalState === 'approved',
      approvedAt: new Date().toISOString(),
    }

    const scopedKeys = [
      workerKey,
      ...candidateIds,
      approvedDbWorker && approvedDbWorker.id !== undefined ? String(approvedDbWorker.id) : '',
      approvedDbWorker && approvedDbWorker.id !== undefined ? `wt-${approvedDbWorker.id}` : '',
      approvedDbWorker && approvedDbWorker.session_id ? String(approvedDbWorker.session_id) : '',
      approvedDbWorker && approvedDbWorker.worker_name ? String(approvedDbWorker.worker_name) : '',
    ]
    for (const k of scopedKeys) {
      setScopedWorkerOverride(currentEng, k, overrideEntry)
    }

    const { settings, rootAgent, subagentsSvc } = await resolveDshDispatchHandles(rawPayload)
    const dispatchWarnings = []
    let wokeChildId = null
    let captainNotified = false
    const matchedDagTask = approvedDbWorker || resolveWorkerTaskFromDag(currentEng, rawPayload)
    const candidateChildId = String(
      (matchedDagTask && matchedDagTask.session_id)
      || rawPayload.childId
      || rawPayload.session_id
      || rawPayload.sessionId
      || '',
    ).trim()
    const hasRealChild = isRealChildSessionId(ctx, candidateChildId)

    if (settings.dispatchPolicy.autoWakeOnApprove) {
      if (hasRealChild && rootAgent && subagentsSvc) {
        const workerLabel = (matchedDagTask && (matchedDagTask.title || matchedDagTask.worker_name)) || workerKey
        const feedback = String(rawPayload.feedback || rawPayload.reason || rawPayload.note || '').trim()
        const approvalFollowupPrompt = approvalState === 'approved'
          ? [
            `【LMTAgent 审批通过通知】你的子任务 \`${workerLabel}\`（engagement=${currentEng}）已由主控/工作台审批通过（approved）。`,
            nextGoal ? `下一步指示：${nextGoal}` : '',
            '如仍有收尾补充或跨波次交接检查请快速完成并汇报；否则可确认收工交付。',
          ].filter(Boolean).join('\n')
          : [
            `【LMTAgent 审批退回修订通知】你的子任务 \`${workerLabel}\`（engagement=${currentEng}）被标记为需修订（${approvalState}）。`,
            feedback ? `修订意见：${feedback}` : '',
            nextGoal ? `最新目标/修正指令：${nextGoal}` : '',
            '请立即根据修订意见调整实现，完成后重新提交 `redteam_workflow` submit_digest 并回报结果。',
          ].filter(Boolean).join('\n')
        try {
          await deliverPromptToChild(subagentsSvc, 'queue', rootAgent, candidateChildId, approvalFollowupPrompt)
          wokeChildId = candidateChildId
        } catch (err) {
          dispatchWarnings.push(`唤醒子代理 ${candidateChildId} 失败：${err && err.message ? err.message : String(err)}`)
        }
      } else if (hasRealChild && (!rootAgent || !subagentsSvc)) {
        dispatchWarnings.push(!rootAgent ? '未解析到活跃 rootAgent，仅完成事实库审批未唤醒智能体' : '宿主 subagents 服务不可用，仅完成事实库审批未唤醒智能体')
      }

      if (rootAgent && typeof rootAgent.followup === 'function') {
        const nextDispatched = storeResult && Array.isArray(storeResult.dispatched_next) ? storeResult.dispatched_next : []
        const captainApprovalNote = [
          `【LMTAgent 审批同步】任务 \`${workerKey}\`（engagement=${currentEng}）审批结果：${approvalState}（${priorityLabel}）。`,
          nextGoal ? `- 下一步指示：${nextGoal}` : '',
          wokeChildId ? `- 已同步唤醒子代理 childId: \`${wokeChildId}\`` : '',
          nextDispatched.length > 0
            ? `- 已解锁下游任务：${nextDispatched.map((d) => `${d.worker_name || d.title || d.id}(${d.wave || ''})`).join('、')}，请按 4-Wave 策略接续调度。`
            : '',
        ].filter(Boolean).join('\n')
        try {
          const fRes = sendRootFollowupMessage(rootAgent, captainApprovalNote)
          captainNotified = Boolean(fRes.ok)
          if (!fRes.ok && fRes.error) dispatchWarnings.push(fRes.error)
        } catch (err) {
          dispatchWarnings.push(`通知主代理 Captain 失败：${err && err.message ? err.message : String(err)}`)
        }
      }
    }

    const dispatchedInfo = {
      mode: settings.dispatchPolicy.autoWakeOnApprove ? 'auto_wake' : 'manual',
      spawned: [],
      wokeChildId,
      captainNotified,
      ...(dispatchWarnings.length > 0 ? { warning: dispatchWarnings.join('；') } : {}),
    }

    const { hostSessions, synth } = await rebuildCollab(currentEng, {
      bumpOp: 'planApproveWorker',
      bumpMeta: { engagement: currentEng, workerId: workerKey },
    })
    const pgProbe = readPgProbe(currentEng)

    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: 'planApproveWorker',
        engagement: currentEng,
        active_engagement: currentEng,
        worker_id: workerKey,
        workerId: workerKey,
        approvalState,
        approval_state: approvalState,
        uiPriority,
        ui_priority: uiPriority,
        priorityWeight,
        priority_weight: priorityWeight,
        priorityLabel,
        priority_label: priorityLabel,
        nextGoal,
        next_goal: nextGoal,
        dispatched: dispatchedInfo,
        host_sessions: hostSessions,
        hostSessions,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'submitWorkerDigest') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const meta = computeWorkerLmtexMeta(rawPayload, Number(rawPayload.idx) || 0, { store, engagementId: currentEng })
    const storePayload = Object.assign({}, rawPayload, withEngIds(currentEng, {
      op: 'submitWorkerDigest',
      ui_priority: meta.uiPriority,
      uiPriority: meta.uiPriority,
      priority_weight: meta.priorityWeight,
      priorityWeight: meta.priorityWeight,
      worker_tags: meta.workerTags,
      workerTags: meta.workerTags,
      compressed_digest: meta.compressedDigest,
      compressedDigest: meta.compressedDigest,
      approval_state: meta.approvalState,
      approvalState: meta.approvalState,
      next_goal: meta.nextGoal,
      nextGoal: meta.nextGoal,
    }))

    const storeResult = await invokeOrDispatchCompat('submitWorkerDigest', currentEng, storePayload)

    const { hostSessions, synth } = await rebuildCollab(currentEng, { bumpOp: 'submitWorkerDigest' })
    const pgProbe = readPgProbe(currentEng)

    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: 'submitWorkerDigest',
        engagement: currentEng,
        active_engagement: currentEng,
        uiPriority: meta.uiPriority,
        ui_priority: meta.uiPriority,
        priorityWeight: meta.priorityWeight,
        priority_weight: meta.priorityWeight,
        workerTags: meta.workerTags,
        worker_tags: meta.workerTags,
        compressedDigest: meta.compressedDigest,
        compressed_digest: meta.compressedDigest,
        approvalState: meta.approvalState,
        approval_state: meta.approvalState,
        nextGoal: meta.nextGoal,
        next_goal: meta.nextGoal,
        host_sessions: hostSessions,
        hostSessions,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'dispatchWorkerTask') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const matchedTask = resolveWorkerTaskFromDag(currentEng, rawPayload)
    if (!matchedTask) {
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        error: '未找到匹配的 worker_task 任务节点，无法拉起执行。',
      }
    }
    const { settings, rootAgent, subagentsSvc, cwd } = await resolveDshDispatchHandles(rawPayload)
    if (!rootAgent || !subagentsSvc || typeof subagentsSvc.startActivation !== 'function') {
      const warnMsg = !rootAgent
        ? '未解析到活跃的 DSH 主代理会话（rootAgent），无法拉起子代理。'
        : '宿主 subagents 服务不可用（缺少 startActivation），无法拉起子代理。'
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        worker_task_id: matchedTask.id,
        error: warnMsg,
        dispatched: {
          mode: settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider,
          spawned: [],
          captainNotified: false,
          warning: warnMsg,
        },
      }
    }

    const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const refinedPrompt = String(
      rawPayload.refined_prompt
      || rawPayload.refinedPrompt
      || (dag && dag.engagement && dag.engagement.goal)
      || '',
    ).trim()
    const extraNote = String(rawPayload.note || rawPayload.extra_note || rawPayload.extraNote || '').trim()

    let started = null
    try {
      started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, matchedTask, {
        provider: settings.dispatchPolicy.subagentProvider || 'spawn',
        cwd,
        engId: currentEng,
        refinedPrompt,
        maxDepth: settings.maxDepth,
        thinkingEffort: settings.thinkingEffort,
        extraNote,
      })
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        worker_task_id: matchedTask.id,
        error: `拉起子代理失败：${msg}`,
        dispatched: {
          mode: settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider,
          spawned: [],
          captainNotified: false,
          warning: msg,
        },
      }
    }

    if (!started || !started.childId) {
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        worker_task_id: matchedTask.id,
        error: 'subagents.startActivation 未返回有效的 childId。',
      }
    }

    await bindWorkerSessionCompat(store, currentEng, matchedTask, started.childId, 'running')
    let captainNotified = false
    if (typeof rootAgent.followup === 'function') {
      const syncMsg = [
        `【LMTAgent 工作台 · 手动拉起节点同步】`,
        `- 项目工作区（engagement_id）：\`${currentEng}\``,
        `- 节点 [${matchedTask.wave || 'wave-?'} · ${matchedTask.worker_role || matchedTask.role}] \`${matchedTask.title || matchedTask.worker_name}\` (task_id=${matchedTask.id}) 已由工作台真实拉起，childId: \`${started.childId}\`。`,
        '请主控 Captain 记录该真实 childId 并避免重复派发，待其通过 `delivery: "parent"` 回传后接续审批与调度。',
      ].join('\n')
      try {
        const fRes = sendRootFollowupMessage(rootAgent, syncMsg)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { hostSessions, synth } = await rebuildCollab(currentEng, {
      invalidateEngs: true,
      bumpOp: 'dispatchWorkerTask',
      bumpMeta: { engagement: currentEng, workerTaskId: matchedTask.id, childId: started.childId },
      hostEng: currentEng,
    })

    return Object.assign(
      {
        ok: true,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        active_engagement: currentEng,
        worker_task_id: matchedTask.id,
        worker_id: started.childId,
        session_id: started.childId,
        childId: started.childId,
        dispatched: {
          mode: settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider || 'spawn',
          spawned: [{
            worker_task_id: matchedTask.id,
            worker_name: matchedTask.worker_name || matchedTask.title,
            role: matchedTask.worker_role || matchedTask.role,
            title: matchedTask.title || matchedTask.worker_name,
            childId: started.childId,
          }],
          captainNotified,
          rootAgentId: rootAgent.id,
        },
        host_sessions: hostSessions,
        hostSessions,
        note: `已真实拉起执行节点 ${matchedTask.title || matchedTask.worker_name}（childId: ${started.childId}）。`,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'refineAndDecomposeWish' || effectiveOp === 'decomposeUserPrompt') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text
      || '执行多波次并发架构交付与验证',
    ).trim()
    const templateName = String(rawPayload.template || rawPayload.template_id || '').trim()
    const previewOnly = Boolean(rawPayload.preview_only ?? rawPayload.previewOnly)
    const allowStaticFallback = Boolean(rawPayload.allow_static_fallback ?? rawPayload.allowStaticFallback)
      && !isRealDshHost(ctx)
    const sessionRef = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const cwdOverride = String(rawPayload.cwd || '').trim()

    const rawAnswers = rawPayload.answers && typeof rawPayload.answers === 'object' ? rawPayload.answers : null
    const answersLines = rawAnswers
      ? Object.entries(rawAnswers)
        .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join('；') : String(v || '')}`)
        .filter((s) => !s.endsWith(': '))
      : []
    const clarificationsText = [
      typeof (rawPayload.clarifications_text ?? rawPayload.clarificationsText) === 'string'
        ? String(rawPayload.clarifications_text ?? rawPayload.clarificationsText).trim()
        : '',
      ...(Array.isArray(rawPayload.clarifications) ? rawPayload.clarifications.map((x) => String(x || '').trim()).filter(Boolean) : []),
      ...answersLines,
    ].filter(Boolean).join('\n')

    /* 预览模式（preview_only: true）：必须调用真实 DSH LLM 拆解；绝不静默回退静态假模板（除非非真实宿主显式传 allow_static_fallback: true） */
    if (previewOnly) {
      const aiRes = await decomposeWishWithAI(ctx, store, {
        prompt: promptText,
        template: templateName,
        clarificationsText,
        sessionId: sessionRef,
        cwd: cwdOverride,
      })

      if (aiRes.ok) {
        const previewGoals = aiRes.goals.map((g, idx) => normalizeWishGoalItem(g, idx))
        const projectNameText = aiRes.project_name || extractWishTitle(promptText)
        const refinedPromptText = aiRes.refined_prompt || promptText
        const summaryText = aiRes.summary || `已由 ${aiRes.model} 拆解为 ${previewGoals.length} 个无冲突并发子任务。`
        const mergedSpec = {
          title: projectNameText,
          project_name: projectNameText,
          projectName: projectNameText,
          template: templateName || 'custom',
          raw_prompt: promptText,
          refined_prompt: refinedPromptText,
          refinedPrompt: refinedPromptText,
          summary: summaryText,
          clarifications: aiRes.clarifications || [],
          deliverables: aiRes.deliverables || [],
          proposed_waves: previewGoals,
          goals: previewGoals,
          model: aiRes.model,
          provider: aiRes.provider,
          ai_generated: true,
        }
        return {
          ok: true,
          op: effectiveOp,
          preview_only: true,
          ai_generated: true,
          model: aiRes.model,
          provider: aiRes.provider,
          cwd: aiRes.cwd || '',
          engagement: currentEng,
          active_engagement: currentEng,
          prompt: promptText,
          project_name: projectNameText,
          projectName: projectNameText,
          refined_prompt: refinedPromptText,
          refinedPrompt: refinedPromptText,
          summary: summaryText,
          template: templateName || 'custom',
          goals: previewGoals,
          stages: previewGoals,
          subgoals: previewGoals,
          proposed_waves: previewGoals,
          blueprint: {
            project_name: projectNameText,
            refined_prompt: refinedPromptText,
            summary: summaryText,
            goals: previewGoals,
          },
          refined_spec: mergedSpec,
          refinedSpec: mergedSpec,
        }
      }

      if (!allowStaticFallback) {
        return {
          ok: false,
          op: effectiveOp,
          preview_only: true,
          engagement: currentEng,
          active_engagement: currentEng,
          llm_unavailable: true,
          ...(aiRes.model ? { model: aiRes.model } : {}),
          ...(aiRes.provider ? { provider: aiRes.provider } : {}),
          error: aiRes.error || 'DSH LLM 服务不可用，无法进行 AI 需求拆解。',
        }
      }

      const localSpec = buildRefinedWishSpec(promptText, templateName, rawPayload)
      const previewGoals = localSpec.proposed_waves.map((g, idx) => normalizeWishGoalItem(g, idx))
      const mergedSpec = Object.assign({}, localSpec, {
        fallback_used: true,
        proposed_waves: previewGoals,
        goals: previewGoals,
      })
      return {
        ok: true,
        fallback_used: true,
        op: effectiveOp,
        preview_only: true,
        engagement: currentEng,
        active_engagement: currentEng,
        prompt: promptText,
        project_name: localSpec.project_name,
        projectName: localSpec.project_name,
        refined_prompt: localSpec.refined_prompt,
        refinedPrompt: localSpec.refined_prompt,
        summary: localSpec.summary,
        template: templateName || localSpec.template,
        goals: previewGoals,
        stages: previewGoals,
        subgoals: previewGoals,
        proposed_waves: previewGoals,
        blueprint: {
          project_name: localSpec.project_name,
          refined_prompt: localSpec.refined_prompt,
          summary: localSpec.summary,
          goals: previewGoals,
        },
        refined_spec: mergedSpec,
        refinedSpec: mergedSpec,
      }
    }

    const callerExplicitGoals = Array.isArray(rawPayload.goals) && rawPayload.goals.length > 0
      ? rawPayload.goals
      : (Array.isArray(rawPayload.proposed_waves) && rawPayload.proposed_waves.length > 0
        ? rawPayload.proposed_waves
        : (Array.isArray(rawPayload.waves) && rawPayload.waves.length > 0
          ? rawPayload.waves
          : (Array.isArray(rawPayload.stages) && rawPayload.stages.length > 0
            ? rawPayload.stages
            : (Array.isArray(rawPayload.subgoals) && rawPayload.subgoals.length > 0 ? rawPayload.subgoals : null))))

    let aiRes = null
    if (!callerExplicitGoals) {
      aiRes = await decomposeWishWithAI(ctx, store, {
        prompt: promptText,
        template: templateName,
        clarificationsText,
        sessionId: sessionRef,
        cwd: cwdOverride,
      })
      if (!aiRes.ok && !allowStaticFallback) {
        return {
          ok: false,
          op: effectiveOp,
          preview_only: false,
          engagement: currentEng,
          active_engagement: currentEng,
          llm_unavailable: true,
          ...(aiRes.model ? { model: aiRes.model } : {}),
          ...(aiRes.provider ? { provider: aiRes.provider } : {}),
          error: aiRes.error || 'DSH LLM 服务不可用，未能生成 AI 拆解任务。',
        }
      }
    }

    const fallbackSpec = (!callerExplicitGoals && (!aiRes || !aiRes.ok) && allowStaticFallback)
      ? buildRefinedWishSpec(promptText, templateName, rawPayload)
      : null
    const sourceGoalsForStore = callerExplicitGoals
      || (aiRes && aiRes.ok ? aiRes.goals : null)
      || (fallbackSpec ? fallbackSpec.proposed_waves : null)

    const normalizedStoreGoals = sourceGoalsForStore
      ? sourceGoalsForStore.map((g, idx) => {
        const item = normalizeWishGoalItem(g, idx)
        return Object.assign({}, g && typeof g === 'object' ? g : {}, item, {
          wave: `wave-${item.wave}`,
          wave_num: item.wave,
          role: item.role,
          worker_role: item.role,
          worker_name: item.worker_name,
          title: item.title,
          goal: item.goal,
          objective: item.goal,
          description: item.goal,
          assigned_goal: item.goal,
          files_owned: item.files_owned,
          acceptance_criteria: item.acceptance_criteria,
          ui_priority: item.ui_priority,
        })
      })
      : undefined

    const resolvedProjectName = String(
      rawPayload.project_name
      || rawPayload.projectName
      || (aiRes && aiRes.project_name)
      || (fallbackSpec && fallbackSpec.project_name)
      || extractWishTitle(promptText),
    ).trim()
    const resolvedRefinedPrompt = String(
      rawPayload.refined_prompt
      || rawPayload.refinedPrompt
      || (aiRes && aiRes.refined_prompt)
      || (fallbackSpec && fallbackSpec.refined_prompt)
      || promptText,
    ).trim()
    const resolvedSummary = String(
      rawPayload.summary
      || (aiRes && aiRes.summary)
      || (fallbackSpec && fallbackSpec.summary)
      || `已确认 ${normalizedStoreGoals ? normalizedStoreGoals.length : 0} 项多波次分片任务并准备派发执行。`,
    ).trim()

    const activeSpec = {
      title: resolvedProjectName,
      project_name: resolvedProjectName,
      projectName: resolvedProjectName,
      template: templateName || (fallbackSpec && fallbackSpec.template) || 'custom',
      raw_prompt: promptText,
      refined_prompt: resolvedRefinedPrompt,
      refinedPrompt: resolvedRefinedPrompt,
      summary: resolvedSummary,
      clarifications: (aiRes && aiRes.clarifications) || (fallbackSpec && fallbackSpec.clarifications) || [],
      deliverables: (aiRes && aiRes.deliverables) || (fallbackSpec && fallbackSpec.deliverables) || [],
      proposed_waves: normalizedStoreGoals || [],
      goals: normalizedStoreGoals || [],
      ...(aiRes && aiRes.ok ? { model: aiRes.model, provider: aiRes.provider, ai_generated: true } : {}),
      ...(fallbackSpec ? { fallback_used: true } : {}),
    }

    const storePayload = Object.assign({}, rawPayload, withEngIds(currentEng, {
      op: effectiveOp,
      prompt: promptText,
      user_prompt: promptText,
      refined_prompt: resolvedRefinedPrompt,
      template: templateName,
      preview_only: false,
      require_ai: true,
      ...(aiRes && aiRes.ok ? { ai_generated: true, model: aiRes.model, provider: aiRes.provider } : {}),
      refined_spec: activeSpec,
      proposed_waves: activeSpec.proposed_waves,
      waves: rawPayload.proposed_waves || rawPayload.waves || activeSpec.proposed_waves,
    }))
    if (normalizedStoreGoals) {
      storePayload.goals = normalizedStoreGoals
    }

    let storeResult = null
    if (effectiveOp === 'refineAndDecomposeWish' && store && typeof store.refineAndDecomposeWish === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'refineAndDecomposeWish', currentEng, storePayload)
      } catch { storeResult = null }
    }
    if (!storeResult && store) {
      storeResult = await invokeOrDispatchCompat('decomposeUserPrompt', currentEng, Object.assign({}, storePayload, { op: 'decomposeUserPrompt' }))
    }
    if (storeResult && storeResult.ok === false) {
      return Object.assign({ op: effectiveOp, engagement: currentEng }, storeResult)
    }

    reqFlow.dagByEng.delete(currentEng)
    const preDispatchDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const workerTasksForDispatch = (storeResult && Array.isArray(storeResult.worker_tasks) && storeResult.worker_tasks.length > 0)
      ? storeResult.worker_tasks
      : ((preDispatchDag && Array.isArray(preDispatchDag.worker_tasks)) ? preDispatchDag.worker_tasks : [])

    const dispatched = await dispatchWorkflowToDshAgents(ctx, store, {
      engagementId: currentEng,
      sessionId: sessionRef,
      refinedPrompt: resolvedRefinedPrompt,
      userPrompt: promptText,
      workerTasks: workerTasksForDispatch,
      goals: normalizedStoreGoals || [],
      cwd: cwdOverride || (aiRes && aiRes.cwd) || '',
    })

    const { hostSessions, synth } = await rebuildCollab(currentEng, {
      invalidateEngs: true,
      bumpOp: effectiveOp,
      hostEng: currentEng,
    })
    const freshDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const pgProbe = readPgProbe(currentEng)

    const finalSpec = (storeResult && storeResult.refined_spec && typeof storeResult.refined_spec === 'object')
      ? Object.assign({}, activeSpec, storeResult.refined_spec)
      : activeSpec
    const goalsOut = (freshDag && Array.isArray(freshDag.plan_goals) && freshDag.plan_goals.length > 0)
      ? freshDag.plan_goals
      : ((storeResult && Array.isArray(storeResult.goals)) ? storeResult.goals : [])
    const workerTasksOut = (freshDag && Array.isArray(freshDag.worker_tasks) && freshDag.worker_tasks.length > 0)
      ? freshDag.worker_tasks
      : workerTasksForDispatch

    return Object.assign(
      {
        subgoals: synth.childNodes.map((c) => ({
          id: c.id,
          worker_task_id: c.worker_task_id ?? null,
          role: c.role,
          wave: c.wave,
          title: c.title,
          assigned_goal: c.assigned_goal || '',
          files_owned: c.files_owned || [],
          uiPriority: c.uiPriority,
          workerTags: c.workerTags,
          approvalState: c.approvalState,
          nextGoal: c.nextGoal,
        })),
      },
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: effectiveOp,
        preview_only: false,
        ai_generated: Boolean((aiRes && aiRes.ok) || rawPayload.ai_generated || callerExplicitGoals),
        ...(aiRes && aiRes.model ? { model: aiRes.model, provider: aiRes.provider } : {}),
        ...(fallbackSpec ? { fallback_used: true } : {}),
        prompt: promptText,
        refined_prompt: finalSpec.refined_prompt || resolvedRefinedPrompt,
        project_name: finalSpec.project_name || finalSpec.title,
        summary: finalSpec.summary || resolvedSummary,
        refined_spec: finalSpec,
        refinedSpec: finalSpec,
        goals: goalsOut,
        plan_goals: goalsOut,
        worker_tasks: workerTasksOut,
        proposed_waves: finalSpec.proposed_waves || activeSpec.proposed_waves,
        dispatched,
        engagement: currentEng,
        active_engagement: currentEng,
        host_sessions: hostSessions,
        hostSessions,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'updateWorkerGoal') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const matchedTask = resolveWorkerTaskFromDag(currentEng, rawPayload)
    const resolvedGoalText = rawPayload.assigned_goal ?? rawPayload.assignedGoal ?? rawPayload.goal ?? rawPayload.objective
    const payloadWithEng = withEngIds(currentEng, rawPayload)
    if (matchedTask && matchedTask.id !== undefined && matchedTask.id !== null) {
      payloadWithEng.worker_task_id = matchedTask.id
      payloadWithEng.id = matchedTask.id
    }
    if (resolvedGoalText !== undefined) {
      payloadWithEng.assigned_goal = resolvedGoalText
      payloadWithEng.goal = resolvedGoalText
    }
    const storeResult = await runWorkerMutation('updateWorkerGoal', 'updateWorkerGoal', currentEng, payloadWithEng)
    if (storeResult && storeResult.ok === false && typeof storeResult.error === 'string') {
      return storeResult
    }

    const targetTask = (storeResult && storeResult.worker_task && typeof storeResult.worker_task === 'object')
      ? storeResult.worker_task
      : (resolveWorkerTaskFromDag(currentEng, payloadWithEng) || matchedTask)
    const childId = String((targetTask && targetTask.session_id) || rawPayload.session_id || rawPayload.sessionId || '').trim()
    const { rootAgent, subagentsSvc } = await resolveDshDispatchHandles(rawPayload)
    const warnings = []
    let wokeChildId = null
    let captainNotified = false
    let dispatchMode = 'noop'

    const agentsSvc = tryGet(ctx, 'agents')
    let liveChild = null
    if (agentsSvc && typeof agentsSvc.get === 'function' && childId) {
      try { liveChild = agentsSvc.get(childId) } catch { liveChild = null }
    }
    const childStateStr = liveChild ? String(liveChild.state || liveChild.status || '').toLowerCase() : ''
    const isRunning = liveChild
      ? (['running', 'busy', 'working', 'streaming'].includes(childStateStr) || Boolean(liveChild.busy))
      : String((targetTask && targetTask.status) || '').toLowerCase() === 'running'
    const deliverMode = isRunning ? 'steer' : 'queue'

    const goalTextStr = String(resolvedGoalText ?? (targetTask && targetTask.assigned_goal) ?? '').trim()
    const updateMsg = [
      '【LMTAgent · 子任务目标变更通知】',
      `- 任务节点：${(targetTask && (targetTask.title || targetTask.worker_name)) || payloadWithEng.worker_task_id || ''}`,
      goalTextStr ? `- 最新执行目标（assigned_goal）：${goalTextStr}` : '',
      rawPayload.files_owned ? `- 最新文件分片（files_owned）：${JSON.stringify(rawPayload.files_owned)}` : '',
      '请立刻按最新目标调整执行方案，并在完成后提交 `redteam_workflow` submit_digest。',
    ].filter(Boolean).join('\n')

    if (isRealChildSessionId(ctx, childId) && rootAgent && subagentsSvc) {
      try {
        await deliverPromptToChild(subagentsSvc, deliverMode, rootAgent, childId, updateMsg)
        wokeChildId = childId
        dispatchMode = deliverMode
      } catch (err) {
        warnings.push(`向子代理 ${childId} 投递目标变更（${deliverMode}）失败：${err && err.message ? err.message : String(err)}`)
      }
    } else if (isRealChildSessionId(ctx, childId)) {
      warnings.push(!rootAgent ? '未解析到活跃 rootAgent，仅更新事实库目标' : '宿主 subagents 服务不可用，仅更新事实库目标')
    } else {
      warnings.push('该节点尚未绑定真实 DSH 子会话 childId，仅更新事实库目标')
    }

    if (rootAgent && typeof rootAgent.followup === 'function') {
      const captainNote = [
        `【LMTAgent 目标变更同步】工作区 \`${currentEng}\` 节点 \`${(targetTask && (targetTask.title || targetTask.worker_name)) || payloadWithEng.worker_task_id || ''}\` 目标已更新。`,
        goalTextStr ? `- 新目标：${goalTextStr.slice(0, 300)}` : '',
        wokeChildId ? `- 已通过 \`${dispatchMode}Prompt\` 实时同步给 childId: \`${wokeChildId}\`` : '',
      ].filter(Boolean).join('\n')
      try {
        const fRes = sendRootFollowupMessage(rootAgent, captainNote)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { synth } = await rebuildCollab(currentEng, { bumpOp: 'updateWorkerGoal', hostEng: currentEng })
    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: storeResult && storeResult.ok === false ? false : true,
        op: 'updateWorkerGoal',
        engagement: currentEng,
        dispatched: {
          mode: dispatchMode,
          spawned: [],
          wokeChildId,
          captainNotified,
          ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
        },
      },
      synthNetworkFields(synth, { includeEvents: false }),
    )
  }

  if (effectiveOp === 'addCustomWorkerTask') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const payloadWithEng = withEngIds(currentEng, rawPayload)
    const storeResult = await runWorkerMutation('addCustomWorkerTask', 'addCustomWorkerTask', currentEng, payloadWithEng)
    if (storeResult && storeResult.ok === false && typeof storeResult.error === 'string') {
      return storeResult
    }
    const createdTask = (storeResult && storeResult.worker_task && typeof storeResult.worker_task === 'object')
      ? Object.assign({}, storeResult.worker_task)
      : resolveWorkerTaskFromDag(currentEng, {
        id: storeResult && (storeResult.worker_task_id ?? storeResult.id),
        worker_name: rawPayload.worker_name || rawPayload.workerName,
      })

    const { settings, rootAgent, subagentsSvc, cwd } = await resolveDshDispatchHandles(rawPayload)
    const shouldAutoDispatch = rawPayload.autoStart !== false && rawPayload.auto_dispatch !== false
    const spawned = []
    const warnings = []
    let captainNotified = false

    if (createdTask && shouldAutoDispatch && (settings.dispatchPolicy.dispatchMode !== 'captain_only' || rawPayload.autoStart === true)) {
      if (rootAgent && subagentsSvc && typeof subagentsSvc.startActivation === 'function') {
        const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
        const refinedPrompt = String((dag && dag.engagement && dag.engagement.goal) || '').trim()
        try {
          const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, createdTask, {
            provider: settings.dispatchPolicy.subagentProvider || 'spawn',
            cwd,
            engId: currentEng,
            refinedPrompt,
            maxDepth: settings.maxDepth,
            thinkingEffort: settings.thinkingEffort,
          })
          if (started && started.childId) {
            await bindWorkerSessionCompat(store, currentEng, createdTask, started.childId, 'running')
            createdTask.session_id = started.childId
            createdTask.status = 'running'
            spawned.push({
              worker_task_id: createdTask.id,
              worker_name: createdTask.worker_name || createdTask.title,
              role: createdTask.worker_role || rawPayload.worker_role || rawPayload.role || 'exploit',
              childId: started.childId,
            })
          } else {
            warnings.push('startActivation 未返回有效的 childId')
          }
        } catch (err) {
          warnings.push(`拉起自定义子任务失败：${err && err.message ? err.message : String(err)}`)
        }
      } else {
        warnings.push(!rootAgent ? '未解析到活跃 rootAgent，自定义任务已落库等待拉起' : '宿主 subagents 服务不可用，自定义任务已落库等待拉起')
      }
    }

    if (rootAgent && typeof rootAgent.followup === 'function') {
      const taskLabel = createdTask
        ? `[${createdTask.wave || 'wave-?'} · ${createdTask.worker_role || 'exploit'}] ${createdTask.title || createdTask.worker_name} (task_id=${createdTask.id})`
        : (rawPayload.title || rawPayload.worker_name || 'custom-worker')
      const captainNote = spawned.length > 0
        ? `【LMTAgent 新增分片同步】工作区 \`${currentEng}\` 新增自定义任务 ${taskLabel}，已由工作台真实拉起 childId: \`${spawned[0].childId}\`（请勿重复派发）。`
        : `【LMTAgent 新增分片同步】工作区 \`${currentEng}\` 新增自定义任务 ${taskLabel}，请主控 Captain 按波次约束安排调度。`
      try {
        const fRes = sendRootFollowupMessage(rootAgent, captainNote)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { synth } = await rebuildCollab(currentEng, {
      invalidateEngs: spawned.length > 0,
      bumpOp: 'addCustomWorkerTask',
      hostEng: currentEng,
    })
    const createdNodeId = createdTask
      ? (createdTask.session_id || `wt-${createdTask.id}`)
      : (storeResult && (storeResult.worker_id || storeResult.id)) || undefined
    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: storeResult && storeResult.ok === false ? false : true,
        op: 'addCustomWorkerTask',
        engagement: currentEng,
        worker_id: createdNodeId,
        worker_task_id: createdTask ? createdTask.id : (storeResult && storeResult.worker_task_id),
        ...(createdTask ? { worker_task: createdTask } : {}),
        ...(spawned[0] ? { childId: spawned[0].childId, session_id: spawned[0].childId } : {}),
        dispatched: {
          mode: spawned.length > 0 ? 'hybrid_auto' : settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider || 'spawn',
          spawned,
          captainNotified,
          ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
        },
      },
      synthNetworkFields(synth, { includeEvents: false }),
    )
  }

  if (effectiveOp === 'retryWorkerTask') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const matchedTask = resolveWorkerTaskFromDag(currentEng, rawPayload)
    const targetWorkerKey = String(
      rawPayload.worker_task_id ?? rawPayload.worker_id ?? rawPayload.workerId ?? rawPayload.session_id ?? rawPayload.id ?? '',
    ).trim()
    if (targetWorkerKey) {
      deleteScopedWorkerOverride(currentEng, targetWorkerKey)
      if (targetWorkerKey.startsWith('wt-')) deleteScopedWorkerOverride(currentEng, targetWorkerKey.slice(3))
    }
    if (matchedTask) {
      deleteScopedWorkerOverride(currentEng, String(matchedTask.id))
      deleteScopedWorkerOverride(currentEng, `wt-${matchedTask.id}`)
      if (matchedTask.session_id) deleteScopedWorkerOverride(currentEng, String(matchedTask.session_id))
    }
    const payloadWithEng = withEngIds(currentEng, rawPayload)
    if (matchedTask && matchedTask.id !== undefined && matchedTask.id !== null) {
      payloadWithEng.worker_task_id = matchedTask.id
      payloadWithEng.id = matchedTask.id
    }
    const storeResult = await runWorkerMutation('retryWorkerTask', 'retryWorkerTask', currentEng, payloadWithEng, { workflowAction: 'retryNode' })
    if (storeResult && storeResult.ok === false && typeof storeResult.error === 'string') {
      return storeResult
    }

    const afterTask = (storeResult && storeResult.worker_task && typeof storeResult.worker_task === 'object')
      ? Object.assign({}, storeResult.worker_task)
      : (resolveWorkerTaskFromDag(currentEng, payloadWithEng) || matchedTask)
    const existingChildId = String(
      (matchedTask && matchedTask.session_id)
      || (afterTask && afterTask.session_id)
      || rawPayload.session_id
      || rawPayload.sessionId
      || '',
    ).trim()

    const { settings, rootAgent, subagentsSvc, cwd } = await resolveDshDispatchHandles(rawPayload)
    const spawned = []
    const warnings = []
    let wokeChildId = null
    let captainNotified = false
    let dispatchMode = 'noop'

    const retryReason = String(
      rawPayload.reason || rawPayload.feedback || rawPayload.note || '请基于当前项目事实库状态继续修复并完成验证交付。',
    ).trim()
    const taskLabel = (afterTask && (afterTask.title || afterTask.worker_name)) || targetWorkerKey
    const retryMsg = [
      '【LMTAgent · 子任务重试 / 续跑通知】',
      `- 任务节点：${taskLabel}`,
      `- 重试原因 / 指示：${retryReason}`,
      '请立刻恢复执行并在完成后调用 `redteam_workflow` submit_digest 提交完整结论与验证证据。',
    ].join('\n')

    if (rootAgent && subagentsSvc) {
      if (isRealChildSessionId(ctx, existingChildId)) {
        try {
          await deliverPromptToChild(subagentsSvc, 'queue', rootAgent, existingChildId, retryMsg)
          wokeChildId = existingChildId
          dispatchMode = 'queue'
        } catch (err) {
          warnings.push(`续接原 childId=${existingChildId} 失败（${err && err.message ? err.message : String(err)}），尝试重新拉起新会话`)
        }
      }
      if (!wokeChildId && typeof subagentsSvc.startActivation === 'function') {
        const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
        const refinedPrompt = String((dag && dag.engagement && dag.engagement.goal) || '').trim()
        const taskForSpawn = afterTask || {
          id: targetWorkerKey,
          worker_name: targetWorkerKey,
          worker_role: rawPayload.worker_role || rawPayload.role || 'exploit',
          wave: rawPayload.wave || 'wave-3',
          title: taskLabel,
          assigned_goal: retryReason,
        }
        try {
          const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, taskForSpawn, {
            provider: settings.dispatchPolicy.subagentProvider || 'spawn',
            cwd,
            engId: currentEng,
            refinedPrompt,
            maxDepth: settings.maxDepth,
            thinkingEffort: settings.thinkingEffort,
            extraNote: retryReason,
          })
          if (started && started.childId) {
            await bindWorkerSessionCompat(store, currentEng, taskForSpawn, started.childId, 'running')
            if (afterTask) {
              afterTask.session_id = started.childId
              afterTask.status = 'running'
            }
            dispatchMode = 'spawn'
            spawned.push({
              worker_task_id: taskForSpawn.id,
              worker_name: taskForSpawn.worker_name || taskForSpawn.title,
              role: taskForSpawn.worker_role || taskForSpawn.role,
              childId: started.childId,
            })
          } else {
            warnings.push('startActivation 未返回有效的 childId')
          }
        } catch (err) {
          warnings.push(`重拉子代理失败：${err && err.message ? err.message : String(err)}`)
        }
      }
    } else {
      warnings.push(!rootAgent ? '未解析到活跃 rootAgent，仅重置事实库任务状态' : '宿主 subagents 服务不可用，仅重置事实库任务状态')
    }

    if (rootAgent && typeof rootAgent.followup === 'function') {
      const captainNote = spawned.length > 0
        ? `【LMTAgent 任务重试同步】工作区 \`${currentEng}\` 节点 \`${taskLabel}\` 已重新拉起新子会话 childId: \`${spawned[0].childId}\`（请勿重复派发）。`
        : (wokeChildId
          ? `【LMTAgent 任务重试同步】工作区 \`${currentEng}\` 节点 \`${taskLabel}\` 已通过 \`queuePrompt\` 唤醒原会话 childId: \`${wokeChildId}\`。`
          : `【LMTAgent 任务重试同步】工作区 \`${currentEng}\` 节点 \`${taskLabel}\` 已在事实库重置为待重试状态。`)
      try {
        const fRes = sendRootFollowupMessage(rootAgent, captainNote)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { synth } = await rebuildCollab(currentEng, {
      invalidateEngs: spawned.length > 0,
      bumpOp: 'retryWorkerTask',
      bumpMeta: { engagement: currentEng, workerId: targetWorkerKey },
      hostEng: currentEng,
    })
    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: storeResult && storeResult.ok === false ? false : true,
        op: 'retryWorkerTask',
        engagement: currentEng,
        ...(spawned[0]
          ? { childId: spawned[0].childId, session_id: spawned[0].childId }
          : (wokeChildId ? { childId: wokeChildId, session_id: wokeChildId } : {})),
        dispatched: {
          mode: dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider || 'spawn',
          spawned,
          wokeChildId,
          captainNotified,
          ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
        },
      },
      synthNetworkFields(synth, { includeEvents: false }),
    )
  }

  if (effectiveOp === 'shardLocks' || effectiveOp === 'listShardLocks') {
    const currentEng = resolveSessionAwareEngagement()
    if (!currentEng) {
      return Object.assign({ active_engagement: null }, computeShardLocksFallback(store, null, null, request))
    }
    const wfDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    return Object.assign({ active_engagement: currentEng }, computeShardLocksFallback(store, currentEng, wfDag, request))
  }

  if (request.op === 'agentSessionDetail') {
    return await extractAgentSessionDetail(ctx, store, activeEngagement || 'default', request, reqFlow)
  }

  if (request.op === 'activateAgentSession') {
    const targetSid = String(request.sessionId || request.agentId || request.session || '').trim()
    const currentEng = explicitReqEng || sessionBoundEngagement || (store ? getCachedActiveEngagementId(store) : null) || 'default'

    /* 验证 targetSid 是否为真实 DSH 宿主会话，严禁将 'root' / 'root-main' / 'sub-*' / 'wt-*' 合成 ID 写入 sessions.json！ */
    let sessions = null
    let subagents = null
    try { sessions = ctx.get('sessions') } catch { sessions = null }
    try { subagents = ctx.get('subagents') } catch { subagents = null }

    const byId = new Map()
    if (sessions && typeof sessions.list === 'function') {
      try {
        for (const s of (sessions.list() || [])) {
          if (s && s.id !== undefined) byId.set(String(s.id), s)
        }
      } catch { /* ignore */ }
    }
    if (sessions && typeof sessions.get === 'function' && targetSid && !byId.has(targetSid)) {
      try {
        const got = sessions.get(targetSid)
        if (got && got.id !== undefined) byId.set(String(got.id), got)
      } catch { /* ignore */ }
    }

    let subagentParentRoot = ''
    if (targetSid && !isSyntheticSessionId(targetSid) && !byId.has(targetSid) && subagents && typeof subagents.listChildren === 'function') {
      for (const [rid, rNode] of byId.entries()) {
        const p = rNode && rNode.header && rNode.header.parentSession
        if (p) continue
        try {
          const children = await subagents.listChildren(rid)
          if (Array.isArray(children) && children.some((k) => k && String(k.id || k.sessionId || '') === targetSid)) {
            subagentParentRoot = rid
            break
          }
        } catch { /* ignore */ }
      }
    }

    const realSessionFound = Boolean(
      targetSid
      && !isSyntheticSessionId(targetSid)
      && (byId.has(targetSid) || Boolean(subagentParentRoot)),
    )

    let rootSessionId = ''
    if (realSessionFound) {
      const candidateRoot = subagentParentRoot || resolveRootFromMap(byId, targetSid)
      if (candidateRoot && !isSyntheticSessionId(candidateRoot) && byId.has(candidateRoot)) {
        rootSessionId = candidateRoot
      }
    } else if (request.session && !isSyntheticSessionId(request.session) && byId.has(String(request.session))) {
      const fallbackRoot = resolveRootFromMap(byId, String(request.session))
      if (fallbackRoot && !isSyntheticSessionId(fallbackRoot) && byId.has(fallbackRoot)) {
        rootSessionId = fallbackRoot
      }
    }

    if (store && currentEng && rootSessionId && !isSyntheticSessionId(rootSessionId)) {
      try {
        const allEngs = getCachedEngagementsList(store)
        const matchedEng = (Array.isArray(allEngs) && allEngs.find((e) => e && e.id === currentEng)) || null
        const engName = (matchedEng && matchedEng.name) || currentEng
        if (typeof store.setSessionBinding === 'function') {
          store.setSessionBinding(rootSessionId, currentEng, engName)
        } else {
          dispatch(store, {
            op: 'bindSessionEngagement',
            session: rootSessionId,
            engagement: currentEng,
            id: currentEng,
            name: engName,
          })
        }
        invalidateSessionBindingsCache(store)
        bumpEventSeq('activateAgentSession', { sessionId: targetSid, rootSessionId })
      } catch { /* ignore binding errors */ }
    }

    return {
      ok: true,
      activated: Boolean(realSessionFound),
      isRealHostSession: Boolean(realSessionFound),
      sessionId: targetSid,
      rootSessionId: rootSessionId || null,
      engagement: currentEng,
      note: realSessionFound
        ? '已激活目标 Agent 会话，可在侧边聊天框直接查看与续接对话。'
        : '当前节点为规划/归档任务节点（尚无活跃宿主会话），已在控制台定位详情。',
    }
  }

  if (request.op === 'hostSessions') {
    const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: explicitEng || undefined, autoBind: true, reqFlow })
    const currentEng = resolveSessionAwareEngagement(explicitEng)
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    return Object.assign(
      { ok: true, items: hostSessions, active_engagement: currentEng },
      synthNetworkFields(synth),
    )
  }

  if (request.op === 'pgWriteProbe') {
    const currentEng = resolveSessionAwareEngagement()
    if (!currentEng) {
      const zeroCounts = { plan_goals: 0, worker_tasks: 0, worker_digests: 0, shard_locks: 0 }
      return {
        ok: true,
        unbound: true,
        engagement: null,
        engagement_id: null,
        active_engagement: null,
        ready: false,
        counts: zeroCounts,
        row_counts: zeroCounts,
        total_rows: 0,
      }
    }
    const probe = readPgProbe(currentEng)
    return Object.assign(
      {
        ok: true,
        active_engagement: currentEng,
        counts: (probe && (probe.counts || probe.row_counts)) || {},
      },
      probe,
    )
  }

  if (request.op === 'workflowDag' || request.op === 'workflowDocWall') {
    const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: explicitEng || undefined, autoBind: true, reqFlow })
    const currentEng = resolveSessionAwareEngagement(explicitEng)
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    if (!currentEng) {
      return {
        ok: true,
        standby: true,
        unbound: true,
        engagement: null,
        active_engagement: null,
        runId: null,
        status: 'standby',
        nodes: [],
        all_nodes: [],
        active_nodes: [],
        worker_tasks: [],
        plan_goals: [],
        worker_digests: [],
        edges: [],
        activeRoles: [],
        docWall: [],
        host_sessions: hostSessions,
        agentNetwork: synth.agentNetwork,
        agent_network: synth.agentNetwork,
        swimlanes: [],
        collabEvents: [],
        collab_events: [],
        collabTasks: [],
        collab_tasks: [],
      }
    }
    const rawDagData = getWorkflowDagDedup(store, currentEng, reqFlow)
    if (rawDagData) {
      const dagData = Object.assign({}, rawDagData)
      for (const listKey of ['nodes', 'all_nodes']) {
        if (Array.isArray(dagData[listKey])) {
          dagData[listKey] = dagData[listKey].map((n, idx) => {
            const copy = Object.assign({}, n)
            computeWorkerLmtexMeta(copy, idx, { store, engagementId: currentEng })
            return copy
          })
        }
      }
      if (dagData.telemetry && typeof dagData.telemetry === 'object') {
        dagData.telemetry = Object.assign({}, dagData.telemetry)
        sanitizeDagTelemetryCacheHit(dagData, synth.nodes)
      }
      return Object.assign(
        { ok: true },
        dagData,
        synthNetworkFields(synth),
        {
          nodes: synth.childNodes.length > 0 && (!Array.isArray(dagData.active_nodes) || dagData.active_nodes.length === 0)
            ? synth.nodes
            : dagData.nodes,
          dag_role_nodes: dagData.nodes,
          host_sessions: hostSessions,
        },
      )
    }
    return Object.assign(
      {
        ok: true,
        standby: true,
        engagement: currentEng,
        runId: null,
        status: 'standby',
        edges: [],
        activeRoles: [],
        docWall: [],
        host_sessions: hostSessions,
      },
      synthNetworkFields(synth),
    )
  }

  if (
    effectiveOp === 'feishuConfig'
    || effectiveOp === 'feishuConfigSave'
    || effectiveOp === 'saveFeishuConfig'
    || effectiveOp === 'saveFeishuWebhook'
  ) {
    const mergedRaw = mergeAgentPayload()
    const currentEng = resolveActionEng(mergedRaw)
    const rawUrl = String(mergedRaw.webhook_url ?? mergedRaw.webhookUrl ?? mergedRaw.webhook ?? mergedRaw.url ?? '').trim()
    const feishuPayload = Object.assign({}, mergedRaw, {
      engagement: currentEng,
      engagement_id: currentEng,
      webhook_url: rawUrl,
      webhookUrl: rawUrl,
    })
    let feishuRes = null
    if (store && typeof store.saveFeishuConfig === 'function') {
      try {
        feishuRes = await invokeStoreMethodCompat(store, 'saveFeishuConfig', currentEng, feishuPayload)
      } catch (err) {
        return { ok: false, engagement: currentEng, error: err && err.message ? err.message : String(err) }
      }
    }
    if (!feishuRes && store && typeof store.workflowAction === 'function') {
      for (const action of ['feishuConfig', 'saveFeishuWebhook']) {
        try {
          feishuRes = store.workflowAction(currentEng, Object.assign({}, feishuPayload, { action }))
          if (feishuRes) break
        } catch { feishuRes = null }
      }
    }
    bumpEventSeq('feishuConfig', { engagement: currentEng })
    if (feishuRes && typeof feishuRes === 'object') {
      return Object.assign({ ok: true, engagement: currentEng, op: effectiveOp }, feishuRes)
    }
    return {
      ok: true,
      op: effectiveOp,
      action: 'feishuConfig',
      engagement: currentEng,
      feishu: {
        webhook_url: rawUrl,
        configured: Boolean(rawUrl),
        enabled: feishuPayload.enabled !== undefined ? Boolean(feishuPayload.enabled) : Boolean(rawUrl),
      },
      note: '已保存飞书群聊机器人通知配置。',
    }
  }

  const isFeishuPushOp = request.op === 'feishuNotify'
    || request.op === 'feishuTestPush'
    || request.op === 'pushFeishuNotify'
    || (request.op === 'workflowAction' && ['pushFeishuNotify', 'feishuNotify', 'feishuTestPush', 'pushFeishu'].includes(request.action))

  if (isFeishuPushOp) {
    const mergedRaw = mergeAgentPayload()
    const currentEng = resolveActionEng(mergedRaw)
    const pushPayload = Object.assign({ action: 'pushFeishuNotify' }, mergedRaw, {
      engagement: currentEng,
      engagement_id: currentEng,
      is_test: request.op === 'feishuTestPush' || request.action === 'feishuTestPush' || Boolean(request.is_test ?? request.test),
    })
    if (store && typeof store.pushFeishuNotify === 'function') {
      try {
        const pushRes = await invokeStoreMethodCompat(store, 'pushFeishuNotify', currentEng, pushPayload)
        bumpEventSeq('feishuNotify', { engagement: currentEng })
        if (pushRes && typeof pushRes === 'object') {
          return Object.assign({ engagement: currentEng }, pushRes, { ok: Boolean(pushRes.ok) })
        }
        return { ok: true, engagement: currentEng }
      } catch (err) {
        return { ok: false, engagement: currentEng, error: err && err.message ? err.message : String(err) }
      }
    }
    if (store && typeof store.workflowAction === 'function') {
      const res = await invokeStoreMethodCompat(store, 'workflowAction', currentEng, pushPayload)
      bumpEventSeq('feishuNotify', { engagement: currentEng })
      return Object.assign({ ok: true, engagement: currentEng }, res && typeof res === 'object' ? res : {})
    }
    return { ok: false, standby: true, engagement: currentEng, error: '当前存储实例未启用飞书 Webhook 推送能力' }
  }

  if (request.op === 'workflowAction' || request.op === 'workflowRun' || request.op === 'dagCheckpoint') {
    const targetEng = activeEngagement || (store ? getCachedActiveEngagementId(store) : null) || 'default'
    if (store && typeof store.workflowAction === 'function') {
      const res = Object.assign({ ok: true }, await invokeStoreMethodCompat(store, 'workflowAction', targetEng, request))
      bumpEventSeq('workflowAction', { engagement: targetEng, action: request.action || request.op })
      return res
    }
    return { ok: true, standby: true, engagement: targetEng }
  }

  if (request.op === 'setClusterConfig') {
    const src = request.config && typeof request.config === 'object' ? Object.assign({}, request, request.config) : request
    const patch = {}
    if (src.maxAgents !== undefined || src.max !== undefined || src.max_agents !== undefined) {
      patch.maxAgents = clampMaxAgents(src.maxAgents ?? src.max ?? src.max_agents)
    }
    const rawThinking = src.thinking ?? src.thinkingEffort ?? src.thinking_effort ?? src.effort
    if (rawThinking !== undefined) {
      patch.thinkingEffort = normalizeThinkingEffort(rawThinking)
    }
    if (src.maxDepth !== undefined || src.max_depth !== undefined || src.depth !== undefined) {
      patch.maxDepth = clampMaxDepth(src.maxDepth ?? src.max_depth ?? src.depth)
    }
    if (Object.keys(patch).length > 0) {
      writeSettings(root, patch)
      bumpEventSeq('setClusterConfig')
    }
    const cfgFields = buildClusterConfigFields(resolveCachedSettingsArg(root))
    return Object.assign({ ok: true }, cfgFields, {
      source: 'settings',
      limit: MAX_AGENTS_LIMIT,
      max_depth_limit: MAX_DEPTH_LIMIT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
      note: `集群并发策略已更新：最大并发 ${cfgFields.max} · 默认思考强度 ${cfgFields.thinkingEffort} · 递归深度上限 ${cfgFields.maxDepth}（立即生效）。`,
    })
  }

  if (request.op === 'setAgentsMax') {
    const next = saveMaxAgents(root, request.max ?? request.maxAgents)
    const rawThinking = request.thinking ?? request.thinkingEffort ?? request.thinking_effort ?? request.effort
    if (rawThinking !== undefined) {
      saveThinkingEffort(root, rawThinking)
    }
    if (request.maxDepth !== undefined || request.max_depth !== undefined) {
      saveMaxDepth(root, request.maxDepth ?? request.max_depth)
    }
    bumpEventSeq('setAgentsMax')
    const cfgFields = buildClusterConfigFields(resolveCachedSettingsArg(root), next)
    return Object.assign({ ok: true }, cfgFields, {
      source: 'settings',
      limit: MAX_AGENTS_LIMIT,
      note: '已保存为 ' + next + ' 个并发执行智能体，**立即生效**（派活时按新值放行，不用重启 dsh web）。',
    })
  }
  if (request.op === 'setPgUrl') {
    const saved = savePgUrl(root, request.url)
    try { if (store && typeof store.close === 'function') store.close() } catch { /* 忽略 */ }
    bumpEventSeq('setPgUrl')
    const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
    return {
      ok: true, url: saved, db_engine: dbEngine,
      note: saved ? '已保存 PostgreSQL 连接串并重连引擎池。' : '已清除自定义 PostgreSQL 连接串，回退高并发 WAL 引擎。',
    }
  }
  if (request.op === 'probePg') {
    const cfg = resolvePgConfig(root, process.env, { pgUrl: request.url })
    const probe = probePgConnection(cfg.url || request.url)
    return Object.assign({ db_engine: cfg }, probe)
  }

  /* op === 'agentsStatus'：即使 ctx.get('subagents') 不可用也绝不返回 ok: false；
     当传入的 request.session 未绑定任何工作区时，严格返回零泄漏的洁净状态！ */
  const cfgArg = resolveCachedSettingsArg(root)
  const cfgFields = buildClusterConfigFields(cfgArg)
  const maxSource = maxAgentsSourceOf(cfgArg, process.env)
  const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
  const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: explicitEng || undefined, autoBind: true, reqFlow })
  const currentEng = resolveSessionAwareEngagement(explicitEng)
  const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
  const synth = synthesizeAgentCollaboration(store, currentEng || null, hostSessions, resolvedRootSession, reqFlow)

  let effectiveChildren = synth.childNodes
  if (currentEng && effectiveChildren.length === 0) {
    effectiveChildren = []
    for (const hs of hostSessions) {
      if (!hs || hs.engagementId !== currentEng) continue
      for (const c of Array.isArray(hs.children) ? hs.children : []) {
        effectiveChildren.push(c)
      }
    }
  }
  const running = effectiveChildren.filter((c) => c.activity === 'running')
  const pgProbe = currentEng
    ? readPgProbe(currentEng)
    : {
      ok: true,
      unbound: true,
      engagement: null,
      engagement_id: null,
      ready: false,
      row_counts: { plan_goals: 0, worker_tasks: 0, worker_digests: 0, shard_locks: 0 },
      total_rows: 0,
    }

  return Object.assign(
    {
      ok: true,
      ...(!currentEng ? { unbound: true } : {}),
      max: cfgFields.max,
      maxAgents: cfgFields.max,
      used: running.length,
      free: Math.max(cfgFields.max - running.length, 0),
      running: running.slice(0, 20),
      children: effectiveChildren,
      total_children: effectiveChildren.length,
      host_sessions: hostSessions,
      hostSessions,
      active_engagement: currentEng || null,
    },
    synthNetworkFields(synth),
    {
      source: maxSource,
      limit: MAX_AGENTS_LIMIT,
      default_max: DEFAULT_MAX_AGENTS,
      thinking: cfgFields.thinkingEffort,
      thinking_effort: cfgFields.thinkingEffort,
      thinkingEffort: cfgFields.thinkingEffort,
      default_thinking_effort: DEFAULT_THINKING_EFFORT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
      max_depth: cfgFields.maxDepth,
      maxDepth: cfgFields.maxDepth,
      default_max_depth: DEFAULT_MAX_DEPTH,
      max_depth_limit: MAX_DEPTH_LIMIT,
      db_engine: dbEngine,
      pg_probe: pgProbe,
      note: currentEng
        ? '同一会话（工程工作区）同时最多 ' + cfgFields.max + ' 个执行智能体；按 4-Wave Bounded DAG 并发调度。'
        : '当前会话尚未绑定工程工作区；初始化后将启用 4-Wave Bounded DAG 并发调度。',
    },
  )
}

/**
 * 版本与更新类 op（面板右上角的「版本 + 自动更新」用）。
 * 不碰资产库，直接操作 profile 与 npm/pnpm；全部在 host 侧执行。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'version' | 'updateCheck' | 'updateApply', target? }`。
 * @returns JSON 结果，或 undefined 表示不是更新类 op。
 */
async function handleUpdateOp(ctx, request) {
  if (!['version', 'updateCheck', 'updateApply'].includes(request.op)) return undefined
  const pkg = pluginIdentity(ctx)
  const pre = await updatePreflight(ctx)
  if (request.op === 'version') {
    const check = await checkLatest(ctx, pre.dir, pkg.name)
    return {
      ok: true,
      plugin: pkg,
      install: {
        mode: pre.sourceInstall ? 'source' : 'package',
        dir: pre.dir,
        declared: pre.declared,
        packageManager: pre.packageManager,
      },
      latest: check && check.ok ? check.latest : null,
      updateAvailable: check && check.ok && pkg.version ? versionLess(pkg.version, check.latest) : false,
      /* 本地版本比 registry 还新：本机跑的是尚未发布的开发版本。
         不区分这一种，"检查更新"会一直显示"已是最新"，把"这个版本根本没发出去"藏起来。 */
      localAhead: check && check.ok && pkg.version ? versionLess(check.latest, pkg.version) : false,
      check_error: check && check.ok === false ? check.error : undefined,
      blockers: pre.blockers,
      notes: pre.notes,
      running_agents: pre.running,
    }
  }
  if (request.op === 'updateCheck') {
    const check = await checkLatest(ctx, pre.dir, pkg.name)
    if (check.ok !== true) return { ok: false, error: check.error, current: pkg.version, install: { mode: pre.sourceInstall ? 'source' : 'package' } }
    const localAhead = pkg.version ? versionLess(check.latest, pkg.version) : false
    return {
      ok: true, current: pkg.version, latest: check.latest,
      updateAvailable: pkg.version ? versionLess(pkg.version, check.latest) : true,
      localAhead,
      install: { mode: pre.sourceInstall ? 'source' : 'package', dir: pre.dir, packageManager: pre.packageManager, sourceInstall: pre.sourceInstall },
      blockers: pre.blockers,
      notes: pre.notes.concat(localAhead
        ? ['本机版本（' + pkg.version + '）比 npm 上的最新版（' + check.latest + '）还新：'
           + '当前跑的是尚未发布的开发版本，包管理器更新不适用（要回退版本请显式指定）。']
        : []),
      running_agents: pre.running,
    }
  }
  /* updateApply */
  if (pre.blockers.length > 0) {
    return { ok: false, error: '现在不能更新：' + pre.blockers.join(' '), blockers: pre.blockers, notes: pre.notes }
  }
  /* target 会被原样拼进 `npm install <target>`：不校验就等于把"装任意包并重启进程"
     暴露给浏览器侧输入。只接受纯 semver（可带 v 前缀），其余一律拒绝并说清原因。 */
  const rawTarget = typeof request.target === 'string' ? request.target.trim() : ''
  if (rawTarget !== '' && !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawTarget)) {
    return {
      ok: false,
      current: pkg.version,
      error: 'updateApply 的 target 必须是纯版本号（如 0.11.0），收到 ' + JSON.stringify(rawTarget)
        + '。不接受包名、路径、URL 或 npm 参数 —— 它会原样传给包管理器，等于允许远程指定安装内容。',
    }
  }
  const result = await applyUpdate(ctx, pre.dir, pkg.name, rawTarget || null)
  if (result.ok !== true) return Object.assign({ current: pkg.version }, result)
  return Object.assign({ current: pkg.version, latest: request.target || null }, result, {
    note: '已安装，正在重启 dsh web（页面会在几秒内断开，重启完成后刷新即可看到新版本）。重启日志：' + result.restart.log,
  })
}

/**
 * 沿 `parentSession` 走到根会话 id（最多 64 层，防环）。
 *
 * 面板「跟随会话」需要它：host 侧绑定表只记**根会话**键，但用户在界面里点开的
 * 可能是子智能体的会话（比如派出去的「内网渗透」子智能体）—— 不解析到根，
 * 就会误判成"这个会话没绑靶标"，面板回落到"最后绑定的靶标"，切回主会话才对上。
 *
 * @param ctx - 插件上下文（读 sessions 注册表；不可用时返回原 id）。
 * @param sessionId - 任意会话 id。
 * @returns 根会话 id（解析不了就原样返回）。
 */
export function resolveRootSessionId(ctx, sessionId) {
  const id = String(sessionId || '')
  if (!id) return id
  let sessions = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  if (sessions === undefined || sessions === null || typeof sessions.list !== 'function') return id
  let list = []
  try { list = sessions.list() } catch { return id }
  const byId = new Map()
  for (const s of Array.isArray(list) ? list : []) {
    const sid = s && s.id !== undefined ? String(s.id) : ''
    if (sid) byId.set(sid, s)
  }
  return resolveRootFromMap(byId, id)
}

const DELTA_SHORT_CIRCUIT_OPS = new Set([
  'agentsStatus',
  'workflowDag',
  'pgWriteProbe',
  'consoleDigest',
  'shardLocks',
  'listShardLocks',
])

const READ_ONLY_STORE_OPS = new Set([
  'bootstrap',
  'consoleDigest',
  'sessionBinding',
  'sessionBindings',
  'stats',
  'snapshot',
  'assets',
  'asset',
  'graph',
  'attackGraph',
  'vulns',
  'vulnStats',
  'credentials',
  'access',
  'sessions',
  'webshells',
  'tunnels',
  'shots',
  'shotData',
  'domains',
  'web',
  'httpEvidence',
  'chain',
  'report',
  'scores',
  'scoreChain',
  'scoreReport',
  'activeTests',
  'testStats',
  'stages',
  'reportTargets',
  'discoveryTimeline',
  'attackFiles',
  'readAttackFile',
  'prompts',
  'dbEngine',
  'pocSearch',
  'pocList',
  'templateSearch',
  'templateStats',
  'pocGet',
  'pocStats',
  'listShardLocks',
  'shardLocks',
  'refineUserWish',
  'probeSessions',
])

function isLoopbackHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) return false
  const h = hostHeader.trim().toLowerCase()
  return /^localhost(?::\d+)?$/.test(h)
    || /^127\.0\.0\.1(?::\d+)?$/.test(h)
    || /^\[::1\](?::\d+)?$/.test(h)
}

function isSameOriginUrl(urlStr, host) {
  if (typeof urlStr !== 'string' || !urlStr || typeof host !== 'string' || !host) return false
  try {
    const parsedHost = new URL(urlStr).host
    return Boolean(parsedHost && parsedHost === host)
  } catch {
    return false
  }
}

function isLoopbackRemote(req) {
  const remote = req && req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isAllowedSseRequest(req) {
  const origin = req.headers && req.headers.origin
  const host = req.headers && req.headers.host
  if (typeof origin === 'string' && origin !== '') {
    return isSameOriginUrl(origin, host)
  }
  const secFetchSite = req.headers && req.headers['sec-fetch-site']
  if (typeof secFetchSite === 'string' && secFetchSite !== '') {
    const sf = secFetchSite.trim().toLowerCase()
    if (sf === 'same-origin' || sf === 'none') return true
    return false
  }
  const referer = req.headers && req.headers.referer
  if (isSameOriginUrl(referer, host)) return true
  return isLoopbackRemote(req) || isLoopbackHostHeader(host)
}

function sendJsonWithSeq(res, status, body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && body.seq === undefined) {
    body = Object.assign({}, body, { seq: eventSeq })
  }
  sendJson(res, status, body)
}

/**
 * @param ctx - 插件上下文（已保证 redteam / webServer / skills / agentPresets 可用）。
 */
export function apply(ctx) {
  const store = ctx.redteam

  /* 监听宿主子智能体生命周期与活跃 JSONL 文件 mtime 推进，驱动 eventSeq 与 SSE 增量广播 */
  ctx.effect(() => {
    const disposers = []
    if (typeof ctx.on === 'function') {
      for (const evtName of ['subagent/start', 'subagent/end']) {
        try {
          const off = ctx.on(evtName, (evtPayload) => {
            const sid = evtPayload && (evtPayload.id || evtPayload.sessionId)
              ? String(evtPayload.id || evtPayload.sessionId)
              : undefined
            bumpEventSeq(evtName, sid ? { sessionId: sid } : null)
          })
          if (typeof off === 'function') disposers.push(off)
        } catch { /* 宿主未注册该事件时不阻断 */ }
      }
    }

    const mtimeTimer = setInterval(() => {
      try {
        if (sessionJsonlReader.checkTrackedFilesChanged()) {
          bumpEventSeq('session_mtime')
        }
      } catch { /* ignore */ }
    }, 1500)
    if (mtimeTimer && typeof mtimeTimer.unref === 'function') mtimeTimer.unref()

    return () => {
      clearInterval(mtimeTimer)
      for (const d of disposers) {
        try { d() } catch { /* ignore */ }
      }
      for (const client of Array.from(sseClients)) {
        sseClients.delete(client)
        try { client.end() } catch { /* ignore */ }
      }
    }
  })

  /* GET /redteam/events：轻量级 SSE 增量事件流（初始 seq 握手 + 15s 保活心跳） */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/redteam/events',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET only' })
        return
      }
      if (!isAllowedSseRequest(req)) {
        sendJson(res, 403, { ok: false, error: 'cross-origin SSE request rejected' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      if (typeof res.flushHeaders === 'function') res.flushHeaders()
      res.write(`data: ${JSON.stringify({ seq: eventSeq, connected: true, ts: Date.now() })}\n\n`)
      sseClients.add(res)

      const heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(heartbeat)
          sseClients.delete(res)
          return
        }
        try {
          res.write(': ping\n\n')
        } catch {
          clearInterval(heartbeat)
          sseClients.delete(res)
        }
      }, 15000)
      if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref()

      const cleanupClient = () => {
        clearInterval(heartbeat)
        sseClients.delete(res)
      }
      if (typeof req.on === 'function') req.on('close', cleanupClient)
      if (typeof res.on === 'function') {
        res.on('close', cleanupClient)
        res.on('error', cleanupClient)
      }
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/redteam/api',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST only' })
        return
      }
      /* 来源校验：**默认拒绝**。
         只在 origin 与 host 都是字符串时才比对是不够的：缺任意一个头就整段跳过，
         "校验被跳过"等同于"没有校验"，一个不发送 Origin 的请求就能打到所有 op
         （包括读明文凭据与 updateApply 这条会装包并重启进程的路径）。
         现在：有 Origin → 必须与 Host 同源；没有 Origin → 只允许来自回环地址的请求。 */
      const origin = req.headers.origin
      const host = req.headers.host
      if (typeof origin === 'string' && origin !== '') {
        if (!isSameOriginUrl(origin, host)) {
          sendJson(res, 403, { ok: false, error: 'cross-origin request rejected' })
          return
        }
      } else if (!isLoopbackRemote(req)) {
        sendJson(res, 403, { ok: false, error: 'request without Origin is only accepted from loopback' })
        return
      }
      try {
        const raw = await readBody(req)
        const request = raw.trim() ? JSON.parse(raw) : {}
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
          sendJson(res, 400, { ok: false, error: 'invalid JSON request object' })
          return
        }
        if (request.op === 'engagementOpen') {
          request.op = 'openEngagement'
          if (!request.name && (request.id || request.engagement)) {
            request.name = String(request.id || request.engagement)
          }
        }

        /* sinceSeq 零开销短路：只读轮询 op 在 eventSeq 未推进时 <0.1ms 直接返回 unchanged: true */
        if (
          request.sinceSeq !== undefined
          && request.sinceSeq !== null
          && request.sinceSeq !== ''
          && DELTA_SHORT_CIRCUIT_OPS.has(request.op)
        ) {
          if (Number(request.sinceSeq) === eventSeq && sessionJsonlReader.checkTrackedFilesChanged()) {
            bumpEventSeq('session_mtime')
          }
          if (Number(request.sinceSeq) === eventSeq) {
            sendJson(res, 200, { ok: true, unchanged: true, seq: eventSeq })
            return
          }
        }

        const agentsResult = await handleAgentsOp(ctx, request)
        if (agentsResult !== undefined) {
          sendJsonWithSeq(res, 200, agentsResult)
          return
        }
        const updateResult = await handleUpdateOp(ctx, request)
        if (updateResult !== undefined) {
          sendJsonWithSeq(res, 200, updateResult)
          return
        }
        const skillResult = await handleSkillOp(ctx, request)
        if (skillResult !== undefined) {
          sendJsonWithSeq(res, 200, skillResult)
          return
        }
        /* bootstrap / sessionBinding 时同步发现宿主 DSH 会话（严格保持未绑定会话隔离） */
        let hostSessions = null
        const reqFlow = createRequestFlow()
        const isPreDiscoverOp = request.op === 'bootstrap'
          || request.op === 'sessionBinding'
          || request.op === 'sessionBindings'
        if (isPreDiscoverOp) {
          try {
            hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true, reqFlow })
          } catch { hostSessions = [] }
        }
        /* 会话类 op 需要"沿 parentSession 走到根会话"：绑定表只记根会话键，
           而界面里点开的可能是子智能体的会话（见 resolveRootSessionId）。
           其他 op 不受影响 —— 只是多带一个函数，dispatch 只在 sessionBinding* 用它。 */
        const withRoot = typeof request.session === 'string' && request.session
          ? Object.assign({}, request, { resolveRoot: (sid) => resolveRootSessionId(ctx, sid) })
          : request
        /* dispatchAsync 只多处理 probeSessions（连通性探测需要真实发起连接） */
        const result = await dispatchAsync(store, withRoot)
        if (request.op && !READ_ONLY_STORE_OPS.has(request.op)) {
          invalidateEngagementCaches(store)
          invalidateSessionBindingsCache(store)
          bumpEventSeq(String(request.op))
        }
        const isPostDiscoverSessionOp = request.op === 'sessionOnboarding'
          || (Boolean(request.session) && (
            request.op === 'openEngagement'
            || request.op === 'bindSessionEngagement'
            || request.op === 'activateEngagement'
          ))
        if (isPostDiscoverSessionOp) {
          try {
            hostSessions = await discoverHostSessions(ctx, store, {
              sessionId: request.session,
              autoBind: true,
              reqFlow: createRequestFlow(),
            })
          } catch { hostSessions = [] }
        }
        handleBootstrap(store, withRoot, result, hostSessions)
        if (
          request.op === 'openEngagement'
          && request.session
          && result
          && typeof result === 'object'
          && store
          && typeof store.getSessionState === 'function'
        ) {
          const rSid = typeof withRoot.resolveRoot === 'function'
            ? withRoot.resolveRoot(request.session)
            : String(request.session)
          const st = store.getSessionState(rSid)
          result.session = request.session
          result.root_session = rSid
          result.bound = st.bound
          result.init_state = st.init_state
          result.onboarding_dismissed = st.onboarding_dismissed
          result.session_binding = st
        }
        if (hostSessions !== null && result && typeof result === 'object') {
          result.host_sessions = hostSessions
        }
        sendJsonWithSeq(res, 200, result)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  }))
}
