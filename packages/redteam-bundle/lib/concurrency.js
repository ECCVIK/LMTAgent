/**
 * 研发集群并发、递归子代理配置与 File-Disjoint Sharding 冲突检测（零依赖，与 `redteam-store/lib/settings.js` 口径完全统一）：
 *   1. **并发执行智能体上限（maxAgents）**：默认 6 并发（合法范围 1..12）；
 *   2. **子智能体默认思考强度（thinkingEffort）**：默认 `'low'`（合法值 `'low' | 'medium' | 'high'`，`'none'` 或非法值收敛为 `'low'`）；
 *   3. **子智能体最大递归派发深度（maxDepth）**：默认 3（合法范围 1..5，支持子代理递归派发解决局部小问题）；
 *   4. **PostgreSQL 数据库连接配置（pgUrl）**：兼容 `$DSH_HOME/redteam/settings.json` 同文件存储；
 *   5. **File-Disjoint Sharding 纯函数与分片锁注册表**：`normalizeShardPattern` / `filesOverlap` / `detectShardConflicts` / `ShardLockRegistry`。
 *
 * 存储路径：`$DSH_HOME/redteam/settings.json`（或传入的 `root/settings.json`）。
 * 生效顺序：settings.json → 环境变量（`REDTEAM_MAX_AGENTS` / `REDTEAM_THINKING_EFFORT` / `DSH_SUBAGENT_THINKING` / `REDTEAM_MAX_DEPTH`） → 默认值。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 默认并发上限（研发集群 4-Wave DAG 默认 6 并发槽）。 */
export const DEFAULT_MAX_AGENTS = 6

/** 并发槽最小/最大硬上限（1..12）。 */
export const MIN_AGENTS_LIMIT = 1
export const MAX_AGENTS_LIMIT = 12

/** 子代理默认思考开销级别：默认 low（低思考开销、高并发快速执行）。 */
export const DEFAULT_THINKING_EFFORT = 'low'

/** 允许的思考强度枚举。 */
export const VALID_THINKING_EFFORTS = ['low', 'medium', 'high']

/** 子代理递归派发默认最大深度（主代理 → 子代理 → 孙代理 → 曾孙代理，maxDepth: 3）。 */
export const DEFAULT_MAX_DEPTH = 3

/** 递归派发深度范围（1..5）。 */
export const MIN_MAX_DEPTH = 1
export const MAX_MAX_DEPTH = 5
export const MAX_DEPTH_LIMIT = 5

/** 默认并发槽 / 分片租约 TTL（2 分钟 = 120,000ms）。 */
export const DEFAULT_LEASE_TTL_MS = 120_000

/** 解析默认的 `$DSH_HOME/redteam` 目录。 */
export function defaultRedteamRoot(env = process.env) {
  const dshHome = (env && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '')
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(dshHome, 'redteam')
}

