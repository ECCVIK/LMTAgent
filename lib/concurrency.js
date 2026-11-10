/**
 * 研发集群并发与递归子代理配置（零依赖）：
 *   1. **并发执行智能体上限（maxAgents）**：默认 6 并发（范围 1..12）；
 *   2. **子智能体默认思考强度（thinkingEffort）**：默认 `'low'`（合法值 `'low' | 'medium' | 'high'`）；
 *   3. **子智能体最大递归派发深度（maxDepth）**：默认 3（范围 1..5，支持子代理递归派发解决局部小问题）；
 *   4. **PostgreSQL 数据库连接配置（pgUrl）**：兼容 `$DSH_HOME/redteam/settings.json` 同文件存储。
 *
 * 存储路径：`$DSH_HOME/redteam/settings.json`（或传入的 `root/settings.json`）。
 * 生效顺序：settings.json → 环境变量（`REDTEAM_MAX_AGENTS` / `REDTEAM_THINKING_EFFORT` / `REDTEAM_MAX_DEPTH`） → 默认值。
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

/** 把任意输入收敛到 [1, 12] 的整数并发上限。 */
export function clampMaxAgents(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_AGENTS
  return Math.min(Math.max(n, MIN_AGENTS_LIMIT), MAX_AGENTS_LIMIT)
}

/** 规范化思考强度到 `'low' | 'medium' | 'high'`，非法值回退 `'low'`。 */
export function normalizeThinkingEffort(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (VALID_THINKING_EFFORTS.includes(raw)) return raw
  return DEFAULT_THINKING_EFFORT
}

/** 把任意输入收敛到 [1, 5] 的整数递归深度，非法值回退 3。 */
export function clampMaxDepth(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_DEPTH
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

/** 当前生效的子智能体默认思考强度（`'low' | 'medium' | 'high'`，默认 `'low'`）。 */
export function thinkingEffortOf(root, env = process.env) {
  const s = readSettings(root, env)
  const rawFile = s.thinkingEffort ?? s.thinking_effort
  if (typeof rawFile === 'string' && VALID_THINKING_EFFORTS.includes(rawFile.trim().toLowerCase())) {
    return rawFile.trim().toLowerCase()
  }
  const rawEnv = env && (env.REDTEAM_THINKING_EFFORT || env.DSH_SUBAGENT_THINKING)
  if (typeof rawEnv === 'string' && VALID_THINKING_EFFORTS.includes(rawEnv.trim().toLowerCase())) {
    return rawEnv.trim().toLowerCase()
  }
  return DEFAULT_THINKING_EFFORT
}

/** 思考强度配置来源（`'settings' | 'env' | 'default'`）。 */
export function thinkingEffortSourceOf(root, env = process.env) {
  const s = readSettings(root, env)
  const rawFile = s.thinkingEffort ?? s.thinking_effort
  if (typeof rawFile === 'string' && VALID_THINKING_EFFORTS.includes(rawFile.trim().toLowerCase())) {
    return 'settings'
  }
  const rawEnv = env && (env.REDTEAM_THINKING_EFFORT || env.DSH_SUBAGENT_THINKING)
  if (typeof rawEnv === 'string' && VALID_THINKING_EFFORTS.includes(rawEnv.trim().toLowerCase())) {
    return 'env'
  }
  return 'default'
}

/** 当前生效的子智能体最大递归派发深度（1..5，默认 3）。 */
export function maxDepthOf(root, env = process.env) {
  const s = readSettings(root, env)
  const fromFile = Number(s.maxDepth ?? s.max_depth)
  if (Number.isFinite(fromFile) && fromFile > 0) return clampMaxDepth(fromFile)
  const fromEnv = Number(env && env.REDTEAM_MAX_DEPTH)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return clampMaxDepth(fromEnv)
  return DEFAULT_MAX_DEPTH
}

/** 递归深度配置来源（`'settings' | 'env' | 'default'`）。 */
export function maxDepthSourceOf(root, env = process.env) {
  const s = readSettings(root, env)
  const fromFile = Number(s.maxDepth ?? s.max_depth)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  const fromEnv = Number(env && env.REDTEAM_MAX_DEPTH)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return 'env'
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
 * 保存并发上限（兼容 `saveMaxAgents(root, value)` 与 `saveMaxAgents(value)`），返回实际生效整数值。
 */
export function saveMaxAgents(rootOrValue, maybeValue, env = process.env) {
  if (maybeValue === undefined && (typeof rootOrValue === 'number' || (typeof rootOrValue === 'string' && /^\d+$/.test(rootOrValue.trim())))) {
    const applied = clampMaxAgents(rootOrValue)
    writeSettings(undefined, { maxAgents: applied }, env)
    return applied
  }
  const applied = clampMaxAgents(maybeValue)
  writeSettings(rootOrValue, { maxAgents: applied }, env)
  return applied
}

/**
 * 保存子智能体默认思考强度（`'low' | 'medium' | 'high'`），返回实际生效值。
 */
export function saveThinkingEffort(rootOrValue, maybeValue, env = process.env) {
  if (maybeValue === undefined && typeof rootOrValue === 'string' && VALID_THINKING_EFFORTS.includes(rootOrValue.trim().toLowerCase())) {
    const applied = normalizeThinkingEffort(rootOrValue)
    writeSettings(undefined, { thinkingEffort: applied }, env)
    return applied
  }
  const applied = normalizeThinkingEffort(maybeValue)
  writeSettings(rootOrValue, { thinkingEffort: applied }, env)
  return applied
}

/**
 * 保存子智能体最大递归派发深度（1..5），返回实际生效整数值。
 */
export function saveMaxDepth(rootOrValue, maybeValue, env = process.env) {
  if (maybeValue === undefined && (typeof rootOrValue === 'number' || (typeof rootOrValue === 'string' && /^\d+$/.test(rootOrValue.trim())))) {
    const applied = clampMaxDepth(rootOrValue)
    writeSettings(undefined, { maxDepth: applied }, env)
    return applied
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
