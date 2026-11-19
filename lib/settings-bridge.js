/**
 * LMTAgent Host Bridge — 统一配置读写、mtimeMs/TTL 元数据缓存与会话绑定缓存子系统（零外部依赖）
 *
 * 从 lib/index.js 拆出，与 `redteam-store/lib/settings.js` 保持同一归一化与持久化口径，
 * 并维护 `maxTokensPerWorkspace` / `maxCostPerWorkspace` / `maxAutoRetries` / `speculativeWaveDispatch` / `uiPreferences.locale`。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as coreMod from './store-core.js'
import * as settingsMod from './settings.js'

const { dispatch } = coreMod

export const DEFAULT_MAX_AGENTS = settingsMod.DEFAULT_MAX_AGENTS ?? 6
export const MAX_AGENTS_LIMIT = settingsMod.MAX_AGENTS_LIMIT ?? 12
export const DEFAULT_THINKING_EFFORT = settingsMod.DEFAULT_THINKING_EFFORT ?? 'low'
export const VALID_THINKING_EFFORTS = settingsMod.VALID_THINKING_EFFORTS ?? ['none', 'low', 'medium', 'high']
export const DEFAULT_MAX_DEPTH = settingsMod.DEFAULT_MAX_DEPTH ?? 3
export const MAX_DEPTH_LIMIT = settingsMod.MAX_DEPTH_LIMIT ?? 5
export const MAX_AUTO_RETRIES_LIMIT = settingsMod.MAX_AUTO_RETRIES_LIMIT ?? 3

export const clampMaxAgents = settingsMod.clampMaxAgents || ((n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_AGENTS_LIMIT) return MAX_AGENTS_LIMIT
  return v
})

export const normalizeThinkingEffort = settingsMod.normalizeThinkingEffort || ((effort) => {
  const s = typeof effort === 'string' ? effort.trim().toLowerCase() : ''
  return VALID_THINKING_EFFORTS.includes(s) ? s : DEFAULT_THINKING_EFFORT
})

export const clampMaxDepth = settingsMod.clampMaxDepth || ((n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_DEPTH_LIMIT) return MAX_DEPTH_LIMIT
  return v
})

/* ------------------------------------------------------------------ 轻量 mtimeMs + TTL(2000ms) 缓存层 */
export const HOST_META_TTL_MS = 2000
const settingsFileCache = new Map() // root -> { at, mtimeNs, size, data }
const sessionBindingsCache = new WeakMap() // store -> { at, mtimeNs, size, agents }
const activeEngCache = new WeakMap() // store -> { at, mtimeNs, size, id }
const engagementsListCache = new WeakMap() // store -> { at, dirMtimeNs, list }

export function invalidateSettingsCache(root) {
  if (root) settingsFileCache.delete(String(root))
  else settingsFileCache.clear()
}

export function invalidateSessionBindingsCache(store) {
  if (store && typeof store === 'object') sessionBindingsCache.delete(store)
}

export function invalidateEngagementCaches(store) {
  if (store && typeof store === 'object') {
    activeEngCache.delete(store)
    engagementsListCache.delete(store)
  }
}

export function readSettingsCached(root) {
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

export function writeSettings(root, patch) {
  invalidateSettingsCache(root)
  const res = rawWriteSettings(root, patch)
  invalidateSettingsCache(root)
  return res
}

export function resolveCachedSettingsArg(rootOrObj) {
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
  const envVal = (env && (env.LMTAGENT_MAX_AGENTS ?? env.REDTEAM_MAX_AGENTS))
  if (envVal !== undefined && envVal !== '') {
    return clampMaxAgents(envVal)
  }
  return clampMaxAgents(DEFAULT_MAX_AGENTS)
}

const fallbackMaxAgentsSourceOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const fromFile = Number(cfg.maxAgents ?? cfg.max_agents)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  const envVal = (env && (env.LMTAGENT_MAX_AGENTS ?? env.REDTEAM_MAX_AGENTS))
  if (envVal !== undefined && envVal !== '') return 'env'
  return 'default'
}

const fallbackThinkingEffortOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const rawFile = cfg.thinkingEffort ?? cfg.thinking_effort
  if (rawFile !== undefined) return normalizeThinkingEffort(rawFile)
  if (env && (env.LMTAGENT_THINKING_EFFORT || env.REDTEAM_THINKING_EFFORT || env.DSH_SUBAGENT_THINKING)) {
    return normalizeThinkingEffort(env.LMTAGENT_THINKING_EFFORT || env.REDTEAM_THINKING_EFFORT || env.DSH_SUBAGENT_THINKING)
  }
  return normalizeThinkingEffort(DEFAULT_THINKING_EFFORT)
}