/** 归一化 root 参数：未传或传了配置对象时自动回退到 `$DSH_HOME/redteam`。 */
export function resolveRootDir(root, env = process.env) {
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

/** 设置文件路径（`$DSH_HOME/redteam/settings.json` 或 `<root>/settings.json`）。 */
export function settingsPathOf(root, env = process.env) {
  if (typeof root === 'string' && root.trim().endsWith('settings.json')) {
    return root.trim()
  }
  return join(resolveRootDir(root, env), 'settings.json')
}

/** 读全部设置（读不到或损坏时返回空对象，绝不抛错）。 */
export function readSettings(root, env = process.env) {
  try {
    const file = settingsPathOf(root, env)
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
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
  return Math.min(Math.max(n, MIN_MAX_DEPTH), MAX_MAX_DEPTH)
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

/** 思考强度配置来源（`'settings' | 'env' | 'default'`）。 */
export function thinkingEffortSourceOf(root, env = process.env) {
  const s = readSettings(root, env)
  const rawFile = s.thinkingEffort ?? s.thinking_effort
  if (isRecognizedThinkingInput(rawFile)) return 'settings'
  if (env && (isRecognizedThinkingInput(env.REDTEAM_THINKING_EFFORT) || isRecognizedThinkingInput(env.DSH_SUBAGENT_THINKING))) {
    return 'env'
  }
  return 'default'
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

/** 递归深度配置来源（`'settings' | 'env' | 'default'`）。 */
export function maxDepthSourceOf(root, env = process.env) {
  const s = readSettings(root, env)
  const fromFile = Number(s.maxDepth ?? s.max_depth)
  if (Number.isFinite(fromFile) && fromFile >= 1) return 'settings'
  const fromEnv = Number(env && env.REDTEAM_MAX_DEPTH)
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return 'env'
  return 'default'
}

/**
 * 读取集群并发与递归子代理完整配置（`maxAgents` / `thinkingEffort` / `maxDepth`）。
 * 同时返回 camelCase 与 snake_case 字段，方便工具层与 UI 面板直接消费。
 */
export function readClusterSettings(root, env = process.env) {
  const resolvedEnv = (root && typeof root === 'object' && root.env) ? root.env : env
  const dir = resolveRootDir(root, resolvedEnv)
  const maxAgents = maxAgentsOf(dir, resolvedEnv)
  const source = maxAgentsSourceOf(dir, resolvedEnv)
  const thinkingEffort = thinkingEffortOf(dir, resolvedEnv)
  const thinkingEffortSource = thinkingEffortSourceOf(dir, resolvedEnv)
  const maxDepth = maxDepthOf(dir, resolvedEnv)
  const maxDepthSource = maxDepthSourceOf(dir, resolvedEnv)
  return {
    max: maxAgents,
    maxAgents,
    max_agents: maxAgents,
    default: DEFAULT_MAX_AGENTS,
    defaultMaxAgents: DEFAULT_MAX_AGENTS,
    default_max_agents: DEFAULT_MAX_AGENTS,
    limit: MAX_AGENTS_LIMIT,
    maxAgentsLimit: MAX_AGENTS_LIMIT,
    max_agents_limit: MAX_AGENTS_LIMIT,
    source,
    thinkingEffort,
    thinking_effort: thinkingEffort,
    defaultThinkingEffort: DEFAULT_THINKING_EFFORT,
    default_thinking_effort: DEFAULT_THINKING_EFFORT,
    validThinkingEfforts: VALID_THINKING_EFFORTS,
    thinkingEffortSource,
    thinking_effort_source: thinkingEffortSource,
    maxDepth,
    max_depth: maxDepth,
    defaultMaxDepth: DEFAULT_MAX_DEPTH,
    default_max_depth: DEFAULT_MAX_DEPTH,
    minMaxDepth: MIN_MAX_DEPTH,
    maxMaxDepth: MAX_MAX_DEPTH,
    maxDepthLimit: MAX_DEPTH_LIMIT,
    maxDepthSource,
    max_depth_source: maxDepthSource,
    path: settingsPathOf(dir, resolvedEnv),
  }
}

/**
 * 保存集群并发与递归子代理配置（支持 `writeClusterSettings({ maxAgents, thinkingEffort, maxDepth })`
 * 或 `writeClusterSettings(root, { maxAgents, thinkingEffort, maxDepth })`）。
 */
export function writeClusterSettings(rootOrPatch = {}, maybePatch = undefined, env = process.env) {
  let root
  let input
  if (typeof rootOrPatch === 'string') {
    root = rootOrPatch
    input = (maybePatch && typeof maybePatch === 'object') ? maybePatch : {}
  } else if (rootOrPatch && typeof rootOrPatch === 'object') {
    root = rootOrPatch.root
    input = rootOrPatch
  } else {
    root = undefined
    input = {}
  }
  const resolvedEnv = (input && input.env) ? input.env : env
  const dir = resolveRootDir(root, resolvedEnv)
  const patch = {}

  const rawMaxAgents = input.maxAgents ?? input.max_agents ?? input.max
  if (rawMaxAgents !== undefined && rawMaxAgents !== null && rawMaxAgents !== '') {
    patch.maxAgents = clampMaxAgents(rawMaxAgents)
  }

  const rawThinking = input.thinkingEffort ?? input.thinking_effort ?? input.thinking
  if (rawThinking !== undefined && rawThinking !== null && rawThinking !== '') {
    patch.thinkingEffort = normalizeThinkingEffort(rawThinking)
  }

  const rawMaxDepth = input.maxDepth ?? input.max_depth ?? input.depth
  if (rawMaxDepth !== undefined && rawMaxDepth !== null && rawMaxDepth !== '') {
    patch.maxDepth = clampMaxDepth(rawMaxDepth)
  }

  writeSettings(dir, patch, resolvedEnv)
  return readClusterSettings(dir, resolvedEnv)
}

/**
 * 读取并发上限及关联的 `thinking_effort` / `max_depth` 状态。
 */
export function readMaxAgents(root, env = process.env) {
  return readClusterSettings(root, env)
}

/**
 * 保存并发上限（兼容 `saveMaxAgents(root, value)` 与 `saveMaxAgents(numericValue)`），返回实际生效整数值。
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
 * 组装并发槽与递归子代理状态（供 `redteam_agent_slot` 与面板 `agentsStatus` 共用）。
 */
export function clusterConcurrencyStatus(root, live = {}, env = process.env) {
  const cluster = readClusterSettings(root, env)
  const used = Math.max(Number(live.used) || 0, 0)
  const free = Math.max(cluster.maxAgents - used, 0)
  return Object.assign({}, cluster, live, {
    max: cluster.maxAgents,
    used,
    free,
    thinking_effort: cluster.thinkingEffort,
    thinkingEffort: cluster.thinkingEffort,
    max_depth: cluster.maxDepth,
    maxDepth: cluster.maxDepth,
  })
}

/**
 * 读取当前配置的 PostgreSQL 连接串（未配置返回 null）。
 */
export function pgUrlOf(root, env = process.env) {
  const s = readSettings(root, env)
  if (typeof s.pgUrl === 'string' && s.pgUrl.trim()) return s.pgUrl.trim()
  if (env && typeof env.REDTEAM_PG_URL === 'string' && env.REDTEAM_PG_URL.trim()) return env.REDTEAM_PG_URL.trim()
  if (env && typeof env.DSH_PG_URL === 'string' && env.DSH_PG_URL.trim()) return env.DSH_PG_URL.trim()
  if (env && typeof env.DATABASE_URL === 'string' && /^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL.trim())) {
    return env.DATABASE_URL.trim()
  }
  return null
}

/**
 * 保存或清除 PostgreSQL 连接串。
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

/* ============================================================================
 * File-Disjoint Sharding 纯确定性冲突检测与 ShardLockRegistry
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
export function filesOverlap(patA, patB) {
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

/**
 * 进程内带 TTL 租约的分片文件锁注册表（支持按根会话或项目工作区隔离）。
 */
export class ShardLockRegistry {
  constructor(options = {}) {
    const ttl = typeof options === 'number'
      ? options
      : Number(options && (options.ttlMs ?? options.ttl_ms))
    this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_LEASE_TTL_MS
    this.maxScopes = (options && typeof options === 'object' && Number.isFinite(Number(options.maxScopes)) && Number(options.maxScopes) > 0)
      ? Math.floor(Number(options.maxScopes))
      : 256
    this.scopes = new Map()
  }

  prune(now = Date.now()) {
    for (const [scope, map] of this.scopes.entries()) {
      for (const [owner, entry] of map.entries()) {
        if (entry.expiresAt <= now) map.delete(owner)
      }
      if (map.size === 0) this.scopes.delete(scope)
    }
    while (this.scopes.size > this.maxScopes) {
      const oldest = this.scopes.keys().next().value
      if (oldest === undefined) break
      this.scopes.delete(oldest)
    }
  }

  list(scope = 'default', now = Date.now()) {
    this.prune(now)
    const map = this.scopes.get(String(scope || 'default'))
    if (!map) return []
    return Array.from(map.values()).map((e) => ({
      owner: e.owner,
      label: e.label,
      files_owned: e.files_owned.slice(),
      acquired_at: e.acquiredAt,
      expires_at: e.expiresAt,
    }))
  }

  check(scope = 'default', requestedFiles = [], options = {}) {
    const now = typeof options.now === 'number' ? options.now : Date.now()
    const active = this.list(scope, now)
    return detectShardConflicts(requestedFiles, active, options)
  }

  acquire(scopeOrOpts, maybeOwnerOrOpts, maybeFilesOrNow, maybeTtlMs, maybeNow) {
    let scope = 'default'
    let owner = ''
    let files = []
    let ttlMs = this.ttlMs
    let label = ''
    let now = Date.now()

    const applySpec = (spec) => {
      if (spec.scope ?? spec.rootId ?? spec.engagement_id ?? spec.engagement) {
        scope = String(spec.scope ?? spec.rootId ?? spec.engagement_id ?? spec.engagement)
      }
      owner = String(spec.owner ?? spec.key ?? spec.worker_name ?? owner)
      label = String(spec.label ?? spec.worker_name ?? owner)
      const rawFiles = spec.files_owned ?? spec.files ?? spec.patterns ?? []
      files = Array.isArray(rawFiles) ? rawFiles : (typeof rawFiles === 'string' ? [rawFiles] : [])
      const rawTtl = Number(spec.ttlMs ?? spec.ttl_ms)
      if (Number.isFinite(rawTtl) && rawTtl > 0) ttlMs = rawTtl
      if (typeof spec.now === 'number' && Number.isFinite(spec.now)) now = spec.now
    }

    if (scopeOrOpts && typeof scopeOrOpts === 'object' && !Array.isArray(scopeOrOpts)) {
      applySpec(scopeOrOpts)
      if (typeof maybeOwnerOrOpts === 'number' && Number.isFinite(maybeOwnerOrOpts)) now = maybeOwnerOrOpts
    } else {
      scope = String(scopeOrOpts || 'default')
      if (maybeOwnerOrOpts && typeof maybeOwnerOrOpts === 'object' && !Array.isArray(maybeOwnerOrOpts)) {
        applySpec(maybeOwnerOrOpts)
        scope = String(scopeOrOpts || scope || 'default')
        if (typeof maybeFilesOrNow === 'number' && Number.isFinite(maybeFilesOrNow)) now = maybeFilesOrNow
      } else {
        owner = String(maybeOwnerOrOpts || '')
        label = owner
        files = Array.isArray(maybeFilesOrNow) ? maybeFilesOrNow : (typeof maybeFilesOrNow === 'string' ? [maybeFilesOrNow] : [])
        if (Number.isFinite(Number(maybeTtlMs)) && Number(maybeTtlMs) > 0) ttlMs = Number(maybeTtlMs)
        if (typeof maybeNow === 'number' && Number.isFinite(maybeNow)) now = maybeNow
      }
    }

    const normalized = Array.from(new Set(files.map(normalizeShardPattern).filter(Boolean)))
    this.prune(now)
    const active = this.list(scope, now)
    const check = detectShardConflicts(normalized, active, { ignoreOwner: owner })
    if (!check.ok) {
      return { ok: false, conflicts: check.conflicts }
    }
    if (!owner) owner = 'shard#' + now
    if (normalized.length > 0) {
      if (!this.scopes.has(scope)) this.scopes.set(scope, new Map())
      this.scopes.get(scope).set(owner, {
        owner,
        label: label || owner,
        files_owned: normalized,
        acquiredAt: now,
        expiresAt: now + ttlMs,
      })
      this.prune(now)
    }
    return { ok: true, conflicts: [], owner, files_owned: normalized, expires_at: now + ttlMs }
  }

  release(scope = 'default', owner = undefined) {
    if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
      owner = scope.owner ?? scope.key ?? scope.worker_name
      scope = scope.scope ?? scope.rootId ?? scope.engagement_id ?? scope.engagement ?? 'default'
    } else if (owner && typeof owner === 'object' && !Array.isArray(owner)) {
      owner = owner.owner ?? owner.key ?? owner.worker_name
    }
    const key = String(scope || 'default')
    const map = this.scopes.get(key)
    if (!map) return false
    if (owner === undefined) {
      const had = map.size > 0
      this.scopes.delete(key)
      return had
    }
    const deleted = map.delete(String(owner))
    if (map.size === 0) this.scopes.delete(key)
    return deleted
  }
}
