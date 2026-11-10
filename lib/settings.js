/**
 * 插件级设置（零依赖）：
 *   1. **并发执行智能体上限（maxAgents）**：默认 6 并发（上限 12）；
 *   2. **PostgreSQL 数据库连接配置（pgUrl / pgStrict）**：支持直连高性能 PostgreSQL 集群。
 *
 * 为什么不用纯环境变量：环境变量只能启动前设，改完得重启 dsh web / dsh-desktop；
 * 而"同时派几个执行智能体"与"切换 PostgreSQL 实例"是使用中常调的项，面板上应该能直接改。
 * 所以落一份 JSON 到事实库根目录：`$DSH_HOME/redteam/settings.json`。
 *
 * 生效顺序：settings.json → 环境变量 `REDTEAM_MAX_AGENTS` / `REDTEAM_PG_URL` → 默认值（6 并发）。
 * 工具侧（redteam_agent_slot 闸门）与面板侧（「智能体」页）读的是同一份，避免两处口径漂移。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 默认并发上限（用户口径：研发集群默认 6 个并发执行智能体，适配四波次 DAG 并行调度）。 */
export const DEFAULT_MAX_AGENTS = 6

/** 硬上限：支持最多 12 个并发子智能体并行作业。 */
export const MAX_AGENTS_LIMIT = 12

/** 设置文件路径（跟事实库同一个根，随事实库一起备份/迁移）。 */
export function settingsPathOf(root) {
  return join(String(root || '.'), 'settings.json')
}

/** 读全部设置（读不到/坏了都当空对象，绝不抛）。 */
export function readSettings(root) {
  try {
    if (!existsSync(settingsPathOf(root))) return {}
    const parsed = JSON.parse(readFileSync(settingsPathOf(root), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

/** 合并写入若干项设置，返回写入后的完整设置。 */
export function writeSettings(root, patch) {
  const next = Object.assign({}, readSettings(root), patch)
  mkdirSync(String(root || '.'), { recursive: true })
  writeFileSync(settingsPathOf(root), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/** 把任意输入收敛到 [1, MAX_AGENTS_LIMIT] 的整数。 */
export function clampMaxAgents(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_MAX_AGENTS
  return Math.min(Math.max(n, 1), MAX_AGENTS_LIMIT)
}

/**
 * 当前生效的并发上限。
 * @param root - 事实库根目录（`ctx.redteam.root`）。
 * @param env - 环境变量表（便于测试注入）。
 * @returns 生效的整数上限。
 */
export function maxAgentsOf(root, env = process.env) {
  const fromFile = Number(readSettings(root).maxAgents)
  if (Number.isFinite(fromFile) && fromFile > 0) return clampMaxAgents(fromFile)
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return clampMaxAgents(fromEnv)
  return DEFAULT_MAX_AGENTS
}

/** 保存并发上限，返回实际生效值。 */
export function saveMaxAgents(root, value) {
  const applied = clampMaxAgents(value)
  writeSettings(root, { maxAgents: applied })
  return applied
}

/** 当前设置是从哪来的（面板上要如实说明，避免"我改了没生效"的错觉）。 */
export function maxAgentsSourceOf(root, env = process.env) {
  const fromFile = Number(readSettings(root).maxAgents)
  if (Number.isFinite(fromFile) && fromFile > 0) return 'settings'
  const fromEnv = Number(env && env.REDTEAM_MAX_AGENTS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return 'env'
  return 'default'
}

/**
 * 读取当前配置的 PostgreSQL 连接串（未配置返回 null）。
 */
export function pgUrlOf(root, env = process.env) {
  const s = readSettings(root)
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
 * @param root - 事实库根目录。
 * @param pgUrl - `postgresql://...` 或空字符串（清除）。
 */
export function savePgUrl(root, pgUrl) {
  const clean = typeof pgUrl === 'string' ? pgUrl.trim() : ''
  if (!clean) {
    const next = readSettings(root)
    delete next.pgUrl
    mkdirSync(String(root || '.'), { recursive: true })
    writeFileSync(settingsPathOf(root), JSON.stringify(next, null, 2) + '\n', 'utf8')
    return null
  }
  if (!/^postgres(?:ql)?:\/\//i.test(clean)) {
    throw new Error('PostgreSQL 连接串必须以 postgres:// 或 postgresql:// 开头')
  }
  writeSettings(root, { pgUrl: clean })
  return clean
}
