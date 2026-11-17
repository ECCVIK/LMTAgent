/**
 * 插件级设置与文件分片冲突判定（零依赖）：
 *   1. **并发执行智能体上限（maxAgents）**：默认 6 并发（合法范围 1..12）；
 *   2. **子智能体默认思考强度（thinkingEffort）**：默认 `'low'`（合法值 `'low' | 'medium' | 'high'`，`'none'` 或非法值收敛为 `'low'`）；
 *   3. **子智能体最大递归派发深度（maxDepth）**：默认 3（合法范围 1..5）；
 *   4. **PostgreSQL 数据库连接配置（pgUrl）**：兼容 `$DSH_HOME/redteam/settings.json` 同文件存储；
 *   5. **AI Planner / 派发策略 / UI 偏好统一设置（aiPlanner / dispatchPolicy / uiPreferences）**；
 *   6. **File-Disjoint Sharding 纯函数**：`normalizeShardPattern` / `detectShardConflicts`。
 *
 * 生效顺序：settings.json → 环境变量（`REDTEAM_MAX_AGENTS` / `REDTEAM_THINKING_EFFORT` / `DSH_SUBAGENT_THINKING` / `REDTEAM_MAX_DEPTH` / `REDTEAM_PG_URL`） → 默认值。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 默认并发上限（研发集群 4-Wave DAG 默认 6 并发槽）。 */
export const DEFAULT_MAX_AGENTS = 6

/** 并发槽最小/最大硬上限（1..12）。 */
const MIN_AGENTS_LIMIT = 1
export const MAX_AGENTS_LIMIT = 12

/** 子代理默认思考强度（默认 low，兼顾高并发响应速度与 token 效率）。 */
export const DEFAULT_THINKING_EFFORT = 'low'
export const VALID_THINKING_EFFORTS = ['low', 'medium', 'high']

/** 子代理递归派发最大深度（默认 3，范围 1..5）。 */
export const DEFAULT_MAX_DEPTH = 3
const MIN_MAX_DEPTH = 1
export const MAX_DEPTH_LIMIT = 5

/** 默认并发槽 / 分片租约 TTL（2 分钟 = 120,000ms）。 */
export const DEFAULT_LEASE_TTL_MS = 120_000

/** AI Planner 默认配置（默认跟随当前会话模型）。 */
export const DEFAULT_AI_PLANNER = {
  modelMode: 'follow_session',
  provider: '',
  model: '',
  reasoningEffort: 'low',
  timeoutMs: 60000,
  scanRepoContext: true,
  customConstraints: '',
}

export const VALID_PLANNER_REASONING_EFFORTS = ['none', 'low', 'medium', 'high']

const MIN_PLANNER_TIMEOUT_MS = 15000
const MAX_PLANNER_TIMEOUT_MS = 180000

/** 默认子智能体派发策略。 */
export const DEFAULT_DISPATCH_POLICY = {
  dispatchMode: 'hybrid_auto',
  subagentProvider: 'spawn',
  autoWakeOnApprove: true,
  autoAdvanceWave: false,
}

/** 默认界面视图与拓扑方向偏好。 */
export const DEFAULT_UI_PREFERENCES = {
  defaultViewMode: 'novice',
  defaultTreeDirection: 'horizontal',
}

function defaultRedteamRoot(env = process.env) {
  const dshHome = (env && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '')
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(dshHome, 'redteam')
}

function resolveRootDir(root, env = process.env) {
  if (typeof root === 'string' && root.trim() !== '') {
    const trimmed = root.trim()
    return trimmed.endsWith('settings.json') ? dirname(trimmed) : trimmed
  }
  if (root && typeof root === 'object' && typeof root.root === 'string' && root.root.trim() !== '') {
    const trimmed = root.root.trim()
    return trimmed.endsWith('settings.json') ? dirname(trimmed) : trimmed
  }
  return defaultRedteamRoot(env)
}

function settingsPathOf(root, env = process.env) {
  if (typeof root === 'string' && root.trim().endsWith('settings.json')) {
    return root.trim()
  }
  return join(resolveRootDir(root, env), 'settings.json')
}

const _settingsCache = new Map()