const fallbackMaxDepthOf = (s, env = process.env) => {
  const cfg = readCachedSettingsObj(s)
  const fromFile = Number(cfg.maxDepth ?? cfg.max_depth)
  if (Number.isFinite(fromFile) && fromFile >= 1) return clampMaxDepth(fromFile)
  const envVal = (env && (env.LMTAGENT_MAX_DEPTH ?? env.REDTEAM_MAX_DEPTH))
  if (envVal !== undefined && envVal !== '') {
    return clampMaxDepth(envVal)
  }
  return clampMaxDepth(DEFAULT_MAX_DEPTH)
}

export const maxAgentsOf = (rootOrObj, env = process.env) =>
  (settingsMod.maxAgentsOf || fallbackMaxAgentsOf)(resolveCachedSettingsArg(rootOrObj), env)

export const maxAgentsSourceOf = (rootOrObj, env = process.env) =>
  (settingsMod.maxAgentsSourceOf || fallbackMaxAgentsSourceOf)(resolveCachedSettingsArg(rootOrObj), env)

export const saveMaxAgents = (root, n) => {
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

export const savePgUrl = (root, pgUrl) => {
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

export const thinkingEffortOf = (rootOrObj, env = process.env) =>
  (settingsMod.thinkingEffortOf || fallbackThinkingEffortOf)(resolveCachedSettingsArg(rootOrObj), env)

export const saveThinkingEffort = (root, effort) => {
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

export const maxDepthOf = (rootOrObj, env = process.env) =>
  (settingsMod.maxDepthOf || fallbackMaxDepthOf)(resolveCachedSettingsArg(rootOrObj), env)

export const saveMaxDepth = (root, n) => {
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

export const DEFAULT_AI_PLANNER_SETTINGS = Object.freeze({
  modelMode: 'inherit',
  provider: '',
  model: '',
  reasoningEffort: '',
  timeoutMs: 60000,
  scanRepoContext: true,
  customConstraints: '',
})

export const DEFAULT_DISPATCH_POLICY = Object.freeze({
  dispatchMode: 'hybrid_auto',
  subagentProvider: 'spawn',
  autoWakeOnApprove: true,
  autoAdvanceWave: false,
  speculativeWaveDispatch: false,
  maxTokensPerWorkspace: 0,
  maxCostPerWorkspace: 0,
  maxAutoRetries: 1,
})

export const DEFAULT_UI_PREFERENCES = Object.freeze({
  defaultViewMode: 'expert',
  defaultTreeDirection: 'horizontal',
  locale: 'auto',
})

export function resolveRedteamSettingsRoot(root, env = process.env) {
  if (typeof root === 'string' && root.trim() !== '') return root.trim()
  if (root && typeof root === 'object' && typeof root.root === 'string' && root.root.trim() !== '') {
    return root.root.trim()
  }
  if (env && typeof env.LMTAGENT_HOME === 'string' && env.LMTAGENT_HOME.trim() !== '') {
    return env.LMTAGENT_HOME.trim()
  }
  if (env && typeof env.REDTEAM_HOME === 'string' && env.REDTEAM_HOME.trim() !== '') {
    return env.REDTEAM_HOME.trim()
  }
  const dshHome = env && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(dshHome, 'lmtagent')
}

export function clampIntInRange(value, minVal, maxVal, fallback) {
  if (value === undefined || value === null || typeof value === 'boolean' || value === '') return fallback
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, minVal), maxVal)
}

function normalizeNonNegFloat(value, fallback = 0) {
  if (value === undefined || value === null || typeof value === 'boolean' || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.round(n * 10000) / 10000
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

function normalizeLocalePref(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'zh-cn' || raw === 'zh') return 'zh-CN'
  if (raw === 'en-us' || raw === 'en') return 'en-US'
  if (raw === 'auto') return 'auto'
  return DEFAULT_UI_PREFERENCES.locale
}

export function normalizeUnifiedSettings(raw = {}, env = process.env) {
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
      autoAdvanceWave: normalizeSettingBool(rawDispatch.autoAdvanceWave ?? rawDispatch.auto_advance_wave, DEFAULT_DISPATCH_POLICY.autoAdvanceWave),
      speculativeWaveDispatch: normalizeSettingBool(
        rawDispatch.speculativeWaveDispatch ?? rawDispatch.speculative_wave_dispatch,
        DEFAULT_DISPATCH_POLICY.speculativeWaveDispatch,
      ),
      maxTokensPerWorkspace: clampIntInRange(
        rawDispatch.maxTokensPerWorkspace ?? rawDispatch.max_tokens_per_workspace,
        0,
        Number.MAX_SAFE_INTEGER,
        DEFAULT_DISPATCH_POLICY.maxTokensPerWorkspace,
      ),
      maxCostPerWorkspace: normalizeNonNegFloat(
        rawDispatch.maxCostPerWorkspace ?? rawDispatch.max_cost_per_workspace,
        DEFAULT_DISPATCH_POLICY.maxCostPerWorkspace,
      ),
      maxAutoRetries: clampIntInRange(
        rawDispatch.maxAutoRetries ?? rawDispatch.max_auto_retries,
        0,
        MAX_AUTO_RETRIES_LIMIT,
        DEFAULT_DISPATCH_POLICY.maxAutoRetries,
      ),
    },
    uiPreferences: {
      defaultViewMode: rawViewMode === 'novice' ? 'novice' : 'expert',
      defaultTreeDirection: rawTreeDir === 'vertical' ? 'vertical' : 'horizontal',
      locale: normalizeLocalePref(rawUi.locale ?? src.locale),
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
        const fileDispatch = (fileObj && typeof fileObj.dispatchPolicy === 'object' && fileObj.dispatchPolicy)
          || (fileObj && typeof fileObj.dispatch_policy === 'object' && fileObj.dispatch_policy)
          || {}
        const fileUi = (fileObj && typeof fileObj.uiPreferences === 'object' && fileObj.uiPreferences)
          || (fileObj && typeof fileObj.ui_preferences === 'object' && fileObj.ui_preferences)
          || {}
        const mergedDispatch = Object.assign(
          {},
          modObj.dispatchPolicy && typeof modObj.dispatchPolicy === 'object' ? modObj.dispatchPolicy : {},
          fileDispatch,
        )
        const mergedUi = Object.assign(
          {},
          modObj.uiPreferences && typeof modObj.uiPreferences === 'object' ? modObj.uiPreferences : {},
          fileUi,
        )
        const base = normalizeUnifiedSettings(
          Object.assign({}, fileObj, modObj, { dispatchPolicy: mergedDispatch, uiPreferences: mergedUi }),
          env,
        )
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

  const dispatchPatch = Object.assign(
    {},
    (p.dispatchPolicy && typeof p.dispatchPolicy === 'object')
      ? p.dispatchPolicy
      : ((p.dispatch_policy && typeof p.dispatch_policy === 'object') ? p.dispatch_policy : {}),
  )
  for (const [camel, snake] of [
    ['speculativeWaveDispatch', 'speculative_wave_dispatch'],
    ['maxTokensPerWorkspace', 'max_tokens_per_workspace'],
    ['maxCostPerWorkspace', 'max_cost_per_workspace'],
    ['maxAutoRetries', 'max_auto_retries'],
    ['autoAdvanceWave', 'auto_advance_wave'],
    ['autoWakeOnApprove', 'auto_wake_on_approve'],
  ]) {
    if (p[camel] !== undefined && dispatchPatch[camel] === undefined) dispatchPatch[camel] = p[camel]
    if (p[snake] !== undefined && dispatchPatch[snake] === undefined && dispatchPatch[camel] === undefined) {
      dispatchPatch[camel] = p[snake]
    }
  }
  if (Object.keys(dispatchPatch).length > 0) {
    nextObj.dispatchPolicy = Object.assign({}, curNorm.dispatchPolicy, dispatchPatch)
  } else if (!nextObj.dispatchPolicy) {
    nextObj.dispatchPolicy = curNorm.dispatchPolicy
  }

  const uiPatch = Object.assign(
    {},
    (p.uiPreferences && typeof p.uiPreferences === 'object')
      ? p.uiPreferences
      : ((p.ui_preferences && typeof p.ui_preferences === 'object') ? p.ui_preferences : {}),
  )
  if (p.locale !== undefined && uiPatch.locale === undefined) {
    uiPatch.locale = p.locale
  }
  if (Object.keys(uiPatch).length > 0) {
    nextObj.uiPreferences = Object.assign({}, curNorm.uiPreferences, uiPatch)
  } else if (!nextObj.uiPreferences) {
    nextObj.uiPreferences = curNorm.uiPreferences
  }

  const normalizedPatch = normalizeUnifiedSettings(nextObj, env)
  if (typeof settingsMod.saveUnifiedSettings === 'function') {
    const saved = settingsMod.saveUnifiedSettings(effRoot, normalizedPatch, env)
    const sd = (saved && saved.dispatchPolicy) || {}
    const su = (saved && saved.uiPreferences) || {}
    const needsFallbackWrite = sd.autoAdvanceWave !== normalizedPatch.dispatchPolicy.autoAdvanceWave
      || sd.speculativeWaveDispatch !== normalizedPatch.dispatchPolicy.speculativeWaveDispatch
      || sd.maxTokensPerWorkspace !== normalizedPatch.dispatchPolicy.maxTokensPerWorkspace
      || sd.maxCostPerWorkspace !== normalizedPatch.dispatchPolicy.maxCostPerWorkspace
      || sd.maxAutoRetries !== normalizedPatch.dispatchPolicy.maxAutoRetries
      || su.locale !== normalizedPatch.uiPreferences.locale
    if (needsFallbackWrite) {
      writeSettings(effRoot, {
        dispatchPolicy: normalizedPatch.dispatchPolicy,
        uiPreferences: normalizedPatch.uiPreferences,
      })
    }
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

export function maskPgUrlSafe(rawUrl) {
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

export function getCachedActiveEngagementId(store) {
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

export function getCachedEngagementsList(store) {
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

export function getCachedSessionBindingsMap(store) {
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

export function getCachedSessionBindingEntry(store, sessionId) {
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