function readSettings(root, env = process.env) {
  if (root && typeof root === 'object' && !('root' in root)) return root
  try {
    const file = settingsPathOf(root, env)
    let st
    try {
      st = statSync(file)
    } catch {
      _settingsCache.delete(file)
      return {}
    }
    const cached = _settingsCache.get(file)
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.data
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const data = parsed && typeof parsed === 'object' ? parsed : {}
    if (_settingsCache.size >= 64) {
      const oldest = _settingsCache.keys().next().value
      if (oldest !== undefined) _settingsCache.delete(oldest)
    }
    _settingsCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data })
    return data
  } catch {
    return {}
  }
}

/** 合并写入若干项设置，返回写入后的完整设置对象。 */
export function writeSettings(root, patch, env = process.env) {
  const dir = resolveRootDir(root, env)
  const file = settingsPathOf(dir, env)
  const next = Object.assign({}, readSettings(dir, env), patch)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  try {
    const st = statSync(file)
    _settingsCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data: next })
  } catch {
    _settingsCache.delete(file)
  }
  return next
}

/** 把任意输入收敛到 [1, 12] 的整数并发上限；缺失或非数字回退默认值 6。 */
export function clampMaxAgents(value) {
  if (value === undefined || value === null || typeof value === 'boolean') return DEFAULT_MAX_AGENTS
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_MAX_AGENTS
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_MAX_AGENTS
  return Math.min(Math.max(n, MIN_AGENTS_LIMIT), MAX_AGENTS_LIMIT)
}

/** 规范化思考强度到 `'low' | 'medium' | 'high'`，`'none'` 或非法值统一收敛为 `'low'`。 */
export function normalizeThinkingEffort(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === '' || raw === 'none') return DEFAULT_THINKING_EFFORT
  return VALID_THINKING_EFFORTS.includes(raw) ? raw : DEFAULT_THINKING_EFFORT
}

/** 把任意输入收敛到 [1, 5] 的整数递归深度；缺失或非数字回退默认值 3。 */
export function clampMaxDepth(value) {
  if (value === undefined || value === null || typeof value === 'boolean') return DEFAULT_MAX_DEPTH
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_MAX_DEPTH
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_MAX_DEPTH
  return Math.min(Math.max(n, MIN_MAX_DEPTH), MAX_DEPTH_LIMIT)
}

/** 当前生效的并发上限（1..12，默认 6）。 */
export function maxAgentsOf(root, env = process.env) {
  const s = readSettings(root, env)
  const fromFile = Number(s.maxAgents ?? s.max_agents)
  if (Number.isFinite(fromFile) && fromFile > 0) return clampMaxAgents(fromFile)
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return clampMaxAgents(fromEnv)
  return DEFAULT_MAX_AGENTS
}

/** 并发上限配置来源（`'settings' | 'env' | 'default'`）。 */
export function maxAgentsSourceOf(root, env = process.env) {
  const s = readSettings(root, env)
  const fromFile = Number(s.maxAgents ?? s.max_agents)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return 'env'
  return 'default'
}

function isRecognizedThinkingInput(raw) {
  if (typeof raw !== 'string') return false
  const cleaned = raw.trim().toLowerCase()
  return cleaned === 'none' || VALID_THINKING_EFFORTS.includes(cleaned)
}

/** 当前生效的子智能体默认思考强度（`'low' | 'medium' | 'high'`，默认 `'low'`）。 */
export function thinkingEffortOf(root, env = process.env) {
  const s = readSettings(root, env)
  const rawFile = s.thinkingEffort ?? s.thinking_effort
  if (isRecognizedThinkingInput(rawFile)) {
    return normalizeThinkingEffort(rawFile)
  }
  const rawRedteamEnv = env && env.REDTEAM_THINKING_EFFORT
  if (isRecognizedThinkingInput(rawRedteamEnv)) {
    return normalizeThinkingEffort(rawRedteamEnv)
  }
  const rawDshEnv = env && env.DSH_SUBAGENT_THINKING
  if (isRecognizedThinkingInput(rawDshEnv)) {
    return normalizeThinkingEffort(rawDshEnv)
  }
  return DEFAULT_THINKING_EFFORT
}

/** 当前生效的子智能体最大递归派发深度（1..5，默认 3）。 */
export function maxDepthOf(root, env = process.env) {
  const s = readSettings(root, env)
  const fromFile = Number(s.maxDepth ?? s.max_depth)
  if (Number.isFinite(fromFile) && fromFile >= 1) return clampMaxDepth(fromFile)
  const fromEnv = Number(env && env.REDTEAM_MAX_DEPTH)
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return clampMaxDepth(fromEnv)
  return DEFAULT_MAX_DEPTH
}

/**
 * 保存并发上限（兼容 `saveMaxAgents(root, value)` 与 `saveMaxAgents(numericValue)`）。
 * 当 `maybeValue === undefined` 时，仅在 `typeof rootOrValue === 'number'` 时视作单参数数值，
 * 否则显式抛错，杜绝把字符串目录名误判为数值或静默覆写为默认值 6。
 */
export function saveMaxAgents(rootOrValue, maybeValue, env = process.env) {
  if (maybeValue === undefined) {
    if (typeof rootOrValue === 'number' && Number.isFinite(rootOrValue)) {
      const applied = clampMaxAgents(rootOrValue)
      writeSettings(undefined, { maxAgents: applied }, env)
      return applied
    }
    throw new TypeError('saveMaxAgents requires an explicit numeric value (saveMaxAgents(value) or saveMaxAgents(root, value))')
  }
  const applied = clampMaxAgents(maybeValue)
  writeSettings(rootOrValue, { maxAgents: applied }, env)
  return applied
}

/**
 * 保存子智能体默认思考强度（`'low' | 'medium' | 'high'`），返回实际生效值。
 */
export function saveThinkingEffort(rootOrValue, maybeValue, env = process.env) {
  if (maybeValue === undefined) {
    if (isRecognizedThinkingInput(rootOrValue)) {
      const applied = normalizeThinkingEffort(rootOrValue)
      writeSettings(undefined, { thinkingEffort: applied }, env)
      return applied
    }
    throw new TypeError('saveThinkingEffort requires an explicit effort value (saveThinkingEffort(effort) or saveThinkingEffort(root, effort))')
  }
  const applied = normalizeThinkingEffort(maybeValue)
  writeSettings(rootOrValue, { thinkingEffort: applied }, env)
  return applied
}

/**
 * 保存子智能体最大递归派发深度（1..5），返回实际生效整数值。
 * 当 `maybeValue === undefined` 时，仅在 `typeof rootOrValue === 'number'` 时视作单参数数值。
 */
export function saveMaxDepth(rootOrValue, maybeValue, env = process.env) {
  if (maybeValue === undefined) {
    if (typeof rootOrValue === 'number' && Number.isFinite(rootOrValue)) {
      const applied = clampMaxDepth(rootOrValue)
      writeSettings(undefined, { maxDepth: applied }, env)
      return applied
    }
    throw new TypeError('saveMaxDepth requires an explicit numeric value (saveMaxDepth(value) or saveMaxDepth(root, value))')
  }
  const applied = clampMaxDepth(maybeValue)
  writeSettings(rootOrValue, { maxDepth: applied }, env)
  return applied
}

/**
 * 保存或清除 PostgreSQL 连接串。
 * @param root - 事实库根目录。
 * @param pgUrl - `postgresql://...` 或空字符串（清除）。
 */
export function savePgUrl(root, pgUrl, env = process.env) {
  const clean = typeof pgUrl === 'string' ? pgUrl.trim() : ''
  const dir = resolveRootDir(root, env)
  if (!clean) {
    const next = readSettings(dir, env)
    delete next.pgUrl
    mkdirSync(dir, { recursive: true })
    writeFileSync(settingsPathOf(dir, env), JSON.stringify(next, null, 2) + '\n', 'utf8')
    return null
  }
  if (!/^postgres(?:ql)?:\/\//i.test(clean)) {
    throw new Error('PostgreSQL 连接串必须以 postgres:// 或 postgresql:// 开头')
  }
  writeSettings(dir, { pgUrl: clean }, env)
  return clean
}

function normalizeBoolFlag(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase()
    if (cleaned === 'false' || cleaned === '0' || cleaned === 'no' || cleaned === 'off') return false
    if (cleaned === 'true' || cleaned === '1' || cleaned === 'yes' || cleaned === 'on') return true
    return Boolean(cleaned)
  }
  return Boolean(value)
}

function clampPlannerTimeoutMs(value) {
  if (value === undefined || value === null || typeof value === 'boolean') {
    return DEFAULT_AI_PLANNER.timeoutMs
  }
  if (typeof value === 'string' && value.trim() === '') {
    return DEFAULT_AI_PLANNER.timeoutMs
  }
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_AI_PLANNER.timeoutMs
  return Math.min(Math.max(n, MIN_PLANNER_TIMEOUT_MS), MAX_PLANNER_TIMEOUT_MS)
}

/** 规范化 AI Planner 配置对象，约束枚举值、超时范围 [15000..180000] 与自定义约束长度。 */
export function normalizeAiPlannerConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawMode = src.modelMode ?? src.model_mode
  const cleanedMode = typeof rawMode === 'string' ? rawMode.trim().toLowerCase() : ''
  const modelMode = cleanedMode === 'custom' ? 'custom' : DEFAULT_AI_PLANNER.modelMode

  const provider = typeof src.provider === 'string' ? src.provider.trim() : DEFAULT_AI_PLANNER.provider
  const model = typeof src.model === 'string' ? src.model.trim() : DEFAULT_AI_PLANNER.model

  const rawEffort = src.reasoningEffort ?? src.reasoning_effort
  const cleanedEffort = typeof rawEffort === 'string' ? rawEffort.trim().toLowerCase() : ''
  const reasoningEffort = VALID_PLANNER_REASONING_EFFORTS.includes(cleanedEffort)
    ? cleanedEffort
    : DEFAULT_AI_PLANNER.reasoningEffort

  const timeoutMs = clampPlannerTimeoutMs(src.timeoutMs ?? src.timeout_ms)
  const scanRepoContext = normalizeBoolFlag(
    src.scanRepoContext ?? src.scan_repo_context,
    DEFAULT_AI_PLANNER.scanRepoContext,
  )

  const rawConstraints = src.customConstraints ?? src.custom_constraints
  const customConstraints = typeof rawConstraints === 'string'
    ? rawConstraints.slice(0, 4000)
    : DEFAULT_AI_PLANNER.customConstraints

  return {
    modelMode,
    provider,
    model,
    reasoningEffort,
    timeoutMs,
    scanRepoContext,
    customConstraints,
  }
}

/** 规范化子智能体派发策略配置。 */
export function normalizeDispatchPolicy(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawDispatchMode = src.dispatchMode ?? src.dispatch_mode
  const cleanedDispatchMode = typeof rawDispatchMode === 'string' ? rawDispatchMode.trim().toLowerCase() : ''
  const dispatchMode = cleanedDispatchMode === 'captain_only'
    ? 'captain_only'
    : DEFAULT_DISPATCH_POLICY.dispatchMode

  const rawProvider = src.subagentProvider ?? src.subagent_provider
  const cleanedProvider = typeof rawProvider === 'string' ? rawProvider.trim().toLowerCase() : ''
  const subagentProvider = cleanedProvider === 'fork'
    ? 'fork'
    : DEFAULT_DISPATCH_POLICY.subagentProvider

  const autoWakeOnApprove = normalizeBoolFlag(
    src.autoWakeOnApprove ?? src.auto_wake_on_approve,
    DEFAULT_DISPATCH_POLICY.autoWakeOnApprove,
  )
  const autoAdvanceWave = normalizeBoolFlag(
    src.autoAdvanceWave ?? src.auto_advance_wave,
    DEFAULT_DISPATCH_POLICY.autoAdvanceWave,
  )

  return {
    dispatchMode,
    subagentProvider,
    autoWakeOnApprove,
    autoAdvanceWave,
  }
}

/** 规范化 UI 视图与拓扑方向偏好设置。 */
export function normalizeUiPreferences(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawViewMode = src.defaultViewMode ?? src.default_view_mode
  const cleanedViewMode = typeof rawViewMode === 'string' ? rawViewMode.trim().toLowerCase() : ''
  const defaultViewMode = cleanedViewMode === 'expert'
    ? 'expert'
    : DEFAULT_UI_PREFERENCES.defaultViewMode

  const rawTreeDir = src.defaultTreeDirection ?? src.default_tree_direction
  const cleanedTreeDir = typeof rawTreeDir === 'string' ? rawTreeDir.trim().toLowerCase() : ''
  const defaultTreeDirection = cleanedTreeDir === 'vertical'
    ? 'vertical'
    : DEFAULT_UI_PREFERENCES.defaultTreeDirection

  return {
    defaultViewMode,
    defaultTreeDirection,
  }
}

/** 读取归一化后的 AI Planner 配置。 */
export function aiPlannerConfigOf(root, env = process.env) {
  const s = readSettings(root, env)
  return normalizeAiPlannerConfig(s.aiPlanner ?? s.ai_planner)
}

/** 读取归一化后的子智能体派发策略配置。 */
export function dispatchPolicyOf(root, env = process.env) {
  const s = readSettings(root, env)
  return normalizeDispatchPolicy(s.dispatchPolicy ?? s.dispatch_policy)
}

/** 读取归一化后的界面视图与拓扑方向偏好设置。 */
export function uiPreferencesOf(root, env = process.env) {
  const s = readSettings(root, env)
  return normalizeUiPreferences(s.uiPreferences ?? s.ui_preferences)
}

/** 脱敏 PostgreSQL 连接串中的密码为 `****`。 */
export function maskPgUrl(url) {
  const s = typeof url === 'string' ? url.trim() : String(url || '').trim()
  if (!s) return ''
  const schemeIdx = s.indexOf('://')
  if (schemeIdx < 0) return s
  const authStart = schemeIdx + 3
  const slashIdx = s.indexOf('/', authStart)
  const queryIdx = s.indexOf('?', authStart)
  const hashIdx = s.indexOf('#', authStart)
  const endCandidates = [slashIdx, queryIdx, hashIdx].filter((idx) => idx >= 0)
  const authEnd = endCandidates.length > 0 ? Math.min(...endCandidates) : s.length
  const authority = s.slice(authStart, authEnd)
  const atIdx = authority.lastIndexOf('@')
  if (atIdx < 0) return s
  const userinfo = authority.slice(0, atIdx)
  const colonIdx = userinfo.indexOf(':')
  if (colonIdx < 0 || colonIdx === userinfo.length - 1) return s
  const maskedUserinfo = `${userinfo.slice(0, colonIdx)}:****`
  return `${s.slice(0, authStart)}${maskedUserinfo}${authority.slice(atIdx)}${s.slice(authEnd)}`
}

function resolvePgUrlRaw(root, env = process.env) {
  const s = readSettings(root, env)
  if (typeof s.pgUrl === 'string' && /^postgres(?:ql)?:\/\//i.test(s.pgUrl.trim())) {
    return s.pgUrl.trim()
  }
  const envCandidates = [env?.REDTEAM_PG_URL, env?.DSH_PG_URL, env?.DATABASE_URL]
  for (const cand of envCandidates) {
    if (typeof cand === 'string' && /^postgres(?:ql)?:\/\//i.test(cand.trim())) {
      return cand.trim()
    }
  }
  if (env && typeof env.PGHOST === 'string' && env.PGHOST.trim()) {
    return `postgresql://${encodeURIComponent(env.PGUSER || 'postgres')}:${encodeURIComponent(env.PGPASSWORD || '')}@${env.PGHOST.trim()}:${Number(env.PGPORT) || 5432}/${encodeURIComponent(env.PGDATABASE || 'dsh_devteam')}`
  }
  return ''
}

/** 读取完整归一化后的插件统一设置对象。 */
export function getUnifiedSettings(root, env = process.env) {
  const preloaded = readSettings(root, env)
  const rawPgUrl = resolvePgUrlRaw(preloaded, env)
  return {
    maxAgents: maxAgentsOf(preloaded, env),
    maxAgentsSource: maxAgentsSourceOf(preloaded, env),
    maxDepth: maxDepthOf(preloaded, env),
    thinkingEffort: thinkingEffortOf(preloaded, env),
    pgUrlConfigured: Boolean(rawPgUrl),
    pgUrlMasked: rawPgUrl ? maskPgUrl(rawPgUrl) : '',
    aiPlanner: aiPlannerConfigOf(preloaded, env),
    dispatchPolicy: dispatchPolicyOf(preloaded, env),
    uiPreferences: uiPreferencesOf(preloaded, env),
  }
}

/** 校验并合并保存统一设置到 `settings.json`，返回更新后的 `getUnifiedSettings` 快照。 */
export function saveUnifiedSettings(root, patch, env = process.env) {
  let targetRoot = root
  let targetPatch = patch
  if (patch === undefined && root && typeof root === 'object' && !('root' in root)) {
    targetRoot = undefined
    targetPatch = root
  }
  const src = targetPatch && typeof targetPatch === 'object' && !Array.isArray(targetPatch) ? targetPatch : {}
  const dir = resolveRootDir(targetRoot, env)
  const current = readSettings(dir, env)
  const nextPatch = {}

  if (src.maxAgents !== undefined || src.max_agents !== undefined) {
    nextPatch.maxAgents = clampMaxAgents(src.maxAgents ?? src.max_agents)
  }
  if (src.thinkingEffort !== undefined || src.thinking_effort !== undefined) {
    nextPatch.thinkingEffort = normalizeThinkingEffort(src.thinkingEffort ?? src.thinking_effort)
  }
  if (src.maxDepth !== undefined || src.max_depth !== undefined) {
    nextPatch.maxDepth = clampMaxDepth(src.maxDepth ?? src.max_depth)
  }
  if (src.aiPlanner !== undefined || src.ai_planner !== undefined) {
    const rawPlanner = 'aiPlanner' in src && src.aiPlanner !== undefined ? src.aiPlanner : src.ai_planner
    if (rawPlanner === null) {
      nextPatch.aiPlanner = normalizeAiPlannerConfig(null)
    } else if (rawPlanner && typeof rawPlanner === 'object' && !Array.isArray(rawPlanner)) {
      const prevPlanner = normalizeAiPlannerConfig(current.aiPlanner ?? current.ai_planner)
      nextPatch.aiPlanner = normalizeAiPlannerConfig(Object.assign({}, prevPlanner, rawPlanner))
    }
  }
  if (src.dispatchPolicy !== undefined || src.dispatch_policy !== undefined) {
    const rawPolicy = 'dispatchPolicy' in src && src.dispatchPolicy !== undefined ? src.dispatchPolicy : src.dispatch_policy
    if (rawPolicy === null) {
      nextPatch.dispatchPolicy = normalizeDispatchPolicy(null)
    } else if (rawPolicy && typeof rawPolicy === 'object' && !Array.isArray(rawPolicy)) {
      const prevPolicy = normalizeDispatchPolicy(current.dispatchPolicy ?? current.dispatch_policy)
      const mergedPolicy = Object.assign({}, prevPolicy, rawPolicy)
      if (rawPolicy.dispatch_mode !== undefined && rawPolicy.dispatchMode === undefined) {
        mergedPolicy.dispatchMode = rawPolicy.dispatch_mode
      }
      if (rawPolicy.subagent_provider !== undefined && rawPolicy.subagentProvider === undefined) {
        mergedPolicy.subagentProvider = rawPolicy.subagent_provider
      }
      if (rawPolicy.auto_wake_on_approve !== undefined && rawPolicy.autoWakeOnApprove === undefined) {
        mergedPolicy.autoWakeOnApprove = rawPolicy.auto_wake_on_approve
      }
      if (rawPolicy.auto_advance_wave !== undefined && rawPolicy.autoAdvanceWave === undefined) {
        mergedPolicy.autoAdvanceWave = rawPolicy.auto_advance_wave
      }
      nextPatch.dispatchPolicy = normalizeDispatchPolicy(mergedPolicy)
    }
  }
  if (src.uiPreferences !== undefined || src.ui_preferences !== undefined) {
    const rawUi = 'uiPreferences' in src && src.uiPreferences !== undefined ? src.uiPreferences : src.ui_preferences
    if (rawUi === null) {
      nextPatch.uiPreferences = normalizeUiPreferences(null)
    } else if (rawUi && typeof rawUi === 'object' && !Array.isArray(rawUi)) {
      const prevUi = normalizeUiPreferences(current.uiPreferences ?? current.ui_preferences)
      nextPatch.uiPreferences = normalizeUiPreferences(Object.assign({}, prevUi, rawUi))
    }
  }

  const hasPgUrl = ('pgUrl' in src && src.pgUrl !== undefined) || ('pg_url' in src && src.pg_url !== undefined)
  let pgUrlValue
  if (hasPgUrl) {
    pgUrlValue = 'pgUrl' in src && src.pgUrl !== undefined ? src.pgUrl : src.pg_url
    if (pgUrlValue !== null && typeof pgUrlValue === 'string' && pgUrlValue.trim() !== '') {
      if (!/^postgres(?:ql)?:\/\//i.test(pgUrlValue.trim())) {
        throw new Error('PostgreSQL 连接串必须以 postgres:// 或 postgresql:// 开头')
      }
    }
  }

  writeSettings(dir, nextPatch, env)

  if (hasPgUrl) {
    if (pgUrlValue === null || (typeof pgUrlValue === 'string' && pgUrlValue.trim() === '')) {
      savePgUrl(dir, '', env)
    } else if (typeof pgUrlValue === 'string') {
      savePgUrl(dir, pgUrlValue, env)
    }
  }

  return getUnifiedSettings(dir, env)
}

/* ============================================================================
 * File-Disjoint Sharding 纯确定性冲突检测
 * ========================================================================== */

/**
 * 规范化分片路径/模式：统一正斜杠、去除前导 `./` 或 `/`、折叠重复 `/` 并去除尾部 `/`。
 */
export function normalizeShardPattern(p) {
  if (typeof p !== 'string') return ''
  let s = p.trim()
  if (s === '') return ''
  s = s.replace(/\\+/g, '/').replace(/\/+/g, '/')
  while (s.startsWith('./') || s.startsWith('/')) {
    s = s.startsWith('./') ? s.slice(2) : s.slice(1)
  }
  s = s.replace(/\/\.\//g, '/')
  s = s.replace(/\/+$/, '')
  return s === '.' ? '' : s
}

function parseSubtreeGlob(norm) {
  if (norm === '*' || norm === '**') return { isRootAll: true, base: '', hasMidWildcard: false }
  if (/(?:\/\*\*|\/\*)+$/.test(norm)) {
    const base = norm.replace(/(?:\/\*\*|\/\*)+$/, '')
    if (!/[*?]/.test(base)) {
      return { isRootAll: base === '', base, isSubtree: true, hasMidWildcard: false }
    }
  }
  return { isRootAll: false, base: norm, isSubtree: false, hasMidWildcard: /[*?]/.test(norm) }
}

function globToRegExp(globPat) {
  let re = '^'
  for (let i = 0; i < globPat.length; i += 1) {
    const ch = globPat[i]
    if (ch === '*') {
      if (globPat[i + 1] === '*') {
        re += '.*'
        i += 1
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('\\.^$+()[]{}|'.includes(ch)) {
      re += '\\' + ch
    } else {
      re += ch
    }
  }
  re += '$'
  return new RegExp(re)
}

/**
 * 判断两个文件路径 / 目录前缀 / `dir/*` 通配符是否存在交集（File-Disjoint Sharding）。
 * 例如：
 *   - `'packages/redteam-ui/lib/client.js'` 与 `'packages/redteam-ui/*'` → `true`
 *   - `'packages/redteam-ui/lib/client.js'` 与 `'packages/redteam-ui/lib/styles.js'` → `false`
 */
function filesOverlap(patA, patB) {
  const a = normalizeShardPattern(patA)
  const b = normalizeShardPattern(patB)
  if (a === '' || b === '') return false
  if (a === b) return true

  const infoA = parseSubtreeGlob(a)
  const infoB = parseSubtreeGlob(b)
  if (infoA.isRootAll || infoB.isRootAll) return true

  if (!infoA.hasMidWildcard && !infoB.hasMidWildcard) {
    const baseA = infoA.base
    const baseB = infoB.base
    if (baseA === baseB) return true
    if (baseB.startsWith(baseA + '/') || baseA.startsWith(baseB + '/')) return true
    return false
  }

  const reA = globToRegExp(infoA.isSubtree ? infoA.base + '/**' : a)
  const reB = globToRegExp(infoB.isSubtree ? infoB.base + '/**' : b)
  if (!infoA.hasMidWildcard && reB.test(infoA.base)) return true
  if (!infoB.hasMidWildcard && reA.test(infoB.base)) return true
  if (reA.test(b) || reB.test(a)) return true

  const staticPrefixOf = (s) => {
    const idx = s.search(/[*?]/)
    if (idx <= 0) return ''
    const cut = s.slice(0, idx)
    const slash = cut.lastIndexOf('/')
    return slash >= 0 ? cut.slice(0, slash) : ''
  }
  const prefA = staticPrefixOf(a)
  const prefB = staticPrefixOf(b)
  if (prefA === prefB || prefA === '' || prefB === '') return true
  return prefB.startsWith(prefA + '/') || prefA.startsWith(prefB + '/')
}

function normalizeActiveEntries(activeEntries) {
  if (!activeEntries) return []
  const out = []
  if (activeEntries instanceof Map) {
    for (const [k, v] of activeEntries.entries()) {
      if (Array.isArray(v)) out.push({ owner: String(k), patterns: v })
      else if (v && typeof v === 'object') out.push(Object.assign({ owner: String(k) }, v))
    }
  } else if (Array.isArray(activeEntries)) {
    for (const item of activeEntries) {
      if (item && typeof item === 'object') out.push(item)
    }
  } else if (typeof activeEntries === 'object') {
    for (const [k, v] of Object.entries(activeEntries)) {
      if (Array.isArray(v)) out.push({ owner: String(k), patterns: v })
      else if (v && typeof v === 'object') out.push(Object.assign({ owner: String(k) }, v))
    }
  }
  return out.map((entry) => {
    const owner = String(
      entry.owner ?? entry.worker_name ?? entry.workerName ?? entry.label ?? entry.key ?? entry.agent ?? entry.id ?? 'unknown',
    ).trim() || 'unknown'
    let rawPatterns = []
    if (Array.isArray(entry.files_owned)) rawPatterns = entry.files_owned
    else if (Array.isArray(entry.filesOwned)) rawPatterns = entry.filesOwned
    else if (Array.isArray(entry.files)) rawPatterns = entry.files
    else if (Array.isArray(entry.patterns)) rawPatterns = entry.patterns
    else if (typeof entry.pattern === 'string') rawPatterns = [entry.pattern]
    else if (typeof entry.file === 'string') rawPatterns = [entry.file]
    return { owner, key: entry.key, patterns: rawPatterns }
  })
}

/**
 * 检测请求独占的文件分片与当前活跃 Worker 分片是否冲突。
 * @returns `{ ok: boolean, conflicts: Array<{ file: string, owner: string, pattern: string }> }`
 */
export function detectShardConflicts(requestedFiles, activeEntries, options = {}) {
  const reqList = typeof requestedFiles === 'string'
    ? [requestedFiles]
    : (Array.isArray(requestedFiles) ? requestedFiles : [])
  const entries = normalizeActiveEntries(activeEntries)
  const ignoreOwner = options && typeof options.ignoreOwner === 'string' && options.ignoreOwner.trim() !== ''
    ? options.ignoreOwner.trim()
    : null
  const conflicts = []
  const seen = new Set()

  for (const rawFile of reqList) {
    const file = normalizeShardPattern(rawFile)
    if (file === '') continue
    for (const entry of entries) {
      if (ignoreOwner !== null && (entry.owner === ignoreOwner || entry.key === ignoreOwner)) continue
      for (const rawPat of entry.patterns) {
        const pattern = normalizeShardPattern(rawPat)
        if (pattern === '') continue
        if (filesOverlap(file, pattern)) {
          const dedupKey = `${file}::${entry.owner}::${pattern}`
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey)
            conflicts.push({ file, owner: entry.owner, pattern })
          }
        }
      }
    }
  }

  return { ok: conflicts.length === 0, conflicts }
}
